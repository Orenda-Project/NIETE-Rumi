# -*- coding: utf-8 -*-
"""Every question the lesson puts to the class, and whether it is answered.

Teachers' No.1 written complaint about the v8 plans is that answers are
UNFINDABLE -- not wrong, not absent, unfindable. bd-ieesv measured it on the
23,437-row `lp_feedback` census: of the 576 v8-segment dislikes that name
their segment, answers are the largest single content theme, and the words
teachers use are 'tlash krna' and 'ڈھونڈنے میں وقت ضائع' -- searching, time
wasted finding. They ask for the legacy v7 plans back, but those were not an
answer-key product either: 1,619 of their 1,780 'Ans' steps (91%) said things
like 'Let the children answer.' What the legacy format had was a VISIBLE SLOT
in a predictable position -- an 'Ans' line directly beneath every 'Ask'.

So the check asks one thing of a Stage-C body: for each question the lesson
puts to the class, is there an answer the teacher can reach without
searching? Three modules answer it, split where the questions differ.
`answersites` knows WHERE the lesson asks -- schema knowledge, held as
explicit allowlists. `answerwords` knows whether a slot HOLDS an answer or
only occupies the space, which is the difference between this revamp and the
legacy product. This module joins them: it resolves a prose question to its
`asks[]` entry, and reports what is left over.

`resolve` is the only part with any give in it. A question written in a
`say` line and repeated in `asks[]` will not be repeated character for
character -- the author drops a 'So,' or a 'Class,' -- so `_key` strips that
leading filler and the lookup falls back to containment either way. The
alternative, exact match, fails an author who did the work, which teaches
the author to stop doing it.

Measured on the 44 bodies authored to the v3 brief: 688 questions put to the
class, 281 answered, 407 not -- a median of 8 per lesson, in 43 of the 44.
`failures` is what stops that reaching a teacher.
"""
import re

import answersites
import answerwords

#: Leading filler an author puts in front of a question in a `say` line, and
#: which the matching `asks[]` entry will not repeat.
_LEAD = re.compile(
    u"^(?:so|now|ok|okay|right|then|and|but|class|children|everyone|"
    u"tell me|look|اب|اور|تو)\\b[\\s,:-]*",
    re.I)


def _key(text):
    """A question reduced to what makes it the same question."""
    s = answerwords.norm(text).lower()
    s = _LEAD.sub("", s)
    return s.strip(u" ,:;-—–" + answersites.MARKS)


def _index(body):
    """The `asks[]` table, keyed by question, for the prose sites."""
    table = {}
    for entry in (body or {}).get("asks") or []:
        if isinstance(entry, dict) and entry.get("ask"):
            table[_key(entry["ask"])] = entry.get("answer")
    return table


def resolve(body, ask, table=None):
    """The answer reaching this question, or None."""
    if ask["answer"] is not None:
        return ask["answer"]
    table = _index(body) if table is None else table
    k = _key(ask["text"])
    if k in table:
        return table[k]
    for other, answer in table.items():
        if other and (other in k or k in other):
            return answer
    return None


def missing(body):
    """The questions a teacher would have to search for, or invent."""
    table = _index(body)
    out = []
    for ask in answersites.questions(body):
        if not answerwords.is_answer(resolve(body, ask, table)):
            out.append(ask)
    return out


def report(body):
    """Counts for the gate, plus the question sites nobody has classified."""
    asked = answersites.questions(body)
    gone = missing(body)
    return {"asked": len(asked),
            "answered": len(asked) - len(gone),
            "missing": len(gone),
            "share_missing": (float(len(gone)) / len(asked)) if asked else 0.0,
            "sites": sorted(set(a["where"] for a in gone)),
            "unclassified": answersites.coverage(body)}


#: Questions quoted in a finding. Enough to find the place in the JSON
#: without turning one finding into the lesson.
QUOTED = 3


def _body(lp):
    """The v9 body, whether the caller handed the artefact or the body.

    `judgerun` passes the whole envelope and `gate4`'s own fixtures pass a
    bare body. `contentbudget` had to accept both for the same reason; a
    check that reads only one shape silently passes every lesson arriving in
    the other.
    """
    d = lp or {}
    return d.get("generated") or d


def failures(lp):
    """`gate4`-shaped findings: the questions a teacher cannot answer.

    Pure, and handed to `gate4.compose` by its caller exactly as
    `contentbudget.failures` is, so the gate keeps one way of receiving a
    body-level check and this module never imports the gate.

    An unclassified site short-circuits the count deliberately. A question
    site this module does not know about is one it did not look at, so the
    missing-answer count below it would be an undercount reported as a
    measurement. Naming the path instead says what actually happened.
    """
    body = _body(lp)
    unknown = answersites.coverage(body)
    if unknown:
        return [{"id": "A2",
                 "name": "the answer check does not know these question "
                         "sites, so it cannot say the lesson's questions are "
                         "answered: %s — classify each in answersites.PROSE, "
                         "PAIRED or NOT_ASKED" % ", ".join(unknown)}]
    gone = missing(body)
    if not gone:
        return []
    counts = {}
    for ask in gone:
        counts[ask["where"]] = counts.get(ask["where"], 0) + 1
    where = ", ".join("%s (%d)" % (w, n) for w, n in
                      sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))
    quoted = "; ".join(u"“%s”" % a["text"] for a in gone[:QUOTED])
    return [{"id": "A1",
             "name": u"%d of %d questions the lesson puts to the class carry "
                     u"no answer a teacher could mark from — %s. e.g. %s"
                     % (len(gone), len(answersites.questions(body)), where, quoted)}]
