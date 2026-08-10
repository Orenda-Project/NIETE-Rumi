#!/usr/bin/env python3
"""
bd-2528 — idempotent delta sync: legacy FDE Django DB → Supabase.

WHY THIS EXISTS
---------------
The 2026-07-12 migration took a SNAPSHOT. Teachers kept using the old FDE app
afterwards, so their completions land in `fde_production` and are invisible to
the new platform. Measured 2026-08-07 against both live databases:

    legacy completed (profile, training) pairs   682,030   (4,897 teachers)
    teacher_training_progress rows here          619,919
    written AFTER the 2026-07-12 cutoff           78,294   (1,665 teachers)
    grand-quiz passes after cutoff w/o cert        1,364 teachers

The reported case is Sumbal Pervaiz (923155330788): 292 completed trainings in
the legacy DB, 92 rows here. She finished Level 3 in the old app on 2026-08-04
and holds the Level 2 certificate — while the portal reads her level incomplete
and locks her out. Hundreds of teachers are in the same state.

This script closes that gap and can be re-run on a schedule. Every run writes a
`training_sync_runs` row recording how much NEW post-cutoff legacy data it found,
which is what makes the job RETIREABLE: when that count stays 0 for a sustained
window, the old app is no longer being written to and this can be switched off
with evidence rather than a guess (`--retirement-report` prints exactly that).

TWO STAGES
----------
1. progress  — completed modules. A binary "done" flag, so a teacher who did the
               same module in both apps is harmless: conflict-ignore keeps the
               existing row.
2. attempts  — quiz verdicts. NOT harmless, because these carry score/is_passed,
               so the same level can hold two contradictory records. Sumbal has
               exactly that on 2026-08-04: PASSED 86/200 in the legacy app at
               07:49, in_progress here at 03:17. See `better_attempt()` for the
               merge rule; the short version is that a pass is never overwritten
               by a non-pass.

Attempts are in scope because 1,364 teachers passed a grand quiz in the legacy
app after the migration and hold no certificate here. Progress alone would fill
in their modules and leave them uncertified — the visible half of the reported
bug would survive the fix.

Certificates themselves stay out of scope: `backfill-training-certificates.py`
already derives them from passed attempts and is idempotent, so the clean split
is to land attempts here and re-run that script afterwards.

SCOPE LIMIT, STATED PLAINLY
---------------------------
This is ONE-WAY (legacy → new). It reconciles verdicts but does not merge
cooldowns or attempt counts, and it cannot fix the underlying situation: two
writable apps. As of 2026-08-10 the legacy app is effectively retired — weekly
active teachers there fell from 841 (w/c 27 Jul) to 4 (w/c 10 Aug) as the app
update rolled out — so this is a CATCH-UP job over a finite backlog plus a thin
trickle, not permanent infrastructure. `--retirement-report` is how you decide
it is done.

IDEMPOTENCY — READ BEFORE EDITING
---------------------------------
Correctness comes from the NATURAL KEY, never from the watermark:
`on_conflict=user_id,module_id` with `Prefer: resolution=ignore-duplicates`.
Drop this ledger table tomorrow and a full re-run is still correct, just slower.

That property is load-bearing because the source timestamps are NOT trustworthy.
Django's `auto_now` is effectively not firing on the FDE training tables —
measured 2026-08-07, `modified > created` on 4 of 2,598,546 status rows and 798
of 2,040,771 assessment rows. A `modified`-only high-water mark would look like
it worked (because created ≈ modified almost everywhere) while silently missing
any genuine edit. So the window uses GREATEST(created, modified) AND the write
is conflict-safe. Belt and braces, because the belt has holes.

NEVER use `last_local_modified_at` as a watermark. It is an offline DEVICE clock
and its minimum value in the live source is 1970-01-01.

The legacy status table APPENDS rather than upserts: the same (profile,
training) carries both an IN_PROGRESS and a COMPLETED row. Sumbal has 58 status
rows across 40 level-3 trainings. Counting rows instead of filtering on
status='COMPLETED' overstates progress.

USAGE
-----
    # what would change, no writes  (ALWAYS run this first)
    uv run --with psycopg2-binary --with python-dotenv --with requests \
        python scripts/sync-training-from-fde.py --dry-run

    # apply
    ... python scripts/sync-training-from-fde.py --apply

    # "can we turn this off yet?"
    ... python scripts/sync-training-from-fde.py --retirement-report
"""
import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import psycopg2
import requests
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor

