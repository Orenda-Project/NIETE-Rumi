#!/usr/bin/env python3
"""
Merge an RM-confirmed teacher's duplicate accounts into one (bd-4jlu31.8.1), the way the app's own number move does
(bot/shared/services/observe/teacher-edit-commit.service.js moveNumber). The rules live in
scripts/lib/merge_duplicates.py and are unit-tested in scripts/tests/test_merge_duplicates.py.

  DRY RUN (default; read-only):
    python3 scripts/merge-duplicate-accounts.py --target prod --env-file .env.prod --scope <scope CSV> --go 3a \\
        --out <ids-only output dir> [--private-dir ~/rumi-private/niete-dupes] [--only "t1 #12,t2 #3"]
  COMMIT (after review; prod also needs MERGE_DUPES_PROD_GO=yes, --confirm-ref and the reviewed --expect-csv):
    ... --expect-csv <the reviewed dry run's plan CSV> --commit --confirm-ref ihzciabopbttygxxgrkm
  SWEEP (move what reached a retired account after its merge: a message the bot was still answering at the commit):
    ... --sweep <the commit's before-image> --out <dir> [--commit --confirm-ref ...]
  RESTORE (undo, teacher by teacher, from a before-image; undo a sweep before the merge it followed):
    ... --restore <before-image> --out <dir> [--commit --confirm-ref ...]
  REPOINT (repair: every retired account the governed mapping does not credit to its teacher's current account gets a
  newer edit_phone row on that account's number; prod also needs MERGE_DUPES_PROD_GO=yes, --confirm-ref and the
  reviewed --expect-csv; undo a re-point run before the merge it repaired):
    ... --repoint --out <dir> [--only <retired id>,...] [--expect-csv <its dry run's plan CSV> --commit --confirm-ref ...]

Per teacher, in a transaction of its own (so a teacher's chat waits seconds at most): re-read both accounts and all
they own in one REPEATABLE READ snapshot; choose the survivor; re-check every guard and the reviewed decisions (one
guard refuses keeping a number when another account of the pair messaged more recently: the teacher writes from that
number now, and the freed one would come back as a new account; a reason in the scope's keep_number_override lets it
through); move
every row the retired account owns, by primary key (a row stays only where a unique index already holds the
survivor's row for its key, or a sealed form keeps its observer); move booked visits with the number; retire the
duplicate (soft delete, number freed); give the survivor the number in use with its portal login and WhatsApp
session, and any fact it lacks; write one edit_phone audit row per retired account, and a re-point row for each
account an earlier merge retired that this one would leave credited to nobody (the governed ict_account_merges follows
a retired account's latest to_phone, so a re-merge that moves or retires the earlier survivor strands it); then check,
as the analytics read it, that every account it retired or re-pointed is the survivor's. A class link or class list the
survivor already has for the same class is folded into the survivor's, as the app's class hand-over
does, under the class's roster lock: its subjects or children follow, the class-teacher flag moves when only the
duplicate's link holds it, and the duplicate's row retires, then moves like any other. Every write asserts its rowcount,
then the result is re-read and checked, else ROLLBACK. A serialization failure or lock timeout (the teacher chatting
at that instant) retries that teacher on a fresh snapshot, up to 3 attempts. The first teacher that cannot be merged
stops the run; teachers already committed stay committed and are listed.

Owner columns, primary keys and unique keys are read from the database's own catalog, never assumed.
--out gets the ids-only plan CSV and summary JSON (no phone number, hash or name). --private-dir gets the
before-image (phone numbers, portal hashes, booked-visit ids), mode 0600, written before the first write and updated
as each teacher commits; restore and sweep read it. No phone number is printed: database errors are masked first.
"""
import argparse
import csv
import hashlib
import json
import os
import re
import sys
import time
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import psycopg2
import psycopg2.extras
from psycopg2 import sql

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import merge_duplicates as md  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
TARGETS = {
    "sandbox": {"ref": "olvritwoqujtjvwfulbh", "host": "aws-0-ap-southeast-1.pooler.supabase.com"},
    "staging": {"ref": "rpqkekcfvumypldbejhp", "host": "aws-1-ap-south-1.pooler.supabase.com"},
    "prod":    {"ref": "ihzciabopbttygxxgrkm", "host": "aws-1-ap-south-1.pooler.supabase.com"},
}
USER_COLS = ("id", "phone_number", "name", "role", "school_id", "organization", "is_test_user", "deleted_at",
             "deleted_reason", "deleted_by", "registration_completed", "registration_state",
             "registration_completed_at", "registered_at", "teacher_level", "teacher_level_updated_at",
             "preferred_language", "language_locked", "portal_password_hash", "portal_activated", "portal_last_login",
             "conversation_state", "conversation_state_expires_at", "session_id", "last_message_at",
             "first_message_at", "grades_taught", "subjects_taught", "subject", "teacher_uuid", "portal_invite_token",
             "portal_invite_expires_at")
JSONB = ("conversation_state", "subjects_taught")
REVIEW = "NIETE ICT - Duplicate Teacher Accounts, RM-finalized 10 Nov 2026"
# A concurrent insert can take a key the plan moves a row into (the nudge sender, say): a fresh snapshot sees it.
RETRYABLE = ("could not serialize access", "lock timeout", "deadlock detected",
             "duplicate key value violates unique constraint")
ATTEMPTS = 3
CHUNK = 1000
AUDIT_COUNT = ("SELECT count(*) AS n FROM leader_roster_audit WHERE action = 'edit_phone' "
               "AND detail->>'run_id' = %s AND detail->>'retired_user_id' = ANY(%s)")
# How a folded row retires, as the app retires a class link (roster_change_class_details.sql, ClassService) and a class
# list (roster_hand_over_class.sql): {table: {column: SQL value}}. A restore puts these columns back from the image.
FOLD_RETIRE = {"class_teachers": {"is_active": "false", "is_class_teacher": "false", "ended_on": "current_date"},
               "student_lists": {"is_active": "false"}}
# A list's student_count from truth once its children have moved, as roster_hand_over_class does (the students trigger
# recounts only the list a child moves to), and the check that it is.
FOLD_RECOUNT = {"student_lists": "UPDATE student_lists l SET student_count = (SELECT count(*) FROM students s "
                                 "WHERE s.list_id = l.id AND s.is_active), updated_at = now() WHERE l.id = ANY(%s::uuid[])"}
FOLD_COUNTS_OFF = {"student_lists": "student_lists l WHERE l.id = ANY(%s::uuid[]) AND l.student_count IS DISTINCT "
                                    "FROM (SELECT count(*) FROM students s WHERE s.list_id = l.id AND s.is_active)"}
# Every roster writer takes this per-class lock (roster_hand_over_class.sql and the other roster RPCs); a fold is a hand-over.
ROSTER_LOCK = "SELECT pg_advisory_xact_lock(hashtextextended('roster_import:' || %s, 0))"
# Each retired account's latest edit_phone row: the survivor it names, its to_phone and its id (md.current_account).
LATEST_RETIRED = ("SELECT DISTINCT ON (detail->>'retired_user_id') detail->>'retired_user_id' AS retired, "
                  "teacher_ext_id AS survivor, detail->>'to_phone' AS to_phone, id::text AS row_id "
                  "FROM leader_roster_audit WHERE action = 'edit_phone' AND detail->>'retired_user_id' IS NOT NULL "
                  "ORDER BY detail->>'retired_user_id', created_at DESC, id")
# The governed ict_account_merges (taleemabad-data rules, niete-rumi teacher-headcount 1e) as Postgres runs it, for the
# given retired accounts: the live accounts on the last ten digits of each one's latest edit_phone row's to_phone.
GOVERNED = (r"WITH a AS (SELECT detail->>'retired_user_id' AS retired_id, "
            r"right(regexp_replace(detail->>'to_phone', '[^0-9]', '', 'g'), 10) AS to_p10, "
            r"row_number() OVER (PARTITION BY detail->>'retired_user_id' ORDER BY created_at DESC) AS rn "
            r"FROM leader_roster_audit WHERE action = 'edit_phone' AND detail->>'retired_user_id' = ANY(%s)) "
            r"SELECT a.retired_id, coalesce(array_agg(s.id::text ORDER BY s.id::text) FILTER (WHERE s.id IS NOT NULL), "
            r"'{}') AS holders FROM a LEFT JOIN users s "
            r"ON right(regexp_replace(s.phone_number, '[^0-9]', '', 'g'), 10) = a.to_p10 AND s.deleted_at IS NULL "
            r"AND s.id::text <> a.retired_id WHERE a.rn = 1 GROUP BY a.retired_id")
# The live accounts on each given number key (the governed join's key: the last ten ASCII digits).
KEY_HOLDERS = (r"SELECT right(regexp_replace(phone_number, '[^0-9]', '', 'g'), 10) AS k, "
               r"array_agg(id::text ORDER BY id::text) AS ids FROM users WHERE deleted_at IS NULL "
               r"AND right(regexp_replace(phone_number, '[^0-9]', '', 'g'), 10) = ANY(%s) GROUP BY 1")
REPOINT_COUNT = ("SELECT count(*) AS n FROM leader_roster_audit WHERE action = 'edit_phone' AND detail->>'run_id' = %s "
                 "AND detail->>'case' = 'repoint' AND detail->>'retired_user_id' = ANY(%s)")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def read_env(path):
    env = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        env[k.strip()] = v
    return env


def ref_of(env):
    """The project the connection will actually reach. With a DATABASE_URL (which connect uses) the ref comes from that
    URL, the pooler user postgres.<ref> or the host db.<ref>.supabase.co, and must agree with SUPABASE_URL when both
    name one; a DATABASE_URL naming no project is refused. Without one, connect builds the pooler user from the target's
    ref and SUPABASE_URL must name that ref."""
    m = re.match(r"https://([a-z0-9]+)\.supabase\.co", env.get("SUPABASE_URL", ""))
    url_ref = m.group(1) if m else None
    dsn = env.get("DATABASE_URL")
    if not dsn:
        return url_ref
    refs = set(re.findall(r"postgres\.([a-z0-9]{20})[:@]", dsn)) | set(re.findall(r"db\.([a-z0-9]{20})\.supabase\.co", dsn))
    if len(refs) != 1:
        raise SystemExit("ABORT: cannot tell which project DATABASE_URL reaches; refusing.")
    ref = refs.pop()
    if url_ref and url_ref != ref:
        raise SystemExit(f"ABORT: DATABASE_URL reaches '{ref}' but SUPABASE_URL names '{url_ref}'; refusing.")
    return ref


