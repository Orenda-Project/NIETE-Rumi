"""Stage D0 - turn ONE authored string into the array form the renderer bullets.

Pure. stdlib only, no I/O, no vendor imports. Nothing here knows about a document,
a page or a file; callers hand it a string and a slot name and get elements back.

THE INVARIANT
    " ".join(parts) == normalise(original)
holds for every list this module returns, and is CHECKED (`round_trips`) before any
list leaves. The renderer's two-pass fill gate re-joins a rejected array with a bare
" ", so an exact round-trip is what makes a rejected array reproduce the authored
text character for character. A split that cannot round-trip is refused, not fixed
up: nothing is ever dropped, added, reordered or re-punctuated. Whitespace collapse
between elements is the only change this module makes to a word of the original.

Splits happen AT sentence-terminal punctuation, which stays attached to the element
it ends. Terminals are `.` `?` `!` and, first-class, U+06D4 (Urdu full stop) and
U+061F (Arabic question mark). Every length is a code-point count (`cp_len`); in
CPython `len(str)` is already code points, so the JS-side UTF-16 hazard cannot
arise here - `cp_len` exists so the unit is stated, not assumed.
"""

import re
from typing import Dict, List, NamedTuple, Optional, Tuple

__all__ = [
    "TERMINALS", "ABBREV", "Policy", "Split", "DEFAULT_POLICY", "SLOT_POLICY",
    "normalise", "cp_len", "round_trips", "sentences", "carries_dialogue",
    "split_field", "policy_for", "assemble",
]

TERMINALS = "\u06d4\u061f.?!"        # \u06d4 URDU FULL STOP, \u061f ARABIC ?
_ELLIPSIS = ".\u06d4\u2026"          # a repeated run of these trails off
_TRAIL = "\"'\u2018\u2019\u201c\u201d\u00ab\u00bb\u2039\u203a)]}"
_OPENERS = "([{"
_CLOSERS = ")]}"
_APOSTROPHES = "'\u2019"
_LOWER = "abcdefghijklmnopqrstuvwxyz"
# Quote classes. Each is ONE class whose occurrences must come out even. Urdu writes
# the curly pair in MIRROR order (\u2019 then \u2018), so parity - not open/close
# pairing - is what survives both directions.
_QUOTE_CLASSES = ('"', "'", "\u2018\u2019", "\u201c\u201d", "\u00ab\u00bb",
                  "\u2039\u203a")

# MEASURED against the 335-lesson ch9-10 corpus: these tokens carry a full stop that
# does not end a sentence. Units (cm. kg. m. g.) are deliberately ABSENT - in this
# corpus they end real sentences ("record the length in cm. Then compare ..."), and
# suppressing those boundaries would cost the operator the split she asked for.
ABBREV = frozenset(
    "p pp e.g i.e etc no nos mr mrs ms dr prof fig figs vs cf approx ch vol".split())

# A quoted span counts as spoken dialogue when it carries a terminal mark or runs at
# least this many code points. Below it, a quoted WORD is a word under inspection.
DIALOGUE_SPAN = 20


class Policy(NamedTuple):
    """How eagerly one slot may become an array."""
    min_parts: int = 2
    max_parts: int = 4
    min_len: int = 25          # code points, per element
    refuse_dialogue: bool = False


class Split(NamedTuple):
    parts: Optional[List[str]]   # None == refused; the caller keeps the string
    reason: str


# The nine slots the lp_doc schema widened to `string | string[]` (the schema walk,
# not a brief, is the authority on which slots exist).
#
# max_parts guards against SHREDDING, not against pagination - the renderer's own
# two-pass fill gate already re-joins any array that costs a page. MEASURED over the
# 335-lesson ch9-10 corpus: 6 is the p95 of the natural element count for the page2
# and exit-ticket slots; 8 is the p95 for the two example prompts, which are step
# lists and read WELL as long ones (94% of them land at 8 or fewer).
#
# The hook is the exception, on the operator's ruling that the opening is "a whole
# provocation on its own ... just 1 not multiple strategies": it refuses narration
# outright (193 of 335 hooks quote speech) and caps at 5, which is the knee - 5
# admits 69 hooks, 6 admits only 3 more, 8 only 1 more again.
DEFAULT_POLICY = Policy(min_parts=2, max_parts=6, min_len=25, refuse_dialogue=False)
_HOOK_POLICY = Policy(min_parts=2, max_parts=5, min_len=25, refuse_dialogue=True)
_STEPS_POLICY = Policy(min_parts=2, max_parts=8, min_len=25, refuse_dialogue=False)
SLOT_POLICY: Dict[str, Policy] = {
    "objectives.outcome": DEFAULT_POLICY,
    "exit_ticket[].q": DEFAULT_POLICY,
    "page2.differentiation.stuck": DEFAULT_POLICY,
    "page2.differentiation.early": DEFAULT_POLICY,
    "page2.coaching_reflection": DEFAULT_POLICY,
    "ask#hook.question": _HOOK_POLICY,
    "worked_example.prompt": _STEPS_POLICY,
    "worked_example.cfu": DEFAULT_POLICY,
    "faded_example.prompt": _STEPS_POLICY,
}


def cp_len(text: str) -> int:
    """Length in CODE POINTS. Stated, never inferred from a byte or unit count."""
    return len([*text])


def normalise(text: str) -> str:
    """Collapse every whitespace run to one space and strip the ends."""
    return re.sub(r"\s+", " ", text).strip()


