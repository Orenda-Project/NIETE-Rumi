#!/usr/bin/env python3
"""
NIETE-Rumi Beacon House QUIZ CONTENT migration — module-level MCQ questions
from the legacy Taleemabad platform (fde_production).

Companion to scripts/migrate-beacon-house.py (which migrated the BH curriculum
tree: 4 levels / 20 courses / 206 modules but explicitly skipped quiz content).
Mirrors the question mapping of scripts/migrate-teacher-training.py step 6:
  - same target table (training_questions), same column mapping
    (question_statement -> question_text, options jsonb kept verbatim,
     answers[] -> correct_option as comma-joined 1-indexed string,
     bloom_level kept, source_question_id = fde question id),
  - same validity gate (>=2 options, >=1 correct answer, all correct
    indices integer and within 1..len(options)),
  - same idempotency (skip source_question_ids already present),
  - module linkage via training_modules.source_module_id.

Filter (locked partner decision — Kamal, 2026-07-16: skip test placeholders
and inactive rows): q.is_active on fully-active chains only
(t.is_active AND c.is_active AND lv.is_active, deleted_at IS NULL throughout).
Expected: ~326 questions across the 206 migrated BH modules.

One deliberate deviation from the Taleemabad script: order_index is
synthesised 1..N per module (sorted by source question id). The reference
script kept the source `index` for module questions, but (a) BH source index
is 1 on 325/326 rows, and (b) quiz-delivery.service.js paginates with
.order('order_index').range(N,N) and documents (line ~324) that order_index
is expected to be synthesised unique per module — tied indices make the
range() pagination non-deterministic.

GRAND QUIZZES — DELIBERATELY NOT MIGRATED (semantic mismatch, needs a
partner decision first):
  The 4 BH teacher_training_grandquiz rows (source ids 8,9,10,11 — one per
  level) are "Capstone Project" DOCUMENT-SUBMISSION assessments, not MCQ
  banks. All 33 of their active questions have options=[] and answers=NULL —
  open-ended writing prompts ("Define your Lesson Objective...", "Write your
  AI Prompt...") whose instructions say "Submit a document with all N
  sections". Every one fails the MCQ validity gate the NIETE runtime relies
  on (options non-empty, correct_option present), and the NIETE
  training_grand_quizzes schema has no columns for the capstone
  title/description/instructions. The BH vendor row is has_grand_quiz=FALSE,
  so the runtime would not serve them anyway. Importing them as MCQs would
  produce unanswerable quizzes; this script therefore only VERIFIES the 4
  source rows exist and reports the mismatch. See REPORT.md / the PR body.

Reads:  Taleemabad prod Postgres (read-only role from .env — TALEEMABAD_DB_*)
Writes: NIETE-Rumi Supabase via PostgREST bulk inserts (service role)

Run:
  python3 scripts/migrate-beacon-house-quizzes.py            # DRY RUN (no writes)
  python3 scripts/migrate-beacon-house-quizzes.py --apply    # write + verify
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import psycopg2

REPO = Path(__file__).resolve().parent.parent
ENV = REPO / ".env"

EXPECTED_QUESTIONS = 326
QUESTION_TOLERANCE = 10
EXPECTED_GRAND_QUIZZES = 4


def env(k: str) -> str:
    for line in ENV.read_text().splitlines():
        if line.startswith(k + "="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise KeyError(k)


SUPABASE_URL = env("SUPABASE_URL")
SUPABASE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")


def rest_bulk(table: str, rows: list[dict]) -> None:
    """POST an array of rows to /rest/v1/<table>. Idempotent overall because the
    caller pre-filters rows whose source_question_id already exists."""
    if not rows:
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    req = urllib.request.Request(url, data=json.dumps(rows).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180):
            return
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"POST {table} failed ({len(rows)} rows): {e.code} {e.read().decode()[:400]}")


def rest_get_all(path_no_limit: str, page: int = 1000) -> list[dict]:
    """GET with Range-header pagination so PostgREST's max-rows cap can't
    silently truncate the idempotency set."""
    out: list[dict] = []
    offset = 0
    while True:
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/{path_no_limit}",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Range-Unit": "items",
                "Range": f"{offset}-{offset + page - 1}",
            },
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            chunk = json.loads(r.read())
        out.extend(chunk)
        if len(chunk) < page:
            return out
        offset += page


def source_conn():
    return psycopg2.connect(
        host=env("TALEEMABAD_DB_HOST"),
        port=env("TALEEMABAD_DB_PORT"),
        dbname=env("TALEEMABAD_DB_NAME"),
        user=env("TALEEMABAD_DB_USER"),
        password=env("TALEEMABAD_DB_PASSWORD"),
        sslmode="require",
        connect_timeout=30,
        # Belt-and-braces: the role is read-only, but force it anyway.
        options="-c search_path=fde_production -c default_transaction_read_only=on",
    )


def q(cur, sql: str, params: tuple = ()) -> list[dict]:
    cur.execute(sql, params)
    cols = [d.name for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def is_valid_question(opts, answers) -> tuple[bool, str]:
    """Same shape gate as migrate-teacher-training.py step 6: >=2 options, at
    least one correct answer, all correct indices integers within 1..len."""
    if not isinstance(opts, list) or len(opts) < 2:
        return False, f"options_count={len(opts) if isinstance(opts, list) else type(opts).__name__}"
    if not answers or not isinstance(answers, list) or len(answers) == 0:
        return False, "no_correct_answers"
    for a in answers:
        try:
            ai = int(a)
        except (ValueError, TypeError):
            return False, f"correct_not_int:{a!r}"
        if ai < 1 or ai > len(opts):
            return False, f"correct_out_of_range:{ai}/{len(opts)}"
    return True, ""


# ----------------------------------------------------------------------------
# Build the source_module_id -> NIETE training_modules.id map for BH
# ----------------------------------------------------------------------------

def bh_module_map() -> dict[int, int]:
    vendors = rest_get_all("training_vendors?key=eq.BEACONHOUSE&select=id")
    if not vendors:
        raise RuntimeError("BEACONHOUSE vendor not found in training_vendors — run scripts/migrate-beacon-house.py first")
    vendor_id = vendors[0]["id"]
    levels = rest_get_all(f"training_levels?vendor_id=eq.{vendor_id}&select=id")
    level_ids = ",".join(str(r["id"]) for r in levels)
    courses = rest_get_all(f"training_courses?level_id=in.({level_ids})&select=id")
    course_ids = ",".join(str(r["id"]) for r in courses)
    modules = rest_get_all(f"training_modules?course_id=in.({course_ids})&select=id,source_module_id")
    m = {r["source_module_id"]: r["id"] for r in modules if r["source_module_id"] is not None}
    print(f"  BH tree in NIETE: {len(levels)} levels, {len(courses)} courses, {len(modules)} modules ({len(m)} with source_module_id)")
    return m


# ----------------------------------------------------------------------------
# Step A: module MCQ questions
# ----------------------------------------------------------------------------

def fetch_module_questions(cur) -> tuple[list[dict], list[dict]]:
    """Returns (valid_records_without_target_ids, skipped)."""
    rows = q(cur, """
        SELECT qq.id, qq.training_id, qq.question_statement, qq."options",
               qq.answers, qq.bloom_level, qq."index"
        FROM teacher_training_question qq
        JOIN teacher_training_training t ON t.id = qq.training_id
        JOIN teacher_training_course c ON c.id = t.course_id
        JOIN teacher_training_level lv ON lv.id = c.level_id
        WHERE lv.vendor = 'BEACONHOUSE'
          AND qq.is_active AND qq.deleted_at IS NULL
          AND t.is_active AND t.deleted_at IS NULL
          AND c.is_active AND c.deleted_at IS NULL
          AND lv.is_active AND lv.deleted_at IS NULL
        ORDER BY qq.training_id, qq.id;
    """)
    valid, skipped = [], []
    for r in rows:
        ok, reason = is_valid_question(r["options"], r["answers"])
        if not ok:
            skipped.append({"source_id": r["id"], "reason": reason})
            continue
        valid.append({
            "source_question_id": r["id"],
            "source_module_id": r["training_id"],
            "question_text": r["question_statement"],
            "options": r["options"],
            "correct_option": ",".join(str(a) for a in r["answers"]),
            "bloom_level": r["bloom_level"],
        })
    return valid, skipped


def build_question_payload(valid: list[dict], module_map: dict[int, int]) -> tuple[list[dict], int]:
    """Map to NIETE columns and synthesise order_index 1..N per module."""
    by_module: dict[int, list[dict]] = {}
    unmapped = 0
    for rec in valid:
        target_module = module_map.get(rec["source_module_id"])
        if target_module is None:
            unmapped += 1
            continue
        by_module.setdefault(target_module, []).append(rec)

    payload = []
    for target_module, items in sorted(by_module.items()):
        items.sort(key=lambda x: x["source_question_id"])
        for idx, rec in enumerate(items, start=1):
            payload.append({
                "grand_quiz_id": None,
                "training_module_id": target_module,
                "source_question_id": rec["source_question_id"],
                "question_text": rec["question_text"],
                "options": rec["options"],
                "correct_option": rec["correct_option"],
                "bloom_level": rec["bloom_level"],
                "order_index": idx,
                "is_active": True,
            })
    return payload, unmapped


# ----------------------------------------------------------------------------
# Step B: grand quizzes — verify + semantic gate (no writes; see module docstring)
# ----------------------------------------------------------------------------

def check_grand_quizzes(cur) -> tuple[int, list[str]]:
    """Returns (count_of_source_bh_grand_quizzes, list_of_semantic_flags)."""
    gqs = q(cur, """
        SELECT gq.id, gq.title, gq.type, gq.instructions
        FROM teacher_training_grandquiz gq
        JOIN teacher_training_level lv ON lv.id = gq.level_id
        WHERE lv.vendor = 'BEACONHOUSE'
          AND gq.is_active AND gq.deleted_at IS NULL
          AND lv.is_active AND lv.deleted_at IS NULL
        ORDER BY gq.id;
    """)
    gq_questions = q(cur, """
        SELECT qq.id, qq.grand_quiz_id, qq."options", qq.answers
        FROM teacher_training_question qq
        JOIN teacher_training_grandquiz gq ON gq.id = qq.grand_quiz_id
        JOIN teacher_training_level lv ON lv.id = gq.level_id
        WHERE lv.vendor = 'BEACONHOUSE'
          AND qq.is_active AND qq.deleted_at IS NULL
          AND gq.is_active AND lv.is_active;
    """)
    flags = []
    mcq_shaped = sum(1 for r in gq_questions if is_valid_question(r["options"], r["answers"])[0])
    if mcq_shaped == 0 and gq_questions:
        flags.append(
            f"All {len(gq_questions)} active BH grand-quiz questions are open-ended "
            f"(options=[], answers=NULL) — capstone document-submission prompts, not MCQs. "
            f"Titles: {[g['title'][:60] for g in gqs]}. "
            f"NOT importable into the MCQ quiz runtime without a product decision."
        )
    elif mcq_shaped < len(gq_questions):
        flags.append(f"Mixed shapes: {mcq_shaped}/{len(gq_questions)} BH grand-quiz questions are MCQ-shaped.")
    return len(gqs), flags


# ----------------------------------------------------------------------------
# Verification (post-apply)
# ----------------------------------------------------------------------------

def verify(module_map: dict[int, int]) -> None:
    print("\nVERIFY (via PostgREST):")
    all_qs = rest_get_all("training_questions?select=training_module_id,grand_quiz_id,source_question_id,options,correct_option&is_active=eq.true")
    bh_module_ids = set(module_map.values())
    bh_qs = [r for r in all_qs if r["training_module_id"] in bh_module_ids]
    modules_with_q = {r["training_module_id"] for r in bh_qs}
    print(f"  BH active module questions: {len(bh_qs)}")
    print(f"  BH modules with >=1 question: {len(modules_with_q)} / {len(bh_module_ids)}")
    bad = [r for r in bh_qs if not r["options"] or not r["correct_option"]]
    print(f"  BH questions with empty options or missing correct_option: {len(bad)}")

    # Spot-check 3 BH modules end-to-end render-ability
    import random
    random.seed(42)
    sample = random.sample(sorted(modules_with_q), min(3, len(modules_with_q)))
    for mid in sample:
        qs = rest_get_all(
            f"training_questions?training_module_id=eq.{mid}&is_active=eq.true"
            f"&select=id,question_text,options,correct_option,order_index&order=order_index.asc")
        ois = [r["order_index"] for r in qs]
        ok = (
            len(qs) > 0
            and ois == list(range(1, len(qs) + 1))
            and all(isinstance(r["options"], list) and len(r["options"]) >= 2 for r in qs)
            and all(r["correct_option"] and all(1 <= int(a) <= len(r["options"]) for a in r["correct_option"].split(",")) for r in qs)
        )
        print(f"  spot-check module {mid}: {len(qs)} questions, order_index={ois} -> {'OK' if ok else 'FAIL'}")
        if not ok:
            raise RuntimeError(f"Spot-check failed for module {mid}")


# ----------------------------------------------------------------------------

def main() -> int:
    apply = "--apply" in sys.argv
    print("=" * 70)
    print(f"NIETE-Rumi Beacon House QUIZ migration → {SUPABASE_URL}")
    print(f"Mode: {'APPLY' if apply else 'DRY RUN (no writes)'}")
    print("=" * 70)

    module_map = bh_module_map()

    with source_conn() as sconn, sconn.cursor() as cur:
        valid, skipped = fetch_module_questions(cur)
        payload, unmapped = build_question_payload(valid, module_map)
        gq_count, gq_flags = check_grand_quizzes(cur)

    existing = {r["source_question_id"]
                for r in rest_get_all("training_questions?select=source_question_id&source_question_id=not.is.null")
                if r["source_question_id"] is not None}
    new_rows = [p for p in payload if p["source_question_id"] not in existing]

    print(f"\nDRY-RUN COUNTS:")
    print(f"  Source BH active module questions (active chains): {len(valid) + len(skipped)}")
    print(f"  Valid MCQs after shape gate: {len(valid)} ({len(skipped)} skipped as malformed)")
    if skipped:
        print(f"    skip reasons: {skipped[:5]}")
    print(f"  Unmapped to a NIETE module: {unmapped}")
    print(f"  To insert (after idempotency check): {len(new_rows)} "
          f"({len(payload) - len(new_rows)} already present)")
    print(f"  Source BH grand quizzes found: {gq_count} (expected {EXPECTED_GRAND_QUIZZES})")
    for f in gq_flags:
        print(f"  SEMANTIC FLAG: {f}")
    print(f"  Grand quizzes to insert: 0 — blocked pending partner decision (see docstring)")

    # GATE: payload (total mapped valid questions) must be ~326 +/- 10
    lo, hi = EXPECTED_QUESTIONS - QUESTION_TOLERANCE, EXPECTED_QUESTIONS + QUESTION_TOLERANCE
    if not (lo <= len(payload) <= hi):
        print(f"\nGATE FAILED: mapped valid questions = {len(payload)}, expected {lo}..{hi}. NOT writing.")
        return 2
    if gq_count != EXPECTED_GRAND_QUIZZES:
        print(f"\nGATE FAILED: source grand quizzes = {gq_count}, expected {EXPECTED_GRAND_QUIZZES}. NOT writing.")
        return 2
    print(f"\nGATE PASSED: {len(payload)} questions within {lo}..{hi}; {gq_count} source grand quizzes.")

    if not apply:
        print("\nDry run complete. Re-run with --apply to write.")
        return 0

    print(f"\nAPPLYING: inserting {len(new_rows)} questions in batches of 200...")
    for i in range(0, len(new_rows), 200):
        rest_bulk("training_questions", new_rows[i:i + 200])
        print(f"  inserted {min(i + 200, len(new_rows))}/{len(new_rows)}")

    verify(module_map)
    print("=" * 70)
    print("Migration complete. Grand quizzes intentionally NOT migrated (semantic mismatch — see docstring).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