def connect(env, target, writable):
    want, have = TARGETS[target]["ref"], ref_of(env)
    if have != want:
        raise SystemExit(f"ABORT: env points at '{have}' but --target {target} expects '{want}'.")
    if env.get("DATABASE_URL"):
        conn = psycopg2.connect(env["DATABASE_URL"], cursor_factory=psycopg2.extras.RealDictCursor)
    else:
        conn = psycopg2.connect(host=TARGETS[target]["host"], port=5432, user=f"postgres.{want}",
                                password=env["SUPABASE_DB_PASSWORD"], dbname="postgres",
                                cursor_factory=psycopg2.extras.RealDictCursor)
    conn.set_session(isolation_level="REPEATABLE READ", readonly=not writable, autocommit=False)
    return conn


def masked(msg):
    """A database error fit to print: its first line only (DETAIL, CONTEXT, LINE and QUERY lines quote row values or
    the statement with its parameters inlined), with digit runs and password hashes masked."""
    text = str(msg).strip()
    first = text.splitlines()[0] if text else ""
    first = re.sub(r"\$2[aby]?\$\d\d\$[./A-Za-z0-9]{20,}", "<hash>", first)
    return re.sub(r"\d{7,}", "<number>", first)


def ident(name):
    """A table name from the catalog (regclass text: bare in public, schema-qualified elsewhere)."""
    return sql.Identifier(*name.split("."))


def raw(text):
    """Catalog SQL (an index expression or predicate) placed into a query that also takes %s parameters."""
    return sql.SQL(text.replace("%", "%%"))


def jsonable(v):
    return v.isoformat() if isinstance(v, (datetime, date)) else v


def db_value(col, v):
    return psycopg2.extras.Json(v) if col in JSONB and v is not None else v


# ── reads ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def read_catalog(cur):
    """(fks, keys, refs). fks: {(table, owner column): (pk column, pk type) or None} for every foreign key onto
    users.id. keys: {(table, owner column): [unique index, ...]} for every unique index (not the primary key) that
    includes an owner column, with the SQL the owned-rows read selects for its other key columns and its partial
    predicate. refs: {table: [(referencing table, column)]}, the single-column foreign keys onto each owner table's
    primary key: what would be left hanging from a row that stays behind."""
    cur.execute("""
        SELECT con.conrelid::regclass::text AS tbl, cardinality(con.conkey) AS n,
               (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attnum = con.conkey[1]) AS col,
               (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = con.confrelid AND a.attnum = con.confkey[1]) AS ref,
               (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod))
                  FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                 WHERE i.indrelid = con.conrelid AND i.indisprimary) AS pk
        FROM pg_constraint con WHERE con.contype = 'f' AND con.confrelid = 'public.users'::regclass ORDER BY 1, 3""")
    fks = {}
    for r in cur.fetchall():
        if r["n"] != 1 or r["ref"] != "id":
            raise SystemExit(f"ABORT: {r['tbl']} references users.{r['ref']} through {r['n']} column(s); this tool "
                             "moves single-column references to users.id only.")
        pk = r["pk"] or []
        fks[(r["tbl"], r["col"])] = tuple(pk[0].split(":", 1)) if len(pk) == 1 else None
    cur.execute("""
        SELECT i.indexrelid::regclass::text AS idx, i.indrelid::regclass::text AS tbl,
               pg_get_expr(i.indpred, i.indrelid) AS pred, NOT i.indnullsnotdistinct AS nulls_distinct,
               array_agg(coalesce(a.attname, '') ORDER BY k.ord) AS cols,
               array_agg(pg_get_indexdef(i.indexrelid, k.ord::int, true) ORDER BY k.ord) AS defs
        FROM pg_index i
        CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
        LEFT JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum AND k.attnum > 0
        WHERE i.indisunique AND NOT i.indisprimary AND i.indrelid::regclass::text = ANY(%s)
          AND k.ord <= i.indnkeyatts
        GROUP BY 1, 2, 3, 4 ORDER BY 1""", (sorted({t for t, _ in fks}),))
    owners = {}
    for t, c in fks:
        owners.setdefault(t, []).append(c)
    keys, n = {}, 0
    for r in cur.fetchall():
        for c in owners.get(r["tbl"], ()):
            if c not in r["cols"]:
                if any(not col and re.search(rf"\b{re.escape(c)}\b", d) for col, d in zip(r["cols"], r["defs"])):
                    raise SystemExit(f"ABORT: unique index {r['idx']} uses {r['tbl']}.{c} inside an expression; "
                                     "this tool cannot plan that key.")
                continue
            n += 1
            others = [d for col, d in zip(r["cols"], r["defs"]) if col != c]
            keys.setdefault((r["tbl"], c), []).append(
                {"name": r["idx"], "cols": tuple(f"_k{n}_{j}" for j in range(len(others))), "exprs": tuple(others),
                 "in": f"_in{n}" if r["pred"] else None, "pred": r["pred"], "nulls_distinct": r["nulls_distinct"]})
    cur.execute("""SELECT a.attname AS col FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid
                   AND a.attnum = ANY(i.indkey) WHERE i.indrelid = 'public.users'::regclass AND i.indisunique
                   AND NOT i.indisprimary""")
    unknown = sorted({r["col"] for r in cur.fetchall()} - {"phone_number"} - set(md.UNIQUE_TAKE))
    if unknown:
        raise SystemExit(f"ABORT: users has unique column(s) {unknown} this tool does not know how to merge.")
    pk_of = {t: pk[0] for (t, _c), pk in fks.items() if pk}
    cur.execute("""
        SELECT con.confrelid::regclass::text AS t, con.conrelid::regclass::text AS rt,
               (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attnum = con.conkey[1]) AS rc,
               (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = con.confrelid AND a.attnum = con.confkey[1]) AS col
        FROM pg_constraint con WHERE con.contype = 'f' AND cardinality(con.conkey) = 1
          AND con.confrelid::regclass::text = ANY(%s) ORDER BY 1, 2, 3""", (sorted(pk_of),))
    refs = {}
    for r in cur.fetchall():
        if r["col"] == pk_of[r["t"]]:
            refs.setdefault(r["t"], []).append((r["rt"], r["rc"]))
    return fks, keys, refs


def load_users(cur, ids):
    cols = sql.SQL(", ").join(
        sql.SQL("{}::text AS {}").format(sql.Identifier(c), sql.Identifier(c)) if c in ("id", "school_id")
        else sql.Identifier(c) for c in USER_COLS)
    cur.execute(sql.SQL("SELECT {} FROM users WHERE id = ANY(%s::uuid[])").format(cols), (list(ids),))
    return {r["id"]: dict(r) for r in cur.fetchall()}


def identity_counts(cur, fks, ids):
    """Identity-bearing rows per account, in one round trip."""
    out = {i: 0 for i in ids}
    tables = [t for t in md.IDENTITY_TABLES if (t, "user_id") in fks]
    if tables:
        cur.execute(sql.SQL(" UNION ALL ").join(
            sql.SQL("SELECT user_id::text AS u FROM {} WHERE user_id = ANY(%(ids)s::uuid[])").format(ident(t))
            for t in tables), {"ids": list(ids)})
        for r in cur.fetchall():
            out[r["u"]] += 1
    return out


def owned_rows(cur, fks, keys, ids):
    """{(table, owner column): [{"id", "owner", "frozen"?, <key aliases>...}, ...]} for every row the accounts own,
    read in ONE round trip (a query per table costs ~0.2 s each over the pooler, and the snapshot this read opens is
    the one the writes must land in). Key values come back through jsonb: compared only with each other."""
    branches = []
    for (t, c), pk in sorted(fks.items()):
        k = []
        for ix in keys.get((t, c), ()):
            for e, alias in zip(ix["exprs"], ix["cols"]):
                k += [sql.Literal(alias), sql.SQL("({})").format(raw(e))]
            if ix["in"]:
                k += [sql.Literal(ix["in"]), sql.SQL("coalesce(({}), false)").format(raw(ix["pred"]))]
        if (t, c) in md.FROZEN:
            k += [sql.Literal("frozen"), sql.SQL("coalesce(({}), false)").format(raw(md.FROZEN[(t, c)]))]
        branches.append(sql.SQL(
            "SELECT {tl}::text AS t, {cl}::text AS c, {pk} AS id, {c}::text AS owner, jsonb_build_object({k}) AS k "
            "FROM {t} WHERE {c} = ANY(%(ids)s::uuid[])").format(
                tl=sql.Literal(t), cl=sql.Literal(c), c=sql.Identifier(c), t=ident(t), k=sql.SQL(", ").join(k),
                pk=sql.SQL("{}::text").format(sql.Identifier(pk[0])) if pk else sql.SQL("NULL::text")))
    cur.execute(sql.SQL(" UNION ALL ").join(branches), {"ids": list(ids)})
    owned = {}
    for r in cur.fetchall():
        owned.setdefault((r["t"], r["c"]), []).append({"id": r["id"], "owner": r["owner"], **r["k"]})
    for (t, c), rows in owned.items():
        if fks[(t, c)] is None and (t, c) not in md.NEVER_MOVE:
            raise SystemExit(f"ABORT: {t} has no single-column primary key and the accounts own {len(rows)} of its "
                             "rows; this tool moves rows by primary key.")
    return owned


def load_visits(cur, ids):
    """The booked visits on the accounts' own numbers, matched on the server so no phone number goes into a query."""
    cur.execute("SELECT id::text AS id, teacher_ext_id, status, leader_user_id::text AS leader_user_id, school_ext_id "
                "FROM observation_schedules WHERE teacher_ext_id IN "
                "(SELECT phone_number FROM users WHERE id = ANY(%s::uuid[]))", (list(ids),))
    return [dict(r) for r in cur.fetchall()]


