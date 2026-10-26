#!/usr/bin/env python3
"""bd-yef5iq — seed I-SAPS Level 2 (Intermediate) in ONE pass, in production's final Level 1 shape.

Level 1 reached its shape in four passes (2026-09-17 seed, per-module rekey, CRQ seed, CRQ fold)
and production holds the result. This writes Level 2 straight into that result:

  training_levels         1   "Level 2: Intermediate", order_index 1, cpd_level 2 (chained after L1)
  training_courses        9   "Module N - <title>", same course_type per module as Level 1
  training_modules       53   one per unit video, "Unit 2101" ...; video_url = the re-encoded unit on
                              digital-coach-audio/training/rehosted/i-saps/level-2/module-N/unit-NNNN.mp4
  training_questions          formative MCQs on their unit (order_index runs across the level, as L1)
  training_grand_quizzes  9   one grand_quiz per module, source_quiz_id 900+N (isaps-module-exam.rules)
  training_questions          per module: the summative MCQ bank (order_index 1..k) and the 4 CRQs
                              (order_index 901..904, options [] / correct_option '', rubric jsonb)

No capstone rows and no level-wide exam: I-SAPS assesses per module (operator 2026-09-17), and the
nine module exams decide the level.

Source: the partner's "Level 2 Training Content" folder (2026-10-23 OneDrive drop). Unit codes are
FOUR digits at this level (2101 = level 2, module 1, unit 01); the sheets store them as numbers.

Safety:
  * DRY RUN BY DEFAULT — prints the plan and every mismatch with the source. --yes-write to mutate.
  * --target pins the Supabase project ref; the env file must resolve to it or the script refuses.
  * Refuses to write if the I-SAPS vendor already has a level at order_index 1 (idempotent by refusal).
  * --inactive seeds the level with is_active=false, so production can be written and read back
    before any teacher sees it; activate with --activate.
  * --rollback deletes this Level 2 tree, and refuses if any teacher progress or attempt row points at it.

Usage:
  python3 scripts/migrations/2026-10-23-isaps-level2-seed.py --target sandbox --env .env.sandbox \\
      --content "<investigation>/outputs/raw/Level 2 Training Content"            # dry run
  ... --yes-write [--inactive]
  ... --activate          # flip an --inactive seed live
  ... --rollback          # remove it again (no teacher data may reference it)
"""
import argparse, importlib.util, json, os, re, subprocess, sys, urllib.error, urllib.parse, urllib.request, zipfile
from xml.etree import ElementTree as ET

REFS = {
    "sandbox": "olvritwoqujtjvwfulbh",
    "staging": "rpqkekcfvumypldbejhp",
    "production": "ihzciabopbttygxxgrkm",
}
LEVEL_NAME = "Level 2: Intermediate"   # the partner's own header on every Level 2 CRQ document
LEVEL_ORDER = 1                        # Level 1 is 0
CPD_LEVEL = 2
R2_BASE = ("https://58a6fb2a86d61397895d6b97b73a3ebe.r2.cloudflarestorage.com"
           "/digital-coach-audio/training/rehosted/i-saps/level-2")
PER_MODULE_SOURCE_BASE = 900           # bot/shared/services/training/isaps-module-exam.rules.js
CRQ_ORDER_BASE = 900                   # CRQs sort after any number of MCQs (2026-09-18 fold)
RUBRIC_SOURCE = "I-SAPS Level 2 CRQs (partner .docx)"

# Same module -> course_type mapping Level 1 carries in production.
MODULES = [
    (1, "Philosophical Foundations", "PROFESSIONAL_GROWTH_ETHICS"),
    (2, "Affective Development", "INCLUSIVE_EDUCATION"),
    (3, "Classroom Management", "CLASSROOM_MANAGEMENT"),
    (4, "Digital Literacy", "DIGITAL_LITERACY"),
    (5, "Assessment and Data Use", "ASSESSMENT_FEEDBACK"),
    (6, "Learner Development", "INCLUSIVE_EDUCATION"),
    (7, "21st Century Learning", "PEDAGOGICAL_PRACTICE"),
    (8, "Instructional Design", "PEDAGOGICAL_PRACTICE"),
    (9, "Teacher Leadership", "PROFESSIONAL_GROWTH_ETHICS"),
]

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


