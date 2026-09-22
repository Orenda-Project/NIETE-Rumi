# -*- coding: utf-8 -*-
"""Fill a lesson's empty answer slots, and refuse to change anything else.

bd-eakp8. The 44 Stage-C bodies authored to brief v3 pass grounding,
Bloom's, the content budget and the judge; what 43 of them do not do is
answer the questions they put to the class. That is a missing FIELD, not a
wrong lesson, so this is a repair and the patch shape is what keeps it one.

The patch cannot express a change to anything but an answer. It is a flat
map from an `answersites` path to the answers belonging to it, so there is
no place in it to put a reworded `say` line or a livelier hook. Everything
else `apply` refuses: a question whose wording moved, a slot that already
held a usable answer, an index that is not there, and -- the one that
matters most -- an answer that is another placeholder. The legacy plans
teachers ask to have back said 'Let the children answer.' in 1,619 of their
1,780 answer steps; a repair that fills 407 slots with that vocabulary would
pass its own gate and change nothing for a teacher, so `answerwords` decides
what counts as filled here exactly as it does in the check.

`apply` is pure and total: it returns a new body or raises. The runner
decides what to do with a refusal, and writes nothing that still fails
`answerslot.failures`.
"""
import copy

import answerslot
import answerwords

#: The only paths a repair may write, keyed as `answersites` names them.
WRITABLE = ("asks", "warmUp.items", "exitTicket.answer",
            "problems[].solution", "steps[].cfu.pass_signal")


#: A container an author may nest a writable path under, mapped to the one
#: sub-key it may hold and the flat path that sub-key means. Two of the five
#: writable paths have a container in the body, and an author who returns
#: JSON naturally writes them nested; `grade_3_math_ch7_seg801` was refused
#: twice for exactly that and nothing about the patch reached past an answer
#: slot. Normalising the spelling does not widen the contract -- the set of
#: fields a repair can write is unchanged -- because a container holding any
#: other key is still refused whole.
NESTED = {"warmUp": ("items", "warmUp.items"),
          "exitTicket": ("answer", "exitTicket.answer")}


class Refused(Exception):
    """The patch is not a repair. Never caught here -- the runner logs it."""


def _usable(text):
    return answerwords.is_answer(text)


def _check(text, where):
    if not isinstance(text, str):
        raise Refused(u"%s: the answer is not text (%r)" % (where, text))
    if not _usable(text):
        raise Refused(u"%s: %r is not an answer a teacher could mark from"
                      % (where, text))


def _asks(out, entries):
    """The `asks[]` table answering the questions asked in prose."""
    if not isinstance(entries, list):
        raise Refused("asks: expected a list")
    new = []
    for i, e in enumerate(entries):
        if not isinstance(e, dict) or not e.get("ask"):
            raise Refused("asks[%d]: expected {ask, answer}" % i)
        _check(e.get("answer"), "asks[%d]" % i)
        new.append({"ask": e["ask"], "answer": e["answer"]})
    kept = {answerslot._key(e["ask"]): e["answer"] for e in new}
    for old in out.get("asks") or []:
        if not isinstance(old, dict) or not _usable(old.get("answer")):
            continue
        k = answerslot._key(old.get("ask") or "")
        if kept.get(k) != old["answer"]:
            raise Refused(u"asks: the existing answer to “%s” would be lost"
                          % old.get("ask"))
    out["asks"] = new


def _question(item):
    """The warm-up question, whichever of the three shapes holds it."""
    if isinstance(item, dict):
        return item.get("ask") or item.get("prompt") or ""
    return item or ""


def _held(item):
    """An answer the warm-up item already carries, or None.

    Three of the 44 bodies write `{prompt, expected}`. `expected` is a real
    answer under a name the schema never settled, so the migration renames
    the key and must not reword what is under it.
    """
    if not isinstance(item, dict):
        return None
    for key in ("answer", "expected"):
        if _usable(item.get(key)):
            return item[key]
    return None


def _warm(out, items):
    """`warmUp.items[]`, migrated to {ask, answer} in place."""
    wu = out.get("warmUp")
    old = (wu or {}).get("items") if isinstance(wu, dict) else None
    if not isinstance(old, list):
        raise Refused("warmUp.items: the lesson has none")
    if not isinstance(items, list) or len(items) != len(old):
        raise Refused("warmUp.items: expected %d items, got %s"
                      % (len(old), len(items) if isinstance(items, list)
                         else type(items).__name__))
    new = []
    for i, (o, n) in enumerate(zip(old, items)):
        if not isinstance(n, dict) or not n.get("ask"):
            raise Refused("warmUp.items[%d]: expected {ask, answer}" % i)
        if answerslot._key(n["ask"]) != answerslot._key(_question(o)):
            raise Refused(u"warmUp.items[%d]: the question changed — “%s” "
                          u"became “%s”" % (i, _question(o), n["ask"]))
        _check(n.get("answer"), "warmUp.items[%d]" % i)
        was = _held(o)
        if was is not None and n["answer"] != was:
            raise Refused(u"warmUp.items[%d]: it already answered “%s” with "
                          u"“%s”" % (i, _question(o), was))
        item = dict(o) if isinstance(o, dict) else {}
        item.pop("prompt", None)
        item.pop("expected", None)
        item["ask"] = n["ask"]
        item["answer"] = n["answer"]
        new.append(item)
    out["warmUp"]["items"] = new