def retired_accounts(cur):
    """(latest, deleted): every retired account's latest edit_phone row, {retired id: {"survivor", "to_phone",
    "row_id"}}, and {account id: soft-deleted?} for those accounts and the survivors they name (ids that are no
    account are left out, so md.current_account stops there). Two round trips over a table of thousands of rows."""
    cur.execute(LATEST_RETIRED)
    latest = {r["retired"]: {"survivor": r["survivor"], "to_phone": r["to_phone"], "row_id": r["row_id"]}
              for r in cur.fetchall()}
    ids = sorted({i for i in set(latest) | {r["survivor"] for r in latest.values()} if i and UUID_RE.match(i)})
    cur.execute("SELECT id::text AS id, deleted_at IS NOT NULL AS deleted FROM users WHERE id = ANY(%s::uuid[])", (ids,))
    return latest, {r["id"]: r["deleted"] for r in cur.fetchall()}


def governed_holders(cur, retired_ids):
    """{retired id: [live accounts]}: whom the governed mapping credits each retired account to (GOVERNED)."""
    if not retired_ids:
        return {}
    cur.execute(GOVERNED, (list(retired_ids),))
    return {r["retired_id"]: list(r["holders"]) for r in cur.fetchall()}


def governed_problems(cur, pair, want):
    """Problems where the governed mapping does not credit each retired account to its account. want: {retired: id}."""
    got = governed_holders(cur, sorted(want))
    return [f"{pair}: the governed mapping credits {r} to {got.get(r) or 'nobody'}, not {a}"
            for r, a in sorted(want.items()) if got.get(r) != [a]]


def number_holders(cur, phones):
    """{number key: [live account ids]} for the keys of the given numbers (KEY_HOLDERS): one scan of users."""
    numbers = sorted({md.number_key(p) for p in phones} - {None})
    if not numbers:
        return {}
    cur.execute(KEY_HOLDERS, (numbers,))
    return {r["k"]: list(r["ids"]) for r in cur.fetchall()}


def read_state(cur, ids, fks, keys):
    users = load_users(cur, ids)
    return {"users": users, "ident": identity_counts(cur, fks, ids),
            "owned": owned_rows(cur, fks, keys, ids), "visits": load_visits(cur, ids),
            "retired_rows": retired_accounts(cur),
            "number_holders": number_holders(cur, [u["phone_number"] for u in users.values()])}


def full_rows(conn, pp, fks):
    """A backup of every row this teacher's write touches, whole (all columns), from the plan's own snapshot: the
    accounts' users rows, each row to be moved, each booked visit to be moved, both rows of each fold and the rows that
    follow it (keyed '<parent>/<key>'). Kept in the private before-image beside the undo list, so anything the write did
    to a row, not only the columns it meant to change, can be read back; a restore takes a folded row's columns back
    from here."""
    groups = {("users", "id", "uuid"): set([pp["survivor"]] + pp["retired"])}
    for (t, c, row, _owner, action) in pp.get("moves", []):
        if action != "skip" and fks.get((t, c)):
            groups.setdefault((t,) + tuple(fks[(t, c)]), set()).add(row)
    for f in pp.get("folds", []):
        groups.setdefault((f["table"],) + tuple(fks[(f["table"], f["column"])]), set()).update([f["row"], f["into"]])
    if pp.get("visits"):
        groups.setdefault(("observation_schedules", "id", "uuid"), set()).update(v["row_id"] for v in pp["visits"])
    branches, params = [], {}
    for i, ((t, pk, ty), ids) in enumerate(sorted(groups.items())):
        params[f"p{i}"] = sorted(ids)
        branches.append(sql.SQL("SELECT {tl}::text AS t, {pk}::text AS id, to_jsonb(x) AS row FROM {t} x "
                                "WHERE {pk} = ANY(%({p})s::{ty}[])").format(
            tl=sql.Literal(t), pk=sql.Identifier(pk), t=ident(t), p=sql.SQL(f"p{i}"), ty=sql.SQL(ty)))
    for j, f in enumerate(f for f in pp.get("folds", []) if f["keys"]):
        rt, rc, kc = f["follow"]
        params[f"f{j}"], params[f"k{j}"] = [f["row"], f["into"]], f["keys"]
        branches.append(sql.SQL("SELECT {tl}::text, {rc}::text || '/' || {kc}::text, to_jsonb(x) FROM {rt} x "
                                "WHERE {rc} = ANY(%({f})s::{ty}[]) AND {m}").format(
            tl=sql.Literal(rt), rc=sql.Identifier(rc), kc=sql.Identifier(kc), rt=ident(rt), f=sql.SQL(f"f{j}"),
            m=_key_match(f, f"%(k{j})s"), ty=sql.SQL(fks[(f["table"], f["column"])][1])))
    with conn.cursor() as cur:
        cur.execute(sql.SQL(" UNION ALL ").join(branches), params)
        return [{"table": r["t"], "id": r["id"], "row": r["row"]} for r in cur.fetchall()]


def stranded_rows(conn, moves, fks, refs):
    """[(table, row_id, {"ref_table.col": n})] for rows that would stay behind (a frozen form excepted) while other
    rows depend on them, counted in the caller's open snapshot, in one round trip."""
    skipped = {}
    for (t, c, row, _owner, action) in moves:
        if action == "skip" and (t, c) not in md.FROZEN:
            skipped.setdefault(t, (fks[(t, c)], set()))[1].add(row)
    branches, params = [], {}
    for i, (t, (pk, rows)) in enumerate(sorted(skipped.items())):
        params[f"p{i}"] = sorted(rows)
        for rt, rc in refs.get(t, ()):
            branches.append(sql.SQL(
                "SELECT {t}::text AS t, {ref}::text AS ref, {rc}::text AS id, count(*) AS n FROM {rt} "
                "WHERE {rc} = ANY(%({p})s::{ty}[]) GROUP BY 3").format(
                    t=sql.Literal(t), ref=sql.Literal(f"{rt}.{rc}"), rc=sql.Identifier(rc), rt=ident(rt),
                    p=sql.SQL(f"p{i}"), ty=sql.SQL(pk[1])))
    if not branches:
        return []
    with conn.cursor() as cur:
        cur.execute(sql.SQL(" UNION ALL ").join(branches), params)
        found = {}
        for r in cur.fetchall():
            found.setdefault((r["t"], r["id"]), {})[r["ref"]] = r["n"]
    return [(t, rid, counts) for (t, rid), counts in sorted(found.items())]


def fold_facts(conn, twins, fks, refs):
    """md.plan_folds' facts for md.find_twins' twins, in the caller's open snapshot and one round trip: for both rows
    of each pair, the columns they must agree on, the flag (md.FOLD) and the keys of the rows that would follow them;
    for the duplicate's row, the count of every other row depending on it (refs, from the catalog)."""
    if not twins:
        return {}
    by, cfgs = {}, {}
    for (t, c, row, _owner, into) in twins:
        by.setdefault((t, c), (set(), set()))[0].add(row)
        by[(t, c)][1].add(into)
    branches, params = [], {}
    for i, ((t, c), (dups, intos)) in enumerate(sorted(by.items())):
        cfg = cfgs[t] = md.FOLD[(t, c)]
        pk, ty = fks[(t, c)]
        rt, rc, kc = cfg["follow"]
        if (rt, rc) not in refs.get(t, ()):
            raise SystemExit(f"ABORT: {rt}.{rc} does not reference {t} on this database; the fold cannot follow it.")
        params[f"a{i}"], params[f"d{i}"] = sorted(dups | intos), sorted(dups)
        cols = list(cfg["same"]) + ([cfg["flag"]] if cfg["flag"] else [])
        branches.append(sql.SQL("SELECT 'row'::text AS kind, {tl}::text AS t, {pk}::text AS id, jsonb_build_object({o}) "
                                "AS v FROM {t} WHERE {pk} = ANY(%({a})s::{ty}[])").format(
            tl=sql.Literal(t), pk=sql.Identifier(pk), t=ident(t), ty=sql.SQL(ty), a=sql.SQL(f"a{i}"),
            o=sql.SQL(", ").join(x for col in cols for x in (sql.Literal(col), sql.Identifier(col)))))
        branches.append(sql.SQL("SELECT 'follow', {tl}, {rc}::text, jsonb_build_object('k', {kc}::text) FROM {rt} "
                                "WHERE {rc} = ANY(%({a})s::{ty}[])").format(
            tl=sql.Literal(t), rc=sql.Identifier(rc), kc=sql.Identifier(kc), rt=ident(rt), ty=sql.SQL(ty),
            a=sql.SQL(f"a{i}")))
        for rt2, rc2 in refs.get(t, ()):
            if (rt2, rc2) != (rt, rc):
                branches.append(sql.SQL("SELECT 'held', {tl}, {rc}::text, jsonb_build_object('ref', {ref}::text, 'n', "
                                        "count(*)) FROM {rt} WHERE {rc} = ANY(%({d})s::{ty}[]) GROUP BY {rc}").format(
                    tl=sql.Literal(t), rc=sql.Identifier(rc2), ref=sql.Literal(f"{rt2}.{rc2}"), rt=ident(rt2),
                    ty=sql.SQL(ty), d=sql.SQL(f"d{i}")))
        branches.append(sql.SQL("SELECT 'type', {tl}, NULL::text, jsonb_build_object('k', format_type(a.atttypid, "
                                "a.atttypmod)) FROM pg_attribute a WHERE a.attrelid = {rtl}::regclass AND a.attname = {kcl}")
                        .format(tl=sql.Literal(t), rtl=sql.Literal(rt), kcl=sql.Literal(kc)))
    with conn.cursor() as cur:
        cur.execute(sql.SQL(" UNION ALL ").join(branches), params)
        got = cur.fetchall()
    key_types = {r["t"]: r["v"]["k"] for r in got if r["kind"] == "type"}
    facts = {}
    for r in got:
        if r["kind"] == "row":
            cfg = cfgs[r["t"]]
            facts[(r["t"], r["id"])] = {"same": {col: r["v"].get(col) for col in cfg["same"]},
                                        "flag": r["v"].get(cfg["flag"]) if cfg["flag"] else None,
                                        "follow": [], "held": {}, "key_type": key_types.get(r["t"])}
    for r in got:
        f = facts.get((r["t"], r["id"]))
        if f is not None and r["kind"] == "follow":
            f["follow"].append(r["v"]["k"])
        elif f is not None and r["kind"] == "held":
            f["held"][r["v"]["ref"]] = r["v"]["n"]
    return facts


