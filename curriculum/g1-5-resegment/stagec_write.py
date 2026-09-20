# -*- coding: utf-8 -*-
"""Build and check the Stage C write payload. Pure; the send lives elsewhere.

Strategy: one ValueRange per written column, spanning every data row of the
tab. Rows Stage C does not write carry their CURRENT value through unchanged,
so the payload is a whole-column statement rather than a scatter of cells --
36 ranges for the four tabs instead of several thousand, and a read-back that
can be compared cell for cell.

The cost of that strategy is that a bug here blanks rows rather than skipping
them, which is why every pass-through case is pinned in the tests.
"""


def col_letter(idx):
    """0 -> A, 25 -> Z, 26 -> AA."""
    out = ""
    n = idx + 1
    while n:
        n, rem = divmod(n - 1, 26)
        out = chr(65 + rem) + out
    return out


def build_payload(tab, header, rows, new_values, columns):
    """ValueRanges for `columns`, with untouched rows carrying current values.

    Raises rather than guessing: an unknown row, a column absent from the
    header, or a value aimed at a column we are not writing are all defects in
    the caller, not conditions to absorb.
    """
    index = {h: i for i, h in enumerate(header)}
    for col in columns:
        if col not in index:
            raise KeyError("%r is not a column of %s" % (col, tab))
    known = {r["_row"] for r in rows}
    for row in new_values:
        if row not in known:
            raise KeyError("row %s is not a data row of %s" % (row, tab))
        stray = set(new_values[row]) - set(columns)
        if stray:
            raise ValueError("row %s carries values for columns we are not "
                             "writing: %s" % (row, ", ".join(sorted(stray))))
    ordered = sorted(rows, key=lambda r: r["_row"])
    first, last = ordered[0]["_row"], ordered[-1]["_row"]
    if last - first + 1 != len(ordered):
        raise ValueError("%s: data rows are not contiguous (%d..%d for %d rows)"
                         % (tab, first, last, len(ordered)))
    payload = []
    for col in columns:
        letter = col_letter(index[col])
        block = []
        for r in ordered:
            value = new_values.get(r["_row"], {}).get(col)
            if value is None:
                # Not ours to change on this row: pass the current value
                # through. A cell still reading "pending" stays pending --
                # a whole-column write must not quietly blank an unfilled gap.
                value = r["cells"].get(col, "")
            block.append([value])
        payload.append({"range": u"'%s'!%s%d:%s%d" % (tab, letter, first,
                                                      letter, last),
                        "values": block})
    return payload


def diff_readback(sent, got):
    """Cells that did not land, as human-readable findings."""
    out = []
    for row in sorted(sent, key=int):
        if row not in got:
            out.append("row %s did not come back at all" % row)
            continue
        for col, want in sorted(sent[row].items()):
            have = got[row].get(col)
            if have != want:
                out.append("row %s %s: sent %r, sheet holds %r"
                           % (row, col, want, have))
    return out
