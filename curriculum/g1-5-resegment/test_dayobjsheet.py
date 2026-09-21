# -*- coding: utf-8 -*-
"""Putting the day objective on the sheet, beside the SLO it corrects.

The join is (grade, chapter, day), never the topic. The topic looks like a
key and is not one: `grade_5_urdu` states three topics twice inside itself
and shares a fourth with four other books on the same tab, so a topic index
would put one day's objective on another day's row -- exactly the defect
this column exists to make visible.
"""
import unittest

import dayobjsheet as ds


HEADER = ["Day #", "Topic", "Skill type", "Pages (printed)", "Page overlap",
          "Primary SLO", "SLO role", "Primary SLO description",
          "Supporting SLOs", "Bloom's"]


def day(n, topic="t", objective_cell=None):
    row = ["Day %d" % n, topic, "", "", "", "U-05-CO-01", "primary",
           "Explain the couplets.", "", "apply"]
    if objective_cell is not None:
        row.append(objective_cell)
    return row


class WhereTheColumnGoes(unittest.TestCase):

    def test_it_sits_immediately_after_the_slo_sentence_it_corrects(self):
        self.assertEqual(ds.position(HEADER), 8)

    def test_a_tab_that_already_has_it_keeps_the_place_it_has(self):
        header = HEADER[:8] + [ds.COLUMN] + HEADER[8:]
        self.assertEqual(ds.position(header), 8)
        self.assertTrue(ds.present(header))

    def test_it_refuses_a_tab_with_no_slo_sentence_to_sit_after(self):
        self.assertRaises(ValueError, ds.position, ["Day #", "Topic"])


class TheIndexFromTheCorpus(unittest.TestCase):

    def test_it_keys_a_day_by_grade_chapter_and_day_number(self):
        segs = [{"chapter_number": 9, "segment_index": 8, "objective": u"x"}]
        self.assertEqual(ds.wanted(segs, 5), {(5, 9, 8): u"x"})

    def test_a_day_with_no_objective_is_not_in_it(self):
        segs = [{"chapter_number": 1, "segment_index": 1, "objective": u"x"},
                {"chapter_number": 1, "segment_index": 2}]
        self.assertEqual(list(ds.wanted(segs, 4)), [(4, 1, 1)])


class WhatEachRowGets(unittest.TestCase):

    def rows(self):
        return [["GRADE 5 \u2014 Urdu"] + [""] * 9,
                ["Chapter 9: Brave Driver"] + [""] * 9,
                day(1), day(2)]

    def test_a_matched_teaching_day_carries_its_own_objective(self):
        plan = ds.plan(HEADER, self.rows(), {(5, 9, 2): u"آج ہم پڑھتے ہیں۔"})
        self.assertEqual(plan.column[3], [u"آج ہم پڑھتے ہیں۔"])
        self.assertEqual(plan.written, 1)

    def test_a_day_nobody_wrote_for_stays_blank_rather_than_borrowing_one(self):
        # Dark stages stay dark: the 16 assessment days have no objective,
        # and an empty cell says so where a neighbour's sentence would lie.
        plan = ds.plan(HEADER, self.rows(), {(5, 9, 2): u"x"})
        self.assertEqual(plan.column[2], [""])
        self.assertEqual(plan.blank, 1)

    def test_a_row_that_is_not_a_teaching_day_is_blanked_never_echoed(self):
        # The rows are read before the column is inserted, so index 8 is
        # still `Supporting SLOs` -- echoing it copied 112 English rows of
        # SLO codes into the new column on the first run.
        rows = [["Chapter 9: Brave Driver"] + [""] * 7 + [u"E-01-VO-01"]]
        header = HEADER[:8] + [ds.COLUMN] + HEADER[8:]
        self.assertEqual(ds.plan(header, rows, {}).column, [[""]])

    def test_the_column_is_exactly_as_long_as_the_rows_it_was_given(self):
        self.assertEqual(len(ds.plan(HEADER, self.rows(), {}).column), 4)

    def test_a_row_that_ends_early_does_not_lose_its_place(self):
        # Sheets truncates trailing empties, so a row can end before the column.
        rows = [[u"GRADE 5 \u2014 Urdu"], ["Chapter 9: X"], ["Day 1", "t"]]
        plan = ds.plan(HEADER, rows, {(5, 9, 1): u"x"})
        self.assertEqual(plan.column, [[""], [""], [u"x"]])


class NothingIsLostAndNothingIsInvented(unittest.TestCase):

    def test_an_objective_that_found_no_row_is_reported_not_dropped(self):
        plan = ds.plan(HEADER, [[u"GRADE 5 \u2014 Urdu"], ["Chapter 9: X"], day(1)],
                       {(5, 9, 1): u"a", (5, 9, 7): u"b"})
        self.assertEqual(plan.unplaced, [(5, 9, 7)])

    def test_another_grades_row_never_takes_this_grades_sentence(self):
        # Five books share the English tab and five share the Urdu tab, and
        # chapter 9 day 1 exists in all of them.
        rows = [[u"GRADE 4 \u2014 Urdu"], ["Chapter 9: X"], day(1)]
        plan = ds.plan(HEADER, rows, {(5, 9, 1): u"grade five only"})
        self.assertEqual(plan.column[2], [""])
        self.assertEqual(plan.unplaced, [(5, 9, 1)])

    def test_a_day_row_before_any_banner_is_left_blank_not_guessed(self):
        plan = ds.plan(HEADER, [day(1)], {(5, 9, 1): u"x"})
        self.assertEqual(plan.column, [[""]])
        self.assertEqual(plan.unplaced, [(5, 9, 1)])


if __name__ == "__main__":
    unittest.main()
