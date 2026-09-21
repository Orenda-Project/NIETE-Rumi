# -*- coding: utf-8 -*-
"""Write the trace block on the G1-5 resegmentation matrix.

    python3 tracerun.py            # dry run: report, touch nothing
    python3 tracerun.py --write

traces.md is binding: save, publish, link, stamp. This is the link step
for the three stages that have run. Page truth is relinked from the
previous ICT build, whose 1,712 published objects are still live;
segmentation and enrichment are this sheet, so they anchor back into the
row that holds them. Every other stage is left empty on purpose.

The previous build's block sits at a different column on every tab (AD,
AE, AG), which is why the harvest resolves it by header label and never
by letter -- traces.md warns about exactly this.
"""
import collections
import datetime
import re
import sys

import sheetio
import stagec
import tabs
import tracelinks as tl
import tracesend as ts

SHEET = "14-ndk94fkTbqKn0MW4QPhMgLGTesswVj-_GTwe4GYio"
PREV = "1zpRop18Y1kNLbuYr31BU7B1qk_7DFy_LL9in1zTgtws"
PREV_TABS = ("Urdu", "English", "Maths", "Science")
PREV_HEAD = u"A · Page truth"
HEAD_ROW = 3                       # 1-based; the header row on every tab
TABS = [("English", u"English G1–5"), ("Urdu", u"Urdu G1–5"),
        ("Maths", u"Maths G1–5"), ("Science", u"Science G4–5")]
TRACED_KINDS = ("day", "assessment", "review")
_PT = re.compile(r"/page-truth/[0-9a-f]{8}/([a-z0-9_]+)/pg_(\d+)\.json")


def letter(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def harvest(svc):
    """(book, page) -> live URL, from the previous build's own sheet.

    The objects are content-addressed and still resolve, so this is the
    published page truth for the same 17 books. Resolved by header label:
    the block starts at AD on Urdu and Science, AE on English, AG on Maths.
    """
    out = {}
    for tab in PREV_TABS:
        head = svc.spreadsheets().values().get(
            spreadsheetId=PREV, range=u"'%s'!A2:BD2" % tab).execute()["values"][0]
        if PREV_HEAD not in head:
            continue
        c = head.index(PREV_HEAD)
        res = svc.spreadsheets().get(
            spreadsheetId=PREV, includeGridData=True,
            ranges=[u"'%s'!%s3:%s2200" % (tab, letter(c), letter(c))],
            fields="sheets(data(rowData(values(hyperlink))))").execute()
        for row in res["sheets"][0]["data"][0].get("rowData", []):
            for v in row.get("values", []):
                m = _PT.search(v.get("hyperlink") or "")
                if m:
                    out[(m.group(1), int(m.group(2)))] = v["hyperlink"]
    return out


def read_tab(svc, tab):
    v = svc.spreadsheets().values().get(
        spreadsheetId=SHEET, range=u"'%s'!A%d:AJ2100" % (tab, HEAD_ROW)).execute()
    rows = v.get("values", [])
    return rows[0], rows[1:]


def plan(subject, gid, header, body, urlmap, books, stamp):
    """Requests for one tab, plus the counts that go in the report."""
    idx = dict((tl.unstamped(h), i) for i, h in enumerate(header) if h)
    pages_i = idx["Pages (printed)"]
    moves_l = letter(idx["Moves"])
    last_l = letter(idx["Teacher-primary min (of 40)"])
    span = u"cols %s\u2013%s" % (moves_l, last_l)
    reqs, tally = [], collections.Counter()
    for col in tl.LINKED_STAGES:
        reqs.append(ts.header_cell(gid, HEAD_ROW - 1, idx[col],
                                   tl.stamped(col, stamp)))
    grade = None
    for n, raw in enumerate(body):
        row = HEAD_ROW + 1 + n                       # 1-based sheet row
        a = str(raw[0]).strip() if raw else ""
        kind = stagec.classify_row(a)
        if kind == "grade_banner":
            grade = int("".join(c for c in a if c.isdigit()) or 0)
        if kind not in TRACED_KINDS or grade is None:
            continue
        tally["rows"] += 1
        spec = raw[pages_i] if pages_i < len(raw) else ""
        pages = tl.parse_pages(spec)
        book = tl.book_slug(subject, grade, books)
        cell = tl.page_truth_cell(pages, book, urlmap)
        if cell:
            reqs.append(ts.rich_cell(gid, row - 1, idx[tl.PAGE_TRUTH], cell))
            tally["A"] += 1
            tally["links"] += len(cell["runs"])
            tally["gaps"] += len(pages) - len(cell["runs"])
        else:
            tally["A missing"] += 1
        reqs.append(ts.link_cell(
            gid, row - 1, idx[tl.SEGMENTATION], "row %d" % row,
            tl.row_anchor(SHEET, gid, row, "A")))
        reqs.append(ts.link_cell(
            gid, row - 1, idx[tl.ENRICHMENT], span,
            tl.row_anchor(SHEET, gid, row, moves_l)))
        tally["B"] += 1
        tally["C"] += 1
    return reqs, tally


# Page truth holds up to six page numerals plus separators; at the house
# default it wraps to three lines and the row grows to match.
WIDTHS = {"A Page truth": 170, "B Segmentation": 115,
          "C Enrichment": 115}
HEAD_FILL = {"backgroundColor": {"red": 0.15, "green": 0.27, "blue": 0.32},
             "textFormat": {"foregroundColor": {"red": 1, "green": 1, "blue": 1},
                            "bold": True, "italic": False}}


def regroup(subject, gid, existing, ncols):
    """Rebuild the collapsed groups from source, and open A, B and C.

    The live sheet still carries the groups the pre-Stage-C source drew:
    two over the enrichment columns, one over all ten trace columns. Both
    are now wrong -- Stage C is written, and the first three traces hold
    links -- so the groups are deleted and re-derived rather than nudged.
    Nudging is how a tab ends up with two overlapping groups.
    """
    reqs = []
    for a, b in existing:
        reqs.append({"deleteDimensionGroup": {"range": {
            "sheetId": gid, "dimension": "COLUMNS",
            "startIndex": a, "endIndex": b}}})
    reqs.append({"updateDimensionProperties": {
        "range": {"sheetId": gid, "dimension": "COLUMNS",
                  "startIndex": 0, "endIndex": ncols},
        "properties": {"hiddenByUser": False}, "fields": "hiddenByUser"}})
    cols = tabs.header(subject)
    for a, b in tabs.groups(subject):
        rng = {"sheetId": gid, "dimension": "COLUMNS",
               "startIndex": a, "endIndex": b}
        reqs.append({"addDimensionGroup": {"range": rng}})
        reqs.append({"updateDimensionGroup": {
            "dimensionGroup": {"range": rng, "depth": 1, "collapsed": True},
            "fields": "collapsed"}})
    for c in tl.LINKED_STAGES:
        i = cols.index(c)
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": gid, "dimension": "COLUMNS",
                      "startIndex": i, "endIndex": i + 1},
            "properties": {"pixelSize": WIDTHS[c]}, "fields": "pixelSize"}})
        reqs.append({"repeatCell": {
            "range": {"sheetId": gid, "startRowIndex": HEAD_ROW - 1,
                      "endRowIndex": HEAD_ROW, "startColumnIndex": i,
                      "endColumnIndex": i + 1},
            "cell": {"userEnteredFormat": HEAD_FILL, "note": ""},
            "fields": "userEnteredFormat(backgroundColor,textFormat),note"}})
    return reqs


