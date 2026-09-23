"""The Navigation tab — an index for someone opening this workbook for the first time.

What it replaces was a changelog wearing an index's clothes: it told a returning participant what
changed in this pass and never told a new reader how to read one row. The order here is a reader's
order — the tabs, how a subject tab is read, what each colour means, what a blank means, how to
move around, where the words come from; "what changed" now lives in the commit log. Row heights are
computed from the longest wrapped string, links are #1155CC beside a literal "open ↗", and prose
lives in `::` blocks — an indented line continues the entry above, a `§` line starts a section band.
"""
import datetime


BEAD = "bd-6a20p"
N_COLS = 7
WIDTHS = {0: 22, 1: 200, 2: 560, 3: 76, 4: 62, 5: 132, 6: 90}  # A = colour rail, C = prose
HEADER = ["", "Tab", "What it holds", "Rows", "Cols", "Status", "Open"]
TITLE = "REWORKED ICT CURRICULUM MATRIX  ·  GRADES 1–5  ·  INDEX"
SUBTITLE = (
    "Start here. One row on a subject tab = one teaching day = one segment = one lesson plan; there"
    " is no other unit in this workbook. Below the index: how to read a subject tab, what every"
    " colour means, what a blank cell means, and how to search and filter without disturbing anyone"
    " else's view.")
TABS_BAND = "1 · TABS — WHAT IS IN THIS WORKBOOK, IN ORDER"
STATUS = {"Navigation": "you are here", "Samples Review": "built · empty, for you",
          "QA Checklist": "built · empty, for you"}


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


TABS = _entries("""
Navigation :: You are here. The index, the colour legend, and how to read every other tab.
Teaching Calendar :: The year sideways: periods a week, the month view, a week-by-week band showing
    which chapter each grade is in. The red line is 24 December.
Calendar — assumptions :: What the year assumes, ours and FDE's: the period rate, where FDE's own
    documents disagree, the month view, and FDE's weeks per chapter against our periods.
English G1–5 :: One row per teaching day: grade band, chapter band, days. Rebuilt from page truth.
Urdu G1–5 :: Same row grammar. Boundaries kept; only the day-integrity fields were repaired.
Maths G1–5 :: Same row grammar; the Skill type column IS the CPA ramp, so one chip carries both.
Science G4–5 :: General Science only, 5E-coded. Grades 1–3 General Knowledge is out of scope here.
Coverage Map :: The skill mix per grade, and every chapter against every skill type as a heat grid.
Coverage — gaps :: Chapters too thin for their SLO load; every SLO checked for an introducing day.
FLN Coverage :: Literacy and numeracy by strand and month, counted off the Teaching Calendar itself.
Skills Map :: Every skill type against every grade: who meets it, where, where it never appears.
Move Spines :: The twenty-two 40-minute move spines. Every day row's Moves cell links here instead of restating one.
SLO Sentences :: Every SLO's wording, once each. The code columns link here. A code with more than one wording gets a row for each and says so.
All Segments + SLOs :: Every row from all four subject tabs, flat and filterable. The tab to SEARCH.
Skill Taxonomy :: Every skill type per subject, defined: chip colour, what the day actually is.
Pipeline Stages :: The build recipe as data: the stage that fills any `pending` column, then the tabs not built yet.
Samples Review :: Where you write your verdict — five standing questions plus a row per subject.
QA Checklist :: Part A of the master QA checklist — was the chapter split right before any lesson.
""")

