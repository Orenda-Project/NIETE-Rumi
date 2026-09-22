# -*- coding: utf-8 -*-
"""What to ask the author for, and what to hand them to answer with.

bd-eakp8. The target list is NOT the gate's failure list, and the
difference is deliberate. `answerslot` fails a lesson for a question it
does not answer, which is a question mark it can see. Brief v4 makes four
slots mandatory whether or not anything ends in a question mark, because 48
of the 56 dark `problems[]` prompts are imperatives -- 'Add 24 + 18.' --
and the teacher marking that page has exactly as little to mark against.
Asking only for what the gate can see would leave those 48 dark and call
the pass finished.

`keys` is the supply side. Rule 32 of v4 says fill from the book and never
invent, so the request carries the page truth's own answer keys. Coverage
across the 17 ICT books is 90.2%, but 163 of those keys sit under a name
the schema never settled on -- `solved_answer`, `answer_computed`,
`correct_answer`, and a tail of some thirty more -- so reading only
`answer_key` drops them and teaches the author to make something up. Five
field names match the same pattern and are not keys at all; `resolution`
is the one that catches a naive substring test.

`request` is generated from the target list rather than kept as a template,
so it can only ever ask for slots `answerfix` will accept.
"""
import json
import re

import answerfix
import answerslot
import answerwords

#: Question sites repaired by migrating `warmUp.items[]` to {ask, answer},
#: rather than through the body's `asks[]` table.
_WARM = ("warmUp.items[]", "warmUp.items[].prompt")

#: A field holding an answer key in the page truth.
_KEYISH = re.compile("answer|solution", re.I)

#: Field names that match `_KEYISH` and are not keys. `resolution` is why
#: the test is a denylist and not a substring check.
_NOT_KEYS = frozenset(("answer_confidence", "resolution"))

#: Where a key hides when it is not on the exercise itself: `answer_key`
#: sits on exercises[].items[] 217 times and below that 5 more.
_NESTED = ("items", "sub_items", "questions")


def _question(item):
    return answerfix._question(item)


def targets(body):
    """Every slot v4 requires filled and this lesson has not filled."""
    body = body or {}
    out = {"asks": [], "warmUp.items": [], "exitTicket.answer": None,
           "problems[].solution": {}, "steps[].cfu.pass_signal": {}}

    gone = [a for a in answerslot.missing(body) if a["where"] not in _WARM]
    if gone:
        # `answerfix` replaces the whole `asks[]` table and refuses a patch
        # that loses an entry, so an already answered question has to come
        # back with it -- answer echoed, not reworded.
        for old in body.get("asks") or []:
            if isinstance(old, dict) and answerwords.is_answer(old.get("answer")):
                out["asks"].append({"where": "asks[]", "text": old.get("ask"),
                                    "answer": old["answer"]})
        for ask in gone:
            out["asks"].append({"where": ask["where"], "text": ask["text"],
                                "answer": None})

    wu = body.get("warmUp")
    items = (wu or {}).get("items") if isinstance(wu, dict) else None
    if isinstance(items, list) and items:
        held = [answerfix._held(i) for i in items]
        if any(h is None for h in held):
            out["warmUp.items"] = [{"ask": _question(i), "answer": h}
                                   for i, h in zip(items, held)]

    et = body.get("exitTicket")
    if isinstance(et, dict) and et.get("task") \
            and not answerwords.is_answer(et.get("answer")):
        out["exitTicket.answer"] = et["task"]

    for i, p in enumerate(body.get("problems") or []):
        if isinstance(p, dict) and p.get("prompt") \
                and not answerwords.is_answer(p.get("solution")):
            out["problems[].solution"][str(i)] = p["prompt"]

    for i, s in enumerate(body.get("steps") or []):
        cfu = s.get("cfu") if isinstance(s, dict) else None
        if isinstance(cfu, dict) and cfu.get("question") \
                and not answerwords.is_answer(cfu.get("pass_signal")):
            out["steps[].cfu.pass_signal"][str(i)] = cfu["question"]
    return out


def wanted(body, t=None):
    """The patch keys this lesson needs, in `answerfix.WRITABLE` order."""
    t = targets(body) if t is None else t
    return tuple(k for k in answerfix.WRITABLE if t.get(k))


