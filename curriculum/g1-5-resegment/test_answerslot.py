# -*- coding: utf-8 -*-
"""Every question the lesson puts to the class must carry its answer.

Measured 2026-09-21 against the 44 authored Stage-C bodies: 289 class-facing
questions carry an adjacent answer and 399 do not -- 58%, a median of 8 per
lesson, and 43 of the 44 lessons carry at least one. The two sites that are
answered are the two the schema gives a container to (`steps[].cfu.question`
-> `pass_signal`, `problems[].prompt` -> `solution`); every other question is
asked in prose and answered nowhere. So the Stage-C brief as written
reproduces the complaint it was meant to fix, which is why bd-ieesv had to
land before the enrichment batch rather than after it.

The complaint itself (bd-ieesv, from the 23,437-row lp_feedback census) is
about FINDABILITY, not truth: teachers say 'tlash krna' and
'ڈھونڈنے میں وقت ضائع' -- searching, time wasted finding. The legacy v7 plans
they ask to have back were not an answer-key product either: 1,619 of their
1,780 'Ans' steps (91%) are placeholders like 'Let the children answer.'
What they had was a visible slot in a predictable position.

That is the whole reason `_is_answer` rejects the legacy placeholder
vocabulary. A slot filled with 'Take children's responses.' passes a
presence check and reproduces the legacy product exactly, so presence is not
the contract -- a usable answer is. Where the answer genuinely varies the
slot says so and says what to accept, because a dark stage stays dark.
"""
import unittest

import answerslot


def body(**kw):
    """A minimal Stage-C body; tests add only the field under test."""
    b = {"segment_id": "grade_2_math_ch1_seg1", "steps": [], "problems": []}
    b.update(kw)
    return b


class ResolvesTheAnswer(unittest.TestCase):

    def test_a_cfu_is_answered_by_its_pass_signal(self):
        b = body(steps=[{"cfu": {"question": u"How many tens?",
                                 "pass_signal": u"Says 4 tens."}}])
        self.assertEqual(answerslot.missing(b), [])

    def test_a_problem_is_answered_by_its_solution(self):
        b = body(problems=[{"prompt": u"What is 24 + 18?",
                            "solution": u"24 + 18 = 42"}])
        self.assertEqual(answerslot.missing(b), [])

    def test_a_question_in_prose_is_answered_by_a_matching_ask_entry(self):
        b = body(steps=[{"say": u"So, how many tens?"}],
                 asks=[{"ask": u"How many tens?", "answer": u"4 tens."}])
        self.assertEqual(answerslot.missing(b), [])

    def test_an_ask_entry_for_a_different_question_does_not_cover_it(self):
        b = body(steps=[{"say": u"How many tens?"}],
                 asks=[{"ask": u"How many ones?", "answer": u"2 ones."}])
        self.assertEqual(len(answerslot.missing(b)), 1)

    def test_an_exit_ticket_is_answered_by_its_own_answer_field(self):
        b = body(exitTicket={"task": u"What is 24 + 18?", "answer": u"42"})
        self.assertEqual(answerslot.missing(b), [])

    def test_a_warm_up_item_is_answered_in_place(self):
        b = body(warmUp={"items": [{"ask": u"What is 5 + 5?",
                                    "answer": u"10"}]})
        self.assertEqual(answerslot.missing(b), [])

    def test_a_warm_up_item_that_is_a_bare_string_has_no_slot(self):
        # The shape the 44 authored bodies actually use, and the reason
        # warmUp.items[] contributed 72 unanswered question marks.
        b = body(warmUp={"items": [u"What is 5 + 5?"]})
        self.assertEqual(len(answerslot.missing(b)), 1)


class RejectsTheLegacyPlaceholder(unittest.TestCase):
    """The vocabulary itself is `test_answerwords`; this is the wiring.

    A filled slot the checker accepts is the one failure that would ship the
    legacy product under a new schema, so `missing` has to consult the
    judgment rather than test the key for presence.
    """

    def test_a_filled_slot_holding_a_placeholder_still_counts_as_missing(self):
        # 466 of the legacy plans' 1,780 'Ans' steps said exactly this.
        b = body(problems=[{"prompt": u"What is 24 + 18?",
                            "solution": u"Let the children answer."}])
        self.assertEqual(len(answerslot.missing(b)), 1)

    def test_an_honest_open_item_is_answered(self):
        # Rule (3) of bd-ieesv. An honest slot beats an empty one, and this
        # is the shape `status: open-personal` is supposed to carry.
        b = body(problems=[{"prompt": u"What is your favourite fruit?",
                            "status": "open-personal",
                            "solution": u"answers vary — accept any fruit "
                                        u"named with a colour word."}])
        self.assertEqual(answerslot.missing(b), [])


