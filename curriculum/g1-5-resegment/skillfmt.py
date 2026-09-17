"""Painting the Skills Map.

Three things carry the meaning and all three are colour or height, so they are
decided here rather than left to whoever reads the characters:

  the track takes its skill's own colour, the same colour that skill has on
  every other tab, darkened enough to read as text on white — the pale chip
  hexes are backgrounds, and a pale ▌ on white is invisible;

  a grade that never teaches the skill is a struck, red-tinted band, so an
  absence is louder than a presence rather than quieter than one;

  a chapter-close-slot-only row is amber, the assessment colour, because that
  row is the day-versus-slot convention showing up in the data.

FROZEN COLUMNS: this tab sets frozenColumnCount to 0 on purpose. Every title,
subtitle, legend and section band on this tab is one long string starting in
column A, and an OVERFLOW_CELL string cannot cross a frozen-column boundary —
it truncates at the pixel width of the frozen block. With three narrow
scanning columns frozen that is ~350px, which is where this workbook's titles
have been dying. Only the three header rows are frozen; the tab is 1380px
wide, so there is nothing to freeze columns for.
"""
import skills

WHITE = {"red": 1, "green": 1, "blue": 1}
GONE = {"red": 0.99, "green": 0.90, "blue": 0.90}      # never taught
GONE_INK = {"red": 0.62, "green": 0.19, "blue": 0.16}
SLOT = {"red": 1.0, "green": 0.96, "blue": 0.88}       # chapter-close slot only
SLOT_INK = {"red": 0.52, "green": 0.38, "blue": 0.10}

ROW_PX = 22          # track rows: one line, never wrapped
PROSE_PX = 34        # the few rows that carry a sentence
HEAD_PX = (42, 32, 30)


def _dark(hexcode, k=0.55):
    """The chip colour pulled toward black so it reads as text.

    The palette in skills.py is a background palette — #FCE7C8 as a foreground
    on white is a smudge. k is how much of the original survives.
    """
    c = skills.rgb(hexcode)
    return {ch: round(v * k, 4) for ch, v in c.items()}


