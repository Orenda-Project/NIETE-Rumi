"""Subject-tab assembly: header, row grammar, and the pending-column contract.

A column this stage cannot fill is written `pending`, never a proxy. The
Navigation tab says which stage fills each one.
"""
PENDING = "pending"
# The FDE syllabus breakdown teaches a subset of each book. A chapter it skips
# is labelled here and stays in the plan; nothing is silently deleted.
OMITTED = "Omitted by FDE"

# Measured over the 1,923 traced rows on all four tabs before cutting:
# `Period (min)` was "40" on every one of them, `FDE syllabus` was
# "In FDE syllabus", `Review status` was "not reviewed". A column with one
# value cannot be filtered, sorted or reviewed on. The period is in the
# standfirst and in `Teacher-primary min (of 40)`; FDE omission is announced
# by its own banner row; an empty `Human reviewer` already says unreviewed.
CORE = ["Day #", "Topic", "Skill type", "Pages (printed)",
        "Page overlap",
        "Primary SLO", "SLO role", "Primary SLO description"]

# What THIS day teaches, in the child's own voice -- next to the code's
# sentence, because one code covers many unlike days and on most of them
# the code's sentence describes a different one. `U-05-CO-01` reads
# "explain the couplets of a poem" on all 33 of its days, among them a
# formal letter, two interviews and a bakery recipe. Language tabs only
# for now: the objectives are written per book, and the two written so
# far are G4 English and G5 Urdu. See dayobj and dayobjsheet.
OBJECTIVE = ["Day objective"]

CORE_TAIL = ["Supporting SLOs", "Supporting SLO descriptions",
             "Bloom's", "Moves"]

COLLAB = ["Collaboration structure"]

# 18 distinct strategies on English, 19 on Urdu -- and "n/a" on all 785 Maths
# and Science rows, because the column asks a reading question of a subject
# that is not teaching reading.
READING = ["Reading strategy"]

LANG = ["Function", "Interaction", "Gap", "Strand", "Recycles"]

MID = ["Prerequisite SLOs", "Teacher-primary min (of 40)", "Flags"]

# Traces (traces.md, binding): save, publish, link, stamp. Ten columns, of
# which nine held either nothing or the same string on every row, are one
# column holding a JSON object of stage -> artefact. A stage appears in the
# cell when it has an artefact and is absent when it does not, so the cell
# cannot decay into a constant the way the ten columns did, and a stage that
# runs later adds a key instead of a column.
TRACES_COLUMN = "Traces"
TRACES = [TRACES_COLUMN]

REVIEW = ["Human reviewer"]

# stage that fills each pending column — shown on Navigation.
# Stage C ran on 2026-09-21: Moves, Reading strategy, Collaboration structure,
# Function, Interaction, Gap, Recycles, Prerequisite SLOs and Teacher-primary
# min are written and left here. A column in this map is greyed, noted and
# COLLAPSED, so leaving a written column in it hides the data from the person
# who asked for it.
FILLED_BY = {
    "Video": "B2 — video→SLO mapping",
}

LANG_SUBJECTS = {"English", "Urdu"}


def header(subject):
    """Column order is the live order minus what was cut, never a reshuffle.

    `Reading strategy` keeps its place between Moves and Collaboration
    structure on the tabs that still have it, so migrating the live sheet is
    a sequence of column deletes. Reordering would mean rewriting every cell
    and would put Stage C's 12,655 written values at risk for cosmetics.
    """
    cols = list(CORE)
    if subject in LANG_SUBJECTS:
        cols += OBJECTIVE
    cols += CORE_TAIL
    if subject in LANG_SUBJECTS:
        cols += READING
    cols += COLLAB
    if subject in LANG_SUBJECTS:
        cols += LANG
    return cols + MID + TRACES + REVIEW


def _day_row(r, subject, ncols):
    out = [r["day_label"], r["topic"], r["skill_type"], r["pages"],
           r["overlap"],
           r["primary_slo"], r["slo_role"], r["primary_slo_desc"]]
    if subject in LANG_SUBJECTS:
        # Empty, not `pending`: a day nobody has written an objective for
        # is a fact about the build, and `pending` would claim a stage is
        # coming for it.
        out += [r.get("objective") or ""]
    out += [r["supporting_slos"], r["supporting_descs"], r["blooms"], PENDING]
    if subject in LANG_SUBJECTS:
        out += [PENDING]
    out += [PENDING]
    if subject in LANG_SUBJECTS:
        out += [PENDING, PENDING, PENDING, r["strand"] or PENDING, PENDING]
    out += [PENDING, PENDING, r["flags"]]
    out += [""] * len(TRACES)
    out += [""]
    assert len(out) == ncols, f"{len(out)} != {ncols}"
    return out


def tail_label(kind):
    """The `Day #` marker a chapter-tail row carries, on every tab that prints
    one.

    Scripts identify a row by this marker and never by its position, so the
    marker is an interface and not a caption — and the flat dump used to write
    its own captions here, one of them `Day 8 (Review)`, which a script
    counting `^Day \\d+` teaching days matched. It answered 1,695 for a year
    that teaches 1,657. Both surfaces read this function now: two spellings of
    one row type is the whole defect, and a second copy of the string is how it
    comes back.
    """
    return "📋 Ch. Review" if kind == "review" else "✅ Ch. Assessment"


def _tail_row(r, subject, ncols):
    label = tail_label(r["kind"])
    out = [label, r["topic"], r["skill_type"], r["pages"], "",
           "", "", ""]
    if subject in LANG_SUBJECTS:
        out += [""]        # a review or assessment day teaches no new one
    out += [r["supporting_slos"], "", r["blooms"], PENDING]
    if subject in LANG_SUBJECTS:
        out += [""]
    out += [""]
    if subject in LANG_SUBJECTS:
        out += ["", "", "", "", ""]
    out += ["", "", ""]
    out += [""] * len(TRACES)
    out += [""]
    assert len(out) == ncols, f"{len(out)} != {ncols}"
    return out


