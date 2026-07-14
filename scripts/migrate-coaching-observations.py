#!/usr/bin/env python3
"""
NIETE-Rumi coaching-observation migration — one-time historic pull from
`fde_production.coaching_*` (NIETE / FDE production Postgres, reached via
TALEEMABAD_DB_* creds) into NIETE-Rumi's Supabase `nietemigrated_*` tables.

Powers FEAT-061 HITL / leader-dashboard: leaders see historic human-coach
visits alongside Rumi's AI-coaching output.

Order (FK-safe, ancestors first):
  1. observation_templates      (2)
  2. observation_sections       (13)
  3. observation_question_groups (12)
  4. observation_questions      (125,883)
  5. question_options           (497,177)
  6. visit_plans                (9)
  7. school_visits              (324)
  8. teacher_visits             (8,973)
  9. observations               (9,944)
 10. observation_answers        (255,417)

Filters at source (excluded from target):
  * `deleted_at IS NOT NULL`  (soft-deleted)
  * `is_active = FALSE`

Idempotent: uses `Prefer: resolution=merge-duplicates` on the PK, so re-runs
overwrite matching rows without dupes.

Reads: `fde_production.coaching_*` via TALEEMABAD_DB_* (read-only role).
Writes: NIETE-Rumi Supabase via PostgREST bulk POST.

Usage:
  python3 scripts/migrate-coaching-observations.py               # full pull
  python3 scripts/migrate-coaching-observations.py --dry-run     # count only, no writes
  python3 scripts/migrate-coaching-observations.py --tables observations,answers   # subset
"""
from __future__ import annotations
import argparse, json, sys, time, urllib.request, urllib.error
from datetime import date, time as dtime, timedelta, datetime
from pathlib import Path
from decimal import Decimal
from uuid import UUID

import psycopg2

REPO = Path(__file__).resolve().parent.parent
ENV = REPO / ".env"


def env(k: str) -> str:
    for line in ENV.read_text().splitlines():
        if line.startswith(k + "="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise KeyError(k)


SUPABASE_URL = env("SUPABASE_URL")
SUPABASE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")

SRC_DSN = dict(
    host=env("TALEEMABAD_DB_HOST"),
    port=env("TALEEMABAD_DB_PORT"),
    dbname=env("TALEEMABAD_DB_NAME"),
    user=env("TALEEMABAD_DB_USER"),
    password=env("TALEEMABAD_DB_PASSWORD"),
)


def json_default(o):
    """psycopg2 hands back dates, uuids, intervals, decimals — jsonify them."""
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    if isinstance(o, dtime):
        return o.isoformat()
    if isinstance(o, timedelta):
        return str(o)
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, UUID):
        return str(o)
    if isinstance(o, memoryview):
        return o.tobytes().decode()
    raise TypeError(f"unencodable: {type(o).__name__}")


def rest_bulk(table: str, rows: list[dict], batch_size: int = 500) -> tuple[int, int]:
    """Bulk POST rows to PostgREST with merge-duplicates. Returns (written, errors)."""
    if not rows:
        return 0, 0
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    written = errors = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i + batch_size]
        body = json.dumps(chunk, default=json_default).encode()
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                r.read()
            written += len(chunk)
        except urllib.error.HTTPError as e:
            errors += len(chunk)
            print(f"    ✗ HTTP {e.code} on batch {i}-{i+len(chunk)}: {e.read().decode()[:300]}", file=sys.stderr)
            if errors > 3:  # bail fast on cascading errors
                raise
    return written, errors


def stream_rows(cur, sql: str, cols: list[str], batch: int = 1000):
    """Yield dict rows in batches (memory-safe for the 500k+ tables)."""
    cur.execute(sql)
    while True:
        rows = cur.fetchmany(batch)
        if not rows:
            break
        yield [dict(zip(cols, r)) for r in rows]


# ─── Per-table migration plans ────────────────────────────────────────

