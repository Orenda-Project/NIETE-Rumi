# -*- coding: utf-8 -*-
"""A repair may fill an empty answer and may do nothing else.

bd-eakp8. 43 of the 44 Stage-C bodies authored to brief v3 ask the class
questions they never answer -- 407 of 688, a median of 8 a lesson. They are
not otherwise bad lessons: they pass grounding, Bloom's, the content budget
and the judge. So the fix is a REPAIR, not a re-generation. Re-rolling 44
lessons to add a missing field spends the batch again and risks every axis
that currently passes, and nothing about the lesson needs to change for a
teacher to be able to find the answer.

That makes the patch shape, not the prompt, the thing that has to be right.
A model handed its own lesson back and asked to improve one part will
improve other parts too -- it is trying to be helpful -- and a diff nobody
checks is how a re-roll ships disguised as a repair. So the patch cannot
EXPRESS a change to anything but an answer slot: it carries answers keyed by
the path they belong to, and `apply` refuses it if the questions moved, if a
slot that already held an answer would be overwritten, or if what came back
is another placeholder.

The last of those is the one that matters most. The legacy v7 plans teachers
ask to have back were not an answer-key product -- 1,619 of their 1,780
'Ans' steps said things like 'Let the children answer.' A repair that fills
407 slots with that vocabulary passes a presence check and ships the exact
product the complaint is about, so `answerwords.is_answer` is the acceptance
test here as well as in the gate.
"""
import copy
import unittest

import answerfix
import answerslot


def body(**kw):
    b = {"segment_id": "grade_2_math_ch1_seg1", "steps": [], "problems": []}
    b.update(kw)
    return b


class AppliesTheAnswers(unittest.TestCase):

    def test_a_prose_question_gains_an_asks_entry(self):
        b = body(steps=[{"say": u"So, how many tens?"}])
        out = answerfix.apply(b, {"asks": [{"ask": u"How many tens?",
                                            "answer": u"4 tens."}]})
        self.assertEqual(out["asks"][0]["answer"], u"4 tens.")

    def test_a_bare_warm_up_string_becomes_an_ask_answer_pair(self):
        # 40 of the 44 bodies write warmUp.items as bare strings, which is
        # why the site has no answer slot to fill. The shape migration is
        # part of the repair, not a separate pass.
        b = body(warmUp={"items": [u"What is 5 + 5?"]})
        out = answerfix.apply(b, {"warmUp.items": [{"ask": u"What is 5 + 5?",
                                                    "answer": u"10"}]})
        self.assertEqual(out["warmUp"]["items"][0],
                         {"ask": u"What is 5 + 5?", "answer": u"10"})

    def test_a_prompt_expected_item_keeps_its_existing_answer(self):
        # 3 bodies use {prompt, expected}. `expected` already holds a real
        # answer, so the migration renames the keys and must not reword it.
        b = body(warmUp={"items": [{"prompt": u"What is 5 + 5?",
                                    "expected": u"10"}]})
        out = answerfix.apply(b, {"warmUp.items": [{"ask": u"What is 5 + 5?",
                                                    "answer": u"10"}]})
        self.assertEqual(out["warmUp"]["items"][0]["answer"], u"10")

    def test_the_exit_ticket_gains_its_answer(self):
        b = body(exitTicket={"task": u"What is 24 + 18?"})
        out = answerfix.apply(b, {"exitTicket.answer": u"42"})
        self.assertEqual(out["exitTicket"]["answer"], u"42")

    def test_a_dark_problem_gains_its_solution(self):
        b = body(problems=[{"prompt": u"What fruit do you like?",
                            "status": "open-personal", "solution": None}])
        out = answerfix.apply(b, {"problems[].solution": {
            "0": u"answers vary — accept any fruit the child can name."}})
        self.assertIn(u"answers vary", out["problems"][0]["solution"])

    def test_a_cfu_gains_its_pass_signal(self):
        b = body(steps=[{"cfu": {"question": u"How many tens?"}}])
        out = answerfix.apply(b, {"steps[].cfu.pass_signal": {"0": u"Says 4."}})
        self.assertEqual(out["steps"][0]["cfu"]["pass_signal"], u"Says 4.")

    def test_the_input_body_is_not_mutated(self):
        b = body(exitTicket={"task": u"What is 24 + 18?"})
        answerfix.apply(b, {"exitTicket.answer": u"42"})
        self.assertNotIn("answer", b["exitTicket"])


