# -*- coding: utf-8 -*-
"""Point the SLO code columns at the SLO Sentences tab.

    python3 slorun.py                 # dry run: report, touch nothing
    python3 slorun.py --write         # build the tab, link the code cells
    python3 slorun.py --drop-column   # then, separately, remove the column

bd-960al. `Supporting SLO descriptions` held 200,018 characters on 907
day rows -- 1,473 distinct sentences, each copied down every row that
touches its SLO. The sentence belongs to the code, so it goes on a tab of
its own and the code becomes a link to it.

`--drop-column` is a second run on purpose. Removing a column shifts
everything right of it, so it happens only after a read-back has shown
the links landed, never in the same breath as writing them.

Two refusals hold the pass honest:

  * a row whose code count and sentence count disagree is reported and
    left whole. Pairing those by position would invent an SLO's meaning,
    and there are exactly two of them on the sheet; and
  * a cell is linked from the (code, sentence) pair the row itself
    carries, never from the code alone. 171 codes carry more than one
    sentence (bd-i0upq) and the row knows which one it used -- resolving
    by code would send a third of them to the wrong sentence.
"""
import argparse
import collections
import sys

import slokeep
import slotab
import stagec
import taborder
import tracelinks as tl
import tracesend as ts
from slopair import (CODES, CODE_SEP, DAY_KINDS, DESCS, DESC_SEP,
                     HEAD_ROW, _cell, _idx, _split, merge, pairs_of)

SHEET = "14-ndk94fkTbqKn0MW4QPhMgLGTesswVj-_GTwe4GYio"
LOOKUP_TAB = "SLO Sentences"
TABS = [("English", u"English G1–5"), ("Urdu", u"Urdu G1–5"),
        ("Maths", u"Maths G1–5"), ("Science", u"Science G4–5")]
#: Wide enough for three codes and no wider; the sentences are gone.
WIDTH = 150


def unambiguous(offsets):
    """{code: offset} for codes that say exactly one thing.

    A row with no sentence column still names its codes, and a reader on
    an assessment row listing eighteen of them is precisely the reader who
    needs to know what they mean. Where the code has one wording the link
    is safe; where it has two (bd-i0upq) there is nothing on the row to
    choose between them, so it gets none.
    """
    seen = {}
    for (code, _), off in offsets.items():
        seen.setdefault(code, []).append(off)
    return dict((c, v[0]) for c, v in seen.items() if len(v) == 1)


def anchor(offset, lookup_gid, sheet=SHEET):
    """The address of one sentence's row on the lookup tab."""
    return tl.row_anchor(sheet, lookup_gid, slotab.sheet_row(offset),
                         slotab.ANCHOR_COL)


def plan(header, body, gid, offsets, lookup_gid, sheet=SHEET):
    """Requests for one tab, the counts, and the cells left unlinked."""
    idx = _idx(header)
    codes_i, descs_i = idx.get(CODES), idx.get(DESCS)
    bare = unambiguous(offsets)
    reqs, tally, skipped = [], collections.Counter(), []
    for n, raw in enumerate(body):
        rowno = HEAD_ROW + 1 + n
        if stagec.classify_row(_cell(raw, 0)) not in DAY_KINDS:
            continue
        codes = _split(_cell(raw, codes_i), CODE_SEP)
        descs = _split(_cell(raw, descs_i), DESC_SEP)
        if not codes:
            tally["empty"] += 1
            continue
        if not descs:
            uris = dict((c, anchor(bare[c], lookup_gid, sheet))
                        for c in codes if c in bare)
            if uris:
                reqs.append(ts.rich_cell(gid, rowno - 1, codes_i,
                                         slotab.code_cell(codes, uris)))
                tally["bare"] += 1
            else:
                tally["unresolved"] += 1
                skipped.append({"row": rowno, "why": "no unambiguous code"})
            continue
        if len(codes) != len(descs):
            tally["mismatched"] += 1
            skipped.append({"row": rowno, "why": "counts disagree"})
            continue
        uris, missing = {}, []
        for code, desc in zip(codes, descs):
            off = offsets.get((code, desc))
            if off is None:
                missing.append(code)
            else:
                uris[code] = anchor(off, lookup_gid, sheet)
        if missing:
            tally["unresolved"] += 1
            skipped.append({"row": rowno, "why": "no row for " + missing[0]})
            continue
        cell = slotab.code_cell(codes, uris)
        reqs.append(ts.rich_cell(gid, rowno - 1, codes_i, cell))
        tally["linked"] += 1
        tally["saved"] += len(_cell(raw, descs_i))
    return reqs, tally, skipped


def retighten(gid, codes_i, nrows):
    """The code column, narrowed to the codes it now holds."""
    return [{"updateDimensionProperties": {
        "range": {"sheetId": gid, "dimension": "COLUMNS",
                  "startIndex": codes_i, "endIndex": codes_i + 1},
        "properties": {"pixelSize": WIDTH}, "fields": "pixelSize"}}]


