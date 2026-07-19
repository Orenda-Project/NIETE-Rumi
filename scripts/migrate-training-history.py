#!/usr/bin/env python3
"""
NIETE-Rumi Teacher Training — historical progress import from FDE.

Extracts COMPLETED module completions from `fde_production.teacher_training_teachertrainingstatus`,
maps FDE profile → Supabase user (via teacher_uuid, phone fallback) and FDE training_id →
Supabase module_id, then upserts into `teacher_training_progress` (idempotent via
Prefer: resolution=ignore-duplicates).

Modes:
  --dry-run   Writes translated rows to CSV, prints stats, no DB writes.
  (default)   Batch inserts into Supabase.

Only the 171 active modules already in our Supabase are considered. Unmatched FDE
teachers (no Supabase user by uuid or phone) are logged to unmatched.csv.
"""
import argparse
import csv
import os
import re
import sys
import time
from collections import defaultdict

import psycopg2
import requests
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor

load_dotenv(".env")

SB_URL = os.environ["SUPABASE_URL"]
SB_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SB_H = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}

OUT_DIR = "scripts/samples"
os.makedirs(OUT_DIR, exist_ok=True)


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
        r = requests.get(f"{SB_URL}/rest/v1/{path}", headers=rh)
        r.raise_for_status()
        batch = r.json()
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows


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
    print(f"  users loaded: {len(users):,}   by_uuid: {len(by_uuid):,}   by_phone: {len(by_phone):,}", file=sys.stderr)

    print("Loading Supabase training_modules mapping …", file=sys.stderr)
    mods = sb_fetch_all("training_modules?select=id,source_module_id&is_active=eq.true")
    mod_map = {m["source_module_id"]: m["id"] for m in mods if m["source_module_id"] is not None}
    print(f"  modules mapped (source_module_id → id): {len(mod_map):,}", file=sys.stderr)
    return by_uuid, by_phone, mod_map


def fetch_fde_progress(mod_source_ids):
    """One row per (profile_id, training_id) — earliest modified as completed_at."""
    conn = psycopg2.connect(
        host=os.environ["TALEEMABAD_DB_HOST"],
        port=os.environ["TALEEMABAD_DB_PORT"],
        dbname=os.environ["TALEEMABAD_DB_NAME"],
        user=os.environ["TALEEMABAD_DB_USER"],
        password=os.environ["TALEEMABAD_DB_PASSWORD"],
        sslmode="require",
        connect_timeout=10,
    )
    cur = conn.cursor(cursor_factory=RealDictCursor, name="fde_progress_cursor")
    cur.itersize = 5000
    print("Querying FDE progress rows (server-side cursor) …", file=sys.stderr)
    cur.execute(
        """
        SELECT tp.id                AS profile_id,
               u.uuid::text         AS teacher_uuid,
               u.username           AS phone_raw,
               s.training_id        AS source_module_id,
               MIN(s.modified)      AS completed_at
        FROM fde_production.teacher_training_teachertrainingstatus s
        JOIN fde_production.users_teacherprofile tp ON tp.id = s.profile_id
        JOIN fde_production.users_user u ON u.id = tp.user_id
        WHERE s.is_active
          AND s.deleted_at IS NULL
          AND s.status = 'COMPLETED'
          AND s.training_id = ANY(%s)
        GROUP BY tp.id, u.uuid, u.username, s.training_id;
        """,
        (list(mod_source_ids),),
    )
    for row in cur:
        yield row
    cur.close()
    conn.close()


def resolve(row, by_uuid, by_phone):
    if row["teacher_uuid"] and row["teacher_uuid"] in by_uuid:
        return by_uuid[row["teacher_uuid"]], "uuid"
    n = norm_pk(row["phone_raw"])
    if n and n in by_phone:
        return by_phone[n], "phone"
    return None, "unmatched"


