#!/usr/bin/env python3
"""
Purge real people's data from the NIETE SANDBOX (database + its R2 bucket), keeping a keep-list of staff and test
accounts working. The sandbox is shared with outside developers and copied onto their laptops by dev-portal.sh, so
it must hold dummy people only. The rules (phone mapping, dummy names, guards) live in scripts/lib/sandbox_scrub.py
and are unit-tested in scripts/tests/test_sandbox_scrub.py.

  TARGET   the sandbox only: the env file's DATABASE_URL must name the sandbox project ref, and R2 deletes are
           refused for any bucket but the sandbox bucket. Production and staging are refused before connecting.
  KEEP     --keep-phones FILE (one 92... number per line: operators) and --keep-ids FILE (user ids: named
           contributors). Never put either list in the repo. On top of those, test-named accounts and accounts
           used on sandbox recently are kept (see KEEP_SQL).

  DRY RUN (default): everything runs in ONE transaction, the checks run, the counts are written, then ROLLBACK.
    python3 scripts/sandbox-pii-purge.py --keep-phones <f> --keep-ids <f> --out <dir> --backup-dir <private dir>
  WRITE: the same, then COMMIT if every check passed.          ... --commit
  R2:    after a committed run, delete the planned objects (each downloaded to --backup-dir first).
                                                               ... --r2-delete <plan.jsonl> --backup-dir <dir>
  SCAN:  counts of real-looking phones / names left outside the keep-list (read-only).   ... --scan

What it does to everyone NOT on the keep-list (ids, schools, relations and row counts stay):
  phones   every real Pakistani mobile anywhere in the public schema -> one fake per person in the unallocated
           0399 block, same spelling (users, rosters, chat_starts, LP requests, URLs, JSON, ...)
  names    users, roster/schedule/certificate/share-code teacher names, students and parents -> marked dummies
  logs     conversations deleted; chat-session state, LP request text, feedback text, coach comments nulled;
           calls, call memory, audio sessions, image-analysis requests deleted
  media    coaching recordings, transcripts, photos, report/debrief links and child-test audio/photos nulled in the
           rows; R2 objects under the personal-media prefixes not owned by a keep-list account planned for deletion
  other    FDE profile bundle (email, CNIC, extra phones) dropped from preferences; portal password hashes and
           tokens nulled; record_history rows (old/new values) for scrubbed tables deleted, including the rows
           this run's own updates write; materialized views refreshed.
Never prints a phone, name or email: reports are counts only. The row backup (old values of every row it changes or
deletes, without coaching_sessions.tokens_raw: raw ASR tokens, ~400 MB as JSON, slow over the pooler) and the R2 object backup go to --backup-dir, which must be outside any git repo; keep it mode 700.
"""
import argparse
import collections
import datetime as dt
import json
import os
import re
import secrets
import subprocess
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import sandbox_scrub as ss  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
TEXTY = ("text", "character varying", "jsonb", "json", "ARRAY", "character")
SYNTH_PHONE_RE = re.compile(r"^(92399|92000|92999|15550|93330000|99928)")
REAL_SOURCES_RE = re.compile(r"^(taleemabad_|main_rumi_gb|ict_rm_roster_|ict_coach_batch_|niete_ict_backfill|observe_visit_bind)")
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
# analysis_data keys that carry classroom quotes or debrief prose rather than scores
ANALYSIS_QUOTE_KEYS = ("reflective_corpus", "notable_moments", "questions", "voice_debrief_script", "debrief_reflection",
                       "observer_debrief", "observer_edit_summary", "photo_analysis", "report_narrative", "teacher_delivery",
                       "talk_time", "uptake")
CS_NULL_COLS = ("audio_url", "transcript_text", "diarization_data", "tokens_raw", "silence_markers", "classroom_photos",
                "report_pdf_url", "voice_debrief_url", "lesson_plan_url", "lesson_plan_r2_key", "lesson_plan_text",
                "lesson_plan_excerpt", "conversation_state", "error_stack", "autofill_analysis_data", "report_gamma_url")
FDE_BUNDLE_DROP = ("email", "user_meta_data", "additional_phone_numbers", "profile_metadata", "last_login")
HISTORY_KEEP_TABLES = ("app_settings",)

KEEP_SQL = """
create temp table k_users on commit drop as
with act as (
  select u.id, (select max(c.created_at) from conversations c where c.user_id = u.id and c.role = 'user') last_msg,
         u.portal_last_login from users u)
select u.id, array_remove(array[
         case when u.phone_number = any(%(ops)s) then 'operator' end,
         case when u.id = any(%(ids)s::uuid[]) then 'contributor' end,
         case when u.name ilike '%%testwala%%' then 'testwala' end,
         case when u.name ilike '%%test%%' or u.school_name ilike '%%test%%' then 'test_named' end,
         case when u.is_test_user and greatest(a.last_msg, a.portal_last_login) >= '2026-09-01' then 'test_user_active' end,
         case when greatest(a.last_msg, a.portal_last_login) >= '2026-11-01' then 'active_since_nov' end
       ], null) why
  from users u join act a on a.id = u.id
 where u.phone_number = any(%(ops)s) or u.id = any(%(ids)s::uuid[])
    or u.name ilike '%%test%%' or u.school_name ilike '%%test%%'
    or (u.is_test_user and greatest(a.last_msg, a.portal_last_login) >= '2026-09-01')
    or greatest(a.last_msg, a.portal_last_login) >= '2026-11-01'
"""


def read_env(path):
    env = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def lines(path):
    return [x.strip() for x in Path(path).read_text().splitlines() if x.strip()] if path else []