def _key_of(ex):
    """The answer key on one exercise, under whatever name it was given."""
    for name in sorted(ex):
        if name in _NOT_KEYS or not _KEYISH.search(name):
            continue
        val = ex[name]
        if isinstance(val, str) and val.strip():
            return val.strip()
    for name in _NESTED:
        for sub in ex.get(name) or []:
            if isinstance(sub, dict):
                got = _key_of(sub)
                if got:
                    return got
    return None


def keys(pages):
    """The page truth's own answers, one row per exercise that has one."""
    out = []
    for page in pages or []:
        if not isinstance(page, dict):
            continue
        num = (page.get("printed_page_number")
               or page.get("printed_page") or page.get("page"))
        for ex in page.get("exercises") or []:
            if not isinstance(ex, dict):
                continue
            answer = _key_of(ex)
            if not answer:
                continue
            out.append({"page": num, "label": ex.get("label") or "",
                        "instruction": ex.get("instruction_verbatim") or "",
                        "answer": answer,
                        "confidence": ex.get("answer_confidence") or ""})
    return out


_SHAPES = {
    "asks": u'"asks": [{"ask":"<the question, copied word for word>",'
            u'"answer":"<the answer>"}, ...]',
    "warmUp.items": u'"warmUp.items": [{"ask":"<copied word for word>",'
                    u'"answer":"<the answer>"}, ...] — every item, in order',
    "exitTicket.answer": u'"exitTicket.answer": "<the worked answer>"',
    "problems[].solution": u'"problems[].solution": {"<index>":'
                           u'"<full worked solution>", ...}',
    "steps[].cfu.pass_signal": u'"steps[].cfu.pass_signal": {"<index>":'
                               u'"<what a child who has it says or does>", ...}',
}

_RULES = u"""RULES
1. Answer the question the lesson already asks. Do not reword the question,
   the script, the story or anything else — a patch that changes a lesson is
   rejected whole and this lesson is left unrepaired.
2. Fill from THE BOOK above wherever it answers the item. Never invent a key
   the book does not support.
3. Where the answer genuinely varies, say so AND say what to accept:
   "answers vary — accept any <X> that <Y>". Never leave it blank.
4. Never write "Let the children answer", "Take responses", "Check their
   work" or any phrase that fills the slot without answering it. That is the
   legacy product teachers are complaining about.
5. Return ONE JSON object and nothing else — no prose, no code fence."""


def _fill(t, paths):
    lines = [u"FILL"]
    for path in paths:
        got = t[path]
        lines.append(u"")
        lines.append(u"%s — %s" % (path, _SHAPES[path]))
        if path == "asks":
            for a in got:
                lines.append(u"  · %s: “%s”%s" % (
                    a["where"], a["text"],
                    u"  (already answered: “%s” — copy it unchanged)"
                    % a["answer"] if a.get("answer") else u""))
        elif path == "warmUp.items":
            for i, item in enumerate(got):
                lines.append(u"  · [%d] “%s”%s" % (
                    i, item["ask"],
                    u"  (already answered: “%s” — copy it unchanged)"
                    % item["answer"] if item["answer"] else u""))
        elif path == "exitTicket.answer":
            lines.append(u"  · the task is: “%s”" % got)
        else:
            for i in sorted(got, key=int):
                lines.append(u"  · [%s] “%s”" % (i, got[i]))
    return u"\n".join(lines)


def request(body, keys=None, book=""):
    """The repair prompt, or "" when the lesson needs no repair."""
    t = targets(body)
    paths = wanted(body, t)
    if not paths:
        return ""
    parts = [
        u"You are repairing ONE lesson plan. It is a good lesson and it is "
        u"staying as it is. What it does not do is answer the questions it "
        u"puts to the class, which is the single most common written "
        u"complaint teachers make about these plans.",
        u"",
        u"Return ONLY a JSON object with exactly these keys: %s."
        % u", ".join(paths),
        u"Any other key is rejected and the lesson is left unrepaired.",
        u"", u"THE LESSON%s" % (u" (%s)" % book if book else u""),
        json.dumps(body, ensure_ascii=False, indent=1, sort_keys=True),
    ]
    rows = keys or []
    if rows:
        parts += [u"", u"THE BOOK — the printed pages' own answer keys"]
        for k in rows:
            parts.append(u"p%s %s — %s → %s%s" % (
                k.get("page"), k.get("label") or "",
                (k.get("instruction") or "")[:160], k["answer"],
                u"  [%s]" % k["confidence"] if k.get("confidence") else u""))
    parts += [u"", _fill(t, paths), u"", _RULES]
    return u"\n".join(parts)
