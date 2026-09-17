"""FLN Coverage tab — the foundational literacy and numeracy the year schedules.

Counted off the Teaching Calendar, and counted off it literally: `periods`
reads the two-letter codes out of the grid rows caltab has already built, the
same cells a teacher reads. Nothing here re-derives an allocation, so the tab
and the calendar cannot disagree. Change the ramp, the Foundations block or a
book's segmentation and this tab moves with it on the next build.

That is the whole point of the rewrite. The tab this replaces made the same
claim in its subtitle and was not counted off anything: Grade 1 April read 20
phonics periods against the calendar's 11, one oral-language period against
16, three writing periods in a month that teaches no writing, and it had no
Number fluency row at all while number fluency was 12 of Grade 1's 23 April
Maths periods — the largest numeracy strand in the Foundations block. No
module wrote it, so it sat outside TAB_ORDER and survived every rebuild
untouched (bd-adqb0).

Two decisions worth knowing before reading a number here:

1. The unit is PERIODS, not days. Maths runs six periods against five school
   days, so a calendar cell can hold two codes; counting days would undercount
   every Maths strand by about a fifth. The overview's budgets are in periods
   too, so the two tabs can be read against each other.

2. Science, revision, assessment and Grade 5 board prep are not counted.
   Revision and assessment consolidate FLN rather than teach it, and counting
   them would let a grade look strong on phonics because it tested phonics.
   EXCLUDED names them one by one; an unknown code raises instead of being
   dropped, so a new skill type cannot leak out of the totals unnoticed.

The month columns are the session's, not the data's: a month that teaches
nothing gets a real zero rather than a missing column. A month with no school
days at all — June and July, the summer break — is not a month of the session
and gets no column. January to March are always
zero, because content ends on 24 December and the rest of the year is revision
and board prep. That zero is the answer to "when does FLN teaching stop", so
it is shown rather than cropped.
"""
import collections

import caltab
import schoolyear as sy
import skills

# (group, strand, the skill keys it counts). One key belongs to exactly one
# strand; a key in no strand and not in EXCLUDED is a build error, not a zero.
STRANDS = [
    ("Literacy", "Oral language", ("oral_communication", "communicative")),
    ("Literacy", "Phonics & decoding", ("phonics", "arkaan_saazi")),
    ("Literacy", "Print concepts & pre-reading", ("pre_reading",)),
    ("Literacy", "Reading fluency", ("buland_khwani",)),
    ("Literacy", "Comprehension", ("reading_comprehension", "tafheem")),
    ("Literacy", "Vocabulary & grammar",
     ("vocabulary_grammar", "alfaaz_maani", "qawaid")),
    ("Literacy", "Writing", ("writing", "takhleeqi_likhai")),
    ("Numeracy · CPA", "Number fluency", ("number_fluency",)),
    ("Numeracy · CPA", "Concrete", ("concrete",)),
    ("Numeracy · CPA", "Pictorial", ("pictorial",)),
    ("Numeracy · CPA", "Pictorial → Abstract", ("pictorial_abstract",)),
    ("Numeracy · CPA", "Abstract", ("abstract",)),
    ("Numeracy · CPA", "Word problems", ("word_problem",)),
]

# Taught days that are not FLN TEACHING. Named individually so that adding a
# skill type forces a decision here (test_flntab.EverySkillIsAccountedFor).
EXCLUDED = frozenset({"revision", "assessment", "duhrai", "jaiza",
                      "review_assess", "board_prep"})

# Science is not foundational literacy or numeracy; its rows are skipped whole.
SUBJECTS = ("English", "Urdu", "Maths")

TITLE = "FLN COVERAGE — GRADES 1–5, 2026-27"
STANDFIRST = (
    "Every period of the year that teaches foundational literacy or numeracy, "
    "by strand, by month. Read across for when a strand is taught, down for "
    "what a month carries. Counted off the Teaching Calendar grid itself, so "
    "it is what the year schedules, not what we hoped it would. The unit is "
    "periods, not days — Maths runs doubles. Science, revision, assessment "
    "and Grade 5 board prep are not counted: they consolidate or check FLN "
    "rather than teach it. January to March are zero by design — content "
    "ends 24 December and the rest of the session is revision and board "
    "prep. June and July have no column at all: the summer break leaves "
    "them no school days, so they are not months of the session.")

