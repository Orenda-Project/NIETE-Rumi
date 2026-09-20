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


def lp(warm=4, steps=(5, 10, 9), exit_min=None, routine=(5, 5)):
    """A whole plan: the teaching steps AND the ten minutes around them.

    The routine steps are in the default because a plan without them is not a
    plan in house style any more -- it is the shape bd-p4ulq exists to fix,
    printing a 40-minute period its own timeline cannot account for. Tests that
    want that shape ask for it with `routine=()`.
    """
    g = {"steps": [{"phase": "Settle and open", "kind": "routine", "minutes": m}
                   for m in routine]
                  + [{"phase": "I-Do", "minutes": m} for m in steps]}
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


class RoutineStepsAreRealTimeButNotContentTime(unittest.TestCase):
    """The ten minutes between `content_min` 30 and `duration_min` 40.

    Amena, 20 Sep 2026: *"how do we explain to teachers that the LP is to be
    taken in 40 minutes, if we calculate till 30, teachers and digital coach
    both will be striking the teacher down on moving too slow on the LP, there
    needs to be a balance within the LP."*

    That is not a wording problem. A plan printing 40 while its own timeline
    claims 30 hands the observer ten minutes of silence, and a teacher who is
    exactly on design reads as ten minutes behind. `project-lp-revamp-
    engagement` already establishes the mechanism running the other way -- a
    plan that cannot be finished drops the fidelity percentage and the teacher
    rates it down -- and this is the same instrument penalising the opposite
    cause.

    So the settling and the task-setting become named steps carrying
    `kind: "routine"`. They are real minutes on the teacher's clock and they
    belong in the printed timeline; they are not teaching minutes and must not
    be charged against the 30 the content is allowed.
    """

    def test_a_routine_step_is_not_charged_to_the_content_budget(self):
        g = {"warmUp": {"minutes": 5},
             "steps": [{"phase": "Settle and open", "kind": "routine", "minutes": 5},
                       {"phase": "I-Do", "minutes": 5}],
             "exitTicket": {"minutes": 3}}
        self.assertEqual(contentbudget.spent({"generated": g}), 13)

    def test_the_two_routine_steps_the_rebuild_adds_do_not_break_the_budget(self):
        # Exactly the shape bd-p4ulq migrates the corpus to: 30 teaching
        # minutes plus 5 settling plus 5 setting the task. Before the fix
        # `spent` returned 40 against a 30 budget and C1 called it over.
        g = {"warmUp": {"minutes": 5},
             "steps": [{"phase": "Settle and open", "kind": "routine", "minutes": 5},
                       {"phase": "I-Do", "minutes": 5},
                       {"phase": "Set the task", "kind": "routine", "minutes": 5},
                       {"phase": "We-Do", "minutes": 8},
                       {"phase": "You-Do", "minutes": 9}],
             "exitTicket": {"minutes": 3}}
        self.assertEqual(contentbudget.spent({"generated": g}), 30)
        self.assertEqual(contentbudget.failures({"generated": g}, seg(30)), [])

    def test_routine_minutes_are_reported_on_their_own(self):
        g = {"steps": [{"kind": "routine", "minutes": 5},
                       {"kind": "routine", "minutes": 5},
                       {"phase": "I-Do", "minutes": 9}]}
        self.assertEqual(contentbudget.routine({"generated": g}), 10)

    def test_structural_minutes_are_what_the_teachers_clock_sees(self):
        g = {"warmUp": {"minutes": 5},
             "steps": [{"kind": "routine", "minutes": 10},
                       {"phase": "I-Do", "minutes": 22}],
             "exitTicket": {"minutes": 3}}
        self.assertEqual(contentbudget.structural({"generated": g}), 40)

    def test_a_kind_that_is_not_routine_is_still_teaching_time(self):
        # Only the one word switches the charge off. A typo must cost minutes,
        # not silently free them.
        g = {"steps": [{"kind": "Routine", "minutes": 5},
                       {"kind": "warmup", "minutes": 5}]}
        self.assertEqual(contentbudget.spent({"generated": g}), 10)


class ThePeriodThePlanPrintsHasToAddUp(unittest.TestCase):
    """The fidelity penalty, caught as a finding instead of by a coach."""

    def _lp(self, routine=(5, 5), content=(5, 8, 9), warm=5, exit_min=3):
        steps = [{"phase": "routine %d" % i, "kind": "routine", "minutes": m}
                 for i, m in enumerate(routine)]
        steps += [{"phase": "I-Do", "minutes": m} for m in content]
        return {"generated": {"warmUp": {"minutes": warm},
                              "steps": steps,
                              "exitTicket": {"minutes": exit_min}}}

    def test_thirty_structural_minutes_in_a_forty_minute_period_fails(self):
        # The corpus as it stood on 20 Sep 2026: 5+5+8+9+3 = 30, duration 40.
        f = contentbudget.failures(self._lp(routine=()), seg(30))
        self.assertEqual([x["id"] for x in f], ["C1"])

    def test_the_finding_names_the_unaccounted_minutes(self):
        f = contentbudget.failures(self._lp(routine=()), seg(30))[0]
        self.assertIn("40", f["name"])
        self.assertIn("30", f["name"])
        self.assertIn("10", f["name"])

    def test_the_two_routine_steps_close_it(self):
        self.assertEqual(contentbudget.failures(self._lp(), seg(30)), [])

    def test_the_house_style_slack_still_passes(self):
        # 27 content + 10 routine = 37 of 40. Three unaccounted minutes is the
        # same slack the content budget already allows, measured, not invented.
        self.assertEqual(
            contentbudget.failures(self._lp(content=(5, 7, 7)), seg(30)), [])

    def test_overrunning_the_printed_period_fails_too(self):
        self.assertTrue(contentbudget.failures(
            self._lp(routine=(8, 8)), seg(30)))

    def test_a_segment_with_no_duration_is_not_held_to_one(self):
        s = seg(30)
        del s["duration_min"]
        self.assertEqual(contentbudget.failures(self._lp(routine=()), s), [])

    def test_a_content_overrun_is_reported_before_the_accounting(self):
        # Cutting teaching time is the author's first move; being told about
        # both at once buries it.
        f = contentbudget.failures(self._lp(routine=(), content=(10, 15, 12)),
                                   seg(30))
        self.assertEqual(len(f), 1)
        self.assertIn("over by", f[0]["name"])


if __name__ == "__main__":
    unittest.main()
