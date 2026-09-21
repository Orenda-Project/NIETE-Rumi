# -*- coding: utf-8 -*-
"""A perfectly even column was balanced, not read.

The flatness rules catch a column that gives every day the same answer. They
say nothing about the opposite failure, which the english_G4 slice showed:
twelve Pre-reading days annotated `pre-teach-vocabulary` 3, `predict` 3,
`activate-prior-knowledge` 3, `set-purpose` 3 -- an exact four-way split,
with two of the twelve tracing to nothing in their day. Its four sibling
grades, annotated from the same vocabulary, all landed lopsided: a strategy
that fits many days and a tail of ones.

Reading days honestly produces an uneven answer, because days are uneven.
An exact tie across three or more values is the fingerprint of counting
rather than reading, and the gate could not see it.

Only an EXACT tie fires. Near-even is ordinary -- 3/3/2/2 on twelve days is
what an honest annotation of a repetitive stretch looks like, and a rule
that rejected it would punish the curriculum for being repetitive.
"""
import unittest

import stagec_columns as c
import stagec_verify as v


class AnExactlyEvenColumnIsBalancedNotRead(unittest.TestCase):

    def cells_from(self, values):
        return dict((str(10 + i), {"Reading strategy": val})
                    for i, val in enumerate(values))

    def rows_from(self, values, skill="Pre-reading"):
        return [{"row": 10 + i, "day": i + 1, "skill_type": skill}
                for i in range(len(values))]

    def findings(self, values, skill="Pre-reading"):
        return c.check_even_split(self.rows_from(values, skill),
                                  self.cells_from(values),
                                  ["Reading strategy"])

    EVEN = (["predict"] * 3 + ["set-purpose"] * 3
            + ["infer"] * 3 + ["clarify"] * 3)

    def test_an_exact_four_way_tie_is_rejected(self):
        """The live english_G4 shape."""
        self.assertTrue(self.findings(self.EVEN),
                        "a perfectly even four-way split was not caught")

    def test_the_finding_names_the_column_and_the_skill_type(self):
        """A worker told only that something is flat cannot act on it."""
        found = self.findings(self.EVEN)
        self.assertTrue(any("Reading strategy" in f for f in found), found)
        self.assertTrue(any("Pre-reading" in f for f in found), found)

    def test_a_lopsided_column_passes(self):
        """G1's honest shape: one strategy fits most days, a short tail."""
        vals = ["predict"] * 8 + ["set-purpose"] * 3 + ["infer"]
        self.assertFalse(self.findings(vals))

    def test_near_even_is_not_an_exact_tie_and_passes(self):
        """3/3/3/2 is what annotating a repetitive stretch looks like."""
        vals = (["predict"] * 3 + ["set-purpose"] * 3
                + ["infer"] * 3 + ["clarify"] * 2)
        self.assertFalse(self.findings(vals))

    def test_a_two_way_tie_passes(self):
        """Six and six across two values is a coin, not a spreadsheet."""
        self.assertFalse(self.findings(["predict"] * 6 + ["infer"] * 6))

    def test_a_small_skill_type_is_exempt(self):
        """Three values over six days tie easily by chance, and genuine
        repetition in a small skill type is honest."""
        vals = ["predict"] * 2 + ["set-purpose"] * 2 + ["infer"] * 2
        self.assertFalse(self.findings(vals))

    def test_all_distinct_values_are_not_a_tie(self):
        """Nine days, nine answers: maximally read, not balanced."""
        self.assertFalse(self.findings(
            ["predict", "set-purpose", "infer", "clarify", "retell",
             "summarise", "visualise", "skim-scan", "text-structure"]))

    def test_it_runs_as_part_of_the_slice_check(self):
        """A rule not wired into verify_slice protects nothing."""
        rows = [dict(r, slo="E-04-RD-01", prior_slos_available=[])
                for r in self.rows_from(self.EVEN)]
        doc = {"slice": "t", "subject": "English", "rows": rows,
               "columns_to_fill": ["Reading strategy"]}
        out = {"slice": "t", "cells": self.cells_from(self.EVEN)}
        found = v.verify_slice(doc, out)
        self.assertTrue([f for f in v.defects(found) if "evenly" in f], found)


if __name__ == "__main__":
    unittest.main()
