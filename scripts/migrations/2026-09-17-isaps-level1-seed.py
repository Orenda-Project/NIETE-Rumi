#!/usr/bin/env python3
"""bd-60113 — seed I-SAPS Level 1 into the NIETE training model.

Creates, idempotently:

  training_vendors     1 row   ISAPS
  training_levels      1 row   "Level 1: Novice"
  training_courses     9 rows  one per module (the model has no "module group",
                               so a course per module is the faithful shape)
  training_modules    54 rows  one per Compressed unit video, video_url ->
                               the R2 objects already uploaded under
                               training/rehosted/i-saps/level-1/
  training_questions  180 rows 112 formative (module-scoped)
                               68 summative MCQ (grand quiz)

CRQs are NOT seeded here: they are open-ended capstone items whose scenarios run
to several paragraphs in the .docx, and they need the capstone grand-quiz rows.
Separate pass.

DRY RUN BY DEFAULT. Pass --yes-write to mutate. Target is SANDBOX
(olvritwoqujtjvwfulbh) and the script refuses to run against any other project
ref, so it cannot be pointed at production by editing an env var.

Usage:
  python3 scripts/migrations/2026-09-17-isaps-level1-seed.py            # dry run
  python3 scripts/migrations/2026-09-17-isaps-level1-seed.py --yes-write
"""
import json, os, re, sys, zipfile, urllib.request, urllib.error

CONTENT = "/home/hataf/taleemabad/I-SAPS Level 1 Training Content"
R2_PREFIX = "training/rehosted/i-saps/level-1"
R2_BASE = ("https://58a6fb2a86d61397895d6b97b73a3ebe.r2.cloudflarestorage.com"
           "/digital-coach-audio")
EXPECTED_REF = "olvritwoqujtjvwfulbh"  # SANDBOX only
XL = "." + "xl" + "sx"

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


# ---------- sandbox REST ----------
def _creds():
    root = "/home/hataf/taleemabad/operator-shenanigans/Rumi 10 April 2026"
    envf = os.path.join(root, "NIETE-Rumi", ".env.sandbox")
    env = {}
    for line in open(envf, encoding="utf-8", errors="replace"):
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
        sys.exit(f"HTTP {e.code} {method} {path}: {e.read().decode()[:500]}")


def get(t, q=""):
    return _req("GET", f"{t}?{q}" if q else t)


def insert(t, rows):
    return _req("POST", t, rows, prefer="return=representation")


# ---------- workbook reading ----------
def _cells(path):
    z = zipfile.ZipFile(path)
    ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        x = z.read("xl/sharedStrings.xml").decode("utf-8", "replace")
        ss = [re.sub(r"<[^>]+>", "", m) for m in re.findall(r"<si>(.*?)</si>", x, re.S)]
    sheet = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml", n))[0]
    x = z.read(sheet).decode("utf-8", "replace")
    rows = []
    for r in re.findall(r"<row[^>]*>(.*?)</row>", x, re.S):
        vals = []
        for m in re.finditer(r"<c\b([^>]*)>(.*?)</c>", r, re.S):
            attrs, inner = m.group(1), m.group(2)
            t = re.search(r't="(\w+)"', attrs)
            t = t.group(1) if t else None
            v = re.search(r"<v>(.*?)</v>", inner, re.S)
            txt = ""
            if v:
                txt = v.group(1)
                if t == "s":
                    try:
                        txt = ss[int(txt)]
                    except Exception:
                        pass
            else:
                isx = re.search(r"<is>(.*?)</is>", inner, re.S)
                if isx:
                    txt = re.sub(r"<[^>]+>", "", isx.group(1))
            vals.append(re.sub(r"\s+", " ", txt).strip())
        rows.append(vals)
    return rows


def parse_unit_ref(cell, module_no):
    """Mirror of bot/shared/services/training/isaps-import.rules.js."""
    if cell is None:
        return None
    s = str(cell).strip()
    if not s:
        return None
    m = re.match(r"^(\d{3})\b", s)
    if m:
        return int(m.group(1))
    m = re.match(r"^(\d{1,2})\s*\.?\s*$", s)
    if m:
        n = int(m.group(1))
        return module_no * 100 + n if n > 0 else None
    return None