class Run:
    def __init__(self, a):
        self.a = a
        self.counts = collections.OrderedDict()
        self.salt = secrets.token_hex(16)
        self.backup = None
        if a.backup_dir:
            bd = Path(a.backup_dir).expanduser().resolve()
            if subprocess.run(["git", "-C", str(bd), "rev-parse"], capture_output=True).returncode == 0:
                raise SystemExit("REFUSING: --backup-dir is inside a git repository")
            bd.mkdir(parents=True, exist_ok=True)
            os.chmod(bd, 0o700)
            self.bdir = bd

    def count(self, key, n):
        self.counts[key] = self.counts.get(key, 0) + int(n or 0)
        print(f"  {key}: {n}", flush=True)

    # ── backup of old row values ─────────────────────────────────────────────────────────────────────────
    def open_backup(self, stamp):
        if not self.a.backup_dir:
            return
        p = self.bdir / f"rows_{stamp}.jsonl"
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        self.backup = os.fdopen(fd, "a")
        self.backup_path = p

    def snap(self, cur, table, where, params=(), schema="public"):
        """Old values of the rows about to change, streamed through a server-side cursor in small batches: one
        result holding every coaching session's recordings metadata dropped the pooler connection (18 Nov)."""
        if not self.backup:
            return
        self.snaps = getattr(self, "snaps", 0) + 1
        with cur.connection.cursor(name=f"purge_snap_{self.snaps}") as sc:
            sc.itersize = 50
            sc.execute(f"select (to_jsonb(t) - 'tokens_raw')::text from \"{schema}\".\"{table}\" t where {where}", params)
            for (r,) in sc:
                self.backup.write(json.dumps({"t": f"{schema}.{table}", "row": json.loads(r)}) + "\n")
        self.backup.flush()

    def batch_update(self, cur, schema, table, idcols, rows, casts, label):
        """rows: [(ident tuple of text, {col: new value})]. One snapshot query and one UPDATE ... FROM (VALUES)
        per group of rows changing the same columns (a network round trip per row would take an hour)."""
        groups = collections.defaultdict(list)
        for ident, vals in rows:
            if vals:
                groups[tuple(sorted(vals))].append((ident, vals))
        n = 0
        ids_sql = ", ".join(f'"v{i}"' for i in range(len(idcols)))
        if idcols == ["ctid"]:
            join = "t.ctid = v.v0::tid"
        else:
            join = " and ".join(f't."{c}"::text = v."v{i}"' for i, c in enumerate(idcols))
        for cols, items in groups.items():
            for i in range(0, len(items), 2000):
                chunk = items[i:i + 2000]
                if self.backup:
                    for j in range(0, len(chunk), 100):  # small results: big rows dropped the connection (18 Nov)
                        sub = chunk[j:j + 100]
                        got = psycopg2.extras.execute_values(
                            cur, f"select (to_jsonb(t) - 'tokens_raw')::text from \"{schema}\".\"{table}\" t join (values %s) v({ids_sql}) on {join}",
                            [tuple(ident) for ident, _ in sub], page_size=len(sub), fetch=True)
                        for (r,) in got:
                            self.backup.write(json.dumps({"t": f"{schema}.{table}", "row": json.loads(r)}) + "\n")
                vcols = ", ".join(f'"c{j}"' for j in range(len(cols)))
                sets = ", ".join(f'"{c}" = v."c{j}"::{casts.get(c, "text")}' for j, c in enumerate(cols))
                psycopg2.extras.execute_values(
                    cur, f'update "{schema}"."{table}" t set {sets} from (values %s) v({ids_sql}, {vcols}) where {join}',
                    [tuple(ident) + tuple(vals[c] for c in cols) for ident, vals in chunk], page_size=len(chunk))
                n += cur.rowcount
        self.count(label, n)
        return n

    def exec_counted(self, cur, key, table, set_or_delete, where, params=()):
        self.snap(cur, table, where, params)
        cur.execute(f'{set_or_delete} where {where}', params)
        self.count(key, cur.rowcount)


def table_pk(cur, table):
    cur.execute("""select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                    where i.indrelid = %s::regclass and i.indisprimary order by a.attnum""", (f'public."{table}"',))
    return [r[0] for r in cur.fetchall()]


def texty_columns(cur, schemas=("public",)):
    cur.execute("""select c.table_schema, c.table_name, c.column_name, c.data_type, c.udt_name
                     from information_schema.columns c
                     join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
                    where t.table_type = 'BASE TABLE' and c.table_schema = any(%s) order by 1, 2, 3""", (list(schemas),))
    out = collections.defaultdict(list)
    for s, t, c, dtyp, udt in cur.fetchall():
        if dtyp in TEXTY:
            out[(s, t)].append((c, dtyp, udt))
    return out


def cast_for(dtyp, udt):
    if dtyp == "ARRAY":
        return udt.lstrip("_") + "[]"
    return {"jsonb": "jsonb", "json": "json"}.get(dtyp, "text")


