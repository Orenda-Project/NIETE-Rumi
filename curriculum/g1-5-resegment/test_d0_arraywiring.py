# -*- coding: utf-8 -*-
"""Stage D0 — the authoring call sites actually EMIT the array form.

`d0_arrayform` was written, tested and verified over all 335 documents, and then
nothing called it: every widened slot still came out as one dense string. These
tests are the wire itself. They run the real builders on real corpus strings and
assert on what lands in the document.

Two rules run through all of them:

  * a REFUSED field is unchanged -- same characters, still a `str`;
  * an ACCEPTED field rejoins with a single space to the normalised original,
    which is what makes the renderer's re-join lossless. NOTHING IS CUT.

The fixtures are imported from `test_d0_arrayfit` so there is one copy of each
real string, and `NARRATED` is the measured worst case: refused by the hook
policy, shredded into four by the default one.

Run: /usr/bin/python3 -W ignore -m pytest test_d0_arraywiring.py -q
"""

import d0_arrayfit as A
import d0_arrayform as af
import d0_blocks as B
import d0_close
import d0_hook
import d0_objectives
import d0_page2
from test_d0_arrayfit import NARRATED, PLAIN, URDU


def rejoins(parts, original):
    """The renderer re-joins a rejected array with a bare ' '. This is that join."""
    return " ".join(parts) == af.normalise(original)


def seated(question, hook=True):
    """One built Opening, exactly as the passes leave it, then the array pass."""
    sections = [{"id": "opening", "title": "Opening",
                 "blocks": [{"type": "ask", "id": "hook", "hook": hook,
                             "question": question}]}]
    A.fit_hook_ask(sections)
    return sections[0]["blocks"][0]["question"]


# --------------------------------------------------------------- the hook
#
# THE BRIEF SAID d0_hook.py:210 and :279. THE CODE SAYS OTHERWISE, and the code wins.
# Two later passes REWRITE the hook ask's question as a plain string after d0_hook has
# built it: `d0_openingpeer.apply_opening_peer_talk` excises banned peer-talk clauses
# from `blocks[N].question`, and `d0_vtr.routine_question` re-seats the authored text
# in the MIDDLE of a See-Think-Wonder ("lead ... authored question ... stems"). Fitting
# at build time (a) raised `TypeError: expected string or bytes-like object` inside
# d0_vtr's `_ALREADY.search`, and (b) would have split the wrong text -- the corpus
# measurement of 69 split / 193 narrated was taken on BUILT documents, i.e. after the
# routine wrapped them. So the fit is a pass of its own, seated last.


def test_a_narrated_hook_reaches_the_document_as_an_unchanged_string():
    """The one way this change could do damage. 193 of 335 corpus hooks are narrated
    read-aloud stories; bulleting one is worse than the block the operator complained
    about. The hook must be fitted under `ask#hook.question`, never by hand."""
    assert seated(NARRATED) == NARRATED


def test_a_plain_hook_reaches_the_document_as_a_rejoinable_array():
    q = seated(PLAIN)
    assert isinstance(q, list) and len(q) == 3
    assert rejoins(q, PLAIN)


def test_the_urdu_hook_is_split_at_its_own_terminals():
    """Rule 20. Urdu is served in every populated slot and is not skipped here."""
    q = seated(URDU)
    assert isinstance(q, list) and len(q) == 3
    assert q[1].endswith("\u06d4") and q[2].endswith("\u061f")
    assert rejoins(q, URDU)


def test_an_ask_that_is_not_the_hook_is_not_touched_by_this_pass():
    """The close's `cfu` ask is an `ask` too, and it is fitted at its own call site under
    its own policy. Fitting it twice here would put it under the hook's policy instead."""
    assert seated(PLAIN, hook=False) == PLAIN


def test_the_pass_returns_the_sections_it_was_given():
    """It mutates in place AND returns, so a caller can chain it. `to_lp_doc` relies on
    the in-place half; a pass that quietly returned None would still pass every other
    test here, which is why this one exists."""
    sections = [{"id": "opening", "title": "Opening", "blocks": []}]
    assert A.fit_hook_ask(sections) is sections


def test_the_pass_is_idempotent():
    """It runs once per document, but a question that is already an array must survive a
    second pass unchanged rather than being wrapped or rejoined."""
    once = seated(PLAIN)
    twice = seated(once)
    assert twice is once


def test_the_hook_is_fitted_after_the_visual_routine_not_before():
    """The order is the whole point. `d0_vtr` wraps the authored provocation in a
    See-Think-Wonder, and those framing sentences are most of what makes a hook
    splittable -- so the array must be cut from the WRAPPED text, and the authored
    words must still be inside it."""
    doc = _built_doc()
    q = [b for s in doc["sections"] for b in s.get("blocks") or []
         if b.get("hook")][0]["question"]
    assert isinstance(q, list) and len(q) == 5
    joined = " ".join(q)
    # the routine's lead opens the array and its stems close it: both were added by a
    # pass that runs BEFORE this one, and both are cut as their own line.
    assert q[0].startswith("See") and "Wonder" in q[0]
    assert q[-1] == "Three silent lines in the copy, one for each."
    # the peer-talk filter's surviving clause is still one whole line, not two
    assert "Which month do you think comes right after January?" in q
    assert joined == af.normalise(joined)