def parse_key(cell):
    """Answer key as the CANONICAL 1-BASED OPTION INDEX (bd-60116).

    `training_questions.correct_option` holds an INDEX, not a letter —
    quiz-delivery.service:44-47 defines the button id as
    `training_quiz_<attempt>_<optionIndex1based>` and calls that index "the one
    correct_option is written in". The first import wrote the workbooks' letters
    through unchanged, so a letter was compared against an index and EVERY
    answer graded wrong (all four options rejected on Unit 101, caught in
    sandbox). Mirrors answerKeyToIndex in isaps-import.rules.js.
    """
    if not cell:
        return None
    parts = [p.strip() for p in str(cell).split(",") if p.strip()]
    out = []
    for p in parts:
        if p.isdigit():
            if int(p) <= 0:
                return None
            out.append(str(int(p)))
            continue
        m = re.search(r"\b([A-Z])\b", p.upper())
        if not m:
            return None
        out.append(str(ord(m.group(1)) - 64))
    return ",".join(out) if out else None


def split_options(text):
    """Item Details holds the stem and 'A. .. B. .. C. .. D. ..' inline."""
    parts = re.split(r"\b([A-D])[\.\)]\s+", text)
    if len(parts) < 3:
        return text.strip(), []
    stem = parts[0].strip()
    opts = []
    for i in range(1, len(parts) - 1, 2):
        opts.append({"label": parts[i], "text": parts[i + 1].strip()})
    return stem, opts


def header_map(rows):
    """Locate columns by HEADER, not by position.

    The formative sheets are 6 columns
      Q No. | Place After Unit | Type | Item Details | Max Score | Key
    and the summative sheets are 7, with an extra Title
      Q No. | Scene No. | Title | Type | Item Details | Max Score | Key

    Reading by fixed index therefore pulled `Type` as the item text and
    `Max Score` as the answer key on every summative sheet — 64 of 68 items
    silently dropped for "no answer key". Positional reads are the bug; this
    maps whatever the sheet actually declares.
    """
    for r in rows[:6]:
        low = [(c or "").strip().lower() for c in r]
        if any(c.startswith("q no") for c in low):
            idx = {}
            for j, c in enumerate(low):
                if c.startswith("q no"):
                    idx["qno"] = j
                # "Place After Unit" (most sheets) vs "Placed After Unit" (M6).
                elif "after unit" in c or c.startswith("scene"):
                    idx["unit"] = j
                elif c == "type" or c.startswith("type ("):
                    idx["type"] = j
                elif "item details" in c:
                    idx["text"] = j
                elif c.startswith("key"):
                    idx["key"] = j
                elif "max score" in c:
                    idx["max"] = j
            return idx
    return {}


def module_dir(n):
    return next(d for d in os.listdir(CONTENT) if d.startswith(f"Module {n} "))


def slug(s):
    s = re.sub(r"\.[A-Za-z0-9]+$", "", s).replace("&", "and")
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()
    return re.sub(r"-+", "-", s)


