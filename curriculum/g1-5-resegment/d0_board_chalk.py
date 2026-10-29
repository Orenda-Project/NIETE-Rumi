"""Stage D0 -- "write on the board" is ALWAYS a picture, never text instructions.

Operator, 4th escalation on this exact complaint: *"pls make sure write on the
board section is an actual image ALWAYS rather than text instructions"*.

This module owns the ~35-45% of boards a sibling's diagram chooser cannot draw
honestly (vocabulary lists, sentence frames, free prose -- no shape to draw).
Instead of a shape, it draws the finished blackboard: a bordered `panels`
panel (bot/vendor/lp-v9/diagrams/types/panels.js, no new renderer added) with
every line the teacher is meant to copy laid out as real wrapped text. Row ->
text and the spec dict itself live in the sibling d0_board_chalk_shapes.py
(split out so this file could stay under the 300-line limit); this file owns
the public entry point plus the height-budget / splitting math.

CONTRACT (`d0_diagram.apply_slots` REPLACES the block the spec names, so this
is the only copy of the board the teacher gets):

    chalk_specs(board: dict) -> list[dict]

  - Always non-empty. Never raises. Never returns None or a None element.
  - EVERY WORD IN `board` SURVIVES into some spec in the list -- dropping a
    row to shorten a board is silent data loss, refused as a design option.
    A board too long for one spec becomes MORE specs, never a truncated one.
  - Each spec independently fits the real render floor/ceiling -- see
    GEOMETRY below.

`chalk_spec(board) -> dict` is a thin single-spec wrapper (first element of
`chalk_specs`) for any caller still on the original one-spec contract.

GEOMETRY -- corrected THREE times by the coordinator mid-build; this is the
final word, `bd-yjmxh/bot/vendor/lp-v9/lib/template.js:1595-1612`:

    PRIMARY_DIAGRAM_MIN_PX = 15.5     # label floor, px
    PHONE_FULL_COL = 455              # narrowing anchor, px (NOT A4's 729)
    PRIMARY_FIG_MAX_H = 1086          # height ceiling, px

"Phone-first is arithmetic, not a preference" (template.js's own docstring):
narrowing the spec's canvas to `minFont * PHONE_FULL_COL / PRIMARY_DIAGRAM_MIN_PX`
makes `colPx / vbW` constant, so a figure renders at the same pixel height on
phone and on A4. Anchoring on A4's 729px column instead puts the smallest
label under the floor and the tallest board over the ceiling.

IMPORTANT, discovered by reading the actual gate (template.js:2205-2210): the
strict primary floor only applies when `b.spec.width == null` -- that is the
condition that triggers `primaryRedraw`, the engine's OWN narrowing search.
A spec that sets `width` itself is graded on the lenient G6-12 floor instead
(~8.4px), which defeats the reason this floor exists ("the diagram REPLACES
the prose ... an unreadable label is not a degraded figure, it is a deleted
paragraph"). So **this module never sets `spec.width`** -- NARROW_TARGET_W
and INNER_W below exist only to ESTIMATE, in Python, the height the engine's
narrowing will land on, so the packer can predict what fits before ever
calling node. `figureFit`/`figureSlot`/`primaryRedraw` are NOT exported from
template.js (verified live); `requiredBox` (diagrams/lib/svg.js, exported)
plus the exported PRIMARY_DIAGRAM_MIN_PX/PHONE_FULL_COL/PRIMARY_FIG_MAX_H are
what verify_render.mjs uses to replicate the real check against actual
rendered SVGs.

A throwing spec does not omit the figure -- template.js draws a visible
dashed "DIAGRAM * TYPE -- not rendered" placeholder, worse than today's text.
Every spec here must be one actually rendered without throwing (verified
separately, see the module docstring in test_d0_board_chalk.py).
"""

from __future__ import annotations

import unicodedata

from d0_board_chalk_shapes import (
    as_text,
    build_alt,
    cp_len,
    fallback_spec,
    flatten,
    has_urdu,
    make_spec,
    sanitize_text,
    truncate_cp,
)

# ── real render geometry (template.js:1595-1612), G1-5-only ("primary") ─────
PRIMARY_DIAGRAM_MIN_PX = 15.5
PHONE_FULL_COL = 455
PRIMARY_FIG_MAX_H = 1086

LINE_SIZE = 13.0   # SZ.line == SIZE.small (tokens.js) -- the smallest font panels.js uses
INSET = 3
PAD_X = 12

# NARROW_TARGET_W: the width primaryCanvasWidth() itself computes
# (template.js:1629) -- `floor(minFont * PHONE_FULL_COL / PRIMARY_DIAGRAM_MIN_PX)`
# -- i.e. the width the engine's own narrowing search will try FIRST. Estimating
# the packer's wrap/height math at this width (never emitted as spec.width --
# see d0_board_chalk_shapes.make_spec) predicts what the real narrowed render
# will need, instead of guessing at the natural (unnarrowed) 640 default.
NARROW_TARGET_W = int((LINE_SIZE * PHONE_FULL_COL) / PRIMARY_DIAGRAM_MIN_PX)  # 381
PANEL_W = NARROW_TARGET_W - INSET * 2   # cols=1 always: one panel, full width
INNER_W = PANEL_W - PAD_X * 2           # 351

LINES_TOP_GAP = 9.0
GAP_BETWEEN_LINES = 6.0

