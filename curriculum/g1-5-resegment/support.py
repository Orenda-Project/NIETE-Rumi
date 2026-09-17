"""Support tabs: Navigation, Skill Taxonomy, Pipeline Stages, All Segments + SLOs."""
from collections import Counter, defaultdict

import skills
import tabs
from fdetab import book_label

SHEET_URL = "https://docs.google.com/spreadsheets/d/14-ndk94fkTbqKn0MW4QPhMgLGTesswVj-_GTwe4GYio"

TAB_NOTES = [
    ("Navigation", "You are here. What each tab holds, what is filled, what is pending."),
    ("Teaching Calendar", "The year seen sideways: periods a week, the month view, and a week-by-week band showing which chapter each grade is in. The red line is 24 December."),
    ("English G1–5", "One row per teaching day. Grade banner, chapter banner, then days."),
    ("Urdu G1–5", "Same grammar. Boundaries kept from the existing segmentation; day-integrity fields repaired."),
    ("Maths G1–5", "Same grammar. The Skill type column IS the CPA ramp — Concrete, Pictorial, Pictorial → Abstract, Abstract, Word problem — so one chip carries both."),
    ("Science G4–5", "General Science only. G1–3 General Knowledge is out of scope."),
    ("Coverage Map", "What the year actually teaches: skill-type mix per grade as bars, every chapter against every skill type as a heat grid, the thin chapters named, and whether every SLO gets a day that introduces it."),
    ("All Segments + SLOs", "Flat, filterable dump of every row on the four subject tabs."),
    ("Skill Taxonomy", "Every skill type per subject with day counts, so reviewers and LP writers share a vocabulary."),
    ("Pipeline Stages", "The build recipe as data: stage, input, output, status."),
]

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

    CPA lives here, in its own column, rather than in a second column on every
    Maths row: for Maths the skill type IS the CPA phase, so the subject tab
    carries one chip and this tab says what that chip means in CPA terms.
    """
    counts = defaultdict(Counter)
    grades = defaultdict(set)
    for r in all_rows:
        if not r["skill_type"]:
            continue
        counts[r["subject"]][r["skill_type"]] += 1
        grades[(r["subject"], r["skill_type"])].add(r["grade"])
    out = [["Subject", "Skill type", "Days", "Grades", "CPA phase",
            "What the day is", "Source"]]
    for subject in ("English", "Urdu", "Maths", "Science"):
        keys = list(skills.ORDER[subject])
        keys += [skills.KEY_BY_LABEL.get(lb, lb) for lb in counts[subject]
                 if skills.KEY_BY_LABEL.get(lb, lb) not in keys]
        seen = set()
        for key in keys:
            lb = skills.label(key)
            n = counts[subject].get(lb, 0)
            if not n or lb in seen:
                continue
            seen.add(lb)
            g = ", ".join(str(x) for x in sorted(grades[(subject, lb)]))
            cpa = skills.CPA_FROM_SKILL.get(key, "") if subject == "Maths" else ""
            out.append([subject, lb, n, g, cpa,
                        skills.gloss(key) or tabs.PENDING,
                        "counted from the segmentation corpus"])
    out += cpa_pointer()
    if cpa_conflicts:
        out += [[""] * 7,
                ["DATA QUALITY", "", "", "", "", "", ""],
                ["Maths", "skill type vs cpa_phase", cpa_conflicts, "1–5", "",
                 "The segmentation corpus carried two fields for the same "
                 "thing and they disagreed on these days. Skill type is now "
                 "the single column and the authority, so the disagreement no "
                 "longer shows on the subject tab — it is counted here "
                 "instead. The B2 boundary rebuild resolves them against the "
                 "page text.",
                 "counted while building the rows"]]
    return out


def cpa_pointer():
    """Where the CPA ramp is measured, and the one reading that matters.

    This block used to be a second table under the same column grid — a
    grade-by-phase count of the Maths chips — which made the tab two tables
    wide apart and forced one set of widths to serve both. The Skills Map
    measures the same thing better (per skill, per grade, with a position in
    the year and a track), so what is left here is the pointer and the
    reading, one row each.
    """
    return [[""] * 7,
            ["READ THIS", "", "", "", "", "", ""],
            ["Maths", "the CPA ramp", "", "1\u20135", "",
             "Reading down a phase is the point: if Concrete empties out while "
             "the grade level rises, children are being handed symbols they "
             "never held. Measured on the SKILLS MAP tab, which draws every "
             "skill against the year in all five grades \u2014 Concrete is 36 / "
             "6 / 1 / 0 / 33 days in G1\u2013G5, so it is absent exactly where "
             "multiplication and division are introduced; Abstract is 0 in "
             "every grade, because the corpus stops at the Pictorial \u2192 "
             "Abstract bridge and never names a day where children work in "
             "symbols alone. Both are boundary decisions for the rebuild "
             "pass, not labelling errors.",
             "measured on the Skills Map tab"]]


def pipeline_tab():
    out = [["Stage", "Name", "Input", "Output", "Status", "Key decisions"]]
    out += [list(s) for s in STAGES]
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
                    r["chapter_title"], r["kind"], r["day_label"], r["topic"],
                    r["skill_type"], r["pages"],
                    r["primary_slo"], r["primary_slo_desc"], r["supporting_slos"],
                    r["blooms"], r["flags"]])
    return out