# ---------------------------------------------------------------- REST
class Db:
    def __init__(self, env_file, target):
        env = {}
        for line in open(env_file, encoding="utf-8", errors="replace"):
            line = line.strip().replace("\r", "")
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
        self.url = env.get("SUPABASE_URL", "").rstrip("/")
        self.key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
        ref = urllib.parse.urlparse(self.url).hostname.split(".")[0] if self.url else ""
        if ref != REFS[target]:
            sys.exit(f"REFUSING: {env_file} points at '{ref}', --target {target} is '{REFS[target]}'")
        if not self.key:
            sys.exit(f"REFUSING: no SUPABASE_SERVICE_ROLE_KEY in {env_file}")
        self.ref = ref

    def req(self, method, path, body=None, prefer="return=representation"):
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}",
             "Content-Type": "application/json", "Accept": "application/json", "Prefer": prefer}
        data = None if body is None else json.dumps(body).encode()
        r = urllib.request.Request(f"{self.url}/rest/v1/{path}", data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(r, timeout=120) as resp:
                raw = resp.read().decode("utf-8", "replace")
                return json.loads(raw) if raw.strip() else []
        except urllib.error.HTTPError as e:
            raise SystemExit(f"HTTP {e.code} {method} {path}: {e.read().decode()[:600]}")

    def get(self, t, q):
        return self.req("GET", f"{t}?{q}")

    def insert(self, t, rows):
        return self.req("POST", t, rows) if rows else []


# ---------------------------------------------------------------- workbooks
_M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def sheet_rows(path):
    """First sheet as [(row_no, {col_letter: text})], stdlib only."""
    z = zipfile.ZipFile(path)
    ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        ss = ["".join(t.text or "" for t in si.iter(_M + "t")) for si in root.findall(_M + "si")]
    name = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))[0]
    rows = []
    for row in ET.fromstring(z.read(name)).iter(_M + "row"):
        cells = {}
        for c in row.findall(_M + "c"):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            v = c.find(_M + "v")
            if c.get("t") == "s" and v is not None:
                val = ss[int(v.text)]
            elif c.get("t") == "inlineStr":
                val = "".join(t.text or "" for t in c.iter(_M + "t"))
            else:
                val = v.text if v is not None else ""
            if val not in (None, ""):
                cells[col] = val
        if cells:
            rows.append((int(row.get("r")), cells))
    return rows


def header_map(rows):
    """Columns by HEADER, never by position (the 2026-09-17 positional read dropped 64 of 68 items)."""
    for _, cells in rows[:6]:
        low = {k: (v or "").strip().lower() for k, v in cells.items()}
        if any(v.startswith("q no") for v in low.values()):
            idx = {}
            for k, v in low.items():
                if v.startswith("q no"): idx["qno"] = k
                elif "after unit" in v or v.startswith("scene"): idx["unit"] = k
                elif v == "type" or v.startswith("type ("): idx["type"] = k
                elif "item details" in v: idx["text"] = k
                elif v.startswith("key"): idx["key"] = k
            return idx
    return {}


OPT_LINE = re.compile(r"^\s*([A-D])\s*[\.\)]?\s*(\S.*)$")


def split_options(text):
    """Stem + options, one option per LINE.

    Line-based rather than the Level 1 inline regex: two Level 2 items break the
    'A. ' pattern ('D They feared…' with no full stop, 'B.To achieve…' with no space)
    and the inline split silently returned three options for each.
    """
    stem, opts = [], []
    for line in (text or "").replace("\r", "").split("\n"):
        m = OPT_LINE.match(line)
        if m and (len(opts) == 0 and m.group(1) == "A" or opts and ord(m.group(1)) == ord(opts[-1][0]) + 1):
            opts.append((m.group(1), m.group(2).strip()))
        elif opts:
            opts[-1] = (opts[-1][0], (opts[-1][1] + " " + line.strip()).strip())
        else:
            stem.append(line.rstrip())
    return "\n".join(stem).strip(), opts


def key_index(cell):
    m = re.fullmatch(r"\s*([A-D])\s*", cell or "")
    return str(ord(m.group(1)) - 64) if m else None


def unit_code(cell):
    """'2101' / '2101.0' -> 2101. Level 2 refs are four digits."""
    try:
        n = int(float(str(cell).strip()))
    except ValueError:
        return None
    return n if 1000 <= n <= 9999 else None


# ---------------------------------------------------------------- CRQs
def doc_lines(path):
    """Identical to 2026-09-17-isaps-crq-seed.py so splitCrqItems sees the same input shape."""
    x = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8", "replace")
    x = re.sub(r"</w:p>", "\n", x)
    x = re.sub(r"</w:tr>", "\n", x)
    x = re.sub(r"</w:tc>", " | ", x)
    t = re.sub(r"<[^>]+>", "", x)
    for a, b in (("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&apos;", "'")):
        t = t.replace(a, b)
    return [re.sub(r"\s+", " ", l).strip(" |").strip() for l in t.split("\n") if l.strip()]


