"""bd-60128 — fold each module's CRQs into that module's MCQ quiz.

The CRQs were seeded as a separate per-module `capstone` quiz. That inherited
capstone-delivery's level-scoped .maybeSingle(), which throws on I-SAPS's nine
capstones, so the CRQ could never be delivered.

Operator's framing (2026-09-18): 8 MCQs + 1 written answer = 9 questions. So
the CRQ rows move into the module's grand_quiz, ordered AFTER the MCQs, and the
now-empty capstone quizzes are retired. One engine, one attempt, one score.

Ordering: MCQs keep their order_index; CRQs are renumbered to 900+ within the
module so they always sort last regardless of how many MCQs there are.

Dry-run by default; --yes-write to apply. Sandbox only, ISAPS rows only.
"""
import sys, json, re, urllib.request
sys.path.insert(0, "/tmp")
from sbx import get, creds

WRITE = "--yes-write" in sys.argv
BASE = 900
CRQ_ORDER_BASE = 900


def patch(table, flt, body):
    url, key = creds()
    r = urllib.request.Request(
        f"{url}/rest/v1/{table}?{flt}", data=json.dumps(body).encode(), method="PATCH",
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json", "Prefer": "return=minimal"})
    with urllib.request.urlopen(r, timeout=45) as resp:
        return resp.status


vid = get("training_vendors", "select=id&key=eq.ISAPS")[0]["id"]
lid = get("training_levels", f"select=id&vendor_id=eq.{vid}")[0]["id"]
courses = get("training_courses", f"select=id,title&level_id=eq.{lid}&order=order_index") or []

plan = []
for c in courses:
    m = re.match(r"Module (\d+)", c["title"])
    if not m:
        continue
    n = int(m.group(1))
    src = BASE + n
    qz = get("training_grand_quizzes",
             f"select=id,quiz_type&level_id=eq.{lid}&source_quiz_id=eq.{src}&is_active=eq.true") or []
    mcq = next((q for q in qz if q["quiz_type"] == "grand_quiz"), None)
    cap = next((q for q in qz if q["quiz_type"] == "capstone"), None)
    if not mcq or not cap:
        continue
    crqs = get("training_questions",
               f"select=id,order_index&grand_quiz_id=eq.{cap['id']}&order=order_index") or []
    mcqs = get("training_questions", f"select=id&grand_quiz_id=eq.{mcq['id']}") or []
    if crqs:
        plan.append({"module": n, "mcq_quiz": mcq["id"], "cap_quiz": cap["id"],
                     "mcq_count": len(mcqs), "crq_ids": [q["id"] for q in crqs]})

print("=" * 60)
print(f"Fold I-SAPS CRQs into the module MCQ quiz  (level {lid}, sandbox)")
print("=" * 60)
for p in plan:
    print(f"  M{p['module']}: {p['mcq_count']} MCQ + {len(p['crq_ids'])} CRQ "
          f"-> quiz {p['mcq_quiz']} (retire capstone {p['cap_quiz']})")
print(f"\n  modules: {len(plan)}   CRQ rows moving: {sum(len(p['crq_ids']) for p in plan)}")
print("  NOTE: all 4 CRQs per module move into the bank; delivery serves ONE")
print("        per attempt (pickOneCrq, seeded on the attempt id).")

if not WRITE:
    print("\nDRY RUN — nothing written. Re-run with --yes-write.")
    sys.exit(0)

for p in plan:
    for i, qid in enumerate(p["crq_ids"], 1):
        patch("training_questions", f"id=eq.{qid}",
              {"grand_quiz_id": p["mcq_quiz"], "order_index": CRQ_ORDER_BASE + i})
    patch("training_grand_quizzes", f"id=eq.{p['cap_quiz']}", {"is_active": False})
    print(f"  M{p['module']}: moved {len(p['crq_ids'])} CRQs, retired capstone {p['cap_quiz']}")

print("\nDONE.")
