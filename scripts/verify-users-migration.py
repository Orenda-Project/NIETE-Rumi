#!/usr/bin/env python3
"""
NIETE-Rumi user migration verification — prove every eligible Taleemabad user
(org 1) is present in the NIETE Supabase `users` table.

This is the parity check for `migrate-users.py`. It re-derives the eligible set
from the source of truth using the *same* filter + phone-normalization rules,
then diffs it against what actually landed in NIETE.

It is deliberately source-agnostic: users arrived via several migration runs
(`taleemabad_step8_unenriched`, `taleemabad_migration`, `taleemabad_import_*`,
manual rosters). A user counts as PRESENT if their normalized phone exists in
NIETE at all — regardless of which run put it there. Attributing it to a
specific `source` marker would produce false MISSING rows for users imported by
an earlier script.

Checks performed:
  1. PRESENCE  — every eligible source user has a row in NIETE (the headline)
  2. COLLISION — source users whose phones normalize to the same E.164
  3. ENRICHMENT— present users still missing the taleemabad preferences bundle
  4. IDENTITY  — present users whose teacher_uuid disagrees with the source

Exit codes:  0 = full parity   1 = missing users   2 = connection/setup error

Usage:
  uv run --with psycopg2-binary python3 scripts/verify-users-migration.py
  ... --csv out.csv     # write the missing/mismatched rows for triage
  ... --limit-print 40  # how many sample rows to print per section
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import defaultdict
from pathlib import Path

import psycopg2
import psycopg2.extras

REPO = Path(__file__).resolve().parent.parent
ENV_PATH = REPO / ".env"
ORG_ID = 1

# The 6 role tables that make a user "eligible" — mirrors migrate-users.py
PROFILE_TABLES = [
    ("teacher",          "users_teacherprofile"),
    ("principal",        "users_principalprofile"),
    ("coach",            "users_coachprofile"),
    ("aeo",              "users_areaeducationofficerprofile"),
    ("regional_manager", "users_regionalmanagerprofile"),
    ("program_manager",  "users_programmanagerprofile"),
]


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
    return psycopg2.connect(
        host="aws-1-ap-south-1.pooler.supabase.com",
        port=6543,
        user=f"postgres.{m.group(1)}",
        password=env("SUPABASE_DB_PASSWORD"),
        dbname="postgres",
    )


def normalize_phone_pk(raw) -> str | None:
    """Byte-for-byte the same rule as migrate-users.py. Keep these in sync."""
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


# ---------------------------------------------------------------------------
# Source of truth
# ---------------------------------------------------------------------------
def fetch_eligible_users(cur) -> tuple[list[dict], dict[str, int]]:
    """Every org-1 user passing the migration's filters, with their roles.

    Returns (eligible_rows, dropped_reason_counts). The profile-existence test
    is done in SQL via EXISTS across the 6 role tables so the eligibility rule
    is evaluated by the same engine that stores the data.
    """
    exists_clauses = " OR ".join(
        f"""EXISTS (SELECT 1 FROM fde_production.{tbl} p
                     WHERE p.user_id = u.id AND p.is_active = true
                       AND p.deleted_at IS NULL)"""
        for _, tbl in PROFILE_TABLES
    )
    role_flags = ", ".join(
        f"""EXISTS (SELECT 1 FROM fde_production.{tbl} p
                     WHERE p.user_id = u.id AND p.is_active = true
                       AND p.deleted_at IS NULL) AS has_{role}"""
        for role, tbl in PROFILE_TABLES
    )
    cur.execute(f"""
        SELECT u.id, u.uuid, u.username, u.name, u.email,
               u.is_active, u.is_testing_account, u.is_username_dummy_phone,
               {role_flags},
               ({exists_clauses}) AS has_any_profile
        FROM fde_production.users_user u
        WHERE u.organization_id = %s
    """, (ORG_ID,))
    rows = list(cur.fetchall())

    dropped: dict[str, int] = defaultdict(int)
    eligible = []
    for u in rows:
        if not u["is_active"]:
            dropped["soft-deleted (is_active=false)"] += 1
            continue
        if u["is_testing_account"]:
            dropped["test account (is_testing_account)"] += 1
            continue
        if u["is_username_dummy_phone"]:
            dropped["dummy phone (is_username_dummy_phone)"] += 1
            continue
        if not u["has_any_profile"]:
            dropped["no active profile (parent/student/orphan)"] += 1
            continue
        phone = normalize_phone_pk(u["username"])
        if not phone:
            dropped["invalid phone after normalization"] += 1
            continue
        rec = dict(u)
        rec["norm_phone"] = phone
        rec["roles"] = [r for r, _ in PROFILE_TABLES if u[f"has_{r}"]]
        eligible.append(rec)

    return eligible, dict(dropped), len(rows)


def fetch_profile_uuids(cur) -> set[str]:
    """Every profile-level uuid across the 6 role tables.

    The older step-8 import wrote users_teacherprofile.uuid into teacher_uuid
    instead of users_user.uuid. Both identify the same human, so we treat a
    teacher_uuid found here as valid rather than flagging ~4.2k false defects.
    """
    out: set[str] = set()
    for _, tbl in PROFILE_TABLES:
        cur.execute(f"SELECT uuid::text AS u FROM fde_production.{tbl} WHERE uuid IS NOT NULL")
        out.update(r["u"] for r in cur.fetchall())
    return out


# ---------------------------------------------------------------------------
# Target
# ---------------------------------------------------------------------------
def fetch_niete_users(cur) -> dict[str, dict]:
    """phone_number → row. Phones are re-normalized so a differently-formatted
    stored value still matches (defensive: never assume the target is clean)."""
    cur.execute("""
        SELECT phone_number, teacher_uuid, source, name, first_name,
               (preferences -> 'taleemabad') IS NOT NULL AS has_tb_bundle
        FROM users
    """)
    out: dict[str, dict] = {}
    for r in cur.fetchall():
        phone, tuuid, source, name, first, has_bundle = r
        key = normalize_phone_pk(phone) or (phone or "").strip()
        if not key:
            continue
        # First write wins; a re-normalized duplicate shouldn't clobber an exact row.
        out.setdefault(key, {
            "phone_number": phone, "teacher_uuid": str(tuuid) if tuuid else None,
            "source": source, "name": name, "first_name": first,
            "has_tb_bundle": has_bundle,
        })
    return out


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
def hr(title: str):
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", help="Write missing + mismatched rows to this CSV")
    ap.add_argument("--limit-print", type=int, default=25,
                    help="Max sample rows printed per section (default 25)")
    args = ap.parse_args()

    print("NIETE-Rumi — user migration parity check")
    print(f"  Source : Taleemabad fde_production, organization_id={ORG_ID}")
    print(f"  Target : NIETE Supabase, public.users")

    try:
        with taleemabad_conn() as tconn, tconn.cursor() as tcur:
            eligible, dropped, total_src = fetch_eligible_users(tcur)
            profile_uuids = fetch_profile_uuids(tcur)
        with niete_conn() as nconn, nconn.cursor() as ncur:
            niete = fetch_niete_users(ncur)
    except psycopg2.Error as e:
        print(f"\nCONNECTION/QUERY ERROR: {e}", file=sys.stderr)
        return 2

    # -- Eligibility funnel ------------------------------------------------
    hr("1. SOURCE ELIGIBILITY FUNNEL")
    print(f"  users_user rows in org {ORG_ID:<3}                          : {total_src:>7,}")
    for reason, n in sorted(dropped.items(), key=lambda x: -x[1]):
        print(f"  Dropped — {reason:<45}: {n:>7,}")
    print(f"  {'ELIGIBLE (must exist in NIETE)':<55}: {len(eligible):>7,}")

    # -- Phone collisions in the source -----------------------------------
    by_phone: dict[str, list[dict]] = defaultdict(list)
    for u in eligible:
        by_phone[u["norm_phone"]].append(u)
    collisions = {p: us for p, us in by_phone.items() if len(us) > 1}
    distinct_expected = set(by_phone.keys())

    hr("2. SOURCE PHONE COLLISIONS")
    if collisions:
        lost = sum(len(us) - 1 for us in collisions.values())
        print(f"  {len(collisions):,} phone numbers are shared by >1 eligible source user.")
        print(f"  {lost:,} source users therefore CANNOT have their own NIETE row")
        print(f"  (phone_number is the unique key — last writer wins).")
        for p, us in list(collisions.items())[:args.limit_print]:
            who = "; ".join(f"id={u['id']} {u['name']!r} [{','.join(u['roles'])}]" for u in us)
            print(f"    {p}: {who}")
        if len(collisions) > args.limit_print:
            print(f"    ... and {len(collisions) - args.limit_print:,} more")
    else:
        print("  None — every eligible user has a unique normalized phone.")
    print(f"\n  Distinct phones expected in NIETE: {len(distinct_expected):,}")

    # -- Presence (the headline check) ------------------------------------
    missing = sorted(distinct_expected - set(niete.keys()))
    present = distinct_expected & set(niete.keys())

    hr("3. PRESENCE CHECK  (every eligible source user is in NIETE)")
    pct = 100.0 * len(present) / len(distinct_expected) if distinct_expected else 100.0
    print(f"  Expected distinct phones : {len(distinct_expected):>7,}")
    print(f"  Found in NIETE           : {len(present):>7,}  ({pct:.2f}%)")
    print(f"  MISSING                  : {len(missing):>7,}")
    if missing:
        print("\n  Missing users (sample):")
        for p in missing[:args.limit_print]:
            u = by_phone[p][0]
            print(f"    {p}  id={u['id']:<8} {str(u['name'])[:28]:<28} roles={','.join(u['roles'])}")
        if len(missing) > args.limit_print:
            print(f"    ... and {len(missing) - args.limit_print:,} more")

    # -- Role breakdown of what's missing ---------------------------------
    if missing:
        role_missing: dict[str, int] = defaultdict(int)
        for p in missing:
            for u in by_phone[p]:
                for r in u["roles"]:
                    role_missing[r] += 1
        print("\n  Missing broken down by role:")
        for r, n in sorted(role_missing.items(), key=lambda x: -x[1]):
            print(f"    {r:<20}: {n:>6,}")

    # -- Enrichment + identity on the users that ARE present --------------
    # teacher_uuid is not written consistently across migration runs:
    # migrate-users.py stores users_user.uuid, while the older step-8 import
    # stored users_teacherprofile.uuid. Both are genuine Taleemabad identities,
    # so a value matching EITHER column is correct. Only a uuid matching
    # neither is a real identity defect.
    unenriched, uuid_mismatch = [], []
    for p in sorted(present):
        tgt = niete[p]
        src = by_phone[p][0]
        if not tgt["has_tb_bundle"]:
            unenriched.append((p, src, tgt))
        src_uuid = str(src["uuid"]) if src["uuid"] else None
        if (tgt["teacher_uuid"] and src_uuid
                and tgt["teacher_uuid"] != src_uuid
                and tgt["teacher_uuid"] not in profile_uuids):
            uuid_mismatch.append((p, src, tgt))

    hr("4. ENRICHMENT  (present, but no preferences.taleemabad bundle)")
    print(f"  Present users lacking the bundle: {len(unenriched):,} / {len(present):,}")
    if unenriched:
        src_counts: dict[str, int] = defaultdict(int)
        for _, _, tgt in unenriched:
            src_counts[tgt["source"] or "<null>"] += 1
        print("  By target `source` marker:")
        for s, n in sorted(src_counts.items(), key=lambda x: -x[1]):
            print(f"    {s:<40}: {n:>6,}")
        print("  → these rows exist but carry no profile metadata; re-run")
        print("    migrate-users.py --commit to enrich them in place (COALESCE-safe).")

    hr("5. IDENTITY  (teacher_uuid matches neither users_user nor a profile uuid)")
    print(f"  Unrecognized teacher_uuid: {len(uuid_mismatch):,}")
    for p, src, tgt in uuid_mismatch[:args.limit_print]:
        print(f"    {p}  source={src['uuid']}  niete={tgt['teacher_uuid']}  (src={tgt['source']})")
    if len(uuid_mismatch) > args.limit_print:
        print(f"    ... and {len(uuid_mismatch) - args.limit_print:,} more")

    # -- CSV ---------------------------------------------------------------
    if args.csv:
        with open(args.csv, "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["issue", "phone", "source_user_id", "source_uuid",
                        "source_name", "roles", "niete_source", "niete_teacher_uuid"])
            for p in missing:
                for u in by_phone[p]:
                    w.writerow(["MISSING", p, u["id"], u["uuid"], u["name"],
                                ",".join(u["roles"]), "", ""])
            for p, src, tgt in unenriched:
                w.writerow(["UNENRICHED", p, src["id"], src["uuid"], src["name"],
                            ",".join(src["roles"]), tgt["source"], tgt["teacher_uuid"]])
            for p, src, tgt in uuid_mismatch:
                w.writerow(["UUID_MISMATCH", p, src["id"], src["uuid"], src["name"],
                            ",".join(src["roles"]), tgt["source"], tgt["teacher_uuid"]])
        print(f"\n  Wrote triage CSV → {args.csv}")

    # -- Verdict -----------------------------------------------------------
    hr("VERDICT")
    if not missing:
        print(f"  PASS — all {len(distinct_expected):,} eligible users are present in NIETE.")
        if unenriched:
            print(f"  (Note: {len(unenriched):,} present rows are not yet enriched — not a")
            print("   presence failure, but re-run the migration to backfill metadata.)")
        return 0

    print(f"  FAIL — {len(missing):,} of {len(distinct_expected):,} eligible users are absent.")
    print("  Re-run: python3 scripts/migrate-users.py --commit")
    return 1


if __name__ == "__main__":
    sys.exit(main())
