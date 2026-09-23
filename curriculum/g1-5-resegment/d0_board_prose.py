"""A board authored as a paragraph, split into the order it gets chalked in.

OPERATOR, on WRITE ON THE BOARD: *"its a block of text that should show clearly how it
should be ordered rather than give a script of what to draw and how"*.

WHAT THIS IS FOR. `d0_board._panel` makes one row per LINE of the authored field. That
is right for the 240 boards that arrive as several short lines -- the renderer numbers
each row and the board comes out in build order, which is what the teacher copies. It
is wrong for the 43 that arrive as ONE paragraph with no line breaks: those become a
single 500-character row, and the renderer lays them out as an unbroken wall. Urdu
carries 20 of the 43, and Urdu is the band the operator reads most closely.

WHAT IT DELIBERATELY DOES NOT DO. It does not rewrite, shorten or re-word anything --
*"1. B"*, leave every authored word alone. The join of the output is the input. It also
refuses to split a long run that carries no sentence end at all: chopping that at some
column would invent a build step the author never wrote, and an invented step on a
board is worse than a long one.
"""
from __future__ import annotations

import re

# Long enough that the renderer wraps it into a block rather than a row. Below this a
# line is already read as one instruction, and splitting it only adds noise.
MIN_PROSE_CP = 140

# A sentence end that is really one: the terminator, then whitespace, then something
# that starts a new sentence. Urdu's full stop (U+06D4) and question mark (U+061F) sit
# beside the Latin ones because 20 of the 43 prose boards are Urdu -- a splitter that
# only knew "." would leave the worst-affected half of the corpus exactly as it was.
_END = re.compile(r"(?<=[.!?۔؟؛])\s+")

# "1.5 metres" and "p.151" are not sentence ends. A period flanked by digits, or one
# following a single letter, stays inside its row.
_NOT_END = re.compile(r"(?:\d\.\d|(?<![A-Za-z])[A-Za-z]\.)\Z")


def _as_text(value) -> str:
    return value if isinstance(value, str) else ""


def split_prose(line) -> list[str]:
    """One authored paragraph -> its sentences, in board order.

    Returns `[line]` unchanged whenever there is no order to show: a short line, a
    long line with no sentence end, or anything that is not a string at all. NEVER
    raises -- this sits on the path every board takes to paper.
    """
    text = _as_text(line)
    if not text:
        return [line] if isinstance(line, str) else []
    if len([*text]) < MIN_PROSE_CP:
        return [text]

    parts: list[str] = []
    for piece in _END.split(text):
        if parts and _NOT_END.search(parts[-1]):
            # The previous fragment ended mid-number or mid-abbreviation; the split
            # was an artefact, so put the two halves back together.
            parts[-1] = f"{parts[-1]} {piece}"
        else:
            parts.append(piece)

    parts = [p for p in parts if p.strip()]
    return parts if len(parts) > 1 else [text]
