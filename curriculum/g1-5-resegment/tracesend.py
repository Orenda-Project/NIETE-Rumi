# -*- coding: utf-8 -*-
"""Trace cells as Sheets requests. Pure: builds requests, sends nothing.

A cell with several links is textFormatRuns -- a cell-level field, beside
userEnteredValue rather than inside userEnteredFormat. Each run sets the
format from its startIndex until the next run, so a link run must be
followed by a plain one or it bleeds: the page 2 link would swallow the
separator and every page after it. The one exception is a link that ends
at the end of the string, where a closing run would sit out of range and
Sheets rejects the request.
"""
LINK = {"link": None, "underline": True,
        "foregroundColor": {"red": 0.06, "green": 0.33, "blue": 0.60}}
BATCH = 400


def _fmt(uri):
    f = dict(LINK)
    f["link"] = {"uri": uri}
    return f


def _cell(sid, row, col, value, runs):
    return {"updateCells": {
        "range": {"sheetId": sid, "startRowIndex": row, "endRowIndex": row + 1,
                  "startColumnIndex": col, "endColumnIndex": col + 1},
        "rows": [{"values": [{"userEnteredValue": {"stringValue": value},
                              "textFormatRuns": runs}]}],
        "fields": "userEnteredValue,textFormatRuns"}}


def rich_cell(sid, row, col, cell):
    """A page-truth cell: one link per printed page, plain text between."""
    text = cell["text"]
    runs = [{"startIndex": 0, "format": {}}]
    for r in cell["runs"]:
        if r["start"] > runs[-1]["startIndex"]:
            runs.append({"startIndex": r["start"], "format": _fmt(r["uri"])})
        else:
            runs[-1] = {"startIndex": r["start"], "format": _fmt(r["uri"])}
        if r["end"] < len(text):
            runs.append({"startIndex": r["end"], "format": {}})
    return _cell(sid, row, col, text, runs)


def link_cell(sid, row, col, label, uri):
    """A whole-cell link: the stage left one artefact for this row."""
    return _cell(sid, row, col, label,
                 [{"startIndex": 0, "format": _fmt(uri)}])


def header_cell(sid, row, col, title):
    return {"updateCells": {
        "range": {"sheetId": sid, "startRowIndex": row, "endRowIndex": row + 1,
                  "startColumnIndex": col, "endColumnIndex": col + 1},
        "rows": [{"values": [{"userEnteredValue": {"stringValue": title}}]}],
        "fields": "userEnteredValue"}}


def chunks(items, size=BATCH):
    for i in range(0, len(items), size):
        yield items[i:i + size]