def phone_hit_rows(cur, schema, table, cols):
    """[(pk values | ctid, {col: text})] for rows where any of `cols` holds a phone-shaped value."""
    pk = table_pk(cur, table) if schema == "public" else []
    ident = ", ".join(f'"{c}"::text' for c in pk) if pk else "ctid::text"
    where = " or ".join(f'"{c}"::text ~ %s' for c, _, _ in cols)
    sel = ", ".join(f'"{c}"::text' for c, _, _ in cols)
    cur.execute(f'select {ident}, {sel} from "{schema}"."{table}" where {where}', [ss.PG_PHONE_RE] * len(cols))
    n_id = len(pk) if pk else 1
    rows = []
    for r in cur.fetchall():
        rows.append((tuple(r[:n_id]), dict(zip([c for c, _, _ in cols], r[n_id:]))))
    return pk, rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env-file", default=str(REPO / ".env.sandbox"))
    ap.add_argument("--keep-phones")
    ap.add_argument("--keep-ids")
    ap.add_argument("--out", help="folder for the counts report and the R2 plan (no PII in either)")
    ap.add_argument("--backup-dir", help="private folder outside any repo for old row values / R2 objects")
    ap.add_argument("--r2-inventory", help="JSONL of {k,s} for every object in the sandbox bucket (plans R2 deletes)")
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--scan", action="store_true", help="read-only: count what is left outside the keep-list")
    ap.add_argument("--r2-delete", help="R2 plan JSONL from a committed run: back up then delete those objects")
    ap.add_argument("--r2-workers", type=int, default=8, help="parallel downloads for the R2 backup (default 8)")
    a = ap.parse_args()

    env = read_env(a.env_file)
    url = env.get("DATABASE_URL", "")
    ss.refuse_unless_sandbox(url)
    if a.r2_delete:
        return r2_delete(a, env)
    if not (a.keep_phones and a.keep_ids):
        raise SystemExit("--keep-phones and --keep-ids are required (the keep-list must be explicit)")
    run = Run(a)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    out = Path(a.out) if a.out else None
    if out:
        out.mkdir(parents=True, exist_ok=True)
    # keepalives: the pooler path drops a quiet connection mid-transaction otherwise (seen twice on 17 Nov)
    conn = psycopg2.connect(url, keepalives=1, keepalives_idle=20, keepalives_interval=10, keepalives_count=6,
                            application_name="sandbox-pii-purge")
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("set local statement_timeout = '15min'")
    ops, ids = lines(a.keep_phones), lines(a.keep_ids)
    cur.execute(KEEP_SQL, {"ops": ops, "ids": ids})
    cur.execute("select id::text, why from k_users")
    keep_ids = {}
    for i, why in cur.fetchall():
        keep_ids[i] = why
    print(f"keep-list: {len(keep_ids)} accounts", flush=True)
    run.count("keep_list.accounts", len(keep_ids))
    for w, n in collections.Counter(w for v in keep_ids.values() for w in v).most_common():
        run.count(f"keep_list.reason.{w}", n)

    if a.scan:
        res = scan(cur, keep_ids, run)
        conn.rollback()
        write_report(out, run, stamp, mode="scan")
        return 0 if res else 1

    if a.commit:
        run.open_backup(stamp)
    cur.execute("select txid_current()")
    (txid,) = cur.fetchone()

    # ── users: classify ──────────────────────────────────────────────────────────────────────────────────
    cur.execute("select id::text, phone_number, name, source, is_test_user from users")
    users = cur.fetchall()
    uinfo = {}      # id -> dict(cls, national, scrub_phone, scrub_name, seed, name)
    keep_nat = set()
    for uid, phone, name, source, _t in users:
        p = phone or ""
        f = ss.find_phones(p)
        whole = f[0] if f and f[0].start == 0 and f[0].end == len(p) else None
        if uid in keep_ids:
            if whole and whole.cls == "pk" and ss.is_real_national(whole.national):
                keep_nat.add(whole.national)
            uinfo[uid] = dict(cls="keep", national=whole.national if whole else None, scrub_name=False, name=name)
            continue
        if whole and ss.is_real_national(whole.national):
            uinfo[uid] = dict(cls=whole.cls, national=whole.national, scrub_name=True, seed="N:" + whole.national, name=name)
        elif not p.isdigit() or SYNTH_PHONE_RE.match(p) or (whole and not ss.is_real_national(whole.national)):
            real_src = bool(REAL_SOURCES_RE.match(source or ""))
            uinfo[uid] = dict(cls="synthetic", national=None, scrub_name=real_src, seed="U:" + uid, name=name)
        else:
            uinfo[uid] = dict(cls="foreign", national="x" + p, scrub_name=True, seed="X:" + p, name=name, phone=p)
    cls_counts = collections.Counter(v["cls"] for v in uinfo.values())
    for k, n in sorted(cls_counts.items()):
        run.count(f"users.class.{k}", n)
    run.count("users.names_to_scrub", sum(1 for v in uinfo.values() if v["scrub_name"]))
    nonk = [i for i in uinfo if i not in keep_ids]
    cur.execute("create temp table nk_users (id uuid primary key) on commit drop")
    psycopg2.extras.execute_values(cur, "insert into nk_users values %s", [(i,) for i in nonk], page_size=5000)
    cur.execute("analyze nk_users")
    # real names of name-scrubbed people (for prose replacement), keyed by user id
    fake_of_user = {i: ss.fake_name(v["seed"], run.salt) for i, v in uinfo.items() if v["scrub_name"]}

    # ── R2 plan (computed before rows change; only objects under personal-media prefixes) ─────────────────
    r2_plan = plan_r2(cur, a.r2_inventory, keep_ids, keep_nat, run) if a.r2_inventory else []

    # ── content owned by non-keep-list people ────────────────────────────────────────────────────────────
    print("content:", flush=True)
    run.exec_counted(cur, "conversations.deleted", "conversations", "delete from conversations",
                     "user_id is null or user_id in (select id from nk_users)")
    run.exec_counted(cur, "chat_sessions.state_nulled", "chat_sessions", "update chat_sessions set conversation_state = null",
                     "conversation_state is not null and user_id in (select id from nk_users)")
    cur.execute("select wa_call_id from calls where user_id is null or user_id in (select id from nk_users)")
    calls = [r[0] for r in cur.fetchall() if r[0]]
    run.exec_counted(cur, "call_trace.deleted", "call_trace", "delete from call_trace", "wa_call_id = any(%s)", (calls,))
    run.exec_counted(cur, "calls.deleted", "calls", "delete from calls", "user_id is null or user_id in (select id from nk_users)")
    run.exec_counted(cur, "call_memory.deleted", "call_memory", "delete from call_memory",
                     "user_id is null or user_id in (select id from nk_users)")
    run.exec_counted(cur, "audio_sessions.deleted", "audio_sessions", "delete from audio_sessions",
                     "user_id is null or user_id in (select id from nk_users)")
    run.exec_counted(cur, "image_analysis_requests.deleted", "image_analysis_requests", "delete from image_analysis_requests",
                     "user_id is null or user_id in (select id from nk_users)")
    run.exec_counted(cur, "feature_suggestions.text_nulled", "feature_suggestions",
                     "update feature_suggestions set message_context = null",
                     "message_context is not null and (user_id is null or user_id in (select id from nk_users))")
    run.exec_counted(cur, "lp_feedback.text_nulled", "lp_feedback", "update lp_feedback set reason_text = null",
                     "reason_text is not null and (user_id is null or user_id in (select id from nk_users))")
    run.exec_counted(cur, "student_video_feedback.text_nulled", "student_video_feedback",
                     "update student_video_feedback set reason_text = null",
                     "reason_text is not null and (user_id is null or user_id in (select id from nk_users))")
    run.exec_counted(cur, "lesson_plan_requests.text_nulled", "lesson_plan_requests",
                     "update lesson_plan_requests set full_message = null",
                     "full_message is not null and (user_id is null or user_id in (select id from nk_users))")
    run.exec_counted(cur, "supervisor_remarks.text_nulled", "supervisor_remarks",
                     "update supervisor_remarks set comment_text = null, narrative_text = null, comment_audio_id = null",
                     "(principal_user_id is null or principal_user_id in (select id from nk_users))"
                     " and (comment_text is not null or narrative_text is not null or comment_audio_id is not null)")
    run.exec_counted(cur, "coach_visit_requests.voice_nulled", "coach_visit_requests",
                     "update coach_visit_requests set voice_note_key = null",
                     "voice_note_key is not null and (coach_user_id is null or coach_user_id in (select id from nk_users))")
    run.exec_counted(cur, "observation_field_forms.scrubbed", "observation_field_forms",
                     "update observation_field_forms set visit_context = '{}'::jsonb, photos = '[]'::jsonb",
                     "(observer_user_id is null or observer_user_id in (select id from nk_users))"
                     " and (visit_context <> '{}'::jsonb or photos <> '[]'::jsonb)")
    run.exec_counted(cur, "nietemigrated_school_visits.comments_nulled", "nietemigrated_school_visits",
                     "update nietemigrated_school_visits set comments = null", "comments is not null")
    run.exec_counted(cur, "dashboard_audit_log.ip_nulled", "dashboard_audit_log",
                     "update dashboard_audit_log set ip_address = null", "ip_address is not null")
    # coaching sessions: keep the row (scores, relations, counts), drop recordings, transcripts, photos, quotes
    cs_where = ("(user_id is null or user_id in (select id from nk_users))"
                " and (observer_user_id is null or observer_user_id in (select id from nk_users))")
    run.exec_counted(cur, "coaching_sessions.media_nulled", "coaching_sessions",
                     "update coaching_sessions set " + ", ".join(f"{c} = null" for c in CS_NULL_COLS)
                     + ", analysis_data = case when jsonb_typeof(analysis_data) = 'object' then analysis_data - %s::text[]"
                       " else analysis_data end", cs_where, (list(ANALYSIS_QUOTE_KEYS),))
    # every session whose teacher or observer is scrubbed, including those a keep-list coach recorded (kept, but the
    # teacher in them is a real person who now carries a dummy name)
    names_in_prose(cur, run, "coaching_sessions", ("user_id", "observer_user_id"),
                   ("analysis_data", "prioritized_action", "transcript_text"),
                   "(analysis_data is not null or prioritized_action is not null or transcript_text is not null)"
                   " and (user_id in (select id from nk_users) or observer_user_id in (select id from nk_users))",
                   uinfo, fake_of_user, {"analysis_data": "jsonb", "prioritized_action": "jsonb", "transcript_text": "text"})
    names_in_prose(cur, run, "quizzes", ("teacher_id",), ("meta",),
                   "meta is not null and teacher_id in (select id from nk_users)", uinfo, fake_of_user)
    run.exec_counted(cur, "coachip_moments.clip_nulled", "coachip_moments", "update coachip_moments set clip_r2_key = null,"
                     " clip_status = case when clip_status = 'ready' then 'expired'::coachip_clip_status else clip_status end",
                     "clip_r2_key is not null and session_id not in (select id from coaching_sessions where not (" + cs_where + "))")
    # child tests: recordings, photos and transcripts of children, unless a keep-list coach ran the session
    # its keep-marks trigger refuses any change to a marked block; replica role skips it for this one statement
    # without the ACCESS EXCLUSIVE lock an ALTER TABLE ... DISABLE TRIGGER would hold until commit
    cur.execute("set local session_replication_role = replica")
    run.exec_counted(cur, "child_test_blocks.media_nulled", "child_test_blocks",
                     "update child_test_blocks set audio_r2_key = null, photo_r2_key = null, transcript = null, audio_r2_keys = null",
                     "(audio_r2_key is not null or photo_r2_key is not null or transcript is not null or audio_r2_keys is not null)"
                     " and session_id in (select id from child_test_sessions where coach_user_id is null"
                     " or coach_user_id in (select id from nk_users))")
    cur.execute("set local session_replication_role = origin")
    run.exec_counted(cur, "exam_submissions.scrubbed", "exam_submissions",
                     "update exam_submissions set image_urls = '{}', annotated_image_urls = null, thumbnail_urls = null,"
                     " extracted_text = null", "session_id not in (select id from exam_check_sessions where user_id in"
                     " (select id::uuid from k_users))")
    run.exec_counted(cur, "training_certificates.pdf_nulled", "training_certificates",
                     "update training_certificates set pdf_r2_key = null",
                     "pdf_r2_key is not null and user_id in (select id from nk_users)")

    # ── names (before phones: seeds come from the original phones) ───────────────────────────────────────
    print("names:", flush=True)
    scrub_names(cur, run, uinfo, keep_ids, keep_nat)

    # ── users: other personal fields ──────────────────────────────────────────────────────────────────────
    print("users:", flush=True)
    run.exec_counted(cur, "users.credentials_nulled", "users",
                     "update users set portal_password_hash = null, portal_invite_token = null, password_reset_code = null,"
                     " conversation_state = null",
                     "id in (select id from nk_users) and (portal_password_hash is not null or portal_invite_token is not null"
                     " or password_reset_code is not null or conversation_state is not null)")
    run.exec_counted(cur, "users.fde_bundle_trimmed", "users",
                     "update users set preferences = jsonb_set(preferences, '{taleemabad}', (preferences->'taleemabad') - %s::text[])",
                     "jsonb_typeof(preferences->'taleemabad') = 'object' and id in (select id from nk_users)",
                     (list(FDE_BUNDLE_DROP),))
    # foreign real numbers on non-keep-list users -> fakes (exact-value rewrite wherever that value appears)
    foreign = {v["phone"]: v["national"] for v in uinfo.values() if v["cls"] == "foreign"}

    # ── phones: every real number in every text column of the public schema ──────────────────────────────
    print("phones:", flush=True)
    cols = texty_columns(cur)
    hits = {}
    for (s, t), cs in cols.items():
        if t in ("record_history",):
            continue
        pk, rows = phone_hit_rows(cur, s, t, cs)
        if rows:
            hits[(s, t)] = (pk, cs, rows)
    nationals = set()
    for (_s, _t), (_pk, _cs, rows) in hits.items():
        for _ident, vals in rows:
            for v in vals.values():
                for f in ss.find_phones(v or ""):
                    if ss.is_real_national(f.national):
                        nationals.add(f.national)
    nationals |= set(foreign.values())
    cur.execute("select phone_number from users where phone_number ~ '^92399[89][0-9]{6}$'")
    taken = {p[-6:] for (p,) in cur.fetchall()}
    codes = ss.build_code_map(nationals, run.salt, taken)
    run.count("phones.distinct_real_numbers", len(nationals))
    for (s, t), (pk, cs, rows) in sorted(hits.items()):
        casts = {c: cast_for(dtyp, udt) for c, dtyp, udt in cs}
        replaced = 0
        todo = []
        for ident, vals in rows:
            new = {}
            for c, v in vals.items():
                if v is None:
                    continue
                nv, n = ss.scrub_phones(v, codes, keep_nat)
                if n:
                    new[c] = nv
                    replaced += n
            if new:
                todo.append((ident, new))
        if todo:
            run.batch_update(cur, s, t, pk or ["ctid"], todo, casts, f"phones.{t}.rows")
            run.count(f"phones.{t}.values", replaced)
    for p, xkey in foreign.items():
        fake = "92" + ss.FAKE_BLOCK["pk"] + codes[xkey]
        for t, c in (("users", "phone_number"), ("chat_starts", "phone_number"), ("lesson_plan_requests", "phone_number")):
            run.snap(cur, t, f"{c} = %s", (p,))
            cur.execute(f"update {t} set {c} = %s where {c} = %s", (fake, p))  # a handful of rows
            run.count(f"phones.foreign.{t}", cur.rowcount)

    # ── audit history: the old/new values of scrubbed tables, and this run's own trigger rows ────────────
    print("history:", flush=True)
    run.exec_counted(cur, "record_history.deleted", "record_history", "delete from record_history",
                     "table_name <> all(%s) or txid = %s", (list(HISTORY_KEEP_TABLES), txid))
    cur.execute("delete from record_history where txid = txid_current()")
    run.count("record_history.this_run_deleted", cur.rowcount)

    # ── materialized views ───────────────────────────────────────────────────────────────────────────────
    cur.execute("select schemaname, matviewname from pg_matviews where schemaname = 'public'")
    mvs = cur.fetchall()
    for sch, m in mvs:
        cur.execute(f'refresh materialized view "{sch}"."{m}"')
    run.count("matviews.refreshed", len(mvs))

    # ── people who registered while this run was in progress (the sandbox bot stays live): they are using the
    #    sandbox right now, like the keep-list's "active since 1 Nov" rule, so the checks treat them as kept ─────
    cur.execute("select id::text from users where not (id::text = any(%s))", (list(uinfo),))
    joined = [r[0] for r in cur.fetchall()]
    for j in joined:
        keep_ids[j] = ["joined_during_run"]
    run.count("keep_list.joined_during_run", len(joined))

    # ── checks (inside the transaction) ──────────────────────────────────────────────────────────────────
    print("checks:", flush=True)
    ok = scan(cur, keep_ids, run)
    cur.execute("select count(*) from users")
    run.count("check.users_total_after", cur.fetchone()[0])
    if out and r2_plan:
        p = out / f"r2_plan_{stamp}.jsonl"
        with open(p, "w") as f:
            for k in r2_plan:
                f.write(json.dumps(k) + "\n")
        os.chmod(p, 0o600)
        run.count("r2.plan_file_written", 1)
    if a.commit and ok:
        conn.commit()
        print("COMMITTED", flush=True)
        mode = "commit"
    else:
        conn.rollback()
        print("ROLLED BACK" + ("" if ok else " (a check failed)"), flush=True)
        mode = "dry-run" if ok else "dry-run-failed-checks"
    if run.backup:
        run.backup.close()
        if mode != "commit":
            os.remove(run.backup_path)
    write_report(out, run, stamp, mode)
    return 0 if ok else 1


