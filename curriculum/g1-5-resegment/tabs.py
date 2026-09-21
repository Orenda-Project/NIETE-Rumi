"""Subject-tab assembly: header, row grammar, and the pending-column contract.

A column this stage cannot fill is written `pending`, never a proxy. The
Navigation tab says which stage fills each one.
"""
PENDING = "pending"
# The FDE syllabus breakdown teaches a subset of each book. A chapter it skips
# is labelled here and stays in the plan; nothing is silently deleted.
OMITTED = "Omitted by FDE"

CORE = ["Day #", "Topic", "Skill type", "Pages (printed)",
        "Page overlap",
        "Primary SLO", "SLO role", "Primary SLO description",
        "Supporting SLOs", "Supporting SLO descriptions",
        "Bloom's", "Period (min)", "Moves",
        "Reading strategy", "Collaboration structure"]

LANG = ["Function", "Interaction", "Gap", "Strand", "Recycles"]

MID = ["FDE syllabus", "Prerequisite SLOs", "Teacher-primary min (of 40)", "Flags"]

TRACES = ["A Page truth", "B Segmentation", "C Enrichment", "C-gate Enrich gate",
          "D0 Slide script", "D Render meta", "E Voicenote script",
          "J Pedagogy review", "J Design review", "F LP (latest PDF)"]

REVIEW = ["Human reviewer", "Review status"]

# Traces (traces.md, binding): save, publish, link, stamp. Three stages have
# run and their cells hold links -- page truth relinked from the previous
# build's published objects, segmentation and enrichment anchored back into
# the row that holds them. Those three must stay visible. The other seven
# have genuinely not run at day scale and stay grey, noted and collapsed.
LINKED_TRACES = TRACES[:3]
PENDING_TRACES = TRACES[3:]

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
    cols = list(CORE)
    if subject in LANG_SUBJECTS:
        cols += LANG
    return cols + MID + TRACES + REVIEW


def _day_row(r, subject, ncols):
    out = [r["day_label"], r["topic"], r["skill_type"], r["pages"],
           r["overlap"],
           r["primary_slo"], r["slo_role"], r["primary_slo_desc"],
           r["supporting_slos"], r["supporting_descs"],
           r["blooms"], r["period_min"], PENDING, PENDING, PENDING]
    if subject in LANG_SUBJECTS:
        out += [PENDING, PENDING, PENDING, r["strand"] or PENDING, PENDING]
    out += [r["fde"], PENDING, PENDING, r["flags"]]
    out += [""] * len(TRACES)
    out += ["", "not reviewed"]
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
           "", "", "", r["supporting_slos"], "", r["blooms"], r["period_min"],
           PENDING, "", ""]
    if subject in LANG_SUBJECTS:
        out += ["", "", "", "", ""]
    out += [r["fde"], "", "", ""]
    out += [""] * len(TRACES)
    out += ["", "not reviewed"]
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
    want = {"Topic", "Primary SLO description", "Supporting SLO descriptions",
            "Page overlap", "Flags"}
    return [i for i, c in enumerate(cols) if c in want]


def fde_column(subject):
    return header(subject).index("FDE syllabus")


def flag_column(subject):
    return header(subject).index("Flags")


def skill_column(subject):
    return header(subject).index("Skill type")


def widths(subject):
    cols = header(subject)
    px = {"Day #": 140, "Topic": 300, "Skill type": 160,
          "Pages (printed)": 100, "Page overlap": 180, "Primary SLO": 110,
          "SLO role": 90, "Primary SLO description": 320,
          "Supporting SLOs": 130, "Supporting SLO descriptions": 300,
          "Flags": 250, "FDE syllabus": 130}
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
        elif c in PENDING_TRACES:
            stage = c.split(" ", 1)[0]
            notes[i] = (f"Trace column. A link lands here when stage {stage} "
                        "runs for that day. Empty means the stage has not run.")
        elif c == "Human reviewer":
            notes[i] = "Type your name here when you review the row."
    return notes


def dead_columns(subject):
    """Indices with nothing in them yet — pending columns and unrun traces."""
    cols = header(subject)
    return [i for i, c in enumerate(cols)
            if c in FILLED_BY or c in PENDING_TRACES]


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
    return (STANDFIRST[subject] + "  Stage C is filled: Moves, Reading "
            "strategy, Collaboration structure" + (
                ", Function, Interaction, Gap, Recycles"
                if subject in LANG_SUBJECTS else "") +
            ", Prerequisite SLOs and Teacher-primary min hold values on every "
            "teaching day. Moves reads phase·minutes and is clipped to one "
            "line — click the cell for the whole sequence. The grey group to "
            "the right is a later stage and is still collapsed; hover a grey "
            "header for which stage fills it.")