BODY = _entries("""
§ :: 2 · HOW TO READ A SUBJECT TAB
One row = one day :: One row is one teaching day, which is one segment, which is one lesson plan.
    Forty minutes, one primary SLO, one row. The rest of the tab is scaffolding around that.
GRADE 3 · Chapter 4: … :: Full-width bands. A grade band owns everything below it to the next grade
    band; a chapter band carries the chapter number and the textbook's own title.
Day 7 :: A teaching day: topic, skill-type chip, the printed pages it teaches, its primary SLO, and
    whether that day introduces the SLO or develops one an earlier day introduced.
↻ Spiral Review :: A revision day scheduled inside the chapter — planned into the sequence, not
    swept to the end of the year.
📋 Ch. Review :: The chapter's review day: the class goes back over the chapter before it is checked.
✅ Ch. Assessment :: The chapter's formative check against its own SLOs. It carries no new SLO, so
    its SLO cells are empty rather than reading `pending`.
Urdu counts differently — read this before comparing subjects :: English, Maths and Science put
    review and assessment on their own ↻ / 📋 / ✅ rows. Urdu does not: its جائزہ (assessment) is
    written as an ordinary `Day N` row, because that is how the Urdu books sequence it. So a strict
    count of `Day N` rows makes Urdu look 16–18 days busier per grade than the other three. It is
    not busier. Compare on total rows, or on the Skill type column, never on the day number.
Revision is folded, not rowed :: Every Urdu دہرائی (revision) day and every Grade 1 English and Maths
    revision day is folded into its chapter's last teaching day, which carries the revision's SLOs and
    a `folded in` note; the assessment keeps its period. This pays for Grade 1's Foundations block.
SLO role :: Every SLO has exactly one introducing day; later days on the same code read `develops`,
    so "this SLO was never introduced" is a question you can actually ask. And printed pages are
    never reassigned: where two days both claim a page, both keep it and each names the other.
§ :: 3 · COLOUR LEGEND — EVERY BACKGROUND COLOUR IN THIS WORKBOOK
#0F4C5C :: Deep teal, white text — the title band: the top row of every tab, saying what it is.
#264653 :: Slate, white text — the column headers. Frozen, so they stay put as you scroll.
#E76F51 :: Coral, white text — a section band: here, on Calendar — assumptions, Coverage Map, reviews.
#F4F1DE :: Cream — a label cell: the short label in column B saying what the row beside it is.
#D9E6F5 :: Pale blue — a GRADE band on a subject tab.
#EDF2FA :: Paler blue — a chapter band on a subject tab.
#FFF2E6 :: Warm cream — the Flags column when not empty: a day needing a human decision. Filter it.
#1155CC :: Blue, underlined — a link. Linked rows also carry the words open ↗ in the last column.
#FCE7C8 :: Peach — entry / concrete. Pre-reading · ارکان سازی · Concrete · Engage · Number fluency.
#E7F0FD :: Palest blue — the code itself. Phonics · قواعد.
#C8E6F4 :: Blue — receptive / pictorial. Reading comprehension · بلند خوانی · تفہیم · Pictorial.
#D9E4D6 :: Sage — build / bridge. Vocabulary & grammar · الفاظ و معانی · Pictorial → Abstract.
#EAD7F0 :: Lilac — productive / abstract. Writing · تخلیقی لکھائی · Abstract · Apply & connect.
#F4E1C8 :: Tan — oral / applied. Oral communication · Communicative language · Word problem.
#F4C7C7 :: Pink — revision. Revision · دہرائی · ↻ Spiral Review days.
#FBE3B8 :: Amber — assessment. Assessment · جائزہ · Review & assess · ✅ Ch. Assessment days.
#94C4ED :: Blue, four steps — the Coverage Map heat grid: palest 1 day, darkest 7+; number in cell.
#FCEBEB :: Rose, ringed in red — Coverage Map, zero days: that chapter never teaches that skill
    type. Ringed so it cannot be mistaken for any other zero. The hole is the finding.
Accessibility :: Colour is never the only signal — a chip carries its skill name, a flag its flag
    words, a band its label, a heat cell its number, and every colour above is given as a hex code.
§ :: 4 · WHAT A BLANK CELL MEANS
A blank cell :: A stage that has not run yet. Not missing data, not a zero, not a broken link. Dark
    stages stay dark here: the cell is left empty, the stage that owes it is named, and no proxy
    number is invented to fill it.
`pending` :: The column exists and this stage cannot fill it honestly. Pipeline Stages names the
    stage that will: Moves · Reading strategy · Collaboration structure · Interaction · Gap ·
    Teacher-primary min are stage C; Function · Recycles · Prerequisite SLOs · Video are stage B2.
An empty trace column (A … F) :: That artefact is not published for that day. Stages A (page truth)
    and B (segmentation) have run; C, C-gate, D0, D, E, J and F have not — by design, not oversight.
An empty SLO cell on a 📋 or ✅ row :: Review and assessment rows carry no new SLO. Empty is correct
    there; `pending` would be a lie.
`Omitted by FDE` :: The FDE breakdown skips that chapter. It stays in the plan and says so out loud.
A ringed empty cell on Coverage Map :: Zero days, ringed rather than left to look like any other
    zero, because that absence is the thing you were looking for.
§ :: 5 · MOVING AROUND — THE +, THE FREEZE, FILTERS AND SEARCH
Click the + in the left margin :: The subject tabs hide the columns this pass cannot fill yet inside
    collapsible column groups. Look at the thin grey margin ABOVE the column letters: a small + (or
    −) sits over each group. Click the + and the hidden columns open, the − and they shut. If a tab
    looks like it is missing blocks of data, the data is not missing — the group is closed.
What the freeze does :: Every subject tab freezes the column-header row and the two left-hand
    columns (Day # and Topic), so you keep your place scrolling right through 31–36. Teaching
    Calendar freezes one row and two columns across 206; Calendar — assumptions freezes two rows,
    no columns; this tab freezes its top three — title, subtitle, headers. Off: View › Freeze › No rows.
Filter without disturbing anyone :: Every subject tab ships with a basic filter across its used
    width, and changing that filter changes it for everyone else in the file at that moment,
    mid-scroll. To keep a slice to yourself: Data › Filter views › Create new filter view — yours,
    nameable, and the shared view is untouched. Close it with the X at top right.
Find one SLO code, or one chapter :: Go to All Segments + SLOs — every row from all four subject
    tabs, flat, one row per teaching day. Ctrl/⌘+F there, or filter the `SLO — owned` column. With
    the row in hand, carry its Grade, Subject and Day # back to the subject tab and use the chapter
    bands to land on it. Searching tabs one by one misses rows: an SLO can appear in two subjects.
Never quote a row number :: The workbook is rebuilt on every run and rows move. Quote grade, chapter
    and Day # instead — those survive a rebuild, and a teacher can find them.
§ :: 6 · WHERE THE WORDS COME FROM
SLO codes — read this before quoting one :: SLO codes and descriptions are transcribed per book from
    the NBF/NCP textbooks. They are Taleemabad house codes, not official government identifiers, and
    transcription quality is uneven between books. Where a book names no explicit SLO we wrote
    one and marked it `[DERIVED — …]`. Those words are our inference from the exercise and the page,
    not the book's words: treat every `[DERIVED — …]` line as a proposal to check. The corpus is
    restricted-educational-internal — NBF/FBISE copyright, so page truth and renders stay local.
""")


