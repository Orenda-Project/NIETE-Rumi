#!/usr/bin/env python3
"""
Mark test accounts: set users.is_test_user = true for the rows a REVIEWED predicate selects.

Why: the flag is what the dashboard's partner views and the analysts' filters exclude,
and it is true on zero production rows, so nothing is excluded. Test markings were lost
in the migration; this rebuilds them from an explicit, reviewable predicate.

  DRY RUN (default, read-only session; writes a CSV for the reviewer):
    python3 scripts/mark-test-users.py --target sandbox --out /path/private
  WITH a private allowlist of staff/tester phones (one E.164 per line):
    python3 scripts/mark-test-users.py --target staging --env-file .env.staging --out ... \
        --allowlist-phones-file /path/private/tester-phones.txt
  WRITE (after review; prod additionally needs MARK_PROD_GO=yes and --confirm-ref):
    ... --commit

One transaction: UPDATE ... WHERE id = ANY(ids) AND is_test_user = false, rowcount must equal
the selection, post-flight recount, else ROLLBACK.
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
import mark_test_users as logic  # noqa: E402

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
    conn.set_session(readonly=not writable, autocommit=False)
    return conn


def resolve_phones(conn, phones):
    """E.164 digits -> user ids, matched on the digits of users.phone_number (mixed formats live)."""
    digits = [re.sub(r"\D", "", p) for p in phones]
    if not digits:
        return []
    with conn.cursor() as cur:
        cur.execute("SELECT id::text AS id FROM users WHERE is_test_user = false AND "
                    "regexp_replace(phone_number, '\\D', '', 'g') = ANY(%s)", (digits,))
        return [r["id"] for r in cur.fetchall()]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", required=True, choices=sorted(TARGETS))
    ap.add_argument("--env-file", default=str(REPO / ".env"))
    ap.add_argument("--out", required=True, help="private directory for the reviewer CSV + summary JSON")
    ap.add_argument("--predicate-file", default=str(REPO / "scripts" / "predicates" / "test-users.sql"))
    ap.add_argument("--allowlist-phones-file", default=None, help="private file, one E.164 phone per line")
    ap.add_argument("--commit", action="store_true", help="write; default is a read-only dry run")
    ap.add_argument("--confirm-ref", default=None, help="with --commit on prod: the prod project ref, typed out")
    a = ap.parse_args()

    if a.commit and a.target == "prod" and (a.confirm_ref != TARGETS["prod"]["ref"]
                                            or os.environ.get("MARK_PROD_GO") != "yes"):
        raise SystemExit("ABORT: a prod write needs --confirm-ref <prod ref> AND MARK_PROD_GO=yes, "
                         "after the reviewed CSV is signed off.")

    conn = connect(read_env(a.env_file), a.target, writable=a.commit)
    run_id = f"mark-test-users-{a.target}-{uuid.uuid4().hex[:8]}"
    with conn.cursor() as cur:
        cur.execute(Path(a.predicate_file).read_text())
        predicate_rows = [dict(r) for r in cur.fetchall()]
    allow_ids = []
    if a.allowlist_phones_file:
        allow_ids = resolve_phones(conn, logic.parse_allowlist(Path(a.allowlist_phones_file).read_text()))
    sel = logic.build_selection(predicate_rows, allow_ids)
    counts = logic.rule_counts(sel)
    ids = list(sel)

    with conn.cursor() as cur:
        cur.execute("SELECT u.id::text AS id, u.name, u.phone_number, u.role, u.source, "
                    "u.registration_completed, s.name AS school_name, s.emis, s.is_probable_test "
                    "FROM users u LEFT JOIN schools s ON s.id = u.school_id WHERE u.id = ANY(%s::uuid[])", (ids,))
        detail = {r["id"]: dict(r) for r in cur.fetchall()}

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base = f"{a.target}-{stamp}-{'dryrun' if not a.commit else 'commit'}"
    cols = ["id", "rules", "name", "phone_number", "role", "source", "registration_completed",
            "school_name", "emis", "is_probable_test"]
    with open(out / f"selection-{base}.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for i in ids:
            w.writerow({**detail.get(i, {"id": i}), "rules": ";".join(sel[i])})
    (out / f"summary-{base}.json").write_text(json.dumps(
        {"run_id": run_id, "target": a.target, "dry_run": not a.commit, "selected": len(ids),
         "per_rule": counts, "written_at": stamp}, indent=2))

    print(f"[{a.target}] selected={len(ids)} run_id={run_id}")
    for rule, n in sorted(counts.items()):
        print(f"  {rule:22s} {n:6d}")
    print(f"  outputs: {out / f'selection-{base}.csv'}")

    if not a.commit:
        conn.rollback()
        print("DRY RUN — nothing written.")
        return
    with conn.cursor() as cur:
        cur.execute("UPDATE users SET is_test_user = true WHERE id = ANY(%s::uuid[]) AND is_test_user = false", (ids,))
        if cur.rowcount != len(ids):
            conn.rollback()
            raise SystemExit(f"ABORT (rolled back): rowcount {cur.rowcount} != selected {len(ids)}")
        cur.execute("SELECT count(*) AS n FROM users WHERE id = ANY(%s::uuid[]) AND is_test_user = false", (ids,))
        if cur.fetchone()["n"] != 0:
            conn.rollback()
            raise SystemExit("ABORT (rolled back): post-flight found unflagged ids")
    conn.commit()
    print(f"COMMITTED {len(ids)} users.is_test_user = true (run_id {run_id}).")


if __name__ == "__main__":
    main()
