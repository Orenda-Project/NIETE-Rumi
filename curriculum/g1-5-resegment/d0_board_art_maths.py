"""d0_board_art_maths.py -- maths-only board -> renderDiagram spec builders.

Split out of d0_board_art.py (300-line file limit; splits beat abstractions).
This module has no dependency on d0_board_art.py -- it is the base the other
module imports from, so the two never import each other in a cycle.

Each try_*(rows, meta) takes the ALREADY-single-panel row list (the "exactly
one panel" gate lives in d0_board_art.spec_for) and returns a renderDiagram
spec dict, or None when the rows don't honestly support that diagram. These
are pure functions: no I/O, stdlib only (re/typing).

Figure geometry (corrected twice, then pinned a third and final time against
lib/template.js:1595-1612 in the bd-yjmxh worktree -- earlier 729/13.5/1109
and 478 figures were both wrong): PRIMARY_DIAGRAM_MIN_PX = 15.5px is the
label-legibility floor and PRIMARY_FIG_MAX_H = 1086px is the height ceiling.
PHONE_FULL_COL = 455px is a phone-page scaling anchor, not a width we must
hit ourselves -- `primaryRedraw` narrows the canvas for us (a real geometry
spec measured 620px -> 381px, lifting its smallest label from 9.54px to
15.52px). What narrowing can NOT do is shrink height: a spec dense enough to
need >1086px tall after narrowing is a hard render failure, not a smaller
figure. So the lever here is content density -- few shapes, few labels, short
label text -- not a pixel computation this pure-Python module can do exactly
(the exact check is `requiredBox` from diagrams/lib/svg.js, run in the
verification phase against the real engine, not estimated here). The row/col/
text-length caps below are a conservative, clearly-approximate proxy for that
density budget, never a claim of precise pixel accuracy.

calc rows never become a `grid`: grid.js's cell is a single scalar used for
BOTH width and height (`gw = cols*cell; gh = rows*cell`), so every cell is
forced square. A short table cell ("Triangle", "3") fits a square; a full
calculation line ("750 mL / 1000 = 0.75 L") does not, and shrinking the font
to fit trips the legibility floor instead. So a calc row only ever becomes a
fraction_bar (which is built for exactly this), never a grid -- confirmed by
reading grid.js's render(), not assumed from the mapping table alone.
"""

from __future__ import annotations

import re

PRIMARY_DIAGRAM_MIN_PX = 15.5
PRIMARY_FIG_MAX_H = 1086

_TIME_RE = re.compile(r"\b([01]?\d):([0-5]\d)\b")
_CLOCK_WORDS_RE = re.compile(r"\bclocks?\b|o.clock|\bhour hand\b|\bminute hand\b", re.I)

_NUMBERLINE_WORDS_RE = re.compile(r"number\s*line|\bruler\b|\bthermometer\b", re.I)
_RANGE_RE = re.compile(r"(-?\d+(?:\.\d+)?)\s*(?:to|-|–|—)\s*(-?\d+(?:\.\d+)?)")

_SHAPE_TEMPLATES = {
    "triangle": [[0, 0], [4, 0], [2, 3.2]],
    "square": [[0, 0], [3, 0], [3, 3], [0, 3]],
    "rectangle": [[0, 0], [4, 0], [4, 2.4], [0, 2.4]],
    "circle": None,  # handled as kind="circle", not a point list
    "pentagon": [[2, 4], [4.3, 2.3], [3.4, -0.5], [0.6, -0.5], [-0.3, 2.3]],
    "hexagon": [[1, 3.6], [3, 3.6], [4, 2], [3, 0.4], [1, 0.4], [0, 2]],
}
_COUNT_PAIR_RE = re.compile(r"\b(\d+)\s*(sides?|corners?|edges?|faces?|vertices|vertex)\b", re.I)

_MONEY_ITEM_RE = re.compile(r"\bRs\.?\s*(\d+)\b|\b(\d+)\s*rupees?\b", re.I)
_NOTE_WORD_RE = re.compile(r"\bnotes?\b", re.I)
MAX_MONEY_PIECES = 12

