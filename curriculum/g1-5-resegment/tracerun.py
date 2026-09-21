# -*- coding: utf-8 -*-
"""Write the trace block on the G1-5 resegmentation matrix.

    python3 tracerun.py            # dry run: report, touch nothing
    python3 tracerun.py --write

traces.md is binding: save, publish, link, stamp. This is the link step,
and it writes ONE column. The previous build spent ten columns on it and
nine of them said nothing: seven were empty on every row, `C Enrichment`
held one constant string and `B Segmentation` restated the row number.
So the cell is a JSON object keyed by pipeline stage, and a stage appears
in it only when it has an artefact -- which is a thing a column cannot do.

Page truth is relinked from the previous ICT build's own sheet. Those
objects are addressed but not reachable: every URL on the production
matrix returns HTTP 403 today, because r2.dev public access is off for
the whole `niete-content` bucket (bd-10ccr). The addresses are still the
right ones to record; they will resolve when the hostname is re-enabled.

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

    The objects are content-addressed, so the address is the version and
    stays correct whether or not the host is serving (it is not: 403,
    bd-10ccr). Resolved by header label, never by letter:
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
    """Requests for one tab, plus the counts that go in the report.

    One cell per traced row. A row whose pages are all unpublished gets no
    cell at all rather than an empty object: "{}" repeated down a column
    is the constant this whole change is removing.
    """
    idx = dict((tl.unstamped(h), i) for i, h in enumerate(header) if h)
    pages_i = idx["Pages (printed)"]
    traces_i = idx[tabs.TRACES_COLUMN]
    reqs, tally = [], collections.Counter()
    reqs.append(ts.header_cell(gid, HEAD_ROW - 1, traces_i,
                               tl.stamped(tabs.TRACES_COLUMN, stamp)))
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
        urls = [urlmap[(book, p)] for p in pages if (book, p) in urlmap]
        missing = [p for p in pages if (book, p) not in urlmap]
        cell = tl.traces_cell({"page_truth": urls}, unpublished=missing)
        if not cell:
            tally["no artefact"] += 1
            continue
        reqs.append(ts.text_cell(gid, row - 1, traces_i, cell))
        tally["traced"] += 1
        tally["links"] += len(urls)
        tally["gaps"] += len(missing)
    return reqs, tally


# The cell holds a JSON object and is a handle, not a reading surface:
# 150px shows the opening key and clips, which is what the tab builder
# already gives the column.
WIDTH = 150
HEAD_FILL = {"backgroundColor": {"red": 0.15, "green": 0.27, "blue": 0.32},
             "textFormat": {"foregroundColor": {"red": 1, "green": 1, "blue": 1},
                            "bold": True, "italic": False}}


def regroup(subject, gid, existing, ncols):
    """Rebuild the collapsed groups from source, and open A, B and C.

    The live sheet still carries the groups the pre-Stage-C source drew:
    two over the enrichment columns, one over the old ten-column trace
    block. Both are now wrong -- Stage C is written and the block is one
    column -- so the groups are deleted and re-derived rather than nudged.
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
    i = cols.index(tabs.TRACES_COLUMN)
    reqs.append({"updateDimensionProperties": {
        "range": {"sheetId": gid, "dimension": "COLUMNS",
                  "startIndex": i, "endIndex": i + 1},
        "properties": {"pixelSize": WIDTH}, "fields": "pixelSize"}})
    reqs.append({"repeatCell": {
        "range": {"sheetId": gid, "startRowIndex": HEAD_ROW - 1,
                  "endRowIndex": HEAD_ROW, "startColumnIndex": i,
                  "endColumnIndex": i + 1},
        "cell": {"userEnteredFormat": HEAD_FILL, "note": ""},
        "fields": "userEnteredFormat(backgroundColor,textFormat),note"}})
    return reqs


def retighten(gid, traces_i, nrows):
    """Clip the traces column, then give every row its height back.

    Wrapped, the cell is unreadable and contagious: one chapter-assessment
    row lists eleven page-truth URLs, grew to fifteen lines, and pushed the
    next chapter off the screen. The column is a handle -- clip it to one
    line and click the cell to read the value.
    """
    return [{"repeatCell": {
        "range": {"sheetId": gid, "startRowIndex": HEAD_ROW,
                  "endRowIndex": nrows, "startColumnIndex": traces_i,
                  "endColumnIndex": traces_i + 1},
        "cell": {"userEnteredFormat": {"wrapStrategy": "CLIP",
                                       "verticalAlignment": "TOP"}},
        "fields": "userEnteredFormat(wrapStrategy,verticalAlignment)"}},
        {"autoResizeDimensions": {"dimensions": {
            "sheetId": gid, "dimension": "ROWS",
            "startIndex": HEAD_ROW, "endIndex": nrows}}}]


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
        print(u"%-8s rows=%4d  traced=%4d (%d page objects, %d pages "
              u"unpublished, %d rows with nothing)  requests=%d"
              % (subject, tally["rows"], tally["traced"], tally["links"],
                 tally["gaps"], tally["no artefact"], len(reqs)))
        if not write:
            continue
        live = [(g["range"].get("startIndex", 0), g["range"]["endIndex"])
                for g in meta[tab].get("columnGroups", [])]
        traces_i = tabs.header(subject).index(tabs.TRACES_COLUMN)
        reqs = (regroup(subject, gids[tab], live, len(header)) + reqs
                + retighten(gids[tab], traces_i, HEAD_ROW + len(body)))
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
