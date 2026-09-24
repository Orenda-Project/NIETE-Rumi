#!/usr/bin/env python3
"""
Backfill users.school_id from the coach roster for teachers who have no school link.

Why: the August school migration linked users to schools through their government
teacher profiles. Teachers who exist only on a coach's roster sheet (leader_teachers)
never received users.school_id, so every school- or sector-scoped read that goes
through users.school_id -> schools (the path the bot uses) cannot see them.

What it does, in order:
  1. asserts the env file points at the project --target names (never a different DB)
  2. ONE read: unlinked-or-linked users joined to their roster rows and the roster's school
  3. classifies every user (scripts/lib/roster_school_backfill.py — unit-tested, pure)
  4. writes decisions + conflicts CSVs and a summary JSON to --out (keep them private)
  5. with --commit: ONE transaction — UPDATE users SET school_id WHERE school_id IS NULL
     (rowcount must be exactly 1 per row), one leader_roster_audit row per write,
     post-flight counts asserted, else ROLLBACK.

Never overwrites an existing school_id. Conflicts and ambiguities are reported, not decided.

  DRY RUN (default, read-only session):
    python3 scripts/backfill-school-id-from-roster.py --target sandbox --out /path/private
  WRITE:
    python3 scripts/backfill-school-id-from-roster.py --target staging --out ... --commit
  PROD WRITE (after the operator's go):
    BACKFILL_PROD_GO=yes python3 scripts/backfill-school-id-from-roster.py --target prod \
        --env-file .env.prod --out ... --commit --confirm-ref <prod project ref>
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
import roster_school_backfill as logic  # noqa: E402

REPO = Path(__file__).resolve().parent.parent

TARGETS = {
    "sandbox": {"ref": "olvritwoqujtjvwfulbh", "host": "aws-0-ap-southeast-1.pooler.supabase.com"},
    "staging": {"ref": "rpqkekcfvumypldbejhp", "host": "aws-1-ap-south-1.pooler.supabase.com"},
    "prod":    {"ref": "ihzciabopbttygxxgrkm", "host": "aws-1-ap-south-1.pooler.supabase.com"},
}

CANDIDATES_SQL = r"""
WITH n AS (
  SELECT u.id, u.role, u.school_id, u.name, regexp_replace(u.phone_number, '\D', '', 'g') AS d
  FROM users u
  WHERE u.phone_number NOT LIKE 'merged:%' {DELETED_FILTER}
), u AS (
  SELECT id, role, school_id, name,
         CASE WHEN d LIKE '92%' THEN d
              WHEN d LIKE '0%'  THEN '92' || substr(d, 2)
              WHEN length(d) = 10 THEN '92' || d
              ELSE d END AS ph
  FROM n
), roster AS (
  SELECT lt.teacher_phone_e164 AS ph, lt.teacher_name, lt.school_ext_id, lt.leader_user_id,
         coalesce(lt.school_id, ls.school_id) AS roster_school_id
  FROM leader_teachers lt
  LEFT JOIN leader_schools ls
         ON ls.school_ext_id = lt.school_ext_id AND ls.leader_user_id = lt.leader_user_id
  WHERE lt.teacher_phone_e164 IS NOT NULL
)
SELECT u.id::text AS user_id, u.ph AS phone_e164, u.role, u.school_id::text AS current_school_id,
       r.roster_school_id::text AS roster_school_id, r.school_ext_id,
       r.leader_user_id::text AS leader_user_id, coalesce(r.teacher_name, u.name) AS teacher_name,
       s.name AS school_name, s.emis, s.region,
       coalesce(s.is_probable_test, false) AS is_probable_test, coalesce(s.is_active, true) AS is_active
