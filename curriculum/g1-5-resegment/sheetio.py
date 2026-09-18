"""Sheets API plumbing for the G1-5 matrix.

Writes only. Tabs are dropped and recreated on rebuild, never patched in place:
one leftover merge makes a freeze fail, so patching never converges
(sheet.md §6 gotcha 3).
"""
import os

from google.oauth2 import service_account

import house
import standfirst
from googleapiclient.discovery import build

import quota  # noqa: F401  — importing it paces every call under the quota

SCOPES = ["https://www.googleapis.com/auth/drive",
          "https://www.googleapis.com/auth/spreadsheets"]

SHEET_ID = "14-ndk94fkTbqKn0MW4QPhMgLGTesswVj-_GTwe4GYio"

# The house palette (curriculum-matrix-sheet.md §5.1/§5.4). A tab reads as
# ours when these five colours appear in these five roles and nowhere else.
INK = {"title": {"red": 0.059, "green": 0.298, "blue": 0.361},   # #0F4C5C
       "head": {"red": 0.149, "green": 0.275, "blue": 0.325},    # #264653
       "band": {"red": 0.906, "green": 0.435, "blue": 0.318},    # #E76F51
       "cream": {"red": 0.957, "green": 0.945, "blue": 0.871},   # #F4F1DE
       "grade": {"red": 0.85, "green": 0.90, "blue": 0.96},
       "chapter": {"red": 0.93, "green": 0.95, "blue": 0.98},
       "flagbg": {"red": 1.0, "green": 0.95, "blue": 0.90},
       "rule": {"red": 0.80, "green": 0.80, "blue": 0.80},
       "link": {"red": 0.067, "green": 0.333, "blue": 0.800},    # #1155CC
       "sub": {"red": 0.294, "green": 0.333, "blue": 0.388},     # #4B5563
       "data": {"red": 0.122, "green": 0.161, "blue": 0.216},    # #1F2937
       "white": {"red": 1, "green": 1, "blue": 1}}


def client():
    path = os.environ["GOOGLE_SERVICE_ACCOUNT_PATH"]
    creds = service_account.Credentials.from_service_account_file(
        path, scopes=SCOPES)          # no delegation; SA is a Shared Drive member
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def tab_ids(svc):
    meta = svc.spreadsheets().get(spreadsheetId=SHEET_ID,
                                  fields="sheets.properties").execute()
    return {s["properties"]["title"]: s["properties"]["sheetId"]
            for s in meta["sheets"]}


def reset_tabs(svc, titles, cols, rows=None):
    """Drop the named tabs and recreate them empty. Returns {title: sheetId}.

    Sheets refuses to delete the last remaining tab, so a scratch tab is added
    first and removed once the real ones exist.

    `rows` sizes each new tab. A tab MUST be created at least as tall as the
    table going into it: values.update grows the grid, but a formatting
    request whose range runs past the declared rowCount is rejected, and the
    flat All Segments table is 2,041 rows against the old hardcoded 2,000.
    """
    existing = tab_ids(svc)
    reqs = [{"addSheet": {"properties": {"title": "__scratch__"}}}] \
        if "__scratch__" not in existing else []
    for title in titles:
        if title in existing:
            reqs.append({"deleteSheet": {"sheetId": existing[title]}})
    for title in titles:
        reqs.append({"addSheet": {"properties": {
            "title": title,
            "gridProperties": {
                "rowCount": max(2000, (rows or {}).get(title, 0) + 20),
                "columnCount": cols.get(title, 26)}}}})
    svc.spreadsheets().batchUpdate(spreadsheetId=SHEET_ID,
                                   body={"requests": reqs}).execute()
    made = tab_ids(svc)
    if "__scratch__" in made and len(made) > 1:
        svc.spreadsheets().batchUpdate(
            spreadsheetId=SHEET_ID,
            body={"requests": [{"deleteSheet": {"sheetId": made["__scratch__"]}}]}
        ).execute()
        made.pop("__scratch__")
    return made


def order_tabs(svc, titles):
    ids = tab_ids(svc)
    reqs = [{"updateSheetProperties": {
        "properties": {"sheetId": ids[t], "index": i},
        "fields": "index"}} for i, t in enumerate(titles) if t in ids]
    if reqs:
        svc.spreadsheets().batchUpdate(spreadsheetId=SHEET_ID,
                                       body={"requests": reqs}).execute()


def write_values(svc, title, rows):
    svc.spreadsheets().values().update(
        spreadsheetId=SHEET_ID, range=f"'{title}'!A1",
        valueInputOption="RAW", body={"values": rows}).execute()


def _rng(sid, r0, r1, c0, c1):
    return {"sheetId": sid, "startRowIndex": r0, "endRowIndex": r1,
            "startColumnIndex": c0, "endColumnIndex": c1}


