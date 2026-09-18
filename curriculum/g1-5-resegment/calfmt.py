"""Painting the Teaching Calendar. Split out of caltab so both stay readable.

The grid carries four layers of colour and they have to stack in this order,
because each later one is meant to show through as an exception to the one
before it:

    1. alternating chapter bands   — where one chapter ends and the next starts
    2. the FDE-omitted tint        — the one kind of period that leaves the book
    3. assessment columns          — FDE's own windows, straight down the page
    4. the 24 December rule        — and a rule at every vacation

Anything painted out of that order hides a fact rather than adding one. Every
one of them is load-bearing, which is why the fifth thing a cell has to say —
WHICH SKILL — is said in the colour of the two letters, not behind them; that
pass is calink's, and it runs last.

Basics periods — phonics, arkaan saazi, number fluency, communicative work —
are deliberately NOT given a colour of their own. They were, and a run of grey
blocks read as the class putting the textbook down for a fortnight, which is
exactly what teachers object to. They are taught on the current chapter's own
text and numbers, so they sit inside its band and are marked italic: a
different kind of period in the same chapter, not a departure from the book.

Two rules about text, learnt the hard way on this tab:

    nothing WRAPs. A wrapped paragraph in a 150px column comes out one word
    per line and drags the row to 400px. Long lines start past the frozen edge
    and overflow right across the empty grid instead.

    nothing MERGEs. A merge that crosses the frozen boundary makes the freeze
    request fail outright, so the five header rows are painted, not merged.
"""
import calink
BAND = [{"red": 0.84, "green": 0.90, "blue": 0.96},
        {"red": 0.92, "green": 0.96, "blue": 0.90}]
OMIT = {"red": 0.97, "green": 0.85, "blue": 0.85}     # FDE drops this chapter
AFTER = {"red": 0.88, "green": 0.86, "blue": 0.82}    # past 24 December
# Was 0.95/0.93/0.89, a pale cream a hair away from BAND[1]'s pale green:
# on the KEY they stacked as one mark printed twice. Warmer and darker,
# so "we are past the content deadline" reads as its own shade.
# Not only a swatch: this is the MEDIUM border drawn round every
# assessment-week column. It was 0.98/0.88/0.92 — the same pale pink as
# OMIT beside it in the legend, and as a border on a white sheet, a line
# nobody saw. A saturated violet is tellable from every other mark and
# actually draws.
ASSESS = {"red": 0.48, "green": 0.25, "blue": 0.55}
RULE = {"red": 0.72, "green": 0.25, "blue": 0.16}
# Grade 1's first six weeks: integrated FLN work, no chapter to be banded by,
# so unmarked they read as a gap where the book should be — the opposite of
# what they are. Warm gold, clear of OMIT (redmean 71) and AFTER (76), and
# warm rather than grey because the phase is a beginning, not an absence.
FOUNDATION = {"red": 0.99, "green": 0.88, "blue": 0.66}
GREY = {"red": 0.45, "green": 0.45, "blue": 0.45}
MONTH = {"red": 0.165, "green": 0.616, "blue": 0.561}  # #2A9D8F, the old band

KIND_BG = {"omitted": OMIT, "after": AFTER, "foundations": FOUNDATION}

# The MARKS section of the KEY names eight colours, lines and blanks. Naming
# is not showing: "alternating bands" cannot be described in words, only put
# side by side. caltab says WHICH mark goes on which row, by symbolic name;
# the colours stay here so the content module never imports the painter.
WHITE = {"red": 1.0, "green": 1.0, "blue": 1.0}
SWATCH_BG = {"band0": BAND[0], "band1": BAND[1], "omit": OMIT,
             "assess": ASSESS, "after": AFTER, "blank": WHITE,
             "foundations": FOUNDATION}
SWATCH_RULE = {"rule": RULE, "vac": GREY}


def knows_swatch(name):
    """Can this painter actually draw the mark the KEY promises?"""
    return name in SWATCH_BG or name in SWATCH_RULE or name == "italic"

