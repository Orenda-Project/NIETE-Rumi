"""Painting a coverage tab. One function paints both of them.

`covtab` decides what the tab says and where; this decides only how it looks,
from the declarative `plan` it is handed. Nothing here knows which tab it is
painting, so the Coverage Map and Coverage — gaps cannot drift apart.

Three things carry meaning and all three are colour, so they are done here:

  a bar takes its skill's own colour, darkened to a jewel tone. The palette
  tints are chip backgrounds — pale by design — and `████` in #FCE7C8 on white
  is invisible. Same hue, same reading, readable ink;

  the chapter grid is a heat map, and an EMPTY cell is left pale and ringed,
  because the empty cell is the finding. A zero that looks like every other
  zero hides it;

  the house rows — title, subtitle, section band, column header — are painted
  from `INK` so this tab looks like every other tab in the workbook.

The house rows are MERGED across the tab, which is why `frozenColumnCount` is
set to 0 (see the note in `covtab`): a merge across a frozen column boundary
makes the freeze request fail, so a tab gets merged banners or frozen columns,
never both. Every row gets an explicit `pixelSize` — there is no
`autoResizeDimensions` anywhere in this build, so an unsized WRAP row with a
250-character note in it balloons to fill the screen. Pin a height and let the
reader drag it open.
"""
import colorsys

import house

import skills

WHITE = {"red": 1, "green": 1, "blue": 1}
HEAT = [{"red": 0.89, "green": 0.94, "blue": 0.99},
        {"red": 0.76, "green": 0.87, "blue": 0.97},
        {"red": 0.58, "green": 0.77, "blue": 0.93},
        {"red": 0.36, "green": 0.62, "blue": 0.86}]
HOLE = {"red": 0.99, "green": 0.92, "blue": 0.92}
HOLE_EDGE = {"red": 0.80, "green": 0.45, "blue": 0.40}
DEF_W, CHUNK = 60, 200
H_TITLE, H_NOTE, H_BAND, H_HEAD = house.TITLE_PX, 36, 30, 34
# Jewel tone: the chip hue kept, lightness pinned dark, saturation floored so a
# near-grey tint still reads as its own colour rather than as text grey.
JEWEL_L, JEWEL_S = 0.32, 0.55


def _heat(n):
    """Which of the four steps a day count falls in."""
    if n >= 7:
        return HEAT[3]
    if n >= 4:
        return HEAT[2]
    if n >= 2:
        return HEAT[1]
    return HEAT[0]


def _jewel(hexcode):
    """A pale palette tint as readable ink, same hue."""
    c = skills.rgb(hexcode)
    hue, _l, sat = colorsys.rgb_to_hls(c["red"], c["green"], c["blue"])
    red, green, blue = colorsys.hls_to_rgb(hue, JEWEL_L, max(sat, JEWEL_S))
    return {"red": red, "green": green, "blue": blue}


def _runs(cells):
    """Neighbouring grid cells of the same fill collapsed into one run: a
    500-row grid is 1,400 cells, and one request each is 1,400 requests."""
    out = []
    for row, col, days in sorted(cells):
        fill = _heat(days) if days else HOLE
        if out and (out[-1][0], out[-1][2], out[-1][3]) == (row, col, fill):
            out[-1][2] = col + 1
        else:
            out.append([row, col, col + 1, fill, bool(days)])
    return out


def _fmt(rng, sid, r0, r1, c0, c1, **fields):
    """One repeatCell over a range, with fields inferred from the kwargs."""
    return {"repeatCell": {
        "range": rng(sid, r0, r1, c0, c1),
        "cell": {"userEnteredFormat": fields},
        "fields": "userEnteredFormat(%s)" % ",".join(sorted(fields))}}


def _size(sid, dim, i0, i1, px):
    return {"updateDimensionProperties": {
        "range": {"sheetId": sid, "dimension": dim,
                  "startIndex": i0, "endIndex": i1},
        "properties": {"pixelSize": px}, "fields": "pixelSize"}}


def _merge(rng, sid, row, n):
    return {"mergeCells": {"range": rng(sid, row, row + 1, 0, n),
                           "mergeType": "MERGE_ALL"}}


