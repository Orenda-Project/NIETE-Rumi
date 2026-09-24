#!/usr/bin/env python3
"""The E2E harness must only name `users` columns that exist, and must unregister by the bot's own gate.

`users.first_name` / `users.last_name` are gone from NIETE staging and production (migration V1.4.4);
`users.name` is the only name column, and the bot decides "registered" with isRegistered()
(bot/shared/utils/registration-status.js): registration_completed, registration_state = 'completed',
or a non-empty `name`. PostgREST rejects a select that names a missing column (400 / 42703) and a write
whose body carries one (400 / PGRST204), so every harness call that still names first_name — or `grade`,
dropped earlier — fails on staging today, and on the sandbox the moment V1.4.4 runs there.

Only the network boundary is faked: urllib.request.urlopen is replaced by a tiny PostgREST that knows the
live `users` column set and answers the way PostgREST does. The harness's own request code runs for real.
Red-first: on the base branch every test below fails (42703 / PGRST204, or an unregister the bot's gate
still reads as registered).

Run: python3 .claude/qa/shared/test_harness_users_columns.py
"""
import io, json, os, subprocess, sys, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
import niete_sandbox_driver as drv      # noqa: E402
import niete_training_db as tdb         # noqa: E402
import niete_registration_db as reg     # noqa: E402

# The `users` columns present on BOTH staging and the sandbox once V1.4.4 has run there (information_schema,
# read 24 Sep 2026). first_name, last_name and grade are absent from both.
USERS_COLUMNS = {
    "id", "phone_number", "name", "grades_taught", "registration_completed", "registration_started_at",
    "registration_completed_at", "created_at", "updated_at", "school_name", "subjects_taught", "source",
    "session_id", "first_message_at", "registered_at", "registration_state", "registration_state_updated_at",
    "preferred_language", "portal_password_hash", "portal_invite_token", "portal_invite_expires_at",
    "portal_activated", "portal_last_login", "password_reset_code", "password_reset_expires_at",
    "language_locked", "is_test_user", "language_nudge_sent", "registration_pending_name", "country", "region",
    "organization", "preferences", "last_message_at", "subject", "teacher_uuid", "school_id", "role",
    "conversation_state", "conversation_state_expires_at", "teacher_level", "teacher_level_updated_at",
    "deleted_at", "deleted_reason", "deleted_by",
}
PHONE = "923000000001"          # synthetic driver number, as in the other harness tests
BASE = "https://sandbox.example.test"


class _Resp:
    def __init__(self, status, payload):
        self.status = status
        self._raw = b"" if payload is None else json.dumps(payload).encode()

    def read(self):
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakePostgrest:
    """users rows keyed by phone. Validates column names exactly where PostgREST does."""

    def __init__(self, rows=None):
        self.rows = {r["phone_number"]: dict(r) for r in (rows or [])}
        self.calls = []

    def _error(self, req, code, message):
        body = json.dumps({"code": code, "message": message}).encode()
        raise urllib.error.HTTPError(req.full_url, 400, "Bad Request", {}, io.BytesIO(body))

    def __call__(self, req, timeout=None):
        u = urllib.parse.urlsplit(req.full_url)
        table = u.path.rsplit("/", 1)[-1]
        q = dict(urllib.parse.parse_qsl(u.query, keep_blank_values=True))
        method = req.get_method()
        body = json.loads(req.data.decode()) if req.data else None
        self.calls.append((method, table, q, body))
        if table != "users":
            return _Resp(200, [] if method == "GET" else None)
        if method == "GET":
            cols = q.get("select", "*").split(",")
            for c in cols:
                if c != "*" and c not in USERS_COLUMNS:
                    self._error(req, "42703", "column users.%s does not exist" % c)
            phone = q.get("phone_number", "eq.")[3:]
            row = self.rows.get(phone)
            return _Resp(200, [{c: row.get(c) for c in cols}] if row else [])
        for c in (body or {}):
            if c not in USERS_COLUMNS:
                self._error(req, "PGRST204", "Could not find the '%s' column of 'users' in the schema cache" % c)
        if method == "POST":
            self.rows[body["phone_number"]] = dict(body, id="u-new")
        elif method == "PATCH":
            phone = q.get("phone_number", "eq.")[3:]
            if phone in self.rows:
                self.rows[phone].update(body)
        return _Resp(201 if method == "POST" else 204, None)


def _install(fake):
    urllib.request.urlopen = fake        # both harness modules call urllib.request.urlopen at call time


