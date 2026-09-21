# -*- coding: utf-8 -*-
"""Does this string answer a question, or only occupy the slot?

Split out of `answerslot` because it is a different question from that
module's. `answerslot` knows WHERE the lesson asks; this knows whether what
sits beside the ask is something a teacher could mark a child's work from.

The distinction is the whole point of bd-ieesv. The legacy v7 plans teachers
ask to have back DID have an 'Ans' line under every 'Ask' -- and 1,619 of
their 1,780 'Ans' steps (91%) said 'Let the children answer.' A presence
check passes all 1,780 and reproduces the product teachers are complaining
about, so presence is not the contract. `PLACEHOLDERS` is that vocabulary,
named so the checker cannot be satisfied by it.

`VARY` is the honest case and needs the opposite treatment. Some questions
really do have no single answer, and forcing one would make the plan lie.
'answers vary' alone still leaves the teacher with nothing to mark against,
so it counts only when it goes on to say what to accept -- `MIN_CRITERION`
characters of it. Dark stages stay dark: an honest slot beats an empty one,
and neither is a fabricated key.
"""
import re

_WS = re.compile(r"\s+")

#: The legacy 'Ans' vocabulary -- 91% of the plans teachers ask to have back.
PLACEHOLDERS = (
    u"let the children answer",
    u"take children's responses",
    u"take childrens responses",
    u"children's own answers",
    u"childrens own answers",
    u"students will answer",
    u"student responses",
    u"accept any answer",
    u"as per student",
    u"various answers",
    u"open ended",
    u"open-ended",
    u"tbd",
    u"n/a",
)

#: 'answers vary' is honest only when it says what to accept.
VARY = (u"answers vary", u"answer varies", u"answers will vary",
        u"answers may vary", u"جواب مختلف")

#: Characters of 'accept any X that Y' that have to follow the vary phrase.
MIN_CRITERION = 15


def norm(text):
    """One line of whitespace, so a wrapped slot reads the same as a short one."""
    return _WS.sub(" ", (text or "").strip())


def is_answer(text):
    """True when a teacher could mark a child's work from this."""
    s = norm(text)
    if not s:
        return False
    # A slot holding only punctuation -- an em dash, a row of dots, a lone
    # question mark -- reads on the page as filled and says nothing the
    # teacher can mark against. A true/false key writes 'True' or 'درست'.
    if not any(ch.isalnum() for ch in s):
        return False
    low = s.lower()
    for v in VARY:
        i = low.find(v)
        if i >= 0:
            tail = s[i + len(v):].strip(u" —–-:;,.")
            return len(tail) >= MIN_CRITERION
    stripped = low.strip(" .!:;,")
    for p in PLACEHOLDERS:
        if stripped == p or stripped.startswith(p):
            return False
    return True
