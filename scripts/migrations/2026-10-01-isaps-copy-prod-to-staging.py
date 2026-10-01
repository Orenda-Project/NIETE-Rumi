#!/usr/bin/env python3
"""bd-vej4h — copy I-SAPS Level 1 from PRODUCTION into STAGING.

Staging had no I-SAPS at all, so nothing I-SAPS could be tested there. The
original seed scripts (2026-09-17/18) are pinned to sandbox and reshaped the data
in four passes; production holds the final shape, so this copies it as it is.

Copies, by content (numeric ids are re-assigned by the target and remapped):
  training_vendors        the ISAPS row, SAME uuid as production, with the
                          go-live settings applied (below)
  training_levels         ISAPS levels
  training_courses        their courses (the nine modules)
  training_modules        their units
  training_grand_quizzes  the per-module exam quizzes (active and retired)
  training_questions      unit formative items + module exam banks
  training_program_scopes I-SAPS added to niete_middle_high (the go-live scope)

Go-live settings on the copied vendor (operator, 2026-10-01):
  module_unlock_logic = 'chain_per_course'   modules open, units in order
  module_passing_pct  = 70                   unit quick-check gate
  cooldown_hours      = 0                    no wait after a failed exam
  module_quiz_ungated = false                the gate is ON
  capstone_points_per_question = 10          the CRQ's scale

Reads SOURCE_SUPABASE_URL/SOURCE_SUPABASE_KEY and TARGET_SUPABASE_URL/
TARGET_SUPABASE_KEY from the environment and REFUSES unless they resolve to the
production and staging project refs below — so it cannot write to production.

PREREQUISITES on the target (production already has all three; staging did not,
and the first copy attempt stopped with a 409 on the quizzes):
  scripts/migrations/2026-09-17-per-module-summative.sql      nine exams per level
  scripts/migrations/2026-09-17-capstone-points-per-vendor.sql the CRQ scale column
  scripts/migrations/2026-09-17-question-option-images.sql    image options column

DRY RUN BY DEFAULT. --yes-write to apply. Refuses if ISAPS already exists on
the target (idempotent by refusal, not by upsert).
"""
import json, os, sys, urllib.request, urllib.parse

SOURCE_REF = "ihzciabopbttygxxgrkm"   # production (read only)
TARGET_REF = "rpqkekcfvumypldbejhp"   # staging
MIDDLE_HIGH_KEY = "niete_middle_high"
WRITE = "--yes-write" in sys.argv

GO_LIVE = {
    "module_unlock_logic": "chain_per_course",
    "module_passing_pct": 70,
    "cooldown_hours": 0,
    "module_quiz_ungated": False,
    "capstone_points_per_question": 10,
}


def env(name):
    v = os.environ.get(name, "").strip()
    if not v:
        sys.exit(f"missing {name}")
    return v


def ref_of(url):
    return urllib.parse.urlparse(url).hostname.split(".")[0]


SRC = (env("SOURCE_SUPABASE_URL"), env("SOURCE_SUPABASE_KEY"))
TGT = (env("TARGET_SUPABASE_URL"), env("TARGET_SUPABASE_KEY"))
if ref_of(SRC[0]) != SOURCE_REF or ref_of(TGT[0]) != TARGET_REF:
    sys.exit(f"refusing: source={ref_of(SRC[0])} target={ref_of(TGT[0])} "
             f"(expected {SOURCE_REF} -> {TARGET_REF})")


def call(db, method, path, body=None):
    url, key = db
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}", method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json", "Prefer": "return=representation"})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def get(db, table, query):
    return call(db, "GET", f"{table}?{query}") or []


def ids_in(col, ids):
    return f"{col}=in.({','.join(str(i) for i in ids)})"


def columns(db, table):
    rows = get(db, table, "select=*&limit=1")
    return set(rows[0].keys()) if rows else None


# ── read production ──────────────────────────────────────────────────────────
vendor = get(SRC, "training_vendors", "select=*&key=eq.ISAPS")
if len(vendor) != 1:
    sys.exit("production has no single ISAPS vendor row")