def _frame(rng, sid, nrows, ncols, ink, plan):
    """Title band, subtitle, header row, freeze, widths, default row height."""
    return [
        {"repeatCell": {
            "range": rng(sid, 0, nrows, 0, ncols),
            "cell": {"userEnteredFormat": {
                "verticalAlignment": "MIDDLE", "wrapStrategy": "CLIP",
                "backgroundColor": WHITE,
                "textFormat": {"fontSize": 10, "bold": False,
                               "strikethrough": False,
                               "foregroundColor": {"red": 0, "green": 0,
                                                   "blue": 0}}}},
            "fields": "userEnteredFormat(verticalAlignment,wrapStrategy,"
                      "backgroundColor,textFormat)"}},
        # Row 0 — title band. OVERFLOW_CELL is safe: no frozen columns, and
        # every other cell in the row is empty.
        {"repeatCell": {
            "range": rng(sid, 0, 1, 0, ncols),
            "cell": {"userEnteredFormat": {
                "backgroundColor": ink["title"], "wrapStrategy": "OVERFLOW_CELL",
                "textFormat": {"bold": True, "fontSize": 14,
                               "foregroundColor": WHITE}}},
            "fields": "userEnteredFormat(backgroundColor,wrapStrategy,"
                      "textFormat)"}},
        # Row 1 — subtitle, plain on cream. It states the day/slot convention
        # and runs past column I into empty columns; that is why it overflows
        # rather than wraps (a WRAP would confine it to column A's 250px).
        {"repeatCell": {
            "range": rng(sid, 1, 2, 0, ncols),
            "cell": {"userEnteredFormat": {
                "backgroundColor": ink["cream"], "wrapStrategy": "OVERFLOW_CELL",
                "textFormat": {"bold": False, "fontSize": 10}}},
            "fields": "userEnteredFormat(backgroundColor,wrapStrategy,"
                      "textFormat)"}},
        # Row 2 — column headers.
        {"repeatCell": {
            "range": rng(sid, 2, 3, 0, ncols),
            "cell": {"userEnteredFormat": {
                "backgroundColor": ink["head"], "wrapStrategy": "CLIP",
                "verticalAlignment": "MIDDLE",
                "textFormat": {"bold": True, "fontSize": 10,
                               "foregroundColor": WHITE}}},
            "fields": "userEnteredFormat(backgroundColor,wrapStrategy,"
                      "verticalAlignment,textFormat)"}},
        {"updateSheetProperties": {"properties": {
            "sheetId": sid,
            "gridProperties": {"frozenRowCount": plan.get("head_rows", 3),
                               "frozenColumnCount": 0}},
            "fields": "gridProperties.frozenRowCount,"
                      "gridProperties.frozenColumnCount"}},
        # Every data row gets an explicit height. Without one a wrapped or
        # overflowing row grows to fit its string and the tab stops scrolling.
        {"updateDimensionProperties": {
            "range": {"sheetId": sid, "dimension": "ROWS",
                      "startIndex": 3, "endIndex": nrows},
            "properties": {"pixelSize": ROW_PX}, "fields": "pixelSize"}},
    ] + [
        {"updateDimensionProperties": {
            "range": {"sheetId": sid, "dimension": "ROWS",
                      "startIndex": i, "endIndex": i + 1},
            "properties": {"pixelSize": px}, "fields": "pixelSize"}}
        for i, px in enumerate(HEAD_PX)
    ] + [
        {"updateDimensionProperties": {
            "range": {"sheetId": sid, "dimension": "COLUMNS",
                      "startIndex": col, "endIndex": col + 1},
            "properties": {"pixelSize": px}, "fields": "pixelSize"}}
        for col, px in sorted(plan.get("widths", {}).items()) if col < ncols
    ]


def _sections(rng, sid, ncols, ink, plan):
    """Coral band, then the block's own header row under it."""
    reqs = []
    for r in plan["sections"]:
        reqs.append({"repeatCell": {
            "range": rng(sid, r, r + 1, 0, ncols),
            "cell": {"userEnteredFormat": {
                "backgroundColor": ink["band"],
                "wrapStrategy": "OVERFLOW_CELL",
                "textFormat": {"bold": True, "fontSize": 12,
                               "foregroundColor": WHITE}}},
            "fields": "userEnteredFormat(backgroundColor,wrapStrategy,"
                      "textFormat)"}})
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": sid, "dimension": "ROWS",
                      "startIndex": r, "endIndex": r + 1},
            "properties": {"pixelSize": 30}, "fields": "pixelSize"}})
        reqs.append({"repeatCell": {
            "range": rng(sid, r + 1, r + 2, 0, ncols),
            "cell": {"userEnteredFormat": {
                "backgroundColor": ink["chapter"],
                "verticalAlignment": "MIDDLE",
                "textFormat": {"bold": True, "fontSize": 9}}},
            "fields": "userEnteredFormat(backgroundColor,verticalAlignment,"
                      "textFormat)"}})
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": sid, "dimension": "ROWS",
                      "startIndex": r + 1, "endIndex": r + 2},
            "properties": {"pixelSize": 26}, "fields": "pixelSize"}})
    return reqs


def _tracks(rng, sid, plan):
    """The skill stripe on the left and the track's own colour on the right."""
    reqs, track = [], plan.get("track_col", 8)
    c0, c1 = plan.get("skill_cols", (0, 1))
    for row, hexcode in plan["tint"]:
        if not hexcode:
            continue
        reqs.append({"repeatCell": {
            "range": rng(sid, row, row + 1, c0, c1 + 1),
            "cell": {"userEnteredFormat": {
                "backgroundColor": skills.rgb(hexcode)}},
            "fields": "userEnteredFormat.backgroundColor"}})
        reqs.append({"repeatCell": {
            "range": rng(sid, row, row + 1, track, track + 1),
            "cell": {"userEnteredFormat": {
                "textFormat": {"foregroundColor": _dark(hexcode),
                               "fontSize": 10}}},
            "fields": "userEnteredFormat.textFormat"}})
    return reqs


