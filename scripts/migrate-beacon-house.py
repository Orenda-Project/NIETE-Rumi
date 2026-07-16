#!/usr/bin/env python3
"""
NIETE-Rumi Beacon House training migration — one-shot fork of BEACONHOUSE
partner content from the legacy Taleemabad platform (fde_production).

Mirrors scripts/migrate-teacher-training.py (the TALEEMABAD import) —
same target tables, same idempotency (ON CONFLICT DO NOTHING / merge-duplicates),
same source-tag semantics (source_level_id / source_course_id / source_module_id
carry the fde row IDs so a later media-rehost job can find them).

Differences from the TALEEMABAD import:
  - Vendor 'BEACONHOUSE' — passing_pct=70, has_grand_quiz=FALSE,
    has_diagnostic=FALSE, unlock_logic='all_modules', cert_code_prefix='BH'
    (matches the OXBRIDGE partner-import shape from bc831dd).
  - 4 partner levels (English / Mathematics / General Science / Computer Science)
    instead of 4 Taleemabad CPD levels.
  - No grand quizzes, no diagnostics, no questions — BH partner content is
    video/PDF only (Steps 5 & 6 skipped).
  - Media URLs ARE populated: video-type assets land in both video_url and
    source_media_url; pdf-type assets land in source_media_url only (video_url
    NULL — the current delivery flow only serves video, PDF delivery is a
    later feature; source_media_url preserves the source for that work).

Filter (per Kamal, 2026-07-16):
  - lv.vendor='BEACONHOUSE'
  - title NOT LIKE '%test%' AND NOT LIKE 'BE-%' AND NOT LIKE 'bh-%'
  - t.deleted_at IS NULL
  - (t.is_active = TRUE OR t.is_active IS NULL)
  - c.is_active AND c.deleted_at IS NULL
  - lv.is_active

Expected: 4 levels, 20 courses, 206 modules (55 video + 151 pdf).

Reads: Taleemabad prod Postgres (read-only role from .env — TALEEMABAD_DB_*)
Writes: NIETE-Rumi Supabase via exec_sql RPC + PostgREST bulk inserts

Run: python3 scripts/migrate-beacon-house.py
"""
from __future__ import annotations
import json, sys, urllib.request, urllib.error
from pathlib import Path

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
        sslmode=env("TALEEMABAD_DB_SSLMODE") if "TALEEMABAD_DB_SSLMODE" in [l.split("=",1)[0] for l in ENV.read_text().splitlines()] else "require",
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
          (key, name, passing_pct, cooldown_hours, has_grand_quiz, has_diagnostic, cert_code_prefix, unlock_logic, is_active)
        VALUES
          ('BEACONHOUSE', 'Beacon House', 70, 24, FALSE, FALSE, 'BH', 'all_modules', TRUE)
        ON CONFLICT (key) DO NOTHING;
    """)
    print("  Step 1: BEACONHOUSE vendor upserted")


# ----------------------------------------------------------------------------
# Step 2: Levels (4 — English / Math / GenSci / CS)
# ----------------------------------------------------------------------------

def step2_levels(cur) -> dict[int, int]:
    rows = q(cur, """
        SELECT id, name, "order"
        FROM teacher_training_level
        WHERE is_active AND deleted_at IS NULL AND vendor='BEACONHOUSE'
        ORDER BY "order";
    """)
    vendor_id = rest_get("training_vendors?key=eq.BEACONHOUSE&select=id")[0]["id"]
    payload = [{
        "vendor_id": vendor_id,
        "source_level_id": r["id"],
        "name": r["name"],
        "order_index": r["order"],
        "cpd_level": None,        # BH is subject-based, not CPD-tiered
        "is_active": True,
    } for r in rows]
    rest_bulk("training_levels", payload, on_conflict="vendor_id,order_index")

    mapped = rest_get(f"training_levels?vendor_id=eq.{vendor_id}&select=id,source_level_id")
    id_map = {r["source_level_id"]: r["id"] for r in mapped if r["source_level_id"] is not None}
    print(f"  Step 2: {len(rows)} BEACONHOUSE levels upserted (map: {id_map})")
    return id_map


# ----------------------------------------------------------------------------
# Step 3: Courses (20 — 5 per level)
# ----------------------------------------------------------------------------

def step3_courses(cur, level_map: dict[int, int]) -> dict[int, int]:
    rows = q(cur, """
        SELECT c.id, c.level_id, c.title, c.type, c.index
        FROM teacher_training_course c
        JOIN teacher_training_level lv ON lv.id = c.level_id
        WHERE c.is_active AND c.deleted_at IS NULL
          AND lv.is_active AND lv.deleted_at IS NULL
          AND lv.vendor='BEACONHOUSE'
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
    # No unique constraint on (level, source_course_id) — dedup via existing SELECT
    existing = {(r["level_id"], r["source_course_id"]): r["id"]
                for r in rest_get("training_courses?select=id,level_id,source_course_id")
                if r["source_course_id"] is not None}
    new_rows = [p for p in payload if (p["level_id"], p["source_course_id"]) not in existing]
    rest_bulk("training_courses", new_rows)
    mapped = rest_get("training_courses?select=id,source_course_id,level_id")
    # scope to BH level ids to keep the map narrow
    bh_level_ids = set(level_map.values())
    id_map = {r["source_course_id"]: r["id"] for r in mapped
              if r["source_course_id"] is not None and r["level_id"] in bh_level_ids}
    print(f"  Step 3: {len(rows)} BH courses ({len(new_rows)} new)")
    return id_map


