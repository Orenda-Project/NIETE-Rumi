#!/usr/bin/env python3
"""
bd-s42dye.4 — import the 66 conducted legacy TALEEMABAD courses of fde_production into the NIETE
platform as a SEPARATE provider "Taleemabad" (vendor key TALEEMABAD_LEGACY), for the coach Training
Library only. All decisions live in scripts/lib/legacy_taleemabad_import.py (and are tested there).

  Reads   fde_production (read-only session)           creds: TALEEMABAD_DB_* in the repo .env
  Writes  the NIETE target DB, ONE transaction          creds: --env-file (SUPABASE_URL + DATABASE_URL
                                                        or SUPABASE_DB_PASSWORD)

SAFETY
  * --target sandbox|staging|prod is mandatory. The Supabase project ref is resolved from the env
    file and asserted against the target BEFORE any connection is opened (the worktree-.env trap,
    bd-2536: a seeded .env points at prod).
  * Dry run is the default and is read-only: it reads fde and the target, prints what it would
    insert and update, and writes nothing (the target session is default_transaction_read_only).
  * --apply writes. Writing to prod additionally needs --allow-prod (a per-action operator go).
  * Idempotent on the source_*_id columns: a re-run inserts 0 rows and updates only what changed.
    A media re-host (video_url on R2) is preserved while source_media_url is unchanged.
  * Creates NO training_programs / training_program_scopes / teacher_training_assignments rows, so
    no teacher can ever be assigned this vendor (the coach library lists every active vendor).

USAGE
  python3 scripts/import-legacy-taleemabad.py --target sandbox --env-file <sandbox.env>             # dry run
  python3 scripts/import-legacy-taleemabad.py --target sandbox --env-file <sandbox.env> --apply
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import legacy_taleemabad_import as L  # noqa: E402

REPO = Path(__file__).resolve().parent.parent

TARGET_REFS = {
    "sandbox": "olvritwoqujtjvwfulbh",
    "staging": "rpqkekcfvumypldbejhp",
    "prod": "ihzciabopbttygxxgrkm",
}


def read_env(path: Path) -> dict:
    out = {}
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def resolve_target(target: str, env: dict) -> tuple[str, str]:
    """Resolve + assert the project ref BEFORE opening any connection. Returns (ref, dsn)."""
    m = re.match(r"https://([a-z0-9]+)\.supabase\.co", env.get("SUPABASE_URL", ""))
    if not m:
        raise SystemExit(f"ABORT: unrecognised SUPABASE_URL in the env file: {env.get('SUPABASE_URL')!r}")
    ref = m.group(1)
    want = TARGET_REFS[target]
    if ref != want:
        raise SystemExit(f"ABORT: --target {target} expects project {want}, the env file points at {ref}.")
    dsn = env.get("DATABASE_URL")
    if dsn:
        um = re.match(r"postgres(?:ql)?://postgres\.([a-z0-9]+):", dsn)
        if not um or um.group(1) != want:
            raise SystemExit("ABORT: DATABASE_URL does not belong to the target project.")
    else:
        pw = env.get("SUPABASE_DB_PASSWORD")
        if not pw:
            raise SystemExit("ABORT: env file has neither DATABASE_URL nor SUPABASE_DB_PASSWORD.")
        dsn = f"postgresql://postgres.{ref}:{pw}@aws-1-ap-south-1.pooler.supabase.com:6543/postgres"
    return ref, dsn


def rows(cur, sql: str, params: tuple = ()) -> list[dict]:
    cur.execute(sql, params)
    return [dict(r) for r in cur.fetchall()]


# ---------------------------------------------------------------------------------------------
# read fde_production (read-only)
# ---------------------------------------------------------------------------------------------

def read_source(fde_env: dict) -> dict:
    conn = psycopg2.connect(
        host=fde_env["TALEEMABAD_DB_HOST"], port=fde_env["TALEEMABAD_DB_PORT"],
        dbname=fde_env["TALEEMABAD_DB_NAME"], user=fde_env["TALEEMABAD_DB_USER"],
        password=fde_env["TALEEMABAD_DB_PASSWORD"], sslmode=fde_env.get("TALEEMABAD_DB_SSLMODE") or "require",
        connect_timeout=30, options="-c search_path=fde_production -c default_transaction_read_only=on",
        cursor_factory=psycopg2.extras.RealDictCursor,
    )
    try:
        with conn.cursor() as cur:
            levels = rows(cur, 'SELECT id, name, "order" FROM teacher_training_level WHERE id = ANY(%s) AND vendor = %s ORDER BY "order"',
                          (list(L.LEVEL_IDS), L.BASE_VENDOR_KEY))
            courses = rows(cur, 'SELECT id, level_id, title, type, "index" FROM teacher_training_course WHERE id = ANY(%s)',
                           (list(L.COURSE_IDS),))
            modules = rows(cur, """
                SELECT tr.id, tr.course_id, tr.title, tr.content, tr.duration, tr."index", tr.is_active, tr.deleted_at,
                       ma.url AS media_url, ma.type AS media_type
                FROM teacher_training_training tr
                LEFT JOIN asset_manager_mediaasset ma ON ma.id = tr.media_asset_id
                WHERE tr.course_id = ANY(%s)""", (list(L.COURSE_IDS),))
            mod_ids = [m["id"] for m in modules]
            questions = rows(cur, """
                SELECT id, training_id, type, question_statement, "options", answers, bloom_level, "index",
                       is_active, deleted_at
                FROM teacher_training_question WHERE training_id = ANY(%s)""", (mod_ids,))
    finally:
        conn.close()
    bad = [c["id"] for c in courses if c["level_id"] not in L.LEVEL_IDS]
    if bad:
        raise L.ImportAbort(f"courses on levels outside {L.LEVEL_IDS}: {bad}")
    return {"levels": levels, "courses": courses, "modules": modules, "questions": questions}


# ---------------------------------------------------------------------------------------------
# read the target
# ---------------------------------------------------------------------------------------------

def read_target(cur, src: dict) -> tuple[dict, dict]:
    base = rows(cur, "SELECT * FROM training_vendors WHERE key = %s", (L.BASE_VENDOR_KEY,))
    if not base:
        raise L.ImportAbort(f"base vendor {L.BASE_VENDOR_KEY} not found on the target")
    vend = rows(cur, "SELECT * FROM training_vendors WHERE key = %s", (L.VENDOR_KEY,))
    ex = {"vendor": vend[0] if vend else None, "levels": {}, "courses": {}, "modules": {}, "questions": {}, "foreign": []}
    vid = ex["vendor"]["id"] if ex["vendor"] else None
    course_ids = [c["id"] for c in src["courses"]]
    mod_ids = [m["id"] for m in src["modules"]]
    q_ids = [q["id"] for q in src["questions"]]

    if vid:
        for r in rows(cur, "SELECT * FROM training_levels WHERE vendor_id = %s", (vid,)):
            ex["levels"][r["source_level_id"]] = r
        for r in rows(cur, """SELECT c.* FROM training_courses c JOIN training_levels l ON l.id = c.level_id
                              WHERE l.vendor_id = %s""", (vid,)):
            ex["courses"][r["source_course_id"]] = r
        for r in rows(cur, """SELECT m.* FROM training_modules m JOIN training_courses c ON c.id = m.course_id
                              JOIN training_levels l ON l.id = c.level_id WHERE l.vendor_id = %s""", (vid,)):
            ex["modules"][r["source_module_id"]] = r
        for r in rows(cur, """SELECT q.* FROM training_questions q JOIN training_modules m ON m.id = q.training_module_id
                              JOIN training_courses c ON c.id = m.course_id JOIN training_levels l ON l.id = c.level_id
                              WHERE l.vendor_id = %s""", (vid,)):
            ex["questions"][r["source_question_id"]] = r

    # fde ids already owned by ANOTHER vendor (or an unscoped row): abort rather than merge into it
    for table, col, ids, known in (
        ("training_courses", "source_course_id", course_ids, ex["courses"]),
        ("training_modules", "source_module_id", mod_ids, ex["modules"]),
        ("training_questions", "source_question_id", q_ids, ex["questions"]),
    ):
        for r in rows(cur, f"SELECT {col} AS sid FROM {table} WHERE {col} = ANY(%s)", (ids,)):
            if r["sid"] not in known:
                ex["foreign"].append((table, r["sid"], "other"))
    return base[0], ex


# ---------------------------------------------------------------------------------------------
# apply (one transaction)
# ---------------------------------------------------------------------------------------------

def _clean(row: dict) -> dict:
    return {k: v for k, v in row.items() if not k.startswith("_")}


def _adapt(v):
    return psycopg2.extras.Json(v) if isinstance(v, (list, dict)) else v


def _insert(cur, table: str, rows_: list[dict], parent_key: tuple[str, dict] | None, src_col: str) -> dict:
    """Insert rows (parent id resolved from parent_key=(src_field, {fde_id: target_id})); returns {fde_id: id}."""
    if not rows_:
        return {}
    out = {}
    for start in range(0, len(rows_), 100):
        chunk = rows_[start:start + 100]
        recs = []
        for r in chunk:
            rec = _clean(r)
            if parent_key:
                field, mapping = parent_key
                col = {"_level_src": "level_id", "_course_src": "course_id", "_module_src": "training_module_id"}[field]
                rec[col] = mapping[r[field]]
            recs.append(rec)
        cols = list(recs[0].keys())
        res = psycopg2.extras.execute_values(
            cur, f"INSERT INTO {table} ({', '.join(cols)}) VALUES %s RETURNING id, {src_col}",
            [tuple(_adapt(rec[c]) for c in cols) for rec in recs], page_size=len(recs), fetch=True)
        for r in res:  # RealDictCursor rows
            out[r[src_col]] = r["id"]
    return out


def _update(cur, table: str, updates: list[dict]) -> None:
    for u in updates:
        cols = list(u["patch"].keys())
        cur.execute(f"UPDATE {table} SET {', '.join(c + ' = %s' for c in cols)} WHERE id = %s",
                    [*(_adapt(u["patch"][c]) for c in cols), u["id"]])


def apply_plan(cur, plan: dict, existing: dict) -> None:
    if plan["vendor"]["action"] == "insert":
        row = plan["vendor"]["row"]
        cols = list(row.keys())
        cur.execute(f"INSERT INTO training_vendors ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) RETURNING id",
                    [_adapt(row[c]) for c in cols])
        vendor_id = cur.fetchone()["id"]
    else:
        vendor_id = existing["vendor"]["id"]

    # levels (vendor_id is not a _src field: set it directly)
    for r in plan["levels"]["insert"]:
        r["vendor_id"] = vendor_id
    level_ids = {sid: r["id"] for sid, r in existing["levels"].items()}
    level_ids.update(_insert(cur, "training_levels", plan["levels"]["insert"], None, "source_level_id"))
    _update(cur, "training_levels", plan["levels"]["update"])

    course_ids = {sid: r["id"] for sid, r in existing["courses"].items()}
    course_ids.update(_insert(cur, "training_courses", plan["courses"]["insert"], ("_level_src", level_ids), "source_course_id"))
    _update(cur, "training_courses", plan["courses"]["update"])

    module_ids = {sid: r["id"] for sid, r in existing["modules"].items()}
    module_ids.update(_insert(cur, "training_modules", plan["modules"]["insert"], ("_course_src", course_ids), "source_module_id"))
    _update(cur, "training_modules", plan["modules"]["update"])

    _insert(cur, "training_questions", plan["questions"]["insert"], ("_module_src", module_ids), "source_question_id")
    _update(cur, "training_questions", plan["questions"]["update"])


def counts(cur) -> dict:
    cur.execute("""
        SELECT (SELECT count(*) FROM training_vendors WHERE key = %(k)s) AS vendors,
               (SELECT count(*) FROM training_levels l JOIN training_vendors v ON v.id = l.vendor_id WHERE v.key = %(k)s) AS levels,
               (SELECT count(*) FROM training_courses c JOIN training_levels l ON l.id = c.level_id JOIN training_vendors v ON v.id = l.vendor_id WHERE v.key = %(k)s) AS courses,
               (SELECT count(*) FROM training_modules m JOIN training_courses c ON c.id = m.course_id JOIN training_levels l ON l.id = c.level_id JOIN training_vendors v ON v.id = l.vendor_id WHERE v.key = %(k)s) AS modules,
               (SELECT count(*) FROM training_questions q JOIN training_modules m ON m.id = q.training_module_id JOIN training_courses c ON c.id = m.course_id JOIN training_levels l ON l.id = c.level_id JOIN training_vendors v ON v.id = l.vendor_id WHERE v.key = %(k)s) AS questions,
               (SELECT count(*) FROM training_program_scopes s JOIN training_vendors v ON v.id = s.vendor_id WHERE v.key = %(k)s) AS program_scopes
    """, {"k": L.VENDOR_KEY})
    return {k: int(v) for k, v in dict(cur.fetchone()).items()}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", required=True, choices=sorted(TARGET_REFS))
    ap.add_argument("--env-file", default=str(REPO / ".env"), help="env file of the TARGET (SUPABASE_URL + DATABASE_URL)")
    ap.add_argument("--apply", action="store_true", help="write (default: dry run, read-only)")
    ap.add_argument("--allow-prod", action="store_true", help="required together with --apply for --target prod")
    args = ap.parse_args()

    tenv = read_env(Path(args.env_file))
    ref, dsn = resolve_target(args.target, tenv)          # asserted BEFORE any connection
    if args.apply and args.target == "prod" and not args.allow_prod:
        raise SystemExit("ABORT: writing to prod needs --allow-prod (an explicit operator go).")
    mode = "APPLY" if args.apply else "DRY RUN (read-only)"
    print(f"bd-s42dye.4 legacy Taleemabad import | target={args.target} ref={ref} | {mode}")

    fde_env = read_env(REPO / ".env")
    src = read_source(fde_env)
    print(f"  fde_production: {len(src['levels'])} levels, {len(src['courses'])} courses, "
          f"{len(src['modules'])} modules, {len(src['questions'])} question rows")
    L.validate_source(src, expect_full_scope=True)

    conn = psycopg2.connect(dsn, connect_timeout=30, cursor_factory=psycopg2.extras.RealDictCursor,
                            options="" if args.apply else "-c default_transaction_read_only=on")
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            base, existing = read_target(cur, src)
            plan = L.build_plan(src, existing, base)
            print("  plan:", json.dumps(L.summarise(plan)))
            if args.apply:
                apply_plan(cur, plan, existing)
                after = counts(cur)
                print("  after (inside the transaction):", json.dumps(after))
                if after["program_scopes"] != 0:
                    raise L.ImportAbort("the legacy vendor must have no training_program_scopes row")
                conn.commit()
                print("  COMMITTED")
            else:
                print("  dry run: nothing written.  Current legacy rows on the target:", json.dumps(counts(cur)))
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except L.ImportAbort as e:
        print(f"ABORT: {e}")
        sys.exit(2)
