"""calfde — one tab, one question, and the verified record through the fold.

`Calendar (overview)` and `FDE Syllabus` were two tables of the same kind: what
this year assumes. They are one tab now — `Calendar — assumptions` — and the
fold is exactly where the FDE half's facts could go quietly missing. Four of
them are load-bearing and are asserted here:

  * `Not scheduled by FDE` reads `none` on every row. That column IS the
    finding: all 17 breakdown documents schedule every chapter, checked one by
    one against the page-truth corpus on 16 Sep 2026. A fold that summarised
    the column away would delete the only place the workbook says so;

  * `FDE weeks per chapter` against `Our periods per chapter` is the pacing
    benchmark, and both halves of it must arrive with their numbers;

  * the two halves have different column counts — seven and ten — so the tab
    is as wide as the wider one and the overview rows stop early. Padding them
    out would be harmless today and a lie the day a width changes;

  * nothing on this tab merges and nothing wraps (sheet.md §5.9), so a prose
    row longer than the tab is clipped in silence and looks fine in the API
    response. The FDE half's paragraphs used to be merged across all ten
    columns; they are one sentence per row now, and the budget is tested.

The last class stands in for a render: `format_overview` is called against a
fake service and its batches are read back, because "applied" is not "rendered
correctly" (§5.12) and the build is not run from here.
"""
import unittest

import calfde
import calfmt
import calover
import fdetab
import sheetio


def stats(**over):
    """One allocator stats record, as caltab's plan hands them over."""
    base = {"ideal": 100, "budget": 120, "placed": 100, "dropped": 0,
            "onramp": 10, "fill": 8, "foundations": 0}
    base.update(over)
    return base


def book(grade=1, subject="English", chapters=8, periods=96, teach=24, rev=4):
    """One book as load_corpus builds it: (grade, subject, stats, rows, rec).

    Nothing omitted, which is the real 2026-27 case — every one of the 17
    breakdown documents schedules every chapter of its book.
    """
    st = {"rows": periods, "chapters": chapters, "omitted_chapters": []}
    weeks = [{"kind": "teach"}] * teach + [{"kind": "revision"}] * rev
    rows = [{"chapter": 1, "chapter_title": "Numbers", "kind": "day"}]
    return (grade, subject, st, rows, {"weeks": weeks, "chapters": {}})


BREAKS = {"Winter Vacation 24 Dec - 1 Jan": ["grade_1_english"],
          "Summer Vacation": ["grade_1_english", "grade_2_urdu"]}


def built():
    return calfde.build([(1, "English", stats()),
                         (5, "Maths", stats(dropped=3, placed=97))],
                        [book(), book(grade=2, subject="Urdu", chapters=18)],
                        BREAKS)


def filled(row):
    return [c for c in row if c != ""]


class EveryFDEColumnSurvivesTheFold(unittest.TestCase):

    def setUp(self):
        self.rows, self.plan = built()
        self.head = next(i for i in self.plan["heads"]
                         if list(self.rows[i]) == fdetab.HEAD)
        self.books = [self.rows[self.head + 1], self.rows[self.head + 2]]

    def test_the_header_row_is_the_ten_fde_columns_in_order(self):
        # Order matters as much as presence: the pacing benchmark is read by
        # putting columns 7 and 9 side by side, and a reordered header puts
        # FDE's weeks under our periods' label.
        self.assertEqual(list(self.rows[self.head]), fdetab.HEAD)

    def test_not_scheduled_by_fde_reads_none_on_every_book_row(self):
        # The verified record. FDE omits nothing, and this column is where the
        # workbook says so — for every book, not as one summary line.
        col = fdetab.HEAD.index("Not scheduled by FDE")
        for row in self.books:
            self.assertEqual(row[col], "none",
                             f"{row[0]} {row[1]}: {row[col]}")

    def test_the_totals_row_still_says_fde_omits_nothing(self):
        # Found by its label, not by a row number out of the plan: the plan
        # carries what the painter needs and nothing else, so a caller cannot
        # inherit an offset that a new sentence above it has since moved.
        total = next(r for r in self.rows if r and r[0] == "ALL")
        self.assertIn("none — FDE omits nothing",
                      " ".join(str(c) for c in total))

    def test_the_verified_standfirst_reaches_the_tab(self):
        # It is the one line a reader takes away from this half, and it was
        # only ever true because someone checked 233 chapters by hand.
        opening = [str(r[0]) for r in self.rows
                   if r and str(r[0]).startswith("✅ VERIFIED 16 Sep 2026")]
        self.assertEqual(len(opening), 1, self.rows[:8])
        self.assertIn("FDE omits no chapter", opening[0])

    def test_the_pacing_benchmark_arrives_with_both_its_numbers(self):
        # 24 teaching weeks over 8 chapters, 96 periods over 8 chapters. If
        # either column came through empty the comparison this half exists to
        # make cannot be made.
        row = self.books[0]
        self.assertEqual(row[fdetab.HEAD.index("FDE weeks per chapter")],
                         "3.0")
        self.assertEqual(row[fdetab.HEAD.index("Our periods per chapter")],
                         "12.0")

    def test_the_breaks_fde_itself_assumes_come_across_too(self):
        text = " ".join(str(c) for row in self.rows for c in row)
        for label in BREAKS:
            self.assertIn(label, text)