# Basics — a different kind of period, so the code is italic. "foundations"
# is italic AND gold: italic for the same reason as the other two, gold
# because it is the one basics run that is NOT inside a chapter's band.
ITALIC = ("fill", "onramp", "foundations")
LEAD_W = [52, 165, 48, 48, 48]   # Grade · Subject · Per wk · Book · Basics
DAY_W = 30


def _runs(seq):
    """[(start, end, value)] for the contiguous runs of a list."""
    out, i = [], 0
    while i < len(seq):
        j = i
        while j + 1 < len(seq) and seq[j + 1] == seq[i]:
            j += 1
        out.append((i, j + 1, seq[i]))
        i = j + 1
    return out


def _height(sid, r0, r1, px):
    return {"updateDimensionProperties": {
        "range": {"sheetId": sid, "dimension": "ROWS",
                  "startIndex": r0, "endIndex": r1},
        "properties": {"pixelSize": px}, "fields": "pixelSize"}}


def _width(sid, c0, c1, px):
    return {"updateDimensionProperties": {
        "range": {"sheetId": sid, "dimension": "COLUMNS",
                  "startIndex": c0, "endIndex": c1},
        "properties": {"pixelSize": px}, "fields": "pixelSize"}}


def _paint(rng, sid, r0, r1, c0, c1, fmt):
    return {"repeatCell": {"range": rng(sid, r0, r1, c0, c1),
                           "cell": {"userEnteredFormat": fmt},
                           "fields": "userEnteredFormat(" +
                                     ",".join(sorted(fmt)) + ")"}}


def _frame(rng, sid, nrows, ncols, plan, ink):
    """Five frozen header rows, five frozen lead columns, nothing merged."""
    lead, top = plan["lead"], plan["grid_top"]
    white = {"foregroundColor": ink["white"]}
    reqs = [
        {"updateSheetProperties": {"properties": {
            "sheetId": sid, "gridProperties": {
                "frozenRowCount": top + plan["head_rows"],
                "frozenColumnCount": lead}},
            "fields": "gridProperties.frozenRowCount,"
                      "gridProperties.frozenColumnCount"}},
        _paint(rng, sid, 0, nrows, 0, ncols, {
            "verticalAlignment": "MIDDLE", "horizontalAlignment": "CENTER",
            "wrapStrategy": "CLIP", "textFormat": {"fontSize": 9}}),
        # Row 0 the title, row 1 the one-line standfirst. Both left-aligned
        # and overflowing, so neither is cut at the frozen edge.
        _paint(rng, sid, 0, 1, 0, ncols, {
            "backgroundColor": ink["title"], "horizontalAlignment": "LEFT",
            "wrapStrategy": "OVERFLOW_CELL",
            "textFormat": dict(white, bold=True, fontSize=13)}),
        _paint(rng, sid, 1, 2, 0, ncols, {
            "backgroundColor": ink["cream"], "horizontalAlignment": "LEFT",
            "wrapStrategy": "OVERFLOW_CELL", "textFormat": {"fontSize": 10}}),
        # Month band, then day-of-month and weekday on the house header ink.
        _paint(rng, sid, top, top + 1, 0, ncols, {
            "backgroundColor": MONTH, "horizontalAlignment": "LEFT",
            "wrapStrategy": "OVERFLOW_CELL",
            "textFormat": dict(white, bold=True, fontSize=9)}),
        _paint(rng, sid, top + 1, top + plan["head_rows"], 0, ncols, {
            "backgroundColor": ink["head"], "wrapStrategy": "CLIP",
            "textFormat": dict(white, bold=True, fontSize=8)}),
        # The lead columns of the grid read as labels, not as data.
        _paint(rng, sid, plan["body_top"],
               plan["body_top"] + plan["body_rows"], 0, 2, {
                   "horizontalAlignment": "LEFT",
                   "textFormat": {"bold": True, "fontSize": 10}}),
        _height(sid, 0, nrows, 21),
        _height(sid, 0, 1, 34),
        _height(sid, 1, 2, 26),
        _height(sid, plan["body_top"], plan["body_top"] + plan["body_rows"],
                23),
        _width(sid, lead, ncols, DAY_W),
    ]
    reqs += [_width(sid, i, i + 1, w) for i, w in enumerate(LEAD_W[:lead])]
    return reqs