def _size(stats, title):
    """rows × cols for one tab. A missing or malformed entry is "—", never a crash."""
    rec = (stats or {}).get(title)
    rec = (rec.get("rows"), rec.get("cols")) if isinstance(rec, dict) else rec
    try:
        r, c = rec
    except (TypeError, ValueError):
        return "—", "—"
    return ("—" if r in (None, "") else r), ("—" if c in (None, "") else c)


def _height(text, px, font=10, floor=24):
    """Pixel height for one wrapped cell. The fix for the 21px clip."""
    if not text:
        return floor
    per_line = max(8, int((px - 10) / (font * 0.56) * 0.92))
    lines = sum(max(1, -(-len(part) // per_line)) for part in str(text).split("\n"))
    return max(floor, lines * (font + 5) + 8)


def build(stats=None):
    """stats: {tab title: {"rows": n, "cols": n}} or {title: (rows, cols)}; missing -> "—"."""
    plan = {"n_cols": N_COLS, "freeze": 3, "widths": dict(WIDTHS), "sections": [], "labels": [],
            "tint": [], "links": [], "merges": [0, 1],
            "heights": {0: 42, 1: _height(SUBTITLE, sum(WIDTHS.values())), 2: 30}}
    def _pad(cells):
        return list(cells) + [""] * (N_COLS - len(cells))

    rows = [_pad([TITLE]), _pad([SUBTITLE]), list(HEADER)]

    def band(text):
        plan["heights"][len(rows)] = 30
        plan["sections"].append(len(rows))
        rows.append(_pad([text]))

    def line(label, text, extra=()):
        plan["labels"].append(len(rows))
        rows.append(_pad(["", label, text] + list(extra)))

    band(TABS_BAND)
    for title, note in TABS:
        linked = title != "Navigation"
        if linked:
            plan["links"].append((len(rows), title))
        line(title, note, _size(stats, title)
             + (STATUS.get(title, "built"), "open ↗" if linked else ""))
    for label, text in BODY:
        if label == "§":
            band(text)
            continue
        if label.startswith("#") and len(label) == 7:
            plan["tint"].append((len(rows), label))
        line(label, text)
    plan["footer"] = len(rows)
    plan["heights"][len(rows)] = 30
    rows.append(_pad([f"Navigation rebuilt {datetime.date.today().isoformat()}  ·  bead {BEAD}  ·"
                      f"  one row = one teaching day = one segment = one lesson plan"]))
    for r, row in enumerate(rows):
        plan["heights"].setdefault(r, max(_height(row[c], WIDTHS[c]) for c in range(N_COLS)))
    return rows, plan
