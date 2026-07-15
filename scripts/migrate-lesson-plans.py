#!/usr/bin/env python3
"""
NIETE-Rumi Lesson-Plan Catalog migration — import LPs from Taleemabad's legacy
Postgres (`fde_production.lesson_plan_externallessonplan`) by vendor source.

What it does:
  1. SELECT every LP row for `--vendor <source>` where
     `is_active IS NULL OR is_active = TRUE` (mirrors source app's liveness check).
  2. Resolve grade + subject via `slo_gradesubject` → `slo_grade` + `slo_subject`.
  3. Resolve chapter title via `book_library_bookchapter` (nullable).
  4. UPSERT into NIETE-Rumi's `lesson_plan_catalog` keyed on
     `(source, source_row_id) = (<vendor>, lp.id)` — idempotent re-runs.
  5. Report per-grade + per-subject counts.

Deliberately NOT filtered by grade — importing every active vendor row keeps
the catalog aligned with reality; the consuming feature can filter downstream.

Reads: Taleemabad prod Postgres (TALEEMABAD_DB_* in .env — read-only role)
Writes: NIETE-Rumi Supabase via PostgREST (Prefer=merge-duplicates on the
        unique (source, source_row_id) index).

Run: python3 scripts/migrate-lesson-plans.py --vendor oxbridge
     python3 scripts/migrate-lesson-plans.py --vendor beaconhouse
"""
from __future__ import annotations
import argparse, json, sys, urllib.request, urllib.error
from collections import Counter
from pathlib import Path

import psycopg2

REPO = Path(__file__).resolve().parent.parent
ENV = REPO / ".env"


def env(k: str) -> str:
    for line in ENV.read_text().splitlines():
        if line.startswith(k + "="):
            return line.split("=", 1)[1]
    raise KeyError(k)


SUPABASE_URL = env("SUPABASE_URL")
SUPABASE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")


def rest_bulk(table: str, rows: list[dict], on_conflict: str) -> None:
    if not rows:
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    req = urllib.request.Request(url, data=json.dumps(rows).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"POST {table} failed ({len(rows)} rows): {e.code} {e.read().decode()[:500]}")


def rest_get(path: str) -> list[dict]:
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def source_conn():
    return psycopg2.connect(
        host=env("TALEEMABAD_DB_HOST"),
        port=env("TALEEMABAD_DB_PORT"),
        dbname=env("TALEEMABAD_DB_NAME"),
        user=env("TALEEMABAD_DB_USER"),
        password=env("TALEEMABAD_DB_PASSWORD"),
        sslmode="require",
        connect_timeout=30,
        options="-c search_path=fde_production",
    )


SOURCE_SQL = """
    SELECT
      lp.id,
      lp.uuid,
      lp.created,
      lp.modified,
      lp.is_active,
      lp.description,
      lp.content,
      g.label   AS grade,
      s.label   AS subject,
      bc.title  AS chapter_title
    FROM lesson_plan_externallessonplan lp
    LEFT JOIN slo_gradesubject      gs ON gs.id = lp.grade_subject_id
    LEFT JOIN slo_grade             g  ON g.id  = gs.grade_id
    LEFT JOIN slo_subject           s  ON s.id  = gs.subject_id
    LEFT JOIN book_library_bookchapter bc ON bc.id = lp.book_chapter_id
    WHERE lp.source = %s
      AND (lp.is_active IS NULL OR lp.is_active = TRUE)
    ORDER BY lp.id;
"""


def fetch_source_rows(cur, source_key: str) -> list[dict]:
    cur.execute(SOURCE_SQL, (source_key,))
    cols = [d.name for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def to_payload(rows: list[dict], source_key: str) -> list[dict]:
    payload = []
    for r in rows:
        payload.append({
            "source": source_key,
            "source_row_id": r["id"],
            "source_uuid": str(r["uuid"]) if r["uuid"] else None,
            "grade": r["grade"],
            "subject": r["subject"],
            "chapter_title": r["chapter_title"],
            "content_html": r["content"],
            "description": r["description"],
            "is_active": bool(r["is_active"]) if r["is_active"] is not None else True,
            "source_created_at": r["created"].isoformat() if r["created"] else None,
            "source_modified_at": r["modified"].isoformat() if r["modified"] else None,
        })
    return payload


def report_breakdown(rows: list[dict], label: str) -> None:
    grades = Counter(r["grade"] or "(unknown)" for r in rows)
    subjects = Counter(r["subject"] or "(unknown)" for r in rows)
    print(f"\n  {label} — per grade:")
    for k, v in sorted(grades.items()):
        print(f"    {k:20s} {v:>3}")
    print(f"  {label} — per subject:")
    for k, v in sorted(subjects.items()):
        print(f"    {k:20s} {v:>3}")


def verify_target(source_key: str) -> None:
    """Re-fetch the target table and print per-grade + per-subject counts + total."""
    rows = rest_get(f"lesson_plan_catalog?select=grade,subject&source=eq.{source_key}&limit=10000")
    print(f"\n  Target `lesson_plan_catalog` (source={source_key}): {len(rows)} rows")
    grades = Counter(r["grade"] or "(unknown)" for r in rows)
    subjects = Counter(r["subject"] or "(unknown)" for r in rows)
    print("  Target — per grade:")
    for k, v in sorted(grades.items()):
        print(f"    {k:20s} {v:>3}")
    print("  Target — per subject:")
    for k, v in sorted(subjects.items()):
        print(f"    {k:20s} {v:>3}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate a vendor's lesson plans from Taleemabad → NIETE-Rumi catalog.")
    parser.add_argument("--vendor", required=True, help="Vendor source key (e.g. oxbridge, beaconhouse). Lowercase, as stored in fde_production.")
    args = parser.parse_args()
    source_key = args.vendor.strip().lower()

    print("=" * 70)
    print(f"NIETE-Rumi Lesson-Plan Catalog migration → {SUPABASE_URL}")
    print(f"Source filter: source='{source_key}' AND (is_active IS NULL OR is_active=TRUE)")
    print("=" * 70)

    with source_conn() as sconn, sconn.cursor() as cur:
        rows = fetch_source_rows(cur, source_key)
    print(f"  Source rows fetched: {len(rows)}")
    report_breakdown(rows, "Source")

    payload = to_payload(rows, source_key)
    # Batch upsert (well under REST body limits; batching for safety on re-runs / future volume)
    for i in range(0, len(payload), 200):
        rest_bulk("lesson_plan_catalog", payload[i:i+200], on_conflict="source,source_row_id")
    print(f"\n  Upserted {len(payload)} rows into lesson_plan_catalog.")

    verify_target(source_key)
    print("=" * 70)
    print("Migration complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
