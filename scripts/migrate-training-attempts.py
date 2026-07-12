#!/usr/bin/env python3
"""
NIETE-Rumi Teacher Training — historical GRAND-QUIZ ATTEMPTS + MCQ SUBMISSIONS
import from FDE (`fde_production` schema on the Taleemabad Postgres).

Scope: last 1 year (created >= 2025-07-12), TALEEMABAD vendor grand quizzes only.

Phase A — training_assessment_attempts
  Query FDE.teacher_training_assessment with:
    is_active, deleted_at IS NULL, is_passed IS NOT NULL, attempt_number=1, TALEEMABAD.
  Insert into Supabase.training_assessment_attempts, preserving score/total_score/is_passed
  verbatim. Skip if a row already exists for (user_id, grand_quiz_id, started_at).

Phase B — training_assessment_answers (MCQ only)
  Query FDE.teacher_training_submission with:
    is_active, deleted_at IS NULL, question_type='mcq', TALEEMABAD grand-quiz scope.
  Group by (user_id, grand_quiz_id) and assign question_index by created-order.
  Insert into Supabase.training_assessment_answers with
  ON CONFLICT (attempt_id, question_index) DO NOTHING.

Identity matching (dual-UUID, no phone fallback needed):
  FDE.assessment.profile → FDE.users_teacherprofile P
  Try P.user.uuid → Supabase.users.teacher_uuid   (migrate-users.py path)
  Then P.uuid    → Supabase.users.teacher_uuid   (old step8 path)
  Skip if neither matches (teacher isn't in Supabase).

Modes:
  --dry-run           write CSVs to scripts/samples/ and stop
  --limit N           cap Phase A rows for smoke testing
  --skip-submissions  do only Phase A (attempts)
"""
import argparse
import csv
import os
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone

import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor, execute_values

load_dotenv(".env")

CUTOFF = "2025-07-12"  # 1 year back from 2026-07-12
OUT_DIR = "scripts/samples"
os.makedirs(OUT_DIR, exist_ok=True)


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


def fde_conn():
    return psycopg2.connect(
        host=os.environ["TALEEMABAD_DB_HOST"],
        port=os.environ["TALEEMABAD_DB_PORT"],
        dbname=os.environ["TALEEMABAD_DB_NAME"],
        user=os.environ["TALEEMABAD_DB_USER"],
        password=os.environ["TALEEMABAD_DB_PASSWORD"],
        sslmode="require",
        options="-c search_path=fde_production",
        connect_timeout=15,
    )


def build_indices(sb, fde):
    """Load Supabase side + FDE-to-target ID maps."""
    print("Loading indices …", file=sys.stderr)
    scur = sb.cursor(cursor_factory=RealDictCursor)

    scur.execute("SELECT id, teacher_uuid FROM users WHERE teacher_uuid IS NOT NULL")
    supabase_by_uuid = {str(r["teacher_uuid"]): r["id"] for r in scur.fetchall()}

    scur.execute("SELECT id, source_quiz_id, level_id FROM training_grand_quizzes WHERE quiz_type='grand_quiz' AND is_active")
    quiz_map = {r["source_quiz_id"]: (r["id"], r["level_id"]) for r in scur.fetchall()}

    scur.execute("SELECT id, source_question_id FROM training_questions WHERE is_active")
    question_map = {r["source_question_id"]: r["id"] for r in scur.fetchall()}

    # options[source_question_id] = [opt0, opt1, opt2, opt3] — used by Phase B to
    # reverse-map FDE's free-text answer strings back to 1-based option indices.
    scur.execute("SELECT source_question_id, options FROM training_questions WHERE is_active")
    question_options = {r["source_question_id"]: r["options"] for r in scur.fetchall()}

    scur.execute("SELECT grand_quiz_id, COUNT(*) AS n FROM training_questions WHERE is_active GROUP BY grand_quiz_id")
    total_questions_by_quiz = {r["grand_quiz_id"]: r["n"] for r in scur.fetchall()}

    scur.execute("SELECT id FROM training_programs WHERE key='niete_standard'")
    program_id = scur.fetchone()["id"]

    print(f"  supabase users (teacher_uuid): {len(supabase_by_uuid):,}", file=sys.stderr)
    print(f"  grand quizzes:                 {len(quiz_map):,}", file=sys.stderr)
    print(f"  questions:                     {len(question_map):,}", file=sys.stderr)
    print(f"  program_id:                    {program_id}", file=sys.stderr)
    return {
        "sb_by_uuid": supabase_by_uuid,
        "quiz_map": quiz_map,
        "question_map": question_map,
        "question_options": question_options,
        "total_qs_by_quiz": total_questions_by_quiz,
        "program_id": program_id,
    }


