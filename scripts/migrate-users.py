#!/usr/bin/env python3
"""
NIETE-Rumi user migration — import Taleemabad users (org 1) into Supabase.

Extends and eventually replaces `migrate-teacher-training.py` step 8, which only
imported teachers (single profile type) with a bare 4-column payload. This script
covers all 6 role types and preserves the full profile metadata in
`preferences.taleemabad.*` for downstream feature linkage (completed LPs,
completed trainings, coaching observations, etc.).

Filters — a user is imported iff ALL of:
  - fde_production.users_user.organization_id = 1
  - fde_production.users_user.is_active = true
  - fde_production.users_user.is_testing_account = false
  - fde_production.users_user.is_username_dummy_phone = false
  - user has at least one active profile in:
      users_{teacher,principal,coach,areaeducationofficer,regionalmanager,programmanager}profile
  - phone number normalizes to a valid PK E.164: ^92\\d{10}$

Password strategy:
  Every imported user gets a bcrypt hash of a fresh 12-char cryptographic
  random secret. The secret is never persisted or logged. Users must use the
  WhatsApp OTP reset flow to establish a real password before portal login.

Merge policy (ON CONFLICT phone_number):
  Re-enrich rows whose source starts with 'taleemabad' (or is NULL). Never
  touches source='direct' or any other origin. COALESCE ensures no non-null
  field is ever overwritten — pending values fill in, existing values stay.
  portal_password_hash is set only if currently NULL (never invalidates a
  password the teacher already established via WhatsApp OTP reset).

Usage:
  python3 scripts/migrate-users.py            # pre-flight only (no writes)
  python3 scripts/migrate-users.py --commit   # actually writes to Supabase
"""
from __future__ import annotations
import argparse
import json
import re
import secrets
import sys
from collections import defaultdict
from pathlib import Path

import bcrypt
import psycopg2
import psycopg2.extras

REPO = Path(__file__).resolve().parent.parent
ENV_PATH = REPO / ".env"
ORG_ID = 1
BATCH_SIZE = 500
MIGRATION_MARKER = "taleemabad_import_2026_07_12"