def batch_insert(rows, batch_size=500):
    """POST with Prefer: resolution=ignore-duplicates so existing (user_id, module_id) pairs are skipped."""
    url = f"{SB_URL}/rest/v1/teacher_training_progress?on_conflict=user_id,module_id"
    h = {
        **SB_H,
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates,return=minimal",
    }
    inserted = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i : i + batch_size]
        payload = [
            {"user_id": r["user_id"], "module_id": r["module_id"], "completed_at": r["completed_at"]}
            for r in chunk
        ]
        r = requests.post(url, headers=h, json=payload)
        if r.status_code >= 300:
            print(f"  ! batch {i}–{i+len(chunk)} FAILED: {r.status_code} {r.text[:300]}", file=sys.stderr)
            continue
        inserted += len(chunk)
        if (i // batch_size) % 20 == 0:
            print(f"  … progress: {inserted:,} / {len(rows):,}", file=sys.stderr)
    return inserted


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Compute + write CSV, don't hit Supabase writes")
    ap.add_argument("--limit", type=int, default=0, help="Cap rows processed (for smoke tests)")
    args = ap.parse_args()

    by_uuid, by_phone, mod_map = build_indices()
    if not mod_map:
        print("ERROR: no modules in Supabase — nothing to import.", file=sys.stderr)
        sys.exit(1)

    stats = defaultdict(int)
    resolved_rows = []
    unmatched_rows = []

    for src in fetch_fde_progress(list(mod_map.keys())):
        stats["fde_rows"] += 1
        user_id, how = resolve(src, by_uuid, by_phone)
        stats[f"match_{how}"] += 1
        if user_id is None:
            unmatched_rows.append({
                "fde_profile_id": src["profile_id"],
                "teacher_uuid": src["teacher_uuid"],
                "phone_raw": src["phone_raw"],
                "source_module_id": src["source_module_id"],
                "completed_at": src["completed_at"].isoformat(),
            })
            continue
        module_id = mod_map.get(src["source_module_id"])
        if module_id is None:
            stats["dropped_no_module"] += 1
            continue
        resolved_rows.append({
            "user_id": user_id,
            "module_id": module_id,
            "completed_at": src["completed_at"].isoformat(),
        })
        if args.limit and len(resolved_rows) >= args.limit:
            print(f"  limit={args.limit} reached — stopping fetch early", file=sys.stderr)
            break

    # Dedup: same (user_id, module_id) can come from multiple profiles for one user — keep earliest.
    by_pair = {}
    for r in resolved_rows:
        k = (r["user_id"], r["module_id"])
        if k not in by_pair or r["completed_at"] < by_pair[k]["completed_at"]:
            by_pair[k] = r
    final_rows = list(by_pair.values())
    stats["deduped_from"] = len(resolved_rows)
    stats["final_rows"] = len(final_rows)

    # Stats
    print("\n=== SUMMARY ===")
    for k in ["fde_rows", "match_uuid", "match_phone", "match_unmatched", "dropped_no_module", "deduped_from", "final_rows"]:
        print(f"  {k:22s} {stats[k]:>10,}")

    distinct_teachers = len({r["user_id"] for r in final_rows})
    distinct_modules = len({r["module_id"] for r in final_rows})
    print(f"  distinct_teachers      {distinct_teachers:>10,}")
    print(f"  distinct_modules       {distinct_modules:>10,}")

    # Always dump the CSVs for inspection
    resolved_csv = os.path.join(OUT_DIR, "training_history_to_write.csv")
    unmatched_csv = os.path.join(OUT_DIR, "training_history_unmatched.csv")
    with open(resolved_csv, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["user_id", "module_id", "completed_at"])
        w.writeheader()
        w.writerows(final_rows)
    with open(unmatched_csv, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["fde_profile_id", "teacher_uuid", "phone_raw", "source_module_id", "completed_at"])
        w.writeheader()
        w.writerows(unmatched_rows)
    print(f"\n  wrote {resolved_csv} ({len(final_rows):,} rows)")
    print(f"  wrote {unmatched_csv} ({len(unmatched_rows):,} rows)")

    if args.dry_run:
        print("\n=== DRY RUN — no DB writes performed ===")
        return

    print("\n=== INSERTING into teacher_training_progress …")
    t0 = time.time()
    n = batch_insert(final_rows)
    print(f"  inserted (best-effort ack): {n:,} rows in {time.time()-t0:.1f}s")
    print("  (rows already present were skipped by ON CONFLICT DO NOTHING)")


if __name__ == "__main__":
    main()
