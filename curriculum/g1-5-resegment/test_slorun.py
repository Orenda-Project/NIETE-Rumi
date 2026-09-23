# -*- coding: utf-8 -*-
"""bd-960al. The supporting-SLO sentences, taken off the day rows.

Two refusals are what these tests are for. A day row whose code count and
sentence count disagree is reported and left whole -- pairing those by
position would invent an SLO's meaning. And a cell is linked from the pair
the row itself carries, never from the code alone, because 171 codes carry
more than one sentence (bd-i0upq) and the row knows which one it used.
"""
import unittest

import slorun
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


class ThePlan(unittest.TestCase):

    def setUp(self):
        self.pairs, _ = slorun.pairs_of(HEAD, BODY, "English")
        self.offsets = {}
        for n, p in enumerate(sorted(self.pairs,
                                     key=lambda x: (x["code"],
                                                    x["sentence"]))):
            self.offsets[(p["code"], p["sentence"])] = n + 1
        self.reqs, self.tally, self.skipped = slorun.plan(
            HEAD, BODY, gid=7, offsets=self.offsets, lookup_gid=99)

    def test_one_request_per_row_that_has_supporting_slos(self):
        self.assertEqual(self.tally["linked"], 2)

    def test_the_cell_keeps_its_codes_and_gains_the_links(self):
        cell = self.reqs[0]["updateCells"]["rows"][0]["values"][0]
        self.assertEqual(cell["userEnteredValue"]["stringValue"],
                         "E-03-GR-05, E-03-OC-02")
        runs = cell["textFormatRuns"]
        # Two links with a separator between them: the plain run in the
        # middle is what stops the first link swallowing the ", ".
        self.assertEqual([bool(r["format"]) for r in runs],
                         [True, False, True])
        self.assertEqual([r["startIndex"] for r in runs], [0, 10, 12])

    def test_the_two_uses_of_one_code_point_at_different_rows(self):
        got = []
        for r in self.reqs:
            for run in r["updateCells"]["rows"][0]["values"][0][
                    "textFormatRuns"]:
                uri = run["format"]["link"]["uri"]
                if "E-03-GR-05" in str(r):
                    got.append(uri)
                    break
        self.assertEqual(len(got), 2)
        self.assertNotEqual(got[0], got[1])

    def test_the_request_lands_on_the_supporting_slos_column(self):
        rng = self.reqs[0]["updateCells"]["range"]
        self.assertEqual(rng["startColumnIndex"], HEAD.index("Supporting SLOs"))
        self.assertEqual(rng["sheetId"], 7)

    def test_the_row_number_is_the_one_a_reader_can_click(self):
        # BODY[1] is the first day row; the header is sheet row 3, so the
        # first body row is sheet row 4 and BODY[1] is sheet row 5.
        rng = self.reqs[0]["updateCells"]["range"]
        self.assertEqual((rng["startRowIndex"], rng["endRowIndex"]), (4, 5))

    def test_a_pair_with_no_row_on_the_lookup_is_reported_not_guessed(self):
        reqs, tally, skipped = slorun.plan(HEAD, BODY, gid=7, offsets={},
                                           lookup_gid=99)
        self.assertEqual(reqs, [])
        self.assertEqual(tally["linked"], 0)
        self.assertEqual(len(skipped), 2)

    def test_a_banner_row_is_never_written(self):
        rows = [r["updateCells"]["range"]["startRowIndex"] for r in self.reqs]
        self.assertNotIn(3, rows)          # the GRADE 3 banner


class TheBareCodes(unittest.TestCase):
    """A row that lists codes and no sentences still wants its links."""

    ROW = [[u"✅ Ch. Assessment", "T", "", "", "E-03-OC-02, E-03-GR-05", "",
            ""]]

    def setUp(self):
        self.pairs, _ = slorun.pairs_of(HEAD, BODY, "English")
        self.offsets = slotab.index(self.pairs)

    def test_a_code_with_one_wording_is_linked(self):
        reqs, tally, skipped = slorun.plan(
            HEAD, self.ROW, gid=7, offsets=self.offsets, lookup_gid=99)
        runs = reqs[0]["updateCells"]["rows"][0]["values"][0]["textFormatRuns"]
        linked = [r for r in runs if r["format"]]
        self.assertEqual(len(linked), 1)
        self.assertEqual(linked[0]["startIndex"], 0)   # E-03-OC-02 only
        self.assertEqual(tally["bare"], 1)

    def test_a_code_with_two_wordings_is_left_unlinked(self):
        # E-03-GR-05 says two different things on this sheet. Without a
        # sentence on the row there is no way to know which, and a link to
        # the wrong one would read as authority.
        reqs, _, _ = slorun.plan(HEAD, self.ROW, gid=7,
                                 offsets=self.offsets, lookup_gid=99)
        cell = reqs[0]["updateCells"]["rows"][0]["values"][0]
        uris = [r["format"]["link"]["uri"] for r in cell["textFormatRuns"]
                if r["format"]]
        self.assertEqual(len(uris), 1)

    def test_the_codes_are_left_exactly_as_they_were(self):
        reqs, _, _ = slorun.plan(HEAD, self.ROW, gid=7,
                                 offsets=self.offsets, lookup_gid=99)
        self.assertEqual(
            reqs[0]["updateCells"]["rows"][0]["values"][0][
                "userEnteredValue"]["stringValue"],
            "E-03-OC-02, E-03-GR-05")


class TheRebuildGuard(unittest.TestCase):
    """Once the column is gone the sheet can no longer produce the pairs."""

    def test_the_lookup_can_be_rebuilt_while_the_column_is_there(self):
        self.assertTrue(slorun.rebuildable([HEAD, HEAD]))

    def test_a_sheet_that_has_lost_the_column_cannot_rebuild_the_lookup(self):
        # `pairs_of` reads the sentences off the day rows. With the column
        # deleted it would find only the primary ones, and a --write would
        # overwrite the lookup tab with a fraction of itself.
        gone = [h for h in HEAD if h != "Supporting SLO descriptions"]
        self.assertFalse(slorun.rebuildable([gone, gone]))

    def test_one_tab_keeping_the_column_is_enough_to_rebuild(self):
        gone = [h for h in HEAD if h != "Supporting SLO descriptions"]
        self.assertTrue(slorun.rebuildable([gone, HEAD]))


if __name__ == "__main__":
    unittest.main()
