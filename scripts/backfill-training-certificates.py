#!/usr/bin/env python3
"""
NIETE-Rumi — backfill training_certificates for every passed grand-quiz attempt
that doesn't already have a matching certificate row.

Ran after `migrate-training-attempts.py` imported historical `is_passed=TRUE`
attempts; the runtime code only writes certificate rows for NEW attempts made
on-platform, so the ~13k imported historical passes need this backfill.

Design:
  - One certificate per passed attempt (not per user+level) — preserves the
    audit trail. If a teacher passed L1 twice, they'd have two certificate
    rows, both pointing to the same level_id but different attempt_id.
  - Deterministic certificate_code derived from attempt.id — re-runs produce
    identical codes, safe to re-run.
  - teacher_name_snapshot: users.name || first_name + last_name || phone.
  - level_name_snapshot: training_levels.name.
  - issued_at: attempt.completed_at.
  - pdf_r2_key: NULL (PDF generation is Layer 2).

Idempotency: existence-check against training_certificates.attempt_id before
insert. If any attempt already has a cert row, skip it.

Modes:
  --dry-run   count + preview, no writes
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
    """Connect to Supabase Postgres, preferring the pooler.

    `db.<ref>.supabase.co` resolves to an IPv6 address ONLY. On an IPv4-only
    host — which includes this dev box and most CI runners — it fails outright
    with "Network is unreachable", so the script could not be run at all.
    The session pooler is dual-stack, so it works in both places.

    SUPABASE_DB_HOST / SUPABASE_DB_USER override both, for a project in a
    different region (the pooler hostname carries the region, and the old
    `aws-0-*` names have been retired in favour of `aws-1-*`).
    """
    proj_ref = os.environ["SUPABASE_URL"].split("//")[1].split(".")[0]
    host = os.environ.get("SUPABASE_DB_HOST", "aws-1-ap-south-1.pooler.supabase.com")
    user = os.environ.get("SUPABASE_DB_USER", f"postgres.{proj_ref}")
    return psycopg2.connect(
        host=host,
        port=int(os.environ.get("SUPABASE_DB_PORT", "5432")),
        dbname="postgres",
        user=user,
        password=os.environ["SUPABASE_DB_PASSWORD"],
        sslmode="require",
        connect_timeout=15,
    )


def code_for(attempt_id, level_order, issued_at):
    """NIETE-L{level}-YYYYMMDD-{first8ofUUID}. Deterministic per attempt."""
    short = str(attempt_id).replace("-", "")[:6].upper()
    yyyymmdd = issued_at.strftime("%Y%m%d")
    return f"NIETE-L{level_order}-{yyyymmdd}-{short}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    sb = sb_conn()
    cur = sb.cursor(cursor_factory=RealDictCursor)

    # Pull every passed attempt that doesn't yet have a certificate.
    cur.execute("""
      SELECT a.id AS attempt_id, a.user_id, a.program_id, a.level_id, a.completed_at,
             lv.name AS level_name, lv.order_index+1 AS level_order,
             COALESCE(u.name,
                      NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
                      u.phone_number) AS teacher_name
      FROM training_assessment_attempts a
      JOIN training_levels lv ON lv.id = a.level_id
      JOIN users u ON u.id = a.user_id
      -- A DIAGNOSTIC does not certify a level; a grand quiz or a capstone does.
      --
      -- Without this join the query certified any passed attempt, including
      -- diagnostics — the test that gates ENTRY to a level, not completion of
      -- it. On 2026-08-10 that issued 8,213 diagnostic certificates, 2,756 of
      -- them the teacher's ONLY certificate for that level: certified without
      -- earning it, which is the exact field report this bead started from.
      --
      -- The filter must EXCLUDE diagnostics rather than allow only grand
      -- quizzes. Levels 18-21 (the Beaconhouse subject levels — English,
      -- Mathematics, General Science, Computer Science) certify via a CAPSTONE,
      -- which is their terminal assessment. A grand_quiz-only filter silently
      -- dropped 1,262 legitimate capstone certificates across 1,262 teachers
      -- before this was caught.
      --
      -- quiz_kind cannot express this: its check constraint allows only
      -- grand / training_module / capstone, so a diagnostic legitimately rides
      -- under 'grand'. The quiz's own quiz_type is the only source of truth.
      JOIN training_grand_quizzes gq ON gq.id = a.grand_quiz_id
      WHERE a.is_passed = TRUE
        AND gq.quiz_type <> 'diagnostic'
        AND NOT EXISTS (
          SELECT 1 FROM training_certificates c WHERE c.attempt_id = a.id
        );
    """)
    rows = cur.fetchall()
    print(f"Passed attempts needing certificate: {len(rows):,}", flush=True)

    if not rows:
        print("Nothing to backfill.")
        return

    # Build payload
    payload = []
    for r in rows:
        payload.append({
            "user_id": r["user_id"],
            "program_id": r["program_id"],
            "level_id": r["level_id"],
            "attempt_id": r["attempt_id"],
            "certificate_code": code_for(r["attempt_id"], r["level_order"], r["completed_at"]),
            "teacher_name_snapshot": (r["teacher_name"] or "Teacher")[:255],
            "level_name_snapshot": (r["level_name"] or f"Level {r['level_order']}")[:255],
            "issued_at": r["completed_at"].isoformat(),
        })

    # Preview
    print("\nSample rows:")
    for p in payload[:3]:
        print(f"  {p}")

    # Distribution by level
    from collections import Counter
    by_lv = Counter()
    for r in rows: by_lv[r["level_order"]] += 1
    print("\nBy level:")
    for lv in sorted(by_lv): print(f"  L{lv}: {by_lv[lv]:,} certificates")

    if args.dry_run:
        print("\n(dry-run: no writes)")
        return

    t0 = time.time()
    inserted = 0
    for i in range(0, len(payload), 500):
        chunk = payload[i:i + 500]
        values = [(p["user_id"], p["program_id"], p["level_id"], p["attempt_id"],
                   p["certificate_code"], p["teacher_name_snapshot"], p["level_name_snapshot"],
                   p["issued_at"]) for p in chunk]
        execute_values(cur,
            """
            INSERT INTO training_certificates
                (user_id, program_id, level_id, attempt_id, certificate_code,
                 teacher_name_snapshot, level_name_snapshot, issued_at)
            VALUES %s
            """,
            values,
        )
        inserted += len(chunk)
        sb.commit()
        if (i // 500) % 5 == 0:
            print(f"  … progress: {inserted:,} / {len(payload):,}", file=sys.stderr)
    print(f"\nInserted {inserted:,} certificates in {time.time()-t0:.1f}s")

    # Verify
    cur.execute("SELECT COUNT(*) AS n FROM training_certificates")
    print(f"Total training_certificates rows now: {cur.fetchone()['n']:,}")
    sb.close()


if __name__ == "__main__":
    main()
