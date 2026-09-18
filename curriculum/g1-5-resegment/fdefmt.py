"""The FDE-omitted tint on the subject tabs. What is left of fdefmt.

This module painted the `FDE Syllabus` tab. That tab is gone: its table is the
second half of `Calendar — assumptions` now, and `calfde.format_overview`
paints the whole of it — no merges, one band colour, one header colour, as
sheet.md §5.9 asks for. `format_fde` and its two merge helpers went with it.

What survives is the one thing that was never about that tab: a chapter the
FDE syllabus does not schedule gets its banner tinted red on its own subject
tab, wherever that chapter appears. Nothing in the 2026-27 corpus triggers it
— all 17 breakdown documents schedule every chapter — and it is kept for the
year one of them does not.
"""
OMIT_BG = {"red": 0.98, "green": 0.88, "blue": 0.88}


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
