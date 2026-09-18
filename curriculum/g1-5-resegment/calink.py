"""Skill colour for the day codes on the Teaching Calendar.

The grid's four background layers are all spoken for — chapter bands, the
FDE-omitted tint, Grade 1's Foundations gold, the run past 24 December — and
each is a fact the reader would lose if a skill colour were laid over it. So
the skill colour goes on the GLYPH: the background says which chapter and
which kind of week, the two letters say which skill and are drawn in that
skill's own colour, the one it has on the Skills Map and the subject tabs.

An earlier pass took these colours OUT, and its reasoning is worth keeping
because half of it was right: the KEY chips were tinted by skill while the
grid held no skill colour at all, so the legend sent the reader hunting for
green cells that were not there. That was a real defect. Stripping the colour
fixed the contradiction from the wrong end — the grid is where 3,230 codes
are read, and flat black is 3,230 codes that have to be looked up one at a
time. Colouring the glyph and tinting the chips to match settles it both
ways.

Two details the palette forces:

    the hexes in skills.py are a BACKGROUND palette. #FCE7C8 as text on a
    pale band is a smudge, so every colour is taken down to a luminance that
    reads while its hue is held — the same treatment, from the same place,
    the Skills Map already gives its tracks;

    196 of the 3,230 cells carry two codes, a period two skills share. The
    cell takes the first code's colour, because the first is the day's lead
    skill, and the KEY says so in words rather than leaving a reader to
    wonder what a slash does to a colour.

A code this module cannot name is left black rather than guessed at.
"""
import skills

# Shared with the Skills Map, so one palette cannot come out as two: the
# treatment, and why it is that treatment, live in skills.ink.
INK_BY_CODE = {}


def dark(hexcode):
    """The chip colour as text — its own hue, saturated, dark enough to read."""
    return skills.ink(hexcode)


def cell_ink(text):
    """The colour for one day cell, or None if nothing here can be named."""
    code = (text or "").strip().split("/")[0].strip()
    return INK_BY_CODE.get(code)


def _values(row, lead, n_cols):
    """One CellData per day column. An unnameable cell sends {}, which under
    a foregroundColor-only field mask clears back to black rather than
    painting anything."""
    out = []
    for col in range(lead, n_cols):
        ink = cell_ink(row[col] if col < len(row) else "")
        out.append({"userEnteredFormat": {"textFormat": {
            "foregroundColor": ink}}} if ink else {})
    return out


def chip_requests(paint, rng, sid, chips, fallback):
    """The KEY chips, each in its own skill's colour.

    Full strength here: a chip IS a background, which is what the palette was
    mixed for. The glyph in the grid is the same colour darkened, and both
    leave from this module so neither can drift without the other. `paint` is
    calfmt's own formatter, handed in rather than imported — the ink module
    has no business knowing how the rest of the tab is painted.
    """
    out = []
    for row, tint in chips:
        text = {"bold": True, "fontSize": 10}
        if tint:
            # The code inside the chip is the grid's own ink, so the legend
            # shows the pale background AND the glyph colour, which is what
            # the reader has to match. A chip showing only one of the two is
            # half a key.
            text["foregroundColor"] = dark(tint)
        out.append(paint(rng, sid, row, row + 1, 0, 1, {
            "backgroundColor": skills.rgb(tint) if tint else fallback,
            "horizontalAlignment": "CENTER", "textFormat": text}))
    return out


def ink_requests(rng, sid, rows, plan):
    """One updateCells per grade-and-subject row.

    Per cell it would be 3,230 repeatCell requests for one tab. Per row it is
    sixty, and each one carries its whole row of colours.
    """
    lead, top = plan["lead"], plan["body_top"]
    reqs = []
    for i in range(plan["body_rows"]):
        row = rows[top + i]
        values = _values(row, lead, plan["n_cols"])
        if not any(values):
            continue
        reqs.append({"updateCells": {
            "range": rng(sid, top + i, top + i + 1, lead, plan["n_cols"]),
            "rows": [{"values": values}],
            "fields": "userEnteredFormat.textFormat.foregroundColor"}})
    return reqs


for _key, _code in skills.CODE.items():
    _chip = skills.colour(_key)
    if _chip:
        INK_BY_CODE[_code] = dark(_chip)
