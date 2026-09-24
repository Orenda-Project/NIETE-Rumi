#!/usr/bin/env python3
"""
Read-only: which migrations are REALLY applied on one environment, and which are recorded.

The ledger (schema_versions) and the database disagree: most migrations since 1.3.6 were
applied by hand and never recorded, because the runner's insert named columns the ledger
does not have. This reports, per migration file, both halves side by side:

  recorded   is there a schema_versions row for its version?
  verdict    does the database carry what the file creates?
               applied        every object that counts is there, with strong evidence
               not_applied    its objects are missing
               partial        some are there, some are not — look before doing anything
               unverifiable   data-only, or it only re-creates objects that may predate it

A file the catalog cannot prove this way (data-only, CREATE OR REPLACE, drop-then-create)
gets one hand-written check of the effect it leaves behind (EFFECT_CHECKS), which settles it
as applied or not_applied — or partial, when the two disagree.

Every probe is a read (information_schema / pg_catalog / a NOT EXISTS over a table) inside
a READ ONLY transaction that is rolled back, each fenced by a savepoint so one failing read
is reported under PROBE ERRORS instead of ending the audit. Nothing is written. The closing section prints the
schema_versions rows that WOULD reconcile the ledger for files verified as applied — for a
human to review and run; this script never runs them.

  python3 scripts/schema-ledger-audit.py --plan                       # no database: what each file is checked by
  python3 scripts/schema-ledger-audit.py --target sandbox --env-file .env.sandbox
  python3 scripts/schema-ledger-audit.py --target prod    --env-file .env.prod
  # against the folder of the branch that deploys there:
  git archive origin/staging infrastructure/supabase/migrations | tar -x -C /tmp/stg
  python3 scripts/schema-ledger-audit.py --target staging --env-file .env.staging \
      --migrations /tmp/stg/infrastructure/supabase/migrations

Run it once per environment. Each run refuses unless the env file points at the project the
--target names, so a sandbox env file can never be audited as production.
"""
import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import schema_ledger as ledger  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
MIGRATIONS = REPO / "infrastructure" / "supabase" / "migrations"
TARGETS = {
    "sandbox": {"ref": "olvritwoqujtjvwfulbh", "host": "aws-0-ap-southeast-1.pooler.supabase.com"},
    "staging": {"ref": "rpqkekcfvumypldbejhp", "host": "aws-1-ap-south-1.pooler.supabase.com"},
    "prod":    {"ref": "ihzciabopbttygxxgrkm", "host": "aws-1-ap-south-1.pooler.supabase.com"},
}
# Changes made outside any file in this folder, checked by hand-written probes.
#
# (label, sql, params). A value — a LIKE pattern above all — goes in params, never in the SQL
# text: psycopg2 %-interpolates the text whenever params is given, even an empty tuple, so a
# literal `%` in it raises before the query reaches the server. That is exactly how the first
# live run died, in this section, after the per-migration table had already printed.
MARKERS = [
    ("add-schools STEP 4: users.role NOT NULL",
     "SELECT is_nullable = 'NO' FROM information_schema.columns "
     "WHERE table_schema='public' AND table_name='users' AND column_name='role'",
     None),
    ("observe columns: coaching_sessions.autofill_analysis_data",
     "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' "
     "AND table_name='coaching_sessions' AND column_name='autofill_analysis_data')",
     None),
]

