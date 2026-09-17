"""schoolyear — the 2026-27 session, and the two places it was wrong.

This file exists because the calendar's date arithmetic shipped a real error:
summer was coded as starting 1 June from the Basic Calendar of Activities,
when the federal government had merged Eid-ul-Azha into the break and shut
Islamabad public-sector schools from 25 May. Eleven of the seventeen FDE
breakdown documents said so. Five school days and a whole assessment window
sat on the wrong side of a closure, and nothing caught it.

The periods table is tested here too. Urdu runs six periods a week in Grades 1
and 5 and five everywhere else, which is a per-grade exception in a table that
is otherwise per-subject — exactly the kind of thing that quietly reverts.
"""
import unittest
from datetime import date

import schoolyear as sy


class SummerBreak(unittest.TestCase):
    """Schools closed 25 May 2026, not 1 June (confirmed by Amena, 17 Sep)."""

    def test_the_last_week_of_may_is_closed(self):
        for day in (date(2026, 5, 25), date(2026, 5, 29), date(2026, 6, 1)):
            self.assertTrue(sy.in_break(day), f"{day} should be closed")

    def test_the_week_before_is_still_taught(self):
        self.assertFalse(sy.in_break(date(2026, 5, 22)))
        self.assertIn(date(2026, 5, 22), set(sy.school_days()))

    def test_no_school_day_falls_inside_the_summer_break(self):
        days = set(sy.school_days())
        start, end, _name = sy.BREAKS[0]
        self.assertFalse([d for d in days if start <= d <= end])

    def test_the_first_assessment_survived_the_closure(self):
        # It was scheduled 25-29 May, which the closure swallowed whole.
        window = [a for a in sy.ASSESSMENTS if a[2] == "1st Assessment"][0]
        start, end = window[0], window[1]
        self.assertFalse(sy.in_break(start), "assessment starts in the break")
        self.assertFalse(sy.in_break(end), "assessment ends in the break")

    def test_every_assessment_window_has_school_days_in_it(self):
        days = set(sy.school_days())
        for start, end, name, _g in sy.ASSESSMENTS:
            hit = [d for d in days if start <= d <= end]
            self.assertTrue(hit, f"{name} has no school days in its window")

    def test_the_deviation_is_declared(self):
        self.assertTrue(any("25 May" in text for _w, text in sy.DEVIATIONS),
                        "the 25 May correction must stay named on the tab")


class Holidays(unittest.TestCase):

    def test_gazetted_holidays_are_not_taught(self):
        days = set(sy.school_days())
        for holiday in sy.HOLIDAYS:
            self.assertNotIn(holiday, days, f"{holiday} is a holiday")


class Periods(unittest.TestCase):
    """periods_for is the single authority on how many periods a week a
    grade-subject gets. Nothing may read PERIODS_PER_WEEK directly."""

    def test_urdu_runs_six_periods_in_the_two_grades_whose_books_need_it(self):
        self.assertEqual(sy.periods_for("Urdu", 1), 6)
        self.assertEqual(sy.periods_for("Urdu", 5), 6)

    def test_urdu_stays_at_five_everywhere_else(self):
        for grade in (2, 3, 4):
            self.assertEqual(sy.periods_for("Urdu", grade), 5)

    def test_the_other_subjects_are_unchanged_in_every_grade(self):
        for grade in range(1, 6):
            self.assertEqual(sy.periods_for("English", grade), 5)
            self.assertEqual(sy.periods_for("Maths", grade), 6)
            self.assertEqual(sy.periods_for("Science", grade), 3)

    def test_no_grade_subject_leaves_the_band_amena_set(self):
        # "keep it as 5-6 and science 3-4 should do"
        for grade in range(1, 6):
            for subject in ("English", "Urdu", "Maths"):
                self.assertIn(sy.periods_for(subject, grade), (5, 6))
            self.assertIn(sy.periods_for("Science", grade), (3, 4))


if __name__ == "__main__":
    unittest.main()
