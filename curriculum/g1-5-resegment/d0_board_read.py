"""WRITE ON THE BOARD -- reading the authored field into typed rows, not text.

The operator has asked four times for the board to become an actual drawing, not
laid-out text. That means a downstream module needs to know WHAT each line is --
a table, an arrow chain, a fill-in blank, a worked sum -- so it can draw the shape
instead of printing the sentence. This module is the bottom of that stack: it reads
`boardWork` and returns a `Board` of `Panel`s of typed `Row`s. It draws nothing.

Row   = {"kind": str, "text": str, "term": str|None, "gloss": str|None, "cells": list[str]|None}
Panel = {"label": str|None, "rows": list[Row]}
Board = {"title": str|None, "panels": list[Panel], "instruction": str}

KIND PRIORITY, when a line matches more than one pattern (highest wins):
table > boxart > calc > arrow > slot > frame > gloss > step > text.
`text` on every Row is the original line, exactly as split from the field --
never stripped, never reflowed. Only the kind-specific fields are derived.

THE LIST-CONTENT BUG THIS FIXES. `content` sometimes arrives as a JSON list
(vocab lines, one string per round) instead of one newline string. The pipeline
this replaces joined list items with "\\n\\n" -- a blank line -- which turned every
item into its OWN panel. A 4-line vocab list became 4 orphan panels. Joining with
a single "\\n" instead keeps the list as consecutive lines of ONE group, which is
what blank-line grouping (see _split_groups) was already designed to produce for a
board authored as a single newline string in the first place.
"""

from __future__ import annotations

import re

KINDS = ("table", "arrow", "slot", "gloss", "calc", "boxart", "step", "frame", "text")

_BLANK = re.compile(r"\n\s*\n+")
_HEADING_TAIL = ":：۔"
_BOX_UNI = re.compile(r"[─-╿]")
_CORNER = re.compile(r"\+-{2,}|-{2,}\+")
_ROUND_SHAPE = re.compile(r"\(_{2,}[^()]*\)")
_BRACKET = re.compile(r"\[[^\]]*\]")
_FRAME = re.compile(r"_{3,}")
_STEP = re.compile(r"^\s*(?:step\s*)?\d+\s*[.):۔]", re.IGNORECASE)
_DIGIT = re.compile(r"\d")
_OP_X = re.compile(r"(?<![A-Za-z])[xX×÷](?![A-Za-z])")
_OP_PLAIN = re.compile(r"[+*]")
# Connector for an arrow chain: a dash-run arrow (with an optional inline label,
# e.g. "--×12-->" or "------------->"), OR a bare "->", OR a unicode arrow.
_CONNECTOR = re.compile(r"-{2,}([^-]*)-*>|(->)|(→)|(➔)")
# A box-drawing dash run used as an ARROW SHAFT (e.g. "Found ─────────► Lost")
# reads as an arrow, not a drawn box -- normalize it to "->" before classifying.
# Arrowhead/tail glyph sets mirror the sibling module d0_board.py's own
# _unbox exclusion, calibrated against this same corpus.
_ARROWHEAD_CLASS = ">❯»▶►➜➤"
_ARROWTAIL_CLASS = "<❮«◀◄"
_BOX_HEAD = re.compile(r"[─-╿]+[" + re.escape(_ARROWHEAD_CLASS) + "]")
_TAIL_BOX = re.compile(r"[" + re.escape(_ARROWTAIL_CLASS) + r"][─-╿]+")


def _to_text(content) -> str:
    """Both authored shapes -> one string, single-newline-joined for lists.

    A single "\\n" keeps list items on consecutive lines of one group, so a
    3-line vocab list stays one panel -- see the module docstring.
    """
    if isinstance(content, list):
        return "\n".join(str(item) for item in content)
    return content or ""


def _has_math(s: str) -> bool:
    return bool(_DIGIT.search(s) or _OP_X.search(s) or _OP_PLAIN.search(s))


def _normalize_arrows(line: str) -> str:
    """Box-drawing dash runs that are actually an arrow shaft (touching an
    arrowhead/tail glyph) become "->" for MATCHING purposes only -- `row["text"]`
    always keeps the real, un-normalized line. This is what keeps a line like
    "Found ─────────► Lost" out of boxart
    (its box-drawing chars are a shaft, not a frame) and lets it read as arrow."""
    line = _BOX_HEAD.sub("->", line)
    line = _TAIL_BOX.sub("->", line)
    return line


def _table_cells(line: str):
    """Pipe-delimited cells, or None. "||" (touching pipes) is a tally mark,
    e.g. "sides ||| = 3", not a column boundary -- real cells always have a
    character (even just a space) between two pipes."""
    if "|" not in line or "||" in line:
        return None
    cells = [c.strip() for c in line.split("|")]
    if cells and cells[0] == "":
        cells = cells[1:]
    if cells and cells[-1] == "":
        cells = cells[:-1]
    if len([c for c in cells if c]) < 2:
        return None
    return cells