class TheTwoHalvesAreTwoSectionsOnOneTab(unittest.TestCase):

    def setUp(self):
        self.rows, self.plan = built()
        self.bands = [str(self.rows[i][0]) for i in self.plan["sections"]]

    def test_both_halves_open_with_a_painted_section_band(self):
        self.assertTrue(any(b.startswith("PERIODS A WEEK")
                            for b in self.bands), self.bands)
        self.assertTrue(any(b.startswith("FDE SYLLABUS BREAKDOWN vs THIS PLAN")
                            for b in self.bands), self.bands)

    def test_every_section_index_points_at_a_banner_row(self):
        # A banner is one cell in column 0 with the rest of the row empty —
        # it is painted across the full width and overflows into it.
        for i in self.plan["sections"]:
            self.assertTrue(self.rows[i][0], f"row {i}: {self.rows[i]}")
            self.assertEqual(filled(self.rows[i][1:]), [],
                             f"row {i} has data beside the banner")

    def test_every_head_index_points_at_a_column_header_row(self):
        # A header fills several columns; a banner fills one. Off by one
        # between the two paints a banner over a data row and nothing fails.
        for i in self.plan["heads"]:
            self.assertGreater(len(filled(self.rows[i])), 1,
                               f"row {i} is not a header: {self.rows[i]}")

    def test_no_row_index_is_handed_out_twice_or_out_of_range(self):
        given = self.plan["sections"] + self.plan["heads"]
        self.assertEqual(len(given), len(set(given)))
        for i in given:
            self.assertLess(i, len(self.rows))

    def test_the_tab_is_as_wide_as_the_wider_half(self):
        self.assertEqual(self.plan["n_cols"], len(fdetab.HEAD))
        self.assertEqual(len(self.plan["widths"]), self.plan["n_cols"])

    def test_the_overview_half_keeps_the_widths_it_was_built_for(self):
        # Its column 6 is the 430px lane the verdict sentence overflows into,
        # and its prose labels are sized to column 0. One set of widths serves
        # both halves now, so the overview's may not be quietly resized.
        self.assertEqual(self.plan["widths"][:calover.N_COLS], calover.WIDTHS)

    def test_the_overview_half_stops_early_rather_than_padding(self):
        # The narrower section's rows are written short. A rebuild drops and
        # recreates the tab (§5.10), so there is nothing stale in the tail to
        # overwrite, and padding would only claim a width that half has not.
        over = [r for r in self.rows if len(r) == calover.N_COLS]
        self.assertGreater(len(over), 10)
        self.assertLess(max(len(r) for r in over), self.plan["n_cols"])

    def test_the_plan_names_no_single_wide_column(self):
        # The overview half writes its prose at column 6 and the FDE half
        # ends at column 9, so "the wide one" is no longer one column and the
        # plan does not claim it is. calover's own plan still does, for the
        # half it describes.
        self.assertNotIn("wide", self.plan)

    def test_no_row_is_wider_than_the_plan_claims(self):
        for i, row in enumerate(self.rows):
            self.assertLessEqual(len(row), self.plan["n_cols"],
                                 f"row {i} is {len(row)} wide")