def split_crq_items(lines):
    """The bot's own isaps-crq.rules.js — one implementation, as the Level 1 CRQ seed does."""
    script = os.path.join(REPO_ROOT, "bot", "shared", "services", "training", "isaps-crq.rules.js")
    prog = ("const {splitCrqItems}=require(process.argv[1]);"
            "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{"
            "process.stdout.write(JSON.stringify(splitCrqItems(JSON.parse(s))));});")
    out = subprocess.run(["node", "-e", prog, script], input=json.dumps(lines), capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"CRQ split failed: {out.stderr[:400]}")
    return json.loads(out.stdout)


def _rubric_parser():
    """scripts/extract-isaps-crq-rubrics.py:parse_file — the WordprocessingML table parser."""
    p = os.path.join(REPO_ROOT, "scripts", "extract-isaps-crq-rubrics.py")
    spec = importlib.util.spec_from_file_location("isaps_rubrics", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.parse_file


# ---------------------------------------------------------------- plan
def module_dir(content, n):
    return next(d for d in os.listdir(content) if d.startswith(f"Module {n} "))


def collect(content):
    parse_rubrics = _rubric_parser()
    plan = {"modules": [], "warnings": []}
    warn = plan["warnings"].append
    for n, title, ctype in MODULES:
        d = os.path.join(content, module_dir(content, n))
        vids = []
        for root, _, files in os.walk(d):
            for f in files:
                m = re.fullmatch(r"Unit\s+(\d{4})\.mp4", f)
                if m:
                    vids.append(int(m.group(1)))
        vids.sort()
        for c in vids:
            if c // 1000 != 2 or (c // 100) % 10 != n:
                warn(f"M{n}: Unit {c} does not encode level 2 / module {n}")
        units = [{"code": c, "title": f"Unit {c}", "video_url": f"{R2_BASE}/module-{n}/unit-{c}.mp4"} for c in vids]

        files = os.listdir(d)
        pick = lambda pat, ext: [f for f in files if pat in f and f.endswith(ext)]

        def items(fname, kind):
            rows = sheet_rows(os.path.join(d, fname))
            h = header_map(rows)
            for need in ("qno", "type", "text", "key"):
                if need not in h:
                    sys.exit(f"M{n} {kind}: no '{need}' column in {fname}")
            out = []
            for rn, cells in rows:
                if not re.match(r"^\d+\.\d", cells.get(h["qno"], "")):
                    continue
                g = lambda k: cells.get(h[k], "") if k in h else ""
                stem, opts = split_options(g("text"))
                key = key_index(g("key"))
                where = f"M{n} {kind} row {rn} (Q {g('qno')})"
                if "MCQ" not in g("type").upper():
                    warn(f"{where}: type {g('type')!r} — skipped"); continue
                if [o[0] for o in opts] != ["A", "B", "C", "D"]:
                    warn(f"{where}: options parsed {''.join(o[0] for o in opts)!r} — skipped"); continue
                if not key:
                    warn(f"{where}: answer key {g('key')!r} — skipped"); continue
                out.append({"row": rn, "unit": unit_code(g("unit")), "stem": stem,
                            "options": [o[1] for o in opts], "key": key})
            return out

        fm = pick("Formative", ".xlsx")
        sm = pick("Summative Assessment Questions", ".xlsx") or pick("Summative MCQ", ".xlsx")
        cr = pick("CRQ", ".docx")
        if len(fm) != 1 or len(sm) != 1 or len(cr) != 1:
            sys.exit(f"M{n}: expected one formative/summative/CRQ file, got {fm} {sm} {cr}")

        formative = []
        for it in items(fm[0], "formative"):
            if it["unit"] not in vids:
                warn(f"M{n} formative row {it['row']}: 'Place after Unit' {it['unit']} has no video in the drop — skipped")
                continue
            formative.append(it)
        for c in vids:
            if not any(f["unit"] == c for f in formative):
                warn(f"M{n}: Unit {c} has no formative item (completes on watch, as L1 Units 302/303 do)")

        mcq = items(sm[0], "summative")

        crq_path = os.path.join(d, cr[0])
        split = split_crq_items(doc_lines(crq_path))
        rubrics = {r["item"]: r for r in parse_rubrics(crq_path)}
        crqs = []
        for it in split:
            no = it["item_no"]
            r = rubrics.get(no)
            where = f"M{n} CRQ item {no}"
            if not it.get("prompt"):
                warn(f"{where}: empty prompt — skipped"); continue
            if "Possible Answer" in it["prompt"] or "Exemplary" in it["prompt"]:
                warn(f"{where}: model answer/rubric LEAK into the prompt — skipped"); continue
            if not r or not r["criteria"]:
                warn(f"{where}: no rubric table — skipped"); continue
            empty = [c["name"] for c in r["criteria"] if not c["bands"]]
            if empty:
                warn(f"{where}: criteria with no band text {empty} — skipped"); continue
            best = sum(max(int(k) for k in c["bands"]) for c in r["criteria"])
            if best != 10:
                warn(f"{where}: rubric max achievable {best}, expected 10 — skipped"); continue
            # The band table is the marking standard; a "(4 marks)" header over bands that stop at 3
            # (M3 item 4) would tell the grader a criterion is worth more than any band awards.
            for c in r["criteria"]:
                top = max(int(k) for k in c["bands"])
                if c["marks"] != top:
                    warn(f"{where}: criterion {c['name']!r} headed ({c['marks']} marks) but its bands stop at {top} — stored as {top}")
                    c["marks"] = top
            crqs.append({"item_no": no, "prompt": it["prompt"],
                         "rubric": {"source": RUBRIC_SOURCE, "criteria": r["criteria"], "total_marks": 10}})
        if len(crqs) != 4:
            warn(f"M{n}: {len(crqs)} CRQs usable (Level 1 banks hold 4)")
        plan["modules"].append({"no": n, "title": f"Module {n} - {title}", "course_type": ctype,
                                "units": units, "formative": formative, "mcq": mcq, "crq": crqs})
    return plan


def report(plan, target, ref):
    mods = plan["modules"]
    print("=" * 72)
    print(f"I-SAPS {LEVEL_NAME} seed — target {target} ({ref})")
    print("=" * 72)
    print(f"{'module':<42}{'units':>6}{'form':>6}{'mcq':>5}{'crq':>5}")
    for m in mods:
        print(f"  {m['title']:<40}{len(m['units']):>6}{len(m['formative']):>6}{len(m['mcq']):>5}{len(m['crq']):>5}")
    print(f"  {'TOTAL':<40}{sum(len(m['units']) for m in mods):>6}{sum(len(m['formative']) for m in mods):>6}"
          f"{sum(len(m['mcq']) for m in mods):>5}{sum(len(m['crq']) for m in mods):>5}")
    print(f"\nwarnings ({len(plan['warnings'])}):")
    for w in plan["warnings"]:
        print(f"  ! {w}")


# ---------------------------------------------------------------- write
def isaps(db):
    v = db.get("training_vendors", "select=id,capstone_points_per_question&key=eq.ISAPS")
    if not v:
        sys.exit("no ISAPS vendor on target — Level 1 must exist first")
    if v[0]["capstone_points_per_question"] != 10:
        sys.exit(f"ISAPS CRQ scale is {v[0]['capstone_points_per_question']}, expected 10")
    return v[0]["id"]


def level2(db, vid):
    return db.get("training_levels", f"select=id,name,is_active&vendor_id=eq.{vid}&order_index=eq.{LEVEL_ORDER}")


def write(db, plan, active):
    vid = isaps(db)
    if level2(db, vid):
        sys.exit(f"REFUSING: ISAPS already has a level at order_index {LEVEL_ORDER} — use --rollback first")
    lid = db.insert("training_levels", [{"vendor_id": vid, "name": LEVEL_NAME, "order_index": LEVEL_ORDER,
                                         "cpd_level": CPD_LEVEL, "is_active": active}])[0]["id"]
    print(f"\nlevel {lid} {LEVEL_NAME!r} is_active={active}")
    courses = db.insert("training_courses", [{"level_id": lid, "title": m["title"], "course_type": m["course_type"],
                                               "order_index": m["no"], "is_active": True} for m in plan["modules"]])
    cid = {c["order_index"]: c["id"] for c in courses}
    unit_rows = [{"course_id": cid[m["no"]], "title": u["title"], "video_url": u["video_url"],
                  "source_media_url": u["video_url"], "order_index": i, "is_active": True}
                 for m in plan["modules"] for i, u in enumerate(m["units"], 1)]
    units = db.insert("training_modules", unit_rows)
    uid = {int(u["title"].split()[-1]): u["id"] for u in units}
    print(f"  courses {len(courses)}, units {len(units)}")

    n = 0
    form_rows = []
    for m in plan["modules"]:
        for q in m["formative"]:
            n += 1
            form_rows.append({"training_module_id": uid[q["unit"]], "question_text": q["stem"],
                              "options": q["options"], "correct_option": q["key"],
                              "order_index": n, "is_active": True})
    db.insert("training_questions", form_rows)
    print(f"  formative questions {len(form_rows)}")

    quizzes = db.insert("training_grand_quizzes", [{"level_id": lid, "quiz_type": "grand_quiz",
                                                     "source_quiz_id": PER_MODULE_SOURCE_BASE + m["no"],
                                                     "is_active": True} for m in plan["modules"]])
    qid = {q["source_quiz_id"] - PER_MODULE_SOURCE_BASE: q["id"] for q in quizzes}
    exam_rows = []
    for m in plan["modules"]:
        for i, q in enumerate(m["mcq"], 1):
            # rubric: None so every row carries the same keys — PostgREST rejects a mixed bulk insert.
            exam_rows.append({"grand_quiz_id": qid[m["no"]], "question_text": q["stem"], "options": q["options"],
                              "correct_option": q["key"], "order_index": i, "rubric": None, "is_active": True})
        for c in m["crq"]:
            exam_rows.append({"grand_quiz_id": qid[m["no"]], "question_text": c["prompt"], "options": [],
                              "correct_option": "", "order_index": CRQ_ORDER_BASE + c["item_no"],
                              "rubric": c["rubric"], "is_active": True})
    db.insert("training_questions", exam_rows)
    print(f"  module exams {len(quizzes)}, exam questions {len(exam_rows)}")
    print("\nDONE.")


def tree(db, lid):
    courses = [c["id"] for c in db.get("training_courses", f"select=id&level_id=eq.{lid}")]
    units = [u["id"] for u in db.get("training_modules", f"select=id&course_id=in.({','.join(map(str, courses))})")] if courses else []
    quizzes = [q["id"] for q in db.get("training_grand_quizzes", f"select=id&level_id=eq.{lid}")]
    return courses, units, quizzes


def rollback(db):
    vid = isaps(db)
    lv = level2(db, vid)
    if not lv:
        sys.exit("nothing to roll back")
    lid = lv[0]["id"]
    courses, units, quizzes = tree(db, lid)
    used = db.get("training_assessment_attempts", f"select=id&level_id=eq.{lid}&limit=1")
    if units:
        used += db.get("teacher_training_progress", f"select=id&module_id=in.({','.join(map(str, units))})&limit=1")
    if used:
        sys.exit(f"REFUSING: teacher rows reference level {lid} — not deleting")
    if units:
        db.req("DELETE", f"training_questions?training_module_id=in.({','.join(map(str, units))})", prefer="return=minimal")
    if quizzes:
        db.req("DELETE", f"training_questions?grand_quiz_id=in.({','.join(map(str, quizzes))})", prefer="return=minimal")
        db.req("DELETE", f"training_grand_quizzes?id=in.({','.join(map(str, quizzes))})", prefer="return=minimal")
    if units:
        db.req("DELETE", f"training_modules?id=in.({','.join(map(str, units))})", prefer="return=minimal")
    if courses:
        db.req("DELETE", f"training_courses?id=in.({','.join(map(str, courses))})", prefer="return=minimal")
    db.req("DELETE", f"training_levels?id=eq.{lid}", prefer="return=minimal")
    print(f"rolled back level {lid}: {len(courses)} courses, {len(units)} units, {len(quizzes)} quizzes")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", required=True, choices=sorted(REFS))
    ap.add_argument("--env", required=True)
    ap.add_argument("--content")
    ap.add_argument("--yes-write", action="store_true")
    ap.add_argument("--inactive", action="store_true")
    ap.add_argument("--activate", action="store_true")
    ap.add_argument("--rollback", action="store_true")
    a = ap.parse_args()
    db = Db(a.env, a.target)

    if a.rollback:
        return rollback(db) if a.yes_write else print("DRY RUN — --rollback needs --yes-write")
    if a.activate:
        lv = level2(db, isaps(db))
        if not lv:
            sys.exit("no Level 2 to activate")
        if not a.yes_write:
            return print(f"DRY RUN — would set level {lv[0]['id']} is_active=true")
        db.req("PATCH", f"training_levels?id=eq.{lv[0]['id']}", {"is_active": True}, prefer="return=minimal")
        return print(f"level {lv[0]['id']} is_active=true")

    if not a.content:
        sys.exit("--content is required to seed")
    plan = collect(a.content)
    report(plan, a.target, db.ref)
    if not a.yes_write:
        print("\nDRY RUN — nothing written. Re-run with --yes-write.")
        return
    write(db, plan, active=not a.inactive)


if __name__ == "__main__":
    main()
