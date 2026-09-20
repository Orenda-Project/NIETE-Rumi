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
    return out
