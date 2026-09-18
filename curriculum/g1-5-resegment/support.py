"""Support tabs: Navigation, Skill Taxonomy, Pipeline Stages, All Segments + SLOs."""
from collections import defaultdict

import skills
import tabs
from fdetab import book_label

SHEET_URL = "https://docs.google.com/spreadsheets/d/14-ndk94fkTbqKn0MW4QPhMgLGTesswVj-_GTwe4GYio"

# Subject · Skill type · Grades · CPA phase · What the day is · Source.
# Named because build.py quotes the width twice — to `format_grid` and to the
# navigation index — and a header that grows without both of them growing
# writes data past the formatting.
TAX_COLS = 6

PENDING_TABS = [
    ("Communicative Balance", "English + Urdu: periods tagged Speaking/Listening vs periods whose Interaction is actually pair/group.", "after Interaction + Gap are filled (stage C)"),
    ("Video library", "Taleemabad library with SLO mapping and a 'why it maps here' column.", "next pass"),
    ("Chapter Hearts", "Chapter-level voicenote scripts, audio links, review status.", "stage E"),
    ("Games — {Subject}", "Two SLO-anchored questions per day.", "when that workstream starts"),
]

STAGES = [
    ("A", "Page truth", "Textbook PDFs (17 books, OCR complete)", "Per-page JSON: text, exercises, learning outcomes", "done", "4,288 pages in textbook_pages; all 17 in-scope books OCR-complete"),
    ("B", "Segmentation", "Page truth", "One row per teaching day, this sheet", "this pass", "One SLO owned per day; printed pages made disjoint; nothing deleted"),
    ("B2", "Enrichment inputs", "FDE breakdown, video library, curriculum functions", "FDE marker, Video, Function, Recycles, Prerequisite SLOs", "pending", "Columns exist and read `pending` rather than a proxy"),
    ("C", "Enrichment", "Segment row + page truth", "10–15 moves, reading strategy, collaboration structure, Interaction, Gap", "pending", "Moves 10–15; ≤10 of 40 minutes teacher-primary"),
    ("C-gate", "Enrich gate", "Enriched segment", "Pass/fail against the LP-format spec", "pending", "Over cap fails; it never trims"),
    ("D0", "Slide script", "Enriched segment", "Per-page script", "pending", ""),
    ("D", "Render", "Slide script", "lp_doc JSON (artefact of record) + PDF cache", "pending", "Teach 2 pages, 4 pages total cap"),
    ("E", "Voicenote", "lp_doc", "45–90 s segment note; 90–150 s chapter heart", "pending", "Holds the moves of the LP; the heart stays"),
    ("J", "Review", "lp_doc + render", "Pedagogy review, design review", "pending", "A human can overrule the machine verdict, visibly"),
    ("F", "Deliver", "Reviewed LP", "PDF + voice note to the teacher", "pending", "No delivery message in primary — the voice note goes instead"),
]

def skill_taxonomy(all_rows, cpa_conflicts=0):
    """One vocabulary per subject, in teaching order, with its chip colour.

    Definitions, not a tally. There was a `Days` column here; it restated the
    Coverage Map's counts added up across the grades, and a second copy of a
    number is a second number to go stale. The Coverage Map counts the build
    that exists — per grade, per chapter — and this tab says what the words
    mean, which is what reviewers and LP writers need to share.

    `all_rows` is still read, for two things that are not counts: which grades
    teach the skill, and which of the vocabulary this corpus actually uses. A
    skill type no day carries is left off rather than defined into existence.

    CPA lives here, in its own column, rather than in a second column on every
    Maths row: for Maths the skill type IS the CPA phase, so the subject tab
    carries one chip and this tab says what that chip means in CPA terms.
    """
    used, grades = defaultdict(set), defaultdict(set)
    for r in all_rows:
        if not r["skill_type"]:
            continue
        used[r["subject"]].add(r["skill_type"])
        grades[(r["subject"], r["skill_type"])].add(r["grade"])
    out = [["Subject", "Skill type", "Grades", "CPA phase",
            "What the day is", "Source"]]
    for subject in ("English", "Urdu", "Maths", "Science"):
        keys = list(skills.ORDER[subject])
        keys += [skills.KEY_BY_LABEL.get(lb, lb) for lb in used[subject]
                 if skills.KEY_BY_LABEL.get(lb, lb) not in keys]
        seen = set()
        for key in keys:
            lb = skills.label(key)
            if lb not in used[subject] or lb in seen:
                continue
            seen.add(lb)
            g = ", ".join(str(x) for x in sorted(grades[(subject, lb)]))
            # The phase is a taxonomy key, and printing a key would put a
            # lowercase `abstract` beside `Pictorial → Abstract` in the
            # column before it. Three phases, five skill types: the bridge
            # and the word problem both land in abstract, which is the whole
            # reason the column is worth its width.
            cpa = skills.CPA_FROM_SKILL.get(key, "") if subject == "Maths" else ""
            out.append([subject, lb, g, skills.label(cpa),
                        skills.gloss(key) or tabs.PENDING,
                        "defined here — the build's skill-type vocabulary; "
                        "grades as segmented"])
    out += cpa_pointer()
    if cpa_conflicts:
        # The count sits in the sentence now. It is a tally, not a definition,
        # so it has no column to sit in on this tab — and it is the one number
        # here that nothing else in the workbook reports.
        out += [[""] * TAX_COLS,
                ["DATA QUALITY"] + [""] * (TAX_COLS - 1),
                ["Maths", "skill type vs cpa_phase", "1–5", "",
                 f"{cpa_conflicts} days. The segmentation corpus carried two "
                 "fields for the same thing and they disagreed on them. Skill "
                 "type is now the single column and the authority, so the "
                 "disagreement no longer shows on the subject tab — it is "
                 "reported here instead. The B2 boundary rebuild resolves "
                 "them against the page text.",
                 "counted while building the rows"]]
    return out


