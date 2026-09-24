#!/usr/bin/env python3
"""
Read-only: compare infrastructure/supabase/migrations/V*.sql with schema_versions on one target,
and probe a few live markers that prove hand-applied migrations landed without a ledger row.

  python3 scripts/schema-ledger-audit.py --target prod --env-file .env.prod
"""
import argparse
import re
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import schema_ledger as ledger  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
MIGRATIONS = REPO / "infrastructure" / "supabase" / "migrations"
TARGETS = {
    "sandbox": {"ref": "olvritwoqujtjvwfulbh", "host": "aws-0-ap-southeast-1.pooler.supabase.com"},
    "staging": {"ref": "rpqkekcfvumypldbejhp", "host": "aws-1-ap-south-1.pooler.supabase.com"},
    "prod":    {"ref": "ihzciabopbttygxxgrkm", "host": "aws-1-ap-south-1.pooler.supabase.com"},
}
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


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", required=True, choices=sorted(TARGETS))
    ap.add_argument("--env-file", default=str(REPO / ".env"))
    a = ap.parse_args()
    conn = connect(read_env(a.env_file), a.target)
    files = sorted(p.name for p in MIGRATIONS.glob("*.sql"))
    with conn.cursor() as cur:
        cur.execute("SELECT version FROM schema_versions")
        applied = [r["version"] for r in cur.fetchall()]
        d = ledger.diff_versions(files, applied)
        print(f"[{a.target}] migration files={len(files)} ledger rows={len(applied)}")
        print(f"  files with NO ledger row ({len(d['missing_from_ledger'])}): "
              f"{', '.join(d['missing_from_ledger']) or '-'}")
        print(f"  ledger rows with NO file  ({len(d['unknown_in_ledger'])}): "
              f"{', '.join(d['unknown_in_ledger']) or '-'}")
        print("  live markers (proof of hand-applied migrations):")
        for label, sql in MARKERS:
            cur.execute(sql)
            row = cur.fetchone()
            val = list(row.values())[0] if row else None
            print(f"    {'yes' if val else 'NO '}  {label}")
    conn.rollback()


if __name__ == "__main__":
    main()
