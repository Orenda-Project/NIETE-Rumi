# -*- coding: utf-8 -*-
"""Building the write payload is pure and tested; only the send is I/O.

The whole-column strategy means every cell in a column is sent, including the
ones Stage C must not change. Those must carry their CURRENT value through
untouched, so a bug here does not blank a chapter header or an assessment row.
"""
import unittest

import stagec_write as w

HEADER = ["Day #", "Topic", "Moves", "Reading strategy", "Strand",
          "Prerequisite SLOs"]

ROWS = [
    {"_row": 4, "kind": "grade_banner", "grade": 1,
     "cells": {"Day #": "GRADE 1", "Moves": "", "Reading strategy": "",
               "Strand": "", "Prerequisite SLOs": ""}},
    {"_row": 5, "kind": "chapter_header", "grade": 1,
     "cells": {"Day #": "Chapter 1: Hello", "Moves": "", "Reading strategy": "",
               "Strand": "", "Prerequisite SLOs": ""}},
    {"_row": 6, "kind": "day", "grade": 1,
     "cells": {"Day #": "Day 1", "Moves": "pending", "Reading strategy": "pending",
               "Strand": "input", "Prerequisite SLOs": "pending"}},
    {"_row": 7, "kind": "assessment", "grade": 1,
     "cells": {"Day #": "✅ Ch. Assessment", "Moves": "pending",
               "Reading strategy": "", "Strand": "", "Prerequisite SLOs": ""}},
]

NEW = {6: {"Moves": "warm_up·40", "Reading strategy": "predict",
           "Prerequisite SLOs": "none"},
       7: {"Moves": "announce·40"}}


class ColumnLetters(unittest.TestCase):
    def test_the_first_columns(self):
        self.assertEqual(w.col_letter(0), "A")
        self.assertEqual(w.col_letter(12), "M")
        self.assertEqual(w.col_letter(25), "Z")

    def test_it_carries_past_z(self):
        self.assertEqual(w.col_letter(26), "AA")
        self.assertEqual(w.col_letter(35), "AJ")


class ThePayload(unittest.TestCase):
    def setUp(self):
        self.p = w.build_payload(u"English G1–5", HEADER, ROWS, NEW,
                                 ["Moves", "Reading strategy", "Prerequisite SLOs"])
        self.by_range = {r["range"]: r["values"] for r in self.p}

    def test_one_value_range_per_written_column(self):
        self.assertEqual(len(self.p), 3)

    def test_the_range_spans_the_data_rows_only(self):
        self.assertIn(u"'English G1–5'!C4:C7", self.by_range)

    def test_a_new_value_lands_on_its_row(self):
        self.assertEqual(self.by_range[u"'English G1–5'!C4:C7"][2],
                         ["warm_up·40"])

    def test_an_untouched_row_carries_its_current_value(self):
        block = self.by_range[u"'English G1–5'!C4:C7"]
        self.assertEqual(block[0], [""])
        self.assertEqual(block[1], [""])

    def test_a_column_stage_c_does_not_write_is_never_sent(self):
        self.assertFalse(any("!E" in r for r in self.by_range))

    def test_an_assessment_row_keeps_its_blank_on_a_day_only_column(self):
        block = self.by_range[u"'English G1–5'!D4:D7"]
        self.assertEqual(block[3], [""])

    def test_no_pending_survives_in_a_written_column(self):
        for values in self.by_range.values():
            self.assertNotIn(["pending"], values)


class ThePayloadRefusesToLie(unittest.TestCase):
    def test_a_row_not_in_the_tab_is_refused(self):
        with self.assertRaises(KeyError):
            w.build_payload(u"English G1–5", HEADER, ROWS,
                            {999: {"Moves": "x"}}, ["Moves"])

    def test_writing_a_column_absent_from_the_header_is_refused(self):
        with self.assertRaises(KeyError):
            w.build_payload(u"English G1–5", HEADER, ROWS, NEW, ["Function"])

    def test_a_value_for_a_column_not_being_written_is_refused(self):
        with self.assertRaises(ValueError):
            w.build_payload(u"English G1–5", HEADER, ROWS,
                            {6: {"Strand": "output"}}, ["Moves"])


class TheReadBack(unittest.TestCase):
    def test_it_reports_every_cell_that_did_not_land(self):
        got = {6: {"Moves": "warm_up·40", "Reading strategy": "predict",
                   "Prerequisite SLOs": "none"},
               7: {"Moves": "announce·39"}}
        bad = w.diff_readback(NEW, got)
        self.assertEqual(len(bad), 1)
        self.assertIn("7", bad[0])
        self.assertIn("Moves", bad[0])

    def test_a_clean_read_back_is_empty(self):
        self.assertEqual(w.diff_readback(NEW, NEW), [])

    def test_a_row_that_vanished_is_a_finding(self):
        self.assertTrue(w.diff_readback(NEW, {6: NEW[6]}))


if __name__ == "__main__":
    unittest.main()


class MergingDerivedWithWorkerCells(unittest.TestCase):
    """The sheet gets one write per column, so the derived columns and the
    swarm's columns must be assembled before anything is sent."""

    ROWS = [
        {"_row": 5, "kind": "chapter_header", "grade": 1, "cells": {}},
        {"_row": 6, "kind": "day", "grade": 1,
         "cells": {"Skill type": "Vocabulary & grammar"}},
        {"_row": 7, "kind": "assessment", "grade": 1, "cells": {}},
        {"_row": 8, "kind": "review", "grade": 1, "cells": {}},
    ]

    def merged(self, worker=None):
        return w.merge_cells(self.ROWS, "English",
                             worker if worker is not None else {6: {"Gap": "one-way"}})

    def test_a_day_row_gets_moves_and_teacher_primary_and_the_worker_cells(self):
        m = self.merged()[6]
        self.assertIn("Moves", m)
        self.assertIn("Teacher-primary min (of 40)", m)
        self.assertEqual(m["Gap"], "one-way")

    def test_moves_arrive_as_a_cell_value_not_a_python_list(self):
        """These dicts go straight to build_payload and on to the sheet."""
        self.assertIsInstance(self.merged()[6]["Moves"], str)

    def test_teacher_primary_is_derived_from_the_moves_it_ships_with(self):
        import stagec
        m = self.merged()[6]
        self.assertEqual(int(m["Teacher-primary min (of 40)"]),
                         stagec.teacher_primary_min(
                             stagec.parse_moves(m["Moves"])))

    def test_an_assessment_row_gets_moves_and_nothing_else(self):
        self.assertEqual(list(self.merged()[7]), ["Moves"])

    def test_a_review_row_gets_moves_and_nothing_else(self):
        self.assertEqual(list(self.merged()[8]), ["Moves"])

    def test_a_chapter_header_gets_nothing(self):
        self.assertNotIn(5, self.merged())

    def test_worker_cells_for_a_non_day_row_are_refused(self):
        with self.assertRaises(ValueError):
            self.merged({7: {"Gap": "one-way"}})

    def test_a_worker_cell_colliding_with_a_derived_column_is_refused(self):
        with self.assertRaises(ValueError):
            self.merged({6: {"Moves": "warm_up·40"}})