class RefusesARerollDisguisedAsARepair(unittest.TestCase):
    """The safety property the whole approach rests on.

    Everything outside an answer slot passed grounding, Bloom's, the content
    budget and the judge already. A patch that reaches any of it is refused
    rather than merged and reviewed later, because 44 silent re-rolls is
    exactly the outcome this pass exists to avoid.
    """

    def test_a_key_that_is_not_an_answer_slot_is_refused(self):
        b = body(steps=[{"say": u"How many tens?"}])
        self.assertRaises(answerfix.Refused, answerfix.apply, b,
                          {"steps[].say": {"0": u"How many tens altogether?"}})

    def test_rewording_the_warm_up_question_is_refused(self):
        b = body(warmUp={"items": [u"What is 5 + 5?"]})
        self.assertRaises(answerfix.Refused, answerfix.apply, b,
                          {"warmUp.items": [{"ask": u"What is 6 + 6?",
                                             "answer": u"12"}]})

    def test_dropping_a_warm_up_item_is_refused(self):
        b = body(warmUp={"items": [u"What is 5 + 5?", u"And 6 + 6?"]})
        self.assertRaises(answerfix.Refused, answerfix.apply, b,
                          {"warmUp.items": [{"ask": u"What is 5 + 5?",
                                             "answer": u"10"}]})

    def test_overwriting_an_answer_that_is_already_there_is_refused(self):
        b = body(problems=[{"prompt": u"What is 24 + 18?",
                            "solution": u"24 + 18 = 42"}])
        self.assertRaises(answerfix.Refused, answerfix.apply, b,
                          {"problems[].solution": {"0": u"the answer is 42"}})

    def test_an_index_that_is_not_there_is_refused(self):
        b = body(steps=[{"cfu": {"question": u"How many tens?"}}])
        self.assertRaises(answerfix.Refused, answerfix.apply, b,
                          {"steps[].cfu.pass_signal": {"7": u"Says 4."}})

    def test_losing_an_existing_asks_entry_is_refused(self):
        b = body(steps=[{"say": u"How many tens? How many ones?"}],
                 asks=[{"ask": u"How many tens?", "answer": u"4 tens."}])
        self.assertRaises(answerfix.Refused, answerfix.apply, b,
                          {"asks": [{"ask": u"How many ones?",
                                     "answer": u"2 ones."}]})

    def test_everything_outside_the_answer_slots_is_byte_identical(self):
        b = body(steps=[{"say": u"So, how many tens?",
                         "cfu": {"question": u"And how many ones?"}}],
                 hookStory=u"Ali counted ten mangoes.",
                 bigIdea=u"Tens and ones make a number.",
                 exitTicket={"task": u"What is 24 + 18?", "minutes": 4})
        before = copy.deepcopy(b)
        out = answerfix.apply(b, {
            "asks": [{"ask": u"How many tens?", "answer": u"4 tens."}],
            "steps[].cfu.pass_signal": {"0": u"Says 2."},
            "exitTicket.answer": u"42"})
        out["steps"][0]["cfu"].pop("pass_signal")
        out["exitTicket"].pop("answer")
        out.pop("asks")
        self.assertEqual(out, before)


class RefusesAPlaceholder(unittest.TestCase):
    """A filled slot is not an answered question.

    `answerwords` holds the vocabulary; this is the wiring. A repair pass
    that accepts 'Let the children answer.' reproduces the legacy product
    under a new schema and would pass its own gate, which is the one way
    this work could look finished and change nothing for a teacher.
    """

    def test_the_legacy_placeholder_is_refused(self):
        b = body(steps=[{"cfu": {"question": u"How many tens?"}}])
        self.assertRaises(answerfix.Refused, answerfix.apply, b,
                          {"steps[].cfu.pass_signal":
                           {"0": u"Let the children answer."}})

    def test_an_empty_answer_is_refused(self):
        b = body(exitTicket={"task": u"What is 24 + 18?"})
        self.assertRaises(answerfix.Refused, answerfix.apply, b,
                          {"exitTicket.answer": u"  "})

    def test_an_honest_open_answer_is_accepted(self):
        b = body(problems=[{"prompt": u"Which fruit do you like?",
                            "status": "open-personal", "solution": u""}])
        out = answerfix.apply(b, {"problems[].solution": {
            "0": u"answers vary — accept any fruit named with a colour."}})
        self.assertTrue(out["problems"][0]["solution"])


