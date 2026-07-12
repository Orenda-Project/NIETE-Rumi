#!/usr/bin/env python3
"""
NIETE-Rumi Teacher Training migration — one-shot fork of TALEEMABAD content
from the legacy Taleemabad platform (fde_production).

What it does (all steps idempotent — ON CONFLICT DO NOTHING / UPSERT):
  1. Insert TALEEMABAD vendor row into training_vendors
  2. Insert 4 TALEEMABAD levels into training_levels
  3. Insert live TALEEMABAD courses into training_courses
  4. Insert live TALEEMABAD training modules into training_modules
     (media URLs are NOT re-hosted in this run — audio_url/video_url stay NULL;
      source_module_id points back to the source row for a later media rehost job)
  5. Insert TALEEMABAD grand quizzes + diagnostic tests into training_grand_quizzes
  6. Insert active questions into training_questions
  7. Create the niete_standard program + one full-scope row
  8. SKIPPED (superseded 2026-07-12) — user identity import moved to
     `scripts/migrate-users.py`, which does org-filtered, all-profile-type import.
  9. SKIPPED — training-program assignments deferred until training features
     enter NIETE launch scope.

Reads: Taleemabad prod Postgres (read-only role from .env — TALEEMABAD_DB_*)
Writes: NIETE-Rumi Supabase via exec_sql RPC + PostgREST bulk inserts

Run: python3 scripts/migrate-teacher-training.py
"""
from __future__ import annotations
import json, sys, urllib.request, urllib.error
from pathlib import Path

import psycopg2
import psycopg2.extras

REPO = Path(__file__).resolve().parent.parent
ENV = REPO / ".env"


def env(k: str) -> str:
    for line in ENV.read_text().splitlines():
        if line.startswith(k + "="):
            return line.split("=", 1)[1]
    raise KeyError(k)


SUPABASE_URL = env("SUPABASE_URL")
SUPABASE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")


def exec_sql(query: str) -> None:
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/exec_sql",
        data=json.dumps({"query": query}).encode(),
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"exec_sql failed: {e.code} {e.read().decode()[:400]}")


def rest_bulk(table: str, rows: list[dict], on_conflict: str | None = None) -> None:
    """POST an array of rows to /rest/v1/<table>. Idempotent via Prefer=merge-duplicates."""
    if not rows:
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if on_conflict:
        url += f"?on_conflict={on_conflict}"
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
        raise RuntimeError(f"POST {table} failed ({len(rows)} rows): {e.code} {e.read().decode()[:400]}")


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


