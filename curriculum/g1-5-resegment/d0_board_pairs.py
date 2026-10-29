"""d0_board_pairs.py -- a two-column pairing board -> a `match` drawing.

OPERATOR (bd-287sn): *"why is matching given in English instead of on the
board?"* Measured over the 335 ch9-10 boards, 60 panels are rows of exactly two
arrow-joined cells -- "Found -> Lost", "Small -> Big", "Sad -> Happy". Every one
of them fell through to the chalk text dump, because `d0_board_art._try_flow`
refuses a multi-row board whose rows each carry their own hop: chaining
independent pairs into one flow would draw a false sequential relationship
between unrelated items. That refusal is right. The rows are not a flow -- they
are a MATCH, and `diagrams/types/match.js` draws exactly that, two columns with
lettered/numbered handles and no lines joining them.

Split into its own module rather than added to d0_board_art.py, which is at 290
of the 300-line limit (splits beat abstractions).

Engine limits this file codes to, all read from diagrams/types/match.js:
  :43  both columns need at least 2 entries
  :45  more than 4 pairs does not fit a phone  -- a throw here renders the
       dashed "not rendered" placeholder, strictly worse than no figure at all
  :50  spec.lang === "ur" mirrors which side carries the letters
No colour/fill field is ever set (lint_lp.js gate 10 hex-colour trap).
"""

from __future__ import annotations

import re

# A right-hand side that is only a blank is a word to WRITE, not a pair to JOIN
# ("s-u-nn-y -> ____" is the Word Blender). Drawing it as a match would tell the
# child to join a word to an empty box, so those panels keep refusing.
_BLANK_RE = re.compile(r"^[_\-\.\?…\s]+$")

# Same legibility budget as a 2-column grid (d0_board_art._GRID_CHAR_CAP[2]):
# match.js sizes its columns off `measure(...)`, so a long entry does not shrink
# the text, it widens the figure past the phone column instead.
_ENTRY_CAP = 20

_URDU_RE = re.compile(r"[؀-ۿﭐ-﷿ﹰ-﻿]")


def _entries(rows):
    pairs = []
    for row in rows:
        if not isinstance(row, dict) or row.get("kind") != "arrow":
            return None
        cells = row.get("cells")
        if not isinstance(cells, list) or len(cells) != 2:
            return None  # 1 hop is not a pair; 3+ is a chain, which flow draws
        left, right = (str(c or "").strip() for c in cells)
        if not left or not right:
            return None
        if _BLANK_RE.match(left) or _BLANK_RE.match(right):
            return None
        if len(left) > _ENTRY_CAP or len(right) > _ENTRY_CAP:
            return None
        pairs.append((left, right))
    return pairs


def try_pairs(rows, meta) -> dict | None:
    """Rows of exactly two arrow-joined cells -> a match spec, else None."""
    if not isinstance(rows, list) or not (2 <= len(rows) <= 4):
        return None
    pairs = _entries(rows)
    if not pairs:
        return None
    left = [a for a, _ in pairs]
    right = [b for _, b in pairs]
    spec = {
        "type": "match",
        "left": left,
        "right": right,
        "alt": "Two columns of %d items to pair up." % len(pairs),
    }
    if any(_URDU_RE.search(s) for s in left + right):
        spec["lang"] = "ur"
    return spec
