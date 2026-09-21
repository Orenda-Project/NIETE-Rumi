# -*- coding: utf-8 -*-
"""A column that copies another column is dead, and the gate could not see it.

The G1 Urdu pilot set `Recycles` equal to `Prerequisite SLOs` on all 124 rows
and passed every check. Both columns were individually well formed -- real
codes, all drawn from the row's own prior list -- so no per-row rule fired,
and the diversity rules only ask whether a column varies, which a copy does
exactly as much as its original. Two columns holding the same answer tell you
one thing, not two, and `Recycles` exists to make encounters-per-item
countable, which a restatement of the prerequisite cannot do.
"""
import unittest

import stagec_verify as v


class ACopiedColumnIsADeadColumn(unittest.TestCase):

    def slice_of(self, pairs, columns):
        """pairs: (prereq, recycles) per day."""
        rows, cells = [], {}
        for i, (prereq, recycles) in enumerate(pairs):
            row = 10 + i
            rows.append({"row": row, "day": i + 1,
                         "skill_type": "تفہیم · Comprehension",
                         "slo": "U-01-RD-%02d" % (i + 1),
                         "prior_slos_available": ["U-01-RD-01", "U-01-RD-02",
                                                  "U-01-RD-03"]})
            cells[str(row)] = {"Prerequisite SLOs": prereq,
                               "Recycles": recycles}
        return ({"slice": "t", "subject": "Urdu", "rows": rows,
                 "columns_to_fill": list(columns)},
                {"slice": "t", "cells": cells})

    def findings(self, pairs, columns=("Prerequisite SLOs", "Recycles")):
        s, w = self.slice_of(pairs, columns)
        return [f for f in v.verify_slice(s, w) if "Recycles" in f]

    PREREQS = ["U-01-RD-01", "U-01-RD-02", "U-01-RD-03", "none"] * 3

    def test_an_exact_copy_of_another_column_is_rejected(self):
        """The live shape: every row's Recycles repeated its prerequisite."""
        self.assertTrue(self.findings([(p, p) for p in self.PREREQS]),
                        "a column copied verbatim from another was not caught")

    def test_the_finding_names_both_columns(self):
        """A worker told only that `Recycles` is wrong will re-derive it from
        the same place. The finding has to say what it is a copy OF."""
        found = self.findings([(p, p) for p in self.PREREQS])
        self.assertTrue(any("Prerequisite SLOs" in f for f in found), found)

    def test_columns_that_genuinely_differ_pass(self):
        """A day may depend on one objective and recycle other words; the
        two columns agreeing on some rows is normal and not a copy."""
        recycles = ["U-01-RD-02", "U-01-RD-02", "none", "U-01-RD-01"] * 3
        self.assertFalse(self.findings(list(zip(self.PREREQS, recycles))))

    def test_agreement_on_a_minority_of_rows_is_not_a_copy(self):
        """Near-identical is still two columns. Only a column that never
        departs from another has stopped being a second question."""
        recycles = list(self.PREREQS)
        recycles[0] = "none"
        recycles[5] = "U-01-RD-01"
        self.assertFalse(self.findings(list(zip(self.PREREQS, recycles))))

    def test_two_columns_both_uniformly_none_are_not_a_copy(self):
        """`none` everywhere in both is a finding about the curriculum, and
        the existing dead-column rules are what should speak to it -- not
        this one, which would otherwise fire on every honest empty pair."""
        self.assertFalse(self.findings([("none", "none")] * 12))


if __name__ == "__main__":
    unittest.main()