def rebuildable(headers):
    """Can the lookup tab still be built from these tabs' own rows?

    `pairs_of` reads a sentence off the day row that carries it. Once
    `--drop-column` has run there is no such column, so a second
    `--write` would rebuild the lookup out of the primary SLOs alone and
    overwrite 1,777 rows with a fraction of themselves. The lookup tab
    is the authority from that point on; rebuilding it wants the corpus,
    not the sheet (bd-960al follow-up).
    """
    return any(DESCS in _idx(h) for h in headers)


def read_tab(svc, tab):
    v = svc.spreadsheets().values().get(
        spreadsheetId=SHEET,
        range=u"'%s'!A%d:AJ2100" % (tab, HEAD_ROW)).execute()
    rows = v.get("values", [])
    return rows[0], rows[1:]


def send(svc, reqs):
    for chunk in ts.chunks(reqs):
        svc.spreadsheets().batchUpdate(
            spreadsheetId=SHEET, body={"requests": chunk}).execute()


def _report(out, name, tally, skipped):
    out.write(u"%-9s paired=%4d bare=%4d empty=%4d mismatched=%2d "
              u"unresolved=%3d chars saved=%6d\n"
              % (name, tally["linked"], tally["bare"], tally["empty"],
                 tally["mismatched"], tally["unresolved"], tally["saved"]))
    for s in skipped[:5]:
        out.write(u"           row %-5s %s\n" % (s["row"], s["why"]))


def main(out=sys.stdout):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true",
                    help="build the lookup tab and link the code cells")
    ap.add_argument("--drop-column", action="store_true",
                    help="remove the emptied descriptions column; run this "
                         "only after a read-back has shown the links landed")
    a = ap.parse_args()

    import sheetio
    svc = sheetio.client()
    tabs = [(name, title) + read_tab(svc, title) for name, title in TABS]
    groups, bad = [], []
    for name, title, header, body in tabs:
        pairs, rows_bad = pairs_of(header, body, name)
        groups.append(pairs)
        bad += [dict(b, tab=name) for b in rows_bad]
    pairs = merge(groups)
    clashes = slotab.collisions(pairs)
    out.write(u"%d pairs  %d distinct codes  %d codes with more than one "
              u"sentence\n" % (len(pairs),
                               len(set(p["code"] for p in pairs)),
                               len(clashes)))
    for b in bad:
        out.write(u"  %-8s row %-5s %d codes / %d sentences -- left whole\n"
                  % (b["tab"], b["row"], b["codes"], b["sentences"]))
    if not (a.write or a.drop_column):
        out.write(u"dry run; nothing written\n")
        return 0

    ids = sheetio.tab_ids(svc)
    if a.write and not rebuildable([h for _, _, h, _ in tabs]):
        out.write(u"refusing --write: no tab still carries %s, so the "
                  u"pairs cannot be read off the rows and the lookup tab "
                  u"would be overwritten with the primary SLOs alone\n"
                  % DESCS)
        return 1
    if a.write:
        body = slotab.rows(pairs)
        if LOOKUP_TAB not in ids:
            ids.update(sheetio.reset_tabs(
                svc, [LOOKUP_TAB], {LOOKUP_TAB: len(slotab.COLUMNS)},
                {LOOKUP_TAB: len(body)}))
        slotab.write(svc, sheetio, ids[LOOKUP_TAB], LOOKUP_TAB, pairs)
        offsets = slotab.index(pairs)
        for name, title, header, tab_body in tabs:
            reqs, tally, skipped = plan(header, tab_body, ids[title], offsets,
                                        ids[LOOKUP_TAB])
            if reqs:
                reqs += retighten(ids[title], _idx(header)[CODES],
                                  HEAD_ROW + len(tab_body))
            send(svc, reqs)
            _report(out, name, tally, skipped)
        sheetio.order_tabs(svc, taborder.TAB_ORDER)

    if a.drop_column:
        # Every sentence still in the column must exist somewhere else
        # before the column can go. The two that do not are chapter-level
        # notes on rows `pairs_of` skips whole; they move to `Flags`.
        known = set(p["sentence"] for p in pairs)
        for name, title, header, tab_body in tabs:
            found = slokeep.orphans(header, tab_body, known)
            try:
                req = slokeep.drop_column(header, ids[title], found)
            except slokeep.Unsafe as exc:
                out.write(u"%-9s REFUSED: %s\n" % (name, exc))
                continue
            if req is None:
                out.write(u"%-9s already has no %s column\n" % (name, DESCS))
                continue
            saves = slokeep.rescue(header, tab_body, ids[title], found)
            if saves:
                send(svc, saves)
                out.write(u"%-9s %d sentence(s) moved to Flags: rows %s\n"
                          % (name, sum(len(f["sentences"]) for f in found),
                             ", ".join(str(f["row"]) for f in found)))
            send(svc, [req])
            out.write(u"%-9s %s removed\n" % (name, DESCS))
    return 0


if __name__ == "__main__":
    sys.exit(main())
