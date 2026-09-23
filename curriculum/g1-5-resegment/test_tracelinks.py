# -*- coding: utf-8 -*-
"""The trace block: what each stage leaves, linked from the day row.

traces.md (operator instruction 2026-09-14) is binding on every build:
save, publish, link. This module builds the link half for the stages that
have actually run on this build, and nothing for the stages that have not.

Two stages resolve outward and one resolves inward:

  A Page truth   -- the per-page JSON the day was built from. The previous
                    ICT build published 1,712 of these and they are still
                    live, so this is a relink, not an upload. A day spans
                    several printed pages, so the cell carries one link per
                    page rather than one link per row: a trace that reaches
                    the first page of four is three quarters of a trace.
  B Segmentation -- this sheet IS the segmentation output for this build.
  C Enrichment   -- the enrichment lives in this row's own columns.

B and C therefore anchor back into the sheet, at the cells that hold the
decision: B at column A, C at the first enrichment column. A stage that
has not run gets no cell at all -- an empty trace is readable, a trace
pointing at a 404 is worse than nothing (traces.md caught 3 of those).
"""
import json
import unittest

import tracelinks as t

PUBLISHED = {
    ("grade_1_english", 2): "https://pub-x.r2.dev/ict-k5/page-truth/aa11bb22/grade_1_english/pg_002.json",
    ("grade_1_english", 3): "https://pub-x.r2.dev/ict-k5/page-truth/cc33dd44/grade_1_english/pg_003.json",
    ("grade_1_maths", 9): "https://pub-x.r2.dev/ict-k5/page-truth/ee55ff66/grade_1_maths/pg_009.json",
    ("grade_4_general_science", 2): "https://pub-x.r2.dev/ict-k5/page-truth/07778888/grade_4_general_science/pg_002.json",
}
BOOKS = set(b for b, _ in PUBLISHED)


class ThePrintedPageSpec(unittest.TestCase):

    def test_a_range_becomes_every_page_in_it(self):
        self.assertEqual(t.parse_pages("2-5"), [2, 3, 4, 5])

    def test_an_en_dash_is_a_range_too(self):
        self.assertEqual(t.parse_pages(u"2–5"), [2, 3, 4, 5])

    def test_a_comma_joins_spans(self):
        self.assertEqual(t.parse_pages("2, 4-6"), [2, 4, 5, 6])

    def test_a_single_page_is_a_page(self):
        self.assertEqual(t.parse_pages("7"), [7])

    def test_a_page_named_twice_is_listed_once(self):
        self.assertEqual(t.parse_pages("2-4, 3"), [2, 3, 4])

    def test_nothing_printed_is_no_pages_not_an_error(self):
        self.assertEqual(t.parse_pages(""), [])
        self.assertEqual(t.parse_pages(None), [])


class TheBookSlug(unittest.TestCase):
    """The corpus is inconsistent: grade_1_maths but grade_2_math."""

    def test_maths_and_math_are_both_tried(self):
        self.assertEqual(t.book_slug("Maths", 1, BOOKS), "grade_1_maths")

    def test_science_is_general_science(self):
        self.assertEqual(t.book_slug("Science", 4, BOOKS),
                         "grade_4_general_science")

    def test_a_book_that_was_never_published_is_none(self):
        self.assertIsNone(t.book_slug("Urdu", 3, BOOKS))


class ThePageTruthCell(unittest.TestCase):

    def test_every_published_page_gets_its_own_link(self):
        cell = t.page_truth_cell([2, 3], "grade_1_english", PUBLISHED)
        self.assertEqual(cell["text"], u"pg 2·3")
        self.assertEqual([r["uri"] for r in cell["runs"]],
                         [PUBLISHED[("grade_1_english", 2)],
                          PUBLISHED[("grade_1_english", 3)]])

    def test_a_run_starts_where_its_page_starts(self):
        cell = t.page_truth_cell([2, 3], "grade_1_english", PUBLISHED)
        self.assertEqual([r["start"] for r in cell["runs"]], [3, 5])
        self.assertEqual([r["end"] for r in cell["runs"]], [4, 6])

    def test_an_unpublished_page_is_shown_but_not_linked(self):
        """The gap is the point: it says which page still needs uploading."""
        cell = t.page_truth_cell([2, 99], "grade_1_english", PUBLISHED)
        self.assertEqual(cell["text"], u"pg 2·99")
        self.assertEqual(len(cell["runs"]), 1)
        self.assertEqual(cell["runs"][0]["start"], 3)

    def test_a_row_with_no_published_page_gets_no_cell(self):
        self.assertIsNone(t.page_truth_cell([99], "grade_1_english", PUBLISHED))

    def test_no_book_is_no_cell(self):
        self.assertIsNone(t.page_truth_cell([2], None, PUBLISHED))


