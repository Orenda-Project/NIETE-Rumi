# -*- coding: utf-8 -*-
"""Verify one worker's slice output before a single cell reaches the sheet.

The swarm is not trusted on its own tally. A slice is written whole or not at
all: one bad cell holds the slice, because a partially-written tab is harder to
reason about than an unwritten one.
"""
import stagec
import stagec_spines as sp
from stagec_columns import (CLOSED_VOCAB_COLUMNS, DIVERSITY_COLUMNS,
                            MIN_DISTINCT, MAX_SHARE, SECOND_MIN,
                            MIN_ROWS_FOR_DIVERSITY, MIN_ROWS_PER_SKILL,
                            BIG_VOCABULARY, SKILL_SHARE_COLUMNS,
                            CHORAL_MAX, EVEN_MIN_VALUES, EVEN_MIN_ROWS,
                            check_diversity, check_choral_pairs,
                            check_copied_columns, check_even_split)

# Columns Stage C derives or that were filled upstream. A worker emitting any
# of these is overreaching, and the reach is the finding -- not the value.
FORBIDDEN = ("Moves", "Teacher-primary min (of 40)", "Strand")

# A comprehension day without an explicit strategy is the defect
# english-skill-types.md names: the strategy must be taught I-do/we-do/you-do.
# The same is true of every day children meet print: sounding words out and
# walking into a text are taught strategies too, and `n/a` on such a day is a
# claim that no text was handled, which the skill tag contradicts.
_NEEDS_STRATEGY = ("comprehension", "pre_reading", "decoding")

# Reading aloud shares a move spine with oral work -- both are mouths open,
# little writing -- so the shape cannot separate them. The curriculum's own
# tag can: on a reading-aloud day the child is reading connected print, and
# the spec makes that tag authoritative where it exists. Matched on the
# English gloss the Urdu tags carry.
_READING_ALOUD = "reading aloud"

# Two channels, one return value. A defect holds the slice; a note travels
# with it to a human. The distinction exists because some findings are about
# the curriculum rather than the annotation, and a gate that can only reject
# forces a worker to invent its way past them.
NOTE = "NOTE: "


def defects(findings):
    """The findings that hold a slice. Notes are for a curriculum lead."""
    return [f for f in findings if not f.startswith(NOTE)]


def needs_strategy(skill_type, subject):
    """True where `n/a` would deny text the skill tag says is there."""
    if _READING_ALOUD in (skill_type or "").lower():
        return True
    try:
        return sp.shape_for(skill_type or "", subject) in _NEEDS_STRATEGY
    except KeyError:
        return False


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
            # A reading-aloud tag says what skill the day trains, not that
            # print is in front of the child. Where the day is oral through
            # and through, every strategy name is a fabrication and `n/a`
            # denies the tag, so pending is the only honest cell -- and it
            # is a question for whoever tagged the day, not for the worker.
            if col == "Reading strategy" and _READING_ALOUD in (
                    row.get("skill_type") or "").lower():
                out.append("%s%s: %s pending -- tagged %s but the day may "
                           "carry no text; for the curriculum lead"
                           % (NOTE, tag, col, row.get("skill_type", "")))
            else:
                out.append("%s: %s left pending" % (tag, col))
            continue
        if col in stagec.VOCAB:
            out += ["%s: %s" % (tag, m) for m in stagec.check_enum(col, value)]
        elif not value:
            out.append("%s: %s is empty" % (tag, col))
    strategy = (cells.get("Reading strategy") or "").strip()
    if strategy == "n/a" and needs_strategy(row.get("skill_type", ""), subject):
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
    out += check_copied_columns(cells, columns)
    out += check_even_split(slice_doc["rows"], cells, columns)
    if "Interaction" in columns and "Gap" in columns:
        out += check_choral_pairs(slice_doc["rows"], cells)
    return out