def _banner(token, rest, ncols):
    """A banner row, split across the first two columns.

    Overflow stops dead at the frozen-column boundary, so a banner written
    wholly into column A was cut at that column's width and a chapter title
    was unreadable. The grammar token stays in A — `^GRADE \d+`,
    `^Chapter \d+:` still match — and the readable remainder goes in B.
    """
    return [token, rest] + [""] * (ncols - 2)


def subject_tab(subject, book_rows):
    """book_rows: [(grade, [row,...]), ...] already in grade order.

    Returns (values, grade banners, chapter banners, omitted-chapter banners).
    Banners are matched later by label, never by index — the indices returned
    here are only for the formatting pass in this same run.
    """
    cols = header(subject)
    n = len(cols)
    values = [cols]
    grade_rows, chapter_rows, omitted_rows = [], [], []

    for grade, rows in book_rows:
        day_n = sum(1 for r in rows if r["kind"] == "day")
        values.append(_banner(f"GRADE {grade}",
                              f"{subject} · {day_n} teaching days · "
                              f"{len({r['chapter'] for r in rows})} chapters",
                              n))
        grade_rows.append(len(values) - 1)
        current_ch = None
        for r in rows:
            if r["chapter"] != current_ch:
                current_ch = r["chapter"]
                title = r["chapter_title"]
                rest = title or ""
                if r.get("fde") == OMITTED:
                    rest += "   ⚠ OMITTED FROM THE FDE SYLLABUS BREAKDOWN"
                    omitted_rows.append(len(values))
                values.append(_banner(f"Chapter {current_ch}:", rest, n))
                chapter_rows.append(len(values) - 1)
            values.append(_day_row(r, subject, n) if r["kind"] == "day"
                          else _tail_row(r, subject, n))

    return values, grade_rows, chapter_rows, omitted_rows


def wrap_columns(subject):
    """Long-prose columns. Topic and the two SLO description columns."""
    cols = header(subject)
    want = {"Topic", "Primary SLO description", "Day objective",
            "Supporting SLO descriptions", "Page overlap", "Flags"}
    return [i for i, c in enumerate(cols) if c in want]


def flag_column(subject):
    return header(subject).index("Flags")


def skill_column(subject):
    return header(subject).index("Skill type")


def widths(subject):
    cols = header(subject)
    px = {"Day #": 140, "Topic": 300, "Skill type": 160,
          "Pages (printed)": 100, "Page overlap": 180, "Primary SLO": 110,
          "SLO role": 90, "Primary SLO description": 320,
          "Day objective": 320,
          "Supporting SLOs": 130, "Supporting SLO descriptions": 300,
          "Flags": 250, "Moves": 300, TRACES_COLUMN: 150}
    return {i: px[c] for i, c in enumerate(cols) if c in px}


# Columns no stage has filled yet. They keep the literal `pending` — that is
# the honesty rule and Navigation documents it — but they are greyed at the
# header, carry a note naming the stage that fills them, and ship inside a
# COLLAPSED column group, so a reviewer sees them only when she asks for them.
def pending_notes(subject):
    cols = header(subject)
    notes = {}
    for i, c in enumerate(cols):
        if c in FILLED_BY:
            notes[i] = f"Empty on purpose. Filled by {FILLED_BY[c]}."
        elif c == TRACES_COLUMN:
            notes[i] = ("The day's artefacts as JSON, one key per pipeline "
                        "stage that has produced something. A stage missing "
                        "from the object has not run for that day.")
        elif c == "Human reviewer":
            notes[i] = "Type your name here when you review the row."
    return notes


def dead_columns(subject):
    """Indices with nothing in them yet. Traces is no longer one of them —
    it carries the stages that HAVE run, so it is never uniformly empty."""
    cols = header(subject)
    return [i for i, c in enumerate(cols) if c in FILLED_BY]


def groups(subject, min_run=2):
    """Contiguous runs of dead columns, as (start, end) half-open pairs."""
    dead, runs = dead_columns(subject), []
    for i in dead:
        if runs and runs[-1][1] == i:
            runs[-1][1] = i + 1
        else:
            runs.append([i, i + 1])
    return [(a, b) for a, b in runs if b - a >= min_run]


STANDFIRST = {
    "English": "One row per teaching day, rebuilt from the printed pages. "
               "Grades 1-5, in grade then chapter then day order.",
    "Urdu": "One row per teaching day. The Urdu day boundaries are the ones "
            "already in production — only the day-integrity fields were "
            "repaired. جائزہ and دہرائی days are ordinary Day rows here, not "
            "chapter tails.",
    "Maths": "One row per teaching day, rebuilt from the printed pages. Skill "
             "type IS the CPA phase — concrete, pictorial, the bridge, "
             "abstract, word problem.",
    "Science": "One row per teaching day, Grades 4-5 General Science. The day "
               "boundaries are production's; only the day-integrity fields "
               "were repaired.",
}


def standfirst(subject):
    return (STANDFIRST[subject] + "  Stage C is filled: Moves" + (
                ", Reading strategy" if subject in LANG_SUBJECTS else "") +
            ", Collaboration structure" + (
                ", Function, Interaction, Gap, Recycles"
                if subject in LANG_SUBJECTS else "") +
            ", Prerequisite SLOs and Teacher-primary min hold values on every "
            "teaching day. Moves and Traces are JSON, clipped to one line — "
            "click the cell to read the whole value. Nothing on this tab is "
            "hidden or collapsed.")
