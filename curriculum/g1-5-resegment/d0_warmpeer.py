"""bd-y7hst -- ONE strategy in the warm-up, and never one that pairs children up.

Split out of `d0_warmscript.py` to keep that file under the 300-line limit; the two
selectors here are a self-contained layer on top of its sentence-by-sentence method
scan, and `d0_warmscript._method_from_one`/`_method_and_gaps` are the only callers.

OPERATOR, on stacking: *"look up research and tell me what strategies to add there, it
should be just 1 not multiple strategies since opening is a whole provocation on its
own"*; *"If I see the Opening, there is a strategy, then 3 questions then a hook and
then an open with this question, doesnt make sense what to do and what not to do."* A
shipping example (g1_ch8 Maths seg4) numbered FOUR items in the warm-up box.

OPERATOR, on peer talk: *"teachers dont let students talk to each other, that too when
the class begins ... In large classrooms, its just not possible to do so much in a
class of 40+ students ... all teachers have said they can do only 1 activity per LP."*
The same lesson's warm-up carried "Partner-check before reveal" and "Fact-fluency pair
game: Partner A says a number 1-10; Partner B instantly says a bigger or smaller
number" -- lint gate 10e (`PEER_TALK`, `bot/vendor/lp-v9/lib/peertalk.js`) bans a
sentence that tells a child to talk to a NEIGHBOUR ("do not... tell a neighbour"). It
was never built to catch a POSITIVE description of a paired activity, so these shipped.

TWO INDEPENDENT SELECTORS, both applied per candidate by the caller:

  * `_candidates()` splits a numbered/bulleted script ("1. ... 2. ... 3. ... 4. ...")
    into its stacked items; the caller keeps only the FIRST one that yields a method.
    A script with fewer than two markers is one candidate, itself, unchanged -- checked:
    zero of the 30 live scripts number their items, so this only fires on the shape the
    operator named.
  * `is_banned_move()` matches her named families (Partner A/B, pair/partner-check,
    think-pair-x, turn-and-talk, partner whisper, elbow/shoulder/talking partner, buzz
    groups, discussion circles, group discussion, discuss/tell/ask-your-partner, pair
    games, peer-mediated pair work, the two unbounded queues). The caller treats a hit
    the same way it already treats `_ITEM_RUN`: a banned sentence that OPENS a
    candidate leaves nothing clean to start from (the whole candidate is skipped); one
    that arrives once the method is under way ends the run there.

    Deliberately NOT a bare `\\bpair\\b` / `\\bpartner\\b` / `\\bgame\\b`. Urdu_seg6
    (the live G3 corpus) writes "ایک جوڑا لِکھیں" -- write a (gender) PAIR of words,
    the lesson's own content -- and Maths_seg2 writes "our calm fact-fluency GAME" for
    solo work. Both are live, both are fine, and a bare word would have cut them.

    TARGET REFRESH (bd-y7hst, reopened again): the sibling worker widening peertalk.js
    landed mid-round, moving the gate from 115/83 to 125/86 (items/lessons) and this
    module's remaining miss from 18/18 to 10/8 -- all 10 one family the first pass
    missed: a talk-adjacent verb (read/say/count/compare/point) followed by the bare
    addressee "with a/your/their/the partner", distinct from the "talk to a classmate"
    family above (which only fires on talk-specific verbs). Added as its own entry,
    last in the list, with a negative-lookahead guard so "with a partner's written
    answer" (a possessive modifying an artifact, not an addressee) stays clean --
    verified against all 5 of the operator's protected strings. `d0_warmitems.py`
    additionally strips just this phrase (not the whole segment) before its own
    segment pipeline runs, since choral counting / comparing / reading stays a legal
    whole-class or individual move once the addressee is gone -- see that module's
    docstring.

    URDU, ADDED (bd-y7hst reopened on corpus evidence -- 25 of 88 Urdu lessons carry a
    banned move; this was English-only until then). NOT invented: copied verbatim from
    `bot/vendor/lp-v9/lib/peertalk.js`'s six `lang: 'ur'` entries (lint gate 10e's own
    reviewed vocabulary) at this bead's snapshot of that file -- copied, not imported,
    because another worker is widening that file live and an import would chase a
    moving target across the worktree boundary.

    CLOSED (bd-yjmxh/bd-v2ikv): the two misses previously noted here -- the live
    corpus writing "پارٹنر کو بتائیں" (Partner, transliterated, not `ساتھی`) and
    "اپنے ساتھی کو سنائیں" (tell/recite to your companion) -- are now both banned.
    Mirrored verbatim from peertalk.js's own two new entries: both match the
    VERB-DIRECTED-AT-A-PEER construction (addressee + کو + a سنا/بتا stem), not the
    bare noun, so ساتھی/پارٹنر still appear innocently elsewhere in the corpus without
    tripping either pattern. Not extended to `سمجھا` (explain) -- out of the recite/
    say/tell scope this bead named -- left as a known, undocumented-here gap.

Every candidate a caller drops -- banned, or simply not the one chosen -- gets a
reason from `_gap_banned`/`_gap_extra` for `notes.gaps`, the same house rule an
over-cap method already follows: dropped whole, never silently (d0_diagram, d0_crux).

`one_strategy()`, the corpus-corrected selector over `warmUp.items` (the field that is
actually populated -- `warmUp.script` is empty in all 335 shipping lessons, see
`d0_warmscript.py`'s docstring), lives in `d0_warmitems.py`, one file further down the
same split, and reuses `is_banned_move` from here.
"""

