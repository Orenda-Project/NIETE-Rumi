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

_BLANK = re.compile(r"\n\s*\n")
# ` = ` binds looser than ` -> `, so it is taken LAST: "sway -> may -> display = rhyme"
# is one chain glossed as "rhyme", not "sway" glossed as "may -> display = rhyme".
_EQ = " = "
_ARROWS = ("→", "➔", "->")
_HEADING_TAIL = ":：۔"
# The Unicode box-drawing block. A teacher-facing HTML page draws its own frames, so an
# ASCII one is a drawing of a box inside a box -- and a 60-character run of U+2500 has no
# break opportunity, which is how ten corpus boards laid themselves out wider than the
# page and printed their gloss column off the right edge. See _unbox.
_BOX = re.compile(r"[\u2500-\u257f]+")
# THE SAME CHARACTERS ALSO DRAW AN ARROW. `--> ` is `\u2500\u2500>`, and the corpus uses it
# 38 times to point one thing at another. It is content and the frame is not.
_ARROWHEAD = ">\u276f\u00bb"
_ARROWTAIL = "<\u276e\u00ab"
# A BOX THAT CLOSES BEFORE ANOTHER OPENS IS A SECOND BOARD (bd-i44jn). These are the only
# two characters that decide it: a top-left corner starts a box, a bottom-left corner ends
# one. Nothing else in the block is read as structure, because nothing else is -- see
# _boards for the three corpus shapes that a looser rule shatters.
_OPENS = "\u250c\u256d\u250f"   # top-left:    box-drawings light / arc / heavy
_CLOSES = "\u2514\u2570\u2517"  # bottom-left: the same three


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


def _unbox(line: str):
    """`(content, was_framed)` — a terminal frame stripped off a line.

    `┌──── Apostrophe Alley ────┐` is the author drawing a panel for a fixed-width
    terminal. The title inside it is the panel's own label, which the render already has a
    place for; the `└────┘` that closes it carries nothing and is the frame alone.

    A FRAME TOUCHES A LINE EDGE. That is the whole test, and it is not a refinement: the
    first cut of this took every run in the block, and `──>` is drawn from that same block.
    It mangled 38 arrows across 10 boards into a bare `>` and deleted a panel outright —
    `[Question] ──> [KEY words] ──> [Main point]` is one line, so stripping its runs left
    nothing and the panel vanished. An arrow points BETWEEN two things the author wrote,
    which is exactly why it is never at an edge. `→ APPLY THE CLUE →` is untouched for a
    second reason: U+2192 is not in the block at all.
    """
    def _arrow(m):
        after, before = line[m.end():m.end() + 1], line[m.start() - 1:m.start()]
        return (after and after in _ARROWHEAD) or (before and before in _ARROWTAIL)

    runs = [m for m in _BOX.finditer(line) if not _arrow(m)]
    if not runs:
        return line, False
    stripped = line.strip()
    off = line.index(stripped) if stripped else 0
    if not any(m.start() - off <= 0 or m.end() - off >= len(stripped) for m in runs):
        return line, False
    out, at = [], 0
    for m in runs:
        out.append(line[at:m.start()])
        out.append(" ")
        at = m.end()
    out.append(line[at:])
    return "".join(out).strip(), True


def _boards(group: str):
    """One authored group -> `[(lines, connector)]`, one entry per board drawn in it.

    `English_seg6` draws a finished box, an arrow, then a second finished box with NO
    blank line, so grouping on blank lines alone printed two boards as one 15-row panel
    and the second title landed as a plain row (bd-i44jn).

    THE BOUNDARY IS A CLOSE FOLLOWED BY AN OPEN, and the narrowness is the design.
    `_unbox` knows a FRAME (a line touching an edge), not a BOARD; three corpus shapes
    break under anything looser: `Science_seg2` (one instrument TABLE drawn as a box --
    "split on a framed line" makes five panels), `Maths_seg9` (two boxes SIDE BY SIDE
    opening on the same line), `Maths_seg6` (diagonals, no box at all). Only a box that
    has finished before the next starts is a second board; exactly one of 38 is.

    A line in the gap -- after the close, before the open -- is the CONNECTOR the teacher
    chalks between the boxes, so it belongs to neither board's rows.
    """
    lines = [l for l in group.strip().split("\n") if l.strip()]
    out, cur, gap, lead, closed = [], [], [], None, False
    for l in lines:
        head = l.strip()[:1]
        if head in _OPENS and closed and cur:
            # The gap belongs to the board it leads INTO, not the one it left.
            out.append((cur, lead))
            cur, lead, gap, closed = [], " ".join(gap).strip() or None, [], False
        if closed and head not in _OPENS:
            gap.append(l.strip())
            continue
        cur.append(l)
        if head in _CLOSES:
            closed = True
    if cur:
        out.append((cur, lead))
    # A trailing gap closes the last board rather than leading into a board that was never
    # drawn, so it stays a row of it -- no word of it is lost.
    if gap and out:
        out[-1][0].extend(gap)
    return out


def _panel(group: str) -> dict | None:
    lines = [l.strip() for l in group.strip().split("\n") if l.strip()]
    if not lines:
        return None
    label = None
    kept = []
    for l in lines:
        content, framed = _unbox(l)
        if not framed:
            kept.append(l)
            continue
        if not content:
            continue
        # A framed line that OPENS the panel is titling it; one further down is a divider
        # the author labelled, and that is a row.
        if label is None and not kept:
            label = content.rstrip(_HEADING_TAIL).strip()
        else:
            kept.append(content)
    lines = kept
    if not lines:
        return None
    if label is None and len(lines) > 1 and _is_heading(lines[0]):
        label = lines[0].rstrip(_HEADING_TAIL).strip()
        lines = lines[1:]
    rows = []
    for l in lines:
        pair = _split_pair(l)
        rows.append({"term": pair[0], "gloss": pair[1]} if pair else {"text": l})
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
    """
    text = ((board or {}).get("content") or "").strip()
    if len(text) < 3:
        return None
    blk = {"type": "board", "id": "board-plan", "text": text}
    laid_out = board_panels(text)
    if laid_out["panels"]:
        blk["panels"] = laid_out["panels"]
        if laid_out.get("title"):
            blk["title"] = laid_out["title"]
    return blk
