"""d0_board_strip -- remove drawn-ASCII / bare clock-face numerals from the
PRINTED board once a picture exists for it (bd-1fr0w fix #1).

`board_panels()` (d0_board.py) keeps any line neither `_unbox` nor
`_unbox_ascii` recognizes as a framed box, verbatim (d0_board.py:118,
`kept.append(l)`) -- box-drawing glyphs and scattered clock-face numerals
included. That is layout, not authored words, and it is what still prints
"+---+ / /| +---+ |" (or a clock's "12 / 11 1 / 10 2 ...") directly above the
picture that now draws the same thing.

This module runs AFTER `board_panels()`, on its already-built panel/row
objects, gated on the board's OWN diagram spec `type`
(`d0_board_draw.board_diagram`) so it only ever touches the boards a picture
actually replaces -- "solid", "clock" and "geometry" (bd-1fr0w coordinator
verify: the gate originally missed "geometry" -- g1_ch10/Maths_seg1's
circle/triangle and g4_ch10/Maths_seg10's rectangle plots are both
"geometry"-typed boards whose picture replaces hand-drawn ASCII art the same
way "solid"/"clock" do). Every other board type (architect-as-a-type, ...)
is returned unchanged; so is the clock's own spec (numerals="all" is
untouched -- only the printed TEXT changes).

Geometry boards draw circles/round shapes with PARENTHESES ("( )",
"(____)"), which a box-drawing token never uses -- see `_clean_token`'s
geometry-only paren handling below. It is gated on `mode == "geometry"`
specifically (not folded into the general `_EDGE` cutset) because a bare
"(" / ")" is common, legitimate authored punctuation elsewhere in this corpus
(a parenthetical aside like "(add the two areas)", a unit label like
"(squared)") -- see test_seg4_mixed_panel_drops_only_the_pure_frame_rows's
"( curved )" case, which must stay untouched on a "solid" board.

SCHEMA: board_panel.rows is REQUIRED and `minItems: 1`
($LPV/schema/lp_doc.schema.json:521-533 -- "a panel with none is a numbered
chip with nothing under it"). A panel whose rows all reduce to pure box-art
(e.g. Science_seg3's cube panel) cannot be emitted with `rows: []`, and
dropping the panel outright would also drop its `label` -- often the only
authored words in it (e.g. "Draw a small cube at the side"). Rather than
either of those, the label is folded into a single surviving row and the
label is cleared, so the schema stays satisfied and the authored words stay
on the page, just relocated from heading to row.
"""

from __future__ import annotations

import re

import d0_board_draw
from d0_board_read import _is_calc

# Trimmed off the edges of a real word (e.g. "FACE|" -> "FACE"); also the set
# a whitespace-split token must reduce to nothing under to be pure box-art.
_EDGE = "+-/\\^_|"

# Tokens that are ambiguous between a drawing-glyph fragment (a stray box
# corner, a leader-line pipe) and ordinary authored punctuation (a pipe table
# divider, a "+" meaning "and"). Kept as-is; a row drops only when EVERY
# surviving token is one of these, i.e. nothing but ambiguous connectors
# remains anywhere in the line.
_PROTECTED = ("|", "+")

# A bare clock-face position numeral (1-12, never zero-padded, so a digital
# reading like "09:00"/"00" is protected by construction -- it never matches
# [1-9]/1[0-2] as a whole token). Consumes a directly-preceding arrow with it,
# so "long thin minute hand -> 12" loses the numeral without a dangling arrow.
#
# Two more guards (bd-1fr0w blast-radius regression, g1_ch9 Maths_seg11 --
# a "clock"-typed board that isn't one of the 3 named boards but shares the
# same diagram type, caught by re-running the corpus-wide scan):
#   - not glued to a letter/digit on either side, so an ordinal ("4th") keeps
#     its digit -- board_diagram()="clock" does not mean EVERY number on the
#     board is a clock-face position; this one board also carries an
#     unrelated calendar-facts panel.
#   - not immediately followed by "o'clock", so a NAMED time ("5 o'clock" in
#     a worked example) is left whole -- that digit is the answer, not a
#     redundant position label the picture already draws.
_CLOCK_NUM = re.compile(
    r"(?:→|->|➔)?\s*"
    r"(?<![A-Za-z0-9])(?:1[0-2]|[1-9])(?![A-Za-z0-9])(?!:)"
    r"(?!\s*o['’]clock)"
)

_STRIP_TYPES = ("solid", "clock", "geometry")


def _is_geometry_art_token(tok: str) -> bool:
    """True for a token that is PURE round-shape art on a geometry board --
    a bare "(" / ")", or a paren wrapping nothing but ordinary `_EDGE`
    glyphs ("(____)", "(--)"). False for a token where a paren wraps real
    content ("(squared)", "(add") -- those keep their parens untouched, same
    as everywhere else in this corpus (see this module's docstring)."""
    if "(" not in tok and ")" not in tok:
        return False
    core = tok.strip("()")
    return core == "" or all(c in _EDGE for c in core)


