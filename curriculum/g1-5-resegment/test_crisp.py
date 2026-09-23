# -*- coding: utf-8 -*-
"""Migrating the live tabs: what gets sent, and what the Moves cells become.

Stage C wrote 12,655 values onto these four tabs. The migration is column
deletes plus one rename plus a rewrite of a single column, so the tests
pin the shape of the requests rather than a rendered grid: a wrong order
here is the difference between deleting `Period (min)` and deleting
`Moves`.
"""
import json
import unittest

import crisp
import crispplan
import stagec
import tabs

STAMP = "2026-09-21"
LIVE = (["Day #", "Topic", "Skill type", "Pages (printed)", "Page overlap",
         "Primary SLO", "SLO role", "Primary SLO description",
         "Supporting SLOs", "Bloom's",
         "Period (min)", "Moves", "Reading strategy",
         "Collaboration structure", "FDE syllabus", "Prerequisite SLOs",
         "Teacher-primary min (of 40)", "Flags", "A Page truth",
         "B Segmentation", "C Enrichment", "C-gate Enrich gate",
         "D0 Slide script", "D Render meta", "E Voicenote script",
         "J Pedagogy review", "J Design review", "F LP (latest PDF)",
         "Human reviewer", "Review status"])
PIPE = u"warm_up·3 | hook·3 | explain·8 | guided·10 | independent·13 | exit·3"


def reqs():
    return crisp.requests(77, crispplan.plan(LIVE, tabs.header("Science")),
                          STAMP)


class TheRequests(unittest.TestCase):
    def test_the_rename_is_sent_before_any_delete(self):
        kinds = [list(r)[0] for r in reqs()]
        self.assertEqual(kinds[0], "updateCells")
        self.assertEqual(set(kinds[1:]), {"deleteDimension"})

    def test_the_rename_carries_the_build_stamp(self):
        v = reqs()[0]["updateCells"]["rows"][0]["values"][0]
        self.assertEqual(v["userEnteredValue"]["stringValue"],
                         "Traces (%s)" % STAMP)

    def test_the_rename_lands_on_the_live_index_not_the_target_one(self):
        """It is sent first, so the column has not moved yet."""
        rng = reqs()[0]["updateCells"]["range"]
        self.assertEqual(rng["startColumnIndex"], LIVE.index("A Page truth"))
        self.assertEqual(rng["startRowIndex"], crisp.HEAD_ROW - 1)

    def test_the_deletes_descend_so_no_index_shifts_under_another(self):
        starts = [r["deleteDimension"]["range"]["startIndex"] for r in reqs()[1:]]
        self.assertEqual(starts, sorted(starts, reverse=True))

    def test_each_delete_removes_exactly_one_column(self):
        for r in reqs()[1:]:
            rng = r["deleteDimension"]["range"]
            self.assertEqual(rng["endIndex"] - rng["startIndex"], 1)
            self.assertEqual(rng["dimension"], "COLUMNS")

    def test_it_deletes_period_and_fde_and_leaves_moves_alone(self):
        gone = set(r["deleteDimension"]["range"]["startIndex"] for r in reqs()[1:])
        self.assertIn(LIVE.index("Period (min)"), gone)
        self.assertIn(LIVE.index("FDE syllabus"), gone)
        self.assertNotIn(LIVE.index("Moves"), gone)
        self.assertNotIn(LIVE.index("A Page truth"), gone)


class TheMovesRewrite(unittest.TestCase):
    """The pipe form becomes JSON, and nothing else in the column moves."""

    HEAD = tabs.header("Science")
    I = HEAD.index("Moves")

    def rows(self, *cells):
        out = []
        for a, m in cells:
            row = [a] + [""] * (len(self.HEAD) - 1)
            row[self.I] = m
            out.append(row)
        return out

    def run_it(self, *cells):
        return crisp.moves_values(self.HEAD, self.rows(*cells))

    def test_a_pipe_spine_becomes_json_pairs(self):
        vals, _ = self.run_it(("Day 1", PIPE))
        self.assertEqual(json.loads(vals[0][0]),
                         [["warm_up", 3], ["hook", 3], ["explain", 8],
                          ["guided", 10], ["independent", 13], ["exit", 3]])

    def test_the_minutes_survive_the_rewrite(self):
        vals, _ = self.run_it(("Day 1", PIPE))
        after = stagec.parse_moves(vals[0][0])
        self.assertEqual(sum(m for _, m in after), 40)

    def test_a_cell_already_in_json_is_left_exactly_as_it_is(self):
        already = stagec.format_moves([("warm_up", 5), ("exit", 3)])
        vals, t = self.run_it(("Day 1", already))
        self.assertEqual(vals[0][0], already)
        self.assertEqual(t["converted"], 0)

    def test_a_pending_cell_stays_pending(self):
        vals, t = self.run_it(("Day 9", stagec.PENDING))
        self.assertEqual(vals[0][0], stagec.PENDING)
        self.assertEqual(t["left alone"], 1)

    def test_a_chapter_header_row_keeps_its_empty_cell(self):
        vals, t = self.run_it(("Chapter 1: Matter", ""))
        self.assertEqual(vals[0][0], "")
        self.assertEqual(t["converted"], 0)

    def test_every_row_comes_back_so_the_column_writes_as_one_range(self):
        vals, _ = self.run_it(("GRADE 4", ""), ("Day 1", PIPE),
                              ("Day 2", stagec.PENDING))
        self.assertEqual(len(vals), 3)
        self.assertTrue(all(len(v) == 1 for v in vals))

    def test_it_counts_what_it_changed(self):
        _, t = self.run_it(("Day 1", PIPE), ("Day 2", PIPE), ("Day 3", ""))
        self.assertEqual(t["converted"], 2)


if __name__ == "__main__":
    unittest.main()