def cpa_pointer():
    """Where the CPA ramp is measured, and the one reading that matters.

    This block used to be a second table under the same column grid — a
    grade-by-phase count of the Maths chips — which made the tab two tables
    wide apart and forced one set of widths to serve both. The Coverage Map
    counts the phases per grade and the Skills Map draws them against the year,
    so what is left here is the pointer and the reading, one row each.

    It kept the counts in its prose for a while, which was the same mistake in
    a shape the eye skips: by the time anyone read the sentence the build said
    Concrete 36 / 15 / 15 / 11 / 33 and Abstract 11 / 7 / 3 / 16 / 3, and the
    sentence still said Concrete 36 / 6 / 1 / 0 / 33 and Abstract nowhere at
    all. A stale number in prose is read as a finding, not as a cache.
    """
    return [[""] * TAX_COLS,
            ["READ THIS"] + [""] * (TAX_COLS - 1),
            ["Maths", "the CPA ramp", "1\u20135", "",
             "Reading down a phase is the point: if Concrete empties out while "
             "the grade level rises, children are being handed symbols they "
             "never held. The days are counted per grade on the COVERAGE MAP "
             "tab and drawn against the year on the SKILLS MAP tab; this tab "
             "does not restate them, because a phase count kept in two places "
             "is a phase count that disagrees with itself. Where the ramp "
             "thins, that is a boundary decision for the rebuild pass to "
             "settle against the page text, not a labelling error.",
             "measured on the Coverage Map and the Skills Map"]]


def pipeline_tab():
    """The stages, then the tabs that are deliberately not built yet.

    PENDING_TABS used to be printed nowhere. A design-pending tab that appears
    on no tab is indistinguishable from one nobody thought of, which is the one
    way "dark stages stay dark" can fail: silently. They are labelled, never
    given a stage code, and each says when it gets built and what it waits on.
    """
    out = [["Stage", "Name", "Input", "Output", "Status", "Key decisions"]]
    out += [list(s) for s in STAGES]
    out.append([""] * 6)
    out.append(["TABS NOT BUILT YET", "Proposed, and not built on purpose. "
                "Nothing in this workbook reads as if these existed.",
                "", "", "", ""])
    for name, holds, when in PENDING_TABS:
        out.append(["", name, "", holds, "not built", f"built {when}"])
    return out


def all_segments(all_rows):
    head = ["Grade", "Subject", "Book", "Chapter", "Chapter title", "Row type",
            "Day #", "Topic", "Skill type", "Pages (printed)",
            "SLO — owned", "SLO description — owned", "Supporting SLOs",
            "Bloom's", "Flags"]
    out = [head]
    for r in all_rows:
        # The book stem (`grade_1_english`) has no spaces, so a WRAP column
        # breaks it mid-word; it is written the way every other tab writes a
        # book, and the grade and chapter numbers are written as text so the
        # sheet stops right-aligning them into the title beside them.
        out.append([f"G{r['grade']}", r["subject"], book_label(r["book"]),
                    f"Ch. {r['chapter']}" if r["chapter"] is not None else "",
                    r["chapter_title"], r["kind"],
                    # A review or assessment row gets the subject tabs' marker,
                    # not the caption the corpus happened to carry. Three
                    # spellings reached this column — `Chapter Review`, `Review
                    # Day` and `Day 8 (Review)` — and the third one matched the
                    # `^Day \d+` a counting script uses, so the flat tab
                    # reported 1,695 teaching days against the 1,657 its own
                    # `Row type` column knew about.
                    r["day_label"] if r["kind"] == "day"
                    else tabs.tail_label(r["kind"]),
                    r["topic"],
                    r["skill_type"], r["pages"],
                    r["primary_slo"], r["primary_slo_desc"], r["supporting_slos"],
                    r["blooms"], r["flags"]])
    return out
