#!/usr/bin/env python3
"""
READ-ONLY preflight for migration 018 (K-5 v8 LP delivery).

  python3 bot/scripts/migration/verify-018-preflight.py
  NIETE_ENV_PATH=/path/to/.env python3 bot/scripts/migration/verify-018-preflight.py --json out.json

Answers three questions against the LIVE database, none of them from memory:

  1. Does every table/column the v8 delivery path READS or WRITES actually exist,
     in a compatible type? (Rule 16: "the migration is additive" is a hypothesis
     until the live shape is read.)
  2. Would migration 018 apply cleanly against the live shape — in particular
     ALTER TABLE lp_feedback, which is the ONE non-CREATE-IF-NOT-EXISTS statement
     in it and therefore the one that can fail outright.
  3. Is 018 already (partly) applied, and if so does what is there match what the
     file would create?

The session is opened READ ONLY at the server (default_transaction_read_only=on),
so this script cannot write even if it is edited wrongly later.
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras

# The NIETE Supabase project. Asserted BEFORE any connection is opened: a
# worktree seeded with the main-bot .env points SUPABASE_URL at a DIFFERENT
# production database.
NIETE_PROJECT_REF = "ihzciabopbttygxxgrkm"
POOLER_HOST = "aws-1-ap-south-1.pooler.supabase.com"
POOLER_PORT = 6543

REPO_ROOT = Path(__file__).resolve().parents[3]

# ── What the shipped code actually depends on ───────────────────────────────
# Sourced by reading the code, not by memory:
#   bot/shared/services/lp-v8-delivery.service.js
#   bot/shared/services/lp-feedback.service.js
#   bot/shared/routes/pakistan-lp-endpoint.js
#   bot/scripts/upload-lp-v8-to-r2.js
CODE_DEPENDENCIES = {
    "users": ["id", "phone_number", "preferred_language"],
    "lesson_plans": ["id", "user_id", "topic", "grade", "subject", "type", "content"],
    "lp_feedback": [
        "id", "user_id", "lesson_plan_id", "useful", "reason_text", "reason_polarity",
        "lp_variant", "grade", "subject", "chapter_number", "segment_number", "topic",
        "trigger_mode",
    ],
    "pre_generated_lps": ["id"],
    "lesson_plan_catalog": ["id"],
}

# What migration 018 creates. Checked only where the object already exists.
M018_ASSETS = {
    "lesson_id": "text", "catalog_version": "text", "version_stamp": "text",
    "content_hash": "text", "r2_key": "text", "bytes": "bigint",
    "source_bytes": "bigint", "source_sha1": "text", "prompt_layer_sha": "text",
    "rendered_at": "timestamp with time zone", "asset_kind": "text",
    "is_current": "boolean", "superseded_at": "timestamp with time zone",
    "created_at": "timestamp with time zone", "id": "uuid",
}
M018_DOWNLOADS = {
    "id": "uuid", "user_id": "uuid", "lesson_id": "text", "asset_id": "uuid",
    "version_stamp": "text", "content_hash": "text", "phone": "text",
    "status": "text", "error_text": "text", "grade": "integer", "subject": "text",
    "chapter_number": "integer", "segment_index": "integer",
    "correlation_id": "text", "created_at": "timestamp with time zone",
}
M018_INDEXES = [
    "idx_lp_assets_identity", "idx_lp_assets_one_current", "idx_lp_assets_current_lookup",
    "idx_lp_downloads_tick", "idx_lp_downloads_user_time", "idx_lp_downloads_lesson_time",
]

INSPECT_TABLES = [
    "users", "lesson_plans", "lp_feedback", "pre_generated_lps",
    "lesson_plan_catalog", "niete_lp_assets", "niete_lp_downloads",
]


def load_env(path: Path) -> dict:
    out = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
        if not m:
            continue
        v = m.group(2).strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        out[m.group(1)] = v
    return out


def resolve_creds():
    """NIETE_-prefixed names win (workspace root .env); repo-local names are the fallback."""
    candidates = []
    if os.environ.get("NIETE_ENV_PATH"):
        candidates.append(Path(os.environ["NIETE_ENV_PATH"]))
    candidates += [REPO_ROOT / ".env", REPO_ROOT.parent / ".env"]

    env = {}
    for p in candidates:
        for k, v in load_env(p).items():
            env.setdefault(k, v)
    for k, v in os.environ.items():
        env.setdefault(k, v)

    url = env.get("NIETE_SUPABASE_URL") or env.get("SUPABASE_URL")
    pwd = env.get("NIETE_SUPABASE_DB_PASSWORD") or env.get("SUPABASE_DB_PASSWORD")
    if not url or not pwd:
        raise SystemExit(
            "ABORT: need NIETE_SUPABASE_URL + NIETE_SUPABASE_DB_PASSWORD "
            "(or SUPABASE_URL + SUPABASE_DB_PASSWORD). Searched: "
            + ", ".join(str(c) for c in candidates)
        )
    m = re.match(r"https://([a-z0-9]+)\.supabase\.co", url)
    if not m:
        raise SystemExit(f"ABORT: unrecognised Supabase URL shape: {url[:40]}…")
    ref = m.group(1)
    if ref != NIETE_PROJECT_REF:
        raise SystemExit(
            f"ABORT: ref '{ref}' is not the NIETE project ('{NIETE_PROJECT_REF}'). "
            "Refusing to introspect another production database."
        )
    return ref, pwd


def connect(ref: str, pwd: str):
    return psycopg2.connect(
        host=POOLER_HOST, port=POOLER_PORT, dbname="postgres",
        user=f"postgres.{ref}", password=pwd,
        sslmode="require",
        # Belt and braces: the server refuses writes for this session.
        options="-c default_transaction_read_only=on",
        connect_timeout=15,
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


def q(cur, sql, args=None):
    cur.execute(sql, args or ())
    return cur.fetchall()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", help="write the machine-readable dump here")
    args = ap.parse_args()

    ref, pwd = resolve_creds()
    print(f"=== NIETE live schema preflight (READ ONLY) — project {ref} ===\n")

    conn = connect(ref, pwd)
    cur = conn.cursor()

    report = {"project_ref": ref, "tables": {}, "indexes": {}, "checks": {}, "counts": {}}
    problems, notes = [], []

    # ── existence ───────────────────────────────────────────────────────────
    present = {
        r["table_name"]
        for r in q(cur, """
            SELECT table_name FROM information_schema.tables
            WHERE table_schema='public' AND table_name = ANY(%s)
        """, (INSPECT_TABLES,))
    }

    # Anything else LP-shaped that exists but we did not think to ask about.
    lp_shaped = [
        r["table_name"]
        for r in q(cur, """
            SELECT table_name FROM information_schema.tables
            WHERE table_schema='public'
              AND (table_name LIKE '%%lp%%' OR table_name LIKE '%%lesson%%')
            ORDER BY table_name
        """)
    ]
    report["lp_shaped_tables"] = lp_shaped
    print("LP/lesson-shaped tables that exist in public:")
    for t in lp_shaped:
        print(f"   • {t}")
    print()

    # ── columns ─────────────────────────────────────────────────────────────
    for t in INSPECT_TABLES:
        if t not in present:
            report["tables"][t] = None
            continue
        cols = q(cur, """
            SELECT column_name, data_type, is_nullable, column_default,
                   character_maximum_length
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name=%s
            ORDER BY ordinal_position
        """, (t,))
        report["tables"][t] = [dict(c) for c in cols]

    # ── indexes ─────────────────────────────────────────────────────────────
    for t in INSPECT_TABLES:
        if t not in present:
            continue
        report["indexes"][t] = [
            dict(r) for r in q(cur, """
                SELECT i.relname AS name, pg_get_indexdef(ix.indexrelid) AS def,
                       ix.indisvalid AS valid, ix.indisunique AS uniq,
                       s.idx_scan AS scans
                FROM pg_index ix
                JOIN pg_class i ON i.oid = ix.indexrelid
                JOIN pg_class tb ON tb.oid = ix.indrelid
                LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = ix.indexrelid
                WHERE tb.relname = %s
                ORDER BY i.relname
            """, (t,))
        ]

    # ── check constraints ───────────────────────────────────────────────────
    for t in INSPECT_TABLES:
        if t not in present:
            continue
        report["checks"][t] = [
            dict(r) for r in q(cur, """
                SELECT con.conname AS name, pg_get_constraintdef(con.oid) AS def
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace ns ON ns.oid = rel.relnamespace
                WHERE ns.nspname='public' AND rel.relname=%s
                ORDER BY con.conname
            """, (t,))
        ]

    # ── row counts (cheap, exact — these tables are small) ──────────────────
    for t in INSPECT_TABLES:
        if t not in present:
            continue
        report["counts"][t] = q(cur, f'SELECT count(*) AS n FROM public."{t}"')[0]["n"]

    # ── reconcile: code dependencies ────────────────────────────────────────
    print("Code dependencies (what the shipped v8 path reads/writes):")
    for t, needed in CODE_DEPENDENCIES.items():
        if t not in present:
            problems.append(f"MISSING TABLE {t} — required by the shipped code")
            print(f"   ✗ {t}: MISSING")
            continue
        have = {c["column_name"] for c in report["tables"][t]}
        missing = [c for c in needed if c not in have]
        state = "✓" if not missing else "✗"
        print(f"   {state} {t}: {len(have)} cols, {report['counts'][t]} rows"
              + (f" — MISSING {missing}" if missing else ""))
        if missing:
            problems.append(f"{t} is missing {missing} — required by the shipped code")
    print()

    # ── reconcile: migration 018 ────────────────────────────────────────────
    print("Migration 018 reconciliation:")
    for tname, expected in (("niete_lp_assets", M018_ASSETS),
                            ("niete_lp_downloads", M018_DOWNLOADS)):
        if tname not in present:
            print(f"   • {tname}: not present → CREATE TABLE will create it (expected pre-go)")
            continue
        have = {c["column_name"]: c["data_type"] for c in report["tables"][tname]}
        missing = [c for c in expected if c not in have]
        mistyped = [
            f"{c}: live={have[c]} expected={expected[c]}"
            for c in expected if c in have and have[c] != expected[c]
        ]
        extra = [c for c in have if c not in expected]
        if missing or mistyped:
            # This is the dangerous case: CREATE TABLE IF NOT EXISTS is a NO-OP
            # against an existing table, so a divergent live table is NOT healed
            # by re-running the migration.
            problems.append(
                f"{tname} EXISTS but diverges — CREATE TABLE IF NOT EXISTS will NOT fix it. "
                f"missing={missing} mistyped={mistyped}"
            )
            print(f"   ✗ {tname}: EXISTS and diverges — missing={missing} mistyped={mistyped}")
        else:
            print(f"   ✓ {tname}: exists and matches 018 ({report['counts'][tname]} rows)"
                  + (f"; extra cols {extra}" if extra else ""))
        if extra:
            notes.append(f"{tname} has columns 018 does not declare: {extra}")

    # lp_feedback: the ALTER is the one statement that can hard-fail
    if "lp_feedback" not in present:
        problems.append(
            "lp_feedback does NOT exist — migration 018's `ALTER TABLE lp_feedback` "
            "will ERROR and abort the whole migration. Apply 017 first."
        )
        print("   ✗ lp_feedback: MISSING → 018's ALTER will abort the migration (apply 017 first)")
    else:
        have = {c["column_name"] for c in report["tables"]["lp_feedback"]}
        if "useful_component" in have:
            print("   ✓ lp_feedback.useful_component: already present (018 ALTER is a no-op)")
        else:
            print("   • lp_feedback.useful_component: absent → 018 ALTER will add it")

    live_idx = {i["name"] for t in report["indexes"] for i in report["indexes"][t]}
    idx_missing = [i for i in M018_INDEXES if i not in live_idx]
    idx_invalid = [
        i["name"] for t in report["indexes"] for i in report["indexes"][t]
        if i["name"] in M018_INDEXES and not i["valid"]
    ]
    if idx_missing:
        print(f"   • 018 indexes not yet present: {idx_missing}")
    if idx_invalid:
        problems.append(f"018 indexes exist but are INVALID: {idx_invalid}")
        print(f"   ✗ 018 indexes present but INVALID: {idx_invalid}")
    print()

    # ── the two live-shape facts the plan guessed at ────────────────────────
    lp = report["tables"].get("lesson_plans") or []
    lpcols = {c["column_name"]: c for c in lp}
    print("lesson_plans live shape (the plan could only see the 11-column base schema):")
    print(f"   {len(lp)} columns: {', '.join(sorted(lpcols))}")
    grade = lpcols.get("grade")
    if grade:
        print(f"   grade → {grade['data_type']}"
              + (f"({grade['character_maximum_length']})" if grade["character_maximum_length"] else "")
              + f", nullable={grade['is_nullable']}")
    # NOT NULL columns with no default would break the delivery's minimal insert.
    blockers = [
        c["column_name"] for c in lp
        if c["is_nullable"] == "NO" and c["column_default"] is None
        and c["column_name"] not in ("id", "user_id", "topic", "grade", "subject", "type", "content")
    ]
    if blockers:
        problems.append(
            f"lesson_plans has NOT NULL columns with no default that the v8 delivery "
            f"insert does not set: {blockers} — the insert would fail at runtime"
        )
        print(f"   ✗ NOT NULL + no default, unset by the v8 insert: {blockers}")
    else:
        print("   ✓ the v8 delivery's minimal insert covers every NOT NULL-without-default column")
    print()

    conn.close()

    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=2, default=str))
        print(f"Full dump → {args.json}\n")

    if notes:
        print("Notes (not blocking):")
        for n in notes:
            print(f"   – {n}")
        print()

    if problems:
        print("RESULT: DIVERGENT — do not apply 018 until these are resolved:")
        for p in problems:
            print(f"   ✗ {p}")
        return 1
    print("RESULT: VERIFIED — the live shape matches what the code and 018 assume.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