def names_in_prose(cur, run, table, owner_cols, text_cols, where, uinfo, fake_of_user, casts=None):
    """Replace the owners' real names inside kept prose (AI analysis, coach focus, quiz digests) with their dummies."""
    sel_owner = ", ".join(f"{c}::text" for c in owner_cols)
    sel_text = ", ".join(f"{c}::text" for c in text_cols)
    cur.execute(f"select id::text, {sel_owner}, {sel_text} from {table} where {where}")
    todo = []
    for row in cur.fetchall():
        rid, owners, texts = row[0], row[1:1 + len(owner_cols)], row[1 + len(owner_cols):]
        mapping = {}
        for u in owners:
            info = uinfo.get(u)
            if not info or not info["scrub_name"] or not info.get("name"):
                continue
            real, fake = info["name"].strip(), fake_of_user[u]
            mapping[real] = fake
            first = real.split()[0] if real.split() else ""
            if len(first) >= 3 and first.lower() not in ("mrs", "miss", "sir", "madam", "syed", "muhammad", "mohammad"):
                mapping.setdefault(first, fake.split()[0])
        if not mapping:
            continue
        new = {}
        for c, txt in zip(text_cols, texts):
            if txt:
                nt = ss.replace_names(txt, mapping)
                if nt != txt:
                    new[c] = nt
        if new:
            todo.append(((rid,), new))
    run.batch_update(cur, "public", table, ["id"], todo, casts or {c: "jsonb" for c in text_cols},
                     f"{table}.prose_names_replaced")


