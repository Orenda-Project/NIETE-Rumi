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
DIVERSITY_COLUMNS = ("Collaboration structure", "Interaction", "Gap")
MIN_DISTINCT = 3          # any smaller and the column cannot separate anything
MAX_SHARE = 0.60          # a value past this is only flat if nothing rivals it
SECOND_MIN = 0.25         # ...and this is what "rivals it" means
MIN_ROWS_FOR_DIVERSITY = 12
MIN_ROWS_PER_SKILL = 8    # below this, insisting on variety is inventing
BIG_VOCABULARY = 8        # only here is within-skill-type variety expected
CHORAL_MAX = 0.60         # paired work carrying no information gap
_PAIRED = ("pair", "group", "mingle")


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
        ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        top, n = ranked[0]
        share = float(n) / len(seen)
        runner = float(ranked[1][1]) / len(seen) if len(ranked) > 1 else 0.0
        # A dominant value with a real runner-up still tells days apart. One
        # whose rivals are tokens does not -- that is the dead column.
        if share > MAX_SHARE and runner < SECOND_MIN:
            out.append("%s is %r on %d of %d rows (%.0f%%) and nothing rivals "
                       "it: the column is flat"
                       % (col, top, n, len(seen), share * 100))
        if len(stagec.VOCAB.get(col, ())) < BIG_VOCABULARY:
            # Five values, two of which the spec discourages on oral days.
            # Nine Phonics days with no information gap between the children
            # is a true statement about phonics, not inattention.
            continue
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



def check_choral_pairs(rows, cells):
    """The spec's own named failure, verbatim:

        "a whole term of `pair` at `Gap: none` is choral practice in pairs,
         and only both columns together reveal it"

    Neither column alone is wrong there. The pair of them is, which is why
    this cannot be folded into the per-column flatness checks.
    """
    present = [r for r in rows if str(r["row"]) in cells]
    if len(present) < MIN_ROWS_FOR_DIVERSITY:
        return []
    hollow = 0
    for r in present:
        c = cells[str(r["row"])]
        if c.get("Interaction") in _PAIRED and c.get("Gap") == "none":
            hollow += 1
    share = float(hollow) / len(present)
    if share > CHORAL_MAX:
        return ["%d of %d rows (%.0f%%) put children together with no "
                "information gap between them: this is choral practice in "
                "pairs" % (hollow, len(present), share * 100)]
    return []

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
    if "Interaction" in columns and "Gap" in columns:
        out += check_choral_pairs(slice_doc["rows"], cells)
    return out
