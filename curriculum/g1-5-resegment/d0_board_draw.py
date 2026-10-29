"""WRITE ON THE BOARD, as a drawing -- or not at all.

OPERATOR, five times: *"pls make sure write on the board section is an actual image
ALWAYS rather than text instructions"*, *"write on the board is still language, its
not a diagram, its instruction, and Math can be confusing, i want dieagrams"*.

WHAT THIS MODULE USED TO DO, AND WHY IT STOPPED (bd-287sn). It had two suppliers and
a guarantee that ALWAYS was literally true: the real drawing first, then
`d0_board_chalk` -- the board's own text, laid out as a `panels` spec -- so that every
board got "a picture". A judge then measured the result across all 335 rebuilt
documents: mean 97.3% word-token overlap between that figure and the board text block
directly above it, 266 of 335 at or above 95%, 61.4 phone pages of new ink. It was not
a picture of the board. It was the board, re-set in SVG, printed a second time.

Setting the same instructions in a different font does not answer the operator, and
`page2.board_final.diagram` is an ADDITIVE slot -- the `board` block above it is
`additionalProperties: false` in the schema with no figure field, so it keeps printing
every authored word whatever happens here. A figure that only repeats that text
therefore costs a fifth of a page and buys nothing. So: a real drawing, or None.
Nothing authored is lost by returning None, because this module never held the only
copy of anything.

FOUR CHANCES AT A REAL DRAWING, in order:

  `d0_board_art.spec_for(board)`          one diagram type carrying the WHOLE board.
  `d0_board_art_shapes.whole_board_spec`  a handful of bespoke whole-board shape
                                          detectors (cube/sphere, named 2-D shapes,
                                          a floor-plan pair, an analogue clock face).
  `d0_board_art.panel_spec(board, p)`     the same builder chain on ONE panel.
  `d0_board_art_scan.scan_spec(board)`    the whole board read as TEXT, kind-ignored.

WHY THE NEW SECOND CHANCE SITS BEFORE THE PER-PANEL LOOP, NOT AFTER (bd-287sn
FIXWAVE, g4_ch9 Science_seg3/seg4). `spec_for` refuses outright whenever a
board has more than one panel, so it never fires for any of
`d0_board_art_shapes`'s multi-panel targets either way -- the only real
competitor is the per-panel loop. Measured directly (not inferred): for
Science_seg3 and Science_seg4, the per-panel loop currently reaches an
unrelated single-row `arrow` panel before it ever reaches the panel with the
actual cube/sphere ascii wireframe (whose own rows mix `boxart` and `text`
kinds, so it can never independently qualify there), and returns a
misleadingly-plausible `flow` diagram of that unrelated row instead of no
diagram at all. Running the new whole-board shape detectors first means a
board they claim is drawn correctly instead of wrongly, and a board they do
not claim falls through to the per-panel loop exactly as before.

THE THIRD CHANCE, AND WHY IT IS LAST (bd-f2khb). Measured over the 105 real Maths
boards: the first two chances together draw 24, and the MATHS engines among them
draw 2. The blocker is not the panel count -- the per-panel fallback below already
clears that -- it is ROW KIND. Both earlier chances require a panel's rows to be
homogeneous, and a real maths board is not: "thermometer = a number line" carries an
isolated "=" so it parses as `calc`, "lettuce=4, carrot=8" as `gloss`, and a clock
board mixes `gloss` and `calc` in among its `text`. Each of those is a board a
teacher would draw, refused on a technicality of parsing.

`scan_spec` therefore ignores row kind and reads every panel as one piece of text.
That is safe HERE and only here, because this slot is ADDITIVE -- the `board` block
still prints every authored word -- so a figure drawn from part of the board loses
nothing. It runs LAST so it can only ever add a figure where there was none; a board
the first two chances answer keeps their answer, unchanged.

The whole-board gate is right for the REPLACE path (`d0_diagram.py:105` overwrites the
block, so an uncovered panel would be lost) and it refused 181 of 335 boards on panel
count alone. It is wrong here: this slot replaces nothing, so drawing the one panel
that has a shape -- the matching pairs, the place-value grid -- loses no word, and the
board block still prints all the panels above it.

WHY THIS IS NOT A BLOCK IN THE INTRODUCTION. Substituting the `board` block was tried
and is wrong twice over: `bdHoisted` (template.js:2801) and `laidOutBoard` (:3314) both
key on `b.type === "board"`, so removing it takes the WRITE ON THE BOARD label and its
furniture position with it, AND un-suppresses `board_final.draw_order` -- the draw
script the operator ruled off the page.

WHAT IS AT STAKE IN GETTING IT WRONG. A spec the engine cannot render does not quietly
vanish: the renderer substitutes a visible dashed "DIAGRAM - <TYPE> / not rendered"
placeholder (template.js:1710), worse for the teacher than no figure. Every builder
therefore emits only shapes that have been rendered against the live engine, and a
builder that throws yields None rather than a placeholder.
"""
from __future__ import annotations

import d0_board_art
import d0_board_art_scan
import d0_board_art_shapes
import d0_board_read

# D0 bookkeeping the chooser uses to route a spec. The schema is
# additionalProperties:false, so the spec that reaches the engine is the spec.
_ROUTING_KEYS = ("replaces", "slot")


def _clean(spec: dict) -> dict:
    return {k: v for k, v in spec.items() if k not in _ROUTING_KEYS}


def _drawable(spec) -> bool:
    """`renderDiagram` dispatches on `type`; without one there is nothing to draw."""
    return isinstance(spec, dict) and bool((spec.get("type") or "").strip())


def _readable(board_work: dict) -> dict:
    """The parsed board. `instruction` is kept because `d0_board_art._meta` reads it
    for `_MATCH_SIGNAL_RE` -- stripping it here made the `match` branch of
    `_try_gloss` structurally unreachable in the shipping path. It is a SIGNAL only:
    no builder copies it into a spec, and `test_the_draw_script_is_never_inside_the
    _picture` holds that line."""
    return d0_board_read.read_board(board_work)


def board_diagram(board_work) -> dict | None:
    """A real drawing for this board, or None. Never a re-print of its text."""
    if not isinstance(board_work, dict) or not board_work:
        return None
    try:
        board = _readable(board_work)
    except Exception:
        return None
    panels = board.get("panels")
    if not panels:
        return None
    try:
        art = d0_board_art.spec_for(board)
    except Exception:
        art = None
    if _drawable(art):
        return _clean(art)
    try:
        shapes = d0_board_art_shapes.whole_board_spec(board)
    except Exception:
        shapes = None
    if _drawable(shapes):
        return _clean(shapes)
    for panel in panels:
        try:
            spec = d0_board_art.panel_spec(board, panel)
        except Exception:
            continue
        if _drawable(spec):
            return _clean(spec)
    try:
        scan = d0_board_art_scan.scan_spec(board)
    except Exception:
        scan = None
    if _drawable(scan):
        return _clean(scan)
    return None