def _exit(out, answer):
    et = out.get("exitTicket")
    if not isinstance(et, dict):
        raise Refused("exitTicket.answer: the lesson has no exit ticket")
    if _usable(et.get("answer")):
        raise Refused("exitTicket.answer: it is already answered")
    _check(answer, "exitTicket.answer")
    et["answer"] = answer


def _indexed(out, path, holder, field, values, reach=None):
    """An answer written into the nth element of a list of dicts."""
    if not isinstance(values, dict):
        raise Refused("%s: expected {index: answer}" % path)
    rows = out.get(holder)
    rows = rows if isinstance(rows, list) else []
    for key in sorted(values):
        try:
            i = int(key)
        except (TypeError, ValueError):
            raise Refused("%s: %r is not an index" % (path, key))
        if not 0 <= i < len(rows) or not isinstance(rows[i], dict):
            raise Refused("%s: there is no %s[%s]" % (path, holder, key))
        slot = reach(rows[i]) if reach else rows[i]
        if slot is None:
            raise Refused("%s: %s[%d] has nothing to answer" % (path, holder, i))
        if _usable(slot.get(field)):
            raise Refused("%s: %s[%d] is already answered" % (path, holder, i))
        _check(values[key], "%s[%d]" % (path, i))
        slot[field] = values[key]


def _strip(body):
    """The lesson with every answer slot removed -- what may not change."""
    b = copy.deepcopy(body or {})
    b.pop("asks", None)
    wu = b.get("warmUp")
    if isinstance(wu, dict) and isinstance(wu.get("items"), list):
        wu["items"] = [_question(i) for i in wu["items"]]
    if isinstance(b.get("exitTicket"), dict):
        b["exitTicket"].pop("answer", None)
    for p in b.get("problems") or []:
        if isinstance(p, dict):
            p.pop("solution", None)
    for s in b.get("steps") or []:
        if isinstance(s, dict) and isinstance(s.get("cfu"), dict):
            s["cfu"].pop("pass_signal", None)
    return b


def _flatten(patch):
    """The patch with a nested writable path read as its flat spelling.

    Pure and total, and it refuses rather than repairs: a container with a
    second key in it is an author returning a piece of the lesson, and the
    whole point of the patch shape is that there is nowhere to put one.
    """
    out = {}
    for key in patch:
        if key not in NESTED:
            out[key] = patch[key]
            continue
        field, path = NESTED[key]
        value = patch[key]
        if not isinstance(value, dict) or sorted(value) != [field]:
            raise Refused(u"%s: a repair may write only %s.%s, and this one "
                          u"carries %s" % (key, key, field,
                                           ", ".join(sorted(value))
                                           if isinstance(value, dict)
                                           else "no object at all"))
        if path in patch:
            raise Refused(u"%s: the patch answers %s twice, nested and flat"
                          % (key, path))
        out[path] = value[field]
    return out


def apply(body, patch):
    """A copy of the body with the patch's answers written in.

    Raises `Refused` if the patch reaches past an answer slot. The final
    comparison is redundant with the per-field checks on purpose: it is the
    one assertion that stays true when someone adds a sixth writable path
    and forgets what the pass is for.
    """
    if not isinstance(patch, dict):
        raise Refused("the patch is not an object")
    patch = _flatten(patch)
    unknown = [k for k in patch if k not in WRITABLE]
    if unknown:
        raise Refused("a repair may not write %s — only %s"
                      % (", ".join(sorted(unknown)), ", ".join(WRITABLE)))
    out = copy.deepcopy(body or {})
    if "asks" in patch:
        _asks(out, patch["asks"])
    if "warmUp.items" in patch:
        _warm(out, patch["warmUp.items"])
    if "exitTicket.answer" in patch:
        _exit(out, patch["exitTicket.answer"])
    if "problems[].solution" in patch:
        _indexed(out, "problems[].solution", "problems", "solution",
                 patch["problems[].solution"])
    if "steps[].cfu.pass_signal" in patch:
        _indexed(out, "steps[].cfu.pass_signal", "steps", "pass_signal",
                 patch["steps[].cfu.pass_signal"],
                 reach=lambda s: s.get("cfu") if isinstance(s.get("cfu"), dict)
                 else None)
    if _strip(out) != _strip(body):
        raise Refused("the repair changed the lesson, not only its answers")
    return out
