"""d0_board_art_shapes.py -- whole_board_spec(board), a FOURTH chance at a real
drawing, spliced into d0_board_draw.board_diagram right after
`d0_board_art.spec_for(board)` and before its per-panel loop.

WHY IT HAS TO SIT THERE (measured, not assumed -- see this module's test file
docstring and $SCRATCH/dump_current.py's real output against the live corpus
boards): `d0_board_art.spec_for` refuses outright whenever a board has more
than one panel (`len(panels) != 1: return None`), and every board this module
targets is multi-panel. So chance 1 never fires for them either way -- the
insertion point only has to beat chance 2, the per-panel loop, which for two
of these boards (g4_ch9 Science_seg3/seg4) currently wins on the WRONG panel:
a single homogeneous `arrow` row elsewhere on the board, reached before the
actual cube/sphere wireframe panel, which never independently qualifies
because its own rows mix `boxart` and `text` kinds.

FOUR SUB-DETECTORS, each gated narrowly enough to refuse rather than guess:

  _solid_spec           a cube ascii wireframe (a "+---+"-cornered panel with
                         a "/" stroke) on a board that also uses all three of
                         vertex/edge/face somewhere -- a cube-only board or a
                         cube+sphere board (sphere only added when "sphere"
                         appears in the SAME wireframe panel). Per-shape facts
                         are folded into `caption`, never onto the shape.
  _clock_spec           a board that names BOTH "analogue clock" and "digital
                         clock" and gives exactly one H:MM time -- draws a
                         full 1-12 numeral face (`numerals:"all"`), never the
                         digital readout itself (clock.js's `digital` stays
                         off; see its own docstring on the upstream leak rule).
  _shape_safari_spec     >=2 panels whose LABEL each names >=2 of
                         rectangle/square/circle/triangle -- draws every named
                         shape left to right, folding each shape's own
                         side/corner count row into `caption`.
  _architect_spec        board titled "...ARCHITECT'S..." with a "RECTANGULAR
                         BUILDING PLOT" panel, a "SQUARE PARK PLOT" panel, and
                         a third panel naming both "rectangle a" and
                         "rectangle b" -- draws the plot rectangle, the park
                         square, and the two adjoining building rectangles,
                         folding each panel's non-decorative row text into
                         `caption`.

Every gate is board-wide (checks words/patterns across ALL panels) before any
detector commits to a shape, precisely so two detectors never collide on the
same board -- confirmed against the real corpus, not merely reasoned about:
g4_ch10's floor-plan boxes reuse the same "+---+" glyph as a cube wireframe
but the board never says vertex/edge/face, so `_solid_spec`'s board-wide gate
correctly refuses it; g1_ch10 says "vertices"/"edge" but never "face", same
refusal.

Colour policy, placeholder policy: unchanged from d0_board_art.py -- no spec
here ever sets a color/fill field, and every detector already only ever
transcribes literal board text into `caption`, so d0_board_art._finish's
placeholder/hex scan is not re-run here; a board bad enough to trip it would
have to invent text this module never emits.
"""

from __future__ import annotations

import re

_VERTEX_RE = re.compile(r"\bvertex\b|\bvertices\b", re.I)
_EDGE_RE = re.compile(r"\bedges?\b", re.I)
_FACE_RE = re.compile(r"\bfaces?\b", re.I)
_VEF_ALL_RE = re.compile(
    r"(?=.*\bvertex\b|.*\bvertices\b)(?=.*\bedges?\b)(?=.*\bfaces?\b)", re.I
)
_SOLID_FACT_RE = re.compile(r"^(cube|sphere)\s*:\s*.+", re.I)
# A per-solid fact line for a shape this engine does NOT draw (prism/cone/
# cylinder/...) -- skipped outright, even though it may also happen to use
# all three of vertex/edge/face in one line (a fact row always does).
_OTHER_SOLID_FACT_RE = re.compile(r"^(?!(?:cube|sphere)\b)[A-Za-z]+\s*:\s*.+", re.I)
_CUBE_CORNER_RE = re.compile(r"[+][-]{2,}[+]")
_SPHERE_WORD_RE = re.compile(r"\bsphere\b", re.I)

_SHAPE_NAME_RE = re.compile(r"\b(rectangle|square|circle|triangle)\b", re.I)
_COUNT_PAIR_RE = re.compile(
    r"\b\d+\s*(?:sides?|corners?|edges?|faces?|vertices|vertex)\b", re.I
)

_ANALOGUE_RE = re.compile(r"analogue clock", re.I)
_DIGITAL_RE = re.compile(r"digital clock", re.I)
_TIME_RE = re.compile(r"\b([01]?\d):([0-5]\d)\b")

# Decorative box-drawing/whitespace run at either edge of a row's text --
# stripped before a row's own words are folded into a caption, so a caption
# reads as prose rather than carrying stray "|"/"+" ascii-art fencing.
_EDGE_DECOR_RE = re.compile(r"^[|+\-_\s]+|[|+\-_\s]+$")

_GAP = 1.2

_POLY_TEMPLATES = {
    "triangle": [[0, 0], [4, 0], [2, 3.2]],
    "square": [[0, 0], [3, 0], [3, 3], [0, 3]],
    "rectangle": [[0, 0], [4, 0], [4, 2.4], [0, 2.4]],
}


def _panel_blob(panel: dict) -> str:
    parts = [panel.get("label") or ""]
    for row in panel.get("rows") or []:
        if isinstance(row, dict):
            parts.append(row.get("text") or "")
    return "\n".join(p for p in parts if p)


