"""Gate G4, the worksheet half: a 995 is held to worksheet rules and no others.

`test_gate4.py` covers the gate over a teacher LESSON. This file covers the
one artefact the same call has to treat differently, and it is separate
because the two keep colliding: every check in the gate was written for a
four-page lesson plan, and each one had to be taught, one at a time, that a
student worksheet is a different object. `qa_checks` was the first (six hard
failures it could never clear), `wordbudget` the second (`key_points` caps on
a document that has no `key_points`), and `contentbudget` the third.

`gate4.worksheet_findings` is the single place that decides which artefact is
in hand. What these tests actually guard is that every check routes through
it -- and, in the other direction, that routing through it never becomes a
way for a bad worksheet to pass.
"""
import unittest

import gate4
from test_gate4 import TheContentBudgetReachesTheGate


class AWorksheetIsNotMeasuredAgainstALessonsClock(unittest.TestCase):
    """bd-joznk. C1 is a LESSON rule, and a 995 is not a lesson.

    `grade_1_english_ch1_seg995` is the Chapter 1 assessment worksheet: eleven
    questions, 35 marks, no `warmUp`, no `steps`, no `exitTicket`, and
    `lp_type: "assessment"` on both the envelope and the segment row. Its row
    states `duration_min`, because a worksheet still occupies a period, so
    `contentbudget` measured it, found no timed steps and reported "the plan
    states no timings" -- a warm-up-and-I-Do clock held against an artefact
    that legally has neither.

    `worksheet_findings` already exists to stop exactly this, and `compose`
    already calls the word budget INAPPLICABLE rather than unmeasured for the
    same artefact. `evaluate` simply never routed the content budget through
    it. The worksheet keeps its own hard checks -- `wslint` -- so this is a
    check being aimed at the right artefact, not a check being switched off.
    """

    WS = {"lesson_id": "grade_1_english_ch1_seg995", "lp_type": "assessment",
          "generated": {
              "title": "Chapter 1 Assessment \u2014 Hello World!",
              "instructions": "Do your best work.",
              "questions": [
                  {"id": "q%d" % (i + 1), "type": t, "marks": 2,
                   "childText": "Write your favourite food.",
                   "space": "lines", "answer": "any food word",
                   "marking": "1 mark for a word, 1 for the initial sound",
                   "common_errors": ["draws instead of writing"],
                   "options": ["a", "b"] if t == "mcq" else None,
                   "pairs": [{"left": "Cat", "right": "Bat"}]
                            if t == "match" else None}
                  for i, t in enumerate(["mcq", "fill", "match", "short",
                                         "draw", "compute", "word", "short"])],
              "total_marks": 16}}

    SEG = {"segment_index": 995, "chapter_number": 1, "lp_type": "assessment",
           "skill_type": "assessment", "pages_printed": [2, 3],
           "slo_codes": ["E-01-VO-01"], "duration_min": 40}

    REVIEW = {"criteria": [{"checks": [{"id": "1A", "rating": 4}]}]}

    def _ids(self, seg):
        score, _ = gate4.evaluate(self.WS, seg, self.REVIEW, subject="English")
        return [f["id"] for f in score["qa_hard_failures"]]

    def test_the_content_budget_does_not_fire_on_a_worksheet(self):
        self.assertNotIn("C1", self._ids(self.SEG))

    def test_it_is_inapplicable_not_merely_unmeasured(self):
        # "Not looked at" is `not_checked`, and a reader who sees C1 there
        # will go looking for the timings a worksheet does not have.
        score, _ = gate4.evaluate(self.WS, self.SEG, self.REVIEW,
                                  subject="English")
        self.assertNotIn("C1", score["not_checked"])

    def test_a_real_lesson_in_the_same_call_still_gets_C1(self):
        # The exemption has to be the artefact and nothing else. A content
        # lesson over its budget must still fail, or this is a hole.
        score, _ = gate4.evaluate(
            TheContentBudgetReachesTheGate.LP,
            TheContentBudgetReachesTheGate.SEG,
            TheContentBudgetReachesTheGate.REVIEW, subject="Maths")
        self.assertIn("C1", [f["id"] for f in score["qa_hard_failures"]])

    def test_the_worksheet_keeps_its_own_hard_checks(self):
        # `wslint` is what replaces C1, so a broken worksheet must still fail.
        broken = dict(self.WS)
        broken["generated"] = dict(self.WS["generated"])
        qs = [dict(x) for x in broken["generated"]["questions"]]
        qs[0]["answer"] = None
        broken["generated"]["questions"] = qs
        score, _ = gate4.evaluate(broken, self.SEG, self.REVIEW,
                                  subject="English")
        self.assertTrue(score["qa_hard_failures"],
                        "a worksheet with an unanswered question passed")


if __name__ == "__main__":
    unittest.main()