# ----------------------------------------------------------------------------
# Step 4: Modules (~206 — videos populate video_url; PDFs populate source_media_url only)
# ----------------------------------------------------------------------------

def step4_modules(cur, course_map: dict[int, int]) -> None:
    rows = q(cur, """
        SELECT tr.id, tr.course_id, tr.title, tr.content, tr.duration, tr.index,
               ma.url AS media_url, ma.type AS media_type
        FROM teacher_training_training tr
        JOIN teacher_training_course c ON c.id = tr.course_id
        JOIN teacher_training_level lv ON lv.id = c.level_id
        LEFT JOIN asset_manager_mediaasset ma ON ma.id = tr.media_asset_id
        WHERE tr.deleted_at IS NULL
          AND (tr.is_active = TRUE OR tr.is_active IS NULL)
          AND c.is_active AND c.deleted_at IS NULL
          AND lv.is_active AND lv.vendor='BEACONHOUSE'
          AND tr.title NOT LIKE '%%test%%'
          AND tr.title NOT LIKE 'BE-%%'
          AND tr.title NOT LIKE 'bh-%%'
        ORDER BY c.id, tr.index;
    """)
    payload = []
    stats = {"video": 0, "pdf": 0, "other": 0, "no_asset": 0}
    for r in rows:
        if r["course_id"] not in course_map:
            continue
        media_url = r["media_url"]
        media_type = (r["media_type"] or "").lower() if r["media_type"] else ""
        rec = {
            "course_id": course_map[r["course_id"]],
            "source_module_id": r["id"],
            "title": r["title"],
            "content_html": r["content"],  # BH usually null
            "duration_seconds": r["duration"] or 0,
            "order_index": r["index"] or 1,
            "is_active": True,
            "source_media_url": media_url,
            "video_url": media_url if media_type == "video" else None,
            "audio_url": None,
        }
        payload.append(rec)
        if not media_url:
            stats["no_asset"] += 1
        elif media_type == "video":
            stats["video"] += 1
        elif media_type == "pdf":
            stats["pdf"] += 1
        else:
            stats["other"] += 1

    existing = {r["source_module_id"] for r in rest_get("training_modules?select=source_module_id")
                if r["source_module_id"]}
    new_rows = [p for p in payload if p["source_module_id"] not in existing]

    # Batch to keep POST bodies under Supabase's default limit; also gives us progress logs.
    BATCH = 25
    for i in range(0, len(new_rows), BATCH):
        chunk = new_rows[i:i+BATCH]
        rest_bulk("training_modules", chunk)
        print(f"    inserted {min(i+BATCH, len(new_rows))}/{len(new_rows)} modules")

    print(f"  Step 4: {len(rows)} BH modules from source ({len(new_rows)} new, {len(payload)-len(new_rows)} already present)")
    print(f"    Asset mix: {stats}")


# ----------------------------------------------------------------------------

def main() -> int:
    print("=" * 70)
    print(f"NIETE-Rumi Beacon House migration → {SUPABASE_URL}")
    print("=" * 70)
    step1_vendor()
    with source_conn() as sconn, sconn.cursor() as cur:
        level_map = step2_levels(cur)
        course_map = step3_courses(cur, level_map)
        step4_modules(cur, course_map)
    print("=" * 70)
    print("Migration complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