def _is_boxart(line: str) -> bool:
    """Unicode box-drawing chars (once a shaft-not-frame run has already been
    normalized away by _normalize_arrows), a "+---" corner, or a "(___)" round
    shape. A backslash is always deliberate in this corpus -- real hand-drawn
    shapes pair it with a "/" ("/____\\"). A bare "/" alone is NOT enough: it is
    just as often an ordinary word-choice separator ("has/have", "SAME /
    DIFFERENT?", "plant NEAR sofa / plant FAR from sofa") as it is art."""
    if _BOX_UNI.search(line) or "\\" in line:
        return True
    return bool(_CORNER.search(line) or _ROUND_SHAPE.search(line))


_ISOLATED_EQUALS = re.compile(r"(?<!=)=(?!=)")


def _is_calc(line: str) -> bool:
    """A worked calculation: for AT LEAST ONE ISOLATED "=" in the line (never a
    doubled "==", which in this corpus is a hand-drawn ruler/progress-bar fill
    like "0[============......]200", not arithmetic), the 15 characters
    immediately before it AND the 15 immediately after it each carry a digit or
    an arithmetic operator. The window is local on purpose -- "P = 4 x L = 4 x 3
    = 12 m" passes at its second/third "=" even though it fails at the bare
    "P" of the first, but a multi-sentence prose paragraph that merely mentions
    a stray digit two clauses away from an unrelated "=" ("thermometer = a
    number line... there are 10 small sections. Each section = 1 degree.") no
    longer piggybacks on that far-off digit the way a whole-segment scan would."""
    for m in _ISOLATED_EQUALS.finditer(line):
        before = line[max(0, m.start() - 15):m.start()]
        after = line[m.end():m.end() + 15]
        if _has_math(before) and _has_math(after):
            return True
    return False


def _strip_brackets(s: str) -> str:
    if len(s) >= 2 and s.startswith("[") and s.endswith("]"):
        return s[1:-1].strip()
    return s


def _split_arrow_chain(line: str):
    """Chain nodes in order. An inline dash-run label (e.g. the "×12" in
    "--×12-->") is folded into the text of the node that FOLLOWS it, since
    it describes the transition into that node, not the one before it."""
    nodes, pos, pending = [], 0, None
    for m in _CONNECTOR.finditer(line):
        seg = line[pos:m.start()].strip()
        text = f"{pending} {seg}".strip() if pending else seg
        nodes.append(_strip_brackets(text))
        label = m.group(1)
        pending = label.strip() if label and label.strip() else None
        pos = m.end()
    tail = line[pos:].strip()
    text = f"{pending} {tail}".strip() if pending else tail
    nodes.append(_strip_brackets(text))
    return [n for n in nodes if n]


def _gloss_pair(line: str):
    if "=" not in line:
        return None
    term, _, rest = line.partition("=")
    term, rest = term.strip(), rest.strip()
    return (term, rest) if term and rest else None


def _classify(line: str) -> dict:
    """`text` always keeps the real, original line. Every pattern check below
    runs against `view` -- the line with any box-drawing arrow-shaft normalized
    to "->" (see _normalize_arrows) -- so a shaft never gets mistaken for a
    frame, and downstream cell-splitting sees a plain "->" to split on."""
    row = {"kind": "text", "text": line, "term": None, "gloss": None, "cells": None}
    view = _normalize_arrows(line)
    cells = _table_cells(view)
    if cells is not None:
        row["kind"], row["cells"] = "table", cells
        return row
    if _is_boxart(view):
        row["kind"] = "boxart"
        return row
    if _is_calc(view):
        row["kind"] = "calc"
        return row
    if "->" in view or "→" in view or "➔" in view:
        row["kind"], row["cells"] = "arrow", _split_arrow_chain(view)
        return row
    if _BRACKET.search(view):
        row["kind"] = "slot"
        return row
    if _FRAME.search(view):
        row["kind"] = "frame"
        return row
    pair = _gloss_pair(view)
    if pair is not None:
        row["kind"], row["term"], row["gloss"] = "gloss", pair[0], pair[1]
        return row
    if _STEP.match(view):
        row["kind"] = "step"
        return row
    return row


def _is_label(line: str) -> bool:
    """A group's first line labels the group when punctuated as one (":", "：",
    Urdu "۔") or when it is short and cased like a heading (ALL CAPS or Title
    Case) -- and only when it does not already read as board content of its own,
    which is what keeps an arrow chain or a gloss pair out of the label slot."""
    s = line.strip()
    if not s or _classify(s)["kind"] != "text":
        return False
    if s[-1] in _HEADING_TAIL:
        return True
    if len(s.split()) > 6 or len([*s]) > 40:
        return False
    letters = [c for c in s if c.isalpha()]
    return len(letters) >= 3 and (s.isupper() or s.istitle())


def _panel_from_group(group: str) -> dict:
    lines = group.split("\n")
    label, body = None, lines
    if len(lines) >= 2 and _is_label(lines[0]):
        label, body = lines[0].strip(), lines[1:]
    rows = [_classify(ln) for ln in body if ln.strip()]
    return {"label": label, "rows": rows}


def read_board(board_work: dict) -> dict:
    text = _to_text(board_work.get("content"))
    stripped = text.strip()
    groups = [g for g in _BLANK.split(stripped) if g.strip()] if stripped else []
    title = None
    if len(groups) >= 2 and "\n" not in groups[0].strip():
        title, groups = groups[0].strip(), groups[1:]
    panels = [_panel_from_group(g) for g in groups]
    return {"title": title, "panels": panels, "instruction": board_work.get("instruction") or ""}