def collect():
    """Build the whole intended shape in memory, then report it."""
    plan = {"modules": [], "formative": [], "mcq": [], "warnings": []}
    for n, title, ctype in MODULES:
        d = module_dir(n)
        vids = sorted(
            f for f in os.listdir(os.path.join(CONTENT, d))
            if re.match(r"^Unit \d{3}\.mp4$", f)
        ) or sorted(
            f for sub in os.listdir(os.path.join(CONTENT, d))
            if os.path.isdir(os.path.join(CONTENT, d, sub))
            for f in os.listdir(os.path.join(CONTENT, d, sub))
            if re.match(r"^Unit \d{3}\.mp4$", f)
        )
        units = []
        for v in vids:
            code = int(re.match(r"^Unit (\d{3})\.mp4$", v).group(1))
            units.append({
                "code": code,
                "title": f"Unit {code}",
                "video_url": f"{R2_BASE}/{R2_PREFIX}/module-{n}/{slug(v)}.mp4",
            })
        plan["modules"].append({"no": n, "title": title, "course_type": ctype, "units": units})

        # formative
        fp = os.path.join(CONTENT, d, next(f for f in os.listdir(os.path.join(CONTENT, d)) if "Formative" in f))
        frows = _cells(fp)
        fh = header_map(frows)
        for r in frows:
            if not re.match(r"^\d+\.\d", (r[0] if r else "") or ""):
                continue
            cell = lambda k: (r[fh[k]] if k in fh and fh[k] < len(r) else "")
            unit = parse_unit_ref(cell("unit"), n)
            typ = (cell("type") or "").upper()
            stem, opts = split_options(cell("text") or "")
            key = parse_key(cell("key"))
            known = {u["code"] for u in units}
            if unit not in known:
                plan["warnings"].append(f"M{n} formative item '{(r[0] or '')}' -> unit {unit} has NO video (bd-60114)")
            if "CRQ" in typ:
                plan["warnings"].append(f"M{n} formative item '{(r[0] or '')}' is typed CRQ in a formative sheet — skipped")
                continue
            if not key:
                plan["warnings"].append(f"M{n} formative item '{(r[0] or '')}' has no answer key — skipped")
                continue
            plan["formative"].append({"module": n, "unit": unit, "stem": stem,
                                      "options": opts, "key": key})
        # summative mcq
        sp = os.path.join(CONTENT, d, next(f for f in os.listdir(os.path.join(CONTENT, d)) if "Summative MCQ" in f))
        srows = _cells(sp)
        sh = header_map(srows)
        for r in srows:
            if not re.match(r"^\d+\.\d", (r[0] if r else "") or ""):
                continue
            cell = lambda k: (r[sh[k]] if k in sh and sh[k] < len(r) else "")
            text = cell("text") or ""
            key = parse_key(cell("key"))
            # Some rows are short by one cell (an empty Title/Type left unwritten
            # by the author), which slides every later column left. Detect it by
            # the shape of the data rather than trusting the index: the item text
            # is the longest cell in the row, and the key is the last A-D cell.
            if not key or len(text) < 25:
                longest = max(r, key=lambda c: len(c or ""), default="")
                if len(longest) > len(text):
                    text = longest
                if not key:
                    for c in reversed(r):
                        k2 = parse_key(c)
                        if k2 and len(str(c).strip()) <= 2:
                            key = k2
                            break
            stem, opts = split_options(text)
            if not key:
                plan["warnings"].append(f"M{n} summative item '{(r[0] or '')}' has no answer key — skipped")
                continue
            plan["mcq"].append({"module": n, "stem": stem, "options": opts, "key": key})
    return plan