def scrub_names(cur, run, uinfo, keep_ids, keep_nat):
    salt = run.salt
    phone_to_user = {}
    cur.execute("select id::text, phone_number from users")
    for uid, p in cur.fetchall():
        if p:
            phone_to_user[p] = uid

    def seed_for_phone(phone, fallback):
        """(scrub?, seed) for a person known only by phone, following their user row when there is one."""
        for f in ss.find_phones(phone or ""):
            if f.cls == "pk" and f.national in keep_nat:
                return False, None
            for cand in ("92" + f.national, "99" + f.national, phone):
                uid = phone_to_user.get(cand)
                if uid:
                    info = uinfo[uid]
                    return (info["scrub_name"], info.get("seed")) if info["cls"] != "keep" else (False, None)
            if ss.is_real_national(f.national):
                return True, "N:" + f.national
        uid = phone_to_user.get(phone or "")
        if uid:
            info = uinfo[uid]
            return (info["scrub_name"], info.get("seed")) if info["cls"] != "keep" else (False, None)
        return True, fallback

    def seed_for_user(uid, fallback):
        info = uinfo.get(uid) if uid else None
        if info:
            return (info["scrub_name"], info.get("seed")) if info["cls"] != "keep" else (False, None)
        return True, fallback

    def apply(table, cols, rows, label, casts=None):
        """rows: [((id,), (v1, v2, ...))] matching `cols`; ids compared as text."""
        run.batch_update(cur, "public", table, ["id"], [(ident, dict(zip(cols, vals))) for ident, vals in rows],
                         casts or {}, label)

    # users
    rows = [((uid,), (ss.fake_name(v["seed"], salt),)) for uid, v in uinfo.items() if v["scrub_name"]]
    apply("users", ["name"], rows, "names.users")
    # leader_teachers / leader_roster_audit (by phone)
    for table, label in (("leader_teachers", "names.leader_teachers"), ("leader_roster_audit", "names.leader_roster_audit")):
        cur.execute(f"select id::text, teacher_phone_e164, teacher_name from {table} where teacher_name is not null")
        rows = []
        for rid, phone, name in cur.fetchall():
            if ss.is_fake_name(name):
                continue
            scrub, seed = seed_for_phone(phone, f"{table}:{rid}")
            if scrub:
                rows.append(((rid,), (ss.fake_name(seed, salt),)))
        apply(table, ["teacher_name"], rows, label)
    # observation_schedules (teacher_user_id, else teacher_ext_id phone)
    cur.execute("select id::text, teacher_user_id::text, teacher_ext_id, teacher_name from observation_schedules"
                " where teacher_name is not null")
    rows = []
    for rid, tu, ext, name in cur.fetchall():
        scrub, seed = seed_for_user(tu, None) if tu else seed_for_phone(ext, f"os:{rid}")
        if scrub:
            rows.append(((rid,), (ss.fake_name(seed or f"os:{rid}", salt),)))
    apply("observation_schedules", ["teacher_name"], rows, "names.observation_schedules")
    # teacher names held by user id
    for table, col, ucol in (("quiz_share_codes", "teacher_name", "teacher_user_id"),
                             ("training_certificates", "teacher_name_snapshot", "user_id")):
        cur.execute(f"select id::text, {ucol}::text from {table} where {col} is not null")
        rows = []
        for rid, uid in cur.fetchall():
            scrub, seed = seed_for_user(uid, f"{table}:{rid}")
            if scrub:
                rows.append(((rid,), (ss.fake_name(seed, salt),)))
        apply(table, [col], rows, f"names.{table}")
    # coach directory
    cur.execute("select id::text, leader_user_id::text from coach_directory")
    rows = []
    for rid, uid in cur.fetchall():
        scrub, seed = seed_for_user(uid, f"cd:{rid}")
        if scrub:
            fake = ss.fake_name(seed, salt)
            rows.append(((rid,), (fake, "dummy-" + fake.split()[-1] + "@example.invalid")))
    apply("coach_directory", ["full_name", "work_email"], rows, "names.coach_directory")
    # students (kept when a keep-list teacher owns the list or enrolled them)
    cur.execute("""select s.id::text, s.date_of_birth is not null from students s
                   left join student_lists l on l.id = s.list_id
                  where coalesce(l.user_id, s.enrolled_by_user_id) is null
                     or coalesce(l.user_id, s.enrolled_by_user_id) in (select id from nk_users)""")
    stu = cur.fetchall()
    scrub_students = {sid for sid, _ in stu}
    cur.execute("select id::text, father_name is not null, student_name_urdu is not null, father_name_urdu is not null,"
                " to_char(date_trunc('year', date_of_birth), 'YYYY-MM-DD') from students where id::text = any(%s)",
                (list(scrub_students),))
    rows = []
    for sid, has_f, has_su, has_fu, dob in cur.fetchall():
        rows.append(((sid,), (ss.fake_name("S:" + sid, salt, "student"),
                              ss.fake_name("S:" + sid, salt, "parent") if has_f else None,
                              ss.fake_name_ur("S:" + sid, salt, "student") if has_su else None,
                              ss.fake_name_ur("S:" + sid, salt, "parent") if has_fu else None, dob)))
    apply("students", ["student_name", "father_name", "student_name_urdu", "father_name_urdu", "date_of_birth"], rows,
          "names.students", {"date_of_birth": "date"})
    cur.execute("select id::text from students")
    kept_students = {r[0] for r in cur.fetchall()} - scrub_students
    # student names copied onto other rows
    for table, owner_sql in (("attendance_records", "(select user_id from attendance_sessions x where x.id = t.session_id)"),
                             ("quiz_sessions", "t.user_id"),
                             ("exam_submissions", "(select user_id from exam_check_sessions x where x.id = t.session_id)")):
        cur.execute(f"select t.id::text, t.student_id::text, {owner_sql}::text from {table} t where t.student_name is not null")
        rows = []
        for rid, sid, owner in cur.fetchall():
            if sid:
                if sid in kept_students:
                    continue
                seed = "S:" + sid
            else:
                if owner and owner in keep_ids:
                    continue
                seed = f"{table}:{rid}"
            rows.append(((rid,), (ss.fake_name(seed, salt, "student"),)))
        apply(table, ["student_name"], rows, f"names.{table}")


