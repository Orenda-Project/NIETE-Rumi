"""ASCII box art on a board: frames stripped, and two drawn boards told apart.

Split out of `d0_board.py` when that file reached its 300-line limit. Nothing here
changed in the move -- this is the same frame handling, with the same corpus notes
that were paid for by the bugs named in each docstring.

A teacher-facing HTML page draws its own frames, so an authored `+----+` is a box
inside a box; but the SAME characters also draw the arrows that are board content,
which is the whole difficulty these two functions exist to handle.
"""
from __future__ import annotations

import re

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

# ASCII frame characters (bd-1fr0w). `_unbox` above is Unicode-only on purpose: nothing in
# that block is ever legitimate prose, so a run touching either edge proves the WHOLE line
# is frame and every run on it is safe to strip. None of that holds for `+`, `-`, `|` --
# `-` is also a hyphen ("non-parallel"), `|` also marks an empty beat in a sound-map row
# ("VC |     |"), and `+` sits inside board arithmetic. A line that opens with one of these
# is still, in every corpus case measured, frame padding placed there by the author before
# the real content -- so `_unbox_ascii` strips ONLY that leading run, once per line, and
# never looks at what comes after it. See its own docstring for the two false positives
# (a mid-word hyphen, a sound-map beat) a whole-line Unicode-style rule produced.
_ASCII_FRAME = re.compile(r"^[+\-|]+")


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


def _unbox_ascii(line: str):
    """`(content, was_stripped)` -- the LEADING run of ASCII frame padding taken off a
    line, and nothing else (bd-1fr0w).

    Only the leading edge, iterated: each pass removes one leading run of `+`/`-`/`|`
    (and the whitespace after it), and stops the moment doing so again would leave no
    letter or digit at all -- refusing rather than emptying a pure drawing (`+---+`,
    `|   |/`) onto the page, which would be the forbidden "cutting a drawn shape the
    teacher must put on the board". A leading run immediately followed by `>`/`<` is a
    board arrow, not a frame, and is left alone the same way `_unbox` leaves `-->`.

    NEVER the trailing edge, and never an interior run -- both were tried and both
    corrupt real content this corpus actually has: stripping a trailing run deletes the
    empty-beat marker off a sound-map row ("VC |     |" -> "VC"), and stripping every
    run once any one touches an edge (the Unicode rule, ported unchanged) deletes the
    hyphen out of "non-parallel" because the SAME line also opens with a lone "|".
    A `|` that never opens a line -- the sound-map's own beat separators, or a stroke
    drawn from `/` or `\\` -- is never in this function's path at all.
    """
    cur = line.strip()
    changed = False
    while True:
        m = _ASCII_FRAME.match(cur)
        if not m:
            break
        nxt = cur[m.end():m.end() + 1]
        if nxt and nxt in _ARROWHEAD:
            break  # a leading arrow, not a frame -- e.g. "-> next step"
        after = cur[m.end():].lstrip()
        if not any(c.isalnum() for c in after):
            break  # stripping further would leave a bare drawing with no words in it
        cur = after
        changed = True
    return (cur, True) if changed else (line, False)


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
