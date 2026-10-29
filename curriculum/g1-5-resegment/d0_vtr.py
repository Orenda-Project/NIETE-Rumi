"""Stage D0 — the opening's ONE visual thinking routine (bd-52j3b).

OPERATOR, twice: *"yes add see think wonder to the hooks"*, and then, after a build
that did not have it, *"i dont see any VTRs either in the LPs"*.

MEASURED BEFORE THIS MODULE EXISTED. Swept all 335 built lp_docs under
`ch9-10-build/renders/*/docs/*.lp.json` for See-Think-Wonder, Think-Puzzle-Explore,
Zoom In, Claim-Support-Question, I-used-to-think, Chalk Talk, Circle of Viewpoints,
Connect-Extend-Challenge, "what makes you say that", "visual thinking" and VTR: ONE
hit, `g5_ch10/Urdu_seg10`, and it is the Urdu textbook's OWN closing reflection on
p.۱۰۷, carried through by enrichment. Zero openings carried a routine. There was no
implementation to fix; this is the implementation.

THE ROUTINE **IS** THE PROVOCATION -- it is not a fourth thing in the box.

    *"it should be just 1 not multiple strategies since opening is a whole
    provocation on its own"*, and *"If I see the Opening, there is a strategy, then
    3 questions then a hook and then an open with this question, doesnt make sense
    what to do and what not to do."*

The Opening already runs settle -> warm-up (one named strategy) -> set-up -> the
hook ASK -> read-aloud -> keywords -> board. Adding a See-Think-Wonder BLOCK would
make that eight, and would be the exact defect she named. So this module emits no
block and deletes no block: it REWRITES the one `ask` that already carries
`hook: true` -- the lesson's single landmark provocation -- into See-Think-Wonder
form, with the authored question standing unaltered in the middle as the THINK.
`test_d0_vtr.py::test_it_adds_no_block_the_routine_IS_the_provocation` pins that.

WRITTEN, NEVER SPOKEN BETWEEN CHILDREN. *"teachers dont let students talk to each
other, that too when the class begins"* -- a standing rule, enforced at render time
by lint gate 10e (`peer_talk_gate.js` -> `lib/peertalk.js`). Every child writes three
lines in her own copy in silence. Nothing here pairs, partners, whispers or turns-and-
talks, and the emitted string is checked against the live gate, not against a promise.

IT MUST HAVE SOMETHING TO LOOK AT. A See-Think-Wonder with no visual is three more
questions, which is more reading on a page already averaging 367 words. Two anchors,
in this order:

  1. THE TEXTBOOK PAGE THE HOOK ALREADY NAMES. 281 of the 440 enrichment records
     open with one ("Open textbook p. 127 to the picture of Pinky and Jojo...").
     This is preferred over the board because it is the visual the opening is
     ALREADY pointing at, and because it costs the teacher nothing new.
  2. THE BOARD ITSELF, the `board` block in the introduction. `d0_board_read`
     parses panels for 439 of the same 440 records. (It used to ask
     `d0_board_draw.board_diagram` instead; bd-287sn stopped that slot from
     re-printing the board as SVG, so the figure is no longer the thing to ask.)

A lesson with NEITHER gets NO routine and a line in `notes.gaps`. Dark stages stay
dark: inventing a picture for the hook to point at would put the teacher in front of
a class looking for something that is not there.

URDU IS AUTHORED IN URDU AND KEPT TIGHTER THAN ENGLISH, because Urdu is already the
densest subject on the page (~510 words/page against a 367 corpus mean). The page
NUMBER is carried through verbatim rather than converted, so a hook that wrote
`صفحہ ۱۰۷` still says `۱۰۷` and not `107`.
"""

from __future__ import annotations

import re

import d0_board_read

# The three stems, the anchor phrasings, and nothing else. Data, not prose, so the
# word cost of the change is one thing a reader can count rather than infer.
#
# The lead NAMES the routine and the visual; the stems line says only where the
# three lines go and that they are silent. Saying SEE/THINK/WONDER a second time in
# the stems was the first draft and cost six words to repeat the lead.
#
# ENGLISH: 14 words added on a board anchor, 15 on a named page.
# URDU:    13 and 14. Urdu is deliberately the shorter of the two -- see docstring.
PHRASES = {
    "en": {
        "lead": "See–Think–Wonder, on {anchor}.",
        "stems": "Three silent lines in the copy, one for each.",
        "picture": "the picture on p. {n}",
        "page": "textbook p. {n}",
        "board": "the board figure",
    },
    "ur": {
        "lead": "{anchor} پر: دیکھو، سوچو، سوال کرو۔",
        "stems": "کاپی میں تین خاموش سطریں۔",
        "picture": "صفحہ {n} کی تصویر",
        "page": "کتاب کے صفحہ {n}",   # oblique: the lead appends the postposition پر
        "board": "بورڈ کی تصویر",
    },
}

