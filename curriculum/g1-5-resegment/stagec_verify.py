# -*- coding: utf-8 -*-
"""Verify one worker's slice output before a single cell reaches the sheet.

The swarm is not trusted on its own tally. A slice is written whole or not at
all: one bad cell holds the slice, because a partially-written tab is harder to
reason about than an unwritten one.
"""
import stagec
import stagec_spines as sp

# Columns Stage C derives or that were filled upstream. A worker emitting any
# of these is overreaching, and the reach is the finding -- not the value.
FORBIDDEN = ("Moves", "Teacher-primary min (of 40)", "Strand")

# A comprehension day without an explicit strategy is the defect
# english-skill-types.md names: the strategy must be taught I-do/we-do/you-do.
_NEEDS_STRATEGY = ("comprehension",)


def _split(value):
    return [p.strip() for p in (value or "").split(",") if p.strip()]


def verify_row(row, subject, cells, columns):
    """Findings for one row. Empty list means shippable."""
    out = []
    tag = "row %s (%s)" % (row["row"], row.get("day", ""))
    for col in FORBIDDEN:
        if col in cells:
            out.append("%s: %s is not the worker's to write" % (tag, col))
    for col in columns:
        if col not in cells:
            out.append("%s: %s is missing" % (tag, col))
            continue
        value = (cells[col] or "").strip()
        if value == stagec.PENDING:
            out.append("%s: %s left pending" % (tag, col))
            continue
        if col in stagec.VOCAB:
            out += ["%s: %s" % (tag, m) for m in stagec.check_enum(col, value)]
        elif not value:
            out.append("%s: %s is empty" % (tag, col))
    strategy = (cells.get("Reading strategy") or "").strip()
    try:
        shape = sp.shape_for(row.get("skill_type", ""), subject)
    except KeyError:
        shape = None
    if shape in _NEEDS_STRATEGY and strategy == "n/a":
        out.append("%s: Reading strategy cannot be n/a on a %s day"
                   % (tag, row.get("skill_type", "")))
    if "Prerequisite SLOs" in columns:
        prereq = (cells.get("Prerequisite SLOs") or "").strip()
        earlier = set(row.get("prior_slos_available") or [])
        out += ["%s: %s" % (tag, m) for m in stagec.check_prereq(prereq, earlier)]
    if "Interaction" in columns:
        out += ["%s: %s" % (tag, m) for m in stagec.check_oral_floor(
            row.get("skill_type", ""), cells.get("Interaction", ""),
            row.get("spine", ""))]
    return out


# A value that dominates a whole slice tells us nothing about any day in it.
# These are the columns that exist to DIFFERENTIATE -- the spec keeps
# Interaction and Gap apart for exactly this reason, because only both
# together reveal a term of pair work with no information gap in it.
DIVERSITY_COLUMNS = ("Collaboration structure", "Interaction", "Gap")
MIN_DISTINCT = 3          # any smaller and the column cannot separate anything
MAX_SHARE = 0.60          # one value past this and the slice is effectively flat
MIN_ROWS_FOR_DIVERSITY = 12
MIN_ROWS_PER_SKILL = 8    # below this, insisting on variety is inventing


def check_diversity(rows, cells, columns):
    """Findings for columns that have gone flat across a slice.

    Small skill types are exempt: four Word-problem days that genuinely suit
    one structure are honest, and forcing a second value there would be
    inventing to fill a blank.
    """
    out = []
    present = [r for r in rows if str(r["row"]) in cells]
    if len(present) < MIN_ROWS_FOR_DIVERSITY:
        return out
    for col in columns:
        if col not in DIVERSITY_COLUMNS:
            continue
        seen = [cells[str(r["row"])].get(col) for r in present]
        seen = [s for s in seen if s]
        if not seen:
            continue
        counts = {}
        for s in seen:
            counts[s] = counts.get(s, 0) + 1
        if len(counts) < MIN_DISTINCT:
            out.append("%s uses only %d distinct values across %d rows"
                       % (col, len(counts), len(seen)))
        top, n = max(counts.items(), key=lambda kv: (kv[1], kv[0]))
        share = float(n) / len(seen)
        if share > MAX_SHARE:
            out.append("%s is %r on %d of %d rows (%.0f%%): the column is flat"
                       % (col, top, n, len(seen), share * 100))
        by_skill = {}
        for r in present:
            v = cells[str(r["row"])].get(col)
            if v:
                by_skill.setdefault(r.get("skill_type", "?"), set()).add(v)
        for skill in sorted(by_skill):
            total = len([r for r in present if r.get("skill_type") == skill])
            if total >= MIN_ROWS_PER_SKILL and len(by_skill[skill]) < 2:
                out.append("%s is a single value on all %d %r days"
                           % (col, total, skill))
    return out


def verify_slice(slice_doc, worker_out):
    """Findings for a whole slice. Empty list means it may be written."""
    out = []
    if worker_out.get("slice") != slice_doc.get("slice"):
        out.append("slice name %r does not match %r"
                   % (worker_out.get("slice"), slice_doc.get("slice")))
    cells = worker_out.get("cells") or {}
    columns = slice_doc["columns_to_fill"]
    subject = slice_doc["subject"]
    expected = {str(r["row"]): r for r in slice_doc["rows"]}
    for key in sorted(set(cells) - set(expected)):
        out.append("row %s is not in this slice" % key)
    for key in sorted(set(expected) - set(cells), key=int):
        out.append("row %s is missing from the output" % key)
    for key in sorted(set(expected) & set(cells), key=int):
        out += verify_row(expected[key], subject, cells[key], columns)
    out += check_diversity(slice_doc["rows"], cells, columns)
    return out
