# -*- coding: utf-8 -*-
"""Carry `stagebsync`'s plan to the matrix sheet, and refuse a partial one.

The planner decides what every Stage-B column should hold; this decides
whether the sheet is in a fit state to be told. One rule governs it:

  * EVERY BUILT DAY MEETS A ROW AND EVERY ROW MEETS A BUILT DAY, or nothing
    is written. A tab left half one build and half another is worse than the
    defect being fixed, because nothing downstream can tell which half it is
    reading.

A day the tab does not have yet gets a row rather than a refusal, but only
where the day before it sits, and filled in the same breath -- a blank row on
a subject tab is indistinguishable from the end of the chapter.

    python3 stagebsend.py            # measure, write nothing
    python3 stagebsend.py --write    # write the columns that differ
"""
import sys

import buildload
import stagebsync
from stagebsync import COLUMNS, HEADER_ROW, SHEET, TABS


def letter(index):
    """0 -> A, 26 -> AA. Sheets ranges are spelled, not numbered."""
    out = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        out = chr(ord("A") + rem) + out
    return out


def add_rows(svc, gid, tab, header, need, want):
    """Give every built day a row, bottom-up, and fill it before moving on.

    Two calls per row rather than one batch: an inserted row is blank, and a
    blank row on a subject tab is indistinguishable from the end of the
    chapter until something is written into it. Filling each one as it is
    made keeps the tab readable at every point between the two writes.
    """
    for at, key in need:
        row = HEADER_ROW + at                     # 0-based; the new row's index
        svc.spreadsheets().batchUpdate(
            spreadsheetId=SHEET,
            body={"requests": [{"insertDimension": {"range": {
                "sheetId": gid, "dimension": "ROWS",
                "startIndex": row, "endIndex": row + 1},
                "inheritFromBefore": True}}]}).execute()
        svc.spreadsheets().values().update(
            spreadsheetId=SHEET, valueInputOption="RAW",
            range=u"'%s'!A%d:%s%d" % (tab, row + 1,
                                      letter(len(header) - 1), row + 1),
            body={"values": [stagebsync.fresh(header, want[key])]}).execute()
        print(u"    inserted grade %s chapter %s day %s at row %d"
              % (key + (row + 1,)))


def built(subject, corpus):
    """Every Stage-B row of one subject, in the order the tab prints them."""
    rows = []
    for grade, book_rows, _fde in corpus.get(subject, []):
        rows.extend(book_rows)
    return rows


def main(argv):
    import sheetio
    write = "--write" in argv
    corpus, _runs, _books, _breaks = buildload.load_corpus()
    svc = sheetio.client()
    tab_id = sheetio.tab_ids(svc)
    blocked = 0
    for tab, subject in TABS:
        rows = built(subject, corpus)
        want = stagebsync.wanted(rows)
        values = svc.spreadsheets().values().get(
            spreadsheetId=SHEET, range=u"'%s'!A1:AZ2100" % tab
        ).execute().get("values", [])
        header = values[HEADER_ROW - 1]
        need = stagebsync.inserts(header, values[HEADER_ROW:], want)
        if need and write:
            add_rows(svc, tab_id[tab], tab, header, need, want)
            values = svc.spreadsheets().values().get(
                spreadsheetId=SHEET, range=u"'%s'!A1:AZ2100" % tab
            ).execute().get("values", [])
            header = values[HEADER_ROW - 1]
        elif need:
            for at, key in need:
                print(u"    would insert grade %s chapter %s day %s at row %d"
                      % (key + (HEADER_ROW + at + 1,)))
        p = stagebsync.plan(header, values[HEADER_ROW:], want)
        print(u"%-14s built %4d  sheet days %4d  %s" % (
            tab, len(want), p.days,
            u"  ".join(u"%s %d" % (c, p.changed[c]) for c in COLUMNS)))
        for key in (p.missing + p.unplaced)[:10]:
            print("    no pair for grade %s chapter %s day %s" % key)
        if p.missing or p.unplaced:
            # Every built day must meet its row and every row its build. A
            # partial write here would leave the tab half one build and half
            # another, which is worse than the defect it is fixing.
            print("    BLOCKED: the join is not total, nothing written")
            blocked += 1
            continue
        if not write or not p.dirty():
            continue
        data = []
        for c in p.dirty():
            col = letter(stagebsync.position(header, c))
            data.append({"range": u"'%s'!%s%d:%s%d" % (
                tab, col, HEADER_ROW + 1, col, HEADER_ROW + len(p.values[c])),
                "values": p.values[c]})
        svc.spreadsheets().values().batchUpdate(
            spreadsheetId=SHEET,
            body={"valueInputOption": "RAW", "data": data}).execute()
        print(u"    wrote %s" % u", ".join(p.dirty()))
    return 1 if blocked else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
