"""d0_board_art.py -- spec_for(board) chooses a renderDiagram spec, or refuses.

spec_for is the CHOOSER for "WRITE ON THE BOARD": it takes a parsed Board
dict and either returns a renderDiagram spec (a real drawing) or None. There
is no third option -- a laid-out-text spec is not a diagram and is never
emitted here.

WHOLE-BOARD-COVERAGE RULE (bd-e1e65 coordinator correction): the spec this
module returns REPLACES the entire board block outright (d0_diagram.py:105
overwrites section["blocks"][i], it does not merge). So spec_for requires
exactly one panel, and every builder below requires the WHOLE row list in
that panel to be homogeneous and fully covered by its chosen diagram type --
never a match on part of a panel while other rows are silently dropped.
Losing content silently is worse than refusing outright, so mixed-kind
panels, ragged tables, missing meanings and the rest all refuse rather than
degrade.

We never import d0_board_read (the sibling's reader module) -- even now that
it exists, we only code against its documented output shape, never its code,
so the two modules stay independently testable:
    Row   = {"kind": str, "text": str, "term": str|None, "gloss": str|None,
              "cells": list[str]|None}
    Panel = {"label": str|None, "rows": list[Row]}
    Board = {"title": str|None, "panels": list[Panel], "instruction": str}

Colour policy: no spec built here ever sets a color/fill/shadeColor field --
we let the engine's own defaults apply, which alone avoids the hex-colour
placeholder trap (lint_lp.js gate 10). _finish() below adds a second,
defensive scan for both that trap and the other gate-10 placeholder patterns,
in case any literal board text (e.g. a stray "[ ]" checkbox mark) would trip
it -- we refuse rather than "clean" real board content.

Grid legibility policy: a `grid` spec refuses any cell text longer than
_GRID_CHAR_CAP[cols] (engine-calibrated per column count) and never sets
spec["cellSize"] -- see the constant's own comment above _try_grid_table for
why letting grid.js self-size beats a manually computed cellSize.
"""

from __future__ import annotations

import re

from d0_board_pairs import try_pairs
from d0_board_art_maths import (
    try_calc,
    try_clock,
    try_geometry,
    try_money,
    try_numberline,
)

# grid.js legibility cap, per column count -- engine-verified (bd-yjmxh worktree,
# real renderDiagram + requiredBox; PRIMARY_DIAGRAM_MIN_PX=15.5, PHONE_FULL_COL=455).
# Rendered label size tracks vbW (cols * per-cell width), not row count, so more
# columns leaves a smaller per-cell character budget. We do NOT set
# spec["cellSize"]: grid.js's font is capped at a fixed constant regardless of
# cellSize, so a manual cellSize (tried: 430) only grows the viewBox and made a
# real-corpus board render at 6.75px, worse than self-sizing. Caps are
# conservative, measured with margin above the floor (cols=2 legible to 24
# chars, capped at 20; cols=6 legible to ~7, capped at 6).
_GRID_CHAR_CAP = {2: 20, 3: 14, 4: 10, 5: 7, 6: 6}

_MATCH_SIGNAL_RE = re.compile(r"\bmatch\b|\bconnect\b|\bdraw a line\b|\bjoin\b|\bpair\b", re.I)
_BLANK_TOKENS = {"?", "_", "blank"}
_TERM_RE = re.compile(r"^[A-Za-z]+$")

_PLACEHOLDER_RE = re.compile(
    r"TODO|FIXME|TBD|XXX|lorem ipsum|INSERT|PLACEHOLDER|\[\s*\]|<\w+>", re.I
)
_HEX_RE = re.compile(r"#[0-9A-Fa-f]{6}")


def _try_grid_table(rows, meta):
    if not rows or any(r.get("kind") != "table" for r in rows):
        return None
    if not (2 <= len(rows) <= 8):
        return None
    widths = {len(r.get("cells") or []) for r in rows}
    if len(widths) != 1:
        return None  # ragged -- a row the grid couldn't honestly carry
    cols = widths.pop()
    if not (2 <= cols <= 6):
        return None
    cap = _GRID_CHAR_CAP[cols]
    cell_text = []
    for ri, r in enumerate(rows):
        for ci, text in enumerate(r.get("cells") or []):
            if not text or not text.strip():
                return None  # a blank cell is content the grid can't show
            if len(text) > cap:
                return None  # this cell would render below the legibility floor
            cell_text.append([ri, ci, text])
    return {
        "type": "grid",
        "rows": len(rows),
        "cols": cols,
        "cellText": cell_text,
        "alt": f"A {len(rows)}-by-{cols} table drawn as a grid.",
    }


def _try_gloss(rows, meta):
    if not rows or any(r.get("kind") != "gloss" for r in rows):
        return None
    pairs = []
    for r in rows:
        term = (r.get("term") or "").strip()
        meaning = (r.get("gloss") or r.get("text") or "").strip()
        if not term or not meaning:
            return None  # a term with no meaning is a board the pair-up can't carry
        pairs.append((term, meaning))
    n = len(pairs)
    signaled = bool(_MATCH_SIGNAL_RE.search(meta.get("instruction") or ""))
    if signaled and 2 <= n <= 4:
        return {
            "type": "match",
            "left": [t for t, _ in pairs],
            "right": [m for _, m in pairs],
            "alt": f"Draw a line matching each of {n} terms to its meaning.",
        }
    if 2 <= n <= 8:
        cap = _GRID_CHAR_CAP[2]
        if any(len(t) > cap or len(m) > cap for t, m in pairs):
            return None  # a term/meaning this long renders below the legibility floor
        cell_text = []
        for i, (t, m) in enumerate(pairs):
            cell_text.append([i, 0, t])
            cell_text.append([i, 1, m])
        return {
            "type": "grid",
            "rows": n,
            "cols": 2,
            "cellText": cell_text,
            "alt": f"A two-column list of {n} terms and meanings.",
        }
    return None


