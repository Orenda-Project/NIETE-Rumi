#!/usr/bin/env python3
"""
Migrate schools + principals from fde_production into the NIETE Supabase (bd-2533/bd-2534).

  DRY RUN (default):  python3 scripts/migrate-schools.py
  APPLY:              python3 scripts/migrate-schools.py --commit

Idempotent and re-runnable: schools upsert on EMIS, users are matched on
normalized phone and UPDATEd in place. Re-running is a no-op apart from
refreshing school links.

What it does, in order:
  1. schools     — upsert all 465 fde_production.schools_school rows (EMIS-keyed)
  2. principals  — 680 users_principalprofile rows → users.role='principal' + school_id
  3. teachers    — link remaining users to schools via users_teacherprofile
  4. role        — backfill every remaining NULL role (Option B classification)

Old DB wins (operator, 2026-08-10): FDE school assignment overwrites the target's
free-text school_name drift. The 4 phone-matched conflicts resolve to FDE,
including 923348538620 → 'IMS(I-V) No.1 G-7/2'.

Prerequisite: bot/database/migrations/add-schools-emis-and-role-not-null.sql
(STEPS 1-3) must be applied first — this script asserts the emis column exists.
"""

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

import psycopg2
import psycopg2.extras

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"

# The NIETE Supabase project. Asserted at startup so the script can never write
# to the main-bot database (see bd-2536).
NIETE_PROJECT_REF = "ihzciabopbttygxxgrkm"

# Mirrors school-migration.transform.js TEST_SCHOOL_PATTERN.
TEST_SCHOOL_RE = re.compile(
    r"(^|\b)(test|testing|dummy|demo|lums|fde|tabadlab|taleemabad|muhammad_school|report card)(\b|$|[-_])",
    re.IGNORECASE,
)


