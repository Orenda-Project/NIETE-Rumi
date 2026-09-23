"""Painting the Navigation tab. The requests, separate from what they say.

Split out of `navtab`, which had reached the file limit. The seam was already
there: everything above it answers "what does the index say", everything here
answers "what does it look like on the sheet", and the two halves shared not a
single name. `navtab.build` returns (rows, plan) and this module turns that
into batchUpdate requests -- so a change to the wording never reopens the
formatting, and a formatting fix never risks the wording.

Links are rich text and never `=HYPERLINK()`, same house rule as everywhere
else in this build: the link rides on the cell's own textFormat.
"""
import house
import standfirst
import support


def _rgb(hexcode):
    h = hexcode.lstrip("#")
    return {k: int(h[i:i + 2], 16) / 255 for i, k in ((0, "red"), (2, "green"), (4, "blue"))}


def _dim(sid, axis, start, end, px):
    return {"updateDimensionProperties": {
        "range": {"sheetId": sid, "dimension": axis, "startIndex": start, "endIndex": end},
        "properties": {"pixelSize": px}, "fields": "pixelSize"}}


def _fill(rng, sid, r0, r1, c0, c1, bg, size=house.DATA_PT, fg=None,
          bold=False, wrap="OVERFLOW_CELL", valign="MIDDLE"):
    txt = {"bold": bold, "fontSize": size}
    if fg:
        txt["foregroundColor"] = fg
    return {"repeatCell": {"range": rng(sid, r0, r1, c0, c1), "cell": {"userEnteredFormat": {
        "backgroundColor": bg, "wrapStrategy": wrap, "verticalAlignment": valign,
        "textFormat": txt}}, "fields": "userEnteredFormat(backgroundColor,wrapStrategy,"
                                       "verticalAlignment,textFormat)"}}


def _heights(sid, heights):
    """One updateDimensionProperties per run of equal, contiguous heights."""
    out, items, i = [], sorted(heights.items()), 0
    while i < len(items):
        j = i
        while j + 1 < len(items) and items[j + 1] == (items[j][0] + 1, items[i][1]):
            j += 1
        out.append(_dim(sid, "ROWS", items[i][0], items[j][0] + 1, items[i][1]))
        i = j + 1
    return out


def _linkcell(rng, sid, r, c, label, uri, ink, bg):
    """Rich text, never =HYPERLINK(): the link rides on the cell's own textFormat."""
    fmt = {"backgroundColor": bg, "wrapStrategy": "WRAP", "verticalAlignment": "TOP",
           "textFormat": {"link": {"uri": uri}, "underline": True, "bold": True, "fontSize": 10,
                          "foregroundColor": ink["link"]}}
    return {"updateCells": {
        "range": rng(sid, r, r + 1, c, c + 1),
        "rows": [{"values": [{"userEnteredValue": {"stringValue": label},
                              "userEnteredFormat": fmt}]}],
        "fields": "userEnteredValue,userEnteredFormat(backgroundColor,wrapStrategy,"
                  "verticalAlignment,textFormat)"}}


def format_navigation(svc, sheetio, sid, rows, plan, ids):
    """ids: {tab title: sheetId}. A tab missing from ids stays plain text, never a dead link."""
    rng, ink = sheetio._rng, sheetio.INK
    n, nrows, foot = plan["n_cols"], len(rows), plan["footer"]
    reqs = [
        {"unmergeCells": {"range": rng(sid, 0, nrows, 0, n)}},
        {"updateSheetProperties": {
            "properties": {"sheetId": sid, "gridProperties": {
                "frozenRowCount": plan["freeze"], "frozenColumnCount": 0}},
            "fields": "gridProperties(frozenRowCount,frozenColumnCount)"}},
        _fill(rng, sid, 0, nrows, 0, n, ink["white"], wrap="WRAP", valign="TOP"),
        _fill(rng, sid, 0, 1, 0, n, ink["title"], house.TITLE_PT, fg=ink["white"], bold=True),
        _fill(rng, sid, 1, 2, 0, n, ink["white"], house.SUB_PT, fg=ink["sub"], wrap="WRAP"),
        _fill(rng, sid, 2, 3, 0, n, ink["head"], house.HEAD_PT, fg=ink["white"], bold=True),
        _fill(rng, sid, foot, foot + 1, 0, n, ink["head"], fg=ink["white"]),
    ]
    reqs += [_fill(rng, sid, r, r + 1, 0, n, ink["band"], house.BAND_PT, fg=ink["white"], bold=True)
             for r in plan["sections"]]
    reqs += [_fill(rng, sid, r, r + 1, 1, 2, ink["cream"], bold=True, wrap="WRAP", valign="TOP")
             for r in plan["labels"]]
    reqs += [{"repeatCell": {"range": rng(sid, r, r + 1, 0, 1),
                             "cell": {"userEnteredFormat": {"backgroundColor": _rgb(h)}},
                             "fields": "userEnteredFormat.backgroundColor"}}
             for r, h in plan["tint"]]
    reqs += [_dim(sid, "COLUMNS", c, c + 1, px) for c, px in plan["widths"].items()]
    reqs += _heights(sid, plan["heights"])
    # _height sizes this row with a 10pt estimate, but the cell above renders
    # it at house.SUB_PT (11) — so the line COUNT is right and every line is
    # a few pixels short, which clips the last one. QA Checklist: 3 lines
    # given 53px, needing 58. Re-height from the text at the size it is
    # actually drawn at, after _heights so this is the request that lands.
    reqs.append(_dim(sid, "ROWS", 1, 2, standfirst.row_px(
        rows, 1, plan["widths"], n, 0, plan["heights"].get(1, house.SUB_PX))))
    # Full-width merges are legal here only because this tab freezes no columns.
    reqs += [{"mergeCells": {"range": rng(sid, r, r + 1, 0, n), "mergeType": "MERGE_ALL"}}
             for r in plan["merges"]]
    for r, title in plan["links"]:
        gid = ids.get(title)
        if gid is None:
            continue
        uri = f"{support.SHEET_URL}/edit#gid={gid}"
        reqs.append(_linkcell(rng, sid, r, 1, title, uri, ink, ink["cream"]))
        reqs.append(_linkcell(rng, sid, r, 6, "open ↗", uri, ink, ink["white"]))
    for i in range(0, len(reqs), 200):
        svc.spreadsheets().batchUpdate(spreadsheetId=sheetio.SHEET_ID,
                                       body={"requests": reqs[i:i + 200]}).execute()
