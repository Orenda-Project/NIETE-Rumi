# -*- coding: utf-8 -*-
"""The trace-block plan: which rows get a cell, and what goes in it."""
import unittest

import tracelinks as tl
import tracerun as tr

HEADER = (["Day #", "Topic", "Skill type", "Pages (printed)", "Page overlap",
           "Primary SLO", "SLO role", "Primary SLO description",
           "Supporting SLOs", "Supporting SLO descriptions", "Bloom's",
           "Period (min)", "Moves", "Reading strategy",
           "Collaboration structure", "FDE syllabus", "Prerequisite SLOs",
           "Teacher-primary min (of 40)", "Flags", "A Page truth",
           "B Segmentation", "C Enrichment", "C-gate Enrich gate"])
URLMAP = {("grade_4_general_science", 6): "https://pub-x.r2.dev/a/pg_006.json",
          ("grade_4_general_science", 7): "https://pub-x.r2.dev/a/pg_007.json"}
BOOKS = set(b for b, _ in URLMAP)
GID = 99
STAMP = "2026-09-21"


def rows(*specs):
    """specs: (column A, printed pages). Header is row 3, so body starts at 4."""
    return [[a] + [""] * 2 + [pg] + [""] * 19 for a, pg in specs]


def plan(*specs):
    return tr.plan("Science", GID, HEADER, rows(*specs), URLMAP, BOOKS, STAMP)


class TheColumnLetters(unittest.TestCase):
    def test_counts_from_zero(self):
        self.assertEqual(tr.letter(0), "A")
        self.assertEqual(tr.letter(12), "M")

    def test_crosses_into_two_letters(self):
        self.assertEqual(tr.letter(25), "Z")
        self.assertEqual(tr.letter(26), "AA")


class TheRowsThatGetATrace(unittest.TestCase):
    def test_a_day_an_assessment_and_a_review_all_carry_all_three(self):
        _, t = plan(("GRADE 4", ""), ("Day 1", "6"),
                    (u"✅ Ch. Assessment", "7"), (u"\U0001f4cb Ch. Review", "6"))
        self.assertEqual((t["rows"], t["A"], t["B"], t["C"]), (3, 3, 3, 3))

    def test_a_chapter_header_gets_nothing(self):
        _, t = plan(("GRADE 4", ""), ("Chapter 1: Matter", "6-7"), ("Day 1", "6"))
        self.assertEqual(t["rows"], 1)

    def test_a_row_above_the_first_grade_banner_is_skipped(self):
        """Without a grade there is no book, so a cell would be a guess."""
        _, t = plan(("Day 1", "6"), ("GRADE 4", ""), ("Day 2", "7"))
        self.assertEqual(t["rows"], 1)


class TheCellsThatGetBuilt(unittest.TestCase):
    def test_the_three_headers_are_stamped_and_nothing_else_is(self):
        reqs, _ = plan(("GRADE 4", ""))
        titles = [r["updateCells"]["rows"][0]["values"][0]
                   ["userEnteredValue"]["stringValue"] for r in reqs]
        self.assertEqual(titles, ["%s (%s)" % (c, STAMP) for c in tl.LINKED_STAGES])

    def test_a_day_writes_into_the_three_trace_columns_only(self):
        reqs, _ = plan(("GRADE 4", ""), ("Day 1", "6-7"))
        cols = sorted(r["updateCells"]["range"]["startColumnIndex"]
                      for r in reqs[3:])
        self.assertEqual(cols, [HEADER.index(c) for c in tl.LINKED_STAGES])

    def test_page_truth_carries_one_link_per_printed_page(self):
        reqs, t = plan(("GRADE 4", ""), ("Day 1", "6-7"))
        cell = reqs[3]["updateCells"]["rows"][0]["values"][0]
        self.assertEqual(cell["userEnteredValue"]["stringValue"], u"pg 6·7")
        self.assertEqual(t["links"], 2)

    def test_an_unpublished_page_is_counted_and_left_unlinked(self):
        _, t = plan(("GRADE 4", ""), ("Day 1", "6-8"))
        self.assertEqual((t["links"], t["gaps"]), (2, 1))

    def test_segmentation_and_enrichment_anchor_into_this_row(self):
        reqs, _ = plan(("GRADE 4", ""), ("Day 1", "6"))
        seg, enr = reqs[4], reqs[5]
        v = lambda r: r["updateCells"]["rows"][0]["values"][0]
        self.assertEqual(v(seg)["userEnteredValue"]["stringValue"], "row 5")
        self.assertEqual(v(enr)["userEnteredValue"]["stringValue"], u"cols M–R")
        uri = lambda r: v(r)["textFormatRuns"][0]["format"]["link"]["uri"]
        self.assertTrue(uri(seg).endswith("&range=A5"), uri(seg))
        self.assertTrue(uri(enr).endswith("&range=M5"), uri(enr))

    def test_a_day_with_no_published_page_still_gets_b_and_c(self):
        """The enrichment is on the row whether or not the page was uploaded."""
        reqs, t = plan(("GRADE 4", ""), ("Day 1", "99"))
        self.assertEqual((t["A"], t["A missing"], t["B"]), (0, 1, 1))
        self.assertEqual(len(reqs), 5)