def q(cur, sql: str, params: tuple = ()) -> list[dict]:
    cur.execute(sql, params)
    cols = [d.name for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


# ----------------------------------------------------------------------------
# Step 1: Vendor
# ----------------------------------------------------------------------------

def step1_vendor() -> None:
    exec_sql("""
        INSERT INTO training_vendors
          (key, name, passing_pct, cooldown_hours, has_grand_quiz, has_diagnostic, cert_code_prefix, unlock_logic)
        VALUES
          ('TALEEMABAD', 'Taleemabad', 100, 24, TRUE, TRUE, 'NIETE', 'chain')
        ON CONFLICT (key) DO NOTHING;
    """)
    print("  Step 1: TALEEMABAD vendor upserted")


# ----------------------------------------------------------------------------
# Steps 2-6: Curriculum tree — levels, courses, modules, grand quizzes, questions
# ----------------------------------------------------------------------------

def step2_levels(cur) -> dict[int, int]:
    """Returns source_level_id -> target_level_id mapping."""
    rows = q(cur, """
        SELECT id, name, "order"
        FROM teacher_training_level
        WHERE is_active AND deleted_at IS NULL AND vendor='TALEEMABAD'
        ORDER BY "order";
    """)
    CPD_MAP = {"Emerging Practitioner": 1, "Skilled Practitioner": 2, "Teacher Leader": 3}
    payload = [{
        "vendor_id": None,   # patched by trigger — no, we need actual UUID; fetch below
        "source_level_id": r["id"],
        "name": r["name"],
        "order_index": r["order"],
        "cpd_level": CPD_MAP.get(r["name"]),
        "is_active": True,
    } for r in rows]
    vendor_id = rest_get("training_vendors?key=eq.TALEEMABAD&select=id")[0]["id"]
    for p in payload:
        p["vendor_id"] = vendor_id
    rest_bulk("training_levels", payload, on_conflict="vendor_id,order_index")

    mapped = rest_get("training_levels?select=id,source_level_id")
    id_map = {r["source_level_id"]: r["id"] for r in mapped if r["source_level_id"] is not None}
    print(f"  Step 2: {len(rows)} TALEEMABAD levels upserted")
    return id_map


def step3_courses(cur, level_map: dict[int, int]) -> dict[int, int]:
    rows = q(cur, """
        SELECT c.id, c.level_id, c.title, c.type, c.index
        FROM teacher_training_course c
        JOIN teacher_training_level lv ON lv.id = c.level_id
        WHERE c.is_active AND c.deleted_at IS NULL
          AND lv.is_active AND lv.deleted_at IS NULL
          AND lv.vendor='TALEEMABAD'
        ORDER BY c.level_id, c.index;
    """)
    payload = [{
        "level_id": level_map[r["level_id"]],
        "source_course_id": r["id"],
        "title": r["title"],
        "course_type": r["type"],
        "order_index": r["index"],
        "is_active": True,
    } for r in rows if r["level_id"] in level_map]
    # No unique constraint on (level, source_course_id) — dedup by title+level via SELECT check
    existing = {(r["level_id"], r["source_course_id"]): r["id"]
                for r in rest_get("training_courses?select=id,level_id,source_course_id")}
    new_rows = [p for p in payload if (p["level_id"], p["source_course_id"]) not in existing]
    rest_bulk("training_courses", new_rows)
    mapped = rest_get("training_courses?select=id,source_course_id")
    id_map = {r["source_course_id"]: r["id"] for r in mapped if r["source_course_id"] is not None}
    print(f"  Step 3: {len(rows)} live courses ({len(new_rows)} new)")
    return id_map


def step4_modules(cur, course_map: dict[int, int]) -> dict[int, int]:
    rows = q(cur, """
        SELECT tr.id, tr.course_id, tr.title, tr.content, tr.duration, tr.index
        FROM teacher_training_training tr
        JOIN teacher_training_course c ON c.id = tr.course_id
        JOIN teacher_training_level lv ON lv.id = c.level_id
        WHERE tr.is_active AND tr.deleted_at IS NULL
          AND c.is_active AND c.deleted_at IS NULL
          AND lv.is_active AND lv.vendor='TALEEMABAD'
        ORDER BY c.id, tr.index;
    """)
    payload = [{
        "course_id": course_map[r["course_id"]],
        "source_module_id": r["id"],
        "title": r["title"],
        "content_html": r["content"],
        "duration_seconds": r["duration"],
        "order_index": r["index"],
        "is_active": True,
    } for r in rows if r["course_id"] in course_map]
    existing = {r["source_module_id"] for r in rest_get("training_modules?select=source_module_id") if r["source_module_id"]}
    new_rows = [p for p in payload if p["source_module_id"] not in existing]
    # Batch to avoid oversized POSTs
    for i in range(0, len(new_rows), 100):
        rest_bulk("training_modules", new_rows[i:i+100])
    mapped = rest_get("training_modules?select=id,source_module_id")
    id_map = {r["source_module_id"]: r["id"] for r in mapped if r["source_module_id"]}
    print(f"  Step 4: {len(rows)} live modules ({len(new_rows)} new)")
    return id_map


def step5_grand_quizzes(cur, level_map: dict[int, int]) -> dict[int, int]:
    rows = q(cur, """
        SELECT gq.id, gq.level_id, gq.type
        FROM teacher_training_grandquiz gq
        JOIN teacher_training_level lv ON lv.id = gq.level_id
        WHERE gq.is_active AND gq.deleted_at IS NULL AND lv.vendor='TALEEMABAD';
    """)
    payload = [{
        "level_id": level_map[r["level_id"]],
        "source_quiz_id": r["id"],
        "quiz_type": r["type"],
        "is_active": True,
    } for r in rows if r["level_id"] in level_map]
    rest_bulk("training_grand_quizzes", payload, on_conflict="level_id,quiz_type")
    mapped = rest_get("training_grand_quizzes?select=id,source_quiz_id")
    id_map = {r["source_quiz_id"]: r["id"] for r in mapped if r["source_quiz_id"]}
    print(f"  Step 5: {len(rows)} grand quizzes / diagnostics")
    return id_map


def step6_questions(cur, quiz_map: dict[int, int], module_map: dict[int, int]) -> None:
    rows = q(cur, """
        SELECT id, grand_quiz_id, training_id, question_statement,
               "options", answers, bloom_level, "index"
        FROM teacher_training_question
        WHERE is_active AND deleted_at IS NULL
          AND (grand_quiz_id IN (SELECT gq.id FROM teacher_training_grandquiz gq
                                 JOIN teacher_training_level lv ON lv.id = gq.level_id
                                 WHERE lv.vendor='TALEEMABAD' AND lv.is_active AND gq.is_active)
               OR training_id IN (SELECT tr.id FROM teacher_training_training tr
                                  JOIN teacher_training_course c ON c.id = tr.course_id
                                  JOIN teacher_training_level lv ON lv.id = c.level_id
                                  WHERE lv.vendor='TALEEMABAD' AND lv.is_active
                                    AND c.is_active AND tr.is_active));
    """)

    payload = []
    for r in rows:
        gq_id = quiz_map.get(r["grand_quiz_id"]) if r["grand_quiz_id"] else None
        mod_id = module_map.get(r["training_id"]) if r["training_id"] else None
        if not (gq_id or mod_id):
            continue
        correct = ",".join(str(a) for a in (r["answers"] or []))
        payload.append({
            "grand_quiz_id": gq_id,
            "training_module_id": mod_id,
            "source_question_id": r["id"],
            "question_text": r["question_statement"],
            "options": r["options"],
            "correct_option": correct,
            "bloom_level": r["bloom_level"],
            "order_index": r["index"],
            "is_active": True,
        })

    existing = {r["source_question_id"] for r in rest_get("training_questions?select=source_question_id&limit=100000")
                if r["source_question_id"]}
    new_rows = [p for p in payload if p["source_question_id"] not in existing]
    for i in range(0, len(new_rows), 200):
        rest_bulk("training_questions", new_rows[i:i+200])
    print(f"  Step 6: {len(rows)} live questions ({len(new_rows)} new)")


# ----------------------------------------------------------------------------
# Step 7: Program + scope
# ----------------------------------------------------------------------------

def step7_program() -> None:
    exec_sql("""
        INSERT INTO training_programs (key, name, description)
        VALUES ('niete_standard', 'NIETE Standard Program',
                'Default Teacher Training Program for all NIETE teachers — full Taleemabad catalog')
        ON CONFLICT (key) DO NOTHING;

        INSERT INTO training_program_scopes (program_id, vendor_id, level_ids, course_ids, module_ids)
        SELECT p.id, v.id, NULL, NULL, NULL
        FROM training_programs p CROSS JOIN training_vendors v
        WHERE p.key='niete_standard' AND v.key='TALEEMABAD'
          AND NOT EXISTS (
            SELECT 1 FROM training_program_scopes s
            WHERE s.program_id = p.id AND s.vendor_id = v.id
          );
    """)
    print("  Step 7: niete_standard program + full-TALEEMABAD scope")


# ----------------------------------------------------------------------------
# Step 8: Import teachers into users → SUPERSEDED (2026-07-12)
# ----------------------------------------------------------------------------
# The single-role, no-org-filter teacher import has been replaced by
# `scripts/migrate-users.py`, which imports all 6 profile types (teacher,
# principal, coach, AEO, regional_manager, program_manager) with full profile
# metadata under `preferences.taleemabad.*` and strict org-1 filtering.
#
# Running the old logic here would create 8,500+ half-populated rows again
# WITHOUT org filtering — a data-quality regression against `migrate-users.py`'s
# 4,497 correctly-scoped rows. The function is retained as a no-op stub so
# `main()` still runs the training curriculum steps (1-7) without KeyError.

def step8_teachers(cur) -> None:
    print("  Step 8: SKIPPED — user identity import now lives in")
    print("           scripts/migrate-users.py (run that separately).")


# ----------------------------------------------------------------------------
# Step 9: Auto-assign every imported teacher to niete_standard → DEFERRED
# ----------------------------------------------------------------------------
# Training-program assignment is deferred until training features enter the
# NIETE launch scope. When that happens, the replacement should target ALL
# taleemabad-sourced users (query: `preferences->'taleemabad' IS NOT NULL`),
# not just step-8 rows.

def step9_assignments() -> None:
    print("  Step 9: SKIPPED — training-program assignments deferred until")
    print("           training features enter NIETE launch scope.")


# ----------------------------------------------------------------------------

def main() -> int:
    print("=" * 70)
    print(f"NIETE-Rumi Teacher Training migration → {SUPABASE_URL}")
    print("=" * 70)
    step1_vendor()
    with source_conn() as sconn, sconn.cursor() as cur:
        level_map = step2_levels(cur)
        course_map = step3_courses(cur, level_map)
        module_map = step4_modules(cur, course_map)
        quiz_map = step5_grand_quizzes(cur, level_map)
        step6_questions(cur, quiz_map, module_map)
        step7_program()
        step8_teachers(cur)
    step9_assignments()
    print("=" * 70)
    print("Migration complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