from __future__ import annotations

import re

# Arabic-script marks the live Urdu corpus writes and a plain regex therefore misses:
# `لِکھیں` is spelled with a kasra inside it. Shared with `d0_warmscript`, which imports
# `_bare` from here rather than duplicating it.
_DIACRITICS = re.compile(r"[ً-ْٓ-ٰٟـۖ-ۭ]")


def _bare(s):
    """The string without Arabic vowel marks, for matching only."""
    return _DIACRITICS.sub("", str(s or ""))


# A NUMBERED/BULLETED WARM-UP IS SEVERAL CANDIDATES, NOT ONE METHOD WITH FOUR CLAUSES.
# Matched only at a segment boundary (start of string, or right after a sentence-ending
# stop) so it never fires mid-sentence -- "...5,609 + 34." at the end of a board-write
# item has no following text for the required `\s+` to land on, and "3,989 + 12" has a
# comma, not one of these delimiters, ahead of the digits.
_NEW_ITEM = re.compile(r"(?:^|(?<=[.!?۔؟]\s))(?:\(?[1-9][0-9]?[.):]|[•‣▪◦])\s+")

# HER NAMED FAMILIES. Phrase-level, never a bare `pair`/`partner`/`game` -- see the
# module docstring for the two live false positives (Urdu_seg6's gender-pair
# vocabulary, Maths_seg2's solo fact-fluency game) a bare word would have cut.
#
# WIDENED TO PARITY (bd-y7hst, reopened): ground-truthed against the CURRENT
# `bot/vendor/lp-v9/lib/peertalk.js` `PEER_TALK` (en) list by shelling out to node
# against 18 real corpus items the gate flags and this list missed -- see
# `test_d0_warmpeer.py`'s parity test, which re-checks this against the live file on
# every run rather than trusting a point-in-time copy. Each family below is a direct
# port of peertalk.js's own regex (same source text, `re.I` where it has `/i`, no flag
# where it doesn't -- `Partner A/B` is case-sensitive in BOTH). Two entries at the end
# are a DELIBERATE SUPERSET, not parity: `peer-mediated` and `pair work` are the
# operator's own named terms (see docstring) and neither is in peertalk.js's
# vocabulary; banning extra here is the safe side (over-cut on the banned-move axis is
# accepted), so they stay -- and are excluded from the parity fixture list for exactly
# that reason, since the gate would legitimately disagree on them.
_BANNED_MOVE = [
    re.compile(r"\bpartner[- ]whispers?\b|\bwhisper (?:to|with) (?:a |an |your |their |"
               r"the )?partner\b", re.I),                                    # partner whisper
    re.compile(r"\bwhispers?(?:ing)?[- ](?:count|check|read|partner)\b|"
               r"\bwhispers?(?:ing)?\b[^.!?]{0,45}?\b(?:to|with)\b[^.!?]{0,20}?\b"
               r"(?:partner|neighbou?r|classmate|friend|buddy)s?\b", re.I),  # whisper to a classmate
    re.compile(r"\bturn[- ]and[- ]talk\b|\bturn to (?:a |your |the )?"
               r"(?:partner|neighbou?r|classmate)\b", re.I),                 # turn-and-talk
    re.compile(r"\bthink[- ]pair[- ][a-z]+\b", re.I),                        # think-pair-anything
    re.compile(r"\b(?:pair|partner|peer|buddy)[- ](?:talk|chat|share|sharing|"
               r"discussion)\b", re.I),                                      # pair/partner/peer talk
    re.compile(r"\bgroup[- ](?:talk|chat|discussion)\b|\bdiscussion (?:in|by) "
               r"groups\b", re.I),                                           # group discussion
    re.compile(r"\bdiscussion circles?\b|\bcircle[- ]time discussion\b", re.I),  # discussion circle
    re.compile(r"\b(?:talk|talks|talking|speak|speaks|speaking|chat|chats|chatting)"
               r"\s+(?:quietly |softly |briefly |aloud )?(?:to|with)\s+(?:a |an |your |"
               r"their |the |his |her |each )?(?:partner|neighbou?r|classmate|friend|"
               r"buddy|peer|other|one another)\b", re.I),                    # talk to a classmate
    re.compile(r"\b(?:tell|tells|telling|say it to|share (?:it |your answer |the answer "
               r")?with|read (?:it |your answer )?(?:out )?to)\s+(?:a |an |your |their |"
               r"the |his |her )?(?:partner|neighbou?r|classmate|buddy|peer)\b", re.I),  # tell a classmate
    re.compile(r"\b(?:ask|asks|asking)\s+(?:a |an |your |their |the |his |her |each )?"
               r"(?:partner|neighbou?r|classmate|buddy|peer|other)\b(?!['’]s\b)", re.I),  # ask a classmate
    re.compile(r"\b(?:elbow|shoulder|talking|talk)\s+partners?\b", re.I),    # elbow/shoulder/talking partner
    re.compile(r"\bbuzz\s+(?:group|session|pair)s?\b|\bbuzz\s+(?:with|about)\b", re.I),  # buzz groups
    re.compile(r"\bdiscuss(?:es|ing)?\s+(?:it |this |these |them |the answers? |"
               r"your answers? )?(?:in (?:pairs|groups|threes|fours|twos)|with (?:a |an |"
               r"your |their |the )?(?:partner|neighbou?r|classmate|group|friend))", re.I),  # discuss in pairs
    re.compile(r"\bas many (?:pupils|students|children|kids|hands|answers)?\s*as time "
               r"allows\b|\b(?:go|going|work)\s+(?:a)?round the (?:class|room|circle)\b|"
               r"\bevery child (?:in turn |one by one )?(?:answers|speaks|says it) "
               r"aloud\b", re.I),                                            # unbounded queue
    re.compile(r"\bPartner\s+[AB]\b"),                                       # Partner A/B -- case-sensitive
    re.compile(r"\b(?:pair|partner)[- ]check(?:s|ed|ing)?\b", re.I),         # pair-check / partner-check
    re.compile(r"\bpair[- ]games?\b", re.I),                                 # pair game (plural kept: superset)
    re.compile(r"\bpeers?\s+(?:says?|said|tells?|told|asks?|asked|explains?|"
               r"explained|recites?|recited)\b", re.I),                      # peer (talk verb, subject form)
    re.compile(r"\bpeer[\s-]mediated\b", re.I),                              # peer-mediated pair work (superset)
    re.compile(r"\bpair\s+work\b", re.I),                                    # pair work (superset)
    re.compile(r"\b(?:read|reads|reading|say|says|saying|said|count|counts|counting|"
               r"compare|compares|comparing|point|points|pointing)\b.*?\bwith (?:a|your|"
               r"their|his|her|the) partner\b(?!['’]s)",
               re.I),  # <talk-adjacent verb> ... with a partner -- addressee (bd-y7hst,
               #        target refresh)
]

