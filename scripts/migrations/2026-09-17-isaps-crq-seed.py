#!/usr/bin/env python3
"""bd-60113 — seed the I-SAPS Level 1 CRQs as capstone items.

CRQs are constructed-response items: a scenario, a question, and a printed
rubric worth 10 marks. They land on the SAME path Beacon House uses —
`training_grand_quizzes` with quiz_type='capstone' plus `training_questions`
rows carrying empty options/correct_option — which capstone-delivery.service
already serves over WhatsApp and marks with the LLM.

Operator decisions (2026-09-17):
  * per-vendor 0-10 scale (training_vendors.capstone_points_per_question = 10,
    applied by 2026-09-17-capstone-points-per-vendor.sql)
  * seed ALL 4 items per module as a BANK (36 rows) and serve one, so a
    re-attempt draws a different scenario — the doc's section 5.3 re-attempt
    rule explicitly wants "a new set of CRQs".

Only `prompt` (scenario + question) is stored in question_text. The documents
ship a full worked answer and the rubric directly beneath each question; those
are extracted separately and must never reach the teacher mid-exam.

DRY RUN BY DEFAULT. --yes-write to mutate. Hard-pinned to SANDBOX.

Usage:
  python3 scripts/migrations/2026-09-17-isaps-crq-seed.py
  python3 scripts/migrations/2026-09-17-isaps-crq-seed.py --yes-write
"""
import json, os, re, subprocess, sys, zipfile, urllib.request, urllib.parse, urllib.error

EXPECTED_REF = "olvritwoqujtjvwfulbh"

# Repo root derived from THIS file, never hardcoded — root CLAUDE.md requires
# relative paths, and an absolute /home/... path breaks on any other machine.
_HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
CONTENT_DIRNAME = "I-SAPS Level 1 Training Content"


def _find_upward(name, start, limit=8):
    """Walk up from `start` looking for a sibling directory called `name`.

    The repo is checked out both directly and as a git worktree nested under
    .claude/worktrees/<bead>/, so the distance from this file to the content
    folder is not fixed. Searching upward handles both without hardcoding an
    absolute path (root CLAUDE.md: never hardcode /home/<name>/...).
    """
    cur = start
    for _ in range(limit):
        cand = os.path.join(cur, name)
        if os.path.isdir(cand):
            return cand
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return None


CONTENT = _find_upward(CONTENT_DIRNAME, REPO_ROOT) or os.path.join(REPO_ROOT, CONTENT_DIRNAME)

MODULES = list(range(1, 10))


def _sandbox_env_path():
    """.env.sandbox, found relative to the repo root."""
    cand = os.path.join(REPO_ROOT, ".env.sandbox")
    if os.path.isfile(cand):
        return cand
    nr = _find_upward("NIETE-Rumi", REPO_ROOT)
    if nr and os.path.isfile(os.path.join(nr, ".env.sandbox")):
        return os.path.join(nr, ".env.sandbox")
    sys.exit("cannot locate .env.sandbox relative to %s" % REPO_ROOT)


def _creds(_cache={}):
    """Resolved ONCE — re-reading the dotenv per request was ~400 file opens."""
    if _cache:
        return _cache["url"], _cache["key"]
    env = {}
    for line in open(_sandbox_env_path(), encoding="utf-8", errors="replace"):
        line = line.strip().replace("\r", "")
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    url = env.get("SUPABASE_URL", "").rstrip("/")
    key = (env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SERVICE_KEY")
           or env.get("SUPABASE_KEY") or env.get("SUPABASE_ANON_KEY") or "")
    ref = url.split("//")[-1].split(".")[0] if url else ""
    if ref != EXPECTED_REF:
        sys.exit(f"REFUSING: sandbox env points at '{ref}', expected '{EXPECTED_REF}'")
    if not key:
        sys.exit("REFUSING: no service key in .env.sandbox")
    _cache.update(url=url, key=key)
    return url, key


def _req(method, path, body=None, prefer=None):
    url, key = _creds()
    data = json.dumps(body).encode() if body is not None else None
    h = {"apikey": key, "Authorization": f"Bearer {key}",
         "Content-Type": "application/json", "Accept": "application/json"}
    if prefer:
        h["Prefer"] = prefer
    r = urllib.request.Request(f"{url}/rest/v1/{path}", data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=90) as resp:
            raw = resp.read().decode("utf-8", "replace")
            return json.loads(raw) if raw.strip() else []
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} {method} {path}: {e.read().decode()[:400]}")


def get(t, q=""):
    return _req("GET", f"{t}?{q}" if q else t)


def insert(t, rows):
    """Batched insert — one POST per table rather than one per row."""
    return _req("POST", t, rows, prefer="return=representation")


def doc_lines(path):
    x = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8", "replace")
    x = re.sub(r"</w:p>", "\n", x)
    x = re.sub(r"</w:tr>", "\n", x)
    x = re.sub(r"</w:tc>", " | ", x)
    t = re.sub(r"<[^>]+>", "", x)
    for a, b in (("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&apos;", "'")):
        t = t.replace(a, b)
    return [re.sub(r"\s+", " ", l).strip(" |").strip() for l in t.split("\n") if l.strip()]