def round_trips(original: str, parts: List[str]) -> bool:
    """The invariant, checked rather than trusted."""
    return " ".join(parts) == normalise(original)


def policy_for(slot: Optional[str]) -> Policy:
    return SLOT_POLICY.get(slot or "", DEFAULT_POLICY)


def _is_apostrophe(s: str, i: int) -> bool:
    """A contraction's apostrophe, not a quote: a letter stands on both sides."""
    if s[i] not in _APOSTROPHES:
        return False
    return 0 < i < len(s) - 1 and s[i - 1].isalpha() and s[i + 1].isalpha()


def _masks(s: str) -> Tuple[List[bool], bool]:
    """free[i] -> index i sits outside every quotation and bracket.

    Returns (free, balanced). `balanced` is False when any quote class comes out
    odd; the module then refuses to split at all rather than guess where the
    quotation ended.
    """
    depth = 0
    parity = dict.fromkeys(_QUOTE_CLASSES, 0)
    free = [False] * len(s)
    for i, ch in enumerate(s):
        if ch in _OPENERS:
            depth += 1
        elif ch in _CLOSERS:
            depth = max(0, depth - 1)
        elif not _is_apostrophe(s, i):
            for cls in _QUOTE_CLASSES:
                if ch in cls:
                    parity[cls] ^= 1
        free[i] = depth == 0 and not any(parity.values())
    return free, not any(parity.values())


def _suppressed(word: str) -> bool:
    """A token that ends in a stop WITHOUT ending a sentence."""
    bare = word.strip(_TRAIL + _OPENERS)
    if not bare:
        return True
    if bare.lower() in ABBREV:
        return True
    return cp_len(bare) <= 1          # the `A.` / `(1)` / `(۱)` enumerator


def _boundaries(s: str, free: List[bool]) -> List[int]:
    """Indices of the spaces that end a sentence. `s` is already normalised."""
    out = []
    for i, ch in enumerate(s):
        if ch != " " or not free[i]:
            continue
        j = i - 1
        while j >= 0 and s[j] in _TRAIL:      # closing quotes/brackets ride along
            j -= 1
        if j < 0 or s[j] not in TERMINALS:
            continue
        end = j
        while j >= 0 and s[j] in TERMINALS:
            j -= 1
        run = s[j + 1:end + 1]
        if len(run) > 1 and set(run) <= set(_ELLIPSIS):
            continue                          # "..." / "۔۔۔" trails off
        if j < 0:
            continue
        word = s[s.rfind(" ", 0, j + 1) + 1:j + 1]
        if _suppressed(word):
            continue
        if i + 1 < len(s) and s[i + 1] in _LOWER:
            continue                          # a lower-case Latin word continues one
        out.append(i)
    return out


def assemble(norm: str, cuts: List[int]) -> Tuple[List[str], str]:
    """Cut a normalised string at `cuts` and REFUSE anything that cannot re-join.

    `_boundaries` only ever hands back indices of a single space, so the check
    below cannot fire for it - which is the point. It is the one place the
    invariant is enforced rather than assumed, and it holds for any caller.
    """
    parts = []
    start = 0
    for i in cuts:
        parts.append(norm[start:i])
        start = i + 1
    parts.append(norm[start:])
    if not round_trips(norm, parts):
        return [norm], "roundtrip"
    return parts, "ok"


def _split(norm: str) -> Tuple[List[str], str]:
    """The structural split. Returns (parts, reason); parts is [norm] on refusal."""
    if not norm:
        return [""], "empty"
    free, balanced = _masks(norm)
    if not balanced:
        return [norm], "unbalanced_quotes"
    cuts = _boundaries(norm, free)
    if not cuts:
        return [norm], "no_boundary"
    return assemble(norm, cuts)


def sentences(text: str) -> List[str]:
    """Split `text` at sentence ends. One element back means: do not split."""
    return _split(normalise(text))[0]


def carries_dialogue(text: str) -> bool:
    """True when the text quotes SPEECH - a narrated scene, not a word on show."""
    s = normalise(text)
    for cls in _QUOTE_CLASSES:
        opened = None
        for i, ch in enumerate(s):
            if ch not in cls or _is_apostrophe(s, i):
                continue
            if opened is None:
                opened = i
                continue
            inner = s[opened + 1:i]
            if any(c in TERMINALS for c in inner) or cp_len(inner) >= DIALOGUE_SPAN:
                return True
            opened = None
    return False


def split_field(text: str, slot: Optional[str] = None,
                policy: Optional[Policy] = None) -> Split:
    """The whole decision for one authored field.

    Split(parts, "ok") or Split(None, <why not>). A refusal is not a failure: the
    caller keeps the authored string, which the renderer prints exactly as before.
    """
    pol = policy if policy is not None else policy_for(slot)
    norm = normalise(text)
    parts, reason = _split(norm)
    if reason != "ok":
        return Split(None, reason)
    if pol.refuse_dialogue and carries_dialogue(norm):
        return Split(None, "narrated")
    if len(parts) < pol.min_parts:
        return Split(None, "too_few")
    if len(parts) > pol.max_parts:
        return Split(None, "too_many")
    if any(cp_len(p) < pol.min_len for p in parts):
        return Split(None, "short_element")
    if not round_trips(norm, parts):
        return Split(None, "roundtrip")
    return Split(parts, "ok")