def _try_flow(rows, meta):
    if not rows or any(r.get("kind") != "arrow" for r in rows):
        return None
    # d0_board_read.py parses a one-line chain ("A -> B -> C") into a SINGLE
    # row with the hops in `cells`, not one row per hop -- that is the
    # dominant real-world shape, so a lone arrow row is read from `cells`
    # rather than refused outright the way a lone plain-text row would be.
    if len(rows) == 1:
        hops = rows[0].get("cells") or []
        if len(hops) < 2:
            return None
        step_texts = list(hops)
    else:
        # A multi-row board is only ONE flow when each row is a plain,
        # single-concept step label. When a row ITSELF carries >1 parsed hop
        # (d0_board_read gives an arrow row its own `cells` whenever that
        # row's own line has a "->"), the rows are independent mini-chains
        # ("sunny -> ___", "ground -> ___", ...), not steps of one process --
        # chaining them into a single flow draws a false sequential
        # relationship between unrelated items, so we refuse rather than
        # fabricate that relationship.
        if any(len(r.get("cells") or []) > 1 for r in rows):
            return None
        step_texts = [r.get("text") or "" for r in rows]
    if not (2 <= len(step_texts) <= 6):
        return None
    steps = []
    for text in step_texts:
        text = text.strip()
        if not text or len(text) > 40:
            return None
        steps.append({"lines": [text]})
    return {
        "type": "flow",
        "steps": steps,
        "alt": f"A {len(steps)}-step flow diagram.",
    }


def _try_pattern(rows, meta):
    if not rows or any(r.get("kind") != "slot" for r in rows):
        return None
    if not (3 <= len(rows) <= 9):
        return None
    items = []
    blanks = 0
    for r in rows:
        text = (r.get("text") or "").strip()
        if not text:
            return None
        if text.lower() in _BLANK_TOKENS:
            items.append("?")
            blanks += 1
        else:
            if len(text) > 12:
                return None
            items.append(text)
    if blanks != 1:
        return None  # 0 -- nothing to solve; >1 -- ambiguous which blank
    return {
        "type": "pattern",
        "items": items,
        "alt": "A repeating pattern with one blank to fill in.",
    }


def _try_word_blank(rows, meta):
    if len(rows) != 1:
        return None
    row = rows[0]
    if row.get("kind") != "slot":
        return None
    term = row.get("term") or ""
    if not _TERM_RE.match(term):
        return None
    tokens = (row.get("text") or "").split()
    if len(tokens) != len(term):
        return None
    blanks = []
    for i, (tok, letter) in enumerate(zip(tokens, term)):
        if tok == "_":
            blanks.append(i)
        elif tok != letter:
            return None  # board letter disagrees with the term -- refuse, don't guess
    if not (1 <= len(blanks) < len(term)):
        return None
    return {
        "type": "word_blank",
        "word": term,
        "blanks": blanks,
        "alt": f"The word '{term}' with {len(blanks)} letter(s) blanked out to fill in.",
    }


_BUILDERS = (
    _try_grid_table,
    _try_gloss,
    _try_flow,
    try_pairs,
    try_clock,
    try_numberline,
    try_geometry,
    try_money,
    try_calc,
    _try_pattern,
    _try_word_blank,
)


def _meta(board, panel):
    return {
        "title": board.get("title") or panel.get("label"),
        "instruction": board.get("instruction") or "",
    }


def _iter_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _iter_strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from _iter_strings(v)


def _finish(spec, meta):
    if meta.get("title"):
        spec.setdefault("title", meta["title"])
    for s in _iter_strings(spec):
        if _PLACEHOLDER_RE.search(s) or _HEX_RE.search(s):
            return None  # real board content collided with a lint-fatal pattern -- refuse
    return spec


def panel_spec(board: dict, panel: dict) -> dict | None:
    """The builder chain applied to ONE panel. For the additive
    `page2.board_final.diagram` slot (bd-287sn), where the figure replaces
    nothing -- the `board` block still prints every panel above it -- so drawing
    one panel of several loses no authored word. `spec_for` keeps the stricter
    whole-board rule for the replace path."""
    if not isinstance(board, dict) or not isinstance(panel, dict):
        return None
    rows = panel.get("rows")
    if not isinstance(rows, list) or not rows or not all(isinstance(r, dict) for r in rows):
        return None
    meta = _meta(board, panel)
    for builder in _BUILDERS:
        spec = builder(rows, meta)
        if spec is not None:
            return _finish(spec, meta)
    return None


def spec_for(board: dict) -> dict | None:
    if not isinstance(board, dict):
        return None
    panels = board.get("panels")
    if not isinstance(panels, list) or len(panels) != 1:
        return None  # a second panel is content the replaced block would lose
    return panel_spec(board, panels[0])
