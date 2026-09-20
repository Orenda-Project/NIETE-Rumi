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


class TheReadingStrategyRuleForComprehensionDays(unittest.TestCase):
    def test_a_comprehension_day_may_not_say_not_applicable(self):
        s = dict(SLICE)
        s["rows"] = [dict(SLICE["rows"][0], skill_type="Reading comprehension")]
        out = {"slice": "english_G1", "cells": {"6": dict(GOOD["6"],
               **{"Reading strategy": "n/a"})}}
        self.assertTrue(any("Reading strategy" in f
                            for f in v.verify_slice(s, out)))


if __name__ == "__main__":
    unittest.main()


class ADeadColumnIsADefect(unittest.TestCase):
    """The pilot wrote `peer-check` on 112 of 116 maths days -- every Concrete
    day, every Abstract day, every Word-problem day the same. It cleared the
    vocabulary gate and carried no signal. A column that cannot tell two skill
    types apart cannot surface the failure it exists to surface, which is the
    spec's own argument for keeping Interaction and Gap separate.
    """

    def slice_of(self, structures, skills=None):
        rows, cells = [], {}
        for i, s in enumerate(structures):
            row = 10 + i
            rows.append({"row": row, "day": i + 1, "skill_type":
                         (skills[i] if skills else "Concrete"),
                         "slo": "M-01-NS-%02d" % (i + 1), "prior_slos_available": []})
            cells[str(row)] = {"Reading strategy": "n/a",
                               "Collaboration structure": s,
                               "Prerequisite SLOs": "none"}
        return ({"slice": "t", "subject": "Maths", "rows": rows,
                 "columns_to_fill": ["Reading strategy", "Collaboration structure",
                                     "Prerequisite SLOs"]},
                {"slice": "t", "cells": cells})

    def test_one_structure_on_almost_every_row_is_caught(self):
        s, w = self.slice_of(["peer-check"] * 28 + ["group-task", "round-robin",
                                                    "jigsaw", "peer-check"])
        self.assertTrue([f for f in v.verify_slice(s, w)
                         if "peer-check" in f])

    def test_a_slice_using_only_a_couple_of_structures_is_caught(self):
        s, w = self.slice_of(["peer-check", "group-task"] * 10)
        self.assertTrue([f for f in v.verify_slice(s, w)
                         if "distinct" in f])

    def test_a_skill_type_with_many_rows_may_not_be_monolithic(self):
        skills = ["Concrete"] * 10 + ["Pictorial"] * 10 + ["Abstract"] * 10
        structs = (["peer-check"] * 10
                   + ["group-task", "jigsaw"] * 5
                   + ["round-robin", "think-pair-share"] * 5)
        s, w = self.slice_of(structs, skills)
        found = [f for f in v.verify_slice(s, w) if "Concrete" in f]
        self.assertTrue(found, "monolithic Concrete not caught")

    def test_a_small_skill_type_is_not_forced_to_vary(self):
        """Six Word-problem days all suiting one structure is honest, and
        forcing variety there would be inventing to fill a blank."""
        skills = ["Word problem"] * 4 + ["Concrete"] * 8 + ["Pictorial"] * 8
        structs = (["peer-check"] * 4
                   + ["group-task", "jigsaw"] * 4
                   + ["round-robin", "think-pair-share"] * 4)
        s, w = self.slice_of(structs, skills)
        self.assertFalse([f for f in v.verify_slice(s, w)
                          if "Word problem" in f])

    def test_a_genuinely_varied_slice_passes(self):
        skills = ["Concrete"] * 8 + ["Pictorial"] * 8 + ["Abstract"] * 8
        structs = (["peer-check", "group-task"] * 4
                   + ["jigsaw", "think-pair-share"] * 4
                   + ["round-robin", "numbered-heads"] * 4)
        s, w = self.slice_of(structs, skills)
        self.assertEqual(v.verify_slice(s, w), [])


