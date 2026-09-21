# -*- coding: utf-8 -*-
"""A cell that opens with an apostrophe must arrive with it.

Under USER_ENTERED, Sheets reads a leading apostrophe as its own "force
text" prefix and swallows it. Five Urdu Recycles cells name a story in
single quotes -- "'تقریر کا فن' کے الفاظ" -- and landed on the sheet with
the opening quote gone and the closing one orphaned.

RAW is not the escape: stagec_send documents why USER_ENTERED is
load-bearing -- Moves carries a middot and pipes, and RAW would leave the
teacher-primary figure stored as text in a numeric column. Sheets' own
escape is a doubled apostrophe, and only the first one is consumed, so the
cell reads back exactly as intended. That was checked against the live
sheet before this test was written.

The doubling belongs to the wire, not to the intent. read-back compares
what the sheet holds against what was ASKED for, so the escape must be
invisible to the diff or every quoted title would report as a mismatch.
"""
import unittest

import stagec_write as w

TAB = u"Urdu G1–5"
HEADER = ["Day #", "Recycles", "Teacher-primary min (of 40)"]
QUOTED = u"'تقریر کا فن' کے الفاظ"

ROWS = [
    {"_row": 4, "kind": "day",
     "cells": {"Day #": "Day 1", "Recycles": "pending",
               "Teacher-primary min (of 40)": "pending"}},
    # Already on the sheet with a leading apostrophe: rewriting it plainly
    # would strip the quote off a cell nobody asked to change.
    {"_row": 5, "kind": "day",
     "cells": {"Day #": "Day 2", "Recycles": u"'چار دوست' کے",
               "Teacher-primary min (of 40)": "10"}},
]


def sent_for(row, col, new_values):
    p = w.build_payload(TAB, HEADER, ROWS, new_values,
                        ["Recycles", "Teacher-primary min (of 40)"])
    letter = w.col_letter(HEADER.index(col))
    for vr in p:
        if vr["range"].startswith(u"'%s'!%s" % (TAB, letter)):
            return vr["values"][row - 4][0]
    raise AssertionError("no range for %s" % col)


class TheLeadingApostropheSurvives(unittest.TestCase):

    def test_a_written_value_goes_out_doubled(self):
        self.assertEqual(sent_for(4, "Recycles", {4: {"Recycles": QUOTED}}),
                         u"'" + QUOTED)

    def test_a_pass_through_value_goes_out_doubled_too(self):
        """Row 5 is not being written; it must still come back whole."""
        got = sent_for(5, "Recycles", {4: {"Recycles": QUOTED}})
        self.assertTrue(got.startswith(u"''"),
                        "a cell we are only passing through lost its quote")

    def test_an_apostrophe_inside_the_value_is_left_alone(self):
        inner = u"the child's own words"
        self.assertEqual(sent_for(4, "Recycles", {4: {"Recycles": inner}}),
                         inner)

    def test_a_number_is_not_a_string_and_is_not_touched(self):
        self.assertEqual(
            sent_for(4, "Teacher-primary min (of 40)",
                     {4: {"Teacher-primary min (of 40)": 10}}), 10)

    def test_the_escape_is_invisible_to_the_read_back(self):
        """The sheet returns the intent; the diff must see no mismatch."""
        new = {4: {"Recycles": QUOTED}}
        payload = w.build_payload(TAB, HEADER, ROWS, new,
                                  ["Recycles", "Teacher-primary min (of 40)"])
        # What Sheets hands back for those ranges: the apostrophe consumed.
        returned = []
        for vr in payload:
            returned.append({"range": vr["range"],
                             "values": [[v[0][1:]] if (v and isinstance(v[0], str)
                                                       and v[0].startswith(u"''"))
                                        else v for v in vr["values"]]})
        got = w.readback_cells(payload, HEADER, returned)
        self.assertEqual(w.diff_readback(new, got), [])


if __name__ == "__main__":
    unittest.main()