class NoProseRowOnTheFDEHalfRunsPastTheTab(unittest.TestCase):
    """Nothing here wraps and nothing is merged, so a line longer than the tab
    is cut on the sheet with nothing in the API response to show for it. The
    FDE half's paragraphs were merged across ten columns before the fold; now
    they overflow, which means they are subject to the same budget as the
    overview half's sentences."""

    BUDGET = 150

    def setUp(self):
        self.rows, self.secs, self.heads = calfde.fde_block(
            [book(), book(grade=2, subject="Urdu", chapters=18)], BREAKS)

    def test_every_prose_row_it_emits_is_inside_the_budget(self):
        for i, row in enumerate(self.rows):
            if len(filled(row)) != 1 or not isinstance(row[0], str):
                continue
            self.assertLessEqual(len(row[0]), self.BUDGET,
                                 f"row {i} is clipped: {row[0]!r}")

    def test_the_finding_keeps_every_word_it_had(self):
        # Split into sentences, not shortened: a fold that trimmed the finding
        # would be rewording the verified record.
        prose = " ".join(str(r[0]) for r in self.rows if len(filled(r)) == 1)
        for word in fdetab.FINDING.split():
            self.assertIn(word, prose)

    def test_the_drops_block_has_no_header_row_when_nothing_is_omitted(self):
        # With nothing omitted the block is one finding, not a table, so there
        # are no columns to name. The old tab painted DROP_HEAD's ten labels
        # regardless and left H26:J26 coloured and empty on the export.
        for i in self.heads:
            self.assertNotEqual(list(self.rows[i]), fdetab.DROP_HEAD)


class FakeSheets:
    """Collects the requests a painter would have sent."""

    def __init__(self):
        self.requests = []

    def spreadsheets(self):
        return self

    def batchUpdate(self, spreadsheetId=None, body=None):
        self.requests += body["requests"]
        return self

    def execute(self):
        return {}


class ThePainterIsAskedForPaintNeverForAMerge(unittest.TestCase):
    """§5.9: a full-width merge and a frozen column are mutually exclusive, and
    the same bug bites section bands mid-tab. This tab freezes no columns
    today, but the FDE half arrived with merges in it and they are gone — the
    bands are painted across the full row instead."""

    def setUp(self):
        rows, plan = built()
        self.rows, self.plan = rows, plan
        svc = FakeSheets()
        calfde.format_overview(svc, sheetio, 77, rows, plan)
        self.reqs = svc.requests

    def test_nothing_on_this_tab_is_merged(self):
        self.assertEqual([r for r in self.reqs if "mergeCells" in r], [])

    def test_every_section_band_is_painted_across_the_full_width(self):
        painted = {r["repeatCell"]["range"]["startRowIndex"]
                   for r in self.reqs if "repeatCell" in r
                   and r["repeatCell"]["range"]["endColumnIndex"]
                   == self.plan["n_cols"]
                   and r["repeatCell"]["cell"]["userEnteredFormat"]
                   .get("backgroundColor") == sheetio.INK["band"]}
        self.assertEqual(painted, set(self.plan["sections"]))

    def test_every_column_header_is_painted_across_the_full_width(self):
        painted = {r["repeatCell"]["range"]["startRowIndex"]
                   for r in self.reqs if "repeatCell" in r
                   and r["repeatCell"]["cell"]["userEnteredFormat"]
                   .get("backgroundColor") == sheetio.INK["chapter"]}
        self.assertEqual(painted, set(self.plan["heads"]))

    def test_the_freeze_is_two_rows_and_no_columns(self):
        grid = next(r["updateSheetProperties"]["properties"]["gridProperties"]
                    for r in self.reqs if "updateSheetProperties" in r)
        self.assertEqual(grid, {"frozenRowCount": 2, "frozenColumnCount": 0})

    def test_every_column_of_the_merged_tab_gets_a_width(self):
        widths = {r["updateDimensionProperties"]["range"]["startIndex"]:
                  r["updateDimensionProperties"]["properties"]["pixelSize"]
                  for r in self.reqs if "updateDimensionProperties" in r
                  and r["updateDimensionProperties"]["range"]["dimension"]
                  == "COLUMNS"}
        self.assertEqual(widths, dict(enumerate(self.plan["widths"])))

    def test_the_whole_tab_overflows_rather_than_wrapping(self):
        base = next(r["repeatCell"]["cell"]["userEnteredFormat"]
                    for r in self.reqs if "repeatCell" in r
                    and r["repeatCell"]["range"]["endRowIndex"]
                    == len(self.rows))
        self.assertEqual(base["wrapStrategy"], "OVERFLOW_CELL")


if __name__ == "__main__":
    unittest.main()
