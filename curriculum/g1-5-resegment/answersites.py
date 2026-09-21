# -*- coding: utf-8 -*-
"""Where a Stage-C lesson puts a question to the class.

Split out of `answerslot` because this is schema knowledge and that is a
check. Everything here is an explicit allowlist of field paths, which is
what makes the check honest and also what makes it fragile: a field the
schema grows later is neither read nor complained about, and that is the one
way the check could pass a lesson it should have failed.

`coverage` closes that. It walks the body generically and names any path
holding a question mark that none of the three lists knows, so a schema
growth surfaces as a line to read rather than as a silent pass. Measured on
the 44 authored bodies it comes back empty, which is the evidence the lists
are currently complete -- not a reason to stop looking.

The three lists divide the body three ways. `PAIRED` is a question whose
answer the schema gives a home beside it. `PROSE` is a question asked inside
a teacher script, resolved through the body's `asks[]` table. `NOT_ASKED` is
everything the class is never asked: the teacher's own reflection, the
rhetorical self-prediction, a child's line to another child, and the answer
fields themselves. A question on that last list must NOT be given an answer;
demanding one would make an author invent it.
"""
import re

import answerwords

#: Class-facing sites that carry their own answer, and the sibling key that
#: holds it. These are the only two the v3 schema gave a container to.
PAIRED = {
    "steps[].cfu.question": "pass_signal",
    "problems[].prompt": "solution",
    "exitTicket.task": "answer",
    "warmUp.items[].ask": "answer",
}

#: Class-facing sites that ask in prose and are resolved through `asks[]`.
PROSE = (
    "steps[].say",
    "warmUp.script",
    "warmUp.items[]",
    "warmUp.items[].prompt",
    "boardWork.content",
    "boardWork.instruction",
    "workedExample",
    "hookStory",
    "challengeExtension",
    "weakLearnerSupport",
    "cfuExplain",
    "cfuPractice",
)

#: Questions that are not put to the class: the teacher asking herself, the
#: rhetorical self-prediction prompt, a child's line to another child, and
#: the answer fields themselves.
NOT_ASKED = (
    "coachingReflection",
    "notes[]",
    "steps[].flex_note",
    "steps[].cfu.if_struggle",
    "steps[].cfu.pass_signal",
    "exitTicket.self_prediction",
    "exitTicket.success_criteria",
    "problems[].solution",
    "exitTicket.answer",
    "warmUp.items[].answer",
    "hookCharacters[].speechBubble",
    "nextTopicPreview",
    "bigIdea",
    "keyFact",
    "circulateInstruction",
    "questions[].childText",
    "asks[].ask",
    "asks[].answer",
)

#: Anything under these prefixes is child-to-child or teacher stage business.
NOT_ASKED_PREFIX = ("partnerActivity", "subject_elements", "instance_ledger")

MARKS = u"?؟"                      # ASCII and Arabic question marks
_ENDS = u".!۔؛\n" + MARKS     # sentence terminators incl. Urdu ۔ ؛
_SPLIT = re.compile(u"(?<=[%s])" % re.escape(_ENDS))
def _sentences(text):
    """The question sentences in a prose string, in order."""
    out = []
    for part in _SPLIT.split(text or ""):
        part = answerwords.norm(part)
        if part and part[-1] in MARKS:
            out.append(part)
    return out


def _ask(where, text, answer):
    return {"where": where, "text": text, "answer": answer}


def _prose(where, text, out):
    for q in _sentences(text):
        out.append(_ask(where, q, None))


def _paired(where, text, holder, out):
    """A question whose answer sits in a sibling key of the same dict."""
    sib = holder.get(PAIRED[where]) if isinstance(holder, dict) else None
    for q in _sentences(text):
        out.append(_ask(where, q, sib))
    if not _sentences(text) and answerwords.norm(text):
        # A task phrased as an imperative ('Add 24 + 18.') is still put to
        # the class and still needs its answer, but it is not a question and
        # the complaint is about questions. Left alone deliberately.
        pass


def questions(body):
    """Every question the body puts to the class, answered or not."""
    out = []
    body = body or {}

    wu = body.get("warmUp") or {}
    if isinstance(wu, dict):
        _prose("warmUp.script", wu.get("script"), out)
        for item in wu.get("items") or []:
            if isinstance(item, dict):
                if item.get("ask"):
                    _paired("warmUp.items[].ask", item["ask"], item, out)
                _prose("warmUp.items[].prompt", item.get("prompt"), out)
            else:
                _prose("warmUp.items[]", item, out)

    for step in body.get("steps") or []:
        if not isinstance(step, dict):
            continue
        _prose("steps[].say", step.get("say"), out)
        cfu = step.get("cfu")
        if isinstance(cfu, dict) and cfu.get("question"):
            _paired("steps[].cfu.question", cfu["question"], cfu, out)

    for prob in body.get("problems") or []:
        if isinstance(prob, dict) and prob.get("prompt"):
            _paired("problems[].prompt", prob["prompt"], prob, out)

    et = body.get("exitTicket")
    if isinstance(et, dict) and et.get("task"):
        _paired("exitTicket.task", et["task"], et, out)

    bw = body.get("boardWork")
    if isinstance(bw, dict):
        _prose("boardWork.content", bw.get("content"), out)
        _prose("boardWork.instruction", bw.get("instruction"), out)

    for field in ("workedExample", "hookStory", "challengeExtension",
                  "weakLearnerSupport", "cfuExplain", "cfuPractice"):
        v = body.get(field)
        if isinstance(v, str):
            _prose(field, v, out)

    return out


#: Every path the three lists between them account for.
KNOWN = frozenset(PAIRED) | frozenset(PROSE) | frozenset(NOT_ASKED)


def _walk(node, path, out):
    """Every path in the body whose string value holds a question mark."""
    if isinstance(node, dict):
        for key, value in node.items():
            _walk(value, (path + "." + key) if path else key, out)
    elif isinstance(node, list):
        for item in node:
            _walk(item, path + "[]", out)
    elif isinstance(node, str):
        for mark in MARKS:
            if mark in node:
                out.append(path)
                return


def coverage(body):
    """Question sites neither list knows -- the guard against a rotted list.

    A path here is not a defect in the lesson; it is a defect in this
    module's picture of the schema, and the author of the next field is the
    person who should see it.
    """
    found = []
    _walk(body or {}, "", found)
    return sorted(set(p for p in found
                      if p not in KNOWN
                      and not p.startswith(NOT_ASKED_PREFIX)))