def main(argv):
    write = "--write" in argv
    stamp = datetime.date.today().isoformat()
    svc = sheetio.client()
    gids = sheetio.tab_ids(svc)
    meta = dict((sh["properties"]["title"], sh) for sh in
                svc.spreadsheets().get(
                    spreadsheetId=SHEET,
                    fields="sheets(properties(title),columnGroups(range))"
                ).execute()["sheets"])
    urlmap = harvest(svc)
    books = set(b for b, _ in urlmap)
    print("published page-truth objects: %d across %d books"
          % (len(urlmap), len(books)))
    grand = collections.Counter()
    for subject, tab in TABS:
        header, body = read_tab(svc, tab)
        reqs, tally = plan(subject, gids[tab], header, body, urlmap, books, stamp)
        grand.update(tally)
        print(u"%-8s rows=%4d  A=%4d (%d links, %d pages unpublished)  "
              u"B=%4d  C=%4d  requests=%d"
              % (subject, tally["rows"], tally["A"], tally["links"],
                 tally["gaps"], tally["B"], tally["C"], len(reqs)))
        if not write:
            continue
        live = [(g["range"].get("startIndex", 0), g["range"]["endIndex"])
                for g in meta[tab].get("columnGroups", [])]
        reqs = regroup(subject, gids[tab], live, len(header)) + reqs
        for batch in ts.chunks(reqs):
            svc.spreadsheets().batchUpdate(
                spreadsheetId=SHEET, body={"requests": batch}).execute()
    print("---")
    print("rows traced %d  page links %d  pages still unpublished %d"
          % (grand["rows"], grand["links"], grand["gaps"]))
    if not write:
        print("DRY RUN — pass --write to send")


if __name__ == "__main__":
    main(sys.argv[1:])