vendor = vendor[0]
levels = get(SRC, "training_levels", f"select=*&vendor_id=eq.{vendor['id']}&order=id")
lvl_ids = [l["id"] for l in levels]
courses = get(SRC, "training_courses", f"select=*&{ids_in('level_id', lvl_ids)}&order=id")
units = get(SRC, "training_modules", f"select=*&{ids_in('course_id', [c['id'] for c in courses])}&order=id")
quizzes = get(SRC, "training_grand_quizzes", f"select=*&{ids_in('level_id', lvl_ids)}&order=id")
q_unit = get(SRC, "training_questions", f"select=*&{ids_in('training_module_id', [u['id'] for u in units])}&order=id&limit=5000")
q_exam = get(SRC, "training_questions", f"select=*&{ids_in('grand_quiz_id', [q['id'] for q in quizzes])}&order=id&limit=5000") if quizzes else []
print(f"production ISAPS: {len(levels)} level(s), {len(courses)} courses, {len(units)} units, "
      f"{len(quizzes)} exam quizzes, {len(q_unit)} unit questions, {len(q_exam)} exam-bank questions")

# ── target checks ────────────────────────────────────────────────────────────
if get(TGT, "training_vendors", "select=id&key=eq.ISAPS"):
    sys.exit("staging already has an ISAPS vendor — refusing to copy twice")
program = get(TGT, "training_programs", f"select=id&key=eq.{MIDDLE_HIGH_KEY}")
if len(program) != 1:
    sys.exit(f"staging has no {MIDDLE_HIGH_KEY} program")
tcols = {t: columns(TGT, t) for t in ["training_vendors", "training_levels", "training_courses",
                                      "training_modules", "training_grand_quizzes", "training_questions"]}


def shape(row, table, drop=("id", "created_at")):
    """Keep only the columns the target table has; drop ids the target assigns."""
    keep = tcols[table]
    return {k: v for k, v in row.items() if k not in drop and (keep is None or k in keep)}


if not WRITE:
    print("DRY RUN — nothing written. Re-run with --yes-write to copy into staging.")
    sys.exit(0)

# ── write staging ────────────────────────────────────────────────────────────
v = shape(vendor, "training_vendors", drop=("created_at",))   # keep the uuid
v.update({k: val for k, val in GO_LIVE.items() if k in tcols["training_vendors"]})
call(TGT, "POST", "training_vendors", v)

level_map, course_map, unit_map, quiz_map = {}, {}, {}, {}
for l in levels:
    level_map[l["id"]] = call(TGT, "POST", "training_levels", shape(l, "training_levels"))[0]["id"]
for c in courses:
    row = shape(c, "training_courses"); row["level_id"] = level_map[c["level_id"]]
    course_map[c["id"]] = call(TGT, "POST", "training_courses", row)[0]["id"]
for u in units:
    row = shape(u, "training_modules"); row["course_id"] = course_map[u["course_id"]]
    unit_map[u["id"]] = call(TGT, "POST", "training_modules", row)[0]["id"]
for q in quizzes:
    row = shape(q, "training_grand_quizzes"); row["level_id"] = level_map[q["level_id"]]
    quiz_map[q["id"]] = call(TGT, "POST", "training_grand_quizzes", row)[0]["id"]

batch = []
for q in q_unit + q_exam:
    row = shape(q, "training_questions")
    if q.get("training_module_id") is not None:
        row["training_module_id"] = unit_map[q["training_module_id"]]
    if q.get("grand_quiz_id") is not None:
        row["grand_quiz_id"] = quiz_map[q["grand_quiz_id"]]
    batch.append(row)
for i in range(0, len(batch), 200):
    call(TGT, "POST", "training_questions", batch[i:i + 200])

call(TGT, "POST", "training_program_scopes",
     {"program_id": program[0]["id"], "vendor_id": vendor["id"], "level_ids": None})

print(f"copied: {len(level_map)} level(s), {len(course_map)} courses, {len(unit_map)} units, "
      f"{len(quiz_map)} quizzes, {len(batch)} questions; I-SAPS scoped to {MIDDLE_HIGH_KEY}")