_FRACTION_RE = re.compile(r"\b(\d+)\s*/\s*(\d+)\b")

_TEXT_KINDS = ("frame", "step", "text")
_TEXT_OR_BOX_KINDS = ("frame", "step", "text", "boxart")


def _blob(rows):
    return " ".join((r.get("text") or "") for r in rows)


def _alt(fallback):
    return fallback


def try_clock(rows, meta):
    if not rows or any(r.get("kind") not in _TEXT_KINDS for r in rows):
        return None
    blob = _blob(rows)
    if not _CLOCK_WORDS_RE.search(blob):
        return None
    times = _TIME_RE.findall(blob)
    if len(times) != 1:
        return None  # >1 time stated -- one clock face can't honestly carry all of it
    h, m = times[0]
    time_str = f"{int(h)}:{m}"
    return {
        "type": "clock",
        "time": time_str,
        "alt": _alt(f"An analogue clock showing {time_str}."),
    }


def try_numberline(rows, meta):
    if not rows or any(r.get("kind") not in _TEXT_KINDS for r in rows):
        return None
    blob = _blob(rows)
    if not _NUMBERLINE_WORDS_RE.search(blob):
        return None
    m = _RANGE_RE.search(blob)
    if not m:
        return None
    lo, hi = float(m.group(1)), float(m.group(2))
    if lo >= hi:
        return None
    frm = int(lo) if lo.is_integer() else lo
    to = int(hi) if hi.is_integer() else hi
    return {
        "type": "numberline",
        "from": frm,
        "to": to,
        "alt": _alt(f"A number line from {frm} to {to}."),
    }


def try_geometry(rows, meta):
    if not rows or any(r.get("kind") not in _TEXT_OR_BOX_KINDS for r in rows):
        return None
    blob = _blob(rows)
    counts = _COUNT_PAIR_RE.findall(blob)
    if not counts:
        return None  # a named shape with no stated count is a picture, not this board
    found = [name for name in _SHAPE_TEMPLATES if re.search(rf"\b{name}\b", blob, re.I)]
    if len(found) != 1:
        return None  # 0 or >1 named 2-D shape -- can't honestly draw "the" shape
    name = found[0]
    if name == "circle":
        shape = {"kind": "circle", "c": [0, 0], "r": 2}
    else:
        shape = {"kind": "triangle" if name == "triangle" else "polygon", "points": _SHAPE_TEMPLATES[name]}
    caption = ", ".join(f"{n} {word.lower()}" for n, word in counts)
    return {
        "type": "geometry",
        "shapes": [shape],
        "caption": caption,
        "alt": _alt(f"An outline of a {name}: {caption}."),
    }


def try_money(rows, meta):
    if not rows or any(r.get("kind") not in _TEXT_OR_BOX_KINDS for r in rows):
        return None
    blob = _blob(rows)
    matches = list(_MONEY_ITEM_RE.finditer(blob))
    if not matches:
        return None
    items = []
    for mo in matches:
        value = int(mo.group(1) or mo.group(2))
        window = blob[max(0, mo.start() - 15):mo.end() + 15]
        kind = "note" if _NOTE_WORD_RE.search(window) else "coin"
        items.append({"value": value, "kind": kind})
    if len(items) > MAX_MONEY_PIECES:
        return None
    return {
        "type": "money",
        "items": items,
        "alt": _alt(f"{len(items)} coin(s)/note(s) with their values shown."),
    }


def try_calc(rows, meta):
    if not rows or any(r.get("kind") != "calc" for r in rows):
        return None
    if len(rows) != 1:
        return None  # see module docstring: grid's square cells can't carry a calc chain
    text = (rows[0].get("text") or "").strip()
    if not text:
        return None
    m = _FRACTION_RE.search(text)
    if not m:
        return None
    num, den = int(m.group(1)), int(m.group(2))
    if den <= 0 or den > 24 or num > den:
        return None  # fraction_bar caps parts at 24; an improper fraction isn't "of a bar"
    return {
        "type": "fraction_bar",
        "bars": [{"parts": den, "shaded": num, "label": text}],
        "alt": _alt(f"A bar split into {den} equal parts with {num} shaded, showing {text}."),
    }
