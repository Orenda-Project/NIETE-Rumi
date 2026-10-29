"""d0_board_art_scan_refuse.py -- the three refusals `try_compare` cannot host.

WHY A SEPARATE MODULE. `d0_board_art_scan.py` is at 276 lines and these rules
carry more WHY than code; splitting beats abstracting (rules/always.md).

WHY THESE THREE, measured on the real 335-doc D0 build, not reconstructed. Three
boards reached `compare_size` and two of them taught something false:

  g2_ch9/Maths_seg4  "Bunty: wooden bird = 250 g     Babloo: clay pot = 650 g"
    `_NAMED_VALUE` reads a label back to the nearest comma or newline, and these
    two pairs sit on ONE line separated by spaces. So the "g" of "250 g" is not
    consumed by the first match and opens the second: the teacher sees
    "g Babloo: clay pot" printed on the figure. A leading bare unit token is
    therefore proof the parse tore a value apart, and the whole comparison is
    refused -- dropping just that item would silently show a comparison with one
    of its things missing, which is a different wrong answer, not a fix.

  g5_ch9/Maths_seg5  "small 2 = squared = 2 factors" / "small 3 = cubed = 3 factors"
    parses as a thing called "squared" of size 2 beside a thing called "cubed" of
    size 3, and draws them as bars. x^2 and x^3 are NOTATIONS; 2 and 3 are the
    counts of factors, not magnitudes, and 4^2 = 16 is larger than 3^3 = 27 is
    false. No arithmetic gate catches this because neither label contains an
    operator. It is caught on the vocabulary, which is what is actually wrong.
    (Its signal word was "smaller", off "Draw a smaller diamond in the centre" --
    a chalk instruction, not a comparison. That is a separate weakness, left
    alone here: this module gates the defect, not the trigger.)

  A spec tagged lang "ur" whose own visible text carries no Arabic letter is
    incoherent -- g5_ch9 was tagged "ur" off the bracketed Urdu glosses while both
    labels read "squared"/"cubed". The tag is dropped, not the figure: the figure
    is fine, only the claim about its language is wrong. Measured in CODE POINTS
    via a codepoint class, never bytes or `.length` (rule 20).
    A spec with NO visible text at all keeps the board's language: g3_ch8/Maths_seg3
    is `{"type":"numberline","from":1,"to":10,"lang":"ur"}` and has no label,
    caption or title for the tag to contradict. "No text" is not "English text".

Pure: stdlib only (`re`), no I/O, no vendor imports.
"""

from __future__ import annotations

import re

# Metric abbreviations only, and only ones that are not also English words -- the
# corpus is metric. "min" is deliberately absent: "min temp = 4, max temp = 9" is a
# real comparison whose first label really does start with "min".
_UNITS = {"g", "gm", "kg", "mg", "ml", "l", "cl", "dl", "mm", "cm", "m", "km"}
_FIRST_WORD = re.compile(r"^([^\W\d_]+)", re.UNICODE)

# Exponent/ordinal vocabulary, English and Urdu. Bare "square"/"cube" are absent on
# purpose: those are SHAPES, and "cube = 8, sphere = 4" is a fair comparison.
_EXPONENT = re.compile(
    r"\bsquared\b|\bcubed\b|\bexponent\b|\bto\s+the\s+power\b|\bpower\s+of\b"
    r"|مربع|مکعب", re.I | re.UNICODE)

# The Arabic-script letters, matching d0_board_art_scan._URDU: the letters, not the
# terminal marks U+06D4/U+061F, which carry no language on their own.
_URDU_LETTER = re.compile(r"[ؠ-يٱ-ۓ]")
# The keys a teacher actually reads off the figure. `type` and `kind` are engine
# words, not text, and counting them would make an unlabelled numberline look like
# an English spec.
_TEXT_KEYS = ("label", "caption", "title")


def debris_label(label: str) -> bool:
    """True when the label opens with a bare unit torn off the PREVIOUS value."""
    m = _FIRST_WORD.match(label or "")
    return bool(m) and m.group(1).lower() in _UNITS


def exponent_label(label: str) -> bool:
    """True when the label is exponent vocabulary, which has no magnitude."""
    return bool(_EXPONENT.search(label or ""))


def visible_text(spec) -> list:
    """Every string a teacher reads off the figure, in document order."""
    found = []
    if isinstance(spec, dict):
        for key, value in spec.items():
            if key in _TEXT_KEYS and isinstance(value, str):
                found.append(value)
            else:
                found.extend(visible_text(value))
    elif isinstance(spec, list):
        for value in spec:
            found.extend(visible_text(value))
    return found


def lang_unsupported(spec) -> bool:
    """True when the spec claims Urdu and its own visible text is not Urdu."""
    if not isinstance(spec, dict) or spec.get("lang") != "ur":
        return False
    texts = visible_text(spec)
    if not texts:
        return False  # nothing to contradict -- see the numberline note above
    return not any(_URDU_LETTER.search(t) for t in texts)