FROM u
JOIN roster r ON r.ph = u.ph
LEFT JOIN schools s ON s.id = r.roster_school_id
ORDER BY u.id, r.school_ext_id
"""


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
        raise SystemExit(f"ABORT: env points at '{have}' but --target {target} expects '{want}'. "
                         f"Wrong env file (a worktree is seeded with another repo's .env).")
    if env.get("DATABASE_URL"):
        conn = psycopg2.connect(env["DATABASE_URL"], cursor_factory=psycopg2.extras.RealDictCursor)
    else:
        conn = psycopg2.connect(host=TARGETS[target]["host"], port=5432, user=f"postgres.{want}",
                                password=env["SUPABASE_DB_PASSWORD"], dbname="postgres",
                                cursor_factory=psycopg2.extras.RealDictCursor)
    conn.set_session(readonly=not writable, autocommit=False)
    return conn


def has_column(conn, table, col):
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM information_schema.columns WHERE table_schema='public' "
                    "AND table_name=%s AND column_name=%s", (table, col))
        return cur.fetchone() is not None


def fetch_candidates(conn):
    deleted = "AND u.deleted_at IS NULL" if has_column(conn, "users", "deleted_at") else ""
    with conn.cursor() as cur:
        cur.execute(CANDIDATES_SQL.replace("{DELETED_FILTER}", deleted))
        return [dict(r) for r in cur.fetchall()]


COLS = ["decision", "user_id", "phone_e164", "role", "current_school_id", "target_school_id",
        "school_ext_id", "emis", "school_name", "region", "leader_user_id", "teacher_name",
        "promote_to_teacher", "schools", "reason"]


def write_outputs(out_dir, target, run_id, decisions, counts, dry_run):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base = f"{target}-{stamp}-{'dryrun' if dry_run else 'commit'}"

    def dump(name, rows):
        with open(out / name, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
            w.writeheader()
            for d in rows:
                w.writerow({**d, "schools": ";".join(d["schools"])})

    dump(f"decisions-{base}.csv", decisions)
    dump(f"conflicts-{base}.csv", [d for d in decisions if d["decision"] in ("conflict", "ambiguous")])
    summary = out / f"summary-{base}.json"
    summary.write_text(json.dumps({"run_id": run_id, "target": target, "dry_run": dry_run,
                                   "users": len(decisions), "counts": dict(counts),
                                   "written_at": stamp}, indent=2))
    return summary


def apply(conn, decisions, run_id, promote):
    todo = [d for d in decisions if d["decision"] == "backfill"]
    if not todo:
        print("nothing to write")
        return 0
    ids = [d["user_id"] for d in todo]
    with conn.cursor() as cur:
        for d in todo:
            if promote and d["promote_to_teacher"]:
                cur.execute("UPDATE users SET school_id = %s, role = 'teacher' "
                            "WHERE id = %s AND school_id IS NULL", (d["target_school_id"], d["user_id"]))
            else:
                cur.execute("UPDATE users SET school_id = %s WHERE id = %s AND school_id IS NULL",
                            (d["target_school_id"], d["user_id"]))
            if cur.rowcount != 1:
                conn.rollback()
                raise SystemExit(f"ABORT (rolled back): expected 1 row for user {d['user_id']}, "
                                 f"got {cur.rowcount}; the row changed since the read.")
        audit = [logic.audit_row(d, run_id) for d in todo]
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO leader_roster_audit (action, actor_user_id, affected_leader_user_id, "
            "teacher_ext_id, teacher_phone_e164, teacher_name, from_school_ext_id, to_school_ext_id, detail) "
            "VALUES %s",
            [(a["action"], a["actor_user_id"], a["affected_leader_user_id"], a["teacher_ext_id"],
              a["teacher_phone_e164"], a["teacher_name"], a["from_school_ext_id"], a["to_school_ext_id"],
              psycopg2.extras.Json(a["detail"])) for a in audit],
        )
        cur.execute("SELECT count(*) AS n FROM users WHERE id = ANY(%s::uuid[]) AND school_id IS NULL", (ids,))
        left = cur.fetchone()["n"]
        cur.execute("SELECT count(*) AS n FROM leader_roster_audit WHERE detail->>'run_id' = %s", (run_id,))
        audited = cur.fetchone()["n"]
        if left != 0 or audited != len(todo):
            conn.rollback()
            raise SystemExit(f"ABORT (rolled back): post-flight mismatch left={left} "
                             f"audited={audited} expected={len(todo)}")
    conn.commit()
    return len(todo)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", required=True, choices=sorted(TARGETS))
    ap.add_argument("--env-file", default=str(REPO / ".env"))
    ap.add_argument("--out", required=True, help="private directory for the CSVs + summary JSON")
    ap.add_argument("--commit", action="store_true", help="write; default is a read-only dry run")
    ap.add_argument("--promote-unregistered", action="store_true",
                    help="also set role='teacher' on 'unregistered' rows being linked (mirrors the coach "
                         "add-teacher path). Default: link only, role untouched")
    ap.add_argument("--confirm-ref", default=None, help="with --commit on prod: the prod project ref, typed out")
    a = ap.parse_args()

    if a.commit and a.target == "prod" and (a.confirm_ref != TARGETS["prod"]["ref"]
                                            or os.environ.get("BACKFILL_PROD_GO") != "yes"):
        raise SystemExit("ABORT: a prod write needs --confirm-ref <prod ref> AND BACKFILL_PROD_GO=yes, "
                         "after the operator's explicit go.")

    conn = connect(read_env(a.env_file), a.target, writable=a.commit)
    run_id = f"roster-school-backfill-{a.target}-{uuid.uuid4().hex[:8]}"
    rows = fetch_candidates(conn)
    decisions = logic.classify_all(rows)
    counts = logic.summarize(decisions)
    promote_n = sum(1 for d in decisions if d["decision"] == "backfill" and d["promote_to_teacher"])

    print(f"[{a.target}] roster rows={len(rows)} users={len(decisions)} run_id={run_id}")
    for k in logic.DECISIONS:
        print(f"  {k:24s} {counts.get(k, 0):6d}")
    print(f"  unregistered among backfill: {promote_n} "
          f"({'WILL be promoted to teacher' if a.promote_unregistered else 'linked only, role untouched'})")
    summary = write_outputs(a.out, a.target, run_id, decisions, counts, dry_run=not a.commit)
    print(f"  outputs: {summary}")

    if not a.commit:
        conn.rollback()
        print("DRY RUN — nothing written.")
        return
    n = apply(conn, decisions, run_id, a.promote_unregistered)
    print(f"COMMITTED {n} users.school_id writes + {n} leader_roster_audit rows (run_id {run_id}).")


if __name__ == "__main__":
    main()