# Files the catalog alone cannot prove — data-only, CREATE OR REPLACE, or dropping and
# re-creating what they touch — each get ONE read-only check of the effect they leave
# behind: {filename: (label, sql, params)}, True when the effect is there. Same parameter
# rule as MARKERS. Checks never name a column that may have been dropped since (to_jsonb
# reads it if present), and use to_regclass / to_regprocedure so a missing object is a
# "no", not an error.
EFFECT_CHECKS = {
    "V1.0.3__users_teacher_uuid_backfill.sql": (
        "every legacy uuid in users.preferences is on users.teacher_uuid",
        "SELECT NOT EXISTS (SELECT 1 FROM users "
        "WHERE (preferences->'taleemabad'->>'uuid') IS NOT NULL "
        "AND teacher_uuid::text IS DISTINCT FROM preferences->'taleemabad'->>'uuid')",
        None),
    "V1.1.2__one_certificate_per_user_level.sql": (
        "training_certificates_user_level_uniq is a UNIQUE constraint",
        "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = %s AND contype = 'u' "
        "AND conrelid = to_regclass('public.training_certificates'))",
        ("training_certificates_user_level_uniq",)),
    "V1.1.5__preferred_language_default_ur.sql": (
        "users.preferred_language defaults to 'ur'",
        "SELECT coalesce((SELECT starts_with(coalesce(column_default, ''), %s) "
        "FROM information_schema.columns WHERE table_schema = 'public' "
        "AND table_name = 'users' AND column_name = 'preferred_language'), false)",
        ("'ur'",)),
    "V1.1.8__users_training_bands.sql": (
        "users carries the band column, as training_bands or as teacher_level (V1.4.5 renames it)",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' "
        "AND table_name = 'users' AND column_name IN (%s, %s))",
        ("training_bands", "teacher_level")),
    "V1.2.3__leader_roster_audit.sql": (
        "leader_roster_audit and its service-role policy exist (V1.2.2 makes the same; re-running is idempotent)",
        "SELECT to_regclass('public.leader_roster_audit') IS NOT NULL AND EXISTS "
        "(SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'leader_roster_audit' "
        "AND policyname = %s)",
        ("service_role_leader_roster_audit",)),
    "V1.2.4__deprecate_leader_teachers.sql": (
        "leader_teachers carries the DEPRECATED comment",
        # to_regclass, not ::regclass: a database without the table answers "no", not an
        # error that aborts the transaction.
        "SELECT coalesce(obj_description(to_regclass('public.leader_teachers')), '') ILIKE %s",
        ("DEPRECATED%",)),
    "V1.3.2__lp612_atomic_waiter_join.sql": (
        "lp612_join_waiters(uuid, jsonb) exists",
        "SELECT to_regprocedure(%s) IS NOT NULL",
        ("public.lp612_join_waiters(uuid,jsonb)",)),
    "V1.3.4__lp612_claim_waiters.sql": (
        "lp612_claim_waiters(uuid) exists",
        "SELECT to_regprocedure(%s) IS NOT NULL",
        ("public.lp612_claim_waiters(uuid)",)),
    "V1.4.1__enrollment_roster_correction.sql": (
        "class_enrollments_outcome_check allows roster_correction",
        "SELECT coalesce((SELECT position(%s in pg_get_constraintdef(oid)) > 0 FROM pg_constraint "
        "WHERE conrelid = to_regclass('public.class_enrollments') "
        "AND conname = 'class_enrollments_outcome_check'), false)",
        ("roster_correction",)),
    "V1.4.3__backfill_name_from_split_columns.sql": (
        "no user has an empty name beside a non-empty first/last name",
        "SELECT NOT EXISTS (SELECT 1 FROM users u WHERE coalesce(trim(u.name), '') = '' "
        "AND (coalesce(trim(to_jsonb(u)->>'first_name'), '') <> '' "
        "OR coalesce(trim(to_jsonb(u)->>'last_name'), '') <> ''))",
        None),
    # V1.4.7 and V1.4.9 are on the promotion branches (staging, main) and not yet on sandbox;
    # they are here so a staging or production database can be audited against its own folder.
    "V1.4.7__roster_audit_edit_actions.sql": (
        "leader_roster_audit_action_check admits edit_phone_escalated",
        "SELECT coalesce((SELECT position(%s in pg_get_constraintdef(oid)) > 0 FROM pg_constraint "
        "WHERE conname = 'leader_roster_audit_action_check' "
        "AND conrelid = to_regclass('public.leader_roster_audit')), false)",
        ("edit_phone_escalated",)),
    "V1.4.9__phone_number_fits_merge_tombstone.sql": (
        "users.phone_number is 64 wide and leader_roster_audit_action_check admits edit_role",
        "SELECT coalesce((SELECT character_maximum_length >= 64 FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'phone_number'), false) "
        "AND coalesce((SELECT position(%s in pg_get_constraintdef(oid)) > 0 FROM pg_constraint "
        "WHERE conname = 'leader_roster_audit_action_check' "
        "AND conrelid = to_regclass('public.leader_roster_audit')), false)",
        ("edit_role",)),
    "V1.4.8__record_history_watches_teacher_level.sql": (
        "users_history_trigger watches teacher_level",
        "SELECT coalesce((SELECT position(%s in pg_get_triggerdef(t.oid)) > 0 FROM pg_trigger t "
        "WHERE t.tgname = 'users_history_trigger' AND t.tgrelid = to_regclass('public.users') "
        "AND NOT t.tgisinternal), false)",
        ("'teacher_level'",)),
}


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
    m = re.search(r"postgres\.([a-z0-9]{20})[:@]", env.get("DATABASE_URL", ""))
    if m:
        return m.group(1)
    m = re.match(r"https://([a-z0-9]+)\.supabase\.co", env.get("SUPABASE_URL", ""))
    return m.group(1) if m else None