# `p. 127`, `pp. 12`, `page 42`, `Pages 8`, `صفحہ ۱۰۷`. Latin, Arabic-Indic and
# Extended Arabic-Indic digits all captured, and the captured run is what gets
# printed -- so the numeral system the author chose is the one the teacher reads.
# Measured over the 440 enrichment hooks: 155 `p.`, 56 `صفحہ`, 55 `page`, 6 `Page`,
# 5 `pp.`, 4 `pages`; 281 hooks in total carry one.
_PAGE = re.compile(
    r"(?:\bpp?\.\s*|\bpages?\s+|صفحہ\s*)([0-9٠-٩۰-۹]{1,3})",
    re.I,
)

# A picture WORD anywhere in the hook upgrades `textbook p. N` to `the picture on
# p. N`. Deliberately not a claim the module invents: 112 of the 440 hooks say
# picture/image/photo/illustration/تصویر in so many words, and only those 112 get
# told there is a picture to look at. The other 169 page-anchored hooks point at the
# page, which is itself something on the desk, open, in front of the child.
_PICTURE = re.compile(r"\b(picture|image|photo|illustration|drawing)\b|تصویر", re.I)

# The routine, once applied, is recognisable by its own lead. Re-running the pass --
# which `to_lp_doc` does not do, but a caller reordering the D0 passes easily could --
# must not stack a second copy on top of the first.
_ALREADY = re.compile(r"See–Think–Wonder|دیکھو، سوچو، سوال کرو")


def _dialect(medium):
    return PHRASES.get("ur" if (medium or "").lower().startswith("ur") else "en")


def _board_is_visible(board_work):
    """True when this lesson puts something ON the board for the class to look at.

    It asks the READER, not `d0_board_draw`. bd-287sn stopped the figure slot from
    re-printing the board text as SVG, so `board_diagram` now returns None for the
    boards that have no drawable shape -- but those boards are still fully printed,
    by the `board` block in the introduction, and that block is what the class looks
    up at. Keying the anchor off the figure would have silently taken the opening
    routine away from every lesson whose board is words rather than a shape.

    Total, like its caller: a board that throws on the way to being read is a board
    with nothing on it, not a lost lesson.
    """
    try:
        board = d0_board_read.read_board(board_work)
    except Exception:
        return False
    return bool(isinstance(board, dict) and board.get("panels"))


def visual_anchor(g, medium):
    """`(kind, printed phrase)` for the one thing the class will look at, or None.

    `kind` is `"picture"`, `"page"` or `"board"` -- kept out of the printed string so
    the gap report and the corpus count can be read without parsing prose.
    """
    ph = _dialect(medium)
    hook = (g or {}).get("hookStory") or ""
    m = _PAGE.search(hook)
    if m:
        kind = "picture" if _PICTURE.search(hook) else "page"
        return kind, ph[kind].format(n=m.group(1))
    if _board_is_visible((g or {}).get("boardWork")):
        return "board", ph["board"]
    return None


def routine_question(question, anchor_phrase, medium):
    """The hook's authored question, re-seated as the THINK of a See-Think-Wonder.

    The authored text is carried through UNTOUCHED and in the middle: the lead names
    the routine and what to look at, the authored provocation is what they think
    about, and the stems say what goes in the copy. Nothing is deleted or rephrased,
    which is the same contract `d0_hook` holds one step upstream -- this module
    frames, it does not author the question.
    """
    ph = _dialect(medium)
    q = (question or "").strip()
    return " ".join(x for x in (ph["lead"].format(anchor=anchor_phrase),
                                q, ph["stems"]) if x)


def _opening(sections):
    for sec in sections or []:
        if re.search(r"opening", (sec or {}).get("title") or "", re.I):
            return sec
    return None


def _hook_ask(sec):
    for b in sec.get("blocks") or []:
        if isinstance(b, dict) and b.get("type") == "ask" and b.get("hook"):
            return b
    return None


def apply_visual_routine(sections, g, medium):
    """Seat the routine in the Opening's hook ask. Returns `notes.gaps` lines.

    Mirrors `d0_openingpeer.apply_opening_peer_talk`'s contract exactly: find the
    Opening by title, mutate in place, return `[]` when there is nothing to do and a
    list of reasons otherwise. Scoped to the Opening ONLY -- Guided Practice is not
    this module's business, and a second `hook: true` elsewhere in the document would
    be a schema defect for lint to report, not for this pass to silently normalise.
    """
    sec = _opening(sections)
    if sec is None:
        return []
    ask = _hook_ask(sec)
    if ask is None:
        return ["visual thinking routine: no hook ask in the Opening to seat "
                "See-Think-Wonder on; the routine is the provocation, and this "
                "lesson has no provocation block."]
    if _ALREADY.search(ask.get("question") or ""):
        return []
    found = visual_anchor(g, medium)
    if found is None:
        return ["visual thinking routine: this lesson's hook names no textbook page "
                "and its board draws no figure, so there is nothing for the class to "
                "look at. A See-Think-Wonder with no visual is three more questions, "
                "so none was seated."]
    ask["question"] = routine_question(ask.get("question"), found[1], medium)
    return []