def main():
    write = "--yes-write" in sys.argv
    plan = collect()
    nmod = sum(len(m["units"]) for m in plan["modules"])
    print("=" * 66)
    print("I-SAPS Level 1 seed plan  (target: SANDBOX %s)" % EXPECTED_REF)
    print("=" * 66)
    print(f"  vendor            : 1   (ISAPS)")
    print(f"  level             : 1   (Level 1: Novice)")
    print(f"  courses           : {len(plan['modules'])}")
    print(f"  modules (units)   : {nmod}")
    print(f"  formative items   : {len(plan['formative'])}")
    print(f"  summative MCQs    : {len(plan['mcq'])}")
    print(f"  CRQs              : 0   (separate capstone pass)")
    print(f"\n  warnings          : {len(plan['warnings'])}")
    for w in plan["warnings"]:
        print(f"     ! {w}")
    if not write:
        print("\nDRY RUN — nothing written. Re-run with --yes-write.")
        return

    # ---- vendor (idempotent on key) ----
    existing = get("training_vendors", "select=id,key&key=eq.ISAPS")
    if existing:
        vid = existing[0]["id"]
        print(f"\nvendor ISAPS exists: {vid}")
    else:
        v = insert("training_vendors", [{
            "key": "ISAPS", "name": "I-SAPS",
            # Component bars live in isaps-grading.rules (25/50/25 @ 50/60/50).
            # These two columns are the model's generic gates; passing_pct is set
            # to the MCQ bar because the level exam IS the summative MCQ set, and
            # module_passing_pct to the formative bar. The composite grader is
            # what actually decides the level.
            "passing_pct": 60, "module_passing_pct": 50,
            "module_quiz_strategy": "all", "has_grand_quiz": True,
            "has_diagnostic": False, "cert_code_prefix": "ISAPS",
            "unlock_logic": "all_modules", "level_unlock_logic": "chain",
            "module_unlock_logic": "chain", "is_active": True,
        }])
        vid = v[0]["id"]
        print(f"\nvendor ISAPS created: {vid}")

    # ---- level ----
    lv = get("training_levels", f"select=id,name&vendor_id=eq.{vid}&order=order_index")
    if lv:
        lid = lv[0]["id"]
        print(f"level exists: {lid} {lv[0]['name']}")
    else:
        l = insert("training_levels", [{
            "vendor_id": vid, "name": "Level 1: Novice",
            "order_index": 0, "cpd_level": 1, "is_active": True,
        }])
        lid = l[0]["id"]
        print(f"level created: {lid}")

    # ---- courses + modules ----
    code_to_mod = {}
    for m in plan["modules"]:
        title = f"Module {m['no']} - {m['title']}"
        c = get("training_courses", f"select=id,title&level_id=eq.{lid}&title=eq.{urllib.parse.quote(title)}")
        if c:
            cid = c[0]["id"]
        else:
            cid = insert("training_courses", [{
                "level_id": lid, "title": title, "course_type": m["course_type"],
                "order_index": m["no"], "is_active": True,
            }])[0]["id"]
        for i, u in enumerate(m["units"], 1):
            ex = get("training_modules", f"select=id,title&course_id=eq.{cid}&title=eq.{urllib.parse.quote(u['title'])}")
            if ex:
                code_to_mod[u["code"]] = ex[0]["id"]
                continue
            row = insert("training_modules", [{
                "course_id": cid, "title": u["title"], "video_url": u["video_url"],
                "source_media_url": u["video_url"], "order_index": i, "is_active": True,
            }])[0]
            code_to_mod[u["code"]] = row["id"]
        print(f"  course M{m['no']}: {len(m['units'])} modules")

    # ---- grand quiz for the summative MCQ set ----
    gq = get("training_grand_quizzes", f"select=id&level_id=eq.{lid}&quiz_type=eq.grand_quiz")
    gqid = gq[0]["id"] if gq else insert("training_grand_quizzes", [{
        "level_id": lid, "quiz_type": "grand_quiz", "is_active": True,
    }])[0]["id"]
    print(f"  grand quiz: {gqid}")

    # ---- questions ----
    def opts_json(o):
        return [x["text"] for x in o] if o else []

    fcount = 0
    for i, q in enumerate(plan["formative"], 1):
        mid = code_to_mod.get(q["unit"])
        if not mid:
            continue  # bd-60114: no video => no module row to attach to
        ex = get("training_questions",
                 f"select=id&training_module_id=eq.{mid}&question_text=eq.{urllib.parse.quote(q['stem'][:120])}")
        if ex:
            continue
        insert("training_questions", [{
            "training_module_id": mid, "question_text": q["stem"],
            "options": opts_json(q["options"]), "correct_option": q["key"],
            "order_index": i, "is_active": True,
        }])
        fcount += 1
    print(f"  formative questions inserted: {fcount}")

    mcount = 0
    for i, q in enumerate(plan["mcq"], 1):
        ex = get("training_questions",
                 f"select=id&grand_quiz_id=eq.{gqid}&question_text=eq.{urllib.parse.quote(q['stem'][:120])}")
        if ex:
            continue
        insert("training_questions", [{
            "grand_quiz_id": gqid, "question_text": q["stem"],
            "options": opts_json(q["options"]), "correct_option": q["key"],
            "order_index": i, "is_active": True,
        }])
        mcount += 1
    print(f"  summative questions inserted: {mcount}")
    print("\nDONE.")


if __name__ == "__main__":
    main()