def plan_r2(cur, inventory, keep_ids, keep_nat, run):
    """Objects under personal-media prefixes that no keep-list account owns. Owners come from the key itself."""
    cur.execute("select id::text, user_id::text, observer_user_id::text from coaching_sessions")
    cs_owner = {i: {u, o} for i, u, o in cur.fetchall()}
    cur.execute("select id::text, coach_user_id::text from child_test_sessions")
    cts_owner = {i: c for i, c in cur.fetchall()}
    cur.execute("select id::text, observer_user_id::text, teacher_user_id::text from observation_field_forms")
    off_owner = {i: {o, t} for i, o, t in cur.fetchall()}
    cur.execute("""select r.id::text, coalesce(c.created_by_user_id, q.teacher_user_id)::text from web_quiz_challenge_runs r
                   left join classes c on c.id = r.class_id left join quiz_share_codes q on q.id = r.share_code_id""")
    run_owner = {i: o for i, o in cur.fetchall()}
    cur.execute("select distinct school_id::text from users where id = any(%s::uuid[]) and school_id is not null",
                (list(keep_ids),))
    keep_schools = {r[0] for r in cur.fetchall()}
    user_keyed = ("classroom_audio", "voice_debriefs", "reports", "images", "exams", "certs", "reflection_audio",
                  "feedback_audio", "feedback_images", "transcript_quizzes")
    plan, why = [], collections.Counter()
    size = 0
    for line in open(inventory):
        o = json.loads(line)
        k = o["k"]
        top = k.split("/")[0]
        us = UUID_RE.findall(k)
        delete = None
        if top == "audio":
            f = ss.find_phones("/" + k.split("/")[1] + "/") if k.count("/") >= 2 else []
            if f and not (f[0].cls == "pk" and f[0].national in keep_nat):
                delete = "audio_by_phone"
            elif not f and k.count("/") >= 2:
                delete = "audio_unowned"
        elif top in user_keyed:
            if us and us[0] not in keep_ids:
                delete = f"{top}_not_keep"
        elif top == "lesson_plans" and us and k.startswith("lesson_plans/" + us[0]):
            if us[0] not in keep_ids:
                delete = "lesson_plans_user_not_keep"
        elif top in ("coachip", "observe-reports") and "/sandbox/" in k or top == "observe-reports":
            sid = us[0] if us else None
            if not sid or not (cs_owner.get(sid, set()) & set(keep_ids)):
                delete = f"{top}_session_not_keep"
        elif top == "observe2":
            if not us or not (off_owner.get(us[0], set()) & set(keep_ids)):
                delete = "observe2_not_keep"
        elif k.startswith("child-test/sandbox/"):
            sid = us[1] if len(us) > 1 else None
            if not sid or cts_owner.get(sid) not in keep_ids:
                delete = "child_test_not_keep"
        elif k.startswith("child-voice/"):
            rid = us[-1] if us else None
            if not rid or run_owner.get(rid) not in keep_ids:
                delete = "child_voice_not_keep"
        elif top == "reading_voice_feedback":
            delete = "reading_voice_feedback_unowned"
        elif top == "registers":
            if not us or us[0] not in keep_schools:
                delete = "registers_not_keep"
        if delete:
            plan.append({"k": k, "s": o["s"], "why": delete})
            why[delete] += 1
            size += o["s"]
    for w, n in why.most_common():
        run.count(f"r2.plan.{w}", n)
    run.count("r2.plan.objects", len(plan))
    run.count("r2.plan.megabytes", round(size / 1e6))
    return plan


