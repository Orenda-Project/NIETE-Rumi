# -*- coding: utf-8 -*-
"""Point the Moves column at the spine tab instead of restating it.

    python3 movesrun.py            # dry run: report, touch nothing
    python3 movesrun.py --write

bd-960al. Measured across the four subject tabs, the column held 276,996
characters carrying 3,410 characters of information: twenty distinct
spines, each copied down an average of 83 day rows. That is not a mistake
in the authoring -- a spine is a function of the skill type and the grade
band, both of them columns already on the row -- but a value that is a
function of its neighbours wants naming once and referring to, which is
what `spinetab` is for.

So each cell becomes `decoding · G3-5` with the spine's row on a
textFormat.link run. The JSON is not summarised and not dropped: it is on
the Move Spines tab in full, one row per spine, one click away.

Two refusals hold the pass honest:

  * a cell is matched by its JSON, never re-derived from the row's other
    columns. Re-deriving would write a plausible label over a row whose
    Moves cell disagrees with its skill type, and those disagreements are
    half of what reading every cell is for; and
  * a cell that matches nothing is reported and left exactly as it is. The
    column is an artefact -- "unmatched" is a finding, not a cell to fill.

The pass is idempotent: a cell already holding a label is counted and
skipped, so it can be re-run after an enrichment batch adds day rows.
"""
import argparse
import collections
import sys

import sheetio
import spinetab
import stagec
import tabs
import tracelinks as tl
import tracesend as ts

SHEET = "14-ndk94fkTbqKn0MW4QPhMgLGTesswVj-_GTwe4GYio"
SPINE_TAB = "Move Spines"
HEAD_ROW = 3                       # 1-based; the header row on every tab
TABS = [("English", u"English G1–5"), ("Urdu", u"Urdu G1–5"),
        ("Maths", u"Maths G1–5"), ("Science", u"Science G4–5")]
MOVED_KINDS = ("day", "assessment", "review")

#: The link lands on the spine's JSON, which is what a reader following it
#: came for -- not on the label they just clicked.
ANCHOR_COL_INDEX = spinetab.COLUMNS.index("Moves (JSON)")
ANCHOR_COL = "G"

#: Wide enough for the longest label (`representational · G3-5`) and no
#: wider: the cell is a name now, not a document.
WIDTH = 190


def anchor(offset, spines_gid, sheet=SHEET):
    """The address of one spine's row on the Move Spines tab."""
    return tl.row_anchor(sheet, spines_gid, spinetab.sheet_row(offset),
                         ANCHOR_COL)


def plan(subject, gid, header, body, by_json, spines_gid, sheet=SHEET):
    """Requests for one tab, the counts, and the cells that matched nothing.

    Returns (requests, tally, unmatched). `unmatched` carries the row and
    the cell verbatim so the report can name them; nothing is written for
    those rows.
    """
    idx = dict((tl.unstamped(h), i) for i, h in enumerate(header) if h)
    moves_i = idx["Moves"]
    labels = set(label for label, _ in by_json.values())
    reqs, tally, unmatched = [], collections.Counter(), []
    for n, raw in enumerate(body):
        rowno = HEAD_ROW + 1 + n                     # 1-based sheet row
        a = str(raw[0]).strip() if raw else ""
        if stagec.classify_row(a) not in MOVED_KINDS:
            continue
        cell = (raw[moves_i] if moves_i < len(raw) else "") or ""
        cell = cell.strip()
        if not cell:
            tally["empty"] += 1
            continue
        if cell in labels:
            tally["done"] += 1
            continue
        hit = by_json.get(spinetab.canonical(cell))
        if not hit:
            tally["unmatched"] += 1
            unmatched.append({"row": rowno, "value": cell[:80]})
            continue
        label, offset = hit
        reqs.append(ts.link_cell(gid, rowno - 1, moves_i, label,
                                 anchor(offset, spines_gid, sheet)))
        tally["matched"] += 1
        tally["saved"] += len(cell) - len(label)
    return reqs, tally, unmatched


def retighten(gid, moves_i, nrows):
    """One line per cell, and the column narrowed to the label it now holds."""
    return [{"updateDimensionProperties": {
        "range": {"sheetId": gid, "dimension": "COLUMNS",
                  "startIndex": moves_i, "endIndex": moves_i + 1},
        "properties": {"pixelSize": WIDTH}, "fields": "pixelSize"}},
        {"repeatCell": {
            "range": {"sheetId": gid, "startRowIndex": HEAD_ROW,
                      "endRowIndex": nrows, "startColumnIndex": moves_i,
                      "endColumnIndex": moves_i + 1},
            "cell": {"userEnteredFormat": {"wrapStrategy": "CLIP",
                                           "verticalAlignment": "TOP"}},
            "fields": "userEnteredFormat(wrapStrategy,verticalAlignment)"}}]


def read_tab(svc, tab):
    v = svc.spreadsheets().values().get(
        spreadsheetId=SHEET,
        range=u"'%s'!A%d:AJ2100" % (tab, HEAD_ROW)).execute()
    rows = v.get("values", [])
    return rows[0], rows[1:]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args(argv)
    svc = sheetio.client()
    gids = sheetio.tab_ids(svc)
    if SPINE_TAB not in gids:
        print("no %r tab -- run build.py --derived first" % SPINE_TAB)
        return 2
    by_json = spinetab.index()
    grand, stray = collections.Counter(), 0
    for subject, tab in TABS:
        header, body = read_tab(svc, tab)
        reqs, tally, unmatched = plan(subject, gids[tab], header, body,
                                      by_json, gids[SPINE_TAB])
        grand.update(tally)
        stray += len(unmatched)
        print(u"%-8s matched=%4d  already=%4d  empty=%3d  unmatched=%2d  "
              u"chars saved=%6d" % (subject, tally["matched"], tally["done"],
                                    tally["empty"], tally["unmatched"],
                                    tally["saved"]))
        for u in unmatched[:5]:
            print(u"           row %-5d %s" % (u["row"], u["value"]))
        if not a.write or not reqs:
            continue
        moves_i = tabs.header(subject).index("Moves")
        reqs = reqs + retighten(gids[tab], moves_i, HEAD_ROW + len(body))
        for batch in ts.chunks(reqs):
            svc.spreadsheets().batchUpdate(
                spreadsheetId=SHEET, body={"requests": batch}).execute()
    print("---")
    print("matched %d  already labelled %d  unmatched %d  characters saved %d"
          % (grand["matched"], grand["done"], grand["unmatched"],
             grand["saved"]))
    return 1 if stray else 0


if __name__ == "__main__":
    sys.exit(main())