def _key(rng, sid, ncols, plan, ink):
    """The legend below the grid: chips left, explanations overflowing right."""
    reqs = []
    for row in plan["over"]:
        reqs.append(_paint(rng, sid, row, row + 1, 0, ncols, {
            "horizontalAlignment": "LEFT", "wrapStrategy": "OVERFLOW_CELL"}))
    for row in plan["sections"]:
        reqs.append(_paint(rng, sid, row, row + 1, 0, ncols, {
            "backgroundColor": ink["band"], "horizontalAlignment": "LEFT",
            "wrapStrategy": "OVERFLOW_CELL",
            "textFormat": {"bold": True, "fontSize": 11,
                           "foregroundColor": ink["white"]}}))
        reqs.append(_paint(rng, sid, row + 1, row + 2, 0, ncols, {
            "backgroundColor": ink["chapter"], "horizontalAlignment": "LEFT",
            "textFormat": {"bold": True, "fontSize": 9}}))
    reqs += calink.chip_requests(_paint, rng, sid, plan["chips"], ink["cream"])
    # Painted LAST: the `over` and `sections` passes above write the whole row
    # width, so a swatch laid before them would be overwritten by its own row.
    for row, c0, c1, name in plan["swatch"]:
        if name == "italic":
            reqs.append(_paint(rng, sid, row, row + 1, c0, c1, {
                "backgroundColor": BAND[0], "horizontalAlignment": "CENTER",
                "textFormat": {"italic": True, "bold": True, "fontSize": 9}}))
        elif name in SWATCH_BG:
            reqs.append(_paint(rng, sid, row, row + 1, c0, c1,
                               {"backgroundColor": SWATCH_BG[name]}))
            if name == "blank":
                # An empty cell is only legible as a mark if it is outlined —
                # otherwise the swatch IS the rest of the row.
                reqs.append({"updateBorders": {
                    "range": rng(sid, row, row + 1, c0, c1),
                    "top": {"style": "SOLID", "color": GREY},
                    "bottom": {"style": "SOLID", "color": GREY},
                    "left": {"style": "SOLID", "color": GREY},
                    "right": {"style": "SOLID", "color": GREY}}})
        else:
            reqs.append(_paint(rng, sid, row, row + 1, c0, c1,
                               {"backgroundColor": BAND[0]}))
            reqs.append({"updateBorders": {
                "range": rng(sid, row, row + 1, c0, c1),
                "left": {"style": "SOLID_THICK",
                         "color": SWATCH_RULE[name]}}})
    return reqs


