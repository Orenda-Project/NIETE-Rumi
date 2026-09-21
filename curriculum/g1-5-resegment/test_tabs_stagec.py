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

Human reviewer and the seven unrun trace stages stay pending. The nine
Stage C columns moved first; A, B and C Enrichment followed once their
links were written.
"""
import unittest

import tabs

SUBJECTS = ("English", "Urdu", "Maths", "Science")

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

    def test_the_unrun_trace_columns_stay_pending(self):
        """A stage that has not run is still a stage that has not run."""
        cols = tabs.header("Urdu")
        dead = set(tabs.dead_columns("Urdu"))
        for c in tabs.PENDING_TRACES:
            self.assertIn(cols.index(c), dead,
                          "%s is not written and must stay collapsed" % c)

    def test_the_standfirst_no_longer_sends_her_looking_for_a_plus(self):
        for subject in SUBJECTS:
            s = tabs.standfirst(subject)
            self.assertNotIn("Grey headers are columns a later stage fills", s)
            self.assertIn("Stage C", s)


if __name__ == "__main__":
    unittest.main()


class TheLinkedTraceColumns(unittest.TestCase):
    """A, B and C carry links now, so they must not ship collapsed.

    Page truth is relinked from the previous build's published objects;
    segmentation and enrichment anchor back into the row. The other seven
    stages have not run and stay grey, noted and collapsed.
    """

    def test_the_three_linked_stages_are_named(self):
        self.assertEqual(tabs.LINKED_TRACES,
                         ["A Page truth", "B Segmentation", "C Enrichment"])
        self.assertEqual(len(tabs.PENDING_TRACES), 7)

    def test_they_are_not_dead(self):
        for subject in SUBJECTS:
            cols = tabs.header(subject)
            dead = set(tabs.dead_columns(subject))
            for c in tabs.LINKED_TRACES:
                self.assertNotIn(cols.index(c), dead,
                                 "%s: %s is written, not dead" % (subject, c))

    def test_they_are_outside_every_collapsed_group(self):
        for subject in SUBJECTS:
            cols = tabs.header(subject)
            for c in tabs.LINKED_TRACES:
                i = cols.index(c)
                for a, b in tabs.groups(subject):
                    self.assertFalse(a <= i < b,
                                     "%s: %s is inside group %d-%d"
                                     % (subject, c, a, b))

    def test_they_carry_no_pending_note(self):
        for subject in SUBJECTS:
            cols = tabs.header(subject)
            notes = tabs.pending_notes(subject)
            for c in tabs.LINKED_TRACES:
                self.assertNotIn(cols.index(c), notes, "%s: %s" % (subject, c))

    def test_the_seven_unrun_stages_stay_pending(self):
        for subject in SUBJECTS:
            cols = tabs.header(subject)
            notes = tabs.pending_notes(subject)
            for c in tabs.PENDING_TRACES:
                self.assertIn(cols.index(c), notes, "%s: %s" % (subject, c))
