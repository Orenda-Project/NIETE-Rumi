#!/usr/bin/env python3
"""
Move Gilgit-Baltistan from main Rumi into NIETE (bd-97daxo.7): its people, its 15 schools, which coach holds which
school, and its finished coaching sessions, converted into NIETE's own rows. The rules live in
scripts/lib/gb_migration.py and are unit-tested (scripts/tests/test_gb_migration.py); this file only reads, prints
and, with --commit, writes.

  SOURCE  main Rumi production, READ-ONLY: RUMI_SOURCE_DATABASE_URL (the SELECT-only analyst role), one READ ONLY
          transaction. Refused if it names a NIETE project.
  TARGET  --env sandbox | staging | prod, through that env's file (.env.sandbox / .env.stage / .env.prod, or
          --env-file). The file's project ref is checked against --env BEFORE any connection is opened.

  DRY RUN (default; both sides read-only):
    RUMI_SOURCE_DATABASE_URL=... python3 scripts/migrate-gb-from-rumi.py --env sandbox --fake-phones --out <dir>
  WRITE (one transaction, verified, then committed):
    ... --env staging --fake-phones --out <dir> --commit
    ... --env prod --out <dir> --commit --confirm-ref ihzciabopbttygxxgrkm      (+ GB_MIGRATION_PROD_GO=yes)

  --fake-phones  REQUIRED for sandbox/staging, refused for prod: every person gets a deterministic number in the
                 unallocated 0399-7 block, so a non-production bot can never message a real teacher.
  --check-files  HEAD every coaching file with the target env's R2 credentials (read-only) and count what it can read.
  --copy-files   with --commit: copy coaching files whose bucket is not the target env's bucket into it and point
                 the rows there. Production and staging use the bucket main Rumi wrote them to, so nothing moves.
  --with-tokens-raw  also carry coaching_sessions.tokens_raw (raw ASR tokens, ~127 MB for GB). Off by default: only
                 the observability transcript viewer reads it, for word timings, and it renders without them.

Re-runs are safe: ids are uuid5 of the main-Rumi ids, so a second run finds its own rows. Users are filled, never
overwritten (a field NIETE already holds stays); schools refresh name/region; leader links and sessions are
insert-if-absent. A source person whose REAL phone already belongs to a NIETE account is listed and skipped, with
everything that hangs off them. The run writes a mapping file (main-Rumi id → NIETE id, fake phones, collisions,
the report) to --out.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import gb_migration as gb  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
ENV_FILES = {"sandbox": ".env.sandbox", "staging": ".env.stage", "prod": ".env.prod"}
HOSTS = {"sandbox": "aws-0-ap-southeast-1.pooler.supabase.com", "staging": "aws-1-ap-south-1.pooler.supabase.com",
         "prod": "aws-1-ap-south-1.pooler.supabase.com"}
USER_JSONB = {"subjects_taught", "preferences"}
SESSION_JSONB = {"diarization_data", "analysis_data", "conversation_state", "lesson_plan_structured", "tokens_raw",
                 "silence_markers", "prioritized_action", "classroom_photos", "autofill_analysis_data"}


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


# ── source (main Rumi, read-only) ─────────────────────────────────────────────────────────────────────
PEOPLE_SQL = """
    SELECT u.id::text AS id, u.phone_number, u.name, u.first_name, u.last_name, u.role, u.organization, u.region,
           u.school_id::text AS school_id, u.school_name, u.preferred_language, u.language_locked,
           u.grades_taught, u.subjects_taught, u.registration_completed, u.registration_completed_at, u.created_at
    FROM users u LEFT JOIN schools s ON s.id = u.school_id
    WHERE coalesce(u.is_test_user, false) = false
      AND (u.region = 'gilgit_baltistan' OR s.region = 'gilgit_baltistan')
