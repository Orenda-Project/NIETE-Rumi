# -*- coding: utf-8 -*-
"""bd-960al. The Moves column, replaced by a label that points at the spine.

The guarantee under test is that nothing is invented. A cell that does not
parse as one of the twenty-two spines is reported, not relabelled: the
lookup is keyed by the JSON precisely so that a row whose Moves cell
disagrees with its skill type keeps its disagreement instead of having a
plausible label written over it.
"""
import json
import unittest

import movesrun
import spinetab
import stagec
import stagec_spines as sp
import tabs

SPINE = sp.SPINES[("decoding", "G3-5")]
JSON = stagec.format_moves(SPINE)
GID, SPINES_GID = 7, 99


def plan(*rows, **kw):
    header = list(tabs.header("English"))
    body = [list(r) + [""] * (len(header) - len(r)) for r in rows]
    return movesrun.plan("English", GID, header, body, spinetab.index(),
                         SPINES_GID, **kw)


def row(day, moves):
    header = list(tabs.header("English"))
    out = [""] * len(header)
    out[0] = day
    out[header.index("Moves")] = moves
    return out


class ThePlan(unittest.TestCase):

    def test_a_day_row_gets_the_label_in_place_of_the_json(self):
        reqs, tally, un = plan(row("GRADE 3", ""), row("Day 1", JSON))
        self.assertEqual(tally["matched"], 1)
        self.assertEqual(un, [])
        cell = reqs[0]["updateCells"]["rows"][0]["values"][0]
        self.assertEqual(cell["userEnteredValue"]["stringValue"],
                         u"decoding · G3-5")

    def test_the_label_carries_the_spine_row_on_a_link(self):
        reqs, _, _ = plan(row("GRADE 3", ""), row("Day 1", JSON))
        run = reqs[0]["updateCells"]["rows"][0]["values"][0]["textFormatRuns"]
        uri = [r["format"]["link"]["uri"] for r in run if r["format"].get("link")]
        self.assertEqual(len(uri), 1)
        self.assertIn("gid=%d" % SPINES_GID, uri[0])
        off = spinetab.index()[JSON][1]
        self.assertIn("range=G%d" % spinetab.sheet_row(off), uri[0])

    def test_the_label_is_a_fraction_of_the_json_it_replaces(self):
        reqs, _, _ = plan(row("GRADE 3", ""), row("Day 1", JSON))
        label = reqs[0]["updateCells"]["rows"][0]["values"][0][
            "userEnteredValue"]["stringValue"]
        self.assertLess(len(label), len(JSON) / 5)

    def test_a_cell_written_with_loose_spacing_still_matches(self):
        loose = json.dumps([[p, m] for p, m in SPINE])
        _, tally, un = plan(row("GRADE 3", ""), row("Day 1", loose))
        self.assertEqual((tally["matched"], un), (1, []))

    def test_a_cell_that_is_not_a_spine_is_reported_and_left_alone(self):
        reqs, tally, un = plan(row("GRADE 3", ""), row("Day 1", '[["warm_up",40]]'))
        self.assertEqual(reqs, [])
        self.assertEqual(tally["unmatched"], 1)
        self.assertEqual(un[0]["row"], 5)

    def test_a_cell_already_holding_a_label_is_left_alone(self):
        """The pass is idempotent: a second run must not relabel a label."""
        reqs, tally, un = plan(row("GRADE 3", ""),
                               row("Day 1", u"decoding · G3-5"))
        self.assertEqual((reqs, un), ([], []))
        self.assertEqual(tally["done"], 1)

    def test_an_empty_moves_cell_is_neither_written_nor_reported(self):
        reqs, tally, un = plan(row("GRADE 3", ""), row("Day 1", ""))
        self.assertEqual((reqs, un, tally["empty"]), ([], [], 1))

    def test_a_banner_row_is_not_touched(self):
        reqs, tally, _ = plan(row("GRADE 3", ""), row("CHAPTER 2", JSON))
        self.assertEqual(reqs, [])
        self.assertEqual(tally["matched"], 0)

    def test_the_row_number_is_the_one_a_reader_can_click(self):
        reqs, _, _ = plan(row("GRADE 3", ""), row("Day 1", JSON))
        # header row 3, banner row 4, first day row 5 -> 0-based 4
        rng = reqs[0]["updateCells"]["range"]
        self.assertEqual((rng["startRowIndex"], rng["endRowIndex"]), (4, 5))


class TheLabels(unittest.TestCase):

    def test_every_label_the_pass_can_write_exists_on_the_spine_tab(self):
        rows = spinetab.spine_rows()
        for label, off in spinetab.index().values():
            self.assertEqual(rows[off][0], label)

    def test_the_link_points_at_the_json_column(self):
        self.assertEqual(spinetab.COLUMNS[
            movesrun.ANCHOR_COL_INDEX], "Moves (JSON)")


if __name__ == "__main__":
    unittest.main()
