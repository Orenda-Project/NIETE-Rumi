"""How tall the §5.1 standfirst row has to be, and how wide it may merge.

Row 2 of every tab carries one sentence saying what the tab is and where its
facts come from. It is the only prose most tabs have, so it is the row a
reviewer trusts — and it is the row that fails in silence. Two ways, both of
which the live workbook was doing on 18 Sep 2026:

  a pinned `pixelSize` cuts the last wrapped line. Coverage Map sat at 36px
  holding three lines, so the third — "...not the same thing." — was gone;

  `OVERFLOW_CELL` runs the text rightwards until the grid ends, and then cuts.
  FLN Coverage held 688 characters starting in column D of a 1170px grid and
  rendered about a quarter of them.

Neither raises. Nothing in the API says a cell was too small for its own
contents, and the title band is the one place `autoResizeDimensions` is never
pointed at: `format_grid` auto-resizes the DATA rows only, on purpose, since
an auto-sized WRAP row holding a 250-character sentence balloons to fill the
screen. So this height has to be computed, and computed in one place: six
painters draw this row, and a height each of them worked out separately is
six chances to be a line short.

The arithmetic is an estimate and is meant to be. Sheets does not expose text
metrics, so a character is taken as 0.55em, which runs slightly wide for
lower case and slightly narrow for capitals. Erring tall is the safe
direction: a row with a spare line looks like a margin, a row a line short
loses a sentence.

This module imports only `house`, and must keep doing so. Five of its readers
are deliberately free of the Google SDK so they stay testable without
credentials, and a dependency pulled in here would land in all of them.
"""
import house

DEFAULT_PX = 100       # what Sheets gives a column nobody sized
EM = 0.55              # a character's width as a fraction of the point size
PX_PER_PT = 4.0 / 3.0  # a point is 4/3 of a pixel at the 96dpi Sheets assumes
LEAD = 5               # line spacing on top of the point size
PAD = 10               # the cell's own top and bottom padding
MIN_CHARS = 20         # never claim a line holds less than this


def column(row):
    """The index of the first cell in `row` holding anything, or None.

    The standfirst does not live in column A. `sheetio.titled` puts it at the
    first UNFROZEN column, because a long string cannot cross a frozen-column
    boundary, so asking column A whether the row is empty is how this row
    gets measured as blank and left at its floor.

    Only a non-blank STRING counts. A row builder that dropped a number into
    this band has not written a sentence there, and a bare `0` would otherwise
    read as text and stop the search one column short of the real one.
    """
    for i, cell in enumerate(row or ()):
        if isinstance(cell, str) and cell.strip():
            return i
    return None


def span(col, ncols, freeze_cols=0):
    """`(start, end)` columns the standfirst may be merged across.

    §5.9: a merge across a frozen-column boundary makes the freeze request
    fail, so a tab gets merged banners or frozen columns, never both across
    the same line. Text at or right of the freeze may run to the grid edge;
    text that landed INSIDE the frozen region — which happens when a caller's
    `titled(at=)` and `format_grid(freeze_cols=)` disagree — may only run up
    to the freeze. Both cases stay on one side of the boundary.
    """
    if col is None:
        return 0, 0
    if col < freeze_cols:
        return col, max(col, min(freeze_cols, ncols))
    return col, max(col, ncols)


def available(widths, c0, c1):
    """Pixels between two column indices, unsized columns at the default.

    `format_grid` emits a `pixelSize` only for the columns its caller named;
    the rest are whatever Sheets hands them. Counting a column the text
    cannot reach is exactly how a clipped row measures as fine.
    """
    return sum((widths or {}).get(c, DEFAULT_PX) for c in range(c0, c1))


def height(text, width_px, floor, pt=house.SUB_PT):
    """Row height in pixels for `text` wrapped into `width_px`, never < floor.

    `floor` is the tab's own house height for the row — the answer stays at
    it for the ordinary one-line case, so conforming tabs do not all grow.

    `width_px` is pixels and `pt` is points, so the two are converted before
    they are divided. Leaving that out is how this module arrived at its own
    failure mode on 21 Sep 2026: it claimed a third more characters per line
    than fit, sized the English G1–5 standfirst at one 28px line when its 638
    characters needed two, and cut the last clause off the sentence.
    """
    per_line = max(MIN_CHARS, int(width_px / (pt * PX_PER_PT * EM)))
    lines = -(-len(str(text or "")) // per_line)
    return max(floor, lines * (pt + LEAD) + PAD)


def row_px(rows, row, widths, ncols, freeze_cols, floor, pt=house.SUB_PT):
    """The whole question a painter asks: how tall must this row be?

    Falls back to `floor` when there is no such row or nothing in it, so a
    tab whose standfirst has not been written yet is not given a tall blank
    band where a sentence is missing.
    """
    try:
        cells = rows[row]
    except (IndexError, TypeError, KeyError):
        return floor
    col = column(cells)
    if col is None:
        return floor
    c0, c1 = span(col, ncols, freeze_cols)
    return height(cells[col], available(widths, c0, c1), floor, pt)
