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
import stagec
import stagec_spines

_DERIVED = ("Moves", "Teacher-primary min (of 40)")


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


def _parse_range(rng):
    """"'Tab'!C4:C6" -> ("C", 4). The tab name may itself contain a !."""
    cells = rng.rsplit("!", 1)[-1]
    start = cells.split(":")[0]
    letter = "".join(ch for ch in start if ch.isalpha())
    row = int("".join(ch for ch in start if ch.isdigit()))
    return letter, row


def readback_cells(sent_payload, header, value_ranges):
    """Turn batchGet ranges back into {row: {column: value}}.

    Anchored on what was SENT, not on what came back: Sheets truncates a
    column whose trailing cells are empty, and can omit it altogether. Those
    cells must read as empty so diff_readback reports them, because a write
    that never landed looking clean is the one failure a read-back exists to
    catch.
    """
    by_letter = {col_letter(i): h for i, h in enumerate(header)}
    got = {}
    for vr in sent_payload:
        letter, first = _parse_range(vr["range"])
        if letter not in by_letter:
            raise KeyError("column %s is not in the header" % letter)
        for i in range(len(vr["values"])):
            got.setdefault(first + i, {})[by_letter[letter]] = ""
    for vr in value_ranges:
        letter, first = _parse_range(vr["range"])
        if letter not in by_letter:
            raise KeyError("column %s is not in the header" % letter)
        for i, block in enumerate(vr.get("values") or []):
            got.setdefault(first + i, {})[by_letter[letter]] = (
                block[0] if block else "")
    return got


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


def merge_cells(rows, subject, worker_cells):
    """Assemble the derived columns and the swarm's columns into one write.

    `Moves` and `Teacher-primary min (of 40)` are DERIVED here, from skill type
    x grade band, and the teacher-primary figure is computed from the very
    spine the row ships with -- the two can never disagree because only one of
    them is authored. A worker that reaches for either column is refused
    rather than overridden, so the collision is visible instead of silent.
    """
    out = {}
    by_row = {}
    for r in rows:
        by_row[r["_row"]] = r
        kind = r.get("kind")
        shape = stagec_spines.shape_for_kind(kind)
        if kind == "day":
            moves = stagec_spines.spine_for(
                r["cells"].get("Skill type"), subject, r["grade"])
        elif shape is not None:
            moves = stagec_spines.SPINES[(shape, stagec_spines.band(r["grade"]))]
        else:
            continue
        # The cell value is the formatted spine: these dicts go straight to
        # build_payload, which sends them to the sheet. Teacher-primary is
        # computed from the spine before it is formatted, so the number and
        # the string in the neighbouring column describe the same day.
        cells = {"Moves": stagec.format_moves(moves)}
        if kind == "day":
            cells["Teacher-primary min (of 40)"] = str(
                stagec.teacher_primary_min(moves))
        out[r["_row"]] = cells

    for row, given in (worker_cells or {}).items():
        target = out.get(row)
        if target is None or by_row.get(row, {}).get("kind") != "day":
            raise ValueError("row %s takes no authored cells" % row)
        for col, value in given.items():
            if col in _DERIVED:
                raise ValueError("row %s: %s is derived, not authored" % (row, col))
            target[col] = value
    return out
