"""Painting the FDE Syllabus tab. Split out of fdetab so both stay readable.

Ten columns, none wider than 150px, and three blocks that want different
shapes out of them. Two rules follow from that, and both were learnt from an
export:

    a paragraph gets MERGED across the full width. WRAP in an 80px column
    stacks a sentence one word per line and drags the row open; the intro did
    exactly that on the first export.

    a column header is painted only where there are columns to name. With
    nothing omitted the drops block is a single merged finding, so it has no
    header row — the old code painted DROP_HEAD regardless and left H26:J26
    coloured with nothing in it.

The breaks block is the third shape: a count, a label merged across B:E, and
a book list at F that overflows right across the empty tail. See _breaks.
"""
import sheetio

WIDTHS = {0: 80, 1: 90, 2: 100, 3: 115, 4: 150, 5: 95, 6: 110, 7: 105,
          8: 110, 9: 115}

OMIT_BG = {"red": 0.98, "green": 0.88, "blue": 0.88}
# The "nothing omitted" statement is a finding in its own right, so it is
# painted as one — green, not the red reserved for a real omission.
CLEAN_BG = {"red": 0.89, "green": 0.96, "blue": 0.90}
BAND_BG = {"red": 0.93, "green": 0.95, "blue": 0.98}
HEAD_BG = {"red": 0.11, "green": 0.21, "blue": 0.33}


def _band(sid, r, ncols, bg, bold=True, size=11, white=False):
    fmt = {"backgroundColor": bg,
           "textFormat": {"bold": bold, "fontSize": size}}
    if white:
        fmt["textFormat"]["foregroundColor"] = {"red": 1, "green": 1, "blue": 1}
    return {"repeatCell": {
        "range": {"sheetId": sid, "startRowIndex": r, "endRowIndex": r + 1,
                  "startColumnIndex": 0, "endColumnIndex": ncols},
        "cell": {"userEnteredFormat": fmt},
        "fields": "userEnteredFormat(backgroundColor,textFormat)"}}


def omitted_requests(sid, rows, ncols):
    """Tint the chapter banners the FDE syllabus skips, on the subject tabs."""
    return [_band(sid, r, ncols, OMIT_BG, size=10) for r in rows]


def _wide(sid, r, ncols):
    """A row whose only cell is a paragraph, merged so it has room to be read.

    Without this the intro sits in an 80px column with WRAP on and stacks one
    word per line down forty rows — which is what the first export showed.
    """
    return {"mergeCells": {
        "range": {"sheetId": sid, "startRowIndex": r, "endRowIndex": r + 1,
                  "startColumnIndex": 0, "endColumnIndex": ncols},
        "mergeType": "MERGE_ALL"}}


def _breaks(sid, plan, ncols):
    """The breaks block: a count, a merged label, and a list that overflows.

    Three columns of very different widths in a grid built for ten narrow
    ones. The count fits an 80px cell; the label is merged across B:E; the
    book list starts at F, where the four empty columns to its right let
    OVERFLOW_CELL carry it to full length without wrapping the row open.
    """
    head, end = plan["breaks_rows"]
    reqs = []
    for r in range(head, end):
        reqs.append({"mergeCells": {
            "range": {"sheetId": sid, "startRowIndex": r, "endRowIndex": r + 1,
                      "startColumnIndex": 1, "endColumnIndex": 5},
            "mergeType": "MERGE_ALL"}})
        reqs.append({"repeatCell": {
            "range": {"sheetId": sid, "startRowIndex": r, "endRowIndex": r + 1,
                      "startColumnIndex": 5, "endColumnIndex": ncols},
            "cell": {"userEnteredFormat": {
                "wrapStrategy": "OVERFLOW_CELL",
                "horizontalAlignment": "LEFT"}},
            "fields": "userEnteredFormat(wrapStrategy,horizontalAlignment)"}})
    return reqs


def format_fde(svc, sid, rows, plan):
    ncols = 10
    reqs = [
        {"unmergeCells": {
            "range": {"sheetId": sid, "startRowIndex": 0,
                      "endRowIndex": len(rows), "startColumnIndex": 0,
                      "endColumnIndex": ncols}}},
        {"updateSheetProperties": {
            "properties": {"sheetId": sid,
                           "gridProperties": {"frozenRowCount": 5}},
            "fields": "gridProperties.frozenRowCount"}},
        {"repeatCell": {
            "range": {"sheetId": sid, "startRowIndex": 0,
                      "endRowIndex": len(rows), "startColumnIndex": 0,
                      "endColumnIndex": ncols},
            "cell": {"userEnteredFormat": {
                "verticalAlignment": "TOP", "wrapStrategy": "WRAP",
                "textFormat": {"fontSize": 10}}},
            "fields": "userEnteredFormat(verticalAlignment,wrapStrategy,"
                      "textFormat)"}},
        _band(sid, 0, ncols, HEAD_BG, size=14, white=True),
        _band(sid, plan["body"][0] - 1, ncols, HEAD_BG, size=10, white=True),
        _band(sid, plan["total"], ncols, BAND_BG),
        _band(sid, plan["drops"][0], ncols, BAND_BG, size=12),
        _band(sid, plan["breaks"] - 2, ncols, BAND_BG, size=12),
        _band(sid, plan["breaks"], ncols, HEAD_BG, size=10, white=True),
    ]
    merged = [0, 1, 2, plan["drops"][0], plan["breaks"] - 2, plan["breaks"] - 1]
    # A column header is painted only where there are columns to name. With
    # nothing omitted the block is one merged sentence, so there is no header
    # row and no painted-but-empty tail (H26:J26 on the last export).
    if plan["drops_head"] is not None:
        reqs.append(_band(sid, plan["drops_head"], ncols, HEAD_BG, size=10,
                          white=True))
        body = range(plan["drops_head"] + 1, plan["drops"][1])
    else:
        merged.append(plan["finding"])
        body = range(plan["finding"], plan["drops"][1])
    reqs += [_wide(sid, r, ncols) for r in merged]
    body_bg = CLEAN_BG if plan.get("clean") else OMIT_BG
    reqs += [{"repeatCell": {
        "range": {"sheetId": sid, "startRowIndex": r, "endRowIndex": r + 1,
                  "startColumnIndex": 0, "endColumnIndex": ncols},
        "cell": {"userEnteredFormat": {"backgroundColor": body_bg}},
        "fields": "userEnteredFormat.backgroundColor"}}
        for r in body]
    reqs += _breaks(sid, plan, ncols)
    reqs += [{"updateDimensionProperties": {
        "range": {"sheetId": sid, "dimension": "COLUMNS",
                  "startIndex": i, "endIndex": i + 1},
        "properties": {"pixelSize": px}, "fields": "pixelSize"}}
        for i, px in WIDTHS.items()]
    for i in range(0, len(reqs), 200):
        svc.spreadsheets().batchUpdate(
            spreadsheetId=sheetio.SHEET_ID, body={"requests": reqs[i:i + 200]}).execute()
