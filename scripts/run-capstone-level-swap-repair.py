#!/usr/bin/env python3
"""bd-60011 — runner for 2026-09-01-capstone-level-swap-repair.sql.

Default is a DRY RUN: applies the migration inside a transaction, prints the
before/after picture, then ROLLS BACK. Pass --apply to commit.
"""
import argparse, os, re, sys
import psycopg2
from psycopg2.extras import RealDictCursor

HERE = os.path.dirname(os.path.abspath(__file__))
SQL_FILE = os.path.join(HERE, "migrations", "2026-09-01-capstone-level-swap-repair.sql")
EXPECT_REF = "ihzciabopbttygxxgrkm"   # NIETE production


def load_env(path=os.path.join(os.path.dirname(HERE), ".env")):
    env = dict(os.environ)
    for line in open(path):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env.setdefault(k, re.sub(r"\s+#.*$", "", v.strip()).strip().strip('"').strip("'"))
    return env


SNAPSHOT = {
    "capstone mapping": """
        SELECT g.source_quiz_id, g.level_id, l.name AS level_name
          FROM training_grand_quizzes g JOIN training_levels l ON l.id=g.level_id
         WHERE g.quiz_type='capstone' AND g.source_quiz_id IN (10,11) ORDER BY g.source_quiz_id""",
    "imported attempts by level": """
        SELECT a.level_id, l.name AS level_name, a.quiz_kind, count(*) AS n
          FROM training_assessment_attempts a
          JOIN training_grand_quizzes g ON g.id=a.grand_quiz_id
          JOIN training_levels l ON l.id=a.level_id
         WHERE g.source_quiz_id IN (10,11) AND g.quiz_type='capstone'
         GROUP BY 1,2,3 ORDER BY 3,1""",
    "certificates by level + printed subject": """
        SELECT c.level_id, c.level_name_snapshot, count(*) AS n,
               count(*) FILTER (WHERE c.pdf_r2_key IS NULL) AS pdf_pending
          FROM training_certificates c WHERE c.level_id IN (20,21)
         GROUP BY 1,2 ORDER BY 1,2""",
}


def snap(cur, label):
    print(f"\n===== {label} =====")
    for name, q in SNAPSHOT.items():
        cur.execute(q)
        print(f"  {name}:")
        for r in cur.fetchall():
            print("    " + ", ".join(f"{k}={v}" for k, v in dict(r).items()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="COMMIT instead of rolling back")
    args = ap.parse_args()

    env = load_env()
    if EXPECT_REF not in env.get("SUPABASE_URL", ""):
        sys.exit(f"ABORT: SUPABASE_URL is not the NIETE project ({EXPECT_REF}). Refusing to write.")

    body = open(SQL_FILE).read()
    body = re.sub(r"^\s*BEGIN\s*;", "", body, flags=re.M)
    body = re.sub(r"^\s*COMMIT\s*;", "", body, flags=re.M)

    conn = psycopg2.connect(env["DATABASE_URL"])
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=RealDictCursor)
    snap(cur, "BEFORE")
    cur.execute(body)
    snap(cur, "AFTER (uncommitted)" if not args.apply else "AFTER")

    if args.apply:
        conn.commit()
        print("\n*** COMMITTED ***")
    else:
        conn.rollback()
        print("\n--- ROLLED BACK (dry run; pass --apply to commit) ---")


if __name__ == "__main__":
    main()
