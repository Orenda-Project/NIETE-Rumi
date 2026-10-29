"""d0_board_art_arch.py -- `_architect_spec`, one of `d0_board_art_shapes.py`'s
four whole-board detectors, split into its own file purely to keep
`d0_board_art_shapes.py` under the 300-line limit (no behavioural or
ownership boundary between the two -- see that file's own module docstring
for the shared "whole_board_spec" architecture this detector plugs into).

Board titled "...ARCHITECT'S..." with a "RECTANGULAR BUILDING PLOT" panel, a
"SQUARE PARK PLOT" panel, and a third panel naming both "rectangle a" and
"rectangle b" -- draws the plot rectangle, the park square, and the two
adjoining building rectangles.

CAPTION (bd-1fr0w fix #2): "one short clause per shape, name plus P/A
formula" -- not every non-decorative row on the panel. The full facts
(dimension placeholders like "width = W", the bilingual PERIMETER/AREA arrow
labels, the step-by-step procedure) stay on the page-1 printed board
untouched; this detector only ever feeds the picture's OWN caption, and the
coordinator's own words license trimming it: "the full facts are already on
the board text."
"""

from __future__ import annotations

import re

from d0_board_art_shapes import _GAP, _norm, _panel_blob

_ARCHITECT_RE = re.compile(r"architect", re.I)
_RECT_PLOT_LABEL = "RECTANGULAR BUILDING PLOT"
_SQUARE_PLOT_LABEL = "SQUARE PARK PLOT"

_PA_FORMULA_RE = re.compile(r"^[PA]\s*=")
_STEP34_RE = re.compile(r"^Step\s*[34]\s*:\s*(.+)$", re.I)
_TERMINAL_PUNCT = (".", "!", "?")


def _join_clauses(parts):
    """Fold caption clauses together, board order, every word kept (bd-1fr0w
    fix #3). "; " is this file family's own separator for a fact-clause run
    (see `_solid_spec`/`_shape_safari_spec` in d0_board_art_shapes.py) --
    never a literal "|", which is only ever the board's OWN box-edge glyph
    and survives as a dangling box-edge artifact if used as a delimiter. A
    clause that already ends in terminal punctuation (a board fact quoted
    verbatim, like Step 3's own ".") does not also get "; " appended after
    it -- that produced a bare ".;" -- a plain space stands in instead so
    the two facts still read as two sentences."""
    out = ""
    for part in parts:
        if not part:
            continue
        if not out:
            out = part
        elif out.endswith(_TERMINAL_PUNCT):
            out += " " + part
        else:
            out += "; " + part
    return out


def _formula_lines(panel: dict):
    """A panel's own "P = ..." / "A = ..." rows, board order, verbatim."""
    out = []
    for row in panel.get("rows") or []:
        if not isinstance(row, dict):
            continue
        text = _norm(row.get("text") or "")
        if _PA_FORMULA_RE.match(text) and text not in out:
            out.append(text)
    return out


def _named_shape_line(name: str, panel: dict):
    """"<Name>: P = ...; A = ..." -- or just the bare name if a panel somehow
    has no formula row (defensive; never hit by the corpus today)."""
    formulas = _formula_lines(panel)
    if not formulas:
        return name
    return f"{name}: " + _join_clauses(formulas)


def _rectilinear_line(panel: dict):
    """The rectilinear panel never states P=/A= algebraically -- Steps 3/4
    ARE its area/perimeter facts in prose, so they stand in for the formula
    here (verbatim past the "Step N:" numbering, nothing paraphrased)."""
    facts = []
    for row in panel.get("rows") or []:
        if not isinstance(row, dict):
            continue
        m = _STEP34_RE.match(_norm(row.get("text") or ""))
        if m:
            facts.append(m.group(1))
    if not facts:
        return "Rectilinear outline"
    return "Rectilinear outline: " + _join_clauses(facts)


def _offset(points, dx):
    return [[p[0] + dx, p[1]] for p in points]


def _architect_spec(board: dict):
    title = (board.get("title") or "")
    if not _ARCHITECT_RE.search(title):
        return None
    panels = [p for p in (board.get("panels") or []) if isinstance(p, dict)]
    by_label = {(p.get("label") or "").strip(): p for p in panels}
    rect_panel = by_label.get(_RECT_PLOT_LABEL)
    square_panel = by_label.get(_SQUARE_PLOT_LABEL)
    rectilinear_panel = None
    for p in panels:
        blob = _panel_blob(p).lower()
        if "rectangle a" in blob and "rectangle b" in blob:
            rectilinear_panel = p
            break
    if not (rect_panel and square_panel and rectilinear_panel):
        return None

    shapes = []
    cursor = 0.0
    for w, h in ((4, 2.4), (3, 3)):
        pts = [[0, 0], [w, 0], [w, h], [0, h]]
        shapes.append({"kind": "polygon", "points": _offset(pts, cursor)})
        cursor += w + _GAP
    # rectilinear outline: two adjoining rectangles, A on the left and B on
    # the right sharing A's right edge -- the board's own dashed split line.
    a = [[0, 0], [3, 0], [3, 4], [0, 4]]
    b = [[3, 0], [5, 0], [5, 2], [3, 2]]
    shapes.append({"kind": "polygon", "points": _offset(a, cursor)})
    shapes.append({"kind": "polygon", "points": _offset(b, cursor)})

    caption = _join_clauses([
        _named_shape_line("Rectangle", rect_panel),
        _named_shape_line("Square", square_panel),
        _rectilinear_line(rectilinear_panel),
    ])
    return {"type": "geometry", "shapes": shapes, "caption": caption}
