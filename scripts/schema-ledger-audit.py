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

Every probe is a catalog read (information_schema / pg_catalog) inside a READ ONLY
transaction that is rolled back. Nothing is written. The closing section prints the
schema_versions rows that WOULD reconcile the ledger for files verified as applied — for a
human to review and run; this script never runs them.

  python3 scripts/schema-ledger-audit.py --plan                       # no database: what each file is checked by
  python3 scripts/schema-ledger-audit.py --target sandbox --env-file .env.sandbox
  python3 scripts/schema-ledger-audit.py --target prod    --env-file .env.prod

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
MARKERS = [
    ("V1.2.4 leader_teachers DEPRECATED comment",
     "SELECT coalesce(obj_description('public.leader_teachers'::regclass),'') ILIKE 'DEPRECATED%'"),
    ("V1.4.9 users.phone_number holds a merge tombstone (len >= 64)",
     "SELECT character_maximum_length >= 64 FROM information_schema.columns "
     "WHERE table_schema='public' AND table_name='users' AND column_name='phone_number'"),
    ("add-schools STEP 4: users.role NOT NULL",
     "SELECT is_nullable = 'NO' FROM information_schema.columns "
     "WHERE table_schema='public' AND table_name='users' AND column_name='role'"),
    ("observe columns: coaching_sessions.autofill_analysis_data",
     "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' "
     "AND table_name='coaching_sessions' AND column_name='autofill_analysis_data')"),
]


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


def migration_files():
    return [(p.name, p.read_text(encoding="utf-8")) for p in sorted(MIGRATIONS.glob("*.sql"))]


def print_plan(plan):
    for e in plan:
        print(f"V{e['version']:<8} {e['filename']}")
        if not e["probes"]:
            print("           (no probe: data-only or unparsed — check by hand)")
        for p in e["probes"]:
            print(f"           {p['strength']:<10} {ledger.describe(p['probe'])}")


def scalar(cur, sql, params=()):
    cur.execute(sql, params)
    row = cur.fetchone()
    return list(row.values())[0] if row else None


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
                   "unverifiable_unrecorded": []}
        for e in plan:
            results, missing = [], []
            for p in e["probes"]:
                sql, params = ledger.probe_query(p["probe"])
                present = bool(scalar(cur, sql, params))
                results.append((p["strength"], present))
                if not present and p["strength"] != "superseded":
                    missing.append(ledger.describe(p["probe"]))
            v = ledger.verdict(results)
            rec = e["version"] in recorded
            print(f"  {e['version']:<9} {'yes' if rec else 'NO':<9} {v:<13} {e['filename']}")
            for m in missing:
                print(f"  {'':<33}missing: {m}")
            if v == "applied" and not rec:
                buckets["applied_unrecorded"].append(e)
            elif v == "not_applied" and rec:
                buckets["recorded_not_applied"].append(e)
            elif v == "partial":
                buckets["partial"].append(e)
            elif v == "unverifiable" and not rec:
                buckets["unverifiable_unrecorded"].append(e)

        print()
        print("  live markers (changes made outside this folder):")
        for label, sql in MARKERS:
            val = scalar(cur, sql)
            print(f"    {'yes' if val else 'NO '}  {label}")

        print()
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
    a = ap.parse_args()
    plan = ledger.plan(migration_files())
    if a.plan:
        print_plan(plan)
        return
    if not a.target:
        ap.error("--target is required unless --plan is given")
    audit(connect(read_env(a.env_file), a.target), a.target, plan)


if __name__ == "__main__":
    main()
