# -*- coding: utf-8 -*-
"""bd-960al / bd-i0upq. The SLO sentences, written once each.

The tab is keyed by (code, sentence) and not by code. 171 codes carry more
than one sentence, 169 of them substantively different, so a tab with one
row per code would have to pick a winner -- and picking one would erase the
very disagreement bd-i0upq exists to surface.
"""
import unittest

import slotab

A = {"code": "E-03-GR-05", "sentence": "Use punctuation cues to aid reading.",
     "subject": "English", "grades": [3], "days": 2}
B = {"code": "E-03-GR-05", "sentence": "Use simple modal verbs.",
     "subject": "English", "grades": [3], "days": 2}
C = {"code": "E-04-RD-01", "sentence": "Read a short text aloud.",
     "subject": "English", "grades": [4], "days": 19}


class TheRows(unittest.TestCase):

    def setUp(self):
        self.rows = slotab.rows([A, B, C])
        self.head, self.body = self.rows[0], self.rows[1:]

    def test_a_colliding_code_keeps_both_sentences(self):
        said = [r[self.head.index("Sentence")] for r in self.body
                if r[self.head.index("SLO")] == "E-03-GR-05"]
        self.assertEqual(sorted(said), sorted([A["sentence"], B["sentence"]]))

    def test_a_colliding_code_says_so_on_every_one_of_its_rows(self):
        note = self.head.index("Note")
        notes = [r[note] for r in self.body
                 if r[self.head.index("SLO")] == "E-03-GR-05"]
        self.assertEqual(len(notes), 2)
        for n in notes:
            self.assertIn("2", n)
            self.assertIn("bd-i0upq", n)

    def test_a_code_that_says_one_thing_is_not_flagged(self):
        note = self.head.index("Note")
        row = [r for r in self.body
               if r[self.head.index("SLO")] == "E-04-RD-01"][0]
        self.assertEqual(row[note], "")

    def test_the_day_count_rides_along(self):
        i = self.head.index("Days")
        row = [r for r in self.body
               if r[self.head.index("SLO")] == "E-04-RD-01"][0]
        self.assertEqual(row[i], 19)

    def test_rows_are_in_code_order_so_the_tab_can_be_scanned(self):
        codes = [r[self.head.index("SLO")] for r in self.body]
        self.assertEqual(codes, sorted(codes))


class TheReverseLookup(unittest.TestCase):

    def test_each_pair_resolves_to_its_own_row(self):
        rows = slotab.rows([A, B, C])
        idx = slotab.index([A, B, C])
        self.assertNotEqual(idx[(A["code"], A["sentence"])],
                            idx[(B["code"], B["sentence"])])
        off = idx[(B["code"], B["sentence"])]
        head = rows[0]
        self.assertEqual(rows[off][head.index("Sentence")], B["sentence"])

    def test_a_pair_that_was_never_seen_is_absent(self):
        self.assertNotIn(("E-03-GR-05", "something else"),
                         slotab.index([A, B, C]))


class TheCodeCell(unittest.TestCase):
    """The day row's code cell: the codes it always had, now each a link."""

    def test_every_code_gets_its_own_run(self):
        cell = slotab.code_cell(["E-01-RD-01", "E-01-RD-02"],
                                {"E-01-RD-01": "u1", "E-01-RD-02": "u2"})
        self.assertEqual([cell["text"][r["start"]:r["end"]]
                          for r in cell["runs"]],
                         ["E-01-RD-01", "E-01-RD-02"])
        self.assertEqual([r["uri"] for r in cell["runs"]], ["u1", "u2"])

    def test_the_text_is_the_codes_exactly_as_the_column_held_them(self):
        cell = slotab.code_cell(["E-01-RD-01", "E-01-RD-02"], {})
        self.assertEqual(cell["text"], "E-01-RD-01, E-01-RD-02")

    def test_a_code_that_is_a_prefix_of_the_next_gets_its_own_run(self):
        # "E-03-GR-1" is a substring of "E-03-GR-11"; a run located by a
        # plain search would put the second code's link on the first.
        cell = slotab.code_cell(["E-03-GR-1", "E-03-GR-11"],
                                {"E-03-GR-1": "a", "E-03-GR-11": "b"})
        self.assertEqual([cell["text"][r["start"]:r["end"]]
                          for r in cell["runs"]],
                         ["E-03-GR-1", "E-03-GR-11"])

    def test_a_code_with_no_row_is_left_unlinked_rather_than_guessed(self):
        cell = slotab.code_cell(["E-01-RD-01", "E-01-RD-02"],
                                {"E-01-RD-01": "u1"})
        self.assertEqual(len(cell["runs"]), 1)
        self.assertEqual(cell["text"], "E-01-RD-01, E-01-RD-02")

    def test_no_codes_means_no_cell(self):
        self.assertIsNone(slotab.code_cell([], {}))


if __name__ == "__main__":
    unittest.main()
