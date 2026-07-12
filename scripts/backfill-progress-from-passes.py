#!/usr/bin/env python3
"""
NIETE-Rumi — backfill teacher_training_progress from is_passed=TRUE attempts.

If a teacher has passed a level's grand quiz, we can infer they completed
that level's content. But the UI reads module-progress directly, so a
passing-teacher with no module rows shows "0/9 courses ✓ · Exam passed"
— semantically wrong and visually confusing.

This script:
  For each (user, level) where the teacher has a is_passed=TRUE attempt,
  insert a progress row for every active module in that level.
  completed_at = attempt.completed_at
  Idempotent: ON CONFLICT (user_id, module_id) DO NOTHING.

Modes:
  --dry-run  count + preview, no writes
"""
import argparse
import os
import sys
import time

import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor, execute_values

load_dotenv(".env")


def sb_conn():
    proj_ref = os.environ["SUPABASE_URL"].split("//")[1].split(".")[0]
    return psycopg2.connect(
        host=f"db.{proj_ref}.supabase.co",
        port=5432,
        dbname="postgres",
        user="postgres",
        password=os.environ["SUPABASE_DB_PASSWORD"],
        sslmode="require",
        connect_timeout=15,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    sb = sb_conn()
    cur = sb.cursor(cursor_factory=RealDictCursor)

    # Compute the set of (user_id, module_id, completed_at) triples we'd insert.
    # A user with N passed levels × M modules per level gives NM rows;
    # existing rows are naturally skipped by ON CONFLICT.
    print("Computing backfill target set …", flush=True)
    cur.execute("""
      WITH passes AS (
        SELECT DISTINCT user_id, level_id, MIN(completed_at) AS completed_at
        FROM training_assessment_attempts
        WHERE is_passed = TRUE
        GROUP BY user_id, level_id
      )
      SELECT p.user_id, m.id AS module_id, p.completed_at
      FROM passes p
      JOIN training_courses c ON c.level_id = p.level_id AND c.is_active
      JOIN training_modules m ON m.course_id = c.id AND m.is_active
      ORDER BY p.user_id, m.id;
    """)
    rows = cur.fetchall()
    print(f"  target triples: {len(rows):,}", flush=True)

    # How many are already present (would be skipped)?
    cur.execute("""
      SELECT COUNT(*) AS n
      FROM training_assessment_attempts a
      JOIN training_courses c ON c.level_id = a.level_id AND c.is_active
      JOIN training_modules m ON m.course_id = c.id AND m.is_active
      JOIN teacher_training_progress p ON p.user_id = a.user_id AND p.module_id = m.id
      WHERE a.is_passed = TRUE;
    """)
    already = cur.fetchone()['n']
    print(f"  already present (would be skipped): {already:,}")
    print(f"  net new rows expected: ~{len(rows) - already:,}")

    # Per-level breakdown
    from collections import Counter
    cur.execute("""
      SELECT lv.order_index+1 AS lvl, COUNT(DISTINCT p.user_id) AS distinct_passers,
             (SELECT COUNT(*) FROM training_modules m JOIN training_courses c ON c.id=m.course_id WHERE c.level_id=lv.id AND m.is_active AND c.is_active) AS mods_per_level
      FROM training_assessment_attempts p
      JOIN training_levels lv ON lv.id = p.level_id
      WHERE p.is_passed = TRUE
      GROUP BY lv.order_index, lv.id
      ORDER BY lv.order_index;
    """)
    print("\nBy level (distinct passers × modules-per-level):")
    for r in cur.fetchall():
        print(f"  L{r['lvl']}: {r['distinct_passers']:,} passers × {r['mods_per_level']} mods = {r['distinct_passers']*r['mods_per_level']:,} target rows")

    if args.dry_run:
        print("\n(dry-run: no writes)")
        return

    print(f"\nInserting {len(rows):,} rows with ON CONFLICT DO NOTHING …")
    t0 = time.time()
    inserted = 0
    for i in range(0, len(rows), 1000):
        chunk = rows[i:i + 1000]
        values = [(r["user_id"], r["module_id"], r["completed_at"].isoformat()) for r in chunk]
        execute_values(cur,
            """
            INSERT INTO teacher_training_progress (user_id, module_id, completed_at)
            VALUES %s
            ON CONFLICT (user_id, module_id) DO NOTHING;
            """,
            values,
        )
        inserted += len(chunk)
        sb.commit()
        if (i // 1000) % 10 == 0:
            print(f"  … progress: {inserted:,} / {len(rows):,}", file=sys.stderr)
    print(f"\nInsert-attempt complete for {inserted:,} rows (many skipped by ON CONFLICT) in {time.time()-t0:.1f}s")

    # Verify final count
    cur.execute("SELECT COUNT(*) AS n FROM teacher_training_progress")
    print(f"Total teacher_training_progress rows now: {cur.fetchone()['n']:,}")
    sb.close()


if __name__ == "__main__":
    main()