class Reports(unittest.TestCase):

    def test_the_report_counts_both_sides(self):
        b = body(steps=[{"say": u"How many tens?",
                         "cfu": {"question": u"And how many ones?",
                                 "pass_signal": u"Says 2."}}])
        r = answerslot.report(b)
        self.assertEqual(r["asked"], 2)
        self.assertEqual(r["answered"], 1)
        self.assertEqual(r["missing"], 1)

    def test_a_lesson_with_no_questions_is_not_a_division_by_zero(self):
        r = answerslot.report(body())
        self.assertEqual(r["asked"], 0)
        self.assertEqual(r["share_missing"], 0.0)

    def test_the_report_carries_the_unclassified_paths(self):
        b = body(reviewPrompt=u"What did we learn yesterday?")
        self.assertEqual(answerslot.report(b)["unclassified"], ["reviewPrompt"])

    def test_every_missing_entry_says_where_it_came_from(self):
        b = body(steps=[{"say": u"How many tens?"}])
        self.assertEqual(answerslot.missing(b)[0]["where"], "steps[].say")


class FailsTheGate(unittest.TestCase):
    """`gate4` asks a pure function and gets findings back, or nothing.

    Shaped exactly like `contentbudget.failures` so the gate keeps one way of
    receiving a body-level check, and so this module never imports the gate.

    The threshold is every question, not a share of them. A cap would license
    the median we measured -- 8 unanswered questions per lesson across 43 of
    44 authored bodies -- and 'most of the answers are here' is precisely the
    product teachers describe as unfindable.
    """

    def test_a_fully_answered_lesson_has_no_findings(self):
        b = body(steps=[{"cfu": {"question": u"How many tens?",
                                 "pass_signal": u"Says 4 tens."}}])
        self.assertEqual(answerslot.failures(b), [])

    def test_a_lesson_with_no_questions_at_all_has_no_findings(self):
        self.assertEqual(answerslot.failures(body()), [])

    def test_one_unanswered_question_is_a_hard_failure(self):
        b = body(steps=[{"say": u"How many tens?"}])
        f = answerslot.failures(b)
        self.assertEqual([x["id"] for x in f], ["A1"])

    def test_the_finding_counts_them_and_names_where_they_are(self):
        b = body(steps=[{"say": u"How many tens? How many ones?"}])
        name = answerslot.failures(b)[0]["name"]
        self.assertIn("2 of 2", name)
        self.assertIn("steps[].say", name)

    def test_the_finding_quotes_a_question_so_the_author_can_find_it(self):
        b = body(steps=[{"say": u"How many tens?"}])
        self.assertIn(u"How many tens?", answerslot.failures(b)[0]["name"])

    def test_the_envelope_and_the_bare_body_are_both_accepted(self):
        # `judgerun` hands gate4 the whole artefact and gate4's own fixtures
        # hand it a bare body; a check that reads only one silently passes
        # every lesson that arrives in the other shape.
        b = body(steps=[{"say": u"How many tens?"}])
        self.assertEqual(answerslot.failures({"generated": b}),
                         answerslot.failures(b))

    def test_an_unclassified_question_site_stops_the_gate_separately(self):
        # Not a defect in the lesson -- a defect in this module's picture of
        # the schema. It is still a hard failure, because a check that does
        # not know where all the questions are cannot certify that they are
        # answered, and the repair is one line in an allowlist.
        b = body(reviewPrompt=u"What did we learn yesterday?")
        self.assertEqual([x["id"] for x in answerslot.failures(b)], ["A2"])

    def test_the_unclassified_finding_names_the_path(self):
        b = body(reviewPrompt=u"What did we learn yesterday?")
        self.assertIn("reviewPrompt", answerslot.failures(b)[0]["name"])


if __name__ == "__main__":
    unittest.main()
