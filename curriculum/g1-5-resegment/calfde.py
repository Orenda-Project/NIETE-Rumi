"""`Calendar — assumptions` — the overview tables and FDE's own, on one tab.

`Calendar (overview)` and `FDE Syllabus` asked one question between them: what
does this year assume? The first answered it from our side — what the period
rate buys, where FDE's documents disagree with each other, the shape of the
year by month. The second answered it from FDE's — its own weeks per chapter
against our periods, book by book. A reader comparing the two was tabbing
between them, so they are stacked here instead, four blocks down one tab.

The two halves are different widths: seven columns of prose and wide numbers
against ten narrow ones. The tab is as wide as the wider, and the overview
rows simply stop at column 7 — they are not padded out to claim a width they
have not got. A rebuild drops and recreates every tab (sheet.md §5.10), so
there is nothing stale in the tail for a short row to leave behind.

Nothing here is merged. §5.9: a full-width merge and a frozen column cannot
coexist, and the FDE half arrived with its banners merged across all ten
columns. They are painted across the row now, like the overview half's, which
costs nothing and cannot fail the freeze request. The consequence to watch is
prose: with nothing merged and nothing wrapped, a line longer than the tab is
cut on the sheet and looks untouched in the API response, so both halves put
one sentence per row through `calover.sentences`.
"""
import calfmt
import calover
import house
import fdetab

TITLE = "CALENDAR — ASSUMPTIONS"

STANDFIRST = ("What this year assumes, ours and FDE's: what the period rate "
              "buys, where FDE's documents disagree with each other, the year "
              "by month, and FDE's syllabus pacing against ours. The day grid "
              "itself is on the Teaching Calendar tab.")

# The overview half's seven widths, unchanged — its column 0 holds the longest
# label on the tab and its column 6 is the lane the verdict sentences overflow
# into. The three added columns are the FDE half's tail, each sized to its own
# header label ("FDE weeks per chapter", "Our periods for the book", "Our
# periods per chapter"), because a header that does not fit its column is the
# one cell on a numeric table that cannot overflow — its neighbour is filled.
WIDTHS = calover.WIDTHS + [150, 165, 155]
N_COLS = len(WIDTHS)


def fde_block(books, breaks):
    """The FDE half as `calover.stack` wants it: (rows, bands, headers).

    fdetab names its own band and header rows, so nothing here counts rows or
    offsets from a landmark. It used to: the painter found the breaks banner
    two rows above the breaks header, which was true until the standfirst
    above it became two sentences instead of one.
    """
    rows, plan = fdetab.build(books, breaks)
    return rows, plan["bands"], plan["heads"]


def build(stats, books, breaks):
    """stats: caltab's [(grade, subject, allocator stats)] · books + breaks:
    load_corpus's per-book FDE records and the breaks the documents assume.

    Returns (rows, plan) for `format_overview` below. The title band is
    handed to the overview half rather than written here so that every row
    number in the plan counts from the top of the tab.
    """
    rows, plan = calover.build(stats, head=(_row(TITLE), _row(STANDFIRST)))
    sections, heads = calover.stack(rows, (fde_block(books, breaks),))
    plan.update({"n_cols": N_COLS, "widths": WIDTHS,
                 "sections": plan["sections"] + sections,
                 "heads": plan["heads"] + heads})
    # The overview half's `wide` column is column 6 and the tab now ends at
    # column 9, so there is no one column that both holds the prose and closes
    # the tab. Nothing reads the key on this tab; leaving it set would only
    # invite something to.
    plan.pop("wide")
    return rows, plan


def _row(text):
    """A banner row: one cell, and the rest of the row left empty for it to
    overflow across. Written at the overview half's width, like every other
    row of that half."""
    return [text] + [""] * (calover.N_COLS - 1)


def format_overview(svc, sheetio, sid, rows, plan):
    """Paint it: wide columns, two frozen rows, everything overflows.

    Lives here rather than in calfmt because this is the tab calfde builds,
    and §5.9 makes the pair inseparable — the merged title band forces
    frozenColumnCount to 0, which is a fact about the data, not the paint.
    """
    rng, ink = sheetio._rng, sheetio.INK
    _paint, _height, _width = calfmt._paint, calfmt._height, calfmt._width
    nrows, ncols = len(rows), plan["n_cols"]
    reqs = [
        {"updateSheetProperties": {"properties": {
            "sheetId": sid,
            "gridProperties": {"frozenRowCount": 2, "frozenColumnCount": 0}},
            "fields": "gridProperties.frozenRowCount,"
                      "gridProperties.frozenColumnCount"}},
        _paint(rng, sid, 0, nrows, 0, ncols, {
            "verticalAlignment": "MIDDLE", "horizontalAlignment": "LEFT",
            "wrapStrategy": "OVERFLOW_CELL",
            "textFormat": {"fontSize": house.DATA_PT,
                           "foregroundColor": ink["data"]}}),
        _paint(rng, sid, 0, 1, 0, ncols, {
            "backgroundColor": ink["title"],
            "textFormat": {"bold": True, "fontSize": house.TITLE_PT,
                           "foregroundColor": ink["white"]}}),
        _paint(rng, sid, 1, 2, 0, ncols, {
            "backgroundColor": ink["white"],
            "textFormat": {"fontSize": house.SUB_PT,
                           "foregroundColor": ink["sub"]}}),
        _height(sid, 0, nrows, 22),
        _height(sid, 0, 1, house.TITLE_PX),
        _height(sid, 1, 2, house.SUB_PX),
    ]
    reqs += [_width(sid, i, i + 1, w) for i, w in enumerate(plan["widths"])]
    for row in plan["sections"]:
        reqs.append(_paint(rng, sid, row, row + 1, 0, ncols, {
            "backgroundColor": ink["band"],
            "textFormat": {"bold": True, "fontSize": house.BAND_PT,
                           "foregroundColor": ink["white"]}}))
    for row in plan["heads"]:
        reqs.append(_paint(rng, sid, row, row + 1, 0, ncols, {
            "backgroundColor": ink["chapter"],
            "textFormat": {"bold": True, "fontSize": house.HEAD_PT}}))
    calfmt._send(svc, sheetio, reqs)
