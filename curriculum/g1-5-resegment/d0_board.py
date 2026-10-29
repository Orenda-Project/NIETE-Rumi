"""WRITE ON THE BOARD — the board as the teacher will chalk it, in order.

Operator: *"the write on the board should be rendered, it cant be in html? heading colour
anf formatting should be differenyt / its a block of text that should show clearly how it
should be ordered rather than give a script of what to draw and how"*.

Both halves of that are answered by data the corpus ALREADY carries and the render was
throwing away.

WHY THE OLD RENDER WAS A RUN-ON STRING. `boardWork.content` is authored as a laid-out
board -- blank-line-separated groups, each with its own heading, in the order they go up:

    CHAPTER 9 REVIEW: THE DANCING POEM

    Vocabulary:
    sway = move slowly side to side
    twirl = spin around quickly

    CINQUAIN LADDER
    [1 word] Title
    [2 words] Describe

That went into `board.text` as one string, and HTML collapses `\n` to a single space, so
38 authored boards printed as 38 paragraphs. Nothing was missing from the data; the
newlines were the layout, and the renderer dropped them on the floor. So the answer to
*"it cant be in html?"* is that it can, and the order is already written down.

Measured on the 38-segment G4 Ch9 corpus: content on 38/38, blank-line groups on 31/38,
median 4 groups, and a heading on the first line of 47 of the 88 multi-line groups.

WHAT IS DELIBERATELY NOT PRINTED. `boardWork.instruction` is the draw script -- "Draw the
five-line cinquain ladder and the grammar choice arrows" -- which is exactly what the
operator asked to stop printing. It is a source field with a source, rejected as teacher
content, so it joins `scope_declaration` in never reaching paper (see d0_primary's
docstring). The ORDER it was trying to convey is the panel order, which the board itself
now shows.

Nothing is inferred and nothing is reflowed. A group becomes a panel, a line stays a line,
and the order on the page is the order in the field.
"""

from __future__ import annotations

import re

import d0_board_strip
from d0_board_boxes import _boards, _unbox, _unbox_ascii
from d0_board_prose import split_prose
from d0_board_table import join_cells, split_table, table_rows

_BLANK = re.compile(r"\n\s*\n")
# ` = ` binds looser than ` -> `, so it is taken LAST: "sway -> may -> display = rhyme"
# is one chain glossed as "rhyme", not "sway" glossed as "may -> display = rhyme".
_EQ = " = "
_ARROWS = ("→", "➔", "->")
_HEADING_TAIL = ":：۔"


def _is_heading(line: str) -> bool:
    """A group's first line labels the group when it is punctuated or cased as a label.

    Two forms appear in the corpus and both are the author writing a heading, not a board
    line: `Vocabulary:` (trailing colon) and `CINQUAIN LADDER` (all caps). A line with a
    gloss separator in it is a board line however it is cased, which is what keeps
    `READ -> EXPLAIN -> ASK -> WRITE` out of the heading slot.
    """
    s = line.strip()
    if not s or _split_pair(s):
        return False
    if s[-1] in _HEADING_TAIL:
        return True
    letters = [c for c in s if c.isalpha()]
    return len(letters) >= 3 and all(c.isupper() for c in letters)


def _split_pair(line: str):
    """`term = gloss` / `term -> gloss` -> (term, gloss), else None.

    A separator glosses the line only when there is exactly ONE of it. With two or more
    the line is not a pair, it is a row of its own, and splitting it puts the wrong thing
    in the term column:

        READ -> EXPLAIN -> ASK -> WRITE          a sequence across the whole panel
        1 week = 7 days   1 day = 24 hours       three pairs already laid out in columns

    Both appear in the corpus, and both came out wrong when the split was greedy -- the
    first made `READ` the term and the rest of the lesson its meaning, the second made
    everything up to `1 hour` the term of `sixty minutes`. An earlier pass tried to tell
    them apart by the panel's line count, which got the chain right by luck and then
    refused to gloss a panel that held one genuine pair.

    This is the only structure read out of a line. Everything else -- `[1 word] Title`,
    a line of a worked cinquain, a banner, a multi-pair row -- stays the string the
    author wrote, and the render gives it a row to itself.
    """
    s = line.strip()
    for sep in (_EQ,) + _ARROWS:
        if s.count(sep) != 1:
            continue
        term, gloss = s.split(sep, 1)
        if term.strip() and gloss.strip():
            return term.strip(), gloss.strip()
    return None