def connect(env, target):
    import psycopg2
    import psycopg2.extras

    want, have = TARGETS[target]["ref"], ref_of(env)
    if have != want:
        raise SystemExit(f"ABORT: env points at '{have}' but --target {target} expects '{want}'.")
    if env.get("DATABASE_URL"):
        conn = psycopg2.connect(env["DATABASE_URL"], cursor_factory=psycopg2.extras.RealDictCursor)
    else:
        conn = psycopg2.connect(host=TARGETS[target]["host"], port=5432, user=f"postgres.{want}",
                                password=env["SUPABASE_DB_PASSWORD"], dbname="postgres",
                                cursor_factory=psycopg2.extras.RealDictCursor)
    conn.set_session(readonly=True, autocommit=False)
    return conn


def migration_files(directory=None):
    """The migration files to audit. Default: this checkout's. Audit an environment against
    the folder of the branch that DEPLOYS to it (e.g. `git archive origin/staging
    infrastructure/supabase/migrations`), or files that only that branch carries are invisible."""
    root = Path(directory) if directory else MIGRATIONS
    return [(p.name, p.read_text(encoding="utf-8")) for p in sorted(root.glob("*.sql"))]


def print_plan(plan):
    for e in plan:
        print(f"V{e['version']:<8} {e['filename']}")
        if not e["probes"]:
            print("           (no probe: data-only or unparsed — check by hand)")
        for p in e["probes"]:
            print(f"           {p['strength']:<10} {ledger.describe(p['probe'])}")


def scalar(cur, sql, params=None):
    # None, never an empty tuple: psycopg2 only leaves the SQL text alone when params is None.
    cur.execute(sql, params if params else None)
    row = cur.fetchone()
    return list(row.values())[0] if row else None


def checked(cur, sql, params=None):
    """(value, error). Each read is fenced by a savepoint: without one, a single failing
    probe aborts the transaction and every read after it fails too — the first live run
    lost its whole summary that way."""
    cur.execute("SAVEPOINT probe")
    try:
        val = scalar(cur, sql, params)
    except Exception as exc:  # report it, never let it end the audit
        cur.execute("ROLLBACK TO SAVEPOINT probe")
        return None, (str(exc).strip().splitlines() or [type(exc).__name__])[0]
    cur.execute("RELEASE SAVEPOINT probe")
    return val, None


