# -*- coding: utf-8 -*-
"""A worker's slice output is not trusted until it survives this."""
import unittest

import stagec_verify as v

SLICE = {
    "slice": "english_G1", "subject": "English", "grade": 1, "band": "G1-2",
    "columns_to_fill": ["Reading strategy", "Collaboration structure",
                        "Function", "Interaction", "Gap", "Recycles",
                        "Prerequisite SLOs"],
    "rows": [
        {"row": 6, "day": "Day 1", "skill_type": "Vocabulary & grammar",
         "slo": "E-01-VO-01", "prior_slos_available": []},
        {"row": 7, "day": "Day 2", "skill_type": "Oral communication",
         "slo": "E-01-OC-01", "prior_slos_available": ["E-01-VO-01"]},
    ],
}

GOOD = {
    "6": {"Reading strategy": "pre-teach-vocabulary",
          "Collaboration structure": "partner-sound-check",
          "Function": "I can name things in my classroom.",
          "Interaction": "pair", "Gap": "one-way",
          "Recycles": "none", "Prerequisite SLOs": "none"},
    "7": {"Reading strategy": "n/a",
          "Collaboration structure": "think-pair-share",
          "Function": "I can tell a friend about my family.",
          "Interaction": "pair", "Gap": "two-way",
          "Recycles": "classroom nouns", "Prerequisite SLOs": "E-01-VO-01"},
}


def fails(cells):
    return v.verify_slice(SLICE, {"slice": "english_G1", "cells": cells})


class AGoodSlicePasses(unittest.TestCase):
    def test_no_findings(self):
        self.assertEqual(fails(GOOD), [])


class TheSliceMustBeComplete(unittest.TestCase):
    def test_a_missing_row_is_a_finding(self):
        short = {"6": GOOD["6"]}
        self.assertTrue(any("7" in f for f in fails(short)))

    def test_a_row_not_in_the_slice_is_a_finding(self):
        extra = dict(GOOD); extra["999"] = GOOD["6"]
        self.assertTrue(any("999" in f for f in fails(extra)))

    def test_a_missing_column_is_a_finding(self):
        import copy
        c = copy.deepcopy(GOOD); del c["6"]["Gap"]
        self.assertTrue(any("Gap" in f for f in fails(c)))

    def test_a_wrong_slice_name_is_a_finding(self):
        self.assertTrue(v.verify_slice(SLICE, {"slice": "urdu_G3", "cells": GOOD}))


class ColumnsTheWorkerMayNotWrite(unittest.TestCase):
    def test_moves_is_rejected(self):
        import copy
        c = copy.deepcopy(GOOD); c["6"]["Moves"] = "warm_up·40"
        self.assertTrue(any("Moves" in f for f in fails(c)))

    def test_teacher_primary_is_rejected(self):
        import copy
        c = copy.deepcopy(GOOD); c["6"]["Teacher-primary min (of 40)"] = "9"
        self.assertTrue(any("Teacher-primary" in f for f in fails(c)))

    def test_strand_is_rejected(self):
        import copy
        c = copy.deepcopy(GOOD); c["6"]["Strand"] = "output"
        self.assertTrue(any("Strand" in f for f in fails(c)))


class TheVocabulariesAreEnforced(unittest.TestCase):
    def test_an_off_vocabulary_interaction_is_a_finding(self):
        import copy
        c = copy.deepcopy(GOOD); c["6"]["Interaction"] = "pairs"
        self.assertTrue(any("Interaction" in f for f in fails(c)))

    def test_a_high_medium_low_gap_is_a_finding(self):
        import copy
        c = copy.deepcopy(GOOD); c["7"]["Gap"] = "high"
        self.assertTrue(any("Gap" in f for f in fails(c)))

    def test_free_text_collaboration_is_a_finding(self):
        import copy
        c = copy.deepcopy(GOOD)
        c["6"]["Collaboration structure"] = "they chat about it"
        self.assertTrue(any("Collaboration" in f for f in fails(c)))


class TheOralFloorIsEnforcedOnTheSlice(unittest.TestCase):
    def test_an_oral_day_taught_individually_is_a_finding(self):
        import copy
        c = copy.deepcopy(GOOD); c["7"]["Interaction"] = "individual"
        self.assertTrue(any("row 7" in f for f in fails(c)))

    def test_a_non_oral_day_may_be_individual(self):
        import copy
        c = copy.deepcopy(GOOD); c["6"]["Interaction"] = "individual"
        self.assertEqual(fails(c), [])


class ForwardReferencesAreCaught(unittest.TestCase):
    def test_a_prerequisite_not_yet_taught_is_a_finding(self):
        import copy
        c = copy.deepcopy(GOOD); c["6"]["Prerequisite SLOs"] = "E-01-RC-09"
        self.assertTrue(any("Prerequisite" in f or "prerequisite" in f
                            for f in fails(c)))

    def test_pending_is_reported_but_named_separately(self):
        import copy
        c = copy.deepcopy(GOOD); c["6"]["Recycles"] = "pending"
        found = fails(c)
        self.assertTrue(any("pending" in f for f in found))


class TheReadingStrategyRuleForTextDays(unittest.TestCase):
    """`n/a` is a claim that no text is handled that day.

    It is true of a counters day and false of a phonics day, and the
    difference is not something a single cell can be checked against -- it
    comes from the curriculum's own skill tag, which the spec makes
    authoritative. Only the tag can say whether children met print.
    """

    def strategy(self, subject, skill_type, value="n/a"):
        s = dict(SLICE, subject=subject)
        s["rows"] = [dict(SLICE["rows"][0], skill_type=skill_type)]
        out = {"slice": "t", "cells": {"6": dict(GOOD["6"],
               **{"Reading strategy": value})}}
        return [f for f in v.verify_slice(s, out) if "Reading strategy" in f]

    def test_a_comprehension_day_may_not_say_not_applicable(self):
        self.assertTrue(self.strategy("English", "Reading comprehension"))

    def test_a_pre_reading_day_may_not_say_not_applicable(self):
        self.assertTrue(self.strategy("English", "Pre-reading"))

    def test_a_phonics_day_may_not_say_not_applicable(self):
        self.assertTrue(self.strategy("English", "Phonics"))

    def test_an_urdu_reading_aloud_day_may_not_say_not_applicable(self):
        """Reading aloud shares a move spine with oral work and shares
        nothing else: the child is reading connected print off a page."""
        self.assertTrue(self.strategy(
            "Urdu", u"\u0628\u0644\u0646\u062f \u062e\u0648\u0627\u0646\u06cc \u00b7 Reading aloud"))

    def test_an_urdu_syllables_day_may_not_say_not_applicable(self):
        self.assertTrue(self.strategy(
            "Urdu", u"\u0627\u0631\u06a9\u0627\u0646 \u0633\u0627\u0632\u06cc \u00b7 Syllables"))

    def test_a_day_that_really_handles_no_text_may_say_so(self):
        """The rule must not creep. Speaking to a partner and handling
        apparatus are not reading, and calling them reading to satisfy a
        gate is the invention the spec forbids."""
        self.assertFalse(self.strategy("English", "Oral communication"))
        self.assertFalse(self.strategy("Science", "Investigate"))
        self.assertFalse(self.strategy("Maths", "Concrete"))

    def test_a_text_day_that_names_a_real_strategy_passes(self):
        self.assertFalse(self.strategy("English", "Phonics", "decode-blend"))


if __name__ == "__main__":
    unittest.main()
