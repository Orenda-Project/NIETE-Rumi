"""A board table that is DRAWN, read back as the columns the author drew.

THE BUG (bd-pmv8n). `d0_board_boxes._unbox` knows a frame, and it strips every
box-drawing run in a framed line -- including the `│` BETWEEN two columns. So
g3_ch9/English_seg2's three-column chart printed each row as one sentence, and a
cell the author had wrapped onto a second line printed as an orphan row under it.
On paper that reads *"Fasten your Fasten your seatbelts. seatbelts."*: the exact
quotation and the instruction, run together and then cut by the wrap.

WHAT TELLS A TABLE FROM THE REST OF THE BOX ART. A table top border, and nothing
else: a line made ONLY of box-drawing characters that opens `┌`, closes `┐` and
carries at least one `┬`. Four corpus shapes break under anything looser and
each one is a test:

  * two boxes SIDE BY SIDE (g1_ch9 English_seg6) -- `┌──┐   ┌──┐` has the corners
    but a SPACE in the middle, so it is not all box-drawing;
  * an arrow hung off a box (g2_ch10 Urdu_seg6) -- its `┬` sits on a CLOSING
    `└─┬─┘`, which marks where the arrow leaves, not where a column divides;
  * a rectilinear SHAPE (g4_ch10 Maths_seg3) -- its `┼` line opens `┌` and closes
    `┘`, and carries the dimension "4 m" in the border itself;
  * an angle chart whose cells hold chalk art (g4_ch10 Maths_seg6) -- a `│` drawn
    INSIDE a cell makes that line split into more cells than the border has
    columns, and a table that cannot be read whole is not read at all.

COLUMNS ARE SPLIT ON `│`, NOT ON THE BORDER'S COLUMN POSITIONS. Character index
is not column position once the row is Urdu: every Urdu table in the corpus mixes
RTL marks and joined forms, so its `│` lands nowhere near the border's `┬`. The
COUNT is what the border is read for, and a row that does not split into exactly
that many cells is not a row of this table.

A WRAPPED CELL IS PUT BACK TOGETHER only in a table that rules a `├─┼─┤` under
its head. That rule is the author saying the rows run ACROSS. Without one a table
may just as well be read down its columns -- g5_ch10 English_seg1 draws four
vocabulary entries as four COLUMNS -- and joining a line into the one above it
there would glue four unrelated entries together.
"""
from __future__ import annotations

import re

_TOP_LEFT = "┌╭┏╔"
_TOP_RIGHT = "┐╮┓╗"
_BOT_LEFT = "└╰┗╚"
_BOT_RIGHT = "┘╯┛╝"
_TOP_TEE = "┬┯┰┳╤╦"
_LEFT_TEE = "├┝┠┣╞╟╠"
_RIGHT_TEE = "┤┥┨┫╡╢╣"
_VERT = "│┃║"
_SPLIT = re.compile("[" + _VERT + "]")
# The column separator the corpus itself uses when it writes columns inline, e.g.
# "Text words: fact | fiction | nonfiction" two lines under this very table.
SEP = " | "


def _all_box(s: str) -> bool:
    return bool(s) and all("─" <= c <= "╿" for c in s)


def _is_top(line: str) -> bool:
    s = line.strip()
    return (
        _all_box(s)
        and s[0] in _TOP_LEFT
        and s[-1] in _TOP_RIGHT
        and any(c in _TOP_TEE for c in s)
    )


def _is_bottom(line: str) -> bool:
    s = line.strip()
    return _all_box(s) and s[0] in _BOT_LEFT and s[-1] in _BOT_RIGHT


def _is_divider(line: str) -> bool:
    s = line.strip()
    return _all_box(s) and s[0] in _LEFT_TEE and s[-1] in _RIGHT_TEE


def _cells(line: str, ncols: int):
    """The line's cells, or None when it is not a row of a table this wide."""
    s = line.strip()
    if not s or s[0] not in _VERT:
        return None
    parts = _SPLIT.split(s)
    if parts and not parts[0].strip():
        parts = parts[1:]
    if parts and not parts[-1].strip():
        parts = parts[:-1]
    if len(parts) != ncols:
        return None
    return [p.strip() for p in parts]


def _merge(rows: list[list[str]]) -> list[list[str]]:
    """A row whose FIRST cell is empty continues the row above it, cell by cell.

    That empty first cell is the only thing in the field that tells a wrapped cell
    from a row of its own, and it is what the author left behind when the text ran
    past the width they had drawn."""
    out: list[list[str]] = []
    for row in rows:
        if out and not row[0]:
            out[-1] = [" ".join(p for p in pair if p) for pair in zip(out[-1], row)]
        else:
            out.append(row)
    return out


def split_table(lines: list[str]):
    """`(before, table, after)` -- the one drawn table in a group, if there is one.

    `table` is `{"header": list[str]|None, "rows": list[list[str]], "ncols": int}`,
    or None, in which case `before` is every line handed in and nothing is claimed.
    A table is read WHOLE or not at all: one body line that will not split into the
    border's column count leaves the whole drawing to the frame-stripping path."""
    top = next((i for i, l in enumerate(lines) if _is_top(l)), None)
    if top is None:
        return list(lines), None, []
    ncols = sum(c in _TOP_TEE for c in lines[top]) + 1
    bottom = next((j for j in range(top + 1, len(lines)) if _is_bottom(lines[j])), None)
    if bottom is None:
        return list(lines), None, []
    bands: list[list[list[str]]] = [[]]
    for line in lines[top + 1:bottom]:
        if _is_divider(line):
            bands.append([])
            continue
        cells = _cells(line, ncols)
        if cells is None:
            return list(lines), None, []
        bands[-1].append(cells)
    ruled = len(bands) > 1
    header = None
    if ruled and len(bands[0]) == 1:
        header, bands = bands[0][0], bands[1:]
    rows = [r for band in bands for r in band]
    if ruled:
        rows = _merge(rows)
    rows = [r for r in rows if any(r)]
    if not rows and header is None:
        return list(lines), None, []
    table = {"header": header, "rows": rows, "ncols": ncols}
    return list(lines[:top]), table, list(lines[bottom + 1:])


def join_cells(cells: list[str]) -> str:
    return SEP.join(c for c in cells if c)


def table_rows(table: dict) -> list[dict]:
    """The table's rows in the shape the renderer already draws.

    `.bb` is a two-track grid (`bk` + `bg`), so a TWO-column table is rendered as
    real columns with no change to the template at all. Wider than that the
    renderer has one full-width track, and the cells print into it separated the
    way the corpus separates inline columns -- visibly, never run together."""
    if table["ncols"] == 2:
        return [{"term": r[0], "gloss": r[1]} for r in table["rows"] if r[0] and r[1]] or [
            {"text": join_cells(r)} for r in table["rows"]
        ]
    return [{"text": join_cells(r)} for r in table["rows"]]
