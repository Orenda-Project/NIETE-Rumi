"""d0_board_art_scan.py -- the WHOLE-BOARD scan: the third chance at a drawing.

WHY THIS EXISTS, measured not assumed. `d0_board_art.spec_for` requires exactly
one panel and `panel_spec` requires one panel's rows to be homogeneous in kind.
Across the 105 real Maths boards that leaves 81 with no figure at all, and the
maths engines specifically fire on 2. The reason is not the panel gate -- the
shipping path (`d0_board_draw.board_diagram`) already falls back to per-panel --
it is that a real maths board MIXES kinds. "thermometer = a number line" parses
as `calc` (it has an isolated "="), so `try_numberline`'s `_TEXT_KINDS` gate
refuses it; "lettuce=4, carrot=8" parses as `gloss`; a clock board carries a
`gloss` row and a `calc` row beside its `text` rows. Every one of those is a
board a teacher would draw, refused on a row-kind technicality.

So this module reads the board the way a teacher reads it: as ONE piece of
text, across every panel, ignoring row kind entirely. That is safe here and
only here, because this module is reached from the ADDITIVE
`page2.board_final.diagram` slot -- the `board` block above it still prints
every authored word (it is `additionalProperties:false` with no figure field),
so a figure drawn from part of the board LOSES NOTHING. Nothing in this file is
allowed on the replace path, which is why it is a separate module that
`d0_board_art` does not import.

HONESTY RULES, the same ones the sibling modules keep:
  - A signal word is required before any drawing. A bare "a=4, b=8" is a key,
    not a comparison; "09:00" alone is a departure time, not a clock face.
  - Ambiguity refuses. Two distinct times, two named shapes, two counts, an
    unevenly spaced scale: we draw nothing rather than pick one and be wrong.
  - Captions are built from the values we PARSED, never copied from raw board
    lines -- raw lines carry "[ ]" box marks that are lint-fatal placeholders
    (gate 10), and a caption we assembled cannot smuggle one in by accident.
  - No spec sets a colour/fill field; engine defaults apply.

Pure: stdlib only (`re`), no I/O, no vendor imports.
"""

from __future__ import annotations

import re

import d0_board_art_scan_refuse as refuse

# Ten-frame capacity. count_frame's own shipped examples run 7, 12 and 14; past
# twenty the frame stops being a thing a child counts at a glance.
MAX_FRAME_COUNT = 20
# compare_size's own HARD limits, read off the engine, not guessed: it throws below
# 2 ("at least 2 things are needed") and above 3 ("more than 3 things is a sorting
# exercise, not a comparison"), compare_size.js:45-46. A throw is not a missing
# figure -- the renderer prints a dashed "DIAGRAM - not rendered" box in its place
# (template.js:1710), which is worse for the teacher than drawing nothing. So these
# are not style caps, they are the contract.
MAX_COMPARE_ITEMS = 3
MIN_COMPARE_ITEMS = 2
# A label longer than this renders below the legibility floor; measured in CODE
# POINTS (rule 20) so an Urdu label is not mis-measured as its byte length.
MAX_LABEL_CP = 18

_CLOCK_WORDS = re.compile(r"\bclocks?\b|o.clock|\bhour hand\b|\bminute hand\b", re.I)
_TIME = re.compile(r"\b([01]?\d):([0-5]\d)\b")

_SHAPE_POINTS = {
    "triangle": [[0, 0], [4, 0], [2, 3.2]],
    "square": [[0, 0], [3, 0], [3, 3], [0, 3]],
    "rectangle": [[0, 0], [4, 0], [4, 2.4], [0, 2.4]],
    "circle": None,
    "pentagon": [[2, 4], [4.3, 2.3], [3.4, -0.5], [0.6, -0.5], [-0.3, 2.3]],
    "hexagon": [[1, 3.6], [3, 3.6], [4, 2], [3, 0.4], [1, 0.4], [0, 2]],
}
_COUNT_PAIR = re.compile(r"\b(\d+)\s*(sides?|corners?|edges?|faces?|vertices|vertex)\b", re.I)

_COMPARE_WORDS = re.compile(
    r"\bheavier\b|\blighter\b|\bheaviest\b|\blightest\b|\blonger\b|\bshorter\b"
    r"|\blongest\b|\bshortest\b|\btaller\b|\btallest\b|\bbigger\b|\bsmaller\b"
    r"|\bmass\b|\bcompare\b|\bbalance\b", re.I)
