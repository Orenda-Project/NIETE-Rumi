# -*- coding: utf-8 -*-
"""The re-rate driver decides what to write; the sheet call is the easy half."""
import unittest

import bloomrun


HEADER = ["Day #", "Topic", "Skill type", "Primary SLO",
          "Primary SLO description", "Bloom's"]


def row(day, topic, code, desc, bloom):
    # Column A reads "Day 7", never a bare number -- that is the tab's grammar.
    return ["Day %s" % day, topic, "", code, desc, bloom]


class ThePlan(unittest.TestCase):

    def test_it_rewrites_a_teaching_day_from_its_own_slo(self):
        rows = [row("1", "Letters", "U-01-RD-01", "Recognise the letters.", "apply")]
        plan = bloomrun.plan(HEADER, rows, {"Letters": "arkaan_saazi"})
        self.assertEqual(plan.column, [["remember"]])
        self.assertEqual(plan.changed, 1)

    def test_it_leaves_a_non_teaching_row_exactly_as_it_found_it(self):
        rows = [["Chapter 1: Sounds", "", "", "", "", "banner text"]]
        plan = bloomrun.plan(HEADER, rows, {})
        self.assertEqual(plan.column, [["banner text"]])
        self.assertEqual(plan.changed, 0)

    def test_an_unratable_day_is_left_dark_not_guessed(self):
        rows = [row("1", "Mystery", "X-01", "", "apply")]
        plan = bloomrun.plan(HEADER, rows, {})
        self.assertEqual(plan.column, [[""]])
        self.assertEqual(plan.unrated, 1)

    def test_a_short_row_does_not_lose_its_place(self):
        # Sheets truncates trailing empties, so a row can end before Bloom's.
        rows = [["Day 1", "Counting", "", "M-01-PV-01", "I can count to ten."]]
        plan = bloomrun.plan(HEADER, rows, {})
        self.assertEqual(plan.column, [["remember"]])

    def test_the_column_is_as_long_as_the_rows_it_was_given(self):
        rows = [row("1", "A", "c", "Solve it.", ""),
                ["", "", "", "", "", ""],
                row("2", "B", "c", "Design it.", "")]
        self.assertEqual(len(bloomrun.plan(HEADER, rows, {}).column), 3)

    def test_it_counts_before_and_after_so_the_shift_is_arguable(self):
        rows = [row("1", "A", "c", "Solve it.", "understand"),
                row("2", "B", "c", "Name them.", "understand")]
        plan = bloomrun.plan(HEADER, rows, {})
        self.assertEqual(plan.before["understand"], 2)
        self.assertEqual(plan.after["apply"], 1)
        self.assertEqual(plan.after["remember"], 1)

    def test_it_refuses_a_header_with_no_blooms_column(self):
        self.assertRaises(ValueError, bloomrun.plan,
                          ["Day #", "Topic"], [], {})


class TheColumnLetter(unittest.TestCase):

    def test_it_counts_past_z(self):
        self.assertEqual(bloomrun.letter(0), "A")
        self.assertEqual(bloomrun.letter(25), "Z")
        self.assertEqual(bloomrun.letter(26), "AA")
        self.assertEqual(bloomrun.letter(27), "AB")


if __name__ == "__main__":
    unittest.main()