def titled(rows, title, standfirst, at=2):
    """Prepend the house two-row band to a table whose first row is its header.

    Returns (rows, head_row). Long text cannot cross a frozen-column boundary,
    so the standfirst starts at the first UNFROZEN column and overflows right
    across the empty row; the title is short enough to live in column A.
    """
    n = len(rows[0])
    top = [""] * n
    top[0] = title
    sub = [""] * n
    sub[min(at, n - 1)] = standfirst
    return [top, sub] + rows, 2


def _dim(sid, kind, i0, i1, px):
    return {"updateDimensionProperties": {
        "range": {"sheetId": sid, "dimension": kind,
                  "startIndex": i0, "endIndex": i1},
        "properties": {"pixelSize": px}, "fields": "pixelSize"}}


def _fmt(sid, r0, r1, c0, c1, fmt):
    return {"repeatCell": {"range": _rng(sid, r0, r1, c0, c1),
                           "cell": {"userEnteredFormat": fmt},
                           "fields": "userEnteredFormat(" +
                                     ",".join(sorted(fmt)) + ")"}}


def format_grid(svc, sid, nrows, ncols, freeze_cols=2, banner_rows=(),
                sub_banner_rows=(), flag_col=None, widths=None,
                head_row=0, notes=None, groups=(), band=False, rows=None):
    """House formatting for a header-plus-rows tab.

    head_row is where the column header sits — 2 when the caller has run the
    table through titled(). Everything above it is the title band, and the
    freeze runs to the bottom of it, so the header stays on screen.

    Only the standfirst is merged, and only from the frozen boundary to the
    right-hand edge, which is entirely inside the unfrozen region: a merge
    ACROSS the frozen boundary is what makes the freeze request fail
    (sheet.md §6 gotcha 2), so banner rows are still painted, not merged.

    Base wrapStrategy is WRAP and the data rows are auto-resized. The earlier
    draft clipped by default, which silently hid every cell longer than its
    column — a 460-character SLO description read as a sentence fragment and
    there was no way to tell from the tab that anything was missing.

    One deliberate deviation from sheet.md §5, pinned by test_sheetio.py so
    it cannot be mistaken for drift: the header row stays 46px where §5.1
    asks for 36, because headers here WRAP and a two-line header clips at 36.
    (The 10pt data deviation is gone — Amena took the call on 2026-09-18 and
    chose §5.2's Arial 9; see house.py.)

    Pass `rows` — the table this call is about to format — and the standfirst
    is merged and heighted from the text it actually holds. Without it the
    row falls back to the house 28px, which clips any sentence that wraps.
    """
    white = {"foregroundColor": INK["white"]}
    reqs = [
        {"updateSheetProperties": {
            "properties": {"sheetId": sid, "gridProperties": {
                "frozenRowCount": head_row + 1,
                "frozenColumnCount": freeze_cols}},
            "fields": "gridProperties.frozenRowCount,"
                      "gridProperties.frozenColumnCount"}},
        _fmt(sid, 0, nrows, 0, ncols, {
            "verticalAlignment": "TOP", "wrapStrategy": "WRAP",
            "textFormat": {"fontSize": house.DATA_PT,
                           "foregroundColor": INK["data"]}}),
        _fmt(sid, head_row, head_row + 1, 0, ncols, {
            "backgroundColor": INK["head"], "verticalAlignment": "MIDDLE",
            "horizontalAlignment": "CENTER", "wrapStrategy": "WRAP",
            "textFormat": dict(white, bold=True,
                               fontSize=house.HEAD_PT)}),
    ]
    for col, px in (widths or {}).items():
        if col < ncols:
            reqs.append(_dim(sid, "COLUMNS", col, col + 1, px))
    if band and nrows > head_row + 1:
        reqs.append({"addBanding": {"bandedRange": {
            "range": _rng(sid, head_row, nrows, 0, ncols),
            "rowProperties": {
                "headerColor": INK["head"],
                "firstBandColor": INK["white"],
                "secondBandColor": INK["chapter"]}}}})
    # Banners carry their grammar token in column A and the readable remainder
    # in column B, because overflow stops at the frozen edge.
    # `band` here, not `rows`: `rows` is this function's table of values and
    # rebinding it left the standfirst below measuring an empty tuple.
    for band_rows, bg, size in ((banner_rows, INK["grade"], 11),
                                (sub_banner_rows, INK["chapter"], 10)):
        for r in band_rows:
            reqs.append(_fmt(sid, r, r + 1, 0, ncols, {
                "backgroundColor": bg, "wrapStrategy": "WRAP",
                "textFormat": {"bold": True, "fontSize": size}}))
    if head_row:
        # OVERFLOW_CELL is not a wrap strategy, it is a promise that nothing
        # sits to the right. On a grid with a fixed column count that promise
        # expires at the last column and the sentence is cut there without a
        # sound. So the standfirst is merged across the room it actually has,
        # WRAPped inside it, and the row heighted from its own text.
        sub = head_row - 1
        c0, c1 = standfirst.span(
            standfirst.column(rows[sub]) if rows else freeze_cols,
            ncols, freeze_cols)
        sub_px = (standfirst.row_px(rows, sub, widths, ncols, freeze_cols,
                                    house.SUB_PX) if rows else house.SUB_PX)
        reqs += [
            _fmt(sid, 0, 1, 0, ncols, {
                "backgroundColor": INK["title"],
                "wrapStrategy": "OVERFLOW_CELL",
                "verticalAlignment": "MIDDLE",
                "textFormat": dict(white, bold=True,
                                   fontSize=house.TITLE_PT)}),
            _fmt(sid, sub, sub + 1, 0, ncols, {
                "backgroundColor": INK["white"], "wrapStrategy": "WRAP",
                "verticalAlignment": "MIDDLE",
                "textFormat": {"fontSize": house.SUB_PT,
                               "foregroundColor": INK["sub"]}}),
            _dim(sid, "ROWS", 0, 1, house.TITLE_PX),
            _dim(sid, "ROWS", sub, sub + 1, sub_px),
        ]
        if c1 - c0 > 1:
            reqs.append({"unmergeCells": {
                "range": _rng(sid, sub, sub + 1, c0, c1)}})
            reqs.append({"mergeCells": {
                "range": _rng(sid, sub, sub + 1, c0, c1),
                "mergeType": "MERGE_ALL"}})
    if flag_col is not None and flag_col < ncols:
        reqs.append({"addConditionalFormatRule": {"index": 0, "rule": {
            "ranges": [_rng(sid, head_row + 1, nrows, flag_col, flag_col + 1)],
            "booleanRule": {
                "condition": {"type": "NOT_BLANK"},
                "format": {"backgroundColor": INK["flagbg"]}}}}})
    # A column a later stage fills is greyed and carries a note saying which
    # stage fills it, instead of 500 rows of the literal word "pending".
    for col, text in (notes or {}).items():
        if col >= ncols:
            continue
        reqs.append(_fmt(sid, head_row, head_row + 1, col, col + 1, {
            "backgroundColor": INK["rule"],
            "textFormat": {"bold": True, "fontSize": 9,
                           "italic": True, "foregroundColor": INK["title"]}}))
        reqs.append({"updateCells": {
            "range": _rng(sid, head_row, head_row + 1, col, col + 1),
            "rows": [{"values": [{"note": text}]}], "fields": "note"}})
    for c0, c1 in groups:
        reqs.append({"addDimensionGroup": {"range": {
            "sheetId": sid, "dimension": "COLUMNS",
            "startIndex": c0, "endIndex": c1}}})
    reqs.append({"setBasicFilter": {"filter": {
        "range": _rng(sid, head_row, nrows, 0, ncols)}}})
    reqs.append({"autoResizeDimensions": {"dimensions": {
        "sheetId": sid, "dimension": "ROWS",
        "startIndex": head_row + 1, "endIndex": nrows}}})
    reqs.append(_dim(sid, "ROWS", head_row, head_row + 1, 46))
    for i in range(0, len(reqs), 200):
        svc.spreadsheets().batchUpdate(
            spreadsheetId=SHEET_ID,
            body={"requests": reqs[i:i + 200]}).execute()
    if groups:
        svc.spreadsheets().batchUpdate(spreadsheetId=SHEET_ID, body={
            "requests": [{"updateDimensionGroup": {"dimensionGroup": {
                "range": {"sheetId": sid, "dimension": "COLUMNS",
                          "startIndex": c0, "endIndex": c1},
                "depth": 1, "collapsed": True},
                "fields": "collapsed"}} for c0, c1 in groups]}).execute()


def link_cells(svc, sid, cells):
    """cells: [(row, col, label, url)] — rich-text links, never =HYPERLINK()."""
    reqs = [{"updateCells": {
        "range": _rng(sid, r, r + 1, c, c + 1),
        "rows": [{"values": [{
            "userEnteredValue": {"stringValue": label},
            "userEnteredFormat": {"textFormat": {"link": {"uri": url},
                                                 "underline": True}}}]}],
        "fields": "userEnteredValue,userEnteredFormat.textFormat"}}
        for r, c, label, url in cells]
    for i in range(0, len(reqs), 200):
        svc.spreadsheets().batchUpdate(
            spreadsheetId=SHEET_ID,
            body={"requests": reqs[i:i + 200]}).execute()
