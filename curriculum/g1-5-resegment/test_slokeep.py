# -*- coding: utf-8 -*-
"""Nothing leaves the sheet that the sheet does not already hold elsewhere.

bd-960al. `--drop-column` deletes a column of 200,018 characters. The
lookup tab holds all but two of those sentences -- the two live on rows
whose code and sentence counts disagree, which `pairs_of` skips whole, so
they never reached the lookup and a delete would simply lose them.

The property under test is the one that makes the delete safe: every
sentence in the column is either already on the lookup tab or written
into the row's own `Flags` cell first, and a tab where that cannot be
arranged is refused rather than dropped.
"""
import unittest

import slokeep


HEAD = ["Day #", "Topic", "Supporting SLOs",
        "Supporting SLO descriptions", "Flags"]


def row(day, codes, descs, flags=""):
    return [day, "t", codes, descs, flags]


class TheOrphans(unittest.TestCase):

    def test_a_sentence_the_lookup_holds_is_not_an_orphan(self):
        body = [row("Day 1", "E-01-RD-01", "Reads a word.")]
        self.assertEqual(
            slokeep.orphans(HEAD, body, {"Reads a word."}), [])

    def test_a_sentence_the_lookup_lacks_is_reported_with_its_row(self):
        body = [row("Day 1", "A, B", "Consolidates the chapter. | Reads.")]
        found = slokeep.orphans(HEAD, body, {"Reads."})
        self.assertEqual([(f["row"], f["sentences"]) for f in found],
                         [(4, [u"Consolidates the chapter."])])

    def test_a_row_that_is_not_a_day_is_not_read(self):
        # A grade banner's first cell spills across the row; whatever
        # lands under the descriptions column there is not a sentence.
        body = [["GRADE 5", "", "", "Banner spill", ""]]
        self.assertEqual(slokeep.orphans(HEAD, body, set()), [])

    def test_a_tab_that_has_already_lost_the_column_has_no_orphans(self):
        head = ["Day #", "Topic", "Supporting SLOs", "Flags"]
        self.assertEqual(
            slokeep.orphans(head, [["Day 1", "t", "A", ""]], set()), [])


class TheRescue(unittest.TestCase):

    def test_the_orphan_is_written_into_the_rows_flags_cell(self):
        body = [row("Day 1", "A, B", "Consolidates the chapter. | Reads.")]
        found = slokeep.orphans(HEAD, body, {"Reads."})
        reqs = slokeep.rescue(HEAD, body, 77, found)
        cell = reqs[0]["updateCells"]
        self.assertEqual(cell["range"]["sheetId"], 77)
        self.assertEqual(cell["range"]["startColumnIndex"], 4)  # Flags
        self.assertEqual(cell["range"]["startRowIndex"], 3)     # row 4
        text = cell["rows"][0]["values"][0]["userEnteredValue"]["stringValue"]
        self.assertIn(u"Consolidates the chapter.", text)

    def test_an_existing_flag_is_kept_and_the_orphan_added_to_it(self):
        body = [row("Day 1", "A, B", "Consolidates. | Reads.",
                    u"folded revision")]
        found = slokeep.orphans(HEAD, body, {"Reads."})
        text = (slokeep.rescue(HEAD, body, 77, found)[0]["updateCells"]
                ["rows"][0]["values"][0]["userEnteredValue"]["stringValue"])
        self.assertTrue(text.startswith(u"folded revision"))
        self.assertIn(u"Consolidates.", text)

    def test_nothing_to_rescue_asks_for_nothing(self):
        self.assertEqual(slokeep.rescue(HEAD, [], 77, []), [])


class TheGuard(unittest.TestCase):

    def test_a_tab_whose_orphans_are_all_rescued_may_be_dropped(self):
        body = [row("Day 1", "A, B", "Consolidates. | Reads.")]
        found = slokeep.orphans(HEAD, body, {"Reads."})
        req = slokeep.drop_column(HEAD, 77, found)
        self.assertEqual(req["deleteDimension"]["range"]["startIndex"], 3)

    def test_a_tab_with_no_flags_column_is_refused_not_dropped(self):
        # Nowhere to put the sentence, so the delete would lose it.
        head = ["Day #", "Topic", "Supporting SLOs",
                "Supporting SLO descriptions"]
        body = [["Day 1", "t", "A, B", "Consolidates. | Reads."]]
        found = slokeep.orphans(head, body, {"Reads."})
        self.assertRaises(slokeep.Unsafe,
                          slokeep.drop_column, head, 77, found)

    def test_a_tab_that_has_already_lost_the_column_is_a_quiet_no_op(self):
        head = ["Day #", "Topic", "Supporting SLOs", "Flags"]
        self.assertIsNone(slokeep.drop_column(head, 77, []))


if __name__ == "__main__":
    unittest.main()