def audit(conn, target, plan):
    with conn.cursor() as cur:
        cur.execute("SELECT version FROM schema_versions")
        recorded = {r["version"] for r in cur.fetchall()}
        files = [e["filename"] for e in plan]
        d = ledger.diff_versions(files, recorded)

        print(f"[{target}] migration files={len(plan)} ledger rows={len(recorded)}")
        print(f"  ledger rows with NO file ({len(d['unknown_in_ledger'])}): "
              f"{', '.join(d['unknown_in_ledger']) or '-'}")
        print()
        print(f"  {'version':<9} {'recorded':<9} {'verdict':<13} file / what is missing")

        buckets = {"applied_unrecorded": [], "recorded_not_applied": [], "partial": [],
                   "unverifiable_unrecorded": [], "errors": []}
        for e in plan:
            results, notes = [], []
            for p in e["probes"]:
                sql, params = ledger.probe_query(p["probe"])
                val, err = checked(cur, sql, params)
                present = bool(val)
                results.append((p["strength"], present))
                if err:
                    notes.append(f"error: {err} ({ledger.describe(p['probe'])})")
                elif not present and p["strength"] != "superseded":
                    notes.append(f"missing: {ledger.describe(p['probe'])}")
            effect = None
            if e["filename"] in EFFECT_CHECKS:
                label, sql, params = EFFECT_CHECKS[e["filename"]]
                val, err = checked(cur, sql, params)
                if err:
                    notes.append(f"error: {err} (effect: {label})")
                else:
                    effect = bool(val)
                    notes.append(f"effect: {label} — {'yes' if effect else 'NO'}")
            v = ledger.combine(ledger.verdict(results), effect)
            rec = e["version"] in recorded
            print(f"  {e['version']:<9} {'yes' if rec else 'NO':<9} {v:<13} {e['filename']}")
            for n in notes:
                print(f"  {'':<33}{n}")
            if any(n.startswith("error:") for n in notes):
                buckets["errors"].append(e)
            elif v == "applied" and not rec:
                buckets["applied_unrecorded"].append(e)
            elif v == "not_applied" and rec:
                buckets["recorded_not_applied"].append(e)
            elif v == "partial":
                buckets["partial"].append(e)
            elif v == "unverifiable" and not rec:
                buckets["unverifiable_unrecorded"].append(e)

        print()
        print("  live markers (changes made outside this folder):")
        for label, sql, params in MARKERS:
            val, err = checked(cur, sql, params)
            print(f"    {'ERR' if err else ('yes' if val else 'NO ')}  {label}" + (f"  ({err})" if err else ""))

        print()
        print(f"  PROBE ERRORS ({len(buckets['errors'])}) — a read failed; these verdicts are not evidence:")
        for e in buckets["errors"]:
            print(f"    {e['filename']}")
        print(f"  RECORDED BUT NOT APPLIED ({len(buckets['recorded_not_applied'])}) — the ledger claims "
              "work the database does not have:")
        for e in buckets["recorded_not_applied"]:
            print(f"    {e['filename']}")
        print(f"  PARTIAL ({len(buckets['partial'])}) — read the file and the database before anything else:")
        for e in buckets["partial"]:
            print(f"    {e['filename']}")
        print(f"  UNVERIFIABLE AND UNRECORDED ({len(buckets['unverifiable_unrecorded'])}) — check by hand; "
              "data-only files cannot be proved by the catalog:")
        for e in buckets["unverifiable_unrecorded"]:
            print(f"    {e['filename']}")
        print(f"  APPLIED BUT NOT RECORDED ({len(buckets['applied_unrecorded'])}) — the rows that would "
              "reconcile the ledger (REVIEW, then run by hand; this script runs nothing):")
        for e in buckets["applied_unrecorded"]:
            print(f"    {ledger.backfill_sql(e)}")
    conn.rollback()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", choices=sorted(TARGETS))
    ap.add_argument("--env-file", default=str(REPO / ".env"))
    ap.add_argument("--plan", action="store_true", help="print what each file is checked by; no database")
    ap.add_argument("--migrations", help="migrations folder to audit against (default: this checkout's)")
    a = ap.parse_args()
    plan = ledger.plan(migration_files(a.migrations))
    if a.plan:
        print_plan(plan)
        return
    if not a.target:
        ap.error("--target is required unless --plan is given")
    audit(connect(read_env(a.env_file), a.target), a.target, plan)


if __name__ == "__main__":
    main()