# NOTE on the entry above: gated on one of the five talk-adjacent verbs preceding the
# phrase (ANY distance -- item 9's "quick count: with a partner, count the text types"
# has "count" ahead of the phrase via its own "quick count" lead-in) rather than a bare
# "with a partner" anywhere in the text. A bare match caught g1_ch10/English_seg6 item 0,
# "With your partner, recall one detail from the earlier Chapter 10 story." -- a
# pre-existing, deliberately DOCUMENTED miss (`test_d0_warmitems.py`'s own comment: "a
# real, unrelated gap ... not silently patched with an invented pattern") that "recall"
# is not talk-adjacent and was never meant to be caught. Verb-gating keeps that fixture
# clean while still matching all 10 refreshed-miss items and all 5 protected strings.

# HER NAMED FAMILIES, URDU. Copied verbatim from `bot/vendor/lp-v9/lib/peertalk.js`'s
# `lang: 'ur'` entries (see module docstring for why copied, not imported, and the two
# real-corpus misses this vocabulary still has).
_BANNED_MOVE_UR = [
    re.compile(r"سرگوشی"),                                                        # whisper
    re.compile(r"ساتھی\s*(?:سے|کے\s*ساتھ|کو)\s*(?:بات|گفتگو|بات\s*چیت)"),          # talk to your companion
    re.compile(r"(?:جوڑی|جوڑے|جوڑوں)\s*میں\s*(?:بات|گفتگو|بات\s*چیت|بولیں|پوچھیں)"),  # pair talk
    re.compile(r"آپس\s*میں\s*(?:بات|گفتگو|بات\s*چیت|بولیں|پوچھیں)"),               # talk among yourselves
    re.compile(r"ایک\s*دوسرے\s*(?:سے|کو)\s*(?:بات|گفتگو|بات\s*چیت|پوچھ|بتائ|سنائ)"),  # talk to each other
    re.compile(r"ساتھی[^۔.]{0,40}زبانی\s*(?:پوچھ|بتائ|کہے|سنائ)"),                 # partner checks aloud
    re.compile(r"ساتھی\s*کو\s*(?:سنا|بتا)"),   # recite/tell TO a companion (bd-yjmxh/bd-v2ikv)
    re.compile(r"پارٹنر\s*کو\s*(?:سنا|بتا)"),  # transliterated partner, told to (bd-yjmxh/bd-v2ikv)
]