def _clean_token(tok: str, mode: str = ""):
    """One whitespace-split token -> the token to keep, or None to drop it."""
    # bd-1fr0w coordinator verify round 2: on a geometry board specifically, a
    # lone "|" is never a real table divider or formula character (checked
    # corpus-wide over both geometry boards -- every lone-"|" row is a
    # leftover box-edge/leader-line, and a genuine drawn table is already
    # protected upstream, since `_clean_row` never calls this on a `cells`
    # row at all). solid/clock keep the old blanket protection unchanged.
    if mode == "geometry" and tok == "|":
        return None
    if tok in _PROTECTED:
        return tok
    if mode == "geometry" and _is_geometry_art_token(tok):
        return None
    stripped = tok.strip(_EDGE)
    return stripped or None


def _strip_arrow_runs(tokens, mode: str):
    """A run of 3+ consecutive bare "<"/">" tokens is drawn lane/arrow art,
    not text (bd-1fr0w coordinator verify round 2: g4_ch10 Maths_seg10's
    "road: -> -> -> -> ->" has each arrow's leading "-" edge-stripped by
    `_clean_token` above, which leaves a bare "> > > > >" that reads on the
    raster as drawn lane art). An isolated "<"/">" (a real arrow, or a
    "less/greater than") is untouched -- only a run of 3 or more together is
    art. Geometry-only, same gating as every other check in this module."""
    if mode != "geometry":
        return tokens
    out = []
    i, n = 0, len(tokens)
    while i < n:
        if tokens[i] in ("<", ">"):
            j = i
            while j < n and tokens[j] in ("<", ">"):
                j += 1
            if j - i < 3:
                out.extend(tokens[i:j])
            i = j
            continue
        out.append(tokens[i])
        i += 1
    return out


def _strip_drawn(line: str, mode: str = ""):
    """Token-level ASCII-art stripper for one line. Returns the cleaned line,
    or None to drop the row entirely -- either nothing survived, or the only
    survivors are ambiguous connectors with no real content anywhere in the
    line to divide."""
    kept = [t for t in (_clean_token(tok, mode) for tok in line.split()) if t is not None]
    kept = _strip_arrow_runs(kept, mode)
    if not kept or all(t in _PROTECTED for t in kept):
        return None
    return " ".join(kept)


def _clean_field(text: str, mode: str):
    """One board-text field (a row's `text`, or a term/gloss half) -> the
    cleaned string, or None to drop it entirely.

    `_is_calc` fully exempts a worked-calculation line from BOTH passes below:
    its own "+"/"-" are arithmetic, not drawing glyphs, and its own digits are
    the answer, not a clock position."""
    if not text or _is_calc(text):
        return text or None
    changed = _CLOCK_NUM.sub("", text) if mode == "clock" else text
    has_paren_art = mode == "geometry" and ("(" in changed or ")" in changed)
    if changed == text and not has_paren_art and not any(c in _EDGE for c in text):
        return text
    return _strip_drawn(changed, mode)


def _clean_row(row: dict, mode: str):
    """One row dict -> the cleaned row dict, or None to drop it. Rows with
    `cells` (a drawn table) or anything else unrecognized are left untouched
    -- deliberately out of scope, conservative."""
    if "text" in row:
        cleaned = _clean_field(row["text"], mode)
        return {"text": cleaned} if cleaned else None
    if "term" in row:
        term = _clean_field(row["term"], mode)
        if not term:
            return None
        gloss = _clean_field(row.get("gloss") or "", mode)
        return {"term": term, "gloss": gloss} if gloss else {"text": term}
    return row


def _clean_panel(panel: dict, mode: str):
    rows = [r for r in (_clean_row(row, mode) for row in panel.get("rows", ())) if r]
    out = dict(panel)
    if rows:
        out["rows"] = rows
        return out
    label = (panel.get("label") or "").strip()
    if not label:
        return None
    out["rows"] = [{"text": label}]
    out.pop("label", None)
    return out


def apply_panels(panels, board):
    """`board_panels()`'s panel list -> the same list with drawn-ASCII / bare
    clock-numerals stripped, once a picture exists for this board. A no-op
    for every board type except "solid", "clock" and "geometry" -- see the
    module docstring."""
    try:
        spec = d0_board_draw.board_diagram(board)
    except Exception:
        spec = None
    mode = spec.get("type") if isinstance(spec, dict) else None
    if mode not in _STRIP_TYPES:
        return panels
    cleaned = [_clean_panel(p, mode) for p in panels]
    return [p for p in cleaned if p is not None]
