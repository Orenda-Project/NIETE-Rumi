# -*- coding: utf-8 -*-
"""The move spines, written once each, so a day row can point instead of copy.

bd-960al. Amena, reading the reworked matrix: "i see lots of text here". The
Moves column was the largest part of that and the least informative -- 276,996
characters across the four subject tabs holding twenty distinct values, each
one copied down an average of 83 day rows.

That repetition follows from the design rather than from a mistake. A spine's
information is the shape of the skill type and the grade band, not the day's
topic (stagec_spines says so, and hand-writing 1,657 of them was rejected
precisely because it buys no signal). A value that is a function of two
columns already on the row does not need restating on the row: it needs
naming once and referring to.

So this tab holds the JSON -- all of it, unabridged, still the artefact --
and the day row keeps `language_focus · G1-2` with a link to the row below.
Nothing is hidden and nothing is summarised away; the same bytes are stored
once instead of 1,658 times.

Everything but `write` is pure; `write` takes its Sheets client
and the `sheetio` module injected, the way `navtab` and
`reviewtab` do, so the tab's shape stays testable without a key.
"""
import json

import stagec
import stagec_spines as sp

#: The day-row label's separator, the same DOT the subject tabs already use.
DOT = stagec.DOT

COLUMNS = ("Spine", "Shape", "Band", "Moves", "Minutes",
           "Teacher-primary (of 40)", "Moves (JSON)")

#: 1-based sheet row of the first spine, once `sheetio.titled` has put the
#: two-row title band and the header above it.
FIRST_ROW = 4

TITLE = "MOVE SPINES"
STANDFIRST = (
    "The twenty-two 40-minute move spines, one per skill-type shape per "
    "grade band. Every day row's Moves cell links here rather than "
    "restating the spine: the shape of the skill type is what a spine "
    "knows, and that does not change from day to day. G1-2 gets more and "
    "shorter moves — the slow ramp for children arriving without ECE.")


def label(shape, band):
    """What a day row reads instead of ~160 characters of JSON."""
    return u"%s %s %s" % (shape, DOT, band)


def sheet_row(offset):
    """1-based sheet row of `spine_rows()[offset]`, once `titled` has run.

    The arithmetic lives here, beside FIRST_ROW, so a caller building a
    link never has to know how tall the title band is.
    """
    return FIRST_ROW + offset - 1


def canonical(cell):
    """A Moves cell reduced to the exact string `format_moves` would emit.

    A cell written by a different hand -- or by a JSON dump with default
    spacing -- is the same spine and has to match as one. Anything that is
    not a spine at all comes back unchanged, so it simply fails to match
    rather than being coerced into the nearest one.
    """
    try:
        return stagec.format_moves(stagec.parse_moves(cell))
    except (ValueError, TypeError):
        return cell


def _sorted_keys():
    """Shape order from stagec_spines, band order inside it: a stable tab."""
    return [(shape, band) for shape in sp.SHAPES for band in sp.BANDS
            if (shape, band) in sp.SPINES]


def spine_rows():
    """The tab: a header row, then one row per spine."""
    rows = [list(COLUMNS)]
    for shape, band in _sorted_keys():
        moves = sp.SPINES[(shape, band)]
        rows.append([label(shape, band), shape, band, len(moves),
                     sum(int(m) for _, m in moves),
                     stagec.teacher_primary_min(moves),
                     stagec.format_moves(moves)])
    return rows


def index():
    """Canonical spine JSON -> (label, 0-based row within `spine_rows()`).

    Keyed by the JSON and not by (skill type, grade): the label has to
    describe the cell it is replacing. Re-deriving it from the row's other
    columns would quietly relabel any day whose Moves cell disagrees with
    them -- and finding those disagreements is half of why the pass reads
    every cell rather than rewriting the column blind.
    """
    out = {}
    for i, (shape, band) in enumerate(_sorted_keys()):
        out[stagec.format_moves(sp.SPINES[(shape, band)])] = (
            label(shape, band), i + 1)
    return out


#: Column widths. The JSON column is wide because it is the artefact and a
#: reader has to be able to see a whole spine; everything left of it is a
#: label or a number.
WIDTHS = {0: 190, 1: 140, 3: 70, 4: 80, 5: 160, 6: 560}


def write(svc, sheetio, sid, rows=None):
    """Write and format the tab. Returns the rows as they went out."""
    values, head = sheetio.titled(rows or spine_rows(), TITLE, STANDFIRST)
    sheetio.write_values(svc, "Move Spines", values)
    sheetio.format_grid(svc, sid, len(values), len(COLUMNS), freeze_cols=1,
                        head_row=head, band=True, widths=WIDTHS, rows=values)
    return values