def scan(cur, keep_ids, run):
    """Counts of real-looking phones (pk spelling, not a keep-list number; any masked 99 spelling) and of users with
    real-looking names outside the keep-list. True when both are zero."""
    cur.execute("select phone_number from users where id = any(%s::uuid[])", (list(keep_ids),))
    keep_nat = set()
    for (p,) in cur.fetchall():
        for f in ss.find_phones(p or ""):
            if f.cls == "pk":
                keep_nat.add(f.national)
    left = 0
    per = collections.Counter()
    for (s, t), cs in texty_columns(cur, ("public", "auth", "storage", "ops")).items():
        _pk, rows = phone_hit_rows(cur, s, t, cs)
        for _ident, vals in rows:
            for c, v in vals.items():
                for f in ss.find_phones(v or ""):
                    if ss.is_real_national(f.national) and not (f.cls == "pk" and f.national in keep_nat):
                        left += 1
                        per[f"{t}.{c}"] += 1
    for k, n in per.most_common():
        run.count(f"scan.phone_left.{k}", n)
    run.count("scan.real_phones_outside_keep_list", left)
    cur.execute(r"""select count(*) from users u
                     where not (u.id = any(%s::uuid[]))
                       and u.name is not null and u.name !~ '(Dummy|ڈمی) [0-9]{4}$'
                       and u.phone_number ~ '^(92|99)3[0-9]{9}$' and u.phone_number !~ '^9[29]399'""", (list(keep_ids),))
    names_left = cur.fetchone()[0]
    run.count("scan.real_named_users_with_real_phone_outside_keep_list", names_left)
    cur.execute(r"""select count(*) from users u where not (u.id = any(%s::uuid[])) and u.name is not null
                      and u.name !~ '(Dummy|ڈمی) [0-9]{4}$' and u.source ~ %s""", (list(keep_ids), REAL_SOURCES_RE.pattern))
    run.count("scan.real_source_users_not_dummy_named", cur.fetchone()[0])
    cur.execute(r"""select count(*) from leader_teachers where teacher_name !~ '(Dummy|ڈمی) [0-9]{4}$'
                      and teacher_phone_e164 ~ '^923[0-9]{9}$' and teacher_phone_e164 !~ '^92399'""")
    run.count("scan.leader_teachers_real_phone_and_name", cur.fetchone()[0])
    cur.execute("select count(*) from conversations where user_id is null or not (user_id = any(%s::uuid[]))", (list(keep_ids),))
    run.count("scan.conversations_outside_keep_list", cur.fetchone()[0])
    return left == 0 and names_left == 0