PLANS = [
    dict(
        name="templates",
        src_table="coaching_observationtemplate",
        tgt_table="nietemigrated_observation_templates",
        src_cols=["id", "uuid", "name", "created", "modified", "is_active", "deleted_at"],
    ),
    dict(
        name="sections",
        src_table="coaching_observationsection",
        tgt_table="nietemigrated_observation_sections",
        src_cols=["id", "uuid", "template_id", "title", '"order"', "is_scored", "section_type", "created", "modified", "is_active", "deleted_at"],
        tgt_cols=["id", "uuid", "template_id", "title", "order", "is_scored", "section_type", "created", "modified", "is_active", "deleted_at"],
    ),
    dict(
        name="question_groups",
        src_table="coaching_observationquestiongroup",
        tgt_table="nietemigrated_observation_question_groups",
        src_cols=["id", "uuid", "section_id", "title", '"order"', "created", "modified", "is_active", "deleted_at"],
        tgt_cols=["id", "uuid", "section_id", "title", "order", "created", "modified", "is_active", "deleted_at"],
    ),
    dict(
        name="questions",
        src_table="coaching_observationquestion",
        tgt_table="nietemigrated_observation_questions",
        src_cols=[
            "id", "uuid", "prompt", "type", "required", '"order"', "is_scored", "is_lp_followed",
            "purpose", "source", "tier", "section_id", "group_id", "lesson_plan_id",
            "core_lesson_plan_id", "subject_id", "created", "modified", "is_active", "deleted_at",
        ],
        tgt_cols=[
            "id", "uuid", "prompt", "type", "required", "order", "is_scored", "is_lp_followed",
            "purpose", "source", "tier", "section_id", "group_id", "lesson_plan_id",
            "core_lesson_plan_id", "subject_id", "created", "modified", "is_active", "deleted_at",
        ],
    ),
    dict(
        name="options",
        src_table="coaching_questionoption",
        tgt_table="nietemigrated_question_options",
        src_cols=[
            "id", "uuid", "question_id", "label", "value", '"order"', "score_type",
            "is_correct", "created", "modified", "is_active", "deleted_at",
        ],
        tgt_cols=[
            "id", "uuid", "question_id", "label", "value", "order", "score_type",
            "is_correct", "created", "modified", "is_active", "deleted_at",
        ],
        batch=1000,
    ),
    dict(
        name="visit_plans",
        src_table="coaching_visitplan",
        tgt_table="nietemigrated_visit_plans",
        src_cols=[
            "id", "uuid", "name", "from_date", "to_date", "regional_manager_id",
            "user_profile_content_type_id", "user_profile_object_id", "created", "modified", "is_active", "deleted_at",
        ],
    ),
    dict(
        name="school_visits",
        src_table="coaching_schoolvisit",
        tgt_table="nietemigrated_school_visits",
        src_cols=[
            "id", "uuid", "scheduled_date", "visit_date", "comments", "status", "type",
            "school_id", "visit_plan_id", "created", "modified", "is_active", "deleted_at",
        ],
    ),
    dict(
        name="teacher_visits",
        src_table="coaching_teachervisit",
        tgt_table="nietemigrated_teacher_visits",
        src_cols=[
            "id", "uuid", "scheduled_date", "visit_date", "comments", "status", "visit_purpose",
            "school_visit_id", "teacher_id", "coach_id", "grade_subject_id", "school_id",
            "section", "user_profile_content_type_id", "user_profile_object_id",
            "created", "modified", "is_active", "deleted_at",
        ],
    ),
    dict(
        name="observations",
        src_table="coaching_observation",
        tgt_table="nietemigrated_observations",
        src_cols=[
            "id", "uuid", "number_of_boys", "number_of_girls", "observation_date", "start_time",
            "total_duration", "feedback", "teacher_response", "agreed_with_feedback", "status",
            "audio_url", "template_id", "visit_id", "coach_id", "lesson_plan_id",
            "core_lesson_plan_id", "school_class_subject_id", "book_chapter_id",
            "user_profile_content_type_id", "user_profile_object_id", "created", "modified", "is_active", "deleted_at",
        ],
    ),
    dict(
        name="answers",
        src_table="coaching_observationanswer",
        tgt_table="nietemigrated_observation_answers",
        src_cols=[
            "id", "uuid", "observation_id", "question_id", "answer_text",
            "single_choice_option_id", "student_number", "is_lp_followed", "student_scores",
            "created", "modified", "is_active", "deleted_at",
        ],
        batch=1000,
    ),
]


def run(only: set[str] | None, dry_run: bool):
    conn = psycopg2.connect(**SRC_DSN, connect_timeout=15)
    cur = conn.cursor()

    total_read = total_written = total_errors = 0
    t_start = time.time()

    for plan in PLANS:
        if only and plan["name"] not in only:
            continue
        name = plan["name"]
        src = f"fde_production.{plan['src_table']}"
        tgt = plan["tgt_table"]
        src_cols = plan["src_cols"]
        tgt_cols = plan.get("tgt_cols", src_cols)
        batch = plan.get("batch", 500)

        # Count first — migrate ALL rows (including soft-deleted/inactive) so FK
        # integrity is preserved. Consumers filter is_active/deleted_at at query
        # time. Learned the hard way: filtering ancestors here orphans child FKs.
        cur.execute(f"SELECT COUNT(*) FROM {src}")
        n_source = cur.fetchone()[0]
        print(f"\n=== {name}: {src} → {tgt}  ({n_source} total rows to pull) ===")
        if dry_run:
            total_read += n_source
            continue

        sql = f"SELECT {', '.join(src_cols)} FROM {src} ORDER BY id"
        seen = written = errors = 0
        t0 = time.time()
        for chunk in stream_rows(cur, sql, tgt_cols, batch=batch):
            w, e = rest_bulk(tgt, chunk, batch_size=batch)
            written += w
            errors += e
            seen += len(chunk)
            if seen % 5000 == 0 or seen >= n_source:
                elapsed = time.time() - t0
                rate = seen / elapsed if elapsed > 0 else 0
                print(f"    {seen}/{n_source}  ({rate:.0f} rows/s)")
        total_read += seen
        total_written += written
        total_errors += errors
        print(f"    ✓ done: {written} written / {errors} errors  ({time.time()-t0:.1f}s)")

    conn.close()
    total = time.time() - t_start
    print(f"\n=== TOTAL: {total_read} read / {total_written} written / {total_errors} errors  ({total:.1f}s) ===")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true", help="Count source rows only, no writes")
    p.add_argument("--tables", default="", help="Comma-list subset: templates,sections,question_groups,questions,options,visit_plans,school_visits,teacher_visits,observations,answers")
    args = p.parse_args()
    only = set(args.tables.split(",")) if args.tables else None
    run(only, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
