"""covtab.gaps_build — the second coverage tab, and what an empty block means.

`Coverage — gaps` is two work lists: chapters that never teach a skill their
subject is supposed to carry in every chapter, and SLOs the book names that no
day ever introduces. It is the tab someone acts on, so its failure mode is not
an ugly sheet — it is a quiet "nothing to do here".

Three ways it could say that untruthfully, each tested below:

  * AN EMPTY BLOCK UNDER A HEADER. A block with no rows reads as "no gaps"
    and as "the build died halfway" at the same time, and the reader cannot
    tell which. So a clean book gets a row that says it is clean.
  * A TRUNCATED LIST WITH NO COUNT. The never-introduced column shows the
    first ten codes. Without the "+N more" tail, a book with sixty uncovered
    SLOs looks exactly like a book with ten.
  * A BLOCK THAT FILLS FEWER COLUMNS THAN THE TAB IS WIDE. Both blocks share
    one set of widths, so a block that skips a column leaves a 420px lane
    empty down its whole length — which reads as missing data, not as a
    column this block has no use for.

The plan-index and filter rules this tab shares with the map are asserted here
against the gaps plan specifically, because the two tabs are built by different
functions and only the helpers are shared: a change to `gaps_build` alone can
break them on this tab and leave the map correct.
"""
import unittest

import covtab
from test_covtab import corpus, day


class TheGapsTabIsAsWideAsItSaysItIs(unittest.TestCase):

    def test_it_writes_no_short_row(self):
        # Sheets writes a short row as a short row and leaves the tail columns
        # holding whatever the previous build put there.
        rows, plan = covtab.gaps_build(corpus())
        for i, row in enumerate(rows):
            self.assertEqual(len(row), plan["n_cols"], f"row {i}: {row}")

    def test_every_column_has_a_width(self):
        # No `autoResizeDimensions` anywhere in this build, so a column with
        # no width keeps the sheet default and the layout drifts.
        _rows, plan = covtab.gaps_build(corpus())
        for c in range(plan["n_cols"]):
            self.assertIn(c, plan["widths"], f"column {c} has no width")

    def test_both_blocks_fill_all_nine_columns(self):
        for rows in (covtab._gap_rows({}), covtab._slo_rows({})):
            for row in rows:
                self.assertEqual(len(row), covtab.GAP_COLS)


class TheGapsPlanPointsAtTheRowsItThinksItPointsAt(unittest.TestCase):

    def setUp(self):
        self.rows, self.plan = covtab.gaps_build(corpus())

    def test_every_banner_row_is_a_banner_and_nothing_else(self):
        # Data beside the banner means the offsets slipped and the coral band
        # is now sitting over a chapter row.
        for i in self.plan["band_rows"]:
            self.assertTrue(self.rows[i][0])
            self.assertEqual([c for c in self.rows[i][1:] if c != ""], [],
                             f"row {i} carries data: {self.rows[i]}")

    def test_every_header_row_fills_more_than_one_column(self):
        for i in self.plan["head_rows"]:
            self.assertGreater(len([c for c in self.rows[i] if c != ""]), 1,
                               f"row {i} is not a header: {self.rows[i]}")

    def test_no_row_is_claimed_by_two_different_roles(self):
        claimed = ([self.plan["title_row"]] + self.plan["note_rows"]
                   + self.plan["band_rows"] + self.plan["head_rows"])
        self.assertEqual(len(claimed), len(set(claimed)), claimed)

    def test_no_index_it_hands_out_is_past_the_last_row(self):
        for i in (self.plan["note_rows"] + self.plan["band_rows"]
                  + self.plan["head_rows"]):
            self.assertLess(i, len(self.rows))
        for r0, r1, _px in self.plan["row_heights"]:
            self.assertLessEqual(r1, len(self.rows))
            self.assertLessEqual(r0, r1)

    def test_it_asks_for_the_basic_filter_exactly_once(self):
        # A sheet gets one. `setBasicFilter` twice means the second silently
        # replaces the first, so the block the reader was given a filter for
        # loses it; every block after the first asks for a filter VIEW.
        self.assertEqual(len([f for f in self.plan["filters"] if f[-1]]), 1)

    def test_no_two_filter_views_collide_where_covfmt_truncates_them(self):
        names = [f[0][:60] for f in self.plan["filters"]]
        self.assertEqual(len(names), len(set(names)), names)

    def test_every_filter_range_starts_on_its_own_header_row(self):
        # One row late and the filter eats the first book of the block; one
        # row early and the section banner is inside the filter.
        for _n, r0, r1, c0, c1, _b in self.plan["filters"]:
            self.assertIn(r0, self.plan["head_rows"])
            self.assertGreater(r1, r0)
            self.assertEqual((c0, c1), (0, self.plan["n_cols"]))

    def test_it_asks_for_no_overflow_lane(self):
        # Both text columns here are sized to hold their own content. An
        # overflow range would let a chapter title run across the list of
        # missing skills beside it and hide the thing the row is about.
        self.assertEqual(self.plan["overflow"], [])


class ItNeverShowsAnEmptyBlockOrASilentTruncation(unittest.TestCase):

    def test_a_chapter_missing_an_expected_skill_is_listed_with_what_it_lost(
            self):
        rows, plan = covtab.gaps_build(corpus())
        # Scoped to the thin-chapters block: the SLO block below reuses the
        # same columns for different numbers, so a whole-tab scan would read
        # a chapter COUNT as a chapter NUMBER.
        _n, r0, r1, _c0, _c1, _b = plan["filters"][0]
        body = [r for r in rows[r0 + 1:r1] if r[2] == 2 and r[1] == "Maths"]
        self.assertEqual(len(body), 1, "Maths ch2 teaches only `concrete`")
        self.assertEqual(body[0][covtab.N3], 2)
        self.assertTrue(body[0][covtab.LIST_C])

    def test_a_clean_book_still_gets_a_row_saying_it_is_clean(self):
        # A header row over nothing reads as a build that failed halfway.
        clean = {"Maths": [(3, [day(1, "concrete"), day(1, "pictorial"),
                                day(1, "word_problem")], {})]}
        rows, _plan = covtab.gaps_build(clean)
        self.assertIn("Every chapter carries every skill its subject expects.",
                      [c for row in rows for c in row])

    def test_an_slo_named_and_never_introduced_is_named_in_the_list(self):
        rows, _plan = covtab.gaps_build(corpus())
        listed = " ".join(str(c) for row in rows for c in row)
        self.assertIn("E-2", listed)

    def test_a_long_never_introduced_list_says_how_many_it_cut(self):
        # Silently showing the first ten would let a book with sixty
        # uncovered SLOs look the same as a book with ten.
        prepared = {"Maths": (
            [(3, [day(1, "concrete", f"M-{i}") for i in range(25)], {})],
            [], set(), {})}
        rows = covtab._slo_rows(prepared)
        self.assertIn("+15 more", rows[1][covtab.LIST_C])

    def test_a_book_whose_slos_are_all_introduced_says_so_with_a_dash(self):
        # Zero never-introduced SLOs must read as a real zero, not as a blank
        # cell that looks like the number failed to compute.
        prepared = {"Maths": (
            [(3, [day(1, "concrete", "M-1", "introduces")], {})],
            [], set(), {})}
        rows = covtab._slo_rows(prepared)
        self.assertEqual(rows[1][covtab.N3], "—")


if __name__ == "__main__":
    unittest.main()