class ClosesTheGate(unittest.TestCase):
    """The only end-to-end claim worth making: the lesson now answers itself."""

    def test_a_repaired_body_has_no_answer_findings_left(self):
        b = body(steps=[{"say": u"So, how many tens?",
                         "cfu": {"question": u"And how many ones?"}}],
                 warmUp={"items": [u"What is 5 + 5?"]},
                 exitTicket={"task": u"What is 24 + 18?"})
        self.assertTrue(answerslot.failures(b))
        out = answerfix.apply(b, {
            "asks": [{"ask": u"How many tens?", "answer": u"4 tens."}],
            "warmUp.items": [{"ask": u"What is 5 + 5?", "answer": u"10"}],
            "steps[].cfu.pass_signal": {"0": u"Says 2 ones."},
            "exitTicket.answer": u"42"})
        self.assertEqual(answerslot.failures(out), [])

    def test_an_incomplete_patch_leaves_the_finding_standing(self):
        # The runner must not write a body it only partly repaired; `apply`
        # succeeding is not the same as the lesson being answered.
        b = body(steps=[{"say": u"How many tens? How many ones?"}])
        out = answerfix.apply(b, {"asks": [{"ask": u"How many tens?",
                                            "answer": u"4 tens."}]})
        self.assertEqual([f["id"] for f in answerslot.failures(out)], ["A1"])


if __name__ == "__main__":
    unittest.main()


class AcceptsTheNestedSpelling(unittest.TestCase):
    """The same two writable paths, written the way JSON nests them.

    `grade_3_math_ch7_seg801` was refused twice in the first batch for
    returning `{"warmUp": {"items": [...]}, "exitTicket": {"answer": "..."}}`
    instead of the flat dotted keys the prompt asks for. Nothing about that
    patch reaches past an answer slot -- it is the same two fields under
    their own containers -- so refusing it spent two calls to protect
    nothing. What the contract must keep refusing is a container carrying
    ANY other key, because a returned `exitTicket` with a reworded `task` in
    it is a re-rolled lesson wearing the right name.
    """

    def test_a_nested_warm_up_is_the_same_as_the_dotted_key(self):
        b = body(warmUp={"items": [u"What is 5 + 5?"]})
        pair = [{"ask": u"What is 5 + 5?", "answer": u"10, counted on."}]
        self.assertEqual(answerfix.apply(b, {"warmUp": {"items": pair}}),
                         answerfix.apply(b, {"warmUp.items": pair}))

    def test_a_nested_exit_ticket_answer_is_the_same_as_the_dotted_key(self):
        b = body(exitTicket={"task": u"What is 24 + 18?"})
        self.assertEqual(
            answerfix.apply(b, {"exitTicket": {"answer": u"24 + 18 = 42"}}),
            answerfix.apply(b, {"exitTicket.answer": u"24 + 18 = 42"}))

    def test_a_reworded_task_riding_in_the_container_is_still_refused(self):
        b = body(exitTicket={"task": u"What is 24 + 18?"})
        with self.assertRaises(answerfix.Refused):
            answerfix.apply(b, {"exitTicket": {"answer": u"42",
                                               "task": u"Add 24 and 18."}})

    def test_another_warm_up_field_riding_in_the_container_is_refused(self):
        b = body(warmUp={"items": [u"What is 5 + 5?"], "script": u"Count."})
        with self.assertRaises(answerfix.Refused):
            answerfix.apply(b, {"warmUp": {
                "items": [{"ask": u"What is 5 + 5?", "answer": u"10."}],
                "script": u"Count on from five."}})

    def test_a_container_that_is_not_an_object_is_refused(self):
        b = body(exitTicket={"task": u"What is 24 + 18?"})
        with self.assertRaises(answerfix.Refused):
            answerfix.apply(b, {"exitTicket": u"42"})

    def test_a_patch_spelling_one_path_both_ways_is_refused(self):
        # Two answers for one slot is not a spelling question, and silently
        # preferring either one hides which the author meant.
        b = body(exitTicket={"task": u"What is 24 + 18?"})
        with self.assertRaises(answerfix.Refused):
            answerfix.apply(b, {"exitTicket": {"answer": u"42"},
                                "exitTicket.answer": u"forty-two"})

    def test_an_unrelated_container_is_still_refused(self):
        b = body(steps=[{"say": u"So, how many tens?"}])
        with self.assertRaises(answerfix.Refused):
            answerfix.apply(b, {"steps": [{"say": u"How many tens now?"}]})