# ── plans ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def plan_pair(state, p, keys, run_id, now_iso, dependents=lambda moves: [], fold_facts=lambda twins: {}):
    """Everything one teacher's merge would do, from one snapshot. An empty 'problems' means it may run.
    dependents(moves): the stranded rows of the plan; fold_facts(twins): md.plan_folds' facts; both read in the same
    snapshot."""
    pids = [p["survivor"]] + p["retired"]
    rows = {i: state["users"].get(i) for i in pids}
    if any(v is None for v in rows.values()):
        return {**p, "problems": ["an account was not found"]}
    surv = md.choose_survivor([{"id": i, "identity_rows": state["ident"].get(i, 0)} for i in pids], p["in_use"])
    retired = [i for i in pids if i != surv]
    owned = {k: [r for r in v if r["owner"] in pids] for k, v in state["owned"].items()}
    moves = md.plan_moves({k: v for k, v in owned.items() if v}, surv, retired, keys)
    twins = md.find_twins(owned, moves, surv, keys)
    folds, fold_problems = md.plan_folds(twins, fold_facts(twins) if twins else {})
    moves = md.fold_moves(moves, folds)
    patch = md.survivor_patch(rows[surv], [rows[r] for r in retired], p["in_use"])
    taken, gives_up, conflicts = md.unique_takeover(rows[surv], [rows[r] for r in retired])
    patch.update(taken)
    final_phone = patch.get("phone_number", rows[surv]["phone_number"])
    numbers = md.phone_moves(rows[surv]["phone_number"], final_phone, [rows[r]["phone_number"] for r in retired])
    visits, clashes = md.plan_visits(state["visits"], numbers)
    problems = md.guards(rows, surv, retired, p["in_use"], p["survivor"], moves, clashes, dependents(moves),
                         conflicts, fold_problems)
    # The number kept must be the one the teacher messages from now, or its freed twin comes back as a new account.
    override = p.get("keep_number_override")
    problems += md.kept_number_problem(rows, p["in_use"], override)
    overridden = bool(override) and bool(md.kept_number_problem(rows, p["in_use"]))
    moved, skipped, folded = {r: {} for r in retired}, {r: {} for r in retired}, {r: {} for r in retired}
    for (t, _c, _row, owner, action) in moves:
        bucket = {"move": moved, "skip": skipped, "fold": folded}[action]
        bucket[owner][t] = bucket[owner].get(t, 0) + 1
    meta = {"run_id": run_id, "review": REVIEW, "sheet_row": p["pair"]}
    audits = md.audit_rows(dict(rows[surv], **patch), rows[surv]["phone_number"], [rows[r] for r in retired],
                           moved, skipped, meta=meta, folded=folded)
    # Earlier merges' retired accounts this merge would leave credited to nobody (a re-merge): re-pointed to the survivor.
    latest, deleted = state["retired_rows"]
    repointed, repoint_problems = md.repoints(latest, deleted, {i: rows[i]["phone_number"] for i in pids},
                                              final_phone)
    problems += repoint_problems
    # As the analytics join: no live account outside this merge may hold the kept number in another format.
    problems += md.shared_number_problem(state["number_holders"].get(md.number_key(final_phone), []), pids)
    audits += md.repoint_rows(dict(rows[surv], **patch), repointed, meta=meta)
    label = {f: "survivor's old number" if f == rows[surv]["phone_number"] else "a freed number" for f, _ in numbers}
    return {**p, "survivor": surv, "retired": retired, "problems": problems, "kept_number_overridden": overridden,
            "patch": patch,
            "final_phone": final_phone, "moves": moves, "moved": moved, "skipped": skipped, "folded": folded,
            "folds": folds, "visits": [{"row_id": v, "from_phone": f, "to_phone": t} for v, f, t in visits],
            "retire": {r: md.retire_patch(r, now_iso, gives_up.get(r, ())) for r in retired}, "audits": audits,
            "repoints": [{"retired": r["retired"], "supersedes": r["supersedes"]} for r in repointed],
            "before": {i: rows[i] for i in pids},
            "plan_rows": md.plan_rows(p["pair"], surv, patch, retired, moves, [(v, label[f]) for v, f, _ in visits],
                                      gives_up, folds, repointed)}


def _set_users(cols, extra=""):
    sets = sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(c)) for c in cols)
    return sql.SQL("UPDATE users SET {} WHERE id = %s " + extra).format(sets)


def _move_steps(pair, groups, fks, to_of, guard_of, label):
    """One UPDATE per group and chunk of at most CHUNK rows: by primary key, and only while the row is still owned by
    the expected account. groups: {(table, column, ...): [row ids]}."""
    steps = []
    for key, rows in sorted(groups.items()):
        t, c = key[0], key[1]
        pk_name, pk_type = fks[(t, c)]
        q = sql.SQL("UPDATE {t} SET {c} = %s WHERE {pk} = ANY(%s::{ty}[]) AND {c} = ANY(%s::uuid[])").format(
            t=ident(t), c=sql.Identifier(c), pk=sql.Identifier(pk_name), ty=sql.SQL(pk_type))
        for i in range(0, len(rows), CHUNK):
            chunk = rows[i:i + CHUNK]
            steps.append((q, [to_of(key), chunk, guard_of(key)], len(chunk), f"{pair}: {label} {t}.{c}"))
    return steps


def _locks(pair, folds):
    """The roster lock of each class a fold touches, smaller id first as roster_change_class_details locks two."""
    return [(ROSTER_LOCK, [c], None, f"{pair}: roster lock on class {c}") for c in sorted({f["lock"] for f in folds
                                                                                          if f.get("lock")})]


def _key_match(f, ph="%s"):
    """The follow keys matched in their own type ('<key> = ANY(<ph>::<type>[])'), so the key's index serves; as text
    when the type is unknown."""
    kc, kt = sql.Identifier(f["follow"][2]), f.get("key_type")
    if kt:
        return sql.SQL("{kc} = ANY(" + ph + "::{kt}[])").format(kc=kc, kt=sql.SQL(kt))
    return sql.SQL("{kc}::text = ANY(" + ph + "::text[])").format(kc=kc)


def _follow_steps(pair, f, to, frm, label):
    rt, rc, _kc = f["follow"]
    q = sql.SQL("UPDATE {rt} SET {rc} = %s WHERE {rc} = %s AND {m}").format(
        rt=ident(rt), rc=sql.Identifier(rc), m=_key_match(f))
    return [(q, [to, frm, f["keys"][i:i + CHUNK]], len(f["keys"][i:i + CHUNK]), f"{pair}: {rt} {label} {f['table']}")
            for i in range(0, len(f["keys"]), CHUNK)]


def fold_steps(pp, fks):
    """Each fold, before any row moves (md.FOLD, the app's roster_hand_over_class): the class's roster lock; what
    depends on the duplicate's row follows its twin; the row retires the app's way, its flag cleared first so the twin
    can take the flag under the one-class-teacher index; the twin takes it; a list's counts from truth."""
    pair, folds = pp["pair"], pp.get("folds", [])
    steps = _locks(pair, folds)
    for f in folds:
        t, d, s = f["table"], f["row"], f["into"]
        pk = sql.Identifier(fks[(t, f["column"])][0])
        steps += _follow_steps(pair, f, s, d, "follows the fold of")
        sets = sql.SQL(", ").join(sql.SQL("{} = " + v).format(sql.Identifier(col)) for col, v in FOLD_RETIRE[t].items())
        steps.append((sql.SQL("UPDATE {t} SET {sets}, updated_at = now() WHERE {pk} = %s AND is_active").format(
            t=ident(t), sets=sets, pk=pk), [d], 1, f"{pair}: retire {t} {d}"))
        if f["flag"]:
            steps.append((sql.SQL("UPDATE {t} SET {fl} = true, updated_at = now() WHERE {pk} = %s AND is_active "
                                  "AND NOT {fl}").format(t=ident(t), fl=sql.Identifier(f["flag"]), pk=pk),
                          [s], 1, f"{pair}: {t} {s} takes {f['flag']}"))
        if t in FOLD_RECOUNT:
            steps.append((FOLD_RECOUNT[t], [[s, d]], 2, f"{pair}: {t} counts from truth"))
    return steps


def unfold_steps(e, fks):
    """Each fold undone once its row is back on the retired account (the generic move back): the twin gives back the
    flag it took, the row takes back the columns it retired with (from the before-image's full rows), what followed
    returns, a list's counts from truth."""
    pair, folds = e["pair"], e.get("folds", [])
    before = {(r["table"], r["id"]): r["row"] for r in e.get("rows_before", [])}
    steps = []
    for f in reversed(folds):
        t, d, s = f["table"], f["row"], f["into"]
        pk = sql.Identifier(fks[(t, f["column"])][0])
        b = before.get((t, d))
        if b is None:
            raise SystemExit(f"ABORT: {pair}: the before-image has no full row of {t} {d}; its fold cannot be undone.")
        if f["flag"]:
            steps.append((sql.SQL("UPDATE {t} SET {fl} = false, updated_at = now() WHERE {pk} = %s AND {fl}").format(
                t=ident(t), fl=sql.Identifier(f["flag"]), pk=pk), [s], 1, f"{pair}: {t} {s} gives back {f['flag']}"))
        cols = list(FOLD_RETIRE[t])
        steps.append((sql.SQL("UPDATE {t} SET {sets}, updated_at = now() WHERE {pk} = %s AND is_active IS NOT TRUE")
                      .format(t=ident(t), pk=pk, sets=sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(c))
                                                                          for c in cols)),
                      [b.get(c) for c in cols] + [d], 1, f"{pair}: {t} {d} as it was"))
        steps += _follow_steps(pair, f, d, s, "back to the folded")
        if t in FOLD_RECOUNT:
            steps.append((FOLD_RECOUNT[t], [[s, d]], 2, f"{pair}: {t} counts from truth"))
    return steps