def write_report(out, run, stamp, mode):
    if not out:
        return
    p = out / f"purge_{mode}_{stamp}.json"
    p.write_text(json.dumps({"mode": mode, "at": stamp, "counts": run.counts}, indent=1, ensure_ascii=False))
    print(f"report: {p}")


def r2_delete(a, env):
    """Download each planned object to --backup-dir, then delete it from the sandbox bucket."""
    import boto3
    from botocore.config import Config
    bucket = env.get("R2_BUCKET_NAME", "")
    ss.refuse_unless_sandbox_bucket(bucket)
    if not a.backup_dir:
        raise SystemExit("--backup-dir is required: objects are backed up before they are deleted")
    bd = Path(a.backup_dir).expanduser().resolve() / "r2"
    bd.mkdir(parents=True, exist_ok=True)
    os.chmod(bd.parent, 0o700)
    endpoint = env.get("R2_ENDPOINT") or f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com"
    s3 = boto3.client("s3", endpoint_url=endpoint, aws_access_key_id=env["R2_ACCESS_KEY_ID"],
                      aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"], region_name="auto",
                      config=Config(retries={"max_attempts": 5}, signature_version="s3v4"))
    plan = [json.loads(x) for x in open(a.r2_delete)]
    workers = max(1, int(getattr(a, "r2_workers", 8) or 8))

    def backup_one(o):
        """'ok' | 'missing'. Resumable: an object already backed up at its planned size is not fetched again."""
        k = o["k"]
        dest = bd / k
        if dest.exists() and dest.stat().st_size == o.get("s"):
            return "ok"
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            s3.download_file(bucket, k, str(dest))
        except Exception as e:  # noqa: BLE001
            if "404" in str(e) or "Not Found" in str(e):
                return "missing"
            raise
        os.chmod(dest, 0o600)
        return "ok"

    from concurrent.futures import ThreadPoolExecutor
    backed, missing, deleted, errors = 0, 0, 0, 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i in range(0, len(plan), 500):
            chunk = plan[i:i + 500]
            results = list(pool.map(backup_one, chunk))  # every object of the chunk is on disk before any delete
            keys = [o["k"] for o, r in zip(chunk, results) if r == "ok"]
            backed += len(keys)
            missing += sum(1 for r in results if r == "missing")
            if keys:
                r = s3.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": x} for x in keys], "Quiet": True})
                errors += len(r.get("Errors", []))
                deleted += len(keys) - len(r.get("Errors", []))
            print(f"  {min(i + 500, len(plan))}/{len(plan)}: backed up {backed}, deleted {deleted}, missing {missing}",
                  flush=True)
    print(json.dumps({"planned": len(plan), "backed_up": backed, "missing": missing, "deleted": deleted, "errors": errors}))
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
