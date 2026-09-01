#!/usr/bin/env python3
"""
NIETE-Rumi — INVARIANT: every training_grand_quizzes row must sit on the same
level its source quiz sits on in the legacy FDE platform.

Why this guard exists (bd-60011): scripts/migrations/2026-07-21-capstone-import.sql
hardcoded the four Beacon House capstones onto levels in ascending source-quiz-id
order (8->18, 9->19, 10->20, 11->21). Legacy quizzes 10 and 11 are NOT in level
order — quiz 10 belongs to legacy level 8 (Computer Science) and quiz 11 to
legacy level 7 (General Science) — so the last two landed transposed. Every
Computer Science pass synced from FDE was then filed as General Science and
vice versa (546 exact-matched attempts, ~538 certificates), and the level-20
exam served Computer Science prompts to teachers who chose General Science.

The mapping is derived here, never assumed: legacy grandquiz.level_id ->
teacher_training_level.id -> training_levels.source_level_id -> training_levels.id.

Exit 0 = every capstone/grand quiz is on its legacy level.
Exit 1 = at least one mismatch (prints each one).
"""
import os
import re
import sys

import psycopg2
from psycopg2.extras import RealDictCursor

REPO_ENV = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")


def load_env(path=REPO_ENV):
    env = dict(os.environ)
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env.setdefault(k, re.sub(r"\s+#.*$", "", v.strip()).strip().strip('"').strip("'"))
    return env


def main():
    env = load_env()
    nb = psycopg2.connect(env["DATABASE_URL"])
    nb.set_session(readonly=True)
    fd = psycopg2.connect(
        host=env["TALEEMABAD_DB_HOST"], port=env.get("TALEEMABAD_DB_PORT", 5432),
        dbname=env["TALEEMABAD_DB_NAME"], user=env["TALEEMABAD_DB_USER"],
        password=env["TALEEMABAD_DB_PASSWORD"], sslmode=env.get("TALEEMABAD_DB_SSLMODE", "require"),
        options=f"-c search_path={env.get('TALEEMABAD_DB_SCHEMA', 'fde_production')},public",
    )
    fd.set_session(readonly=True)
    nc = nb.cursor(cursor_factory=RealDictCursor)
    fc = fd.cursor(cursor_factory=RealDictCursor)

    nc.execute("""
        SELECT g.id, g.source_quiz_id, g.quiz_type, g.level_id,
               l.name AS level_name, l.source_level_id
        FROM training_grand_quizzes g
        JOIN training_levels l ON l.id = g.level_id
        WHERE g.is_active AND g.source_quiz_id IS NOT NULL
        ORDER BY g.source_quiz_id
    """)
    ours = nc.fetchall()

    # legacy truth: which level does each source quiz belong to?
    fc.execute("""
        SELECT q.id AS source_quiz_id, q.level_id AS legacy_level_id, q.title,
               lv.name AS legacy_level_name
        FROM teacher_training_grandquiz q
        JOIN teacher_training_level lv ON lv.id = q.level_id
        WHERE q.deleted_at IS NULL
    """)
    legacy = {r["source_quiz_id"]: r for r in fc.fetchall()}

    # legacy level id -> our level id, via source_level_id
    nc.execute("SELECT id, name, source_level_id FROM training_levels WHERE source_level_id IS NOT NULL")
    by_source = {r["source_level_id"]: r for r in nc.fetchall()}

    bad, checked, skipped = [], 0, 0
    for row in ours:
        src = legacy.get(row["source_quiz_id"])
        if not src:
            skipped += 1
            continue
        target = by_source.get(src["legacy_level_id"])
        if not target:
            skipped += 1
            continue
        checked += 1
        if target["id"] != row["level_id"]:
            bad.append((row, src, target))

    print(f"capstone/grand-quiz level mapping: {checked} checked, {skipped} unmappable, {len(bad)} WRONG")
    for row, src, target in bad:
        print(
            f"  MISMATCH quiz id={row['id']} source_quiz_id={row['source_quiz_id']} "
            f"({src['title'][:60]!r})\n"
            f"    sits on   level {row['level_id']} {row['level_name']!r}\n"
            f"    belongs on level {target['id']} {target['name']!r} "
            f"(legacy level {src['legacy_level_id']} {src['legacy_level_name']!r})"
        )
    if bad:
        print("\nFAIL — a capstone is serving the wrong subject's prompts, and every")
        print("attempt synced through it is filed under the wrong level.")
        return 1
    print("OK — every capstone sits on its legacy level.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
