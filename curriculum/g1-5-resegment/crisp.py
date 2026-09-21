# -*- coding: utf-8 -*-
"""Crisp the live G1-5 matrix: delete the dead columns, JSON the Moves.

    python3 crisp.py            # dry run: report, touch nothing
    python3 crisp.py --write

Amena, 2026-09-21: "i think there is alot of redundancy in this sheet ...
remove fde syllabus columns pls, the mopves should have the moves in a
json format, no?"

Measured over the 1,923 traced rows before any of this was cut: `FDE
syllabus` read "In FDE syllabus" on every one, `Period (min)` read "40",
`Review status` read "not reviewed", `C Enrichment` held one constant
string, `B Segmentation` restated the row number, seven trace columns
were empty on every row of every tab, and `Reading strategy` read "n/a"
on all 785 Maths and Science rows. None of them can be filtered, sorted
or reviewed on, so they go; the facts they carried survive elsewhere (the
period in `Teacher-primary min (of 40)`, the FDE omissions in their own
banner rows, unreviewed as an empty `Human reviewer`).

Stage C wrote 12,655 values onto these tabs, so this migration is deletes
plus one rename plus a rewrite of one column. It never rebuilds a grid.
"""
import collections
import datetime
import json
import os
import sys

import crispplan
import sheetio
import stagec
import tabs
import tracelinks as tl

SHEET = "14-ndk94fkTbqKn0MW4QPhMgLGTesswVj-_GTwe4GYio"
HEAD_ROW = 3                       # 1-based; the header row on every tab
TABS = [("English", u"English G1–5"), ("Urdu", u"Urdu G1–5"),
        ("Maths", u"Maths G1–5"), ("Science", u"Science G4–5")]
SNAPDIR = ("/Users/amenaahmed/rumi/Rumi 10 April 2026/"
           "10_Grades 1-5 LP Build/stagec-rollback")


def letter(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def requests(gid, plan, stamp):
    """The rename first, then the deletes, highest column index first.

    Order matters twice. The rename goes first because it addresses the
    live grid, where `A Page truth` has not moved yet; the deletes descend
    because deleting column 11 would otherwise shift every index after it
    and the next delete would take the wrong column.
    """
    reqs = []
    for i, name in sorted(plan.renames.items()):
        reqs.append({"updateCells": {
            "range": {"sheetId": gid,
                      "startRowIndex": HEAD_ROW - 1, "endRowIndex": HEAD_ROW,
                      "startColumnIndex": i, "endColumnIndex": i + 1},
            "rows": [{"values": [{"userEnteredValue": {
                "stringValue": tl.stamped(name, stamp)}}]}],
            "fields": "userEnteredValue"}})
    for i in plan.deletes:
        reqs.append({"deleteDimension": {"range": {
            "sheetId": gid, "dimension": "COLUMNS",
            "startIndex": i, "endIndex": i + 1}}})
    return reqs


def moves_values(header, body):
    """The whole Moves column as it should read, plus the counts.

    Every row comes back, converted or not, so the column writes as one
    range and a row this does not understand keeps exactly what it had.
    """
    i = header.index("Moves")
    out, tally = [], collections.Counter()
    for raw in body:
        cell = raw[i] if i < len(raw) else ""
        try:
            pairs = stagec.parse_moves(cell)
        except ValueError:
            tally["left alone" if cell else "empty"] += 1
            out.append([cell])
            continue
        new = stagec.format_moves(pairs)
        tally["converted" if new != cell else "already json"] += 1
        out.append([new])
    return out, tally


def snapshot(rows):
    """Everything the migration could destroy, on disk, before it runs."""
    path = os.path.join(SNAPDIR, "pre-crisp-%s.json"
                        % datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
    with open(path, "w") as fh:
        json.dump(rows, fh)
    return path


def read_tab(svc, tab):
    v = svc.spreadsheets().values().get(
        spreadsheetId=SHEET, range=u"'%s'!A%d:AN2200" % (tab, HEAD_ROW),
        valueRenderOption="UNFORMATTED_VALUE").execute().get("values", [])
    return [str(c) for c in v[0]], [[str(c) for c in r] for r in v[1:]]


def main(argv):
    write = "--write" in argv
    stamp = datetime.date.today().isoformat()
    svc = sheetio.client()
    gids = sheetio.tab_ids(svc)
    live = {}
    for subject, tab in TABS:
        live[tab] = read_tab(svc, tab)
    if write:
        print("snapshot: %s" % snapshot(dict(
            (t, {"header": h, "body": b}) for t, (h, b) in live.items())))
    for subject, tab in TABS:
        header, body = live[tab]
        target = tabs.header(subject)
        plan = crispplan.plan(header, target)
        gone = [crispplan.unstamped(header[i]) for i in plan.deletes]
        print(u"%-8s %d cols -> %d   cutting: %s"
              % (subject, len(header), len(target), ", ".join(sorted(gone))))
        if not write:
            continue
        reqs = requests(gids[tab], plan, stamp)
        svc.spreadsheets().batchUpdate(
            spreadsheetId=SHEET, body={"requests": reqs}).execute()
        after, body_after = read_tab(svc, tab)
        got = [crispplan.unstamped(h) for h in after]
        if got != target:
            raise SystemExit(u"%s: header is %r after the cut, wanted %r"
                             % (subject, got, target))
        vals, tally = moves_values(target, body_after)
        col = letter(target.index("Moves"))
        svc.spreadsheets().values().update(
            spreadsheetId=SHEET,
            range=u"'%s'!%s%d:%s%d" % (tab, col, HEAD_ROW + 1, col,
                                       HEAD_ROW + len(vals)),
            valueInputOption="USER_ENTERED", body={"values": vals}).execute()
        print(u"         header verified; moves %s"
              % ", ".join("%s=%d" % kv for kv in sorted(tally.items())))
    if not write:
        print("DRY RUN — pass --write to send")


if __name__ == "__main__":
    main(sys.argv[1:])
