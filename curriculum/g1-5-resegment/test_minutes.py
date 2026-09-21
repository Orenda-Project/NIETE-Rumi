# -*- coding: utf-8 -*-
"""The two time numbers, which are not the same number, wherever read.

Amena, 20 Sep 2026: *"what we assume as perfect 40 is too long for teachers,
so we make it shorter and show the teacher 40, something she can practically
implement."* So a lesson carries the PERIOD it prints -- 40, the number the
teacher is judged against and the Digital Coach reads -- and the CONTENT
BUDGET the timed steps may sum to. `basicseg` has said both since 20 Sep.

The main corpus never got the second word. Its `duration_min` holds 25, 30
or 35 on all 2,039 segments and never 40, so the field named after the period
is carrying the budget. Handed straight to an author, the envelope would have
said "this lesson is 30 minutes long" for a 40-minute period, and the coach
would have marked the teacher slow for teaching exactly to design.
"""
import unittest

import cbrief
import cbriefbasics


class TheTwoTimeNumbers(unittest.TestCase):

    def test_a_corpus_row_prints_the_period_and_budgets_the_content(self):
        period, content = cbriefbasics.minutes({"duration_min": 30})
        self.assertEqual(period, 40)
        self.assertEqual(content, 30)

    def test_the_short_and_long_corpus_rows_keep_their_own_budget(self):
        self.assertEqual(cbriefbasics.minutes({"duration_min": 25})[1], 25)
        self.assertEqual(cbriefbasics.minutes({"duration_min": 35})[1], 35)

    def test_the_period_is_the_same_forty_for_all_of_them(self):
        for stated in (25, 30, 35):
            self.assertEqual(cbriefbasics.minutes({"duration_min": stated})[0], 40)

    def test_a_basics_row_already_speaks_both_and_is_left_alone(self):
        # basicseg writes duration_min 40 AND content_min 30; re-reading its
        # 40 as a content budget would hand the author a 40-minute plan.
        period, content = cbriefbasics.minutes({"duration_min": 40, "content_min": 30})
        self.assertEqual((period, content), (40, 30))

    def test_a_segment_stating_nothing_falls_back_to_the_house_pair(self):
        self.assertEqual(cbriefbasics.minutes({}),
                         (cbriefbasics.PERIOD_MIN, cbriefbasics.CONTENT_MIN))

    def test_the_budget_never_exceeds_the_period(self):
        # A corpus row cannot state 45 minutes of content in a 40-minute room.
        period, content = cbriefbasics.minutes({"duration_min": 45})
        self.assertLessEqual(content, period)

    def test_a_row_stating_only_the_period_is_not_granted_all_of_it(self):
        # 40 is a period, never a budget -- the corpus never says 40. Reading
        # it as one would licence a plan that fills the whole class.
        self.assertEqual(cbriefbasics.minutes({"duration_min": 40}), (40, 30))


class TheEnvelopeCarriesBoth(unittest.TestCase):

    def envelope(self, **seg):
        seg.setdefault("segment_index", 801)
        seg.setdefault("duration_min", 30)
        return cbrief._envelope(seg, [], {"grade": 1, "subject": "English"},
                                1, 5)

    def test_duration_min_is_the_period_the_teacher_is_shown(self):
        self.assertEqual(self.envelope()["duration_min"], 40)

    def test_content_min_is_what_the_timed_steps_may_sum_to(self):
        self.assertEqual(self.envelope()["content_min"], 30)

    def test_a_thirty_five_minute_subject_says_so(self):
        e = self.envelope(duration_min=35)
        self.assertEqual((e["duration_min"], e["content_min"]), (40, 35))


if __name__ == "__main__":
    unittest.main()