def _flags(rng, sid, ncols, plan):
    """Absence and slot-only rows. Absence is struck; it is the finding."""
    reqs = []
    for row in plan.get("absent_rows", ()):
        reqs.append({"repeatCell": {
            "range": rng(sid, row, row + 1, 0, ncols),
            "cell": {"userEnteredFormat": {
                "backgroundColor": GONE,
                "textFormat": {"strikethrough": True, "fontSize": 10,
                               "foregroundColor": GONE_INK}}},
            "fields": "userEnteredFormat(backgroundColor,textFormat)"}})
    for row in plan.get("slot_rows", ()):
        reqs.append({"repeatCell": {
            "range": rng(sid, row, row + 1, 0, ncols),
            "cell": {"userEnteredFormat": {
                "backgroundColor": SLOT,
                "textFormat": {"italic": True, "fontSize": 10,
                               "foregroundColor": SLOT_INK}}},
            "fields": "userEnteredFormat(backgroundColor,textFormat)"}})
    return reqs


def _prose(rng, sid, ncols, plan):
    """Sentence rows: overflow across their empty neighbours, and get a
    height set by hand so they cannot balloon."""
    reqs = []
    for row in plan.get("prose_rows", ()):
        reqs.append({"repeatCell": {
            "range": rng(sid, row, row + 1, 0, ncols),
            "cell": {"userEnteredFormat": {
                "wrapStrategy": "OVERFLOW_CELL",
                "verticalAlignment": "MIDDLE",
                "textFormat": {"fontSize": 10, "italic": True}}},
            "fields": "userEnteredFormat(wrapStrategy,verticalAlignment,"
                      "textFormat)"}})
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": sid, "dimension": "ROWS",
                      "startIndex": row, "endIndex": row + 1},
            "properties": {"pixelSize": PROSE_PX}, "fields": "pixelSize"}})
    return reqs


def _cells(rng, sid, plan):
    """Per-cell background — the early/late ramp on first-appearance."""
    return [{"repeatCell": {
        "range": rng(sid, row, row + 1, col, col + 1),
        "cell": {"userEnteredFormat": {
            "backgroundColor": skills.rgb(hexcode),
            "horizontalAlignment": "CENTER"}},
        "fields": "userEnteredFormat(backgroundColor,horizontalAlignment)"}}
        for row, col, hexcode in plan.get("cells", ())]


def _wrap(rng, sid, nrows, plan):
    return [{"repeatCell": {
        "range": rng(sid, 3, nrows, c, c + 1),
        "cell": {"userEnteredFormat": {"wrapStrategy": "WRAP"}},
        "fields": "userEnteredFormat.wrapStrategy"}}
        for c in plan.get("wrap_cols", ()) if c < plan["n_cols"]]


def format_skillmap(svc, sheetio, sid, rows, plan):
    ncols, nrows = plan["n_cols"], len(rows)
    rng, ink = sheetio._rng, sheetio.INK
    reqs = _frame(rng, sid, nrows, ncols, ink, plan)
    reqs += _sections(rng, sid, ncols, ink, plan)
    reqs += _wrap(rng, sid, nrows, plan)
    reqs += _tracks(rng, sid, plan)
    reqs += _cells(rng, sid, plan)
    reqs += _flags(rng, sid, ncols, plan)
    reqs += _prose(rng, sid, ncols, plan)
    for i in range(0, len(reqs), 200):
        svc.spreadsheets().batchUpdate(
            spreadsheetId=sheetio.SHEET_ID,
            body={"requests": reqs[i:i + 200]}).execute()
