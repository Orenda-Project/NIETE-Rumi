# -*- coding: utf-8 -*-
"""The one adapter between D0 authoring and ``d0_arrayform``.

``d0_arrayform.split_field`` is a pure decision function: it hands back
``Split(parts, reason)`` and ``parts is None`` means REFUSED.  This module is
the only place in the authoring layer that is allowed to call it, for one
reason:

    ``d0_arrayform.policy_for`` SILENTLY falls back to ``DEFAULT_POLICY`` for
    an unregistered slot key.

That fallback is a live hazard.  The hook question is registered as
``"ask#hook.question"`` and gets ``_HOOK_POLICY`` (``refuse_dialogue=True``).
A typo — ``"ask.question"``, ``"hook.question"``, ``None`` — does not raise:
it quietly returns ``DEFAULT_POLICY``, which does NOT refuse narrated text,
and 193 of the 335 corpus hooks are narrated read-aloud stories with quoted
dialogue.  Those would come out shredded into bullets.

So ``fit`` refuses to guess: an unregistered slot raises ``KeyError``.  Every
call site names its slot through a module constant below, and the constants
are asserted to be registered keys by ``test_d0_arrayfit.py``.

Safety of the whole change rests on ``d0_arrayform``'s checked round-trip:
``" ".join(parts) == normalise(original)``.  Nothing here trims, truncates or
repairs.  A refusal returns the ORIGINAL object, untouched.
"""

import d0_arrayform as af

# Registered slot keys.  Names, not literals, at the call sites.
HOOK = "ask#hook.question"
OUTCOME = "objectives.outcome"
EXIT_Q = "exit_ticket[].q"
STUCK = "page2.differentiation.stuck"
EARLY = "page2.differentiation.early"
REFLECTION = "page2.coaching_reflection"
WE_PROMPT = "worked_example.prompt"
WE_CFU = "worked_example.cfu"
FE_PROMPT = "faded_example.prompt"


def fit(text, slot):
    """Array form for ``text`` under ``slot``, or ``text`` itself if refused.

    Returns the SAME object on refusal, so a call site can be wired with no
    behaviour change whenever the splitter declines.
    """
    if slot not in af.SLOT_POLICY:
        raise KeyError("unregistered array slot: %r" % (slot,))
    if not isinstance(text, str):
        return text
    parts = af.split_field(text, slot).parts
    return text if parts is None else parts


def hook_question(text):
    """The hook ask, under the strict narrated-refusal policy. Never inline."""
    return fit(text, HOOK)


def fit_hook_ask(sections):
    """Fit the Opening's hook question, IN PLACE, and return `sections`.

    A PASS, not a call site, and it has to be. `d0_hook` builds the ask, but two later
    passes rewrite its question as a plain string:

        `d0_openingpeer.apply_opening_peer_talk`  excises banned peer-talk clauses
        `d0_vtr.routine_question`                 re-seats the authored provocation in
                                                  the MIDDLE of a See-Think-Wonder

    Fitting at build time hands `d0_vtr` a list and it raises; and the text it would
    have split is not the text that prints, because the routine's lead and stems are
    added afterwards -- they are most of what makes a hook splittable at all.

    Scoped to `hook: true`. The close's `cfu` ask is an `ask` too and is fitted at its
    own call site under its own policy; taking it here would put it under the hook's.
    """
    for sec in sections or []:
        for blk in (sec or {}).get("blocks") or []:
            if isinstance(blk, dict) and blk.get("type") == "ask" and blk.get("hook"):
                blk["question"] = hook_question(blk.get("question"))
    return sections
