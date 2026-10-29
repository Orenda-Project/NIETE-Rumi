"""Row -> text -> spec-dict "shape" for d0_board_chalk.

Split out of d0_board_chalk.py (coordinator instruction: that file was 311
lines, over the 300-line limit; the natural seam is "how many specs and how
they're packed" vs "what one spec dict looks like"). This half owns the
second question:

  - code-point-safe text primitives shared with the packer (cp_len, has_urdu,
    truncate_cp) -- Urdu/Arabic is measured in code points, never bytes, never
    sliced through a combining mark.
  - board row -> sanitized display line (flatten), refusing lint_lp.js gate
    10's placeholder shapes: an empty `[ ]`/`[]` bracket slot becomes a ruled
    underscore line, an `<ANGLE>` token loses its brackets, never emitted
    literally.
  - the actual `panels`-type spec dict (make_spec) -- the one existing
    renderer this module targets (bot/vendor/lp-v9/diagrams/types/panels.js,
    no new renderer added) -- plus the honest empty-board fallback
    (fallback_spec) and its alt-text (build_alt).

No geometry/height-budget math lives here on purpose -- that is
d0_board_chalk.py's job, so this file stays reusable if the budget constants
ever change again (they already have, twice).
"""

from __future__ import annotations

import re
import unicodedata

TITLE_MAX = 60
ALT_MAX = 220

_URDU_RANGES = ((0x0600, 0x06FF), (0xFB50, 0xFDFF), (0xFE70, 0xFEFF))
_EMPTY_BRACKET_RE = re.compile(r"\[\s*\]")
_ANGLE_TOKEN_RE = re.compile(r"<\s*[A-Za-z_][A-Za-z0-9_ ]{0,30}\s*>")


# ── code-point-safe primitives ───────────────────────────────────────────────
def cp_len(s: str) -> int:
    return len([*s])


def has_urdu(s: str) -> bool:
    for ch in s:
        cp = ord(ch)
        if any(lo <= cp <= hi for lo, hi in _URDU_RANGES):
            return True
    return False


def truncate_cp(s: str, max_len: int) -> str:
    cps = [*s]
    if len(cps) <= max_len:
        return s
    end = max_len
    while end < len(cps) and unicodedata.combining(cps[end]):
        end += 1
    return "".join(cps[:end]).rstrip() + "…"


def as_text(v) -> str:
    """Coerce any JSON-ish value to text without ever raising -- content that
    "arrived as a list" (or dict) is flattened, nothing dropped."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, (list, tuple)):
        return " ".join(t for t in (as_text(x) for x in v) if t)
    if isinstance(v, dict):
        return " ".join(t for t in (as_text(x) for x in v.values()) if t)
    try:
        return str(v).strip()
    except Exception:
        return ""


def sanitize_text(s: str) -> str:
    """Clear lint_lp.js gate 10's placeholder-shaped patterns this module
    could accidentally emit: an unfilled bracket slot becomes a ruled line
    (underscore run), never the literal characters `[ ]`."""
    if not s:
        return ""
    s = _EMPTY_BRACKET_RE.sub("______", s)
    s = _ANGLE_TOKEN_RE.sub(lambda m: m.group(0).strip("<>").strip(), s)
    return s


# ── row -> line text ──────────────────────────────────────────────────────
def _row_text(row) -> str:
    row = row if isinstance(row, dict) else {}
    term = as_text(row.get("term"))
    gloss = as_text(row.get("gloss"))
    cells = row.get("cells")
    text = as_text(row.get("text"))
    kind = str(row.get("kind") or "text")

    if term and gloss:
        s = f"{term} — {gloss}"
    elif isinstance(cells, list) and cells:
        parts = [p for p in (sanitize_text(as_text(c)) for c in cells) if p]
        s = " | ".join(parts) if parts else text
    elif cells is not None and not isinstance(cells, list):
        s = as_text(cells) or text
    else:
        s = text

    s = sanitize_text(s)
    if not s:
        return ""
    return f"• {s}" if kind == "step" else s


def flatten(board) -> list[str]:
    """Every row, in document order, as one formatted line each. A panel's
    label becomes its own line, so a panel boundary is never silently merged."""
    board = board if isinstance(board, dict) else {}
    panels = board.get("panels")
    panels = panels if isinstance(panels, list) else []
    lines: list[str] = []
    for p in panels:
        p = p if isinstance(p, dict) else {}
        label = sanitize_text(as_text(p.get("label")))
        rows = p.get("rows")
        rows = rows if isinstance(rows, list) else []
        row_lines = [t for t in (_row_text(r) for r in rows) if t]
        if not row_lines:
            continue
        if label:
            lines.append(f"— {label} —")
        lines.extend(row_lines)
    instruction = sanitize_text(as_text(board.get("instruction")))
    if instruction:
        lines.append(f"▸ {instruction}")
    return lines


# ── spec assembly ("shape") ──────────────────────────────────────────────
def build_alt(board, idx: int, n: int, chunk_lines: list[str]) -> str:
    title = as_text(board.get("title")) if isinstance(board, dict) else ""
    title = title or "the board"
    n_lines = len(chunk_lines)
    if n > 1:
        return (f"Chalkboard for {title}, part {idx + 1} of {n}: {n_lines} lines "
                f"written out for the teacher to copy.")
    return f"Chalkboard for {title}: {n_lines} lines written out for the teacher to copy."


def make_spec(title: str, lines: list[str], width, alt: str) -> dict:
    """The one spec shape this module emits: a single-column `panels` box
    with the title as its heading and every line pre-wrapped by the caller's
    height budget, never by this function.

    `width` is deliberately left OUT of the dict when None. G1-5
    (`ctx.primary`) only runs the strict 15.5px-floor narrowing
    (`primaryRedraw`, template.js:1658) when `spec.width == null` -- setting
    a width ourselves would silently opt this board OUT of that protection
    and back onto the lenient G6-12 floor (~8.4px), which is exactly the
    "unreadable label" the coordinator's correction exists to prevent. The
    height/wrap budget in d0_board_chalk.py is estimated AT the width the
    engine's own narrowing will pick, so leaving the key out costs nothing."""
    spec = {
        "type": "panels",
        "columns": 1,
        "panels": [{"title": title, "lines": list(lines)}],
        "alt": truncate_cp(sanitize_text(alt), ALT_MAX),
    }
    if width is not None:
        spec["width"] = width
    return spec


def fallback_spec(width=None) -> dict:
    return make_spec(
        "WRITE ON THE BOARD",
        ["(board content unavailable)"],
        width,
        "Chalkboard: board content unavailable.",
    )
