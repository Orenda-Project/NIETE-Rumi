"""bd-60119 — move the ISAPS summative MCQs and CRQs from level-wide to PER MODULE.

The I-SAPS doc puts summative assessment "at the end of each module", and the
source workbooks are organised that way. The first seeding put all 63 MCQs in
one level grand quiz and all 36 CRQs in one level capstone, which is what makes
the level screen show a single exam at the end instead of nine.

Module recovery:
  CRQ  — order_index was seeded as (module-1)*10 + item, so it decodes directly.
  MCQ  — order_index was sequential, so the module is recovered by matching the
         question text back to the source workbook. 62 of 63 match; the last is
         the known-malformed 'Saturday Morning' row (bd-60118), pinned to M6.

Operator decision 2026-09-17: NO level-wide exam afterwards. The nine module
exams ARE the summative assessment, and the composite decides the level.

Dry-run by default; --yes-write to apply. Sandbox only, ISAPS rows only.
"""
import os, re, sys, json, urllib.request
sys.path.insert(0, "/tmp")
from read_banks import cells, BASE
from sbx import get, creds

WRITE = "--yes-write" in sys.argv
SATURDAY_MORNING_MODULE = 6  # bd-60118: malformed source row, module known


def header_map(rows):
    for r in rows[:6]:
        low = [(c or "").strip().lower() for c in r]
        if any(c.startswith("q no") for c in low):
            idx = {}
            for j, c in enumerate(low):
                if c.startswith("q no"): idx["qno"] = j
                elif "after unit" in c or c.startswith("scene"): idx["unit"] = j
                elif c == "type" or c.startswith("type ("): idx["type"] = j
                elif "item details" in c: idx["text"] = j
                elif c.startswith("key"): idx["key"] = j
            return idx
    return {}


def stem(t):
    parts = re.split(r"\b([A-D])[\.\)]\s+", t or "")
    return parts[0].strip() if len(parts) >= 3 else (t or "").strip()


def patch(table, flt, body):
    url, key = creds()
    r = urllib.request.Request(
        f"{url}/rest/v1/{table}?{flt}", data=json.dumps(body).encode(), method="PATCH",
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json", "Prefer": "return=minimal"})
    with urllib.request.urlopen(r, timeout=45) as resp:
        return resp.status


def post(table, rows):
    url, key = creds()
    r = urllib.request.Request(
        f"{url}/rest/v1/{table}", data=json.dumps(rows).encode(), method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json", "Prefer": "return=representation"})
    with urllib.request.urlopen(r, timeout=45) as resp:
        return json.loads(resp.read().decode())


# ---- source: stem -> module ----
src = {}
for n in range(1, 10):
    d = next(x for x in os.listdir(BASE) if x.startswith(f"Module {n} "))
    f = next(x for x in os.listdir(os.path.join(BASE, d)) if "Summative MCQ" in x)
    rows = cells(os.path.join(BASE, d, f))[0][1]
    h = header_map(rows)
    for r in rows:
        if not re.match(r"^\d+\.\d", (r[0] if r else "") or ""):
            continue
        cell = lambda k: (r[h[k]] if k in h and h[k] < len(r) else "")
        sv = stem(cell("text"))
        if len(sv) > 20:
            src.setdefault(sv[:90], n)

vid = get("training_vendors", "select=id&key=eq.ISAPS")[0]["id"]
lid = get("training_levels", f"select=id&vendor_id=eq.{vid}")[0]["id"]
courses = get("training_courses", f"select=id,title,order_index&level_id=eq.{lid}&order=order_index") or []
course_by_mod = {}
for c in courses:
    m = re.match(r"Module (\d+)", c["title"])
    if m:
        course_by_mod[int(m.group(1))] = c

quizzes = get("training_grand_quizzes", f"select=id,quiz_type&level_id=eq.{lid}") or []
gq = next((q for q in quizzes if q["quiz_type"] == "grand_quiz"), None)
cap = next((q for q in quizzes if q["quiz_type"] == "capstone"), None)

plan = {}          # module -> {"mcq":[ids], "crq":[ids]}
unresolved = []

if gq:
    for q in get("training_questions", f"select=id,question_text&grand_quiz_id=eq.{gq['id']}") or []:
        key = (q["question_text"] or "")[:90]
        mod = src.get(key)
        if mod is None and "Saturday Morning" in key:
            mod = SATURDAY_MORNING_MODULE
        if mod is None:
            unresolved.append(("MCQ", q["id"], key[:50]))
            continue
        plan.setdefault(mod, {"mcq": [], "crq": []})["mcq"].append(q["id"])

if cap:
    for q in get("training_questions", f"select=id,order_index&grand_quiz_id=eq.{cap['id']}") or []:
        mod = ((q["order_index"] or 1) - 1) // 10 + 1
        if mod not in course_by_mod:
            unresolved.append(("CRQ", q["id"], f"order_index {q['order_index']}"))
            continue
        plan.setdefault(mod, {"mcq": [], "crq": []})["crq"].append(q["id"])

print("=" * 62)
print(f"ISAPS level {lid} — re-key summative to PER MODULE   (sandbox)")
print("=" * 62)
for mod in sorted(plan):
    c = course_by_mod.get(mod)
    print(f"  Module {mod} ({c['title'][:34] if c else '?'}): "
          f"{len(plan[mod]['mcq'])} MCQ, {len(plan[mod]['crq'])} CRQ")
print(f"\n  unresolved: {len(unresolved)}")
for t, i, why in unresolved[:8]:
    print(f"     ! {t} id={i} {why}")

if not WRITE:
    print("\nDRY RUN — nothing written. Re-run with --yes-write.")
    sys.exit(0)

# one grand_quiz + one capstone PER MODULE, keyed to the module's own course.
# training_grand_quizzes is level-scoped, so the per-module quiz is identified
# by its source_quiz_id (the module number) — the column already exists.
made = 0
for mod in sorted(plan):
    c = course_by_mod[mod]
    for kind, ids in (("grand_quiz", plan[mod]["mcq"]), ("capstone", plan[mod]["crq"])):
        if not ids:
            continue
        existing = get("training_grand_quizzes",
                       f"select=id&level_id=eq.{lid}&quiz_type=eq.{kind}&source_quiz_id=eq.{900 + mod}")
        if existing:
            qid = existing[0]["id"]
        else:
            qid = post("training_grand_quizzes", [{
                "level_id": lid, "quiz_type": kind, "source_quiz_id": 900 + mod, "is_active": True,
            }])[0]["id"]
            made += 1
        patch("training_questions", f"id=in.({','.join(map(str, ids))})", {"grand_quiz_id": qid})
        print(f"  Module {mod} {kind:<11} quiz {qid}: {len(ids)} questions re-pointed")

# retire the two level-wide quizzes — no level exam (operator decision)
for q in (gq, cap):
    if q:
        patch("training_grand_quizzes", f"id=eq.{q['id']}", {"is_active": False})
        print(f"  retired level-wide {q['quiz_type']} quiz {q['id']} (is_active=false)")

print(f"\nDONE — {made} module quizzes created.")