def merge_steps(pp, fks):
    """Folds first (a folded row must retire before it can move), then the rows (so the users rows are locked last,
    and briefly), then visits, retire, survivor, audit."""
    pair, surv, retired = pp["pair"], pp["survivor"], pp["retired"]
    groups = {}
    for (t, c, row, _owner, action) in pp["moves"]:
        if action in ("move", "fold"):
            groups.setdefault((t, c), []).append(row)
    steps = fold_steps(pp, fks) + _move_steps(pair, groups, fks, lambda k: surv, lambda k: retired, "move")
    by_number = {}
    for v in pp.get("visits", []):
        by_number.setdefault((v["from_phone"], v["to_phone"]), []).append(v["row_id"])
    for (f, to), rows in by_number.items():
        steps.append(("UPDATE observation_schedules SET teacher_ext_id = %s WHERE id = ANY(%s::uuid[]) "
                      "AND teacher_ext_id = %s", [to, rows, f], len(rows), f"{pair}: booked visits follow the number"))
    for r, rp in pp.get("retire", {}).items():
        steps.append((_set_users(rp, "AND deleted_at IS NULL"), list(rp.values()) + [r], 1, f"{pair}: retire {r}"))
    if pp.get("patch"):
        steps.append((_set_users(pp["patch"], "AND deleted_at IS NULL"),
                      [db_value(c, v) for c, v in pp["patch"].items()] + [surv], 1,
                      f"{pair}: the survivor takes {', '.join(sorted(pp['patch']))}"))
    return steps + audit_steps(pair, pp.get("audits", []))


def audit_steps(pair, audits):
    """One INSERT per audit row (a merge's own, and a re-point's), each asserting it wrote one row."""
    return [("INSERT INTO leader_roster_audit (action, actor_user_id, affected_leader_user_id, teacher_ext_id, "
             "teacher_phone_e164, teacher_name, detail) VALUES (%s, %s, %s, %s, %s, %s, %s)",
             [a["action"], a["actor_user_id"], a["affected_leader_user_id"], a["teacher_ext_id"],
              a["teacher_phone_e164"], a["teacher_name"], psycopg2.extras.Json(a["detail"])], 1,
             f"{pair}: {'re-point' if a['detail'].get('case') == md.REPOINT else 'audit'} row for "
             f"{a['detail']['retired_user_id']}") for a in audits]


def residue(cur, pp):
    """Problems where a table the plan touched keeps another number of rows on the retired accounts than planned
    (one round trip: it runs while the users rows are locked)."""
    left = {}
    for (t, c, _row, _owner, action) in pp["moves"]:
        left[(t, c)] = left.get((t, c), 0) + (action == "skip")
    if not left:
        return []
    cur.execute(sql.SQL(" UNION ALL ").join(
        sql.SQL("SELECT {tl}::text AS t, {cl}::text AS c, count(*) AS n FROM {t} WHERE {c} = ANY(%(ids)s::uuid[])")
        .format(tl=sql.Literal(t), cl=sql.Literal(c), t=ident(t), c=sql.Identifier(c)) for (t, c) in sorted(left)),
        {"ids": pp["retired"]})
    return [f"{pp['pair']}: {r['t']}.{r['c']} keeps {r['n']} rows on the retired account(s), "
            f"{left[(r['t'], r['c'])]} planned" for r in cur.fetchall() if r["n"] != left[(r["t"], r["c"])]]


def fold_state(cur, pair, folds, fks, survivor, undone=False):
    """Problems where the folds are not as the merge left them (undone=True: as the restore left them), in one round
    trip: the duplicate's row retired and on the survivor (back and live on its own account), the flag the twin took
    (given back), what followed on the twin and nothing left on the duplicate's row (all back), a list's counts true."""
    parts, params, want = [], [], {}

    def add(label, frm, args, n):
        parts.append(sql.SQL("SELECT {l}::text AS c, count(*) AS n FROM ").format(l=sql.Literal(label)) + frm)
        params.extend(args)
        want[label] = n
    for f in folds:
        t, d, s, keys = f["table"], f["row"], f["into"], f["keys"]
        pk, ty = fks[(t, f["column"])]
        rt, rc, _kc = f["follow"]
        tt, idx, ty_ = ident(t), sql.Identifier(pk), sql.SQL(ty)
        add(f"{t} {d} {'live on its own account' if undone else 'retired and on the survivor'}",
            sql.SQL("{t} WHERE {pk} = %s::{ty} AND {c} = %s::uuid AND is_active IS {a}").format(
                t=tt, pk=idx, ty=ty_, c=sql.Identifier(f["column"]), a=sql.SQL("TRUE" if undone else "NOT TRUE")),
            [d, f["owner"] if undone else survivor], 1)
        if f["flag"]:
            add(f"{t} {s} holding {f['flag']}", sql.SQL("{t} WHERE {pk} = %s::{ty} AND {fl}").format(
                t=tt, pk=idx, ty=ty_, fl=sql.Identifier(f["flag"])), [s], 0 if undone else 1)
        on, off = (d, s) if undone else (s, d)
        fol = sql.SQL("{rt} WHERE {rc} = %s::{ty} AND {m}").format(
            rt=ident(rt), rc=sql.Identifier(rc), ty=ty_, m=_key_match(f))
        add(f"{rt} followers of {t} {d} where planned", fol, [on, keys], len(keys))
        if undone:
            add(f"{rt} followers of {t} {d} still on {s}", fol, [off, keys], 0)
        else:
            add(f"{rt} left on {t} {d}", sql.SQL("{rt} WHERE {rc} = %s::{ty}").format(
                rt=ident(rt), rc=sql.Identifier(rc), ty=ty_), [d], 0)
        if t in FOLD_COUNTS_OFF:
            add(f"{t} {s}/{d} counts off", sql.SQL(FOLD_COUNTS_OFF[t]), [[s, d]], 0)
    if not parts:
        return []
    cur.execute(sql.SQL(" UNION ALL ").join(parts), params)
    return [f"{pair}: {r['c']}: {r['n']}, planned {want[r['c']]}" for r in cur.fetchall() if r["n"] != want[r["c"]]]


def fold_stragglers(conn, e, fks):
    """Rows that reached a folded row after its merge (a roster save racing the commit), left for a human."""
    parts, params = [], []
    for f in e.get("folds", []):
        rt, rc, _kc = f["follow"]
        parts.append(sql.SQL("SELECT {l}::text AS c, count(*) AS n FROM {rt} WHERE {rc} = %s::{ty}").format(
            l=sql.Literal(f"{rt} on the folded {f['table']} {f['row']}"), rt=ident(rt), rc=sql.Identifier(rc),
            ty=sql.SQL(fks[(f["table"], f["column"])][1])))
        params.append(f["row"])
    if not parts:
        return []
    with conn.cursor() as cur:
        cur.execute(sql.SQL(" UNION ALL ").join(parts), params)
        return [f"{r['n']} {r['c']} since the merge; left for a human" for r in cur.fetchall() if r["n"]]


def merge_verify(conn, pp, run_id, fks):
    def check():
        pair, problems = pp["pair"], []
        with conn.cursor() as cur:
            now = load_users(cur, [pp["survivor"]] + pp["retired"])
            s = now[pp["survivor"]]
            if s["deleted_at"] or s["phone_number"] != pp["final_phone"]:
                problems.append(f"{pair}: the survivor is not live on the planned number")
            off = sorted(c for c, v in pp["patch"].items() if not md.same_value(s.get(c), v))
            if off:
                problems.append(f"{pair}: survivor columns not as planned: {', '.join(off)}")
            for r in pp["retired"]:
                if [c for c, v in pp["retire"][r].items() if not md.same_value(now[r].get(c), v)]:
                    problems.append(f"{pair}: {r} is not retired as planned")
            problems += residue(cur, pp)
            if pp["visits"]:
                cur.execute("SELECT count(*) AS n FROM observation_schedules WHERE id = ANY(%s::uuid[]) "
                            "AND teacher_ext_id = (SELECT phone_number FROM users WHERE id = %s)",
                            ([v["row_id"] for v in pp["visits"]], pp["survivor"]))
                if cur.fetchone()["n"] != len(pp["visits"]):
                    problems.append(f"{pair}: booked visits did not follow the number")
            cur.execute(AUDIT_COUNT, (run_id, pp["retired"]))
            if cur.fetchone()["n"] != len(pp["retired"]):
                problems.append(f"{pair}: the audit rows are not as planned")
            problems += fold_state(cur, pair, pp.get("folds", []), fks, pp["survivor"])
            # As the analytics will read it: every account this merge retired or re-pointed is the survivor's.
            problems += governed_problems(cur, pair, {r: pp["survivor"] for r in
                                                      pp["retired"] + [x["retired"] for x in pp.get("repoints", [])]})
        return problems
    return check


def merged_state(cur, e, run_id):
    """'merged' when the live rows show this run's merge of the pair, 'untouched' when they show none of it, else
    'partial' (left for a human)."""
    now = load_users(cur, [e["survivor"]] + e["retired"])
    cur.execute(AUDIT_COUNT, (run_id, e["retired"]))
    audits = cur.fetchone()["n"]
    mine = [r for r in e["retired"] if now.get(r) and now[r]["deleted_reason"] == md.REASON
            and now[r]["phone_number"] == f"merged:{r}"]
    s = now.get(e["survivor"])
    if s and s["phone_number"] == e["final_phone"] and len(mine) == len(e["retired"]) and audits == len(mine):
        return "merged"
    return "untouched" if not mine and not audits else "partial"


def restore_steps(e, run_id, fks, live):
    """(steps, back, changed): the merge undone in the order that keeps phone_number unique (the survivor gives the
    number back first). live: the accounts as they are now. The survivor gets back only the columns that still hold
    what the merge wrote (back); a column edited since (a password reset, a corrected name) is left and reported."""
    pair, surv, back, changed = e["pair"], e["survivor"], [], []
    steps = _locks(pair, e.get("folds", []))
    if e["kind"] == "merge":
        back, changed = md.restorable(live[surv], e["patch"])
        if back:
            steps.append((_set_users(back), [db_value(c, e["before"][surv].get(c)) for c in back] + [surv], 1,
                          f"{pair}: the survivor as it was"))
        for r in e["retired"]:
            b = e["before"][r]
            cols = sorted(e.get("retire", {}).get(r) or ("deleted_at", "deleted_reason", "deleted_by", "phone_number"))
            steps.append((_set_users(cols, "AND deleted_reason = %s"), [db_value(c, b.get(c)) for c in cols]
                          + [r, md.REASON], 1, f"{pair}: {r} as it was"))
        by_number = {}
        for v in e["visits"]:
            by_number.setdefault((v["from_phone"], v["to_phone"]), []).append(v["row_id"])
        for (f, to), rows in by_number.items():
            steps.append(("UPDATE observation_schedules SET teacher_ext_id = %s WHERE id = ANY(%s::uuid[]) "
                          "AND teacher_ext_id = %s", [f, rows, to], len(rows), f"{pair}: booked visits back"))
    groups = {}
    for (t, c, row, owner, action) in e["moves"]:
        if action in ("move", "fold"):
            groups.setdefault((t, c, owner), []).append(row)
    steps += _move_steps(pair, groups, fks, lambda k: k[2], lambda k: [surv], "back")
    steps += unfold_steps(e, fks)
    if e["kind"] == "merge":
        steps += md.audit_removal(pair, run_id, e["retired"], [r["retired"] for r in e.get("repoints", [])])
    return steps, back, changed