def _rows(lines, want_label: bool):
    """The plain, non-table read of a run of board lines -> (label, rows)."""
    label = None
    kept = []
    for l in lines:
        content, framed = _unbox(l)
        if not framed:
            # bd-1fr0w: `_unbox` is Unicode-only on purpose (see d0_board_boxes) -- an
            # ASCII frame (`+---+`, `|  |`) survived here verbatim. `_unbox_ascii` only
            # ever takes the leading padding off; a pure drawing with no words in it
            # comes back unchanged, same as before.
            content, framed = _unbox_ascii(l)
        if not framed:
            kept.append(l)
            continue
        if not content:
            continue
        # A framed line that OPENS the panel is titling it; one further down is a divider
        # the author labelled, and that is a row.
        if want_label and label is None and not kept:
            label = content.rstrip(_HEADING_TAIL).strip()
        else:
            kept.append(content)
    if want_label and label is None and len(kept) > 1 and _is_heading(kept[0]):
        label = kept[0].rstrip(_HEADING_TAIL).strip()
        kept = kept[1:]
    rows = []
    for l in kept:
        # A board authored as ONE paragraph has no line breaks to make rows from, so it
        # would arrive as a single 500-character row and the renderer would lay it out
        # as a wall -- *"it should show clearly how it should be ordered"* (operator).
        # Its sentences ARE its build order. Short lines come back unchanged, so the
        # 240 boards that already arrive as several lines pass through untouched.
        #
        # This runs BEFORE the pair read, and the order matters: a paragraph that
        # happens to contain one `=` (g4_ch10 English_seg1: "picture + words = main
        # idea") was otherwise claimed whole as one term and one 600-character gloss,
        # and the split never ran at all. A gloss that long is not a gloss.
        for part in split_prose(l):
            pair = _split_pair(part)
            rows.append({"term": pair[0], "gloss": pair[1]} if pair else {"text": part})
    return label, rows


def _panel(group: str) -> dict | None:
    lines = [l.strip() for l in group.strip().split("\n") if l.strip()]
    if not lines:
        return None
    # A DRAWN TABLE is read as a table BEFORE `_unbox` gets the lines. `_unbox` replaces
    # every box-drawing run on a framed line with a single space, and a table's column
    # separators `|` are box-drawing characters, so the cells of a row arrived glued into
    # one sentence -- g3_ch9 English_seg2 printed "Aeroplane, p.101  "Fasten your  Fasten
    # your seatbelts." A cell the author wrapped onto a second drawn line became its own
    # row on top of that, which is what split the words. Detection is deliberately strict
    # (see d0_board_table): a board it does not recognise as a table falls through to
    # exactly the read it had before.
    before, table, after = split_table(lines)
    if table is None:
        label, rows = _rows(lines, True)
    else:
        label, rows = _rows(before, True)
        trows = table_rows(table)
        # A lone line above the table heads it -- the table IS the something-to-head that
        # `_rows` looks for below a heading, and g5_ch8 Urdu_seg9 labels its chart that
        # way ("the small chart at the left edge (two boxes):").
        if label is None and len(rows) == 1 and _is_heading(rows[0].get("text") or ""):
            label = rows[0]["text"].rstrip(_HEADING_TAIL).strip()
            rows = []
        if label is None and not rows:
            # Same promotion the framed path does: the first thing in the panel titles it.
            if table["header"] is not None:
                label = join_cells(table["header"])
            elif len(trows) > 1:
                head = trows[0]
                label = head.get("text") or join_cells([head["term"], head["gloss"]])
                trows = trows[1:]
        rows = rows + trows + _rows(after, False)[1]
    if not rows:
        return None
    panel = {"rows": rows}
    if label:
        panel["label"] = label
    return panel