def split_items(lines):
    """Delegates to the JS rules module, so there is ONE implementation.

    The alternative was a Python mirror of isaps-crq.rules.js, and the review of
    the first seeding pass showed exactly why that is a trap: the mirrored
    parse_unit_ref left the tested copy dead and the running copy untested. The
    node hop costs one subprocess per document and keeps the 9 pinned cases
    covering the code that actually runs.
    """
    script = os.path.join(REPO_ROOT, "bot", "shared", "services", "training", "isaps-crq.rules.js")
    prog = (
        "const {splitCrqItems}=require(process.argv[1]);"
        "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{"
        "process.stdout.write(JSON.stringify(splitCrqItems(JSON.parse(s))));});"
    )
    out = subprocess.run(["node", "-e", prog, script],
                         input=json.dumps(lines), capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"CRQ split failed: {out.stderr[:400]}")
    return json.loads(out.stdout)


def collect():
    plan, warnings = [], []
    for n in MODULES:
        d = next(x for x in os.listdir(CONTENT) if x.startswith(f"Module {n} "))
        f = next(x for x in os.listdir(os.path.join(CONTENT, d)) if "CRQ" in x)
        items = split_items(doc_lines(os.path.join(CONTENT, d, f)))
        if len(items) != 4:
            warnings.append(f"M{n}: expected 4 CRQ items, found {len(items)}")
        for it in items:
            if not it["prompt"]:
                warnings.append(f"M{n} item {it['item_no']}: empty prompt — skipped")
                continue
            # Belt and braces: the extractor already separates these, but a leak
            # here would hand the teacher the worked answer mid-exam.
            if "Possible Answer" in it["prompt"] or "Exemplary" in it["prompt"]:
                warnings.append(f"M{n} item {it['item_no']}: model answer/rubric LEAK — skipped")
                continue
            plan.append({"module": n, "item_no": it["item_no"], "marks": it["marks"],
                         "concept": it["concept"], "prompt": it["prompt"],
                         "model_answer": it["model_answer"], "rubric": it["rubric"]})
    return plan, warnings


def main():
    write = "--yes-write" in sys.argv
    plan, warnings = collect()
    print("=" * 66)
    print(f"I-SAPS Level 1 CRQ seed  (target: SANDBOX {EXPECTED_REF})")
    print("=" * 66)
    print(f"  CRQ items        : {len(plan)}  (4 per module x 9 = bank; 1 served per attempt)")
    print(f"  marks each       : {sorted({p['marks'] for p in plan})}")
    print(f"  prompt chars     : min {min(len(p['prompt']) for p in plan)}, "
          f"max {max(len(p['prompt']) for p in plan)}")
    print(f"  with rubric      : {sum(1 for p in plan if p['rubric'])}")
    print(f"  with model answer: {sum(1 for p in plan if p['model_answer'])}")
    print(f"\n  warnings         : {len(warnings)}")
    for w in warnings:
        print(f"     ! {w}")
    if not write:
        print("\nDRY RUN — nothing written. Re-run with --yes-write.")
        return

    ven = get("training_vendors", "select=id,capstone_points_per_question&key=eq.ISAPS")
    if not ven:
        sys.exit("no ISAPS vendor — run 2026-09-17-isaps-level1-seed.py first")
    scale = ven[0]["capstone_points_per_question"]
    if scale != 10:
        sys.exit(f"ISAPS capstone scale is {scale}, expected 10 — apply "
                 "2026-09-17-capstone-points-per-vendor.sql first")
    lid = get("training_levels", f"select=id&vendor_id=eq.{ven[0]['id']}")[0]["id"]

    cap = get("training_grand_quizzes",
              f"select=id&level_id=eq.{lid}&quiz_type=eq.capstone")
    if cap:
        capid = cap[0]["id"]
        print(f"\ncapstone quiz exists: {capid}")
    else:
        capid = insert("training_grand_quizzes",
                       [{"level_id": lid, "quiz_type": "capstone", "is_active": True}])[0]["id"]
        print(f"\ncapstone quiz created: {capid}")

    # Existing prompts fetched ONCE, rather than a GET per row.
    have = {(q.get("question_text") or "")[:120]
            for q in get("training_questions", f"select=question_text&grand_quiz_id=eq.{capid}") or []}
    rows = [{
        "grand_quiz_id": capid,
        "question_text": p["prompt"],
        "options": [],           # empty options + empty correct_option == open-ended
        "correct_option": "",
        "order_index": (p["module"] - 1) * 10 + p["item_no"],
        "is_active": True,
    } for p in plan if p["prompt"][:120] not in have]

    if rows:
        insert("training_questions", rows)
    print(f"  CRQ questions inserted: {len(rows)}  (skipped {len(plan) - len(rows)} already present)")
    print("\nDONE.")


if __name__ == "__main__":
    main()
