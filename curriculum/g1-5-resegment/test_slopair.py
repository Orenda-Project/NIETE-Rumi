# -*- coding: utf-8 -*-
"""The pairs the subject tabs use, read out of the rows.

bd-960al. A row is read only when its code count and its sentence count
agree. A row where they disagree is reported and left whole: pairing
those by position would invent an SLO's meaning, and there are exactly
two such rows on the sheet.
"""
import unittest

import slopair as slorun
import slotab

HEAD = ["Day #", "Topic", "Primary SLO", "Primary SLO description",
        "Supporting SLOs", "Supporting SLO descriptions", "Bloom's"]
BODY = [
    ["GRADE 3", "", "", "", "", "", ""],
    ["Day 1", "Nouns", "E-03-RD-01", "Read a short text.",
     "E-03-GR-05, E-03-OC-02", "Use punctuation cues. | Speak in turn.", "U"],
    ["Day 2", "Verbs", "E-03-RD-01", "Read a short text.",
     "E-03-GR-05", "Use simple modal verbs.", "A"],
    ["Chapter 2: Animals", "", "", "", "", "", ""],
    ["Day 3", "Plurals", "E-03-GR-05", "Use punctuation cues.",
     "", "", "R"],
]


class ThePairs(unittest.TestCase):

    def setUp(self):
        self.pairs, self.bad = slorun.pairs_of(HEAD, BODY, "English")

    def test_a_code_used_twice_is_one_pair_carrying_two_days(self):
        p = [x for x in self.pairs
             if (x["code"], x["sentence"]) == ("E-03-RD-01",
                                               "Read a short text.")]
        self.assertEqual(len(p), 1)
        self.assertEqual(p[0]["days"], 2)

    def test_one_code_with_two_sentences_makes_two_pairs(self):
        said = sorted(x["sentence"] for x in self.pairs
                      if x["code"] == "E-03-GR-05")
        self.assertEqual(said, ["Use punctuation cues.",
                                "Use simple modal verbs."])

    def test_the_primary_column_is_read_too_so_the_tab_is_complete(self):
        self.assertIn(("E-03-RD-01", "Read a short text."),
                      [(x["code"], x["sentence"]) for x in self.pairs])

    def test_the_grade_comes_from_the_banner_the_row_sits_under(self):
        p = [x for x in self.pairs if x["code"] == "E-03-OC-02"][0]
        self.assertEqual(p["grades"], [3])
        self.assertEqual(p["subject"], "English")

    def test_a_row_with_no_supporting_slos_contributes_none(self):
        self.assertNotIn("", [x["code"] for x in self.pairs])

    def test_counts_that_disagree_are_reported_and_not_paired(self):
        body = [["Day 9", "T", "", "", "A-01, A-02", "only one sentence", ""]]
        pairs, bad = slorun.pairs_of(HEAD, body, "English")
        self.assertEqual([b["row"] for b in bad], [4])
        self.assertEqual(pairs, [])

    def test_codes_with_no_sentence_column_are_not_a_defect(self):
        # The assessment and review rows echo every code of the chapter --
        # up to eighteen of them -- and carry no sentences at all. That is
        # the shape they are authored in, not a row that lost its data.
        body = [[u"✅ Ch. Assessment", "T", "", "", "A-01, A-02", "", ""]]
        pairs, bad = slorun.pairs_of(HEAD, body, "English")
        self.assertEqual(bad, [])
        self.assertEqual(pairs, [])


class TheMerge(unittest.TestCase):
    """Four tabs, one lookup. A pair seen twice is one row, not two."""

    def test_days_and_grades_add_up_across_tabs(self):
        a = [{"code": "E-01-RD-01", "sentence": "Read.", "subject": "English",
              "grades": [1], "days": 3}]
        b = [{"code": "E-01-RD-01", "sentence": "Read.", "subject": "English",
              "grades": [2], "days": 4}]
        out = slorun.merge([a, b])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["days"], 7)
        self.assertEqual(out[0]["grades"], [1, 2])

    def test_two_sentences_under_one_code_stay_two_rows(self):
        a = [{"code": "E-01-RD-01", "sentence": "Read.", "subject": "English",
              "grades": [1], "days": 1}]
        b = [{"code": "E-01-RD-01", "sentence": "Read aloud.",
              "subject": "English", "grades": [1], "days": 1}]
        self.assertEqual(len(slorun.merge([a, b])), 2)


if __name__ == "__main__":
    unittest.main()