class FlatnessDependsOnHowBigTheVocabularyIs(unittest.TestCase):
    """One share-cap cannot serve a 14-value column and a 5-value one.

    Collaboration structure offers fourteen values, so one of them on 97% of
    days is dead. Interaction offers five, two of which (individual,
    teacher<->class) are what the spec discourages on oral days -- capping the
    top value there at the same 60% pushes toward a forced pair/group split,
    which is inventing. What actually distinguishes a live column from a dead
    one is whether the SECOND value has real presence.
    """

    def slice_of(self, interactions, gaps=None, skills=None):
        rows, cells = [], {}
        for i, inter in enumerate(interactions):
            row = 10 + i
            rows.append({"row": row, "day": i + 1,
                         "skill_type": (skills[i] if skills else "Writing"),
                         "slo": "E-01-%02d" % (i + 1), "prior_slos_available": []})
            cells[str(row)] = {
                "Reading strategy": "n/a", "Collaboration structure":
                    ["think-pair-share", "peer-check", "jigsaw"][i % 3],
                "Function": "I can do it.", "Interaction": inter,
                "Gap": (gaps[i] if gaps else ["none", "opinion", "reasoning"][i % 3]),
                "Recycles": "", "Prerequisite SLOs": "none"}
        return ({"slice": "t", "subject": "English", "rows": rows,
                 "columns_to_fill": ["Reading strategy", "Collaboration structure",
                                     "Function", "Interaction", "Gap", "Recycles",
                                     "Prerequisite SLOs"]},
                {"slice": "t", "cells": cells})

    def test_a_dominant_value_with_a_strong_runner_up_is_not_flat(self):
        """pair 63%, group 30% differentiates; it is not one answer for
        every day."""
        s, w = self.slice_of(["pair"] * 19 + ["group"] * 9 + ["mingle"] * 2)
        self.assertFalse([f for f in v.verify_slice(s, w) if "Interaction" in f])

    def test_a_dominant_value_whose_runner_up_is_a_token_is_flat(self):
        s, w = self.slice_of(["pair"] * 28 + ["group", "mingle"])
        self.assertTrue([f for f in v.verify_slice(s, w) if "Interaction" in f])

    def test_a_small_vocabulary_column_is_not_forced_to_vary_per_skill_type(self):
        """Nine Phonics days with no information gap between the children is
        a true statement about phonics drills, not inattention."""
        s, w = self.slice_of(["pair"] * 9 + ["group"] * 12 + ["mingle"] * 9,
                             gaps=["none"] * 9 + ["opinion", "reasoning"] * 10 + ["none"],
                             skills=["Phonics"] * 9 + ["Writing"] * 21)
        self.assertFalse([f for f in v.verify_slice(s, w)
                          if "Phonics" in f and "Gap" in f])


class ChoralPracticeInPairs(unittest.TestCase):
    """The spec's own named failure, which the gate had only approximated:

        "a whole term of `pair` at `Gap: none` is choral practice in pairs,
         and only both columns together reveal it"

    Neither column alone is wrong in that case. The pair of them is.
    """

    def slice_of(self, combos):
        rows, cells = [], {}
        for i, (inter, gap) in enumerate(combos):
            row = 10 + i
            rows.append({"row": row, "day": i + 1, "skill_type": "Writing",
                         "slo": "E-01-%02d" % (i + 1), "prior_slos_available": []})
            cells[str(row)] = {
                "Reading strategy": "n/a",
                "Collaboration structure": ["think-pair-share", "peer-check",
                                            "jigsaw"][i % 3],
                "Function": "I can do it.", "Interaction": inter, "Gap": gap,
                "Recycles": "", "Prerequisite SLOs": "none"}
        return ({"slice": "t", "subject": "English", "rows": rows,
                 "columns_to_fill": ["Reading strategy", "Collaboration structure",
                                     "Function", "Interaction", "Gap", "Recycles",
                                     "Prerequisite SLOs"]},
                {"slice": "t", "cells": cells})

    def test_mostly_paired_work_with_no_information_gap_is_caught(self):
        s, w = self.slice_of([("pair", "none")] * 21
                             + [("group", "opinion"), ("pair", "reasoning")] * 4
                             + [("mingle", "two-way")])
        found = [f for f in v.verify_slice(s, w) if "choral" in f.lower()]
        self.assertTrue(found, "pair-at-Gap-none not caught")

    def test_paired_work_that_carries_real_gaps_passes(self):
        s, w = self.slice_of([("pair", "none")] * 9
                             + [("pair", "opinion")] * 7
                             + [("group", "reasoning")] * 7
                             + [("pair", "one-way")] * 7)
        self.assertFalse([f for f in v.verify_slice(s, w) if "choral" in f.lower()])