def env(k: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        if line.startswith(k + "="):
            return line.split("=", 1)[1]
    raise KeyError(k)


def taleemabad_conn():
    return psycopg2.connect(
        host=env("TALEEMABAD_DB_HOST"),
        port=int(env("TALEEMABAD_DB_PORT") or "5432"),
        user=env("TALEEMABAD_DB_USER"),
        password=env("TALEEMABAD_DB_PASSWORD"),
        dbname=env("TALEEMABAD_DB_NAME"),
        sslmode=env("TALEEMABAD_DB_SSLMODE") or "require",
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


def niete_conn():
    supa_url = env("SUPABASE_URL")
    m = re.match(r"https://([a-z0-9]+)\.supabase\.co", supa_url)
    if not m:
        raise SystemExit(f"Unrecognized SUPABASE_URL format: {supa_url}")
    project_ref = m.group(1)
    return psycopg2.connect(
        host="aws-1-ap-south-1.pooler.supabase.com",
        port=6543,
        user=f"postgres.{project_ref}",
        password=env("SUPABASE_DB_PASSWORD"),
        dbname="postgres",
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def normalize_phone_pk(raw) -> str | None:
    """Strip non-digits; 0/3 prefix -> 92; truncate to 12; match ^92\\d{10}$."""
    if not raw:
        return None
    digits = re.sub(r"\D", "", str(raw))
    if not digits:
        return None
    if digits.startswith("92"):
        pass
    elif digits.startswith("00"):
        digits = digits[2:]
    elif digits.startswith("0"):
        digits = "92" + digits[1:]
    elif digits.startswith("3"):
        digits = "92" + digits
    else:
        return None
    digits = digits[:12]
    return digits if re.match(r"^92\d{10}$", digits) else None


def split_name(full):
    if not full:
        return None, None
    tokens = str(full).strip().split(None, 1)
    if not tokens:
        return None, None
    return tokens[0], (tokens[1] if len(tokens) > 1 else None)


def unusable_hash() -> str:
    # Cost=4 (the minimum) is deliberate here: this is a placeholder hash of a
    # 12-char cryptographic random secret that's discarded immediately. The
    # secret is never stored/logged/transmitted, so there's no attack surface
    # where a higher cost matters. When the teacher later sets a real password
    # via WhatsApp OTP reset, the portal's setup flow re-hashes at cost=10.
    # Cost=4: ~1ms/row. Cost=10: ~100ms/row. Cost=10 * 4500 rows = 7.5 min.
    secret = secrets.token_urlsafe(9).encode()
    return bcrypt.hashpw(secret, bcrypt.gensalt(rounds=4)).decode()


def as_iso(v):
    return v.isoformat() if v else None


# ---------------------------------------------------------------------------
# Fetch from Taleemabad
# ---------------------------------------------------------------------------
def fetch_org_name(cur, org_id: int) -> str | None:
    cur.execute("SELECT name FROM fde_production.core_organization WHERE id = %s", (org_id,))
    r = cur.fetchone()
    return r["name"] if r else None


def fetch_all_orgs(cur):
    cur.execute("SELECT id, name FROM fde_production.core_organization ORDER BY id")
    return list(cur.fetchall())


def fetch_users(cur, org_id: int):
    cur.execute("""
        SELECT id, uuid, username, name, email, country_code,
               is_active, is_username_dummy_phone, is_testing_account,
               is_superuser, is_staff,
               date_joined, activated_on, last_login, modified,
               additional_phone_numbers, user_meta_data
        FROM fde_production.users_user
        WHERE organization_id = %s
    """, (org_id,))
    return list(cur.fetchall())


def fetch_role_map(cur) -> dict[int, str]:
    """Resolve role_id → role name. Graceful degradation if the table doesn't exist."""
    for table in ("users_role", "users_roles"):
        try:
            cur.execute(f"SELECT id, name FROM fde_production.{table}")
            return {r["id"]: r["name"] for r in cur.fetchall()}
        except psycopg2.Error:
            cur.connection.rollback()
    return {}


def _profile_common_cols(alias="p"):
    cols = [
        "id AS profile_id", "uuid AS profile_uuid", "user_id",
        "cnic", "joining_date", "gender", "date_of_birth",
        "service_designation", "basic_pay_scale", "job_type",
        "qualifications", "professional_trainings",
        "role_id", "last_promotion_date", "ever_promoted",
        "sent_by_profile_id", "sent_by_profile_type_id",
    ]
    return ", ".join(f"{alias}.{c}" for c in cols)


SCHOOL_JOIN = """
    LEFT JOIN fde_production.schools_school s ON s.id = p.school_id
    LEFT JOIN fde_production.schools_schoolgroup sg ON sg.id = s.group_id
    LEFT JOIN fde_production.schools_schoolregion sr ON sr.id = s.region_id
"""
SCHOOL_SELECT = """,
    s.id AS school_id, s.uuid AS school_uuid, s.name AS school_name,
    s.emis AS school_emis, s.city AS school_city, s.address AS school_address,
    sg.id AS school_group_id, sg.uuid AS school_group_uuid, sg.name AS school_group_name,
    sr.id AS school_region_id, sr.uuid AS school_region_uuid, sr.name AS school_region_name
"""

GROUP_JOIN = """
    LEFT JOIN fde_production.schools_schoolgroup sg ON sg.id = p.school_group_id
"""
GROUP_SELECT = """,
    sg.id AS school_group_id, sg.uuid AS school_group_uuid, sg.name AS school_group_name
"""


def _fetch_profiles(cur, table: str, org_id: int, *, extra_select="", extra_join="", extra_cols=""):
    common = _profile_common_cols("p")
    extra_common = f", p.{extra_cols}" if extra_cols else ""
    sql = f"""
        SELECT {common}{extra_common}{extra_select}
        FROM fde_production.{table} p
        JOIN fde_production.users_user u ON u.id = p.user_id
        {extra_join}
        WHERE p.is_active = true
          AND p.deleted_at IS NULL
          AND u.organization_id = %s
          AND u.is_active = true
          AND u.is_testing_account = false
          AND u.is_username_dummy_phone = false
    """
    cur.execute(sql, (org_id,))
    return list(cur.fetchall())


def fetch_all_profiles(cur, org_id: int) -> dict[int, dict[str, dict]]:
    """Return { user_id → { role_name → profile_row } }."""
    by_user: dict[int, dict[str, dict]] = defaultdict(dict)
    plan = [
        ("teacher",          "users_teacherprofile",              SCHOOL_SELECT, SCHOOL_JOIN, "levels"),
        ("principal",        "users_principalprofile",            SCHOOL_SELECT, SCHOOL_JOIN, "levels"),
        ("coach",            "users_coachprofile",                "",            "",          ""),
        ("aeo",              "users_areaeducationofficerprofile", GROUP_SELECT,  GROUP_JOIN,  ""),
        ("regional_manager", "users_regionalmanagerprofile",      GROUP_SELECT,  GROUP_JOIN,  ""),
        ("program_manager",  "users_programmanagerprofile",       GROUP_SELECT,  GROUP_JOIN,  ""),
    ]
    for role, table, sel, join, extra in plan:
        for row in _fetch_profiles(cur, table, org_id, extra_select=sel, extra_join=join, extra_cols=extra):
            by_user[row["user_id"]][role] = dict(row)
    return by_user


# ---------------------------------------------------------------------------
# Transform
# ---------------------------------------------------------------------------
def build_profile_metadata(role: str, prow: dict, role_map: dict[int, str]) -> dict:
    """Serialize a single profile row into JSONB-safe dict."""
    md = {
        "profile_id":              prow.get("profile_id"),
        "profile_uuid":            str(prow["profile_uuid"]) if prow.get("profile_uuid") else None,
        "cnic":                    prow.get("cnic"),
        "gender":                  prow.get("gender"),
        "date_of_birth":           str(prow["date_of_birth"]) if prow.get("date_of_birth") else None,
        "joining_date":            str(prow["joining_date"]) if prow.get("joining_date") else None,
        "service_designation":     prow.get("service_designation"),
        "basic_pay_scale":         prow.get("basic_pay_scale"),
        "job_type":                prow.get("job_type"),
        "qualifications":          prow.get("qualifications"),
        "professional_trainings":  prow.get("professional_trainings"),
        "role_id":                 prow.get("role_id"),
        "role_name":               role_map.get(prow.get("role_id")) if prow.get("role_id") else None,
        "last_promotion_date":     str(prow["last_promotion_date"]) if prow.get("last_promotion_date") else None,
        "ever_promoted":           prow.get("ever_promoted"),
        "sent_by_profile_id":      prow.get("sent_by_profile_id"),
        "sent_by_profile_type_id": prow.get("sent_by_profile_type_id"),
    }
    if role in ("teacher", "principal"):
        levels = prow.get("levels")
        md["levels"] = list(levels) if levels else None
    if role in ("teacher", "principal") and prow.get("school_id"):
        md.update({
            "school_id":         prow.get("school_id"),
            "school_uuid":       str(prow["school_uuid"]) if prow.get("school_uuid") else None,
            "school_name":       prow.get("school_name"),
            "school_emis":       prow.get("school_emis"),
            "school_city":       prow.get("school_city"),
            "school_address":    prow.get("school_address"),
            "school_group_id":   prow.get("school_group_id"),
            "school_group_uuid": str(prow["school_group_uuid"]) if prow.get("school_group_uuid") else None,
            "school_group_name": prow.get("school_group_name"),
            "school_region_id":  prow.get("school_region_id"),
            "school_region_uuid": str(prow["school_region_uuid"]) if prow.get("school_region_uuid") else None,
            "school_region_name": prow.get("school_region_name"),
        })
    if role in ("aeo", "regional_manager", "program_manager") and prow.get("school_group_id"):
        md.update({
            "school_group_id":   prow.get("school_group_id"),
            "school_group_uuid": str(prow["school_group_uuid"]) if prow.get("school_group_uuid") else None,
            "school_group_name": prow.get("school_group_name"),
        })
    return {k: v for k, v in md.items() if v is not None}


def transform(user_row: dict, profiles: dict[str, dict], org_name: str, role_map: dict[int, str]):
    """Convert one Taleemabad user + its profiles into a NIETE users row. Returns None on drop."""
    phone = normalize_phone_pk(user_row.get("username"))
    if not phone:
        return None

    first, last = split_name(user_row.get("name"))
    full_name = (user_row.get("name") or "").strip() or None

    # Pick primary school from teacher > principal > (none)
    primary = profiles.get("teacher") or profiles.get("principal") or {}
    school_name = primary.get("school_name")
    school_region = primary.get("school_region_name")

    # Union of levels across teacher + principal profiles (both may have grade levels)
    levels_set = []
    for role in ("teacher", "principal"):
        r = profiles.get(role) or {}
        if r.get("levels"):
            for lv in r["levels"]:
                if lv not in levels_set:
                    levels_set.append(lv)
    levels = levels_set or None
    grades_taught = ", ".join(levels) if levels else None

    profile_types = sorted(profiles.keys())
    profile_metadata = {
        role: build_profile_metadata(role, prow, role_map)
        for role, prow in profiles.items()
    }

    taleemabad_bundle = {
        "user_id":                    user_row["id"],
        "uuid":                       str(user_row["uuid"]),
        "email":                      user_row.get("email"),
        "country_code":               user_row.get("country_code"),
        "additional_phone_numbers":   list(user_row["additional_phone_numbers"]) if user_row.get("additional_phone_numbers") else None,
        "is_username_dummy_phone":    user_row.get("is_username_dummy_phone"),
        "is_superuser":               user_row.get("is_superuser"),
        "is_staff":                   user_row.get("is_staff"),
        "date_joined":                as_iso(user_row.get("date_joined")),
        "activated_on":               as_iso(user_row.get("activated_on")),
        "last_login":                 as_iso(user_row.get("last_login")),
        "modified":                   as_iso(user_row.get("modified")),
        "user_meta_data":             user_row.get("user_meta_data"),
        "profile_types":              profile_types,
        "profile_metadata":           profile_metadata,
    }
    taleemabad_bundle = {k: v for k, v in taleemabad_bundle.items() if v is not None}

    return {
        "phone_number":         phone,
        "name":                 full_name,
        "first_name":           first,
        "last_name":            last,
        "teacher_uuid":         str(user_row["uuid"]),
        "school_name":          school_name,
        "region":               school_region,
        "country":              "Pakistan",
        "organization":         org_name,
        "levels":               levels,
        "grades_taught":        grades_taught,
        "portal_password_hash": unusable_hash(),
        "portal_activated":     True,
        "source":               MIGRATION_MARKER,
        "preferences":          {"taleemabad": taleemabad_bundle},
    }


# ---------------------------------------------------------------------------
# Write to NIETE Supabase
# ---------------------------------------------------------------------------
UPSERT_SQL = """
INSERT INTO users (
    phone_number, name, first_name, last_name, teacher_uuid, school_name, region,
    country, organization, levels, grades_taught, portal_password_hash, portal_activated,
    source, preferences
) VALUES %s
ON CONFLICT (phone_number) DO UPDATE SET
    name              = COALESCE(users.name,              EXCLUDED.name),
    first_name        = COALESCE(users.first_name,        EXCLUDED.first_name),
    last_name         = COALESCE(users.last_name,         EXCLUDED.last_name),
    teacher_uuid      = COALESCE(users.teacher_uuid,      EXCLUDED.teacher_uuid),
    school_name       = COALESCE(users.school_name,       EXCLUDED.school_name),
    region            = COALESCE(users.region,            EXCLUDED.region),
    country           = COALESCE(users.country,           EXCLUDED.country),
    organization      = COALESCE(users.organization,      EXCLUDED.organization),
    levels            = COALESCE(users.levels,            EXCLUDED.levels),
    grades_taught     = COALESCE(users.grades_taught,     EXCLUDED.grades_taught),
    portal_password_hash = COALESCE(users.portal_password_hash, EXCLUDED.portal_password_hash),
    portal_activated  = CASE
        WHEN users.portal_activated = true THEN true
        WHEN users.portal_password_hash IS NULL THEN true
        ELSE users.portal_activated
    END,
    preferences       = COALESCE(users.preferences, '{}'::jsonb) || EXCLUDED.preferences
WHERE users.source IS NULL OR users.source = '' OR users.source LIKE 'taleemabad%%'
"""


def upsert_batch(nconn, rows: list[dict]) -> tuple[int, int]:
    """Return (attempted, would_skip_direct). Uses psycopg2.execute_values."""
    cols = ["phone_number", "name", "first_name", "last_name", "teacher_uuid",
            "school_name", "region", "country", "organization", "levels",
            "grades_taught", "portal_password_hash", "portal_activated",
            "source", "preferences"]
    tuples = [
        tuple(
            psycopg2.extras.Json(r[c]) if c == "preferences"
            else r[c]
            for c in cols
        )
        for r in rows
    ]
    with nconn.cursor() as cur:
        psycopg2.extras.execute_values(cur, UPSERT_SQL, tuples, page_size=BATCH_SIZE)
    nconn.commit()
    return len(tuples), 0


# ---------------------------------------------------------------------------
# Pre-flight + main
# ---------------------------------------------------------------------------
def preflight_report(user_rows, profiles_by_user, transformed, dropped):
    print("\n" + "=" * 72)
    print("PRE-FLIGHT REPORT")
    print("=" * 72)
    print(f"  Total users_user rows in org {ORG_ID:>3}                      : {len(user_rows):>6,}")
    for reason, n in dropped.items():
        print(f"  Dropped — {reason:<45}: {n:>6,}")
    print(f"  Ready to import                                       : {len(transformed):>6,}")
    print()

    if not transformed:
        return

    print(f"Profile-type distribution among imported users:")
    role_counts = defaultdict(int)
    for uid, profiles in profiles_by_user.items():
        for role in profiles.keys():
            role_counts[role] += 1
    for role, n in sorted(role_counts.items(), key=lambda x: -x[1]):
        print(f"  {role:<20}: {n:>6,}")
    print()

    print("Sample rows (first 3, JSON pretty-printed):")
    for r in transformed[:3]:
        redacted = dict(r)
        redacted["portal_password_hash"] = f"<bcrypt, {len(r['portal_password_hash'])} chars>"
        print(json.dumps(redacted, indent=2, default=str))
        print("-" * 72)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true",
                        help="Actually write to Supabase (default is dry-run pre-flight only)")
    args = parser.parse_args()

    print(f"NIETE-Rumi user migration ({MIGRATION_MARKER})")
    print(f"  Mode: {'COMMIT (writes will happen)' if args.commit else 'DRY-RUN (no writes)'}")
    print()

    with taleemabad_conn() as tconn, tconn.cursor() as tcur:
        print("Step 1 — Verify Taleemabad org identity")
        orgs = fetch_all_orgs(tcur)
        for o in orgs:
            marker = " <-- MIGRATION TARGET" if o["id"] == ORG_ID else ""
            print(f"  core_organization id={o['id']}: {o['name']}{marker}")
        org_name = fetch_org_name(tcur, ORG_ID) or f"org_{ORG_ID}"
        print()

        print(f"Step 2 — Fetch users in org {ORG_ID}")
        user_rows = fetch_users(tcur, ORG_ID)
        print(f"  Fetched {len(user_rows):,} users_user rows (before filters)")
        print()

        print("Step 3 — Fetch active profiles across all 6 role tables")
        profiles_by_user = fetch_all_profiles(tcur, ORG_ID)
        print(f"  {len(profiles_by_user):,} distinct users have at least one active profile")
        print()

        print("Step 4 — Fetch role_id -> role_name map")
        role_map = fetch_role_map(tcur)
        print(f"  Resolved {len(role_map)} roles" if role_map else "  (role table not found — role_name will be null)")
        print()

    # Filter + transform (client-side)
    print("Step 5 — Filter + transform (client-side)")
    dropped = defaultdict(int)
    transformed: list[dict] = []
    for u in user_rows:
        if not u["is_active"]:
            dropped["soft-deleted (is_active=false)"] += 1
            continue
        if u["is_testing_account"]:
            dropped["test account (is_testing_account)"] += 1
            continue
        if u["is_username_dummy_phone"]:
            dropped["dummy phone (is_username_dummy_phone)"] += 1
            continue
        profiles = profiles_by_user.get(u["id"])
        if not profiles:
            dropped["no active profile (parent/student/orphan)"] += 1
            continue
        r = transform(u, profiles, org_name, role_map)
        if r is None:
            dropped["invalid phone after normalization"] += 1
            continue
        transformed.append(r)

    preflight_report(user_rows, profiles_by_user, transformed, dropped)

    if not args.commit:
        print()
        print("Dry-run complete. Re-run with --commit to write to Supabase.")
        return 0

    if not transformed:
        print("Nothing to import. Exiting.")
        return 0

    print()
    print(f"Step 6 — Writing {len(transformed):,} rows to Supabase in batches of {BATCH_SIZE}")
    total_attempted = 0
    with niete_conn() as nconn:
        for i in range(0, len(transformed), BATCH_SIZE):
            chunk = transformed[i:i + BATCH_SIZE]
            n, _ = upsert_batch(nconn, chunk)
            total_attempted += n
            print(f"  Batch {i // BATCH_SIZE + 1}: upserted {n} rows (running total {total_attempted:,})")

    print()
    print(f"Done. {total_attempted:,} rows upserted.")
    print("Notes:")
    print("  - Rows with source='direct' or non-taleemabad source were silently skipped (WHERE clause).")
    print("  - Existing 'taleemabad_migration' rows had null fields filled without overwrite.")
    print("  - portal_password_hash was set only on rows that previously had none.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