if __name__ == "__main__":
    unittest.main()


class TheRegroup(unittest.TestCase):
    """The collapsed groups are re-derived, never nudged."""

    LIVE = [(12, 18), (21, 23), (19, 29)]

    def reqs(self, subject="Science", ncols=31):
        return tr.regroup(subject, GID, self.LIVE, ncols)

    def test_every_live_group_is_deleted_first(self):
        deleted = [(r["deleteDimensionGroup"]["range"]["startIndex"],
                    r["deleteDimensionGroup"]["range"]["endIndex"])
                   for r in self.reqs() if "deleteDimensionGroup" in r]
        self.assertEqual(deleted, self.LIVE)

    def test_the_whole_tab_is_unhidden_before_anything_is_regrouped(self):
        r = self.reqs()
        first_add = min(i for i, q in enumerate(r) if "addDimensionGroup" in q)
        unhide = [i for i, q in enumerate(r)
                  if "updateDimensionProperties" in q
                  and q["updateDimensionProperties"]["properties"] == {
                      "hiddenByUser": False}]
        self.assertEqual(len(unhide), 1)
        self.assertLess(unhide[0], first_add)

    def test_the_new_group_skips_the_three_linked_stages(self):
        import tabs
        added = [(r["addDimensionGroup"]["range"]["startIndex"],
                  r["addDimensionGroup"]["range"]["endIndex"])
                 for r in self.reqs() if "addDimensionGroup" in r]
        self.assertEqual(added, [tuple(g) for g in tabs.groups("Science")])
        cols = tabs.header("Science")
        for c in tl.LINKED_STAGES:
            self.assertTrue(all(not (a <= cols.index(c) < b) for a, b in added))

    def test_each_new_group_ships_collapsed(self):
        n_add = sum(1 for r in self.reqs() if "addDimensionGroup" in r)
        collapsed = [r["updateDimensionGroup"]["dimensionGroup"]["collapsed"]
                     for r in self.reqs() if "updateDimensionGroup" in r]
        self.assertEqual(collapsed, [True] * n_add)

    def test_the_three_headers_lose_the_pending_grey_and_the_note(self):
        cells = [r["repeatCell"] for r in self.reqs() if "repeatCell" in r]
        self.assertEqual(len(cells), 3)
        for c in cells:
            self.assertEqual(c["cell"]["note"], "")
            self.assertTrue(c["cell"]["userEnteredFormat"]["textFormat"]["bold"])
            self.assertFalse(
                c["cell"]["userEnteredFormat"]["textFormat"]["italic"])
            self.assertEqual(c["range"]["startRowIndex"], tr.HEAD_ROW - 1)


class TheTraceColumnWidths(unittest.TestCase):
    def test_each_linked_column_is_sized(self):
        import tabs
        cols = tabs.header("Science")
        sized = dict(
            (r["updateDimensionProperties"]["range"]["startIndex"],
             r["updateDimensionProperties"]["properties"]["pixelSize"])
            for r in tr.regroup("Science", GID, [], 31)
            if "pixelSize" in r.get("updateDimensionProperties", {})
                              .get("properties", {}))
        self.assertEqual(sized, dict((cols.index(c), tr.WIDTHS[c])
                                     for c in tl.LINKED_STAGES))
