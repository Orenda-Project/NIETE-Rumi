#!/usr/bin/env python3
"""
One organization value for the NIETE deployment: respell every NIETE value to `niete`, fill the blanks inside the
six ICT sectors, clear Durbeen. The rules and the write live in scripts/lib/set_organization.py and are unit-tested.

  DRY RUN (default, read-only session; writes an ids-only CSV of id, old, new, reason for the reviewer):
    python3 scripts/set-organization.py --target prod --env-file .env.prod --out /path/private
  WRITE (after review; prod additionally needs SET_ORG_PROD_GO=yes, --confirm-ref and the reviewed --expect-csv):
    ... --expect-csv /path/private/org-changes-...-dryrun.csv --commit --confirm-ref ihzciabopbttygxxgrkm

One REPEATABLE READ transaction reads, plans and writes, so a row another session changes after the read fails the
write instead of being rewritten from a stale read. With --expect-csv the live plan must equal the reviewed dry run
row for row, else nothing is written. One UPDATE per (old, new) group of at most 1,000 ids, each asserting its
rowcount; then the rows are re-read and classified again, and the result must be empty; else ROLLBACK. The write
sets a 5 s lock timeout and a 120 s statement timeout, so it fails fast instead of queueing behind the app. The CSV
is written before the first UPDATE, so a rollback by hand is always possible from it.
"""
import argparse
import csv
import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import set_organization as logic  # noqa: E402
from mark_test_users import drift_lines  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
TARGETS = {
    "sandbox": {"ref": "olvritwoqujtjvwfulbh", "host": "aws-0-ap-southeast-1.pooler.supabase.com"},
    "staging": {"ref": "rpqkekcfvumypldbejhp", "host": "aws-1-ap-south-1.pooler.supabase.com"},
    "prod":    {"ref": "ihzciabopbttygxxgrkm", "host": "aws-1-ap-south-1.pooler.supabase.com"},
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
    # One snapshot for the read, the plan and the write (see the module docstring).
    conn.set_session(isolation_level="REPEATABLE READ", readonly=not writable, autocommit=False)
    return conn


def load(cur):
    cur.execute("SELECT id::text AS id, organization, school_id::text AS school_id, role, is_test_user, deleted_at "
                "FROM users")
    users = {r["id"]: dict(r) for r in cur.fetchall()}
    cur.execute("SELECT id::text AS id, name, region, is_probable_test FROM schools")
    schools = {r["id"]: dict(r) for r in cur.fetchall()}
    return users, schools


def load_all(conn):
    with conn.cursor() as cur:
        return load(cur)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", required=True, choices=sorted(TARGETS))
    ap.add_argument("--env-file", default=str(REPO / ".env"))
    ap.add_argument("--out", required=True, help="private directory for the reviewer CSV + summary JSON")
    ap.add_argument("--expect-csv", default=None, help="the reviewed dry run's change CSV: the live plan must equal "
                    "it row for row (id, old, new), else nothing is written. Required for a prod commit")
    ap.add_argument("--commit", action="store_true", help="write; default is a read-only dry run")
    ap.add_argument("--confirm-ref", default=None, help="with --commit on prod: the prod project ref, typed out")
    a = ap.parse_args()

    if a.commit and a.target == "prod" and (a.confirm_ref != TARGETS["prod"]["ref"]
                                            or os.environ.get("SET_ORG_PROD_GO") != "yes"
                                            or not a.expect_csv):
        raise SystemExit("ABORT: a prod write needs --confirm-ref <prod ref>, SET_ORG_PROD_GO=yes AND "
                         "--expect-csv <the reviewed dry run's change CSV>.")
    expected = logic.parse_plan_csv(Path(a.expect_csv).read_text()) if a.expect_csv else None

    conn = connect(read_env(a.env_file), a.target, writable=a.commit)
    run_id = f"set-organization-{a.target}-{uuid.uuid4().hex[:8]}"
    users, schools = load_all(conn)
    changes = logic.plan(users, schools)
    guards = logic.guard_counts(changes, users, schools)
    reasons = logic.reason_counts(changes)

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base = f"{a.target}-{stamp}-{'dryrun' if not a.commit else 'commit'}"
    with open(out / f"org-changes-{base}.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "old", "new", "reason"])
        for uid, old, new, reason in changes:
            w.writerow([uid, old or "", new or "", reason])
    (out / f"org-summary-{base}.json").write_text(json.dumps(
        {"run_id": run_id, "target": a.target, "dry_run": not a.commit, "changes": len(changes),
         "per_reason": reasons, "guards": guards, "written_at": stamp}, indent=2))

    print(f"[{a.target}] changes={len(changes)} run_id={run_id}")
    for reason, n in sorted(reasons.items()):
        print(f"  {reason:28s} {n:6d}")
    print("  guards (every one must be 0):", guards)
    print(f"  outputs: {out / f'org-changes-{base}.csv'}")
    if any(guards.values()):
        conn.rollback()
        raise SystemExit("ABORT: a guard class is non-empty; nothing written.")
    if expected is not None:
        ok, missing, extra = logic.check_plan_matches(expected, changes)
        if not ok:
            conn.rollback()
            for line in drift_lines(missing, extra,
                                    labels=("reviewed but no longer planned", "planned but never reviewed")):
                print("  " + line)
            raise SystemExit("ABORT: the live plan differs from the reviewed dry run; nothing written. "
                             "Run a fresh dry run, review it, retry with it.")
        print(f"the live plan matches the reviewed dry run ({len(expected)} rows)")
    if not a.commit:
        conn.rollback()
        print("DRY RUN — nothing written.")
        return
    if not changes:
        conn.rollback()
        print("nothing to change.")
        return

    n = logic.apply_changes(conn, changes, reload=lambda: load_all(conn))
    print(f"COMMITTED {n} organization changes (run_id {run_id}).")


if __name__ == "__main__":
    main()