def _grid(rng, sid, plan):
    lead, top = plan["lead"], plan["body_top"]
    bottom = top + plan["body_rows"]
    reqs = []
    for i, (band, kinds) in enumerate(zip(plan["bands"], plan["kinds"])):
        row = top + i
        for c0, c1, chap in _runs(band):
            if chap is None:
                continue
            reqs.append(_paint(rng, sid, row, row + 1, lead + c0, lead + c1,
                               {"backgroundColor": BAND[chap % 2]}))
        for c0, c1, kind in _runs(kinds):
            if kind in KIND_BG:
                reqs.append(_paint(rng, sid, row, row + 1, lead + c0,
                                   lead + c1,
                                   {"backgroundColor": KIND_BG[kind]}))
            # NOT elif: a kind can be both. While it was, ITALIC membership
            # was dead for anything KIND_BG already named.
            if kind in ITALIC:
                reqs.append({"repeatCell": {
                    "range": rng(sid, row, row + 1, lead + c0, lead + c1),
                    "cell": {"userEnteredFormat": {
                        "textFormat": {"italic": True}}},
                    "fields": "userEnteredFormat.textFormat.italic"}})
    for c0, c1, hit in _runs([c in plan["assessment_cols"]
                              for c in range(lead, plan["n_cols"])]):
        if not hit:
            continue
        reqs.append({"updateBorders": {
            "range": rng(sid, plan["grid_top"], bottom, lead + c0, lead + c1),
            "top": {"style": "SOLID_MEDIUM", "color": ASSESS},
            "bottom": {"style": "SOLID_MEDIUM", "color": ASSESS},
            "left": {"style": "SOLID_MEDIUM", "color": ASSESS},
            "right": {"style": "SOLID_MEDIUM", "color": ASSESS}}})
    for col in plan["break_cols"] + [plan["content_cut"]]:
        cut = col == plan["content_cut"]
        reqs.append({"updateBorders": {
            "range": rng(sid, plan["grid_top"], bottom, col, col + 1),
            "left": {"style": "SOLID_THICK" if cut else "SOLID_MEDIUM",
                     "color": RULE if cut else GREY}}})
    return reqs


def _send(svc, sheetio, reqs):
    for i in range(0, len(reqs), 200):
        svc.spreadsheets().batchUpdate(
            spreadsheetId=sheetio.SHEET_ID,
            body={"requests": reqs[i:i + 200]}).execute()


def format_calendar(svc, sheetio, sid, rows, plan):
    rng, ink = sheetio._rng, sheetio.INK
    reqs = _frame(rng, sid, len(rows), plan["n_cols"], plan, ink)
    reqs += _grid(rng, sid, plan)
    reqs += _key(rng, sid, plan["n_cols"], plan, ink)
    # LAST, and it must stay last: _frame writes whole `textFormat` objects,
    # which would take the foreground colour back out with them.
    reqs += calink.ink_requests(rng, sid, rows, plan)
    _send(svc, sheetio, reqs)


def format_overview(svc, sheetio, sid, rows, plan):
    """The companion tab: wide columns, no freeze, everything overflows."""
    rng, ink = sheetio._rng, sheetio.INK
    nrows, ncols = len(rows), plan["n_cols"]
    reqs = [
        {"updateSheetProperties": {"properties": {
            "sheetId": sid,
            "gridProperties": {"frozenRowCount": 2, "frozenColumnCount": 0}},
            "fields": "gridProperties.frozenRowCount,"
                      "gridProperties.frozenColumnCount"}},
        _paint(rng, sid, 0, nrows, 0, ncols, {
            "verticalAlignment": "MIDDLE", "horizontalAlignment": "LEFT",
            "wrapStrategy": "OVERFLOW_CELL", "textFormat": {"fontSize": 10}}),
        _paint(rng, sid, 0, 1, 0, ncols, {
            "backgroundColor": ink["title"],
            "textFormat": {"bold": True, "fontSize": 13,
                           "foregroundColor": ink["white"]}}),
        _paint(rng, sid, 1, 2, 0, ncols, {"backgroundColor": ink["cream"]}),
        _height(sid, 0, nrows, 22),
        _height(sid, 0, 1, 34),
    ]
    reqs += [_width(sid, i, i + 1, w) for i, w in enumerate(plan["widths"])]
    for row in plan["sections"]:
        reqs.append(_paint(rng, sid, row, row + 1, 0, ncols, {
            "backgroundColor": ink["band"],
            "textFormat": {"bold": True, "fontSize": 11,
                           "foregroundColor": ink["white"]}}))
    for row in plan["heads"]:
        reqs.append(_paint(rng, sid, row, row + 1, 0, ncols, {
            "backgroundColor": ink["chapter"],
            "textFormat": {"bold": True, "fontSize": 9}}))
    _send(svc, sheetio, reqs)
