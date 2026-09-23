# -*- coding: utf-8 -*-
"""What the descriptions column holds that the lookup tab does not.

bd-960al. `slorun --drop-column` deletes a column carrying 200,018
characters. That is safe only because the sentences were copied to the
SLO Sentences tab first -- and for two rows they were not. `pairs_of`
skips a row whose code and sentence counts disagree, whole, so the two
English chapter-consolidation rows (491 and 573) never reached the
lookup at all. Deleting the column would simply lose them.

Both hold the same thing: a chapter-level line -- "Consolidates Chapter
2's SLOs across listening/speaking, reading, grammar and writing." --
that is not an SLO description and never belonged in a column of them.
It is a note about the day, so it goes where this sheet already puts
notes about a day: the row's own `Flags` cell.

The safety property is the whole point of the module. Every sentence in
the column is either already on the lookup tab or written into `Flags`
first, and a tab where neither can be arranged is refused rather than
dropped. `drop_column` will not build a delete request until it has been
shown the orphans, which is what stops a caller reaching for the delete
without having asked the question.

Pure: builds requests, talks to no sheet.
"""
import stagec

DESCS = "Supporting SLO descriptions"
FLAGS = "Flags"
DESC_SEP = " | "

#: 1-based sheet row of the header on every subject tab.
HEAD_ROW = 3

#: The row kinds that carry SLOs. A banner's first cell spills right.
DAY_KINDS = ("day", "assessment", "review")

#: How a rescued sentence is joined to whatever the cell already says.
JOIN = u" · "


class Unsafe(Exception):
    """The column cannot go without losing something."""


def _idx(header):
    return dict((h, i) for i, h in enumerate(header) if h)


def _cell(row, i):
    return ((row[i] if i is not None and i < len(row) else "") or "").strip()


def orphans(header, body, known):
    """Rows whose sentences the lookup does not hold: [{row, sentences}].

    `known` is every sentence on the lookup tab. A sentence outside it
    exists nowhere else once the column goes.
    """
    i = _idx(header).get(DESCS)
    if i is None:
        return []
    out = []
    for n, raw in enumerate(body):
        if stagec.classify_row(_cell(raw, 0)) not in DAY_KINDS:
            continue
        lost = [s.strip() for s in _cell(raw, i).split(DESC_SEP)
                if s.strip() and s.strip() not in known]
        if lost:
            out.append({"row": HEAD_ROW + 1 + n, "sentences": lost})
    return out


def rescue(header, body, gid, found):
    """Write each orphan into its row's `Flags` cell, keeping what is there.

    Appended rather than replacing: `Flags` is where the folded-revision
    note and the deviation labels already live, and a rescue that
    overwrote one would trade a known loss for a quieter one.
    """
    if not found:
        return []
    idx = _idx(header)
    flags_i = idx.get(FLAGS)
    if flags_i is None:
        raise Unsafe("no %s column to rescue %d row(s) into"
                     % (FLAGS, len(found)))
    reqs = []
    for f in found:
        n = f["row"] - HEAD_ROW - 1
        was = _cell(body[n], flags_i) if n < len(body) else ""
        text = JOIN.join([x for x in [was] + f["sentences"] if x])
        reqs.append({"updateCells": {
            "range": {"sheetId": gid, "startRowIndex": f["row"] - 1,
                      "endRowIndex": f["row"], "startColumnIndex": flags_i,
                      "endColumnIndex": flags_i + 1},
            "rows": [{"values": [{"userEnteredValue":
                                  {"stringValue": text}}]}],
            "fields": "userEnteredValue"}})
    return reqs


def drop_column(header, gid, found):
    """Remove the emptied column, or None if this tab has already lost it.

    `found` is the orphan list, and it is a required argument so that a
    caller cannot ask for the delete without first having asked what the
    column still holds alone. Raises `Unsafe` when the orphans have
    nowhere to go.

    Deleted rather than cleared. A 300-pixel column of blanks beside the
    codes reads as data someone failed to fill in, which is exactly the
    confusion "dark stages stay dark" exists to prevent -- in reverse.
    """
    i = _idx(header).get(DESCS)
    if i is None:
        return None
    if found and FLAGS not in _idx(header):
        raise Unsafe("no %s column to rescue %d row(s) into"
                     % (FLAGS, len(found)))
    return {"deleteDimension": {
        "range": {"sheetId": gid, "dimension": "COLUMNS",
                  "startIndex": i, "endIndex": i + 1}}}