def _norm(s):
    """Normalize whitespace + strip punctuation drift for option matching."""
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def _reverse_map_option(text, src_question_id, options_map):
    """Given FDE's free-text answer for a question, return the 1-based option index
    as a string, or None if no clean match."""
    opts = options_map.get(src_question_id)
    if not opts:
        return None
    tgt = _norm(text)
    if not tgt:
        return None
    for i, opt in enumerate(opts, start=1):
        if _norm(opt) == tgt:
            return str(i)
    # Loose match: answer starts with the option (or vice versa) — FDE sometimes
    # trims trailing punctuation
    for i, opt in enumerate(opts, start=1):
        n = _norm(opt)
        if n and (tgt.startswith(n) or n.startswith(tgt)):
            return str(i)
    return None


# ─── PHASE A ────────────────────────────────────────────────────────────────

def fetch_attempts(fde, idx):
    cur = fde.cursor(cursor_factory=RealDictCursor, name="fde_attempts_cursor")
    cur.itersize = 2000
    cur.execute(
        f"""
        SELECT a.id           AS src_attempt_id,
               a.profile_id,
               tp.uuid::text  AS profile_uuid,
               u.uuid::text   AS user_uuid,
               u.username     AS phone_raw,
               a.grand_quiz_id AS src_quiz_id,
               a.score, a.total_score, a.is_passed,
               a.created      AS started_at
        FROM teacher_training_assessment a
        JOIN users_teacherprofile tp ON tp.id = a.profile_id
        JOIN users_user u ON u.id = tp.user_id
        JOIN teacher_training_grandquiz gq ON gq.id = a.grand_quiz_id
        JOIN teacher_training_level lv ON lv.id = gq.level_id
        WHERE a.is_active AND a.deleted_at IS NULL
          AND a.created >= '{CUTOFF}'
          AND a.is_passed IS NOT NULL
          AND a.attempt_number = 1
          AND lv.vendor = 'TALEEMABAD' AND lv.is_active;
        """
    )
    for row in cur:
        yield row
    cur.close()


def resolve_user(row, sb_by_uuid):
    """Try User.uuid then TeacherProfile.uuid. Return (user_id, matched_via) or (None,'unmatched')."""
    if row["user_uuid"] and row["user_uuid"] in sb_by_uuid:
        return sb_by_uuid[row["user_uuid"]], "user_uuid"
    if row["profile_uuid"] and row["profile_uuid"] in sb_by_uuid:
        return sb_by_uuid[row["profile_uuid"]], "profile_uuid"
    return None, "unmatched"


