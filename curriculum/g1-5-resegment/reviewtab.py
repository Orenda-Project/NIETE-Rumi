"""The two tabs a human writes in: Samples Review and QA Checklist.

Both are built empty on purpose. The build fills the left-hand columns — what to look at and where
to look — and leaves the right-hand columns blank for a reviewer, with a dropdown on the verdict so
the vocabulary stays fixed. Nothing here is scored, inferred or pre-filled: a blank cell on these
tabs means nobody has looked yet, which is the one thing a status board must never guess.

Samples Review follows the old workbook's `v9 Samples Review`: one row per thing reviewed, then
Reviewer · Verdict · Comments · Evidence. Its rows are the five standing questions from this pass
plus one row per subject tab. QA Checklist reproduces Part A of the master QA checklist only — the
six chapter-breakdown items, verbatim. Part B (the lesson plan) and Part C (the voice note) are not
reproduced: nothing has been generated yet for them to check, and the scoring matrix, the FICO form
and the training tabs are a different workbook's business.

`_entries` parses `label :: text` blocks; an indented line continues the entry above it.
"""
import datetime

BEAD = "bd-6a20p"
STAMP = datetime.date.today().isoformat()
HAND = ["Reviewer", "Verdict", "Comments", "Evidence"]
VERDICTS = ["pass", "revise", "reject"]
PRESENT = ["yes", "no", "n/a"]


def _entries(block):
    """`label :: text`; an indented line continues the entry above, so `::` may fall anywhere."""
    out = []
    for raw in block.strip("\n").split("\n"):
        if not raw.strip():
            continue
        if raw[0].isspace() and out:
            out[-1] += " " + raw.strip()
        else:
            out.append(raw.strip())
    return [tuple(part.strip() for part in e.split("::", 1)) for e in out]


# The five standing questions of this pass, and where each one is answered.
ASKS = _entries("""
Filter each subject tab's Flags column. Days marked 'no owned SLO' are merge or split candidates. ::
    Any subject tab › the Flags column › filter to non-empty.
Days marked 'stapled topic' teach two things in 40 minutes. Confirm the split. :: Any subject tab ›
    Flags = stapled topic.
Maths days flagged 'CPA disagreement in source': the skill-type label and the old cpa_phase field
    disagree. Say which is right — we did not pick for you. :: Maths G1–5 › Flags = CPA disagreement
    in source.
Check the chapter banners read the way the textbook reads. :: Every subject tab › the chapter bands,
    against the book's own contents page.
Maths: the Skill Taxonomy tab's CPA ramp shows Concrete emptying out by Grade 4. Confirm whether
    that is the book or our segmentation before the rebuild pass. :: Skill Taxonomy › Maths rows ›
    the Concrete row, read down the grades.
""")

SUBJECTS = _entries("""
English G1–5 :: Boundaries were rebuilt from page truth this pass. Do the day splits match how the
    book teaches the chapter?
Urdu G1–5 :: Boundaries were kept, not rebuilt. Its جائزہ / دہرائی days sit on ordinary `Day N`
    rows, so a strict day count reads 12–18 days busier per grade. Is that still the right shape?
Maths G1–5 :: The Skill type column is the CPA ramp. Does the ramp climb the way the chapter does?
Science G4–5 :: 5E-coded, General Science only. Does each chapter get a full 5E cycle?
""")

VERDICT_KEY = _entries("""
pass :: The segmentation is right. It can go to the next stage as it stands.
revise :: Right in shape, wrong in detail. Say which rows in Comments — grade, chapter and Day #,
    never a row number, because the workbook is rebuilt on every run and rows move.
reject :: Wrong enough that the chapter needs re-splitting before anything is generated from it.
""")

# Part A of the master QA checklist, verbatim from the old workbook. The stale
# `Teaching_Calendar_2026-27.xlsx` reference on item 1 now points at this workbook's own tab.
QA_A = [
    "Chapter has been divided into the correct number of lessons as per the teaching calendar (not"
    " an arbitrary split)",
    "Total lesson count for this chapter matches the days/weeks allotted to it in the calendar",
    "Content is spread evenly across lessons (no single lesson overloaded, no lesson too thin)",
    "Each generated lesson is mapped to its correct Day/Week number from the calendar",
    "No topic or textbook page is skipped or duplicated across the lesson set",
    "Order of lessons follows the calendar's sequence (not the book's page order if they differ)",
]


