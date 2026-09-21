# -*- coding: utf-8 -*-
"""A code folded in from a revision is spiralled, never introduced.

Found on 2026-09-21 while writing the 103-row fold to the sheet (bd-2ctk6).
Rule 3 gives the chapter's last teaching day the revision's SLO codes, and
`assign_slo_roles` names a day's primary by "first day listing this code".
A revision row is not a day, so its codes had never been listed anywhere --
which made the host day their first sighting, promoted a spiral code over
the SLO the day actually teaches, and relabelled the day `introduces`.

Two rows on the live sheet said it: Grade 5 English ch2 would have made
E-05-LG-09 primary over E-05-WR-03, and Grade 2 Maths ch12 M-02-TI-03 over
M-02-TI-04. A revision reviews; it introduces nothing. Nothing is dropped
either way -- the folded codes stay in `supporting`, which is what the fold
was for.
"""
import unittest

import dayfold
import dayrules


def day(label, codes, descs=None, **kw):
    return dict({"day_label": label, "slo_codes": list(codes),
                 "slo_descriptions": list(descs or
                                          ["d:" + c for c in codes])}, **kw)


class AbsorbRecordsWhatItFoldedIn(unittest.TestCase):

    def test_the_host_remembers_which_codes_came_from_the_revision(self):
        host = day("Day 3", ["A"])
        dayfold._absorb(host, day("Day 4", ["B", "C"]))
        self.assertEqual(host["slo_codes"], ["A", "B", "C"])
        self.assertEqual(host["folded_slo_codes"], ["B", "C"])

    def test_a_code_the_host_already_had_is_not_recorded_as_folded(self):
        host = day("Day 3", ["A", "B"])
        dayfold._absorb(host, day("Day 4", ["B", "C"]))
        self.assertEqual(host["slo_codes"], ["A", "B", "C"])
        self.assertEqual(host["folded_slo_codes"], ["C"])

    def test_two_folds_into_one_host_accumulate(self):
        host = day("Day 3", ["A"])
        dayfold._absorb(host, day("Day 4", ["B"]))
        dayfold._absorb(host, day("Day 5", ["C"]))
        self.assertEqual(host["folded_slo_codes"], ["B", "C"])


class ASpiralledCodeCannotTakeTheDayFromWhatItTeaches(unittest.TestCase):

    def setUp(self):
        self.host = day("Day 2", ["A"])
        dayfold._absorb(self.host, day("Rev", ["Z"]))
        self.roles = dayrules.assign_slo_roles([day("Day 1", ["A"]), self.host])

    def test_the_primary_stays_the_code_the_day_actually_teaches(self):
        self.assertEqual(self.roles[1]["primary_slo"], "A")

    def test_the_day_develops_rather_than_introduces(self):
        self.assertEqual(self.roles[1]["slo_role"], "develops")

    def test_the_spiralled_code_is_kept_as_supporting_not_dropped(self):
        self.assertEqual(self.roles[1]["supporting_slos"], ["Z"])

    def test_the_spiralled_code_is_not_counted_as_newly_introduced(self):
        self.assertEqual(self.roles[1]["new_codes"], [])


class TheSpiralDoesNotStealFirstSightingFromARealTeachingDay(unittest.TestCase):
    """The mirror defect. If the fold's copy of a code counted as its first
    sighting, a later day that genuinely teaches it for the first time would
    be demoted to `develops` -- the introduction would vanish from the book."""

    def setUp(self):
        host = day("Day 1", ["A"])
        dayfold._absorb(host, day("Rev", ["Z"]))
        self.later = day("Day 2", ["Z"])
        self.roles = dayrules.assign_slo_roles([host, self.later])

    def test_the_later_day_still_introduces_the_code(self):
        self.assertEqual(self.roles[1]["primary_slo"], "Z")
        self.assertEqual(self.roles[1]["slo_role"], "introduces")


class AHostWhoseEveryCodeCameFromTheFoldStillGetsAPrimary(unittest.TestCase):

    def test_it_falls_back_to_its_first_code_and_develops_it(self):
        host = day("Day 1", [])
        dayfold._absorb(host, day("Rev", ["Z", "Y"]))
        roles = dayrules.assign_slo_roles([host])
        self.assertEqual(roles[0]["primary_slo"], "Z")
        self.assertEqual(roles[0]["slo_role"], "develops")
        self.assertEqual(roles[0]["supporting_slos"], ["Y"])


if __name__ == "__main__":
    unittest.main()