HEADER = ["Strand group", "Strand", "Codes"]
TAIL = ["Total", "Share"]
GRADES = (1, 2, 3, 4, 5)
TOTAL_LABEL = "All FLN periods"


def _keys_of(subject):
    return [skills.canonical(k, subject) for k in skills.ORDER[subject]]


def _lookup(subject):
    """Grid code -> skill key, for one subject. Board prep is in the grid
    after 24 December but in no ORDER, so it is added explicitly rather than
    left to fall through as an unknown code."""
    out = {}
    for key in _keys_of(subject) + ["board_prep"]:
        out[skills.code(key, subject)] = key
    return out


def month_of(day):
    """The calendar's own month label, so the two tabs read the same."""
    return f"{caltab.MONTHS[day.month]} {day.year % 100}"


def session_months():
    """Every month of the session, in order, whether or not it teaches."""
    out = []
    for day in sy.school_days():
        label = month_of(day)
        if label not in out:
            out.append(label)
    return out


def periods(cal_rows, plan, days=None):
    """Counter keyed (grade, subject, skill key, month) — off the printed grid.

    plan is caltab's: `lead`, `body_top` and `stats` in row order. Reading the
    rendered rows rather than the allocation is deliberate; see the module
    docstring.
    """
    days = caltab.day_columns()[0] if days is None else days
    lead, top = plan["lead"], plan["body_top"]
    tally = collections.Counter()
    for i, (grade, subject, _st) in enumerate(plan["stats"]):
        if subject not in SUBJECTS:
            continue
        look, row = _lookup(subject), cal_rows[top + i]
        for j, day in enumerate(days):
            cell = row[lead + j] if lead + j < len(row) else ""
            for code in str(cell).strip().split("/"):
                if not code:
                    continue
                if code not in look:
                    raise ValueError(
                        f"unknown {subject} code {code!r} in the calendar "
                        "grid: give it a strand in flntab.STRANDS or name it "
                        "in flntab.EXCLUDED")
                key = look[code]
                if key not in EXCLUDED:
                    tally[(grade, subject, key, month_of(day))] += 1
    return tally


def _codes(keys):
    """The grid codes a strand counts, in the order the strands list them."""
    out = []
    for key in keys:
        for subject in SUBJECTS:
            if key in _keys_of(subject):
                code = skills.code(key, subject)
                if code not in out:
                    out.append(code)
    return " · ".join(out)


def _strand_totals(tally, grade, keys, months):
    return [sum(tally[(grade, subject, key, month)]
                for subject in SUBJECTS for key in keys) for month in months]


def build(cal_rows, cal_plan, days=None):
    """(rows, plan). rows[0] is the column header; build.py adds the title."""
    months = session_months()
    tally = periods(cal_rows, cal_plan, days)
    n_cols = len(HEADER) + len(months) + len(TAIL)
    total_col = len(HEADER) + len(months)
    share_col = total_col + 1

    rows = [HEADER + months + TAIL]
    plan = {"n_cols": n_cols, "months": months,
            "month_cols": list(range(len(HEADER), total_col)),
            "total_col": total_col, "share_col": share_col,
            "grade_rows": [], "strand_rows": [], "total_rows": [],
            "group_rows": []}

    for grade in GRADES:
        by_strand = [(group, strand,
                      _strand_totals(tally, grade, keys, months), keys)
                     for group, strand, keys in STRANDS]
        grade_total = sum(sum(counts) for _g, _s, counts, _k in by_strand)
        plan["grade_rows"].append(len(rows))
        rows.append([f"GRADE {grade}"] + [""] * (n_cols - 1))
        last_group = None
        for group, strand, counts, keys in by_strand:
            if group != last_group:
                plan["group_rows"].append(len(rows))
            share = 100.0 * sum(counts) / grade_total if grade_total else 0.0
            plan["strand_rows"].append(len(rows))
            rows.append([group if group != last_group else "", strand,
                         _codes(keys)] + counts
                        + [sum(counts), f"{share:.1f}%"])
            last_group = group
        plan["total_rows"].append(len(rows))
        rows.append(["", TOTAL_LABEL, ""]
                    + [sum(c[2][i] for c in by_strand)
                       for i in range(len(months))]
                    + [grade_total, "100%"])
    plan["widths"] = {0: 120, 1: 200, 2: 110, share_col: 70}
    return rows, plan
