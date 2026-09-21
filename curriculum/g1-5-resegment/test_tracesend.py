# -*- coding: utf-8 -*-
"""Turning a trace cell into Sheets requests, without calling Sheets.

A multi-link cell is textFormatRuns, which is a cell-level field and not
part of userEnteredFormat. Two rules bite: the runs must be ascending,
and a run that opens a link must be closed by a plain run or the link
bleeds to the end of the cell -- a page 3 link swallowing pages 4 and 5.
A closing run at the very end of the string is out of range and is
dropped instead.

house rule (traces.md): rich-text link runs, never =HYPERLINK().
"""
import unittest

import tracesend as s


class TheRunsAreWellFormed(unittest.TestCase):

    CELL = {"text": u"pg 2·3", "runs": [{"start": 3, "end": 4, "uri": "u2"},
                                             {"start": 5, "end": 6, "uri": "u3"}]}

    def runs(self):
        req = s.rich_cell(12345, 3, 30, self.CELL)
        return req["updateCells"]["rows"][0]["values"][0]["textFormatRuns"]

    def test_the_first_run_starts_at_zero(self):
        self.assertEqual(self.runs()[0]["startIndex"], 0)

    def test_the_runs_ascend(self):
        idx = [r["startIndex"] for r in self.runs()]
        self.assertEqual(idx, sorted(set(idx)))

    def test_each_link_is_closed_before_the_next_page(self):
        by = dict((r["startIndex"], r["format"]) for r in self.runs())
        self.assertIn("link", by[3])
        self.assertNotIn("link", by[4], "the page 2 link bled onto the separator")
        self.assertIn("link", by[5])

    def test_a_link_ending_at_the_string_end_needs_no_closing_run(self):
        """startIndex == len(text) is out of range and Sheets rejects it."""
        idx = [r["startIndex"] for r in self.runs()]
        self.assertTrue(max(idx) < len(self.CELL["text"]), idx)

    def test_the_text_and_the_field_mask_go_together(self):
        req = s.rich_cell(12345, 3, 30, self.CELL)["updateCells"]
        v = req["rows"][0]["values"][0]
        self.assertEqual(v["userEnteredValue"]["stringValue"], self.CELL["text"])
        self.assertEqual(req["fields"], "userEnteredValue,textFormatRuns")

    def test_it_writes_the_cell_it_was_given(self):
        rng = s.rich_cell(12345, 3, 30, self.CELL)["updateCells"]["range"]
        self.assertEqual((rng["sheetId"], rng["startRowIndex"],
                          rng["startColumnIndex"]), (12345, 3, 30))
        self.assertEqual((rng["endRowIndex"], rng["endColumnIndex"]), (4, 31))


class TheSingleLinkCell(unittest.TestCase):

    def test_a_whole_cell_link_has_one_run_and_no_closer(self):
        req = s.link_cell(9, 5, 31, "open", "https://example/x")
        runs = req["updateCells"]["rows"][0]["values"][0]["textFormatRuns"]
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]["startIndex"], 0)
        self.assertEqual(runs[0]["format"]["link"]["uri"], "https://example/x")


class TheBatching(unittest.TestCase):
    """Sheets caps a batch; traces.md says ~400 sub-requests per call."""

    def test_requests_are_chunked(self):
        got = list(s.chunks(list(range(950)), 400))
        self.assertEqual([len(c) for c in got], [400, 400, 150])

    def test_an_empty_list_sends_nothing(self):
        self.assertEqual(list(s.chunks([], 400)), [])


if __name__ == "__main__":
    unittest.main()