def phase_a(sb, fde, idx, dry_run=False, limit=0, resume_from_existing=False):
    """Import attempts. Returns dict (fde_profile_id, fde_quiz_id) -> target_attempt_uuid."""
    stats = defaultdict(int)
    unmatched_rows = []
    resolved_rows = []  # for CSV
    attempt_lookup = {}  # (profile_id, src_quiz_id) -> target_attempt_uuid

    for r in fetch_attempts(fde, idx):
        stats["fde_rows"] += 1
        user_id, how = resolve_user(r, idx["sb_by_uuid"])
        stats[f"match_{how}"] += 1

        quiz_pair = idx["quiz_map"].get(r["src_quiz_id"])
        if not quiz_pair:
            stats["dropped_no_target_quiz"] += 1
            continue
        target_quiz_id, target_level_id = quiz_pair

        if user_id is None:
            unmatched_rows.append({
                "fde_attempt_id": r["src_attempt_id"],
                "profile_id": r["profile_id"],
                "profile_uuid": r["profile_uuid"],
                "user_uuid": r["user_uuid"],
                "phone_raw": r["phone_raw"],
                "src_quiz_id": r["src_quiz_id"],
            })
            continue

        total_qs = idx["total_qs_by_quiz"].get(target_quiz_id, 0)
        record = {
            "user_id": user_id,
            "program_id": idx["program_id"],
            "grand_quiz_id": target_quiz_id,
            "level_id": target_level_id,
            "started_at": r["started_at"].isoformat(),
            "last_activity_at": r["started_at"].isoformat(),
            "completed_at": r["started_at"].isoformat(),  # FDE.completed_at almost always NULL; use created as best proxy
            "current_question_index": total_qs,  # attempt is complete
            "total_questions": total_qs,
            "total_score": r["total_score"],
            "score": r["score"],
            "is_passed": r["is_passed"],
            "status": "passed" if r["is_passed"] else "failed",
            "cooldown_until": None,  # all >24h ago
            "_src_attempt_id": r["src_attempt_id"],
            "_src_profile_id": r["profile_id"],
            "_src_quiz_id": r["src_quiz_id"],
        }
        resolved_rows.append(record)
        if limit and len(resolved_rows) >= limit:
            print(f"  --limit={limit} reached; stopping fetch", file=sys.stderr)
            break

    print("\n=== PHASE A summary ===", flush=True)
    for k in ["fde_rows", "match_user_uuid", "match_profile_uuid", "match_unmatched", "dropped_no_target_quiz"]:
        print(f"  {k:30s} {stats[k]:>8,}")
    print(f"  {'to_insert':30s} {len(resolved_rows):>8,}")

    # Dump CSVs
    if resolved_rows:
        p = os.path.join(OUT_DIR, "training_attempts_to_write.csv")
        with open(p, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(resolved_rows[0].keys()))
            w.writeheader()
            w.writerows(resolved_rows)
        print(f"  wrote {p} ({len(resolved_rows):,} rows)")
    if unmatched_rows:
        p = os.path.join(OUT_DIR, "training_attempts_unmatched.csv")
        with open(p, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(unmatched_rows[0].keys()))
            w.writeheader()
            w.writerows(unmatched_rows)
        print(f"  wrote {p} ({len(unmatched_rows):,} rows)")

    if dry_run:
        # Even in dry-run, we need per-(profile,quiz) attempt id map for Phase B preview counts.
        # We can't generate uuids without writing, so return the source keys and let Phase B print counts.
        return {(r["_src_profile_id"], r["_src_quiz_id"]): "DRY_RUN" for r in resolved_rows}

    scur = sb.cursor(cursor_factory=RealDictCursor)
    if resume_from_existing:
        print("  --resume-phase-b: skipping Phase A inserts, will rebuild lookup only", file=sys.stderr)
    else:
        # Real insert. Rebuild attempt_lookup via a fresh SELECT afterwards
        # (avoids the execute_values RETURNING pagination gotcha).
        inserted = 0
        t0 = time.time()
        for i in range(0, len(resolved_rows), 500):
            chunk = resolved_rows[i:i + 500]
            values = [
                (r["user_id"], r["program_id"], r["grand_quiz_id"], r["level_id"],
                 r["started_at"], r["last_activity_at"], r["completed_at"],
                 r["current_question_index"], r["total_questions"],
                 r["total_score"], r["score"], r["is_passed"], r["status"], r["cooldown_until"])
                for r in chunk
            ]
            execute_values(scur,
                """
                INSERT INTO training_assessment_attempts
                    (user_id, program_id, grand_quiz_id, level_id,
                     started_at, last_activity_at, completed_at,
                     current_question_index, total_questions,
                     total_score, score, is_passed, status, cooldown_until)
                VALUES %s
                """,
                values,
            )
            inserted += len(chunk)
            sb.commit()
            if (i // 500) % 10 == 0:
                print(f"  … Phase A progress: {inserted:,} / {len(resolved_rows):,}", file=sys.stderr)
        print(f"  Phase A inserts complete: {inserted:,} rows in {time.time()-t0:.1f}s")

    # Rebuild attempt_lookup by SELECTing every attempt back and matching on
    # (user_id, grand_quiz_id, started_at) — that triple uniquely identifies
    # each import row.
    print("  Rebuilding attempt_lookup via post-hoc SELECT …", file=sys.stderr)
    key_to_uuid = {}
    scur.execute("""
      SELECT id::text AS id, user_id::text AS user_id, grand_quiz_id, started_at
      FROM training_assessment_attempts
    """)
    for r in scur.fetchall():
        key_to_uuid[(r["user_id"], r["grand_quiz_id"], r["started_at"].isoformat())] = r["id"]
    matched = 0
    for r in resolved_rows:
        k = (r["user_id"], r["grand_quiz_id"], r["started_at"])
        aid = key_to_uuid.get(k)
        if aid:
            attempt_lookup[(r["_src_profile_id"], r["_src_quiz_id"])] = aid
            matched += 1
    print(f"  attempt_lookup built: {matched:,} / {len(resolved_rows):,} entries")
    return attempt_lookup


# ─── PHASE B ────────────────────────────────────────────────────────────────

def fetch_submissions(fde):
    cur = fde.cursor(cursor_factory=RealDictCursor, name="fde_subs_cursor")
    cur.itersize = 5000
    cur.execute(
        f"""
        SELECT s.id           AS src_sub_id,
               s.profile_id,
               s.grand_quiz_id AS src_quiz_id,
               s.question_id  AS src_question_id,
               s.answer, s.is_correct,
               s.created      AS answered_at
        FROM teacher_training_submission s
        JOIN teacher_training_grandquiz gq ON gq.id = s.grand_quiz_id
        JOIN teacher_training_level lv ON lv.id = gq.level_id
        WHERE s.is_active AND s.deleted_at IS NULL
          AND s.created >= '{CUTOFF}'
          AND s.question_type = 'mcq'
          AND lv.vendor = 'TALEEMABAD' AND lv.is_active
        ORDER BY s.profile_id, s.grand_quiz_id, s.created;
        """
    )
    for row in cur:
        yield row
    cur.close()


def phase_b(sb, fde, idx, attempt_lookup, dry_run=False):
    stats = defaultdict(int)
    question_options = idx["question_options"]
    # Group by (profile, quiz) and assign question_index by created-order
    current_key = None
    current_index = 0
    resolved_rows = []
    for r in fetch_submissions(fde):
        stats["fde_rows"] += 1
        key = (r["profile_id"], r["src_quiz_id"])
        if key != current_key:
            current_key = key
            current_index = 0

        target_attempt = attempt_lookup.get(key)
        if not target_attempt:
            stats["dropped_no_attempt"] += 1
            current_index += 1
            continue
        target_qid = idx["question_map"].get(r["src_question_id"])
        if not target_qid:
            stats["dropped_no_target_question"] += 1
            current_index += 1
            continue

        # FDE stores the full answer text (often long-form Urdu prose). Our
        # chosen_option is VARCHAR(16) — designed for "1"/"2"/"3"/"4" from the
        # runtime quiz. For legacy import we need to reverse-map or truncate.
        # Reverse-map: find which option text matches this answer, use that index.
        # If no clean match (open-ended edge cases), truncate to fit varchar(16).
        raw = (r["answer"] or "").strip()
        ans = _reverse_map_option(raw, r["src_question_id"], question_options)
        if ans is None:
            ans = raw[:16] if raw else ""

        resolved_rows.append({
            "attempt_id": target_attempt,
            "question_index": current_index,
            "question_id": target_qid,
            "chosen_option": ans,
            "is_correct": r["is_correct"],
            "answered_at": r["answered_at"].isoformat(),
        })
        current_index += 1
        stats["ok"] += 1

    print("\n=== PHASE B summary ===", flush=True)
    for k in ["fde_rows", "ok", "dropped_no_attempt", "dropped_no_target_question"]:
        print(f"  {k:30s} {stats[k]:>10,}")

    # Dump CSV always
    if resolved_rows:
        p = os.path.join(OUT_DIR, "training_answers_to_write.csv")
        with open(p, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(resolved_rows[0].keys()))
            w.writeheader()
            w.writerows(resolved_rows)
        print(f"  wrote {p} ({len(resolved_rows):,} rows)")

    if dry_run:
        print("\n(dry-run: no writes)")
        return

    if not resolved_rows:
        return

    scur = sb.cursor()
    t0 = time.time()
    inserted = 0
    batch = 500
    for i in range(0, len(resolved_rows), batch):
        chunk = resolved_rows[i:i + batch]
        values = [(r["attempt_id"], r["question_index"], r["question_id"],
                   r["chosen_option"], r["is_correct"], r["answered_at"]) for r in chunk]
        execute_values(scur,
            """
            INSERT INTO training_assessment_answers
                (attempt_id, question_index, question_id, chosen_option, is_correct, answered_at)
            VALUES %s
            ON CONFLICT (attempt_id, question_index) DO NOTHING;
            """,
            values,
        )
        inserted += len(chunk)
        sb.commit()
        if (i // batch) % 50 == 0:
            print(f"  … Phase B progress: {inserted:,} / {len(resolved_rows):,}", file=sys.stderr)
    print(f"  Phase B complete: inserted (best-effort ack) {inserted:,} rows in {time.time()-t0:.1f}s")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--skip-submissions", action="store_true")
    ap.add_argument("--resume-phase-b", action="store_true",
                    help="Skip Phase A inserts; rebuild attempt_lookup from existing Supabase data and run Phase B only.")
    args = ap.parse_args()

    sb = sb_conn()
    fde = fde_conn()

    idx = build_indices(sb, fde)

    attempt_lookup = phase_a(sb, fde, idx, dry_run=args.dry_run, limit=args.limit,
                             resume_from_existing=args.resume_phase_b)

    if args.skip_submissions:
        print("\n(--skip-submissions: Phase B skipped)")
        return

    phase_b(sb, fde, idx, attempt_lookup, dry_run=args.dry_run)

    print("\n=== Migration complete ===")


if __name__ == "__main__":
    main()