def _height(text, px, font=10, floor=24):
    """Pixel height for one wrapped cell. Never leave a wrapped row at the 21px default."""
    if not text:
        return floor
    per_line = max(8, int((px - 10) / (font * 0.56) * 0.92))
    lines = sum(max(1, -(-len(part) // per_line)) for part in str(text).split("\n"))
    return max(floor, lines * (font + 5) + 8)


def _shell(title, subtitle, header, widths, entry_cols, dropdown):
    """Rows 0-2 (title · subtitle · headers) and the plan every review tab shares."""
    n = len(header)
    plan = {"n_cols": n, "freeze": 3, "widths": dict(widths), "sections": [], "entry_rows": [],
            "entry_cols": entry_cols, "dropdown": dropdown, "merges": [0, 1],
            "heights": {0: 42, 1: _height(subtitle, sum(widths.values())), 2: 30}}
    rows = [[title] + [""] * (n - 1), [subtitle] + [""] * (n - 1), list(header)]
    return rows, plan


def _finish(rows, plan):
    """Footer band, then an explicit pixel height for every row — the 21px clip fix."""
    plan["footer"] = len(rows)
    plan["heights"][len(rows)] = 30
    rows.append([f"Built {STAMP}  ·  bead {BEAD}  ·  blank means nobody has looked yet, not zero"]
                + [""] * (plan["n_cols"] - 1))
    for r, row in enumerate(rows):
        plan["heights"].setdefault(
            r, max(_height(row[c], plan["widths"][c]) for c in range(plan["n_cols"])))
    return rows, plan


def samples_review():
    """One row per thing to review; Reviewer · Verdict · Comments · Evidence left blank."""
    header = ["#", "What you are checking", "Where to look"] + HAND
    rows, plan = _shell(
        "SAMPLES REVIEW  ·  GRADES 1–5  ·  YOUR VERDICT GOES HERE",
        "One row per thing to review. The build fills the first three columns; the last four are"
        " yours and are deliberately empty. Verdict is a dropdown — pass · revise · reject — but it"
        " is not locked, so you can type something else and explain it in Comments. Quote grade,"
        " chapter and Day # in Comments, never a row number: the workbook is rebuilt on every run"
        " and rows move.",
        header, {0: 40, 1: 380, 2: 250, 3: 110, 4: 96, 5: 300, 6: 200}, (3, 7),
        (4, VERDICTS))

    def block(band, entries, numbered=True, hand=True):
        plan["sections"].append(len(rows))
        plan["heights"][len(rows)] = 30
        rows.append([band] + [""] * (plan["n_cols"] - 1))
        start = len(rows)
        for i, (what, where) in enumerate(entries, 1):
            rows.append([str(i) if numbered else "", what, where] + [""] * 4)
        if hand:
            plan["entry_rows"].append((start, len(rows)))

    block("A · THE FIVE STANDING QUESTIONS OF THIS PASS — ANSWER THESE FIRST", ASKS)
    block("B · ONE ROW PER SUBJECT TAB — DID THE SEGMENTATION LAND?", SUBJECTS)
    block("C · WHAT A VERDICT MEANS — NOT FOR WRITING IN", VERDICT_KEY, numbered=False, hand=False)
    return _finish(rows, plan)


def qa_checklist():
    """Part A of the master QA checklist: the six chapter-breakdown items, verbatim."""
    header = ["#", "Checklist Item", "Present?", "Notes"]
    rows, plan = _shell(
        "QA CHECKLIST  ·  PART A — CHAPTER BREAKDOWN (TEACHING CALENDAR ALIGNMENT)",
        "Check this before any lesson is generated — it confirms the chapter was split correctly"
        " first. Every breakdown must be checked against this workbook's own Teaching Calendar tab,"
        " not an assumed or estimated split. Part B (the lesson plan) and Part C (the voice note)"
        " are not reproduced here: nothing has been generated yet for them to check. Present? and"
        " Notes are yours and are deliberately empty.",
        header, {0: 40, 1: 680, 2: 100, 3: 320}, (2, 4), (2, PRESENT))
    plan["sections"].append(len(rows))
    plan["heights"][len(rows)] = 30
    rows.append(["1 · 📅 TEACHING CALENDAR ALIGNMENT", "", "", ""])
    start = len(rows)
    for i, item in enumerate(QA_A, 1):
        rows.append([str(i), item, "", ""])
    plan["entry_rows"].append((start, len(rows)))
    return _finish(rows, plan)


# ---------------------------------------------------------------------------------- formatting

def _dim(sid, axis, start, end, px):
    return {"updateDimensionProperties": {
        "range": {"sheetId": sid, "dimension": axis, "startIndex": start, "endIndex": end},
        "properties": {"pixelSize": px}, "fields": "pixelSize"}}


def _fill(rng, sid, r0, r1, c0, c1, bg, size=10, white=False, bold=False,
          wrap="OVERFLOW_CELL", valign="MIDDLE"):
    txt = {"bold": bold, "fontSize": size}
    if white:
        txt["foregroundColor"] = {"red": 1, "green": 1, "blue": 1}
    return {"repeatCell": {"range": rng(sid, r0, r1, c0, c1), "cell": {"userEnteredFormat": {
        "backgroundColor": bg, "wrapStrategy": wrap, "verticalAlignment": valign,
        "textFormat": txt}}, "fields": "userEnteredFormat(backgroundColor,wrapStrategy,"
                                       "verticalAlignment,textFormat)"}}


def _heights(sid, heights):
    """One updateDimensionProperties per run of equal, contiguous heights."""
    out, items, i = [], sorted(heights.items()), 0
    while i < len(items):
        j = i
        while j + 1 < len(items) and items[j + 1] == (items[j][0] + 1, items[i][1]):
            j += 1
        out.append(_dim(sid, "ROWS", items[i][0], items[j][0] + 1, items[i][1]))
        i = j + 1
    return out


def _validation(rng, sid, r0, r1, col, values):
    """A dropdown, not a lock: strict is False so a reviewer can type a case we did not list."""
    return {"setDataValidation": {
        "range": rng(sid, r0, r1, col, col + 1),
        "rule": {"condition": {"type": "ONE_OF_LIST",
                               "values": [{"userEnteredValue": v} for v in values]},
                 "inputMessage": "Pick one, or type your own and explain it in the next column.",
                 "strict": False, "showCustomUi": True}}}


def format_review(svc, sheetio, sid, rows, plan):
    """Shared by Samples Review and QA Checklist — both are the same shape underneath."""
    rng, ink = sheetio._rng, sheetio.INK
    n, nrows, foot = plan["n_cols"], len(rows), plan["footer"]
    c0, c1 = plan["entry_cols"]
    dcol, dvals = plan["dropdown"]
    reqs = [
        {"unmergeCells": {"range": rng(sid, 0, nrows, 0, n)}},
        {"updateSheetProperties": {
            "properties": {"sheetId": sid, "gridProperties": {
                "frozenRowCount": plan["freeze"], "frozenColumnCount": 0}},
            "fields": "gridProperties(frozenRowCount,frozenColumnCount)"}},
        _fill(rng, sid, 0, nrows, 0, n, ink["white"], wrap="WRAP", valign="TOP"),
        _fill(rng, sid, 0, 1, 0, n, ink["title"], 14, white=True, bold=True),
        _fill(rng, sid, 1, 2, 0, n, ink["cream"], wrap="WRAP"),
        _fill(rng, sid, 2, 3, 0, n, ink["head"], white=True, bold=True),
        _fill(rng, sid, foot, foot + 1, 0, n, ink["head"], white=True),
    ]
    reqs += [_fill(rng, sid, r, r + 1, 0, n, ink["band"], 12, white=True, bold=True)
             for r in plan["sections"]]
    # The hand-entry block stays white and gets a border ring instead of a background colour, so
    # Navigation's colour legend still accounts for every background in the workbook.
    for r0, r1 in plan["entry_rows"]:
        reqs.append(_fill(rng, sid, r0, r1, 0, 1, ink["cream"], bold=True))
        reqs.append({"updateBorders": {
            "range": rng(sid, r0, r1, c0, c1),
            "innerHorizontal": {"style": "SOLID", "color": ink["rule"]},
            "innerVertical": {"style": "SOLID", "color": ink["rule"]},
            "top": {"style": "SOLID_MEDIUM", "color": ink["rule"]},
            "bottom": {"style": "SOLID_MEDIUM", "color": ink["rule"]},
            "left": {"style": "SOLID_MEDIUM", "color": ink["rule"]},
            "right": {"style": "SOLID_MEDIUM", "color": ink["rule"]}}})
        reqs.append(_validation(rng, sid, r0, r1, dcol, dvals))
    reqs += [_dim(sid, "COLUMNS", c, c + 1, px) for c, px in plan["widths"].items()]
    reqs += _heights(sid, plan["heights"])
    # Full-width merges are legal here only because these tabs freeze no columns.
    reqs += [{"mergeCells": {"range": rng(sid, r, r + 1, 0, n), "mergeType": "MERGE_ALL"}}
             for r in plan["merges"]]
    for i in range(0, len(reqs), 200):
        svc.spreadsheets().batchUpdate(spreadsheetId=sheetio.SHEET_ID,
                                       body={"requests": reqs[i:i + 200]}).execute()