def restore_verify(conn, e, run_id, back, fks):
    def check():
        problems = []
        if e["kind"] != "merge":
            return problems
        with conn.cursor() as cur:
            now = load_users(cur, list(e["before"]))
            for i, b in e["before"].items():
                cols = back if i == e["survivor"] else sorted(e.get("retire", {}).get(i) or ("phone_number", "deleted_at"))
                off = [c for c in cols if not md.same_value(now[i].get(c), b.get(c))]
                if off:
                    problems.append(f"{e['pair']}: {i} is not as it was: {', '.join(off)}")
            cur.execute(AUDIT_COUNT, (run_id, e["retired"]))
            if cur.fetchone()["n"]:
                problems.append(f"{e['pair']}: this run's audit rows remain")
            if e.get("repoints"):
                cur.execute(REPOINT_COUNT, (run_id, [r["retired"] for r in e["repoints"]]))
                if cur.fetchone()["n"]:
                    problems.append(f"{e['pair']}: this run's re-point rows remain")
            problems += fold_state(cur, e["pair"], e.get("folds", []), fks, e["survivor"], undone=True)
        return problems
    return check


# ── files ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def write_private(path, payload):
    """A before-image: phone numbers and portal hashes, so mode 0600 in a 0700 folder, replaced atomically."""
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(payload, f, indent=1, default=jsonable)
    os.replace(tmp, path)
    side = path.with_name(path.name + ".sha256")
    fd = os.open(side, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n")


def set_entry(image, pp, status, kind="merge"):
    entry = {"pair": pp["pair"], "kind": kind, "status": status, "survivor": pp["survivor"],
             "retired": pp["retired"], "patch": pp.get("patch", {}), "final_phone": pp.get("final_phone"),
             "before": pp.get("before", {}), "visits": pp.get("visits", []), "moves": pp.get("moves", []),
             "retire": pp.get("retire", {}), "folds": pp.get("folds", []), "rows_before": pp.get("rows_before", []),
             "repoints": pp.get("repoints", [])}
    image["pairs"] = [e for e in image["pairs"] if e["pair"] != pp["pair"]] + [entry]
    return entry


def load_image(path, target, kind):
    image = json.loads(Path(path).read_text())
    if image.get("target") != target:
        raise SystemExit(f"ABORT: the before-image is for {image.get('target')}, not {target}.")
    if kind and image.get("kind") != kind:
        raise SystemExit(f"ABORT: the before-image is a {image.get('kind')}, not a {kind}.")
    for e in image["pairs"]:
        e.setdefault("kind", image.get("kind", "merge"))
    return image


def table_counts(moves, action):
    out = {}
    for m in moves:
        if m[4] == action:
            out[m[0]] = out.get(m[0], 0) + 1
    return out


def show(counts):
    return ", ".join(f"{t} {n}" for t, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))) or "-"


def follow_counts(folds):
    out = {}
    for f in folds:
        if f["keys"]:
            out[f["follow"][0]] = out.get(f["follow"][0], 0) + len(f["keys"])
    return out


def show_folds(folds):
    """'class_teachers 1, student_lists 1 (follow: students 29; flag: is_class_teacher)' or '-'."""
    if not folds:
        return "-"
    flags = sorted({f["flag"] for f in folds if f["flag"]})
    extra = [f"follow: {show(follow_counts(folds))}"] + ([f"flag: {', '.join(flags)}"] if flags else [])
    return f"{show(table_counts([(f['table'], 0, 0, 0, 'fold') for f in folds], 'fold'))} ({'; '.join(extra)})"


def apply(conn, steps, verify):
    """md.apply_plan, with any database error masked before it is printed."""
    try:
        return md.apply_plan(conn, steps, verify)
    except SystemExit as e:
        raise SystemExit(masked(e)) from None


# ── modes ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def load_scope(a):
    pairs = []
    with open(a.scope, newline="") as f:
        for r in csv.DictReader(f):
            if r["go"] == a.go:
                pairs.append({"pair": f"t{r['tab']} #{r['sheet_no']}", "class": r.get("class", ""),
                              "survivor": r["survivor_id"], "retired": [x for x in r["retire_ids"].split(";") if x],
                              "in_use": r["number_in_use_account_id"],
                              "keep_number_override": (r.get("keep_number_override") or "").strip()})
    if a.only:
        wanted = {x.strip() for x in a.only.split(",") if x.strip()}
        unknown = wanted - {p["pair"] for p in pairs}
        if unknown:
            raise SystemExit(f"ABORT: --only names teachers who are not in go {a.go}: {sorted(unknown)}")
        pairs = [p for p in pairs if p["pair"] in wanted]
    if not pairs:
        raise SystemExit(f"ABORT: no teachers for go {a.go!r} in the scope.")
    seen = {}
    for p in pairs:
        for i in [p["survivor"]] + p["retired"]:
            if i in seen:
                raise SystemExit(f"ABORT: account {i} is in both {seen[i]} and {p['pair']}.")
            seen[i] = p["pair"]
    return pairs