def _bot_says_registered(row):
    """The bot's own gate, executed — not restated."""
    js = ("const {isRegistered}=require(%s);process.stdout.write(String(isRegistered(JSON.parse(process.argv[1]))))"
          % json.dumps(os.path.join(REPO, "bot", "shared", "utils", "registration-status.js")))
    out = subprocess.run(["node", "-e", js, json.dumps(row)], capture_output=True, text=True, check=True)
    return out.stdout.strip() == "true"


class _A:
    def __init__(self, **kw):
        self.phone, self.yes_write, self.env = PHONE, True, "sandbox"
        self.include_language, self.out, self.from_file = False, None, None
        self.__dict__.update(kw)


REGISTERED = {"id": "u1", "phone_number": PHONE, "name": "E2E Driver", "registration_completed": True,
              "registration_state": "completed", "preferred_language": "en", "language_locked": False,
              "role": "teacher", "country": "Pakistan", "conversation_state": None}
CREDS = (BASE, "service-key-not-real")


# ── the sandbox driver (mock lane) ──────────────────────────────────────────────────────────────────

def test_driver_lookup_reads_a_live_column_set():
    _install(FakePostgrest([REGISTERED]))
    row = drv.lookup(CREDS, PHONE)
    assert row and row["id"] == "u1"


def test_driver_ensure_creates_the_driver_with_name_and_it_is_registered():
    fake = FakePostgrest([])
    _install(fake)
    assert drv.cmd_ensure(CREDS, _A()) == 0
    row = fake.rows[PHONE]
    assert row.get("name"), "the driver must be named in users.name, the only name column"
    assert _bot_says_registered(row)


def test_driver_ensure_leaves_a_registered_driver_alone():
    fake = FakePostgrest([REGISTERED])
    _install(fake)
    assert drv.cmd_ensure(CREDS, _A()) == 0
    assert not [c for c in fake.calls if c[0] in ("PATCH", "POST")], "a registered driver needs no write"


def test_driver_unregister_makes_the_bot_see_an_unregistered_account():
    fake = FakePostgrest([REGISTERED])
    _install(fake)
    assert drv.cmd_unregister(CREDS, _A()) == 0
    assert not _bot_says_registered(fake.rows[PHONE]), "the bot would still answer 'already registered'"


def test_driver_reset_state_runs_on_the_live_column_set():
    fake = FakePostgrest([dict(REGISTERED, conversation_state={"k": "v"})])
    _install(fake)
    assert drv.cmd_reset_state(CREDS, _A()) == 0
    assert fake.rows[PHONE]["conversation_state"] is None


# ── the shared DB reach-through both lanes use (api.db('lookup')) ────────────────────────────────────

def test_training_db_lookup_reads_a_live_column_set():
    _install(FakePostgrest([REGISTERED]))
    buf = io.StringIO()
    old, sys.stdout = sys.stdout, buf
    try:
        tdb.cmd_lookup(CREDS, _A())
    finally:
        sys.stdout = old
    assert '"name": "E2E Driver"' in buf.getvalue()


# ── registration seeding (api.db('unregister' | 'snapshot' | 'restore')) ────────────────────────────

def test_registration_db_names_only_live_columns():
    every = set(reg.REGISTRATION_FIELDS) | set(reg.LANGUAGE_FIELDS)
    assert every <= USERS_COLUMNS, "not a users column: %s" % sorted(every - USERS_COLUMNS)


def test_registration_db_unregister_makes_the_bot_see_an_unregistered_account():
    fake = FakePostgrest([REGISTERED])
    _install(fake)
    reg.SNAP_DIR = os.path.join(os.environ.get("TMPDIR", "/tmp"), "harness-users-columns-test")
    buf = io.StringIO()
    old, sys.stdout = sys.stdout, buf
    try:
        reg.cmd_unregister(CREDS, _A())
    finally:
        sys.stdout = old
    assert not _bot_says_registered(fake.rows[PHONE])


if __name__ == "__main__":
    real = urllib.request.urlopen
    fails = 0
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        try:
            fn(); print("ok   " + name)
        except BaseException as e:      # a SystemExit from a rejected request is a failure too
            fails += 1; print("FAIL " + name + ": " + repr(e)[:300])
        finally:
            urllib.request.urlopen = real
    print("%d test(s), %d failed" % (len(tests), fails))
    sys.exit(1 if fails else 0)