def board_panels(content: str) -> dict:
    """Parse `boardWork.content` into `{title?, panels[]}` in board order.

    The returned panels are the renderer's `board.panels`; `title` is what is chalked
    across the top. A board with no blank lines is one panel, which still puts each
    authored line on its own row.
    """
    text = (content or "").strip()
    if not text:
        return {"panels": []}
    groups = [g for g in _BLANK.split(text) if g.strip()]
    title = None
    # The board's own title: a single-line opening group. It is the one line that is not
    # part of any panel, because on a real board it spans all of them -- so it is only a
    # title when there is something under it to span. Three Urdu boards in the corpus are
    # one line and nothing else; promoting that line printed a board heading over an
    # empty board, when what the teacher wrote is a board with one thing on it.
    if len(groups) > 1 and len([l for l in groups[0].strip().split("\n") if l.strip()]) == 1:
        first = groups[0].strip()
        if not _split_pair(first):
            title = first.rstrip(_HEADING_TAIL).strip()
            groups = groups[1:]
    # The renderer numbers PANELS, not rows: rasterising g3_ch9 Maths_seg2 shows badges
    # 1-5 down the left, one per blank-line group, each a step the teacher chalks. So a
    # board authored as ONE paragraph arrived as one group and six ordered sentences came
    # out under a single badge 1 -- ordered, but not *shown* to be ordered, which is what
    # was asked for: *"it should show clearly how it should be ordered"* (operator). Its
    # sentences are its build steps, so each becomes a panel and gets its own number.
    # Only a lone line is split; a group that already has line breaks is a panel the
    # author drew, and the 240 boards that arrive that way do not move.
    groups = [
        part
        for g in groups
        for part in (split_prose(g.strip()) if len(g.strip().split("\n")) == 1 else [g])
    ]
    panels = []
    for g in groups:
        for lines, connector in _boards(g):
            p = _panel("\n".join(lines))
            if not p:
                continue
            # The connector rides on the panel it leads INTO, so one ordered list still
            # carries the whole board and a reader that ignores the key prints both boards.
            if connector and panels:
                p["connector"] = connector
            panels.append(p)
    out = {"panels": panels}
    if title:
        out["title"] = title
    return out


def board_block(board):
    """WRITE ON THE BOARD -- the finished board, on page 1.

    Operator's page map: *"finally there should be a write on the board section here with
    all the relevant things that will go on the board"* -- `here` being page 1, under the
    to-prepare tables. It was reaching the teacher only on page2, which is the reference
    half she reads after the lesson, not the half she copies from before it.

    ONE HOME still holds, and `boardWork` is now down to ONE printed field. `content` is
    what goes on the board and prints here, laid out. `instruction` is the draw script --
    "Draw the five-line cinquain ladder and the grammar choice arrows" -- and the operator
    has ruled it off the page: *"its a block of text that should show clearly how it should
    be ordered rather than give a script of what to draw and how"*. It is a source field
    with a source, rejected as teacher content, so it joins `scope_declaration` in never
    reaching paper. The ORDER it was trying to describe is the panel order, which the board
    now shows directly (d0_board), so nothing it carried is lost.

    `text` is still emitted alongside `panels`. The renderer prefers `panels`, but `text`
    is what the schema, lint and every `ur_overlay` pointer address, and it is the fallback
    for a board the parse cannot panel. It is never PRINTED twice -- only stored twice.

    `content` CAN ARRIVE AS A LIST, not the blank-line string this module assumes --
    unjoined, `.strip()` raised out of `to_lp_doc` and took 23 good rows down with the one
    that carried it. Joined here instead of `str(list)`'d, a Python repr on her page."""
    raw = (board or {}).get("content")
    parts = raw if isinstance(raw, list) else [raw]
    text = "\n\n".join(p for p in parts if isinstance(p, str)).strip()
    # g4_ch9/Science_seg1 and g5_ch9/Science_seg4 (7 board strings, bd-obv6l) carry a
    # literal backslash+"n" where the source trace double-escaped a real newline -- it
    # survives JSON decoding as two characters, not one, so the join above never turns it
    # back into a line break and board_panels' blank-line regex never fires: the board
    # panels as one blob instead of by its authored groups. Every other board's backslashes
    # sit in ASCII art immediately before a real newline or an underscore, never before the
    # letter n, so this replace only ever fires on the double-escaped two.
    text = text.replace("\\n", "\n")
    if len(text) < 3:
        return None
    blk = {"type": "board", "id": "board-plan", "text": text}
    laid_out = board_panels(text)
    if laid_out["panels"]:
        # bd-1fr0w fix #1: once d0_board_draw has drawn a picture for this
        # board ("solid"/"clock"/"geometry"), the panels that used to print
        # its ASCII layout as text are cleaned of that layout here -- see
        # d0_board_strip's module docstring. A no-op for every other board.
        # `panels` is itself minItems:1 in the schema -- on the (unreached by
        # any known board) chance stripping empties it completely, keep the
        # unstripped panels rather than emit a schema-illegal empty array.
        stripped = d0_board_strip.apply_panels(laid_out["panels"], board)
        blk["panels"] = stripped if stripped else laid_out["panels"]
        if laid_out.get("title"):
            blk["title"] = laid_out["title"]
    return blk
