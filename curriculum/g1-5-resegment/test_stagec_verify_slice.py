# -*- coding: utf-8 -*-
"""Slice-wide rules: the ones no single row can fail on its own.

A row can be perfect and the slice still worthless -- every day carrying the
same collaboration structure, or every pair of children working with no
information gap between them. Those defects only exist across rows, which is
why they live apart from the per-row checks in test_stagec_verify.py.
"""
import unittest

import stagec_verify as v


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


if __name__ == "__main__":
    unittest.main()
