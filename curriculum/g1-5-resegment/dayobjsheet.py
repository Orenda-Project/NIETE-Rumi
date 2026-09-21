# -*- coding: utf-8 -*-
"""Show the day objective on the matrix, beside the SLO sentence it corrects.

Amena, 2026-09-21: "a, and yes write the sub-objectives" -- and, standing
since the Stage C write, "i dont see it on my sheet. do i cant verify it".
The objectives live in the corpus because that is what the Stage C author
reads (see dayobj); they have to be on the sheet because that is what the
reviewer reads.

The column goes immediately after `Primary SLO description`, so the two
sentences sit side by side: the code's sentence, which one day in many
actually matches, and the day's own. That adjacency IS the argument --
`U-05-CO-01` reads "explain the couplets of a poem" on all 33 of its days,
including a formal letter, two interviews and a bakery recipe.

THE JOIN IS (grade, chapter, day), NEVER THE TOPIC. The topic looks like a
key and is not one: `grade_5_urdu` repeats three topic strings inside
itself and shares "دُہرائی — پورے سبق کا اعادہ" with the four other books
on the same tab. A topic index -- bloomrun can afford one, because every
day with a shared topic shares its skill type -- would land one day's
objective on another day's row, which is the very defect this column
exists to expose.

    python3 dayobjsheet.py            # measure, write nothing
    python3 dayobjsheet.py --write    # insert the column and fill it
"""
import glob
import json
import os
import re
import sys

import stagec

COLUMN = "Day objective"
ANCHOR = "Primary SLO description"
HEADER_ROW = 3                      # 1-based; data starts on row 4
SHEET = "14-ndk94fkTbqKn0MW4QPhMgLGTesswVj-_GTwe4GYio"
SEG_DIR = os.environ.get("SEG_DIR", "corpus/seg")
TABS = [(u"English G1–5", "english"), (u"Urdu G1–5", "urdu")]


class Plan(object):
    """One column of values, and the arithmetic that justifies writing it."""

    def __init__(self, column, written, blank, unplaced):
        self.column = column
        self.written = written
        self.blank = blank
        self.unplaced = unplaced


def _names(header):
    return [str(h).split(" (")[0].strip() for h in header]


def present(header):
    return COLUMN in _names(header)


def position(header):
    """Where the column is, or where it belongs if it is not there yet."""
    names = _names(header)
    if COLUMN in names:
        return names.index(COLUMN)
    if ANCHOR not in names:
        raise ValueError("no %r column to sit after in %r" % (ANCHOR, names))
    return names.index(ANCHOR) + 1


def wanted(segments, grade):
    """{(grade, chapter, day): objective} for the days someone wrote for.

    `segment_index` is the day number the sheet prints in column A -- the
    join was verified row for row against the live tabs before this was
    written: 99 of 99 for G4 English, 108 of 108 for G5 Urdu, with the
    only unmatched rows the 16 assessment days, which carry no objective.
    """
    out = {}
    for seg in segments:
        text = seg.get("objective")
        if not text:
            continue
        out[(grade, int(seg["chapter_number"]), int(seg["segment_index"]))] = text
    return out


def load(book, seg_dir=SEG_DIR):
    with open(os.path.join(seg_dir, book + ".json")) as handle:
        doc = json.load(handle)
    return doc["segments"] if isinstance(doc, dict) else doc


def books(subject, seg_dir=SEG_DIR):
    """Every authored book on one tab, as (slug, grade)."""
    out = []
    for path in sorted(glob.glob(os.path.join(seg_dir, "grade_*_%s.json" % subject))):
        slug = os.path.basename(path)[:-5]
        out.append((slug, int(re.sub(r"\D", "", slug.split("_")[1]))))
    return out


def plan(header, rows, want):
    """What the column should hold, row for row, with nothing left over."""
    at = position(header)
    want = dict(want)
    column, written, blank = [], 0, 0
    grade = chapter = None
    for raw in rows:
        first = str(raw[0]).strip() if raw and raw[0] is not None else ""
        kind = stagec.classify_row(first)
        if kind == "grade_banner":
            # "GRADE 5 \u2014 Urdu": the first number is the grade, and any
            # later one (a term, a page count) is not.
            grade = int(re.search(r"\d+", first).group())
        elif kind == "chapter_header":
            chapter = int(first.split(":")[0].split()[-1])
        if kind != "day":
            # Blank, never an echo. A grade banner, a chapter header and a
            # chapter-tail row teach no day, so this column has nothing to
            # say on them -- and echoing what sits at the same index is how
            # the first run put 112 English rows' `Supporting SLOs` into the
            # new column: the rows are read BEFORE the insert, so index 8 is
            # still the old column 8.
            column.append([""])
            continue
        text = want.pop((grade, chapter, int(first.split()[1])), "")
        column.append([text])
        if text:
            written += 1
        else:
            blank += 1
    return Plan(column, written, blank, sorted(want))


def letter(index):
    """0 -> A, 26 -> AA. Sheets ranges are spelled, not numbered."""
    out = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        out = chr(ord("A") + rem) + out
    return out


def _insert(svc, sheet_id, gid, at):
    svc.spreadsheets().batchUpdate(spreadsheetId=sheet_id, body={"requests": [
        {"insertDimension": {"range": {
            "sheetId": gid, "dimension": "COLUMNS",
            "startIndex": at, "endIndex": at + 1},
            "inheritFromBefore": True}}]}).execute()


def main(argv):
    import sheetio
    write = "--write" in argv
    svc = sheetio.client()
    gids = sheetio.tab_ids(svc)
    for tab, subject in TABS:
        want = {}
        for slug, grade in books(subject):
            want.update(wanted(load(slug), grade))
        values = svc.spreadsheets().values().get(
            spreadsheetId=SHEET, range=u"'%s'!A1:Z2100" % tab
        ).execute().get("values", [])
        header = values[HEADER_ROW - 1]
        at = position(header)
        p = plan(header, values[HEADER_ROW:], want)
        print(u"%-14s authored %3d  rows written %3d  left blank %3d  "
              u"unplaced %d  column %s" % (tab, len(want), p.written, p.blank,
                                           len(p.unplaced), letter(at)))
        for key in p.unplaced[:10]:
            print("    no row for grade %s chapter %s day %s" % key)
        if p.unplaced:
            print("    BLOCKED: every authored objective must land on a row")
            continue
        if not write:
            continue
        if not present(header):
            _insert(svc, sheet_id=SHEET, gid=gids[tab], at=at)
        col = letter(at)
        svc.spreadsheets().values().batchUpdate(
            spreadsheetId=SHEET,
            body={"valueInputOption": "USER_ENTERED", "data": [
                {"range": u"'%s'!%s%d" % (tab, col, HEADER_ROW),
                 "values": [[COLUMN]]},
                {"range": u"'%s'!%s%d:%s%d" % (tab, col, HEADER_ROW + 1, col,
                                               HEADER_ROW + len(p.column)),
                 "values": p.column}]}).execute()
        print(u"    wrote %s3:%s%d" % (col, col, HEADER_ROW + len(p.column)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
