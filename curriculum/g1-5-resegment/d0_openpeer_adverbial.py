"""bd-mi5b6 -- phrase-level excision of adverbial peer-talk in the Opening.

`d0_openingpeer` removes a banned move by dropping whole SENTENCES: its
`_segments` splits on [.!?:] and dashes, so a comma-delimited adverbial phrase
never becomes its own segment. "With a partner, recall one idea from the
previous Chapter 10 lesson." is therefore ONE segment, the whole field flags as
banned, and it falls out at `whole_field_banned_no_safe_removal` unchanged.
38 of 335 lessons survived the filter that way.

This module handles the phrase, not the sentence. "with a partner" in these
strings is an ADDRESSEE adjunct -- delete it and a complete whole-class
instruction remains, which is exactly the move the operator asked for. It also
walks `section["warmup"]["items"]`, which no pipeline has ever visited; 45 of
the 53 corpus adverbial strings live there.

WHAT IT REFUSES TO TOUCH, and why the guards are this blunt: a teacher who
reads "work alone" and then sees "with a partner" printed on the page in front
of her stops trusting the plan. A mangled sentence is a worse failure than a
residual gate hit, so anything carrying quoted dialogue, a textbook report,
maths jargon where "partner" is a matching VALUE, or that would be left as a
stub is passed through untouched and REPORTED instead. It never invents prose.
"""

from __future__ import annotations

import re

from d0_warmpeer import is_banned_move

_DET = r"(?:a|an|your|their|his|her|the|one|another)"
_PEER = r"(?:partner|classmate|buddy|peer)s?(?!['\u2019]s)"

# "With a partner, <instruction>" -- the phrase leads and a comma closes it.
_LEAD = re.compile(r"^\s*with\s+" + _DET + r"\s+" + _PEER + r"\s*,\s*", re.I)
# "<instruction> with a partner." / "... to your partner;" -- trailing or mid.
_INLINE = re.compile(r"\s*,?\s+(?:with|to)\s+" + _DET + r"\s+" + _PEER + r"\b", re.I)
_ANY_PEER = re.compile(_PEER, re.I)
# A clause whose SUBJECT is the peer ("Partner repeats the writing idea...",
# "Your partner confirms it only if it is correct."). There is no adjunct to
# excise here, so these can only ever be reported, never repaired.
_ROLE_SUBJECT = re.compile(
    r"(?:^|[.!?;:]\s+)(?:the\s+|your\s+)?" + _PEER + r"\b", re.I)

# A field that reports what the BOOK says is gapped, never rewritten. It has to
# be a reporting construction: a bare `\btextbook\b` also shielded strings that
# merely name the book as a place to look ("...in your earlier notes or
# textbook"), which left partner-whisper standing in the Opening.
_TEXTBOOK_FRAME = re.compile(
    r"\b(?:show|showing|shows|open|opens|opening)\s+(?:the\s+|your\s+)?textbook\b"
    r"|\btextbook\s+(?:pp?\.?\s*\d|pages?\b|asks|says|shows|reads)\b"
    r"|\bthe\s+(?:page|book)\s+(?:asks|says)\b"
    r"|\bp\.\s*\d+\s+(?:asks|says)\b",
    re.I)
# Straight and curly quotes both mark reported speech.
_QUOTE_CHARS = "\"'‘’“”"
# Beyond this a field is narration, not a one-line instruction.
_MAX_INSTRUCTION_CHARS = 220
# A clause left with fewer words than this is a stub, not an instruction.
_MIN_CLAUSE_WORDS = 3
_CLAUSE_SPLIT = re.compile(r"[.!?;:۔؟]+")
# "p. 150", "p.110", "2.5" -- an abbreviation or decimal point is not a
# sentence end, and treating it as one made the stub guard refuse good
# excisions. Neutralised in the PROBE only; the output keeps its spelling.
_ABBREV_NUM = re.compile(r"\b(?:pp?|no|fig|ch|vol|q)\.(?=\s*\d)", re.I)
_DECIMAL = re.compile(r"(?<=\d)\.(?=\d)")