class TheAnchorsBackIntoTheSheet(unittest.TestCase):

    def test_segmentation_points_at_the_day_itself(self):
        url = t.row_anchor("SHEETID", 1808902584, 4, "A")
        self.assertIn("#gid=1808902584", url)
        self.assertTrue(url.endswith("range=A4"), url)

    def test_enrichment_points_at_the_enrichment_block(self):
        url = t.row_anchor("SHEETID", 1808902584, 4, "M")
        self.assertTrue(url.endswith("range=M4"), url)


class TheHeaderCarriesTheStamp(unittest.TestCase):
    """traces.md: the block is re-derived every build, so the date moves."""

    def test_the_stamp_is_appended_once(self):
        self.assertEqual(t.stamped("A Page truth", "2026-09-21"),
                         "A Page truth (2026-09-21)")

    def test_restamping_replaces_rather_than_accumulates(self):
        once = t.stamped("A Page truth", "2026-09-14")
        self.assertEqual(t.stamped(once, "2026-09-21"),
                         "A Page truth (2026-09-21)")


class TheStagesThatHaveNotRun(unittest.TestCase):

    def test_only_three_stages_are_written_on_this_build(self):
        self.assertEqual(t.LINKED_STAGES,
                         ("A Page truth", "B Segmentation", "C Enrichment"))

    def test_the_render_stages_are_not_among_them(self):
        for c in ("D0 Slide script", "D Render meta", "E Voicenote script",
                  "J Pedagogy review", "J Design review", "F LP (latest PDF)",
                  "C-gate Enrich gate"):
            self.assertNotIn(c, t.LINKED_STAGES)




class TheHeaderIsFoundAgainOnTheNextBuild(unittest.TestCase):
    def test_the_stamp_comes_off(self):
        self.assertEqual(t.unstamped("A Page truth (2026-09-21)"),
                         "A Page truth")

    def test_an_unstamped_header_is_left_alone(self):
        self.assertEqual(t.unstamped("Moves"), "Moves")

    def test_a_restamp_replaces_rather_than_stacks(self):
        once = t.stamped("C Enrichment", "2026-09-21")
        self.assertEqual(t.stamped(once, "2026-10-01"),
                         "C Enrichment (2026-10-01)")


class TheTracesCell(unittest.TestCase):
    """One JSON object per row, holding only the stages that have an artefact.

    The ten-column block decayed into nine dead columns because a column
    exists whether or not its stage ran. A key does not: it is written when
    there is something to point at, and absent otherwise, so "no key" reads
    as "this stage has not run" rather than as a blank someone forgot.
    """

    URLS = ["https://pub-x.r2.dev/pt/a/pg_006.json",
            "https://pub-x.r2.dev/pt/a/pg_007.json"]

    def test_it_is_json(self):
        cell = t.traces_cell({"page_truth": self.URLS})
        self.assertEqual(json.loads(cell), {"page_truth": self.URLS})

    def test_a_stage_with_no_artefact_is_absent_not_empty(self):
        cell = json.loads(t.traces_cell({"page_truth": self.URLS,
                                         "enrichment": None,
                                         "voicenote": []}))
        self.assertEqual(list(cell), ["page_truth"])

    def test_a_row_with_nothing_published_is_an_empty_cell_not_empty_json(self):
        # "{}" in 1,923 cells is exactly the constant this replaces.
        self.assertEqual(t.traces_cell({"page_truth": []}), "")
        self.assertEqual(t.traces_cell({}), "")

    def test_the_stage_order_is_the_pipeline_order(self):
        cell = t.traces_cell({"lesson_plan": "u4", "page_truth": ["u1"],
                              "enrichment": "u3", "segmentation": "u2"})
        self.assertEqual(list(json.loads(cell)),
                         ["page_truth", "segmentation", "enrichment",
                          "lesson_plan"])

    def test_an_unknown_stage_is_refused_rather_than_silently_written(self):
        with self.assertRaises(KeyError):
            t.traces_cell({"vibes": "https://pub-x.r2.dev/x.json"})

    def test_the_gap_is_named_when_some_pages_are_unpublished(self):
        cell = json.loads(t.traces_cell({"page_truth": self.URLS},
                                        unpublished=[8, 9]))
        self.assertEqual(cell["pages_unpublished"], [8, 9])

    def test_no_gap_key_when_every_page_is_published(self):
        cell = json.loads(t.traces_cell({"page_truth": self.URLS},
                                        unpublished=[]))
        self.assertNotIn("pages_unpublished", cell)

    def test_a_row_whose_every_page_is_unpublished_still_states_the_gap(self):
        # bd-9hjsp. A blank cell and a cell reading "no page of this day has
        # been published" say different things to a reviewer, and the second
        # is the true one. Returning "" here made the one row on the sheet
        # with a single unpublished page indistinguishable from a row the
        # trace pass never reached -- dark stages stay dark, named.
        cell = json.loads(t.traces_cell({}, unpublished=[9]))
        self.assertEqual(cell, {"pages_unpublished": [9]})


if __name__ == "__main__":
    unittest.main()