"""  # the scope of workbench/gb_teacher_list.sql (bd-97daxo.1)


def read_source(dsn, with_tokens_raw=False):
    gb.assert_source(dsn)
    conn = psycopg2.connect(dsn, cursor_factory=psycopg2.extras.RealDictCursor)
    conn.set_session(readonly=True, autocommit=False)
    try:
        with conn.cursor() as cur:
            cur.execute(PEOPLE_SQL)
            people = [dict(r) for r in cur.fetchall()]
            ids = [p["id"] for p in people]
            cur.execute("SELECT id::text AS id, name, emis, ext_id, region, source FROM schools "
                        "WHERE region = 'gilgit_baltistan'")
            schools = [dict(r) for r in cur.fetchall()]
            cur.execute("SELECT leader_user_id::text AS leader_user_id, school_id::text AS school_id, school_ext_id, "
                        "school_name, emis FROM leader_schools "
                        "WHERE removed_at IS NULL AND leader_user_id = ANY(%s::uuid[])", (ids,))
            leader_schools = [dict(r) for r in cur.fetchall()]
            cur.execute("SELECT leader_user_id::text AS leader_user_id, teacher_user_id::text AS teacher_user_id, "
                        "school_id::text AS school_id, school_ext_id FROM leader_teachers "
                        "WHERE removed_at IS NULL AND (leader_user_id = ANY(%s::uuid[]) "
                        "OR teacher_user_id = ANY(%s::uuid[]))", (ids, ids))
            leader_teachers = [dict(r) for r in cur.fetchall()]
            # Ids first, one indexed lookup per side (an OR across both, with the wide rows, outruns the analyst
            # role's statement timeout), then the rows by primary key in small batches.
            session_ids = set()
            for col in ("user_id", "observer_user_id"):
                cur.execute(f"SELECT id::text AS id FROM coaching_sessions WHERE {col} = ANY(%s::uuid[]) "
                            f"AND status = ANY(%s)", (ids, list(gb.COACHING_STATUSES)))
                session_ids |= {r["id"] for r in cur.fetchall()}
            # tokens_raw (raw ASR tokens, read only by the observability transcript viewer, which renders without
            # it) is ~127 MB as text for GB's 203 sessions, against ~8 MB for everything else: opt-in.
            copy_cols = ", ".join("NULL::jsonb AS tokens_raw" if c == "tokens_raw" and not with_tokens_raw else c
                                  for c in gb.SESSION_COPY)
            batch = 5 if with_tokens_raw else 25
            sessions, ordered = [], sorted(session_ids)
            for i in range(0, len(ordered), batch):
                cur.execute(f"SELECT id::text AS id, user_id::text AS user_id, "
                            f"observer_user_id::text AS observer_user_id, "
                            f"duplicate_of_session_id::text AS duplicate_of_session_id, {copy_cols} "
                            f"FROM coaching_sessions WHERE id = ANY(%s::uuid[])", (ordered[i:i + batch],))
                sessions += [dict(r) for r in cur.fetchall()]
        conn.rollback()
    finally:
        conn.close()
    return {"people": people, "schools": schools, "leader_schools": leader_schools,
            "leader_teachers": leader_teachers, "sessions": sessions}


# ── target (NIETE) ────────────────────────────────────────────────────────────────────────────────────
def connect_target(env, env_name, writable):
    ref = gb.assert_target(env_name, env)       # before any connection
    if env.get("DATABASE_URL"):
        conn = psycopg2.connect(env["DATABASE_URL"], cursor_factory=psycopg2.extras.RealDictCursor)
    else:
        conn = psycopg2.connect(host=HOSTS[env_name], port=5432, user=f"postgres.{ref}",
                                password=env["SUPABASE_DB_PASSWORD"], dbname="postgres",
                                cursor_factory=psycopg2.extras.RealDictCursor)
    conn.set_session(isolation_level="REPEATABLE READ", readonly=not writable, autocommit=False)
    return conn, ref


WRITTEN = {"users": gb.USER_COLUMNS, "schools": gb.SCHOOL_COLUMNS + ("principal_user_id",),
           "leader_schools": gb.LEADER_SCHOOL_COLUMNS, "coaching_sessions": gb.SESSION_COLUMNS}


def read_target(cur, src):
    cur.execute("SELECT phone_number, id::text AS id FROM users")
    phones = {r["phone_number"]: r["id"] for r in cur.fetchall()}
    cur.execute("SELECT emis, id::text AS id FROM schools WHERE emis IS NOT NULL")
    emis = {r["emis"]: r["id"] for r in cur.fetchall()}
    cur.execute("SELECT upper(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) AS c, coalesce(region, '') AS r, "
                "id::text AS id FROM schools WHERE emis IS NULL")
    canon = {(r["c"], r["r"]): r["id"] for r in cur.fetchall()}

    def present(table, ids):
        cur.execute(f"SELECT id::text AS id FROM {table} WHERE id = ANY(%s::uuid[])", (list(ids),))
        return {r["id"] for r in cur.fetchall()}

    tgt = {"phones": phones, "emis": emis, "canon_name_region": canon,
           "user_ids": present("users", [gb.niete_id("users", p["id"]) for p in src["people"]]),
           "school_ids": present("schools", [gb.niete_id("schools", s["id"]) for s in src["schools"]]),
           "session_ids": present("coaching_sessions",
                                  [gb.niete_id("coaching_sessions", s["id"]) for s in src["sessions"]])}

    # Prerequisites: the GB region row (V1.8.5) and every column this run writes.
    pre = {}
    cur.execute("SELECT organization, display_name FROM region_features WHERE region = 'gilgit-baltistan'")
    row = cur.fetchone()
    if not row or row.get("organization") != "moawin" or row.get("display_name") != gb.GB_REGION:
        pre["region_registry_missing_gb"] = ["apply V1.8.5__region_registry.sql to this database first"]
    for table, cols in WRITTEN.items():
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' "
                    "AND table_name = %s", (table,))
        have = {r["column_name"] for r in cur.fetchall()}
        missing = sorted(set(cols) - have)
        if missing:
            pre.setdefault("missing_columns", []).append({table: missing})
    return tgt, pre


def _json(value):
    return psycopg2.extras.Json(value, dumps=lambda o: json.dumps(o, default=str))


def _values(rows, cols, jsonb=()):
    """Row tuples in column order; jsonb columns wrapped (a Python list would otherwise go in as an ARRAY)."""
    return [tuple(_json(r[c]) if c in jsonb and r[c] is not None else r[c] for c in cols) for r in rows]


def write(conn, p):
    """Every planned row, in one transaction, re-read and counted before COMMIT."""
    ev = psycopg2.extras.execute_values
    with conn.cursor() as cur:
        cur.execute("SET LOCAL lock_timeout = '5s'")
        cur.execute("SET LOCAL statement_timeout = '120s'")

        cols = gb.SCHOOL_COLUMNS
        ev(cur, f"INSERT INTO schools ({', '.join(cols)}) VALUES %s ON CONFLICT (id) DO UPDATE SET "
                "name = EXCLUDED.name, region = EXCLUDED.region, updated_at = now() "
                "WHERE schools.source_system = 'main_rumi'", _values(p["schools"], cols))

        cols = gb.USER_COLUMNS
        ev(cur, f"INSERT INTO users ({', '.join(cols)}) VALUES %s ON CONFLICT (id) DO UPDATE SET "
                "name = COALESCE(users.name, EXCLUDED.name), region = COALESCE(users.region, EXCLUDED.region), "
                "organization = COALESCE(users.organization, EXCLUDED.organization), "
                "role = COALESCE(users.role, EXCLUDED.role), school_id = COALESCE(users.school_id, EXCLUDED.school_id), "
                "school_name = COALESCE(users.school_name, EXCLUDED.school_name), "
                "preferences = COALESCE(users.preferences, '{}'::jsonb) "
                "|| jsonb_build_object('main_rumi', EXCLUDED.preferences -> 'main_rumi')",
           _values(p["users"], cols, USER_JSONB))

        if p["school_principals"]:
            ev(cur, "UPDATE schools SET principal_user_id = v.u::uuid, updated_at = now() "
                    "FROM (VALUES %s) AS v(s, u) WHERE schools.id = v.s::uuid AND schools.principal_user_id IS NULL",
               list(p["school_principals"].items()))

        cols = gb.LEADER_SCHOOL_COLUMNS
        if p["leader_schools"]:
            ev(cur, f"INSERT INTO leader_schools ({', '.join(cols)}) VALUES %s ON CONFLICT DO NOTHING",
               _values(p["leader_schools"], cols))

        cols = gb.SESSION_COLUMNS
        if p["coaching_sessions"]:
            ev(cur, f"INSERT INTO coaching_sessions ({', '.join(cols)}) VALUES %s ON CONFLICT (id) DO NOTHING",
               _values(p["coaching_sessions"], cols, SESSION_JSONB), page_size=5)

        # verify: every planned row is there
        def count(table, ids):
            cur.execute(f"SELECT count(*) AS n FROM {table} WHERE id = ANY(%s::uuid[])", (list(ids),))
            return cur.fetchone()["n"]
        problems = []
        for table, rows in (("schools", p["schools"]), ("users", p["users"]), ("coaching_sessions", p["coaching_sessions"])):
            n = count(table, [r["id"] for r in rows])
            if n != len(rows):
                problems.append(f"{table}: {n} of {len(rows)} present")
        # a link may already exist under another id (a coach added the school in NIETE): the link is what counts
        links = [f"{r['leader_user_id']}|{r['school_ext_id']}" for r in p["leader_schools"]]
        cur.execute("SELECT count(DISTINCT (leader_user_id, school_ext_id)) AS n FROM leader_schools "
                    "WHERE source = 'niete_ict' AND leader_user_id::text || '|' || school_ext_id = ANY(%s)", (links,))
        n = cur.fetchone()["n"]
        if n != len(p["leader_schools"]):
            problems.append(f"leader_schools: {n} of {len(p['leader_schools'])} present")
    if problems:
        conn.rollback()
        raise SystemExit("ABORT (rolled back): " + "; ".join(problems))
    conn.commit()


# ── files ─────────────────────────────────────────────────────────────────────────────────────────────
def r2_client(env):
    import boto3
    from botocore.config import Config
    return boto3.client("s3", endpoint_url=env["R2_ENDPOINT"], aws_access_key_id=env["R2_ACCESS_KEY_ID"],
                        aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"], region_name="auto",
                        config=Config(signature_version="s3v4", retries={"max_attempts": 3}))


def file_list(sessions):
    return [(s["id"], f, url) for s in sessions for f, url in gb.session_files(s)]


def check_files(env, sessions):
    """HEAD every file with the target env's credentials (read-only)."""
    from botocore.exceptions import ClientError
    client, seen = r2_client(env), {"readable": 0, "missing_or_denied": 0, "by_bucket": {}}
    for _, _, url in file_list(sessions):
        bucket, key = gb.bucket_and_key(url)
        seen["by_bucket"][bucket] = seen["by_bucket"].get(bucket, 0) + 1
        try:
            client.head_object(Bucket=bucket, Key=key)
            seen["readable"] += 1
        except ClientError:
            seen["missing_or_denied"] += 1
    return seen


