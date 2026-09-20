"""The lesson prints a 40-minute period. Its steps have to add up to 40.

Split out of `test_lessonrules` on 20 Sep 2026 when that file crossed 300
lines. Every rule tested there came from a judge rating of 2 on an authored
batch; the rule tested here came from arithmetic Amena did by hand, which is
why it sits apart rather than in another numbered pass.

*"how do we explain to teachers that the LP is to be taken in 40 minutes, if
we calculate till 30, teachers and digital coach both will be striking the
teacher down on moving too slow on the LP, there needs to be a balance within
the LP."* -- Amena, 20 Sep 2026 (bd-p4ulq)

The plan showed `duration_min` 40 and timed 5+5+8+9+3 = 30. The ten minutes
were explained in a prose note and nowhere in the timeline, so nothing a coach
reads off the page accounted for them. `project-lp-revamp-engagement` records
the same instrument doing the same damage from the opposite direction -- a
plan that cannot be finished drops the fidelity percentage and the teacher
rates it down -- and a teacher who is exactly on design should not be able to
lose that score by following the plan correctly.

These assert the rule against `contentbudget`, not against its own wording. A
rule naming a key the engine does not honour is worse than no rule: it costs
the author ten minutes of budget and explains nothing.
"""
import unittest

import contentbudget
import lessonrules

class TheTenUnaccountedMinutes(unittest.TestCase):
    """bd-p4ulq. Not a judge finding -- Amena read the plan and did the sum.

    20 Sep 2026: *"how do we explain to teachers that the LP is to be taken in
    40 minutes, if we calculate till 30, teachers and digital coach both will
    be striking the teacher down on moving too slow on the LP."* Every rule
    above came from a rating of 2; this one came from arithmetic that was
    always visible on the page, which is the harder kind to notice.

    The rule is only worth stating if the engine agrees with it, so these
    assert the rule text against `contentbudget` rather than against itself.
    """

    def setUp(self):
        self.hits = [r for r in lessonrules.RULES if "routine" in r.lower()]

    def test_the_brief_asks_for_the_routine_steps(self):
        self.assertEqual(len(self.hits), 1)

    def test_the_rule_spells_the_key_the_engine_actually_reads(self):
        # A rule naming a key the budget does not honour costs an author ten
        # minutes of budget and tells them nothing about why.
        self.assertIn(contentbudget.ROUTINE, self.hits[0])

    def test_the_rule_says_routine_minutes_are_not_charged_to_content(self):
        self.assertIn("not charged", self.hits[0].lower())
        g = {"steps": [{"kind": contentbudget.ROUTINE, "minutes": 5},
                       {"phase": "I-Do", "minutes": 5}]}
        self.assertEqual(contentbudget.spent({"generated": g}), 5)

    def test_the_rule_asks_for_the_two_steps_that_close_the_gap(self):
        self.assertIn("settle and open", self.hits[0].lower())
        self.assertIn("set the task", self.hits[0].lower())

    def test_the_arithmetic_in_the_rule_is_the_arithmetic_in_the_engine(self):
        # 5 + 5 on top of the measured 30 is what makes the printed 40 true.
        g = {"warmUp": {"minutes": 5},
             "steps": [{"phase": "Settle and open", "kind": "routine", "minutes": 5},
                       {"phase": "I-Do", "minutes": 5},
                       {"phase": "Set the task", "kind": "routine", "minutes": 5},
                       {"phase": "We-Do", "minutes": 8},
                       {"phase": "You-Do", "minutes": 9}],
             "exitTicket": {"minutes": 3}}
        self.assertEqual(contentbudget.structural({"generated": g}), 40)

    def test_the_halfway_checkpoint_is_asked_for_too(self):
        # Being on time has to be readable off the page by both people it is
        # used to judge, or it stays a coach's impression.
        flat = " ".join(lessonrules.RULES).lower()
        self.assertIn("halfway", flat)


if __name__ == "__main__":
    unittest.main()