load_dotenv(".env")

SB_URL = os.environ["SUPABASE_URL"]
SB_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SB_H = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}

# The date the original migration snapshot was taken. Legacy rows newer than this
# are, by definition, work done in the old app after we moved off it — the number
# that decides whether this job can be retired.
MIGRATION_CUTOFF = "2026-07-12"

# How far back to re-scan on a normal run, on top of the last run's window. Cheap
# insurance against clock skew and late-arriving offline syncs from the FDE app;
# re-scanned rows are conflict-ignored, so overlap costs time, never correctness.
LOOKBACK_SLACK = timedelta(days=2)


def norm_pk(p):
    """Normalize a Pakistani mobile string to E.164 (12 digits, 92 prefix)."""
    if not p:
        return None
    d = re.sub(r"\D", "", str(p))
    if not d:
        return None
    if len(d) == 12 and d.startswith("92"):
        return d
    if len(d) == 11 and d.startswith("0"):
        return "92" + d[1:]
    if len(d) == 10 and d.startswith("3"):
        return "92" + d
    return d


def sb_fetch_all(path, page=1000):
    """PostgREST pagination via Range header."""
    rows, offset = [], 0
    while True:
        rh = {**SB_H, "Range": f"{offset}-{offset+page-1}"}
        r = requests.get(f"{SB_URL}/rest/v1/{path}", headers=rh, timeout=120)
        r.raise_for_status()
        batch = r.json()
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows


def fde_conn():
    return psycopg2.connect(
        host=os.environ["TALEEMABAD_DB_HOST"],
        port=os.environ["TALEEMABAD_DB_PORT"],
        dbname=os.environ["TALEEMABAD_DB_NAME"],
        user=os.environ["TALEEMABAD_DB_USER"],
        password=os.environ["TALEEMABAD_DB_PASSWORD"],
        sslmode="require",
        connect_timeout=30,
    )


# ---------------------------------------------------------------- run ledger

def ledger_open(entity, window_start, window_end, dry_run):
    """Open the run row BEFORE the work, so a crash still leaves a trace."""
    payload = {
        "entity": entity,
        "status": "dry_run" if dry_run else "running",
        "window_start": window_start.isoformat() if window_start else None,
        "window_end": window_end.isoformat(),
    }
    r = requests.post(
        f"{SB_URL}/rest/v1/training_sync_runs",
        headers={**SB_H, "Content-Type": "application/json", "Prefer": "return=representation"},
        json=payload, timeout=60,
    )
    if r.status_code >= 300:
        print(f"  ! could not open ledger row: {r.status_code} {r.text[:300]}", file=sys.stderr)
        return None
    return r.json()[0]["id"]