def copy_files(source_env, target_env, sessions):
    """Copy every file not already in the target bucket, then point the rows at the copies."""
    bucket = target_env["R2_BUCKET_NAME"]
    src, dst = r2_client(source_env), r2_client(target_env)
    copied = 0
    for _, _, url in file_list(sessions):
        sb, key = gb.bucket_and_key(url)
        if sb == bucket:
            continue
        obj = src.get_object(Bucket=sb, Key=key)
        dst.put_object(Bucket=bucket, Key=key, Body=obj["Body"].read(),
                       ContentType=obj.get("ContentType") or "application/octet-stream")
        copied += 1
    rows = [gb.rehost_session(s, target_env["R2_ENDPOINT"], bucket) for s in sessions]
    return rows, copied


# ── main ──────────────────────────────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env", required=True, choices=sorted(gb.TARGET_REFS))
    ap.add_argument("--env-file", default=None, help="default: .env.sandbox / .env.stage / .env.prod")
    ap.add_argument("--out", required=True, help="directory for the mapping + report JSON (keep it out of git)")
    ap.add_argument("--fake-phones", action="store_true")
    ap.add_argument("--commit", action="store_true", help="write; default is a read-only dry run")
    ap.add_argument("--confirm-ref", default=None, help="with --commit on prod: the prod project ref, typed out")
    ap.add_argument("--check-files", action="store_true", help="HEAD every coaching file with the target's R2 creds")
    ap.add_argument("--copy-files", action="store_true", help="with --commit: copy files into the target bucket")
    ap.add_argument("--source-r2-env", default=None, help="env file whose R2 creds can read main Rumi's bucket")
    ap.add_argument("--with-tokens-raw", action="store_true",
                    help="also carry coaching_sessions.tokens_raw (~127 MB for GB; the transcript viewer's word timings)")
    a = ap.parse_args()

    refusal = gb.run_refusal(a.env, fake=a.fake_phones, commit=a.commit, confirm_ref=a.confirm_ref,
                             go=os.environ.get("GB_MIGRATION_PROD_GO"))
    if refusal:
        raise SystemExit(f"ABORT: {refusal}")
    env_path = Path(a.env_file) if a.env_file else REPO / ENV_FILES[a.env]
    env = read_env(env_path)
    ref = gb.assert_target(a.env, env)          # before any connection, either side
    mode = "COMMIT" if a.commit else "DRY RUN"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    print(f"=== migrate-gb-from-rumi [{mode}] env={a.env} target={ref} fake_phones={a.fake_phones} ===")

    src = read_source(os.environ.get("RUMI_SOURCE_DATABASE_URL", ""), with_tokens_raw=a.with_tokens_raw)
    print(f"source (read-only): people={len(src['people'])} schools={len(src['schools'])} "
          f"leader_schools={len(src['leader_schools'])} leader_teachers={len(src['leader_teachers'])} "
          f"sessions={len(src['sessions'])}")

    conn, _ = connect_target(env, a.env, writable=a.commit)
    try:
        with conn.cursor() as cur:
            tgt, pre = read_target(cur, src)
        p = gb.plan(src, tgt, fake=a.fake_phones, migrated_at=stamp)
        guards = {**pre, **p["guards"]}

        files = file_list(p["coaching_sessions"])
        buckets = {}
        for _, _, url in files:
            b = gb.bucket_and_key(url)[0]
            buckets[b] = buckets.get(b, 0) + 1
        file_report = {"files": len(files), "by_bucket": buckets, "target_bucket": env.get("R2_BUCKET_NAME"),
                       "not_in_target_bucket": sum(n for b, n in buckets.items() if b != env.get("R2_BUCKET_NAME"))}
        if a.check_files:
            file_report["head_with_target_creds"] = check_files(env, p["coaching_sessions"])

        r = p["report"]
        print(f"schools        write={len(p['schools'])} (existing {len(tgt['school_ids'])}) "
              f"principals_set={len(p['school_principals'])}")
        print(f"users          write={len(p['users'])} (existing {r['users_existing']}) "
              f"collisions_skipped={len(p['collisions'])} without_school={r['users_without_school']} "
              f"school_from_roster={r['school_inferred_from_roster']}")
        print(f"  roles        {r['roles']}")
        print(f"  orgs         {r['organizations']}")
        print(f"leader_schools write={len(p['leader_schools'])} duplicates={r['leader_schools_duplicate']} "
              f"unresolved={r['leader_schools_unresolved_school']} "
              f"leader_not_migrated={r['leader_schools_skipped_leader_not_migrated']}")
        print(f"  roster vs NIETE's derived patch: {r['patch_coverage']}")
        print(f"sessions       write={len(p['coaching_sessions'])} (existing {len(tgt['session_ids'])}) "
              f"frameworks={r['session_frameworks']} observer_link_dropped={r['sessions_observer_link_dropped']} "
              f"teacher_not_migrated={r['sessions_skipped_teacher_not_migrated']}")
        print(f"files          {file_report}")
        for c in p["collisions"]:
            print(f"  COLLISION main_rumi={c['main_rumi_user_id']} phone={c['phone']} role={c['role']} "
                  f"org={c['organization']} → existing NIETE user {c['niete_user_id']} (not overwritten)")
        print(f"guards (each must be empty): {guards or 'none'}")

        out = Path(a.out)
        out.mkdir(parents=True, exist_ok=True)
        path = out / f"gb-migration-{a.env}-{stamp}-{'commit' if a.commit else 'dryrun'}.json"
        path.write_text(json.dumps({
            "env": a.env, "target_ref": ref, "mode": mode, "fake_phones": a.fake_phones, "written_at": stamp,
            "counts": {k: len(p[k]) for k in ("schools", "users", "leader_schools", "coaching_sessions", "collisions")},
            "report": r, "files": file_report, "guards": guards, "collisions": p["collisions"],
            "unresolved_leader_schools": p["unresolved_leader_schools"], "mapping": p["mapping"],
        }, indent=2, default=str))
        print(f"mapping + report: {path}")

        if guards:
            conn.rollback()
            raise SystemExit("ABORT: a guard is not empty; nothing written.")
        if not a.commit:
            conn.rollback()
            print("DRY RUN — nothing written.")
            return

        if a.copy_files and file_report["not_in_target_bucket"]:
            if not a.source_r2_env:
                raise SystemExit("ABORT: --copy-files needs --source-r2-env <env file that can read main Rumi's bucket>")
            p["coaching_sessions"], copied = copy_files(read_env(a.source_r2_env), env, p["coaching_sessions"])
            print(f"copied {copied} files into {env['R2_BUCKET_NAME']}")
        write(conn, p)
        print(f"COMMITTED: schools={len(p['schools'])} users={len(p['users'])} "
              f"leader_schools={len(p['leader_schools'])} sessions={len(p['coaching_sessions'])}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
