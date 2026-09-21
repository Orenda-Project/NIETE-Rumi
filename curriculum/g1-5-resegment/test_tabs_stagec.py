# -*- coding: utf-8 -*-
"""A filled column must not ship greyed, noted and collapsed.

tabs.py decides which columns a reviewer sees. Anything in FILLED_BY is
treated as nothing-here-yet: greyed at the header, given a note naming the
stage that will fill it, and shipped inside a COLLAPSED column group. That
was right while Stage C was pending.

Stage C is now written -- 12,655 cells across four tabs, read back
identical -- and the sheet still hid every one of them, which is how Amena
came to say she could not see her own data. The columns were opened live;
this pins the source so the next format run does not shut them again.

The trace columns (A Page truth, B Segmentation, ...) and Human reviewer
stay pending. Only the nine Stage C columns move.
"""
import unittest

import tabs

STAGE_C = ("Moves", "Reading strategy", "Collaboration structure", "Function",
           "Interaction", "Gap", "Recycles", "Prerequisite SLOs",
           "Teacher-primary min (of 40)")


class StageCIsNoLongerPending(unittest.TestCase):

    def test_no_stage_c_column_claims_a_stage_will_fill_it(self):
        still = [c for c in STAGE_C if c in tabs.FILLED_BY]
        self.assertEqual(still, [],
                         "these are written; a note saying they are empty on "
                         "purpose is now false")

    def test_no_stage_c_column_counts_as_dead(self):
        for subject in ("English", "Urdu", "Maths", "Science"):
            cols = tabs.header(subject)
            dead = set(tabs.dead_columns(subject))
            named = [cols[i] for i in dead if cols[i] in STAGE_C]
            self.assertEqual(named, [], "%s still calls %s empty"
                             % (subject, named))

    def test_no_collapsed_group_swallows_a_stage_c_column(self):
        for subject in ("English", "Urdu", "Maths", "Science"):
            cols = tabs.header(subject)
            for a, b in tabs.groups(subject):
                inside = [c for c in cols[a:b] if c in STAGE_C]
                self.assertEqual(inside, [],
                                 "%s collapses %s out of sight" % (subject, inside))

    def test_the_trace_columns_stay_pending(self):
        """Only Stage C moved. A later stage is still a later stage."""
        cols = tabs.header("Urdu")
        dead = set(tabs.dead_columns("Urdu"))
        for c in tabs.TRACES:
            self.assertIn(cols.index(c), dead,
                          "%s is not written and must stay collapsed" % c)

    def test_the_standfirst_no_longer_sends_her_looking_for_a_plus(self):
        for subject in ("English", "Urdu", "Maths", "Science"):
            s = tabs.standfirst(subject)
            self.assertNotIn("Grey headers are columns a later stage fills", s)
            self.assertIn("Stage C", s)


if __name__ == "__main__":
    unittest.main()