def _note_px(rows, row, plan):
    """How tall a merged 11pt standfirst has to be to show all of itself."""
    try:
        text = next(c for c in rows[row] if str(c).strip())
    except (IndexError, StopIteration):
        return H_NOTE
    width = sum(plan["widths"].get(i, 100) for i in range(plan["n_cols"]))
    per_line = max(20, int(width / (house.SUB_PT * 0.55)))
    lines = -(-len(str(text)) // per_line)
    return max(H_NOTE, lines * (house.SUB_PT + 5) + 10)


def _house(rng, sid, row, n, bg, text, px):
    """A full-width house row: painted, wrapped and pinned to a height."""
    return [_fmt(rng, sid, row, row + 1, 0, n, backgroundColor=bg,
                 wrapStrategy="WRAP", verticalAlignment="MIDDLE",
                 horizontalAlignment="LEFT", textFormat=text),
            _size(sid, "ROWS", row, row + 1, px)]


def _frame(rng, sid, nrows, plan):
    """Freeze, base format, column widths, then the house rows."""
    n = plan["n_cols"]
    reqs = [
        # the whole sheet, not the current grid: last run's tab may have been
        # taller, and a stale merge below the data blocks the freeze request.
        {"unmergeCells": {"range": {"sheetId": sid}}},
        {"clearBasicFilter": {"sheetId": sid}},
        {"updateSheetProperties": {"properties": {
            "sheetId": sid,
            "gridProperties": {"frozenRowCount": plan["freeze_rows"],
                               # 0, deliberately: merged banners and frozen
                               # columns are mutually exclusive.
                               "frozenColumnCount": 0}},
            "fields": "gridProperties.frozenRowCount,"
                      "gridProperties.frozenColumnCount"}},
        _fmt(rng, sid, 0, nrows, 0, n, verticalAlignment="MIDDLE",
             horizontalAlignment="LEFT", wrapStrategy="CLIP",
             textFormat={"fontSize": 10}),
    ]
    for col in range(n):
        reqs.append(_size(sid, "COLUMNS", col, col + 1,
                          plan["widths"].get(col, DEF_W)))
    for col in plan["wrap_cols"]:
        reqs.append(_fmt(rng, sid, plan["freeze_rows"], nrows, col, col + 1,
                         wrapStrategy="WRAP"))
    for r0, r1, c0, c1 in plan["overflow"]:
        reqs.append(_fmt(rng, sid, r0, r1, c0, c1,
                         wrapStrategy="OVERFLOW_CELL"))
    for r0, r1, px in plan["row_heights"]:
        reqs.append(_size(sid, "ROWS", r0, r1, px))
    return reqs


def _rows(rng, sid, plan, ink, rows=()):
    """The named rows: title, notes, section bands, column headers."""
    n, reqs, merges = plan["n_cols"], [], []
    reqs += _house(rng, sid, plan["title_row"], n, ink["title"],
                   {"bold": True, "fontSize": house.TITLE_PT,
                    "foregroundColor": WHITE},
                   H_TITLE)
    merges.append(_merge(rng, sid, plan["title_row"], n))
    for row in plan["note_rows"]:
        # The first note row IS the §5.1 standfirst: grey prose on white, right
        # under the title. The later ones are in-tab callouts and keep the cream
        # of a label cell, because that is the role they play where they sit.
        top = row == plan["title_row"] + 1
        # A merged, wrapped standfirst at 11pt clips at H_NOTE: the third line
        # is simply cut off, which is how the Coverage Map lost the end of its
        # own reading instruction. Height it from the text it actually holds.
        px = _note_px(rows, row, plan) if top else H_NOTE
        reqs += _house(rng, sid, row, n,
                       ink["white"] if top else ink["cream"],
                       {"fontSize": house.SUB_PT if top else 10,
                        "italic": not top,
                        "foregroundColor": ink["sub"] if top else ink["head"]},
                       px)
        merges.append(_merge(rng, sid, row, n))
    for row in plan["band_rows"]:
        reqs += _house(rng, sid, row, n, ink["band"],
                       {"bold": True, "fontSize": house.BAND_PT,
                        "foregroundColor": WHITE}, H_BAND)
        merges.append(_merge(rng, sid, row, n))
    for row in plan["head_rows"]:
        reqs.append(_fmt(
            rng, sid, row, row + 1, 0, n, backgroundColor=ink["head"],
            wrapStrategy="OVERFLOW_CELL", verticalAlignment="BOTTOM",
            textFormat={"bold": True, "fontSize": house.HEAD_PT,
                        "foregroundColor": WHITE}))
        reqs.append(_size(sid, "ROWS", row, row + 1, H_HEAD))
    return reqs, merges


def _paint(rng, sid, plan, ink):
    """Per-cell colour that carries the reading: chips, bars, heat, flags."""
    reqs = []
    for row, col, hexcode in plan["tint"]:
        if hexcode:
            reqs.append(_fmt(rng, sid, row, row + 1, col, col + 1,
                             backgroundColor=skills.rgb(hexcode)))
    for row, col, hexcode in plan["bars"]:
        if hexcode:
            reqs.append(_fmt(rng, sid, row, row + 1, col, col + 1,
                             textFormat={"fontSize": 10, "bold": True,
                                         "foregroundColor": _jewel(hexcode)}))
    for row, col in plan["flags"]:
        reqs.append(_fmt(rng, sid, row, row + 1, col, col + 1,
                         backgroundColor=ink["flagbg"],
                         textFormat={"fontSize": 10, "italic": True}))
    for row, c0, c1, fill, days in _runs(plan["cells"]):
        reqs.append(_fmt(rng, sid, row, row + 1, c0, c1,
                         backgroundColor=fill, horizontalAlignment="CENTER"))
        if not days:
            # a run of empties is ringed as one block, which reads as the one
            # finding it is: this chapter teaches none of these skills.
            edge = {"style": "SOLID", "color": HOLE_EDGE}
            reqs.append({"updateBorders": {
                "range": rng(sid, row, row + 1, c0, c1),
                "top": edge, "bottom": edge, "left": edge, "right": edge}})
    return reqs


def _filters(rng, sid, plan):
    """A filter per block. A sheet gets ONE basic filter, so every block after
    the first gets a named filter view instead — same affordance, no clash."""
    reqs = []
    for name, r0, r1, c0, c1, basic in plan["filters"]:
        rgn = rng(sid, r0, r1, c0, c1)
        if basic:
            reqs.append({"setBasicFilter": {"filter": {"range": rgn}}})
        else:
            reqs.append({"addFilterView": {
                "filter": {"title": name[:60], "range": rgn}}})
    return reqs


def _stale_views(svc, sheetio, sid):
    """Filter views are additive and this tab is rebuilt every run, so last
    run's views are dropped first or they pile up one copy per run."""
    meta = svc.spreadsheets().get(
        spreadsheetId=sheetio.SHEET_ID,
        fields="sheets(properties/sheetId,filterViews/filterViewId)").execute()
    out = []
    for sheet in meta.get("sheets", []):
        if sheet.get("properties", {}).get("sheetId") != sid:
            continue
        for view in sheet.get("filterViews", []) or []:
            out.append({"deleteFilterView": {"filterId":
                                             view["filterViewId"]}})
    return out


def format_coverage(svc, sheetio, sid, rows, plan):
    """Paint one coverage tab from its plan. Same signature for both tabs."""
    rng, ink, nrows = sheetio._rng, sheetio.INK, len(rows)
    reqs = _stale_views(svc, sheetio, sid)
    reqs += _frame(rng, sid, nrows, plan)
    body, merges = _rows(rng, sid, plan, ink, rows)
    reqs += body
    reqs += _paint(rng, sid, plan, ink)
    reqs += merges
    reqs += _filters(rng, sid, plan)
    for i in range(0, len(reqs), CHUNK):
        svc.spreadsheets().batchUpdate(
            spreadsheetId=sheetio.SHEET_ID,
            body={"requests": reqs[i:i + CHUNK]}).execute()