def is_banned_move(text):
    """True when this clause is a student-to-student talk move (bd-y7hst), not just
    states the no-talking rule -- that is `d0_warmscript.is_prohibition`, and it is
    cut, not refused whole."""
    t = _bare(text)
    return (any(p.search(t) for p in _BANNED_MOVE) or
            any(p.search(t) for p in _BANNED_MOVE_UR))


def _candidates(text):
    """The script split at its own numbered/bulleted markers.

    A script with fewer than two markers is one candidate: itself, unchanged. This is
    the narrow form of the defect the operator named (g1_ch8 Maths seg4's FOUR
    numbered items); it never fires on the live corpus, which numbers nothing.
    """
    marks = list(_NEW_ITEM.finditer(text))
    if len(marks) < 2:
        return [text]
    head = text[: marks[0].start()].strip()
    starts = [m.end() for m in marks]
    ends = [m.start() for m in marks[1:]] + [len(text)]
    out = []
    for i, (s, e) in enumerate(zip(starts, ends)):
        seg = text[s:e].strip()
        out.append((head + " " + seg).strip() if i == 0 and head else seg)
    return out


def _gap_banned(candidate):
    words = " ".join(candidate.split()[:8])
    return ("warmUp.script's candidate (%r...) is a student-to-student talk move -- "
            "banned peer-to-peer talk, cut, not printed -- bd-y7hst." % words)


def _gap_extra(ordinal, total, candidate):
    words = " ".join(candidate.split()[:8])
    return ("warmUp.script carries %d stacked candidates; the warm-up seats exactly "
            "ONE strategy, so candidate %d (%r...) is dropped whole, not stacked -- "
            "bd-y7hst." % (total, ordinal, words))