# Belt-and-braces. Every string here is already caught by a guard above; they
# are named so a future regex loosening cannot silently start eating them.
#   g1_ch9/Maths_seg3  -- "partner" is the matching clock VALUE, not a child.
#   g2_ch8/English_seg6, g4_ch8/Science_seg1 -- story narration; seg1 carries a
#   live "with your partner, guess" with NO textbook framing, so only the
#   quoted-dialogue guard stands between it and a mangled hook.
_NEVER_TOUCH_FRAGMENTS = (
    "whole-hour partner",
    "digital-time partner",
    "Pinky says:",
    "Gul Rukh",
)


def _looks_like_narration(text: str) -> bool:
    if len(text) > _MAX_INSTRUCTION_CHARS:
        return True
    if any(ch in text for ch in _QUOTE_CHARS):
        return True
    if _TEXTBOOK_FRAME.search(text):
        return True
    return any(frag in text for frag in _NEVER_TOUCH_FRAGMENTS)


def _every_clause_survives(text: str) -> bool:
    """False if the excision left a stub like a bare 'Agree.'."""
    probe = _DECIMAL.sub("", _ABBREV_NUM.sub("", text))
    for clause in _CLAUSE_SPLIT.split(probe):
        if clause.strip() and len(clause.split()) < _MIN_CLAUSE_WORDS:
            return False
    return True


def _recase(text: str) -> str:
    text = " ".join(text.split())
    if text and text[0].islower():
        text = text[0].upper() + text[1:]
    return text


def strip_adverbial(text):
    """(new_text, changed). Removes an addressee adjunct, or changes nothing."""
    if not isinstance(text, str) or not text:
        return text, False
    if not _ANY_PEER.search(text) or _looks_like_narration(text):
        return text, False

    working, n = _LEAD.subn("", text, count=1)
    if n:
        working = _recase(working)
    working = _INLINE.sub("", working)
    working = " ".join(working.split())

    if working == text or not working:
        return text, False
    # Refuse anything that leaves a stub, still trips the ban, or lost a
    # delimiter on the way out.
    if not _every_clause_survives(working):
        return text, False
    if is_banned_move(working):
        return text, False
    if working.count("(") != working.count(")"):
        return text, False
    return working, True


def needs_review(text):
    """True if this Opening string carries peer talk THIS module is responsible
    for. Deliberately NOT `is_banned_move` alone: that selector keys on
    talk-specific verbs ("turn to your partner and discuss") and by design does
    not fire on the bare adverbial adjunct, which is precisely why the 38
    lessons in bd-mi5b6 walked through the existing filter untouched."""
    if not isinstance(text, str) or not text:
        return False
    return bool(_LEAD.search(text) or _INLINE.search(text)
                or _ROLE_SUBJECT.search(text) or is_banned_move(text))


def _gap(path: str, text: str) -> str:
    words = " ".join(text.split()[:10])
    return ("Opening/%s (%r...) banned peer move with no safe phrase-level "
            "removal; left unchanged rather than rewritten "
            "-- bd-mi5b6 opening adverbial filter." % (path, words))


def _opening_section(sections):
    for sec in sections or []:
        if not isinstance(sec, dict):
            continue
        if str(sec.get("id") or "") == "activity":
            continue  # Guided Practice is exempt by operator ruling.
        if re.search(r"opening", str(sec.get("title") or ""), re.I):
            return sec
    return None


def apply_warmup_peer_talk(sections):
    """Filter the Opening warm-up items. Mirrors `apply_opening_peer_talk`."""
    gaps = []
    section = _opening_section(sections)
    if section is None:
        return gaps
    warmup = section.get("warmup")
    if not isinstance(warmup, dict):
        return gaps
    items = warmup.get("items")
    if not isinstance(items, list):
        return gaps
    for ii, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        for key in ("q", "a"):
            val = item.get(key)
            if not needs_review(val):
                continue
            new_val, changed = strip_adverbial(val)
            if changed:
                item[key] = new_val
            else:
                gaps.append(_gap("warmup.items[%d].%s" % (ii, key), val))
    return gaps