_NAMED_VALUE = re.compile(r"([^,;=\n]+?)\s*=\s*(\d+(?:\.\d+)?)\b")
# A thing being compared has a NAME. "4 x 4 = 16" and "(2 x 60) + 45 min = 165" are
# calculations, and reading "x 4" or "+ 45 min" as the name of a thing is nonsense --
# so a candidate label must be words, not arithmetic: it needs at least two letters
# and must carry no digit or operator.
_NAME_OK = re.compile(r"^[^\d+*/×÷=()\[\]]*$")
_TWO_LETTERS = re.compile(r"[^\W\d_]{2,}", re.UNICODE)

_LINE_WORDS = re.compile(r"number\s*line|\bruler\b|\bthermometer\b|\bscale\b|پیمانہ", re.I)
_RANGE = re.compile(r"(-?\d+(?:\.\d+)?)\s*(?:to|-|–|—)\s*(-?\d+(?:\.\d+)?)")
_NUM_LIST = re.compile(r"-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?){2,}")

_COUNTABLE = re.compile(
    r"\b(\d+)\s+(blocks?|dots?|stones?|beads?|sticks?|cubes?|counters?|squares?|tiles?|buttons?)\b",
    re.I)

# gate 10 of lint_lp.js, in two halves, because the two need different reach.
#
# _UNFINISHED is checked against the BOARD TEXT: a board still carrying "TODO" is
# an unfinished board, and a confident figure drawn from it asserts a completeness
# the source does not have. A hex colour there is authoring debris for the same
# reason. Both refuse at source.
#
# _SPEC_ONLY is checked against the EMITTED SPEC only, and deliberately NOT against
# the board. "[ ]" on a maths board is a real drawn empty box -- g1_ch8/Maths_seg3
# writes "[BLOCK][BLOCK][BLOCK][ ][ ] = 3 blocks long", which is exactly the count
# this module is here to draw. Refusing that board as a "placeholder" would throw
# away real content to satisfy a gate that only ever reads the spec.
_UNFINISHED = re.compile(r"TODO|FIXME|TBD|XXX|lorem ipsum|INSERT|PLACEHOLDER", re.I)
_SPEC_ONLY = re.compile(r"\[\s*\]|<\w+>")
_HEX = re.compile(r"#[0-9A-Fa-f]{6}")
# Arabic-script block: the Urdu letters, not the terminal marks alone.
_URDU = re.compile(r"[ؠ-يٱ-ۓ]")


def _blob(board) -> str:
    """Every authored word on the board, panels and labels included, as one string."""
    parts = [board.get("title") or ""]
    for panel in board.get("panels") or []:
        parts.append(panel.get("label") or "")
        for row in panel.get("rows") or []:
            if isinstance(row, dict):
                parts.append(row.get("text") or "")
    return "\n".join(p for p in parts if p)


def _is_urdu(text: str) -> bool:
    """Rule 20: Urdu is measured in CODE POINTS, never bytes."""
    cps = [*text]
    urdu = [c for c in cps if _URDU.match(c)]
    return len(urdu) >= 3


def _num(x: float):
    return int(x) if float(x).is_integer() else float(x)