def _built_doc():
    import json

    import d0_primary as d0
    from test_d0_primary import ENR, PT, TOPIC, _REAL_HOOK
    enr = json.loads(json.dumps(ENR))
    enr["generated"]["hookStory"] = _REAL_HOOK
    return d0.to_lp_doc(enr, PT, day=1, total_days=10, topic=TOPIC)


# --------------------------------------------------------------- page2

def test_page2_differentiation_and_reflection_come_out_as_arrays():
    g = {"weakLearnerSupport": PLAIN, "challengeExtension": PLAIN,
         "coachingReflection": PLAIN}
    p2 = d0_page2.build(g)
    for got in (p2["differentiation"]["stuck"], p2["differentiation"]["early"],
                p2["coaching_reflection"]):
        assert isinstance(got, list) and rejoins(got, PLAIN)


def test_page2_leaves_a_dark_slot_dark():
    """Dark stages stay dark: DESIGN_PENDING is a marker, not authored text, and it
    must never be turned into a one-element list or split."""
    p2 = d0_page2.build({})
    assert p2["differentiation"]["stuck"] == B.DESIGN_PENDING
    assert p2["differentiation"]["early"] == B.DESIGN_PENDING
    assert p2["coaching_reflection"] == B.DESIGN_PENDING


def test_page2_keeps_an_unsplittable_support_string_exactly():
    one = "Sit the pair with the number line and count along it together"
    p2 = d0_page2.build({"weakLearnerSupport": one})
    assert p2["differentiation"]["stuck"] == one


# --------------------------------------------------------------- the close

def test_the_exit_ticket_question_comes_out_as_an_array():
    g = {"exitTicket": {"task": PLAIN, "success_criteria": "Names the shape",
                        "minutes": 3}}
    sec = d0_close.conclusion(g)
    q = sec["exit_ticket"][0]["q"]
    assert isinstance(q, list) and rejoins(q, PLAIN)
    assert sec["exit_ticket"][0]["a"] == "Names the shape"


def test_the_worked_example_check_comes_out_as_an_array():
    sections = [{"id": "development",
                 "blocks": [{"type": "worked_example", "id": "i-do"}]}]
    d0_close.seat_the_check(sections, {"cfuExplain": PLAIN})
    cfu = sections[0]["blocks"][0]["cfu"]
    assert isinstance(cfu, list) and rejoins(cfu, PLAIN)


def test_the_check_is_fitted_on_the_fallback_seat_as_well():
    """No worked_example box to close: the check falls back to an `ask` in the
    conclusion, and that seat gets the same treatment."""
    sections = [{"id": "development", "blocks": []},
                {"id": "conclusion", "blocks": []}]
    d0_close.seat_the_check(sections, {"cfuExplain": PLAIN})
    q = sections[1]["blocks"][0]["question"]
    assert isinstance(q, list) and rejoins(q, PLAIN)


# --------------------------------------------------------------- we-do prompt

def test_the_faded_example_prompt_comes_out_as_an_array():
    """The biggest winner in the corpus: 256 of 335 documents split here, and the
    brief that listed the call sites MISSED this one."""
    steps = [{"phase": "We-Do", "action": "Set the pairs going.", "minutes": 5}]
    partner = {"structure": PLAIN, "teacher_role": "Circulate and listen in."}
    blk = B.we_do_block(steps, partner)
    joined = PLAIN + " · Circulate and listen in."
    assert isinstance(blk["prompt"], list)
    assert rejoins(blk["prompt"], joined)


def test_a_seven_part_setup_survives_because_the_prompt_has_its_own_policy():
    """`faded_example.prompt` is registered with _STEPS_POLICY (max 8), not DEFAULT
    (max 6), and that difference is load-bearing: the ch9-10 Maths setups run to eight
    sentences and the default policy would refuse the lot of them. Seven sentences."""
    seven = " ".join(
        "Partner A reads row %d from the printed table aloud." % i for i in range(1, 8))
    steps = [{"phase": "We-Do", "action": "Set the pairs going.", "minutes": 5}]
    blk = B.we_do_block(steps, {"structure": seven})
    assert isinstance(blk["prompt"], list) and len(blk["prompt"]) == 7


def test_a_one_sentence_setup_keeps_its_prompt_a_string():
    steps = [{"phase": "We-Do", "action": "Set the pairs going.", "minutes": 5}]
    blk = B.we_do_block(steps, {"structure": "Pairs swap after every row"})
    assert blk["prompt"] == "Pairs swap after every row"


# --------------------------------------------------------------- objectives

def test_the_outcome_comes_out_as_an_array_when_it_has_a_boundary():
    o = d0_objectives.build({"keyFact": PLAIN, "slo_refs": ["E-04-A-01"]})
    assert isinstance(o["outcome"], list) and rejoins(o["outcome"], PLAIN)
    assert o["items"][0]["slo_code"] == "E-04-A-01"


def test_the_outcome_of_253_of_335_documents_is_left_alone():
    """Most outcomes are a single clause with no sentence boundary at all. Wiring the
    slot must not invent one."""
    one = "Pupils name a shape from its sides and corners"
    assert d0_objectives.build({"keyFact": one})["outcome"] == one
