"""The plan has to fit the time the teacher actually has to teach in.

This is the complaint the whole basics rebuild answers. Amena, 20 Sep 2026:
*"what we assume as perfect 40 is too long for teachers, so we make it shorter
and show the teacher 40, something she can practically implement. The opening
and explanation take [the rest]."* So a basics row carries two numbers --
`duration_min` 40, the period the teacher is shown, and `content_min` 30, what
the timed steps are allowed to sum to.

A rule with no check is a rule that drifts, and 366 lessons is a long way to
drift. Two failures matter and they are not symmetric. A plan that OVERRUNS is
the lesson teachers abandon half-finished; a plan that states NO timings at all
overruns invisibly, because nothing is there to add up -- and an absent number
reading as a pass is the exact way `gate4`'s word budget quietly stopped
applying for a day.

Under-running is the third, and it is a softer fault: the six lessons authored
before this check existed sum to 27 or 28 against a 30 budget, so two or three
minutes of slack is the house style, not a defect. A plan filling half the
budget is a different thing -- the class is left with ten empty minutes.
"""
import unittest

import contentbudget


def seg(content_min=30, **kw):
    d = {"segment_index": 801, "chapter_number": 1, "duration_min": 40}
    if content_min is not None:
        d["content_min"] = content_min
    d.update(kw)
    return d


def lp(warm=4, steps=(5, 10, 9), exit_min=None):
    g = {"steps": [{"phase": "I-Do", "minutes": m} for m in steps]}
    if warm is not None:
        g["warmUp"] = {"minutes": warm, "script": "..."}
    if exit_min is not None:
        g["exitTicket"] = {"minutes": exit_min}
    return {"generated": g}


class WhatTheStepsSpend(unittest.TestCase):

    def test_the_warm_up_counts_it_is_teaching_time_too(self):
        self.assertEqual(contentbudget.spent(lp(warm=4, steps=(5, 10, 9))), 28)

    def test_an_exit_ticket_with_a_clock_counts_as_well(self):
        self.assertEqual(contentbudget.spent(lp(warm=4, steps=(5, 10), exit_min=2)), 21)

    def test_a_plan_with_no_timings_anywhere_spends_nothing(self):
        self.assertEqual(contentbudget.spent({"generated": {}}), 0)

    def test_a_step_whose_minutes_are_not_a_number_is_not_guessed_at(self):
        self.assertEqual(contentbudget.spent(
            {"generated": {"steps": [{"minutes": "about 5"}, {"minutes": 6}]}}), 6)


class TheTwoShapesALessonArrivesIn(unittest.TestCase):
    """`judgerun` hands the whole file; `gate4`'s own fixture hands the body.

    Both reach `qa_checks` and both have to reach this, or the check applies
    to the pipeline and not to the test that claims to pin it.
    """

    def test_the_whole_artefact_is_read_through_its_generated_body(self):
        self.assertEqual(contentbudget.spent(
            {"generated": {"warmUp": {"minutes": 4}}}), 4)

    def test_a_bare_body_is_read_as_itself(self):
        self.assertEqual(contentbudget.spent({"warmUp": {"minutes": 4}}), 4)


class ASegmentThatStatesNoBudget(unittest.TestCase):
    """Every lesson outside the basics build. There is nothing to break."""

    def test_it_has_no_findings(self):
        self.assertEqual(contentbudget.failures(lp(), seg(content_min=None)), [])

    def test_not_even_when_the_plan_carries_no_timings_at_all(self):
        # The rule is the segment's, not the gate's. A row that never claimed
        # a content budget is not silently held to one.
        self.assertEqual(
            contentbudget.failures({"generated": {}}, seg(content_min=None)), [])


class APlanThatFitsItsBudget(unittest.TestCase):

    def test_twenty_eight_of_thirty_passes_it_is_the_house_style(self):
        self.assertEqual(contentbudget.failures(lp(4, (5, 10, 9)), seg(30)), [])

    def test_exactly_on_the_budget_passes(self):
        self.assertEqual(contentbudget.failures(lp(4, (6, 11, 9)), seg(30)), [])


class APlanThatOverrunsThePeriod(unittest.TestCase):

    def test_it_fails(self):
        f = contentbudget.failures(lp(4, (8, 14, 12)), seg(30))
        self.assertEqual(len(f), 1)
        self.assertEqual(f[0]["id"], "C1")

    def test_the_finding_names_both_numbers_so_the_author_can_cut(self):
        f = contentbudget.failures(lp(4, (8, 14, 12)), seg(30))[0]
        self.assertIn("38", f["name"])
        self.assertIn("30", f["name"])

    def test_filling_the_whole_forty_minute_period_is_the_case_it_catches(self):
        # A plan budgeted to the period the teacher is SHOWN, not the content
        # minutes -- the specific mistake the rebuild exists to stop.
        self.assertTrue(contentbudget.failures(lp(5, (10, 15, 10)), seg(30)))


class APlanWithNoTimingsAtAll(unittest.TestCase):
    """Nothing to add up reads as inside budget unless it is caught here."""

    def test_it_fails_rather_than_passing_unmeasured(self):
        f = contentbudget.failures({"generated": {"steps": [{"phase": "I-Do"}]}},
                                   seg(30))
        self.assertEqual([x["id"] for x in f], ["C1"])

    def test_the_finding_says_the_plan_states_no_timings(self):
        f = contentbudget.failures({"generated": {}}, seg(30))[0]
        self.assertIn("no timings", f["name"])


class APlanThatLeavesTheClassWithNothingToDo(unittest.TestCase):

    def test_half_a_budget_fails(self):
        self.assertTrue(contentbudget.failures(lp(2, (4, 5, 4)), seg(30)))

    def test_the_slack_the_authored_lessons_already_use_does_not(self):
        # 27 of 30. Six lessons were authored at 27 or 28 before this check
        # existed; holding them to the minute would make the house style a
        # failure.
        self.assertEqual(contentbudget.failures(lp(4, (5, 9, 9)), seg(30)), [])

    def test_the_finding_names_the_shortfall(self):
        f = contentbudget.failures(lp(2, (4, 5, 4)), seg(30))[0]
        self.assertIn("15", f["name"])


if __name__ == "__main__":
    unittest.main()