def run_merge(a, conn, out, stamp, fks, keys, refs):
    pairs = load_scope(a)
    expected = None
    if a.expect_csv:
        with open(a.expect_csv, newline="") as f:
            expected = {tuple(r) for r in list(csv.reader(f))[1:]}
    run_id = f"merge-duplicates-{a.target}-{a.go}-{uuid.uuid4().hex[:8]}"
    base = f"{a.target}-{a.go}-{stamp}-{'commit' if a.commit else 'dryrun'}"
    with conn.cursor() as cur:
        state = read_state(cur, sorted({i for p in pairs for i in [p["survivor"]] + p["retired"]}), fks, keys)
    dependents = lambda mv: stranded_rows(conn, mv, fks, refs)  # noqa: E731 - same snapshot as the read
    facts = lambda tw: fold_facts(conn, tw, fks, refs)  # noqa: E731 - same snapshot as the read
    planned = [plan_pair(state, p, keys, run_id, datetime.now(timezone.utc).isoformat(), dependents, facts)
               for p in pairs]
    conn.rollback()
    by_retired = {}
    for pp in planned:
        for r in pp.get("repoints", []):
            by_retired.setdefault(r["retired"], []).append(pp)
    for rid, pps in by_retired.items():
        if len(pps) > 1:
            for pp in pps:
                pp["problems"].append(f"{rid} would be re-pointed by {' and '.join(x['pair'] for x in pps)}")

    plan_rows = set().union(*(pp.get("plan_rows", set()) for pp in planned))
    with open(out / f"merge-plan-{base}.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["pair", "step", "table", "column", "row", "from", "to"])
        w.writerows(sorted(plan_rows))
    summary = {"run_id": run_id, "target": a.target, "go": a.go, "dry_run": not a.commit, "written_at": stamp,
               "teachers": len(planned), "pairs": [
                   {"pair": pp["pair"], "class": pp.get("class"), "survivor": pp.get("survivor"),
                    "retired": pp.get("retired"), "takes_the_number": "phone_number" in pp.get("patch", {}),
                    "survivor_columns": sorted(pp.get("patch", {})), "moved": pp.get("moved"),
                    "stays_behind": pp.get("skipped"), "folded": pp.get("folded"),
                    "folds": [{"table": f["table"], "row": f["row"], "into": f["into"], "flag": f["flag"],
                               "follow": {f["follow"][0]: len(f["keys"])}} for f in pp.get("folds", [])],
                    "visits_follow": len(pp.get("visits", [])), "repoints": pp.get("repoints", []),
                    "keep_number_override": pp.get("keep_number_override") if pp.get("kept_number_overridden") else None,
                    "problems": pp["problems"]} for pp in planned]}
    (out / f"merge-summary-{base}.json").write_text(json.dumps(summary, indent=2))
    image_path = Path(a.private_dir) / a.target / f"merge-before-{base}.json"
    image = {"run_id": run_id, "target": a.target, "go": a.go, "kind": "merge", "pairs": []}
    for pp in planned:
        if "patch" in pp:
            set_entry(image, pp, "planned")
    write_private(image_path, image)

    moves = [m for pp in planned for m in pp.get("moves", [])]
    print(f"[{a.target}] go {a.go}: teachers={len(planned)} "
          f"retire={sum(len(pp.get('retired', [])) for pp in planned)} "
          f"rows_to_move={sum(table_counts(moves, 'move').values())} "
          f"rows_staying={sum(table_counts(moves, 'skip').values())} run_id={run_id}")
    for pp in planned:
        print(f"  {pp['pair']:8s} {pp.get('class', ''):14s} takes the number: "
              f"{'yes' if 'phone_number' in pp.get('patch', {}) else 'no ':3s}  columns: {len(pp.get('patch', {})):2d}  "
              f"visits: {len(pp.get('visits', []))}  moves: {show(table_counts(pp.get('moves', []), 'move'))}  "
              f"stays: {show(table_counts(pp.get('moves', []), 'skip'))}"
              + (f"  folds: {show_folds(pp['folds'])}" if pp.get("folds") else "")
              + (f"  re-points: {', '.join(r['retired'][:8] for r in pp['repoints'])}" if pp.get("repoints") else "")
              + ("  KEPT NUMBER OVERRIDDEN (keep_number_override; see the summary)"
                 if pp.get("kept_number_overridden") else "")
              + (f"  REFUSED: {'; '.join(pp['problems'])}" if pp["problems"] else ""))
    print(f"  outputs: {out / f'merge-plan-{base}.csv'} (+ summary JSON); before-image: {image_path} (private)")
    if any(pp["problems"] for pp in planned):
        raise SystemExit("ABORT: a guard refused at least one teacher; nothing written.")
    if expected is not None:
        if {r[0] for r in expected} != {pp["pair"] for pp in planned}:
            raise SystemExit("ABORT: the reviewed plan covers other teachers than this run; nothing written.")
        ok, missing, extra, drift = md.check_plan_matches(expected, plan_rows)
        for k, (was, now) in drift.items():
            print(f"  since the review: {k[0]} {k[1]} {k[2]}.{k[3]}: {was} -> {now}")
        if not ok:
            raise SystemExit(f"ABORT: the decisions differ from the reviewed dry run ({len(missing)} reviewed no "
                             f"longer planned, {len(extra)} planned never reviewed); nothing written. Run a fresh "
                             "dry run, review it, retry with it.")
        print(f"the decisions match the reviewed dry run ({len(expected)} rows reviewed)")
    if not a.commit:
        print("DRY RUN — nothing written.")
        return

    reviewed_rows = expected if expected is not None else plan_rows
    results, stopped = [], None
    for p in pairs:
        reviewed = {r for r in reviewed_rows if r[0] == p["pair"]}
        outcome = None
        for attempt in range(1, ATTEMPTS + 1):
            conn.rollback()
            with conn.cursor() as cur:
                state = read_state(cur, [p["survivor"]] + p["retired"], fks, keys)
            pp = plan_pair(state, p, keys, run_id, datetime.now(timezone.utc).isoformat(), dependents, facts)
            if pp["problems"]:
                outcome = {"pair": p["pair"], "status": "refused", "why": pp["problems"]}
                break
            ok, missing, extra, drift = md.check_plan_matches(reviewed, pp["plan_rows"])
            if not ok:
                outcome = {"pair": p["pair"], "status": "refused",
                           "why": [f"decisions changed since the review: {len(missing)} gone, {len(extra)} new"]}
                break
            pp["rows_before"] = full_rows(conn, pp, fks)
            set_entry(image, pp, "writing")
            write_private(image_path, image)
            try:
                n = apply(conn, merge_steps(pp, fks), merge_verify(conn, pp, run_id, fks))
            except SystemExit as e:
                retry = attempt < ATTEMPTS and any(s in str(e) for s in RETRYABLE)
                set_entry(image, pp, "retrying" if retry else "rolled back")
                write_private(image_path, image)
                print(f"  {p['pair']}: attempt {attempt} rolled back: {e}")
                if retry:
                    time.sleep(2 * attempt)
                    continue
                outcome = {"pair": p["pair"], "status": "rolled back", "why": [str(e)]}
                break
            set_entry(image, pp, "committed")
            write_private(image_path, image)
            outcome = {"pair": p["pair"], "status": "committed", "attempts": attempt, "steps": n,
                       "since_review": {" ".join(k[1:]): v for k, v in drift.items()}}
            print(f"  {p['pair']}: COMMITTED ({n} steps, attempt {attempt})")
            break
        results.append(outcome)
        if outcome["status"] == "refused":
            conn.rollback()
            print(f"  {p['pair']}: REFUSED, nothing written for this teacher — {'; '.join(outcome['why'])}")
        elif outcome["status"] == "rolled back":
            conn.rollback()
            stopped = outcome
            print(f"  {p['pair']}: STOPPED — {'; '.join(outcome['why'])}")
            break
    done = [r["pair"] for r in results if r["status"] == "committed"]
    (out / f"merge-commit-{base}.json").write_text(json.dumps(
        {"run_id": run_id, "target": a.target, "go": a.go, "committed": done, "results": results,
         "before_image": str(image_path),
         "before_image_sha256": hashlib.sha256(image_path.read_bytes()).hexdigest()}, indent=2))
    print(f"committed {len(done)} of {len(pairs)} teachers (run_id {run_id}).")
    print("rows that reached a retired account during the run (each should be '-'):")
    sweep(conn, image, fks, keys, refs, commit=False, out=None, private_dir=None, stamp=stamp)
    print(f"undo: --restore {image_path} · stragglers later: --sweep {image_path}")
    if stopped:
        raise SystemExit("STOPPED on a failed write; the teachers committed before it stay committed.")
    if len(done) < len(pairs):
        raise SystemExit(f"{len(pairs) - len(done)} teacher(s) refused (nothing written for them); the rest committed.")


def sweep(conn, image, fks, keys, refs, commit, out, private_dir, stamp):
    """Move what reached a retired account after its merge. Its own before-image makes it restorable."""
    sweep_image = {"run_id": f"{image['run_id']}-sweep-{uuid.uuid4().hex[:6]}", "of": image["run_id"],
                   "target": image["target"], "kind": "sweep", "pairs": []}
    path = Path(private_dir) / image["target"] / f"merge-sweep-{stamp}.json" if commit else None
    results = []
    for e in image["pairs"]:
        if e.get("status") not in ("committed", "writing"):
            continue
        conn.rollback()
        with conn.cursor() as cur:
            ids = [e["survivor"]] + e["retired"]
            users = load_users(cur, ids)
            owned = owned_rows(cur, fks, keys, ids)
        moves = md.plan_moves(owned, e["survivor"], e["retired"], keys)
        problems = md.sweep_guards(users, e["survivor"], e["retired"], moves, stranded_rows(conn, moves, fks, refs))
        problems += fold_stragglers(conn, e, fks)
        todo = table_counts(moves, "move")
        results.append({"pair": e["pair"], "to_move": todo, "problems": problems})
        print(f"  {e['pair']:8s} to move: {show(todo)}" + (f"  REFUSED: {'; '.join(problems)}" if problems else ""))
        if problems or not todo or not commit:
            conn.rollback()
            continue
        pp = {"pair": e["pair"], "survivor": e["survivor"], "retired": e["retired"], "moves": moves}
        pp["rows_before"] = full_rows(conn, pp, fks)
        entry = set_entry(sweep_image, pp, "writing", kind="sweep")
        write_private(path, sweep_image)
        try:
            n = apply(conn, merge_steps(pp, fks), lambda: residue_check(conn, pp))
        except SystemExit as err:
            entry["status"] = "rolled back"
            write_private(path, sweep_image)
            results[-1]["problems"] = [str(err)]
            print(f"  {e['pair']}: sweep rolled back — {err}")
            continue
        entry["status"] = "committed"
        write_private(path, sweep_image)
        print(f"  {e['pair']}: swept ({n} steps)")
    if out is not None:
        (out / f"merge-sweep-{image['target']}-{stamp}{'-commit' if commit else '-dryrun'}.json").write_text(
            json.dumps({"of": image["run_id"], "sweep_run_id": sweep_image["run_id"], "results": results,
                        "before_image": str(path) if path else None}, indent=2))
    conn.rollback()
    return results


def residue_check(conn, pp):
    with conn.cursor() as cur:
        return residue(cur, pp)


def run_sweep(a, conn, out, stamp, fks, keys, refs):
    image = load_image(a.sweep, a.target, kind="merge")
    print(f"[{a.target}] sweep of {image['run_id']}{'' if a.commit else ' (dry run)'}:")
    sweep(conn, image, fks, keys, refs, commit=a.commit, out=out, private_dir=a.private_dir, stamp=stamp)
    if not a.commit:
        print("DRY RUN — nothing written.")


def repair_state(cur, only):
    """(plan, left, holders, accounts) for --repoint, from one snapshot: md.repair_plan over every retired account's
    latest edit_phone row, with the governed mapping as the database runs it. accounts: {id: users row (id,
    phone_number, name)} for the live accounts the plan credits. only: --only's ids or unique prefixes, or None."""
    latest, deleted = retired_accounts(cur)
    wanted = None
    if only:
        wanted = set()
        for x in (t.strip() for t in only.split(",") if t.strip()):
            hits = [r for r in latest if r == x or (len(x) >= 8 and r.startswith(x))]
            if len(hits) != 1:
                raise SystemExit(f"ABORT: --only {x!r} names {len(hits)} retired accounts; give one id each.")
            wanted.add(hits[0])
    holders = governed_holders(cur, sorted(latest))
    ids = sorted({md.current_account(latest, deleted, r) for r in latest} - {None})
    cur.execute("SELECT id::text AS id, phone_number, name FROM users WHERE id = ANY(%s::uuid[]) "
                "AND deleted_at IS NULL", (ids,))
    accounts = {r["id"]: dict(r) for r in cur.fetchall()}
    keys = number_holders(cur, [r["phone_number"] for r in accounts.values()])
    plan, left = md.repair_plan(latest, deleted, holders, {i: r["phone_number"] for i, r in accounts.items()}, keys,
                                only=wanted)
    return plan, left, holders, accounts


def repair_rows(plan):
    """The ids-only plan rows a --repoint commit is bound to: which account each retired account is re-pointed to."""
    return {("repoint", md.REPOINT, "leader_roster_audit", "", p["retired"], p["account"], "") for p in plan}


def run_repoint(a, conn, out, stamp):
    """Re-point every retired account the governed mapping does not credit to its teacher's current account (a re-merge
    before the tool re-pointed, a later row with no number, the app moving the survivor's number). One transaction."""
    run_id = f"repoint-{a.target}-{uuid.uuid4().hex[:8]}"
    base = f"{a.target}-{stamp}-{'commit' if a.commit else 'dryrun'}"
    with conn.cursor() as cur:
        plan, left, holders, _accounts = repair_state(cur, a.only)
    conn.rollback()
    rows = repair_rows(plan)
    with open(out / f"repoint-plan-{base}.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["pair", "step", "table", "column", "row", "from", "to"])
        w.writerows(sorted(rows))
    (out / f"repoint-summary-{base}.json").write_text(json.dumps(
        {"run_id": run_id, "target": a.target, "dry_run": not a.commit, "written_at": stamp,
         "repoints": [{"retired": p["retired"], "account": p["account"], "supersedes": p["supersedes"],
                       "why": p["why"], "credited_now_to": holders.get(p["retired"], [])} for p in plan],
         "left_for_a_human": [{"retired": r, "why": why} for r, why in left]}, indent=2))
    print(f"[{a.target}] re-point: {len(plan)} retired account(s) to re-point, {len(left)} left for a human "
          f"(run_id {run_id})")
    for p in plan:
        print(f"  {p['retired'][:8]} -> {p['account'][:8]}  ({p['why']}; credited now to: "
              f"{', '.join(h[:8] for h in holders.get(p['retired'], [])) or 'nobody'})")
    for r, why in left:
        print(f"  {r[:8]} LEFT FOR A HUMAN: {why}")
    print(f"  outputs: {out / f'repoint-plan-{base}.csv'} (+ summary JSON)")
    expected = None
    if a.expect_csv:
        with open(a.expect_csv, newline="") as f:
            expected = {tuple(r) for r in list(csv.reader(f))[1:]}
        if expected != rows:
            raise SystemExit(f"ABORT: the plan differs from the reviewed dry run ({len(expected - rows)} reviewed no "
                             f"longer planned, {len(rows - expected)} planned never reviewed); nothing written.")
        print(f"the plan matches the reviewed dry run ({len(expected)} rows reviewed)")
    if not a.commit:
        print("DRY RUN — nothing written.")
        return
    if not plan:
        print("nothing to re-point; nothing written.")
        return
    reviewed = expected if expected is not None else rows
    image_path = Path(a.private_dir) / a.target / f"repoint-before-{base}.json"
    image = {"run_id": run_id, "target": a.target, "kind": "repoint", "pairs": [], "status": "writing",
             "repoints": [{"retired": p["retired"], "account": p["account"], "supersedes": p["supersedes"]}
                          for p in plan]}
    write_private(image_path, image)
    outcome = None
    for attempt in range(1, ATTEMPTS + 1):
        conn.rollback()
        with conn.cursor() as cur:
            plan, _left, _holders, accounts = repair_state(cur, a.only)
        if repair_rows(plan) != reviewed:
            outcome = "refused: the plan changed since the review; nothing written"
            break
        audits = [row for p in plan for row in md.repoint_rows(accounts[p["account"]], [p], meta={"run_id": run_id})]
        ids = sorted({p["account"] for p in plan})
        steps = [("SELECT id FROM users WHERE id = ANY(%s::uuid[]) AND deleted_at IS NULL FOR SHARE", [ids], len(ids),
                  "repoint: hold the accounts' numbers for the run")] + audit_steps("repoint", audits)
        want = {p["retired"]: p["account"] for p in plan}

        def verify():
            with conn.cursor() as cur:
                cur.execute(REPOINT_COUNT, (run_id, sorted(want)))
                n = cur.fetchone()["n"]
                return ([] if n == len(want) else [f"{n} re-point rows written, {len(want)} planned"]) + \
                    governed_problems(cur, "repoint", want)
        try:
            n = apply(conn, steps, verify)
        except SystemExit as e:
            if attempt < ATTEMPTS and any(s in str(e) for s in RETRYABLE):
                print(f"  attempt {attempt} rolled back: {e}")
                time.sleep(2 * attempt)
                continue
            outcome = f"rolled back: {e}"
            break
        outcome = f"committed ({n} steps, attempt {attempt})"
        break
    image["status"] = "committed" if outcome.startswith("committed") else outcome
    write_private(image_path, image)
    (out / f"repoint-commit-{base}.json").write_text(json.dumps(
        {"run_id": run_id, "target": a.target, "outcome": outcome, "repoints": image["repoints"],
         "before_image": str(image_path), "before_image_sha256": hashlib.sha256(image_path.read_bytes()).hexdigest()},
        indent=2))
    print(f"re-point {outcome} (run_id {run_id}). undo: --restore {image_path}")
    if not outcome.startswith("committed"):
        raise SystemExit("ABORT: nothing was re-pointed.")


def restore_repoint(a, conn, out, stamp, image):
    """Undo a --repoint run: remove its rows, so each account's earlier latest row is the latest again."""
    run_id, ids = image["run_id"], [r["retired"] for r in image["repoints"]]
    conn.rollback()
    with conn.cursor() as cur:
        cur.execute(REPOINT_COUNT, (run_id, ids))
        n = cur.fetchone()["n"]
    conn.rollback()
    if n != len(ids):
        status = "untouched" if n == 0 else f"partial ({n} of {len(ids)} rows): left for a human"
    elif not a.commit:
        status = f"would restore ({len(ids)} rows)"
    else:
        def verify():
            with conn.cursor() as cur:
                cur.execute(REPOINT_COUNT, (run_id, ids))
                remain = cur.fetchone()["n"]
            return [f"{remain} re-point rows remain"] if remain else []
        apply(conn, md.audit_removal("repoint", run_id, [], ids), verify)
        status = f"restored ({len(ids)} rows removed)"
    print(f"[{a.target}] restore of {run_id} (repoint): {status}")
    (out / f"merge-restore-{a.target}-{stamp}{'-commit' if a.commit else '-dryrun'}.json").write_text(
        json.dumps({"restored": run_id, "kind": "repoint", "status": status}, indent=2))
    if not a.commit:
        print("DRY RUN — nothing written.")
    if status.startswith("partial"):
        raise SystemExit("the re-point run was not restored; see above.")


def run_restore(a, conn, out, stamp, fks):
    image = load_image(a.restore, a.target, kind=None)
    if image["kind"] == "repoint":
        return restore_repoint(a, conn, out, stamp, image)
    run_id = image["run_id"] if image["kind"] == "merge" else image["of"]
    print(f"[{a.target}] restore of {image['run_id']} ({image['kind']}){'' if a.commit else ' (dry run)'}:")
    results = []
    backup = {"restore_of": image["run_id"], "target": a.target, "pairs": []}
    backup_path = Path(a.private_dir) / a.target / f"merge-restore-before-{stamp}.json"
    try:
        for e in reversed(image["pairs"]):
            if e.get("status") not in ("committed", "writing"):
                continue
            conn.rollback()
            with conn.cursor() as cur:
                state = merged_state(cur, e, run_id) if e["kind"] == "merge" else "merged"
                live = load_users(cur, [e["survivor"]] + e["retired"])
            if state != "merged":
                results.append({"pair": e["pair"], "status": state})
                print(f"  {e['pair']}: {state} — {'nothing to undo' if state == 'untouched' else 'left for a human'}")
                continue
            steps, back, changed = restore_steps(e, run_id, fks, live)
            note = f"; changed since the merge, left as is: {', '.join(changed)}" if changed else ""
            if not a.commit:
                results.append({"pair": e["pair"], "status": "would restore", "steps": len(steps), "left": changed})
                print(f"  {e['pair']}: would restore ({len(steps)} steps){note}")
                continue
            backup["pairs"].append({"pair": e["pair"], "rows_before": full_rows(
                conn, {"survivor": e["survivor"], "retired": e["retired"], "moves": e["moves"],
                       "visits": e.get("visits", []), "folds": e.get("folds", [])}, fks)})
            write_private(backup_path, backup)
            try:
                n = apply(conn, steps, restore_verify(conn, e, run_id, back, fks))
            except SystemExit as err:
                results.append({"pair": e["pair"], "status": "not restored", "why": str(err)})
                print(f"  {e['pair']}: NOT RESTORED, nothing changed for this teacher — {err}")
                continue
            results.append({"pair": e["pair"], "status": "restored", "steps": n, "left": changed})
            print(f"  {e['pair']}: RESTORED ({n} steps){note}")
    finally:
        conn.rollback()
        (out / f"merge-restore-{a.target}-{stamp}{'-commit' if a.commit else '-dryrun'}.json").write_text(
            json.dumps({"restored": image["run_id"], "kind": image["kind"], "results": results}, indent=2))
    if not a.commit:
        print("DRY RUN — nothing written.")
    if any(r["status"] in ("not restored", "partial") for r in results):
        raise SystemExit("some teachers were not restored; see above.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", required=True, choices=sorted(TARGETS))
    ap.add_argument("--env-file", default=str(REPO / ".env"))
    ap.add_argument("--scope", help="the reviewed scope CSV (go, tab, sheet_no, class, survivor_id, retire_ids, "
                    "number_in_use_account_id, and optionally keep_number_override: a reason to keep a number "
                    "another account of the pair messaged from more recently)")
    ap.add_argument("--go", help="which go of the scope to run, e.g. 3a")
    ap.add_argument("--only", help="comma-separated teachers of that go, as 't1 #12'; with --repoint, retired account "
                    "ids (or unique prefixes of 8+ characters)")
    ap.add_argument("--sweep", help="a merge's before-image: move what reached its retired accounts since")
    ap.add_argument("--restore", help="a merge's, a sweep's or a re-point run's before-image: undo it")
    ap.add_argument("--repoint", action="store_true",
                    help="re-point every retired account the governed mapping does not credit to its teacher's account")
    ap.add_argument("--out", required=True, help="directory for the ids-only plan CSV and summary JSON")
    ap.add_argument("--private-dir", default=str(Path.home() / "rumi-private" / "niete-dupes"),
                    help="directory for before-images (phone numbers, portal hashes), mode 0700/0600")
    ap.add_argument("--expect-csv", help="the reviewed dry run's plan CSV; required for a prod merge")
    ap.add_argument("--commit", action="store_true", help="write; default is a read-only dry run")
    ap.add_argument("--confirm-ref", help="with --commit on prod: the prod project ref, typed out")
    a = ap.parse_args()

    modes = [m for m in ("scope", "sweep", "restore", "repoint") if getattr(a, m)]
    if len(modes) != 1 or (a.scope and not a.go):
        raise SystemExit("ABORT: give exactly one of --scope with --go, --sweep <image>, --restore <image> or "
                         "--repoint.")
    if a.commit and a.target == "prod" and (a.confirm_ref != TARGETS["prod"]["ref"]
                                            or os.environ.get("MERGE_DUPES_PROD_GO") != "yes"
                                            or ((a.scope or a.repoint) and not a.expect_csv)):
        raise SystemExit("ABORT: a prod write needs --confirm-ref <prod ref>, MERGE_DUPES_PROD_GO=yes and, for a "
                         "merge or a re-point, the reviewed --expect-csv.")
    conn = connect(read_env(a.env_file), a.target, writable=a.commit)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    with conn.cursor() as cur:
        fks, keys, refs = read_catalog(cur)
    conn.rollback()
    if a.restore:
        run_restore(a, conn, out, stamp, fks)
    elif a.repoint:
        run_repoint(a, conn, out, stamp)
    elif a.sweep:
        run_sweep(a, conn, out, stamp, fks, keys, refs)
    else:
        run_merge(a, conn, out, stamp, fks, keys, refs)


if __name__ == "__main__":
    try:
        main()
    except psycopg2.Error as err:
        raise SystemExit(f"ABORT: {masked(err)}") from None