def ledger_close(run_id, status, stats, notes=None):
    """Close the row — on success AND on failure.

    A sync that only records its successes makes the retirement signal a lie: a
    month of silent crashes reads exactly like a month of zero new data.
    """
    if not run_id:
        return
    payload = {
        "status": status,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "source_rows_after_cutoff": stats.get("source_rows_after_cutoff", 0),
        "source_rows_scanned": stats.get("source_rows_scanned", 0),
        "rows_written": stats.get("rows_written", 0),
        "rows_skipped_duplicate": stats.get("rows_skipped_duplicate", 0),
        "rows_unmatched_teacher": stats.get("rows_unmatched_teacher", 0),
        "rows_unmatched_module": stats.get("rows_unmatched_module", 0),
        "teachers_touched": stats.get("teachers_touched", 0),
        "notes": notes or {},
    }
    r = requests.patch(
        f"{SB_URL}/rest/v1/training_sync_runs?id=eq.{run_id}",
        headers={**SB_H, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json=payload, timeout=60,
    )
    if r.status_code >= 300:
        print(f"  ! could not close ledger row: {r.status_code} {r.text[:300]}", file=sys.stderr)


def last_successful_window_end(entity):
    """Where the previous good run stopped. Optimisation only — see module docstring."""
    rows = sb_fetch_all(
        f"training_sync_runs?select=window_end&entity=eq.{entity}"
        f"&status=eq.success&order=window_end.desc&limit=1"
    )
    if not rows or not rows[0].get("window_end"):
        return None
    return datetime.fromisoformat(rows[0]["window_end"].replace("Z", "+00:00"))


# ---------------------------------------------------------------- extraction

def build_indices():
    print("Loading Supabase users …", file=sys.stderr)
    users = sb_fetch_all("users?select=id,phone_number,teacher_uuid&order=id")
    by_uuid, by_phone = {}, {}
    for u in users:
        if u.get("teacher_uuid"):
            by_uuid[str(u["teacher_uuid"])] = u["id"]
        n = norm_pk(u.get("phone_number"))
        if n:
            by_phone[n] = u["id"]
    print(f"  users: {len(users):,}  by_uuid: {len(by_uuid):,}  by_phone: {len(by_phone):,}",
          file=sys.stderr)

    print("Loading training_modules mapping …", file=sys.stderr)
    mods = sb_fetch_all("training_modules?select=id,source_module_id&is_active=eq.true")
    mod_map = {m["source_module_id"]: m["id"] for m in mods if m["source_module_id"] is not None}
    print(f"  modules (source_module_id → id): {len(mod_map):,}", file=sys.stderr)
    return by_uuid, by_phone, mod_map


def check_soft_deletes(cur):
    """The sync is insert-only, which is only safe while the source never retracts.

    Zero soft-deletes existed at build time (2026-08-07). If that changes, an
    insert-only sync would silently retain rows the source has withdrawn — so
    stop and make it a human decision rather than quietly diverging.
    """
    cur.execute(
        """
        SELECT count(*) AS n
        FROM fde_production.teacher_training_teachertrainingstatus
        WHERE deleted_at >= %s
        """,
        (MIGRATION_CUTOFF,),
    )
    return cur.fetchone()["n"]


def fetch_progress(cur, mod_source_ids, window_start):
    """One row per (profile_id, training_id) — earliest completion wins.

    GROUP BY collapses the append-not-upsert duplicates in the source. The window
    filters on GREATEST(created, modified) because `modified` alone is unreliable
    here (see module docstring).
    """
    where_window = ""
    params = [list(mod_source_ids)]
    if window_start:
        where_window = "AND GREATEST(s.created, s.modified) >= %s"
        params.append(window_start)

    cur.execute(
        f"""
        SELECT tp.id            AS profile_id,
               u.uuid::text     AS teacher_uuid,
               u.username       AS phone_raw,
               s.training_id    AS source_module_id,
               MIN(s.modified)  AS completed_at,
               MAX(GREATEST(s.created, s.modified)) AS source_touched_at
        FROM fde_production.teacher_training_teachertrainingstatus s
        JOIN fde_production.users_teacherprofile tp ON tp.id = s.profile_id
        JOIN fde_production.users_user u ON u.id = tp.user_id
        WHERE s.is_active
          AND s.deleted_at IS NULL
          AND s.status = 'COMPLETED'
          AND s.training_id = ANY(%s)
          {where_window}
        GROUP BY tp.id, u.uuid, u.username, s.training_id
        """,
        params,
    )
    for row in cur:
        yield row


def resolve_user(row, by_uuid, by_phone):
    """teacher_uuid is the durable link; phone is the fallback for older rows."""
    if row["teacher_uuid"] and row["teacher_uuid"] in by_uuid:
        return by_uuid[row["teacher_uuid"]], "uuid"
    n = norm_pk(row["phone_raw"])
    if n and n in by_phone:
        return by_phone[n], "phone"
    return None, "unmatched"


def batch_upsert(rows, batch_size=500):
    """Conflict-ignore on the natural key — this is what makes re-runs safe."""
    url = f"{SB_URL}/rest/v1/teacher_training_progress?on_conflict=user_id,module_id"
    h = {**SB_H, "Content-Type": "application/json",
         "Prefer": "resolution=ignore-duplicates,return=minimal"}
    sent = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i + batch_size]
        r = requests.post(url, headers=h, json=chunk, timeout=180)
        if r.status_code >= 300:
            print(f"  ! batch {i}–{i+len(chunk)} FAILED: {r.status_code} {r.text[:300]}",
                  file=sys.stderr)
            continue
        sent += len(chunk)
        if (i // batch_size) % 20 == 0:
            print(f"  … {sent:,} / {len(rows):,}", file=sys.stderr)
    return sent


# ---------------------------------------------------------------- attempts

def fetch_legacy_attempts(cur, quiz_source_ids, window_start):
    """Grand-quiz + diagnostic attempts from the legacy app.

    Unlike progress rows, these carry a verdict — so the same level can hold two
    contradictory records across the two apps. Sumbal Pervaiz has exactly that on
    2026-08-04: PASSED 86/200 in the legacy app at 07:49, in_progress here at 03:17.
    """
    where_window = ""
    params = [list(quiz_source_ids)]
    if window_start:
        where_window = "AND GREATEST(a.created, a.modified) >= %s"
        params.append(window_start)

    cur.execute(
        f"""
        SELECT tp.id           AS profile_id,
               u.uuid::text    AS teacher_uuid,
               u.username      AS phone_raw,
               a.grand_quiz_id AS source_quiz_id,
               a.score, a.total_score, a.is_passed,
               a.created       AS started_at,
               a.completed_at,
               MAX(GREATEST(a.created, a.modified)) OVER (PARTITION BY a.id) AS source_touched_at
        FROM fde_production.teacher_training_assessment a
        JOIN fde_production.users_teacherprofile tp ON tp.id = a.profile_id
        JOIN fde_production.users_user u ON u.id = tp.user_id
        WHERE a.is_active
          AND a.deleted_at IS NULL
          AND a.grand_quiz_id = ANY(%s)
          {where_window}
        """,
        params,
    )
    for row in cur:
        yield row


def better_attempt(incoming, existing):
    """The merge rule. Returns True if `incoming` should replace `existing`.

    Chosen so it can never take away something a teacher earned:

      1. A PASS is never overwritten by a non-pass. This is checked on is_passed
         and not on score, because comparing scores alone would let a
         higher-scoring FAIL replace a lower-scoring PASS — the exact outcome
         that would un-certify someone.
      2. Between two passes, the higher score wins.
      3. On equal standing, the EARLIEST completion wins, so a certificate dates
         from when the teacher actually passed rather than when we synced.

    cooldown_until and attempt_number are deliberately NOT merged. With the
    legacy app retired they carry no meaning here, and importing a stale cooldown
    could block a teacher from a retry they are entitled to sit today.
    """
    if existing is None:
        return True

    inc_pass = bool(incoming.get("is_passed"))
    exi_pass = bool(existing.get("is_passed"))
    if inc_pass != exi_pass:
        return inc_pass  # rule 1 — only a pass may displace a non-pass

    inc_score = incoming.get("score") or 0
    exi_score = existing.get("score") or 0
    if inc_score != exi_score:
        return inc_score > exi_score  # rule 2

    inc_at, exi_at = incoming.get("completed_at"), existing.get("completed_at")
    if inc_at and exi_at:
        return inc_at < exi_at  # rule 3 — earliest genuine pass
    return False


def load_existing_attempts():
    """Index the attempts already here, keyed by (user_id, grand_quiz_id).

    This stage CANNOT lean on a database conflict clause the way the progress
    stage does: there is no unique index on the attempts natural key, and the
    original one-shot importer (scripts/migrate-training-attempts.py) inserts
    with no ON CONFLICT. A naive re-run would therefore duplicate every attempt
    it had already written. So we read, diff in memory, and write only the
    genuine changes.
    """
    existing_by_key = {}
    for a in sb_fetch_all(
        "training_assessment_attempts?select=id,user_id,grand_quiz_id,score,is_passed,"
        "status,completed_at"
    ):
        k = (a["user_id"], a["grand_quiz_id"])
        cur_best = existing_by_key.get(k)
        if better_attempt(a, cur_best):
            existing_by_key[k] = a
    return existing_by_key


def write_attempts(to_insert, to_update, batch_size=200):
    """Insert genuinely-new attempts; PATCH the ones the merge rule upgraded."""
    inserted = 0
    for i in range(0, len(to_insert), batch_size):
        chunk = to_insert[i:i + batch_size]
        r = requests.post(
            f"{SB_URL}/rest/v1/training_assessment_attempts",
            headers={**SB_H, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json=chunk, timeout=180,
        )
        if r.status_code >= 300:
            print(f"  ! attempt insert {i} FAILED: {r.status_code} {r.text[:300]}", file=sys.stderr)
            continue
        inserted += len(chunk)

    updated = 0
    for row in to_update:
        r = requests.patch(
            f"{SB_URL}/rest/v1/training_assessment_attempts?id=eq.{row['_id']}",
            headers={**SB_H, "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={k: v for k, v in row.items() if not k.startswith("_")}, timeout=60,
        )
        if r.status_code >= 300:
            print(f"  ! attempt update {row['_id']} FAILED: {r.status_code} {r.text[:200]}",
                  file=sys.stderr)
            continue
        updated += 1
    return inserted, updated


def sync_attempts(conn, by_uuid, by_phone, window_start, window_end, dry_run):
    """Stage 2 — carry legacy quiz verdicts across.

    In scope because 1,364 teachers passed a grand quiz in the legacy app after
    the migration and hold no certificate here. Syncing progress alone would fill
    in their modules and leave them uncertified — the visible half of the bug
    would survive the fix. Once these land, backfill-training-certificates.py
    re-runs and issues the certificates from the synced passes.
    """
    print("\n──────── STAGE 2: attempts ────────", file=sys.stderr)
    quizzes = sb_fetch_all("training_grand_quizzes?select=id,source_quiz_id,level_id&is_active=eq.true")
    quiz_map = {q["source_quiz_id"]: q for q in quizzes if q["source_quiz_id"] is not None}
    print(f"  quizzes mapped (source_quiz_id → id): {len(quiz_map)}", file=sys.stderr)
    if not quiz_map:
        print("  no mapped quizzes — skipping attempts stage.", file=sys.stderr)
        return

    program_id = None
    progs = sb_fetch_all("training_programs?select=id,key&key=eq.niete_standard")
    if progs:
        program_id = progs[0]["id"]

    run_id = ledger_open("attempts", window_start, window_end, dry_run)
    stats = defaultdict(int)
    notes = {}

    try:
        existing_by_key = load_existing_attempts()
        print(f"  existing attempts indexed: {len(existing_by_key):,}", file=sys.stderr)

        cutoff_dt = datetime.fromisoformat(MIGRATION_CUTOFF).replace(tzinfo=timezone.utc)
        scur = conn.cursor(cursor_factory=RealDictCursor, name="fde_attempts_cursor")
        scur.itersize = 5000

        # Collapse the legacy side first: one best attempt per (user, quiz).
        best_incoming = {}
        for src in fetch_legacy_attempts(scur, list(quiz_map.keys()), window_start):
            stats["source_rows_scanned"] += 1
            if src["source_touched_at"] and src["source_touched_at"] >= cutoff_dt:
                stats["source_rows_after_cutoff"] += 1

            user_id, _ = resolve_user(src, by_uuid, by_phone)
            if user_id is None:
                stats["rows_unmatched_teacher"] += 1
                continue
            q = quiz_map.get(src["source_quiz_id"])
            if q is None:
                stats["rows_unmatched_module"] += 1
                continue

            cand = {
                "user_id": user_id,
                "program_id": program_id,
                "grand_quiz_id": q["id"],
                "level_id": q["level_id"],
                "score": src["score"],
                "total_score": src["total_score"],
                "is_passed": src["is_passed"],
                "status": "passed" if src["is_passed"] else "failed",
                "quiz_kind": "grand",
                "started_at": src["started_at"].isoformat() if src["started_at"] else None,
                "completed_at": (src["completed_at"] or src["started_at"]).isoformat()
                                if (src["completed_at"] or src["started_at"]) else None,
            }
            k = (user_id, q["id"])
            if better_attempt(cand, best_incoming.get(k)):
                best_incoming[k] = cand
        scur.close()

        to_insert, to_update = [], []
        for k, cand in best_incoming.items():
            cur_row = existing_by_key.get(k)
            if cur_row is None:
                to_insert.append(cand)
            elif better_attempt(cand, cur_row):
                # An upgrade — the legacy app holds a better verdict than we do.
                upd = {kk: vv for kk, vv in cand.items()
                       if kk in ("score", "total_score", "is_passed", "status", "completed_at")}
                upd["_id"] = cur_row["id"]
                to_update.append(upd)
            else:
                stats["rows_skipped_duplicate"] += 1

        stats["teachers_touched"] = len({k[0] for k in best_incoming})
        notes["to_insert"] = len(to_insert)
        notes["to_update"] = len(to_update)

        print(f"  new attempts:      {len(to_insert):,}")
        print(f"  upgraded verdicts: {len(to_update):,}")
        print(f"  already current:   {stats['rows_skipped_duplicate']:,}")

        if dry_run:
            print("  DRY RUN — no attempt writes performed.")
            ledger_close(run_id, "dry_run", stats, notes)
            return

        ins, upd = write_attempts(to_insert, to_update)
        stats["rows_written"] = ins + upd
        notes["inserted"], notes["updated"] = ins, upd
        print(f"  wrote {ins:,} new + {upd:,} upgraded.")
        ledger_close(run_id, "success", stats, notes)

    except Exception as e:  # noqa: BLE001 — the ledger must record the failure
        notes["error"] = f"{type(e).__name__}: {e}"
        ledger_close(run_id, "failed", stats, notes)
        raise


# ---------------------------------------------------------------- reporting

def retirement_report():
    """Can we turn this off yet? Answered from the ledger, not from vibes."""
    runs = sb_fetch_all(
        "training_sync_runs?select=started_at,status,source_rows_after_cutoff,rows_written"
        "&entity=eq.progress&order=started_at.desc&limit=30"
    )
    if not runs:
        print("No sync runs recorded yet — run --dry-run first.")
        return
    print(f"{'started':26s} {'status':9s} {'post-cutoff':>12s} {'written':>9s}")
    for r in runs:
        print(f"{r['started_at'][:25]:26s} {r['status']:9s} "
              f"{r['source_rows_after_cutoff']:>12,} {r['rows_written']:>9,}")

    real = [r for r in runs if r["status"] == "success"]
    if not real:
        print("\nNo SUCCESSFUL runs yet — the signal below would be misleading.")
        return
    quiet = [r for r in real if r["source_rows_after_cutoff"] == 0]
    streak = 0
    for r in real:
        if r["source_rows_after_cutoff"] == 0:
            streak += 1
        else:
            break
    print(f"\nSuccessful runs: {len(real)}   with zero post-cutoff rows: {len(quiet)}")
    print(f"Current consecutive-quiet streak: {streak}")
    if streak >= 30:
        print("→ The legacy app has been quiet for 30+ consecutive runs. "
              "Safe to propose retiring this sync.")
    else:
        print("→ Legacy app is STILL being written to. Keep the sync running.")


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description="Delta-sync training progress from the legacy FDE DB.")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true", help="Compute + report, NO writes.")
    g.add_argument("--apply", action="store_true", help="Write the missing rows.")
    g.add_argument("--retirement-report", action="store_true", help="Can we switch this off yet?")
    ap.add_argument("--full", action="store_true",
                    help="Ignore the last-run window and scan all history.")
    ap.add_argument("--skip-attempts", action="store_true",
                    help="Progress only — skip the quiz-verdict stage.")
    ap.add_argument("--limit", type=int, default=0, help="Cap rows (smoke tests).")
    args = ap.parse_args()

    if args.retirement_report:
        retirement_report()
        return

    dry_run = args.dry_run
    window_end = datetime.now(timezone.utc)
    window_start = None
    if not args.full:
        prev = last_successful_window_end("progress")
        if prev:
            window_start = prev - LOOKBACK_SLACK

    print(f"Window: {window_start or 'ALL HISTORY'} → {window_end}", file=sys.stderr)
    print(f"Mode:   {'DRY RUN (no writes)' if dry_run else 'APPLY'}", file=sys.stderr)

    by_uuid, by_phone, mod_map = build_indices()
    if not mod_map:
        print("ERROR: no active modules in Supabase — nothing to sync.", file=sys.stderr)
        sys.exit(1)

    run_id = ledger_open("progress", window_start, window_end, dry_run)
    stats = defaultdict(int)
    notes = {}

    try:
        conn = fde_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        deletes = check_soft_deletes(cur)
        stats["soft_deletes_detected"] = deletes
        if deletes:
            # Insert-only is no longer sufficient — refuse rather than diverge.
            notes["error"] = (
                f"{deletes} soft-deleted source rows after {MIGRATION_CUTOFF}. This sync is "
                "insert-only and would silently retain rows the source has retracted. "
                "A deletion path is needed before it can run again."
            )
            print(f"\nABORT: {notes['error']}", file=sys.stderr)
            ledger_close(run_id, "failed", stats, notes)
            sys.exit(2)

        scur = conn.cursor(cursor_factory=RealDictCursor, name="fde_sync_cursor")
        scur.itersize = 5000

        resolved, unmatched_samples = [], []
        cutoff_dt = datetime.fromisoformat(MIGRATION_CUTOFF).replace(tzinfo=timezone.utc)

        for src in fetch_progress(scur, list(mod_map.keys()), window_start):
            stats["source_rows_scanned"] += 1
            if src["source_touched_at"] and src["source_touched_at"] >= cutoff_dt:
                stats["source_rows_after_cutoff"] += 1

            user_id, how = resolve_user(src, by_uuid, by_phone)
            if user_id is None:
                stats["rows_unmatched_teacher"] += 1
                if len(unmatched_samples) < 20:
                    unmatched_samples.append({
                        "profile_id": src["profile_id"],
                        "phone": src["phone_raw"],
                    })
                continue
            module_id = mod_map.get(src["source_module_id"])
            if module_id is None:
                stats["rows_unmatched_module"] += 1
                continue
            resolved.append({
                "user_id": user_id,
                "module_id": module_id,
                "completed_at": src["completed_at"].isoformat(),
            })
            if args.limit and len(resolved) >= args.limit:
                break

        scur.close()

        # Same (user_id, module_id) can arrive via multiple legacy profiles — keep earliest.
        by_pair = {}
        for r in resolved:
            k = (r["user_id"], r["module_id"])
            if k not in by_pair or r["completed_at"] < by_pair[k]["completed_at"]:
                by_pair[k] = r
        final_rows = list(by_pair.values())
        stats["teachers_touched"] = len({r["user_id"] for r in final_rows})

        # What is genuinely NEW here (the rest will be conflict-ignored on write).
        print("Loading existing progress pairs to compute the true delta …", file=sys.stderr)
        existing = set()
        for row in sb_fetch_all("teacher_training_progress?select=user_id,module_id"):
            existing.add((row["user_id"], row["module_id"]))
        new_rows = [r for r in final_rows if (r["user_id"], r["module_id"]) not in existing]
        stats["rows_skipped_duplicate"] = len(final_rows) - len(new_rows)

        print("\n=== SUMMARY ===")
        for k in ["source_rows_scanned", "source_rows_after_cutoff", "rows_unmatched_teacher",
                  "rows_unmatched_module", "rows_skipped_duplicate", "teachers_touched"]:
            print(f"  {k:26s} {stats[k]:>10,}")
        print(f"  {'rows_to_write':26s} {len(new_rows):>10,}")

        if unmatched_samples:
            notes["unmatched_teacher_samples"] = unmatched_samples
        notes["new_rows_computed"] = len(new_rows)

        if dry_run:
            stats["rows_written"] = 0
            notes["would_write"] = len(new_rows)
            print("\n=== DRY RUN — no writes performed ===")
            ledger_close(run_id, "dry_run", stats, notes)
            # A dry run must still REPORT on attempts — that stage is where the
            # 1,364 missing certificates come from, and hiding it behind --apply
            # would mean nobody sees its diff before agreeing to the write.
            if not args.skip_attempts:
                sync_attempts(conn, by_uuid, by_phone, window_start, window_end, dry_run)
            return

        written = batch_upsert(new_rows) if new_rows else 0
        stats["rows_written"] = written
        print(f"\nWrote {written:,} rows.")
        ledger_close(run_id, "success", stats, notes)

        if not args.skip_attempts:
            sync_attempts(conn, by_uuid, by_phone, window_start, window_end, dry_run)
            print("\nNOTE: run scripts/backfill-training-certificates.py next — it issues "
                  "certificates from passed attempts and is idempotent.")

    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 — the ledger must record the failure
        notes["error"] = f"{type(e).__name__}: {e}"
        ledger_close(run_id, "failed", stats, notes)
        raise


if __name__ == "__main__":
    main()