def _clean_label(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip(" \t-–—:•*")


def try_clock(blob, meta):
    if not _CLOCK_WORDS.search(blob):
        return None  # a bare "09:00" is a departure time, not a clock face
    times = {f"{int(h)}:{m}" for h, m in _TIME.findall(blob)}
    if len(times) != 1:
        return None  # 0 -- nothing to show; >1 -- one face cannot carry both
    return {"type": "clock", "time": times.pop()}


def try_geometry(blob, meta):
    counts = _COUNT_PAIR.findall(blob)
    if not counts:
        return None  # a shape named with no count is a picture, not this board
    found = [n for n in _SHAPE_POINTS if re.search(rf"\b{n}\b", blob, re.I)]
    if len(found) != 1:
        return None  # 0 or >1 named shape -- we cannot honestly draw "the" shape
    name = found[0]
    shape = ({"kind": "circle", "c": [0, 0], "r": 2} if name == "circle"
             else {"kind": "triangle" if name == "triangle" else "polygon",
                   "points": _SHAPE_POINTS[name]})
    seen, caption = set(), []
    for n, word in counts:
        key = (n, word.lower())
        if key not in seen:
            seen.add(key)
            caption.append(f"{n} {word.lower()}")
    return {"type": "geometry", "shapes": [shape], "caption": ", ".join(caption)}


def try_compare(blob, meta):
    if not _COMPARE_WORDS.search(blob):
        return None  # "a=4, b=8" with no comparison word is a key, not a comparison
    items, seen = [], set()
    for raw, value in _NAMED_VALUE.findall(blob):
        label = _clean_label(raw)
        if not label or len([*label]) > MAX_LABEL_CP or label.lower() in seen:
            continue
        if not _NAME_OK.match(label) or not _TWO_LETTERS.search(label):
            continue  # an arithmetic fragment is not the name of a thing
        if refuse.debris_label(label) or refuse.exponent_label(label):
            return None  # torn unit / not a magnitude -- see d0_board_art_scan_refuse
        size = float(value)
        if size <= 0:
            continue
        seen.add(label.lower())
        items.append({"label": label, "size": _num(size)})
    if not (MIN_COMPARE_ITEMS <= len(items) <= MAX_COMPARE_ITEMS):
        return None
    if len({i["size"] for i in items}) == 1:
        return None  # every thing the same size -- the engine throws, and rightly
    order = [i["label"] for i in sorted(items, key=lambda d: d["size"])]
    return {"type": "compare_size", "items": items,
            "caption": "smallest to largest: " + ", ".join(order)}


def _line_from_list(blob):
    m = _NUM_LIST.search(blob)
    if not m:
        return None
    vals = [float(v) for v in re.split(r"\s*,\s*", m.group(0))]
    steps = {round(b - a, 6) for a, b in zip(vals, vals[1:])}
    if len(steps) != 1:
        return None  # unevenly spaced -- we will not invent a step
    step = steps.pop()
    if step <= 0:
        return None
    return _num(vals[0]), _num(vals[-1]), _num(step)


def _line_from_range(blob):
    m = _RANGE.search(blob)
    if not m:
        return None
    lo, hi = float(m.group(1)), float(m.group(2))
    if lo >= hi:
        return None
    return _num(lo), _num(hi), None


def try_numberline(blob, meta):
    if not _LINE_WORDS.search(blob):
        return None
    got = _line_from_list(blob) or _line_from_range(blob)
    if not got:
        return None
    frm, to, step = got
    spec = {"type": "numberline", "from": frm, "to": to}
    if step is not None:
        spec["step"] = step
    return spec


def try_count_frame(blob, meta):
    counts = {int(n) for n, _ in _COUNTABLE.findall(blob)}
    if len(counts) != 1:
        return None  # 0 -- nothing to count; >1 -- one frame shows one number
    count = counts.pop()
    if not (1 <= count <= MAX_FRAME_COUNT):
        return None
    return {"type": "count_frame", "count": count}


# Most specific first: a clock board that also says "scale" is a clock.
_BUILDERS = (try_clock, try_geometry, try_compare, try_numberline, try_count_frame)


def _iter_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _iter_strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from _iter_strings(v)


def _finish(spec, blob, meta):
    if meta.get("title"):
        spec.setdefault("title", meta["title"])
    if _is_urdu(blob):
        spec["lang"] = "ur"
    if refuse.lang_unsupported(spec):
        spec.pop("lang")  # the board is Urdu, this figure's own words are not
    for s in _iter_strings(spec):
        if _UNFINISHED.search(s) or _SPEC_ONLY.search(s) or _HEX.search(s):
            return None
    return spec


def scan_spec(board) -> dict | None:
    """One drawing for the WHOLE board, or None. Never a re-print of its text."""
    if not isinstance(board, dict):
        return None
    panels = board.get("panels")
    if not isinstance(panels, list) or not panels:
        return None
    blob = _blob(board)
    if not blob.strip():
        return None
    if _UNFINISHED.search(blob) or _HEX.search(blob):
        return None  # an unfinished board does not get a confident figure
    meta = {"title": (board.get("title") or "").strip() or None}
    for builder in _BUILDERS:
        spec = builder(blob, meta)
        if spec is not None:
            return _finish(spec, blob, meta)
    return None