def _board_blob(board: dict) -> str:
    parts = [board.get("title") or ""]
    for panel in board.get("panels") or []:
        if isinstance(panel, dict):
            parts.append(_panel_blob(panel))
    return "\n".join(p for p in parts if p)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", _EDGE_DECOR_RE.sub("", text or "")).strip()


# ─── solid (cube / cube+sphere) ──────────────────────────────────────────────


def _solid_spec(board: dict):
    panels = board.get("panels") or []
    blob = _board_blob(board)
    if not (_VERTEX_RE.search(blob) and _EDGE_RE.search(blob) and _FACE_RE.search(blob)):
        return None
    wireframe = None
    for panel in panels:
        pblob = _panel_blob(panel)
        if _CUBE_CORNER_RE.search(pblob) and "/" in pblob:
            wireframe = panel
            break
    if wireframe is None:
        return None
    shapes = [{"kind": "cube", "showLabels": ["vertex", "edge", "face"]}]
    if _SPHERE_WORD_RE.search(_panel_blob(wireframe)):
        shapes.append({"kind": "sphere"})
    caption = []
    for panel in panels:
        for row in panel.get("rows") or []:
            if not isinstance(row, dict):
                continue
            text = _norm(row.get("text") or "")
            if not text:
                continue
            if _SOLID_FACT_RE.match(text):
                if text not in caption:
                    caption.append(text)
                continue
            if _OTHER_SOLID_FACT_RE.match(text):
                continue  # a fact line for a shape this engine doesn't draw
            if _VEF_ALL_RE.search(text) and text not in caption:
                caption.append(text)
    return {"type": "solid", "shapes": shapes, "caption": "; ".join(caption)}


# ─── clock (analogue face, full numerals) ───────────────────────────────────


def _clock_spec(board: dict):
    blob = _board_blob(board)
    if not (_ANALOGUE_RE.search(blob) and _DIGITAL_RE.search(blob)):
        return None
    times = {f"{int(h)}:{m}" for h, m in _TIME_RE.findall(blob)}
    if len(times) != 1:
        return None
    return {"type": "clock", "time": times.pop(), "numerals": "all"}


# ─── shape safari (>=2 named shapes each in >=2 panel labels) ───────────────


def _panel_shape_names(panel: dict):
    label = panel.get("label") or ""
    return [m.group(1).lower() for m in _SHAPE_NAME_RE.finditer(label)]


def _panel_count_fragments(panel: dict):
    frags = []
    for row in panel.get("rows") or []:
        if not isinstance(row, dict):
            continue
        text = row.get("text") or ""
        if not _COUNT_PAIR_RE.search(text):
            continue
        for piece in re.split(r"\s{2,}", text):
            piece = piece.strip()
            if piece and _COUNT_PAIR_RE.search(piece):
                frags.append(piece)
    return frags


def _shape_at(name: str, cursor: float):
    # bd-1fr0w fix #3: every drawn shape carries its own capitalised `name`,
    # rendered by geometry.js UNDER the shape itself (not only in the
    # caption); a circle additionally turns its centre dot off
    # (`showCenter: False`) -- not needed for a Grade-1 "what is a circle?"
    # board. Rectangle/square/triangle keep the renderer's default
    # (showCenter doesn't apply to them; omitted, not set to any value).
    if name == "circle":
        r = 1.6
        return (
            {"kind": "circle", "c": [cursor + r, r], "r": r, "name": "Circle", "showCenter": False},
            cursor + 2 * r,
        )
    pts = _POLY_TEMPLATES[name]
    w = max(p[0] for p in pts)
    shifted = [[p[0] + cursor, p[1]] for p in pts]
    kind = "triangle" if name == "triangle" else "polygon"
    return {"kind": kind, "points": shifted, "name": name.capitalize()}, cursor + w


def _shape_safari_spec(board: dict):
    panels = board.get("panels") or []
    qualifying = [(p, _panel_shape_names(p)) for p in panels if isinstance(p, dict)]
    qualifying = [(p, names) for p, names in qualifying if len(names) >= 2]
    if len(qualifying) < 2:
        return None
    shapes, captions, cursor = [], [], 0.0
    for panel, names in qualifying:
        fragments = _panel_count_fragments(panel)
        for i, name in enumerate(names):
            shape, cursor = _shape_at(name, cursor)
            shapes.append(shape)
            cursor += _GAP
            frag = fragments[i] if i < len(fragments) else None
            cap = f"{name}: {frag}" if frag else name
            if cap not in captions:
                captions.append(cap)
    return {"type": "geometry", "shapes": shapes, "caption": "; ".join(captions)}


# ─── architect's model (rect plot + square plot + rectilinear A/B) ──────────
#
# Split into its own file, d0_board_art_arch.py, purely to keep this file
# under the 300-line limit -- imported below, after _norm/_panel_blob/_GAP
# are defined, since that module imports them back from here.


from d0_board_art_arch import _architect_spec  # noqa: E402

_DETECTORS = (_solid_spec, _clock_spec, _shape_safari_spec, _architect_spec)


def whole_board_spec(board) -> dict | None:
    """The FOURTH chance -- a real drawing built from the WHOLE board, tried
    before the per-panel loop so a multi-panel drawing (a cube, a row of named
    shapes, a floor-plan pair) is never lost to whichever homogeneous
    single-row panel the per-panel loop would otherwise reach first."""
    if not isinstance(board, dict):
        return None
    if not board.get("panels"):
        return None
    for detector in _DETECTORS:
        spec = detector(board)
        if spec is not None:
            return spec
    return None
