#!/usr/bin/env python3
"""
NIETE-Rumi ICT dimension-spine migration — one-time pull from `fde_production`
(NIETE / FDE production Postgres, reached via TALEEMABAD_DB_* creds) into
NIETE-Rumi's Supabase `nietemigrated_*` tables.

Companion to `migrate-coaching-observations.py`, which already moved the FACTS
(9,944 observations, 255,417 answers, 497,177 question options, 8,973 teacher
visits, 324 school visits). Those FKs dangled: nothing in Supabase could say which
coach, which school, or which sector an observation belonged to, because no
dimension was ever migrated. This script lands the five lookups that close the gap.

Requires migration `infrastructure/supabase/migrations/V1.0.11__ict_dimension_spine.sql`
applied first (see infrastructure/CLAUDE.md for the bootstrap path).

Order (FK-safe, ancestors first — dict order below IS the run order):
  1. school_regions    (7)
  2. schools           (462)
  3. coach_profiles    (117; 63 have observations)
  4. teacher_profiles  (4,310 rows / 4,259 distinct teachers)
  5. fico_kpis         (5,180)

Filters at source (governed rules v0.22.5,
`ict-islamabad/dimensions/teachers/teacher-query-rules.md`):
  * users_user.organization_id = 1        (ICT)
  * users_user.is_active AND profile.is_active
  * users_user.is_testing_account = FALSE
  * deleted_at IS NULL on both user and profile

PII: the 9 HR columns on `fico_kpis` (cnic, date_of_birth, gender, joining_date,
last_promotion_date, qualifications, professional_trainings, service_designation,
basic_pay_scale) are deliberately NOT selected. Not migrating PII is stronger than
migrating it and guarding it at the read layer.

Idempotent: `Prefer: resolution=merge-duplicates` on the PK, so re-runs overwrite
matching rows without dupes. Source IDs are preserved as PKs so the already-migrated
fact rows resolve directly.

Reads:  `fde_production` via TALEEMABAD_DB_* (read-only role, enforced in-session).
Writes: NIETE-Rumi Supabase via PostgREST bulk POST.

Usage:
  python3 scripts/migrate-ict-spine.py                       # dry-run (default, no writes)
  python3 scripts/migrate-ict-spine.py --commit              # write everything
  python3 scripts/migrate-ict-spine.py --commit --tables schools,coach_profiles
  python3 scripts/migrate-ict-spine.py --verify              # post-load attribution check
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import date, datetime
from datetime import time as dtime
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import psycopg2

REPO = Path(__file__).resolve().parent.parent
ENV = REPO / ".env"

BATCH = 1000            # PostgREST bulk POST size; matches sibling migration scripts
HTTP_TIMEOUT = 120      # seconds — a 1k-row upsert on a cold table can be slow


def env(k: str) -> str:
    """Read a key from the repo .env. Same reader as the sibling migration scripts."""
    for line in ENV.read_text().splitlines():
        if line.startswith(k + "="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise KeyError(f"{k} missing from {ENV}")


# ----------------------------------------------------------------- table specs
# Each spec: governed source SELECT -> target table + conflict key + expected count.
# `expect` is the live count at 2026-08-04; drift is reported, never silently accepted.
TABLES: dict[str, dict] = {
    "school_regions": dict(
        target="nietemigrated_school_regions",
        pk="id",
        expect=7,
        sql="""
            SELECT id, name, is_active, created, modified
            FROM schools_schoolregion
            WHERE deleted_at IS NULL
        """,
    ),
    "schools": dict(
        target="nietemigrated_schools",
        pk="id",
        expect=462,
        sql="""
            SELECT s.id,
                   s.uuid,
                   s.name,
                   s.emis,                       -- NULL on 3 rows; non-unique
                   s.region_id,
                   r.name AS region_name,        -- denormalized for cheap rollups
                   s.city,
                   s.is_active,
                   s.created,
                   s.modified
            FROM schools_school s
            LEFT JOIN schools_schoolregion r
                   ON r.id = s.region_id
                  AND r.deleted_at IS NULL
            WHERE s.deleted_at IS NULL
        """,
    ),
    "coach_profiles": dict(
        target="nietemigrated_coach_profiles",
        pk="id",
        expect=117,
        sql="""
            SELECT cp.id,                        -- users_coachprofile.id = observations.coach_id
                   cp.user_id,
                   u.name     AS coach_name,
                   u.username AS phone_number,
                   cp.is_active,
                   cp.created,
                   cp.modified
            FROM users_coachprofile cp
            JOIN users_user u ON u.id = cp.user_id
            WHERE u.organization_id = 1
              AND u.is_testing_account = FALSE
              AND u.deleted_at IS NULL
              AND cp.deleted_at IS NULL
        """,
    ),
    "teacher_profiles": dict(
        target="nietemigrated_teacher_profiles",
        pk="id",
        expect=4310,
        sql="""
            SELECT tp.id,                        -- users_teacherprofile.id = teacher_visits.teacher_id
                   tp.user_id,
                   u.name     AS teacher_name,
                   u.username AS phone_number,
                   tp.school_id,
                   tp.levels,                    -- "['PRIMARY', 'MIDDLE']" — overlaps, never sum
                   tp.is_active,
                   tp.created,
                   tp.modified
            FROM users_teacherprofile tp
            JOIN users_user u ON u.id = tp.user_id
            WHERE u.organization_id = 1
              AND u.is_active
              AND tp.is_active
              AND u.is_testing_account = FALSE
              AND u.deleted_at IS NULL
              AND tp.deleted_at IS NULL
        """,
    ),
    # 28 columns at source; 13 migrated. HR/PII and the per-observation-repeated
    # placement columns are deliberately excluded — see the module docstring.
    # Mixed-case source columns MUST stay quoted or Postgres folds them to lowercase.
    "fico_kpis": dict(
        target="nietemigrated_fico_kpis",
        pk="user_id,observation_date,grade,subject",
        expect=5180,
        sql="""
            SELECT user_id,
                   NULLIF("Observation_date", '')::date AS observation_date,
                   COALESCE(grade, '')                  AS grade,
                   COALESCE(subject, '')                AS subject,
                   "EMIS"                               AS emis,
                   "Planning_and_Preparation"           AS planning_and_preparation,
                   "Subject_Knowledge"                  AS subject_knowledge,
                   "Classroom_Management"               AS classroom_management,
                   "Communication_Skills"               AS communication_skills,
                   "Professional_Development"           AS professional_development,
                   "Use_of_Technology"                  AS use_of_technology,
                   total_score_out_of_60,
                   overall_percentage
            FROM fico_kpis
            WHERE user_id IS NOT NULL
              AND NULLIF("Observation_date", '') IS NOT NULL
        """,
        # Rows failing the WHERE cannot form the composite PK. Counted and reported
        # rather than dropped in silence.
        excluded_sql="""
            SELECT count(*) FROM fico_kpis
            WHERE user_id IS NULL
               OR NULLIF("Observation_date", '') IS NULL
        """,
    ),
}


def jsonable(v):
    """psycopg2 -> JSON. Dates/UUIDs/Decimals are not JSON-serializable by default."""
    if isinstance(v, (datetime, date, dtime)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, UUID):
        return str(v)
    return v


def push(target: str, pk: str, rows: list[dict]) -> None:
    """Bulk POST one batch, upserting on `pk`. Exits non-zero on any HTTP failure."""
    req = urllib.request.Request(
        f"{env('SUPABASE_URL')}/rest/v1/{target}?on_conflict={pk}",
        data=json.dumps(rows).encode(),
        headers={
            "apikey": env("SUPABASE_SERVICE_ROLE_KEY"),
            "Authorization": f"Bearer {env('SUPABASE_SERVICE_ROLE_KEY')}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=HTTP_TIMEOUT).read()
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:600]
        sys.exit(
            f"\nFAIL {target}: HTTP {e.code}\n{body}\n\n"
            f"If this is a 404, V1.0.11__ict_dimension_spine.sql has not been "
            f"applied yet. Apply it first, then re-run."
        )
    except urllib.error.URLError as e:
        sys.exit(f"\nFAIL {target}: cannot reach Supabase — {e.reason}")


def verify(conn) -> None:
    """Post-load check: does the attribution chain actually resolve in Supabase?

    This is the whole point of the migration, so it gets its own command rather
    than living only in a doc.
    """
    url = (
        f"{env('SUPABASE_URL')}/rest/v1/nietemigrated_observations"
        "?select=id,coach:nietemigrated_coach_profiles!coach_id(coach_name),"
        "visit:nietemigrated_teacher_visits!visit_id"
        "(teacher:nietemigrated_teacher_profiles!teacher_id"
        "(teacher_name,school:nietemigrated_schools!school_id(name,region_name)))"
        "&coach_id=not.is.null&limit=3"
    )
    req = urllib.request.Request(
        url,
        headers={
            "apikey": env("SUPABASE_SERVICE_ROLE_KEY"),
            "Authorization": f"Bearer {env('SUPABASE_SERVICE_ROLE_KEY')}",
        },
    )
    try:
        rows = json.loads(urllib.request.urlopen(req, timeout=HTTP_TIMEOUT).read())
    except urllib.error.HTTPError as e:
        sys.exit(f"VERIFY FAIL: HTTP {e.code}\n{e.read().decode()[:600]}")

    if not rows:
        sys.exit("VERIFY FAIL: no coach-attributed observations returned.")

    print("\nAttribution chain — coach -> teacher -> school -> sector:")
    for r in rows:
        school = (r.get("visit") or {}).get("teacher", {}).get("school") or {}
        print(
            f"  obs {r['id']}: "
            f"{(r.get('coach') or {}).get('coach_name', '?')} -> "
            f"{((r.get('visit') or {}).get('teacher') or {}).get('teacher_name', '?')} @ "
            f"{school.get('name', '?')} [{school.get('region_name') or 'no sector'}]"
        )
    print("\nVERIFY OK — the chain resolves.")


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Migrate the ICT dimension spine into NIETE-Rumi Supabase."
    )
    ap.add_argument("--commit", action="store_true",
                    help="actually write (default is a dry-run)")
    ap.add_argument("--dry-run", action="store_true",
                    help="explicit no-op; the default anyway")
    ap.add_argument("--tables", default="",
                    help="comma-separated subset (order is still FK-safe)")
    ap.add_argument("--verify", action="store_true",
                    help="check the attribution chain in Supabase and exit")
    a = ap.parse_args()

    conn = psycopg2.connect(**dict(
        host=env("TALEEMABAD_DB_HOST"),
        port=env("TALEEMABAD_DB_PORT"),
        dbname=env("TALEEMABAD_DB_NAME"),
        user=env("TALEEMABAD_DB_USER"),
        password=env("TALEEMABAD_DB_PASSWORD"),
    ))
    conn.set_session(readonly=True)   # belt and braces: source is read-only

    if a.verify:
        verify(conn)
        conn.close()
        return

    unknown = [t for t in a.tables.split(",") if t.strip() and t.strip() not in TABLES]
    if unknown:
        sys.exit(f"unknown table(s): {', '.join(unknown)}\nknown: {', '.join(TABLES)}")

    # Preserve dict order (FK-safe) even when a subset is requested.
    wanted = [t for t in TABLES if not a.tables or t in
              {x.strip() for x in a.tables.split(",")}]

    print(f"{'table':<18}{'rows':>8}  target")
    print("-" * 64)
    drift: list[str] = []

    for name in wanted:
        spec = TABLES[name]
        with conn.cursor() as cur:
            cur.execute(spec["sql"])
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]

        n = len(rows)
        flag = "" if n == spec["expect"] else f"   DRIFT (expected ~{spec['expect']})"
        print(f"{name:<18}{n:>8}  {spec['target']}{flag}")
        if n != spec["expect"]:
            drift.append(f"{name}: got {n}, expected ~{spec['expect']}")

        # Report rows the governed WHERE excluded, so nothing vanishes quietly.
        if spec.get("excluded_sql"):
            with conn.cursor() as cur:
                cur.execute(spec["excluded_sql"])
                skipped = cur.fetchone()[0]
            if skipped:
                print(f"{'':<18}{'':>8}  {skipped} source row(s) excluded "
                      f"(null user_id or blank observation_date)")

        if not a.commit:
            continue

        payload = [{k: jsonable(v) for k, v in r.items()} for r in rows]
        for i in range(0, len(payload), BATCH):
            push(spec["target"], spec["pk"], payload[i:i + BATCH])
        print(f"{'':<18}{'':>8}  committed")

    conn.close()

    if drift:
        print("\nROW-COUNT DRIFT — source changed since 2026-08-04. Reconcile before "
              "trusting these numbers:")
        for d in drift:
            print(f"  WARN {d}")

    if a.commit:
        print("\nDONE. Next: python3 scripts/migrate-ict-spine.py --verify")
    else:
        print("\nDRY-RUN — nothing written. Re-run with --commit.")


if __name__ == "__main__":
    main()