def env(k: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        if line.startswith(k + "="):
            return line.split("=", 1)[1].strip()
    raise KeyError(f"{k} missing from {ENV_PATH}")


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


def assert_niete_target() -> str:
    """
    Resolve + verify the target project ref BEFORE opening any connection.

    This must run first: a worktree created with REPO=NIETE-Rumi is seeded with
    the MAIN BOT's .env (bd-2536), and that SUPABASE_URL points at a different
    production database. Connecting first and checking later would already have
    opened a writable session against the wrong prod DB.
    """
    supa_url = env("SUPABASE_URL")
    m = re.match(r"https://([a-z0-9]+)\.supabase\.co", supa_url)
    if not m:
        raise SystemExit(f"Unrecognized SUPABASE_URL: {supa_url}")
    ref = m.group(1)
    if ref != NIETE_PROJECT_REF:
        raise SystemExit(
            f"ABORT: target ref '{ref}' is not the NIETE project ('{NIETE_PROJECT_REF}').\n"
            f"       {ENV_PATH} is probably the main-bot .env — see bd-2536.\n"
            f"       Fix: cp NIETE-Rumi/.env into this worktree."
        )
    return ref


def niete_conn():
    ref = assert_niete_target()
    return psycopg2.connect(
        host="aws-1-ap-south-1.pooler.supabase.com",
        port=6543,
        user=f"postgres.{ref}",
        password=env("SUPABASE_DB_PASSWORD"),
        dbname="postgres",
        cursor_factory=psycopg2.extras.RealDictCursor,
    ), ref


def normalize_phone_pk(raw):
    """Identical to migrate-users.py + school-migration.transform.js."""
    if not raw:
        return None
    d = re.sub(r"\D", "", str(raw))
    if not d:
        return None
    if d.startswith("0"):
        d = "92" + d[1:]
    elif d.startswith("3"):
        d = "92" + d
    if len(d) > 12:
        d = d[:12]
    return d if re.fullmatch(r"92\d{10}", d) else None


def canon(name):
    return re.sub(r"[^A-Za-z0-9]", "", (name or "")).upper() or None


# ---------------------------------------------------------------------------
# Source reads
# ---------------------------------------------------------------------------
def fetch_source_schools(sc):
    sc.execute("""
        SELECT s.id, s.name, s.emis, s.is_active, s.deleted_at, sr.name AS region_name
        FROM fde_production.schools_school s
        LEFT JOIN fde_production.schools_schoolregion sr ON sr.id = s.region_id
        ORDER BY s.id
    """)
    return sc.fetchall()


def fetch_source_profiles(sc, table):
    """
    Principal or teacher profiles joined to their user + school.

    Ordered so the BEST row for a phone comes first, because 1,158 source phones
    carry more than one school and the loop keeps the first it sees:
      1. real school before a flagged-test school ('FDE', 'Taleemabad', 'LUMS')
      2. active school before a soft-deleted one
      3. newest profile first — a teacher who moved is at the newest school

    Without this, 923348538620 and 923339293281 both resolved to the stale 'FDE'
    (emis=100000) profile created 2024-10-25 instead of their real school.
    Mirrors pickPrimarySchool() in school-migration.transform.js.
    """
    sc.execute(f"""
        SELECT u.username, u.name AS full_name, p.school_id AS src_school_id,
               s.emis AS school_emis, s.name AS school_name
        FROM fde_production.{table} p
        JOIN fde_production.users_user u ON u.id = p.user_id
        LEFT JOIN fde_production.schools_school s ON s.id = p.school_id
        ORDER BY
            u.id,
            (s.name ~* '(^|\\y)(test|testing|dummy|demo|lums|fde|tabadlab|taleemabad|muhammad_school|report card)(\\y|$|[-_])') ASC,
            (s.is_active IS NOT TRUE OR s.deleted_at IS NOT NULL) ASC,
            p.created DESC NULLS LAST
    """)
    return sc.fetchall()


# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------
def assert_prereq(nc):
    nc.execute("""
        SELECT count(*) n FROM information_schema.columns
        WHERE table_schema='public' AND table_name='schools' AND column_name='emis'
    """)
    if nc.fetchone()["n"] == 0:
        raise SystemExit(
            "ABORT: schools.emis missing. Apply "
            "bot/database/migrations/add-schools-emis-and-role-not-null.sql (STEPS 1-3) first."
        )


def migrate_schools(nc, src_schools, commit):
    """
    Upsert all source schools using set-based SQL.

    Deliberately NOT a per-row SELECT/UPDATE loop: the target is a pooled
    Supabase in ap-south-1, so ~465 sequential round-trips alone took >10min.
    Everything here is 3 queries regardless of row count.
    """
    stats = Counter()

    rows = []
    for s in src_schools:
        name = (s["name"] or "").strip()
        if not name:
            stats["skipped_no_name"] += 1
            continue
        rows.append((
            name,
            (s["region_name"] or "").strip() or None,
            None if s["emis"] in (None, "") else str(s["emis"]).strip(),
            s["id"],
            bool(s["is_active"]) and s["deleted_at"] is None,
            bool(TEST_SCHOOL_RE.search(name)),
        ))

    stats["flagged_probable_test"] = sum(1 for r in rows if r[5])

    # Snapshot which EMIS already exist so insert-vs-update is reportable.
    nc.execute("SELECT emis FROM schools WHERE emis IS NOT NULL")
    pre_existing = {r["emis"] for r in nc.fetchall()}
    stats["updated"] = sum(1 for r in rows if r[2] and r[2] in pre_existing)
    stats["inserted"] = len(rows) - stats["updated"]

    if commit:
        # EMIS-keyed rows: ON CONFLICT against idx_schools_emis_unique.
        with_emis = [r for r in rows if r[2]]
        psycopg2.extras.execute_values(nc, """
            INSERT INTO schools (name, region, emis, source_school_id, source_system,
                                 is_active, is_probable_test)
            VALUES %s
            ON CONFLICT (emis) WHERE emis IS NOT NULL DO UPDATE SET
                name = EXCLUDED.name, region = EXCLUDED.region,
                source_school_id = EXCLUDED.source_school_id,
                source_system = EXCLUDED.source_system,
                is_active = EXCLUDED.is_active,
                is_probable_test = EXCLUDED.is_probable_test,
                updated_at = NOW()
        """, [(r[0], r[1], r[2], r[3], 'fde_production', r[4], r[5]) for r in with_emis])

        # The 5 EMIS-less rows: keyed on (canonical name, region).
        for r in [r for r in rows if not r[2]]:
            nc.execute("""
                INSERT INTO schools (name, region, emis, source_school_id, source_system,
                                     is_active, is_probable_test)
                SELECT %s,%s,NULL,%s,'fde_production',%s,%s
                WHERE NOT EXISTS (
                    SELECT 1 FROM schools WHERE emis IS NULL
                      AND UPPER(REGEXP_REPLACE(name,'[^a-zA-Z0-9]','','g')) = %s
                      AND COALESCE(region,'') = COALESCE(%s,'')
                )
            """, (r[0], r[1], r[3], r[4], r[5], canon(r[0]), r[1]))

    # Build the source_school_id → target uuid map in ONE query.
    # Keyed by canonical NAME (not name+region) because a source profile carries
    # the school's name but not its region, so region cannot participate here.
    emis_to_id, canon_by_name = {}, {}
    nc.execute("SELECT id, emis, name FROM schools WHERE source_system = 'fde_production'")
    for r in nc.fetchall():
        if r["emis"]:
            emis_to_id[r["emis"]] = r["id"]
        else:
            canon_by_name.setdefault(canon(r["name"]), r["id"])

    if not commit:
        # Nothing was written, so the real id-map is empty and every downstream
        # link would report 0 — a dry run that proves nothing. Synthesise
        # placeholder ids from the source rows so the projected link counts are
        # accurate; they are never written anywhere.
        for r in rows:
            if r[2]:
                emis_to_id.setdefault(r[2], f"dryrun-{r[3]}")
            else:
                canon_by_name.setdefault(canon(r[0]), f"dryrun-{r[3]}")

    return stats, emis_to_id, canon_by_name


def resolve_school_id(row, emis_to_id, canon_by_name):
    """EMIS first (460 of 465 schools); canonical name for the EMIS-less remainder."""
    emis = None if row["school_emis"] in (None, "") else str(row["school_emis"]).strip()
    if emis and emis in emis_to_id:
        return emis_to_id[emis]
    return canon_by_name.get(canon(row["school_name"]))


def link_profiles(nc, rows, emis_to_id, canon_to_id, role, commit, restrict_to_phones=None):
    """
    Match source profiles to target users by normalized phone; set school_id
    (+ role='principal' for principals).

    One SELECT for all users and one batched UPDATE — not per row. The teacher
    pass alone is 10,956 source profiles; per-row round-trips against a pooled
    ap-south-1 Supabase is what made the first version unrunnable.

    Old DB wins: the FDE school assignment overwrites the target's free-text drift.
    """
    stats = Counter()

    # Resolve phone + school for every source row first (pure, no I/O).
    #
    # `rows` arrives ordered real-school-first (see fetch_source_profiles), but a
    # phone's real school can live in the OTHER profile table — 6 principals were
    # parked on 'FDE'/'Taleemabad' while holding a real school as a teacher. So a
    # real school always displaces an already-chosen junk one.
    wanted = {}
    junk_choice = set()
    for r in rows:
        phone = normalize_phone_pk(r["username"])
        if not phone:
            stats["skip_unnormalizable_phone"] += 1
            continue
        school_id = resolve_school_id(r, emis_to_id, canon_to_id)
        if school_id is None:
            stats["skip_no_school_match"] += 1
            continue

        is_junk = bool(TEST_SCHOOL_RE.search(r["school_name"] or ""))
        if phone not in wanted:
            wanted[phone] = school_id
            if is_junk:
                junk_choice.add(phone)
        elif phone in junk_choice and not is_junk:
            wanted[phone] = school_id          # upgrade junk → real
            junk_choice.discard(phone)
            stats["upgraded_from_test_school"] += 1

    # When extra rows were supplied only to find a better school (the principal
    # pass borrows teacher rows), keep just the phones this pass is about.
    if restrict_to_phones is not None:
        wanted = {p: s for p, s in wanted.items() if p in restrict_to_phones}

    if not wanted:
        return stats

    # One lookup for every phone at once. `already_real` says whether the user is
    # ALREADY linked to a non-test school, so a later pass cannot downgrade them:
    # the teacher pass runs last, and 6 principals whose only teacher profile is
    # 'FDE'/'Taleemabad'/'traning school test' had their correct principal-side
    # school overwritten by it.
    nc.execute("""
        SELECT u.id, u.phone_number, u.role,
               (s.id IS NOT NULL AND NOT s.is_probable_test) AS already_real
        FROM users u LEFT JOIN schools s ON s.id = u.school_id
        WHERE u.phone_number = ANY(%s)
    """, (list(wanted.keys()),))
    found = {r["phone_number"]: r for r in nc.fetchall()}
    stats[f"absent_from_users_{role}"] = len(wanted) - len(found)

    updates = []
    for phone, school_id in wanted.items():
        user = found.get(phone)
        if not user:
            continue
        # Never demote a coach (79 coaches, 58 wired into leader_schools).
        if user["role"] == "coach":
            stats["skip_existing_coach"] += 1
            continue

        # Never replace a real school with a test one.
        if user.get("already_real") and phone in junk_choice:
            stats["kept_existing_real_school"] += 1
            continue

        updates.append((user["id"], school_id))
        if role == "principal":
            stats["principal_linked"] += 1
            if user["role"] != "principal":
                stats["principal_role_promoted"] += 1
        else:
            stats["teacher_school_linked"] += 1

    if commit and updates:
        if role == "principal":
            psycopg2.extras.execute_values(nc, """
                UPDATE users u SET role='principal', school_id=v.school_id::uuid, updated_at=NOW()
                FROM (VALUES %s) AS v(user_id, school_id)
                WHERE u.id = v.user_id::uuid
            """, [(str(uid), str(sid)) for uid, sid in updates])
        else:
            # Teachers: link the school only; never touch an existing role here
            # (role backfill is a separate, evidence-based step).
            psycopg2.extras.execute_values(nc, """
                UPDATE users u SET school_id=v.school_id::uuid, updated_at=NOW()
                FROM (VALUES %s) AS v(user_id, school_id)
                WHERE u.id = v.user_id::uuid
            """, [(str(uid), str(sid)) for uid, sid in updates])

    return stats


def backfill_roles(nc, commit):
    """Option B: 'teacher' only on positive evidence; otherwise 'unregistered'."""
    nc.execute("""
        SELECT count(*) n FROM users u WHERE u.role IS NULL AND (
            u.registration_completed = TRUE
            OR u.teacher_uuid IS NOT NULL
            OR (u.levels IS NOT NULL AND array_length(u.levels,1) > 0)
            OR EXISTS (SELECT 1 FROM teacher_training_progress p WHERE p.user_id = u.id)
        )
    """)
    to_teacher = nc.fetchone()["n"]
    nc.execute("SELECT count(*) n FROM users WHERE role IS NULL")
    total_null = nc.fetchone()["n"]

    if commit:
        nc.execute("""
            UPDATE users u SET role='teacher', updated_at=NOW()
            WHERE u.role IS NULL AND (
                u.registration_completed = TRUE
                OR u.teacher_uuid IS NOT NULL
                OR (u.levels IS NOT NULL AND array_length(u.levels,1) > 0)
                OR EXISTS (SELECT 1 FROM teacher_training_progress p WHERE p.user_id = u.id)
            )
        """)
        nc.execute("UPDATE users SET role='unregistered', updated_at=NOW() WHERE role IS NULL")

    return {"null_before": total_null, "to_teacher": to_teacher,
            "to_unregistered": total_null - to_teacher}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="write (default: dry run)")
    args = ap.parse_args()
    mode = "COMMIT" if args.commit else "DRY RUN"

    # Verify the target BEFORE any connection is opened.
    ref = assert_niete_target()
    print(f"=== migrate-schools [{mode}] ===")
    print(f"    source: fde_production   target: supabase {ref}\n")

    tconn = taleemabad_conn()
    nconn_, _ = niete_conn()

    sc = tconn.cursor()
    nc = nconn_.cursor()
    assert_prereq(nc)

    try:
        src_schools = fetch_source_schools(sc)
        print(f"[1/4] schools: {len(src_schools)} source rows")
        s_stats, emis_map, canon_map = migrate_schools(nc, src_schools, args.commit)
        for k, v in sorted(s_stats.items()):
            print(f"        {k:<28} {v}")

        # Both profile tables are fetched up front so a phone's REAL school can
        # be found in either one. 6 principals were otherwise left on a junk
        # school ('FDE', 'Taleemabad') while holding a real school as a teacher.
        principals = fetch_source_profiles(sc, "users_principalprofile")
        teachers = fetch_source_profiles(sc, "users_teacherprofile")

        # A principal's own school wins, but any real school beats a junk one.
        principal_extra = principals + [
            r for r in teachers if not TEST_SCHOOL_RE.search(r["school_name"] or "")
        ]

        print(f"\n[2/4] principals: {len(principals)} source rows")
        p_stats = link_profiles(nc, principal_extra, emis_map, canon_map, "principal", args.commit,
                                restrict_to_phones={normalize_phone_pk(r["username"]) for r in principals})
        for k, v in sorted(p_stats.items()):
            print(f"        {k:<28} {v}")

        print(f"\n[3/4] teachers: {len(teachers)} source rows")
        t_stats = link_profiles(nc, teachers, emis_map, canon_map, "teacher", args.commit)
        for k, v in sorted(t_stats.items()):
            print(f"        {k:<28} {v}")

        print("\n[4/4] role backfill (Option B)")
        r_stats = backfill_roles(nc, args.commit)
        for k, v in r_stats.items():
            print(f"        {k:<28} {v}")

        if args.commit:
            nconn_.commit()
            print("\n=== COMMITTED ===")
            print("Next: apply STEP 4 (role SET NOT NULL) from the migration SQL.")
        else:
            nconn_.rollback()
            print("\n=== DRY RUN — nothing written. Re-run with --commit to apply. ===")
    except Exception:
        nconn_.rollback()
        raise
    finally:
        tconn.close()
        nconn_.close()


if __name__ == "__main__":
    sys.exit(main())
