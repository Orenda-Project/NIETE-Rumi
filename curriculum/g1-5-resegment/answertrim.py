# -*- coding: utf-8 -*-
"""Shorten an answer that is longer than it needs to be. Nothing else.

bd-sk3zr. Three Maths lessons are over `wordbudget`'s 350-word practice cap
and have no day to split into: their practice items cite pages no other day
in the chapter teaches, or cite no page at all. `practicesplit` refuses them,
correctly. What is left is the editorial fix -- the overrun is concentrated
in a handful of answers that ran to eighty, a hundred, a hundred and thirty
words, and those are guidance about what to accept, not the answer itself.

The danger is the reason this is a module and not an edit. The overruns exist
because bd-eakp8 wrote the missing answers IN; shortening by hand is one slip
away from shortening the answer back OUT, which re-opens the complaint the
repair was for. So a trim here is defined by what it may not do:

  * only `problems[].solution` moves -- not a prompt, not a warm-up, not a
    single character anywhere else in the body;
  * the new text must be SHORTER, because a trim that grows the block is not
    a trim and the caller has misread which slot they were editing;
  * it must still satisfy `answerwords.is_answer`, so "answers vary" cannot
    be left bare where a criterion used to stand; and
  * it must introduce NO number the original did not contain. This is the
    load-bearing one. Dropping an illustrative example is editorial; writing
    "under Rs. 60" where the page says Rs. 50 is a wrong answer printed in a
    teacher's hand, and no reviewer downstream reads the arithmetic.

`answerfix.apply` cannot do this: its refusals include overwriting a slot
that already holds a usable answer, and every slot here holds one. That
refusal is right for a repair pass and exactly wrong for a trim, which is
why the two live apart rather than sharing a flag.
"""
import copy
import re

import answerwords

#: Every run of digits is a number. `4:10` is two (four and ten), `p.95` is
#: one; neither reading matters, because the test is only whether the trim
#: says a number the original did not.
_NUM = re.compile(r"\d+")


class Refused(Exception):
    """The trim was not made, and the message says which rule stopped it."""


def numbers(text):
    """Every number in `text`, as a set of digit strings."""
    return set(_NUM.findall(text or ""))


def words(text):
    """Words of prose, counted the way `wordbudget` counts them."""
    return len((text or "").split())


def trim(body, patch):
    """`body` with the named solutions shortened, or `Refused` with why.

    `patch` is {problem index: the shorter answer}. The body is copied, so a
    refusal leaves the caller holding exactly what it passed in.
    """
    problems = (body or {}).get("problems") or []
    if not problems:
        raise Refused("the body has no practice problems to trim")
    if not patch:
        raise Refused("the patch is empty -- there is nothing to trim")
    out = copy.deepcopy(body)
    for key in sorted(patch, key=lambda k: u"%s" % (k,)):
        if not isinstance(key, int) or isinstance(key, bool):
            raise Refused("%r is not a problem index -- a trim names the "
                          "problem by its position, nothing else" % (key,))
        if not 0 <= key < len(problems):
            raise Refused("problem %d is not in the %d problems this lesson "
                          "has" % (key, len(problems)))
        old = problems[key].get("solution") or ""
        new = patch[key]
        if not answerwords.is_answer(old):
            raise Refused("problem %d holds no answer to trim -- an empty "
                          "slot is `answerfix`'s work, not this pass's"
                          % (key,))
        if words(new) >= words(old):
            raise Refused("problem %d would go from %d words to %d -- a trim "
                          "is shorter than what it replaces"
                          % (key, words(old), words(new)))
        if not answerwords.is_answer(new):
            raise Refused("problem %d's new text is not an answer a teacher "
                          "could mark from: %r" % (key, new[:60]))
        invented = sorted(numbers(new) - numbers(old))
        if invented:
            raise Refused("problem %d's new text says %s, which the original "
                          "answer never did -- a trim drops words, it does "
                          "not change what is true"
                          % (key, ", ".join(invented)))
        out["problems"][key]["solution"] = new
    _verify(body, out, patch)
    return out


def _verify(before, after, patch):
    """Redundant proof that the ONLY thing that moved was those answers.

    Every rule above is a rule about one slot. This one is about the whole
    document, and it is deliberately not derived from them: it rebuilds the
    original by putting the old answers back, and refuses unless what comes
    out is character-for-character what went in. A bug in the loop above
    that touched a prompt, dropped a problem or reordered a key stops here.
    """
    rebuilt = copy.deepcopy(after)
    for key in patch:
        rebuilt["problems"][key]["solution"] = \
            (before["problems"][key].get("solution") or "")
    if rebuilt != before:
        raise Refused("the trim moved something other than the answers it "
                      "was given -- refusing to return it")