# Conservative (overestimating) average glyph width, em/char -- measure.js's
# real Helvetica-AFM average is ~0.556em; 0.58 is deliberately pessimistic so
# this predicts MORE wrapped lines than the real renderer draws.
LATIN_CHAR_W = 0.58
LEADING_LATIN = 1.3
URDU_CHAR_W = 0.54   # measure.js tw() = 0.40em/char * UR_PAD(1.35)
LEADING_URDU = 2.2   # LEADING.urdu, lib/tokens.js

# Height budget, in the same user units as NARROW_TARGET_W's viewBox. The
# floor-clearing scale factor (PRIMARY_DIAGRAM_MIN_PX / LINE_SIZE) is constant
# regardless of which candidate width the search lands on, so the true user-unit
# ceiling is PRIMARY_FIG_MAX_H / (PRIMARY_DIAGRAM_MIN_PX / LINE_SIZE) ~= 910.9;
# HEIGHT_BUDGET leaves ~90 units (~10%) of margin against this module's own
# estimation slop -- verified empirically against the real engine, see
# verify_render.mjs (not a committed file; run from bd-yjmxh, LP_V9/NODE_PATH set).
HEIGHT_BUDGET = 820.0
OVERHEAD = 60.0  # panel padding + one title line, headroom for "(continued)"

TITLE_MAX = 60
MAX_SAFE_CHARS_PER_PIECE = 900  # defensive only -- see _split_oversized


# ── text-measurement estimate (mirrors panels.js's blockH(), conservatively) ─
def _wrap_count(text: str, size: float, w: float) -> int:
    n = cp_len(text)
    if n == 0:
        return 0
    if has_urdu(text):
        per_line = max(20.0, w - 6.0) / (size * URDU_CHAR_W)
    else:
        per_line = w / (size * LATIN_CHAR_W)
    per_line = max(1.0, per_line)
    return -(-n // int(per_line))  # ceil division, per_line >= 1 always

def _block_h(text: str, size: float, w: float) -> float:
    if not text:
        return 0.0
    nl = _wrap_count(text, size, w)
    if has_urdu(text):
        return nl * size * LEADING_URDU + size * 0.45
    return nl * size * LEADING_LATIN

def _lines_block_h(lines: list[str]) -> float:
    if not lines:
        return 0.0
    total = LINES_TOP_GAP
    for i, l in enumerate(lines):
        total += _block_h(l, LINE_SIZE, INNER_W) + (GAP_BETWEEN_LINES if i else 0.0)
    return total

def _panel_total(lines: list[str]) -> float:
    return OVERHEAD + _lines_block_h(lines)


# ── oversized-line safety net (defensive: real corpus max is 1,642 chars
# total per board, far under where this ever triggers) ──────────────────────
def _hard_split_word(word: str, max_len: int) -> list[str]:
    cps = [*word]
    pieces, i, n = [], 0, len(cps)
    while i < n:
        end = min(i + max_len, n)
        while end < n and unicodedata.combining(cps[end]):
            end += 1
        pieces.append("".join(cps[i:end]))
        i = end
    return pieces or [word]

def _split_oversized(text: str) -> list[str]:
    if cp_len(text) <= MAX_SAFE_CHARS_PER_PIECE:
        return [text]
    words: list[str] = []
    for w in text.split(" "):
        words.extend(_hard_split_word(w, MAX_SAFE_CHARS_PER_PIECE) if cp_len(w) > MAX_SAFE_CHARS_PER_PIECE else [w])
    pieces, cur, cur_len = [], [], 0
    for w in words:
        wl = cp_len(w) + (1 if cur else 0)
        if cur and cur_len + wl > MAX_SAFE_CHARS_PER_PIECE:
            pieces.append(" ".join(cur))
            cur, cur_len = [w], cp_len(w)
        else:
            cur.append(w)
            cur_len += wl
    if cur:
        pieces.append(" ".join(cur))
    return pieces or [text]


# ── packing: greedy fill, never drop a line, split what does not fit ────────
def _pack(lines: list[str]) -> list[list[str]]:
    chunks: list[list[str]] = []
    cur: list[str] = []
    for raw in lines:
        for piece in _split_oversized(raw):
            trial = cur + [piece]
            if not cur or _panel_total(trial) <= HEIGHT_BUDGET:
                cur = trial
            else:
                chunks.append(cur)
                cur = [piece]
    if cur:
        chunks.append(cur)
    return chunks or [["(no board content provided)"]]


# ── public entry points ──────────────────────────────────────────────────
def chalk_specs(board: dict) -> list[dict]:
    """The board drawn as the teacher will chalk it -- one `panels` spec per
    height-budget's worth of content. NEVER returns an empty list, NEVER raises."""
    try:
        lines = flatten(board) or ["(no board content provided)"]

        title_raw = as_text(board.get("title")) if isinstance(board, dict) else ""
        title_raw = truncate_cp(sanitize_text(title_raw) or "WRITE ON THE BOARD", TITLE_MAX)
        title_cont = truncate_cp(title_raw + " (continued)", TITLE_MAX + 14)

        chunks = _pack(lines)
        n = len(chunks)
        specs = [
            make_spec(
                title_raw if idx == 0 else title_cont,
                chunk_lines,
                None,  # never set: primaryRedraw only runs when spec.width is null
                build_alt(board, idx, n, chunk_lines),
            )
            for idx, chunk_lines in enumerate(chunks)
        ]
        return specs or [fallback_spec()]
    except Exception:
        return [fallback_spec()]

def chalk_spec(board: dict) -> dict:
    """Thin single-spec wrapper over `chalk_specs` for any caller still on the
    original one-spec-per-board contract. NEVER returns None."""
    specs = chalk_specs(board)
    return specs[0] if specs else fallback_spec()
