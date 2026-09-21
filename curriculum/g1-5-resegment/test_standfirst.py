"""The standfirst row is the one row on a tab that can lie by omission.

§5.1 puts a sentence in row 2 saying what the tab is and where its facts come
from. It is the only prose on most tabs, so it is the row a reviewer trusts,
and it is also the row that fails without a sound: a pinned height cuts the
last wrapped line, and OVERFLOW_CELL runs the text off the right edge of the
grid. Either way the tab simply stops saying the thing it was written to say.

Every case below is a shape the live workbook actually held on 18 Sep 2026,
measured off the sheet before this module existed.
"""
import unittest

import house

import standfirst


class FirstFilledColumn(unittest.TestCase):
    """The text does not start in column A — it starts at the freeze."""

    def test_column_a_is_found_when_the_text_is_there(self):
        self.assertEqual(standfirst.column(["hello", "", ""]), 0)

    def test_the_freeze_boundary_is_found_when_the_text_starts_there(self):
        # sheetio.titled puts the standfirst at the first UNFROZEN column,
        # because a long string cannot cross a frozen-column boundary.
        self.assertEqual(standfirst.column(["", "", "hello", ""]), 2)

    def test_whitespace_is_not_text(self):
        self.assertEqual(standfirst.column(["   ", "\t", "hello"]), 2)

    def test_an_empty_row_has_no_column(self):
        self.assertIsNone(standfirst.column(["", "", ""]))

    def test_a_row_with_no_cells_at_all_has_no_column(self):
        self.assertIsNone(standfirst.column([]))

    def test_non_string_cells_do_not_raise(self):
        # Row values arrive from the build as whatever the row builder put
        # there; a stray int must not take the painter down.
        # A bare 0 is not a sentence: `str(0)` is truthy, so a naive check
        # stops here and measures the wrong column's width.
        self.assertEqual(standfirst.column([0, None, "hello"]), 2)


class AvailableWidth(unittest.TestCase):
    """How many pixels the sentence actually has to live in."""

    def test_widths_are_summed_from_the_start_column_to_the_edge(self):
        w = {0: 80, 1: 200, 2: 300, 3: 400}
        self.assertEqual(standfirst.available(w, 2, 4), 700)

    def test_columns_left_of_the_start_are_not_counted(self):
        # This is the whole point: a frozen column's width is not room the
        # sentence can use, and counting it is how a clipped row reads as fine.
        w = {0: 900, 1: 900, 2: 100}
        self.assertEqual(standfirst.available(w, 2, 3), 100)

    def test_columns_right_of_the_grid_are_not_counted(self):
        w = {0: 100, 1: 100, 2: 100, 9: 5000}
        self.assertEqual(standfirst.available(w, 0, 3), 300)

    def test_an_unsized_column_takes_the_sheets_default(self):
        # format_grid only emits a pixelSize for columns the caller named;
        # the rest are whatever Sheets gives them, which is 100.
        self.assertEqual(standfirst.available({}, 0, 4), 400)

    def test_a_partly_sized_grid_mixes_both(self):
        self.assertEqual(standfirst.available({1: 250}, 0, 3), 450)

    def test_no_columns_is_no_room(self):
        self.assertEqual(standfirst.available({0: 100}, 0, 0), 0)


class HeightFromTheTextItHolds(unittest.TestCase):
    """A row is tall enough when every line of its sentence can render."""

    def test_a_short_sentence_stays_at_the_floor(self):
        self.assertEqual(standfirst.height("short", 1200, floor=36), 36)

    def test_a_sentence_that_wraps_is_given_more_than_the_floor(self):
        self.assertGreater(standfirst.height("y" * 600, 1200, floor=36), 36)

    def test_longer_text_is_never_given_less_room(self):
        short = standfirst.height("y" * 400, 900, floor=36)
        long = standfirst.height("y" * 900, 900, floor=36)
        self.assertGreaterEqual(long, short)

    def test_a_narrower_grid_needs_a_taller_row(self):
        wide = standfirst.height("z" * 600, 1800, floor=36)
        narrow = standfirst.height("z" * 600, 600, floor=36)
        self.assertGreater(narrow, wide)

    def test_the_height_is_a_whole_number_of_lines(self):
        # Pinned so that changing house.SUB_PT cannot silently re-clip every
        # tab: if the line height moves, this fails and the sizes are read
        # together rather than one of them drifting.
        px = standfirst.height("q" * 600, 900, floor=0)
        self.assertEqual(px % (house.SUB_PT + 5), 10 % (house.SUB_PT + 5))

    def test_the_floor_is_honoured_even_for_empty_text(self):
        self.assertEqual(standfirst.height("", 900, floor=41), 41)

    def test_a_zero_width_grid_does_not_divide_by_zero(self):
        # A tab painted before its widths are known asks this question with 0.
        self.assertGreaterEqual(standfirst.height("y" * 200, 0, floor=36), 36)

    def test_the_fln_coverage_sentence_needs_several_lines(self):
        # The real one: 688 characters in 1170px of grid. It rendered as one
        # 28px line, so roughly a quarter of it reached the reader.
        px = standfirst.height("y" * 688, 1170, floor=28)
        self.assertGreater(px, 3 * (house.SUB_PT + 5))

    def test_the_skill_taxonomy_sentence_needs_two_lines(self):
        # The near miss: 163 characters in 970px. It cut mid-word, which is
        # the case a glance at the tab does NOT catch.
        self.assertGreater(standfirst.height("y" * 163, 970, floor=28), 28)

    def test_a_point_is_wider_than_a_pixel(self):
        """The width is in pixels and the size is in points, so the two have
        to be converted before they are divided. A point is 4/3 of a pixel at
        96dpi, so treating them as equal claims a third more characters per
        line than fit -- which is this module's own failure mode, arrived at
        from inside. A line of 11pt may hold at most 1000 / (11 * 4/3 * 0.55)
        = 124 characters in 1000px; 130 must therefore wrap.
        """
        self.assertGreater(standfirst.height("y" * 130, 1000, floor=28), 28)

    def test_the_english_standfirst_needs_two_lines(self):
        # The live one, 2026-09-21: 638 characters merged across C2:Y2, which
        # is 3920px on the English G1-5 tab. Measured as one 28px line, so
        # "...Nothing on this tab is hidden or collapsed" never rendered.
        px = standfirst.height("y" * 638, 3920, floor=28)
        self.assertGreaterEqual(px, 2 * (house.SUB_PT + 5) + 10)


class TheWholeQuestionInOneCall(unittest.TestCase):
    """row_px answers what a painter actually wants to know."""

    def test_it_finds_the_text_sizes_it_and_returns_a_height(self):
        rows = [["TITLE"], ["", "", "y" * 600]]
        px = standfirst.row_px(rows, 1, {0: 80, 1: 80, 2: 400}, 3, 2,
                               floor=36)
        self.assertEqual(px, standfirst.height("y" * 600, 400, floor=36))

    def test_a_missing_row_falls_back_to_the_floor(self):
        self.assertEqual(standfirst.row_px([["x"]], 9, {}, 3, 0, floor=36), 36)

    def test_an_empty_standfirst_row_falls_back_to_the_floor(self):
        self.assertEqual(
            standfirst.row_px([["x"], ["", ""]], 1, {}, 2, 0, floor=36), 36)

    def test_text_inside_the_freeze_is_measured_only_up_to_the_freeze(self):
        # If a caller's `at` and `freeze_cols` disagree the text lands inside
        # the frozen region. It may then be merged across columns 0-1 and no
        # further: a merge crossing the boundary makes the freeze request fail
        # (§5.9). Measure the side of the boundary the text is actually on.
        px = standfirst.row_px([["x"], ["y" * 600, "", ""]], 1,
                               {0: 900, 1: 100, 2: 100}, 3, 2, floor=36)
        self.assertEqual(px, standfirst.height("y" * 600, 1000, floor=36))

    def test_the_merge_span_never_crosses_the_freeze(self):
        self.assertEqual(standfirst.span(0, 6, 2), (0, 2))
        self.assertEqual(standfirst.span(2, 6, 2), (2, 6))
        self.assertEqual(standfirst.span(None, 6, 2), (0, 0))

    def test_a_freeze_wider_than_the_grid_cannot_run_past_the_edge(self):
        self.assertEqual(standfirst.span(0, 1, 4), (0, 1))


class StandfirstStaysPure(unittest.TestCase):
    """Four painters import this; none of them may gain a dependency."""

    def test_it_imports_only_house(self):
        with open("standfirst.py") as fh:
            src = fh.read()
        imports = [l.split()[1] for l in src.splitlines()
                   if l.startswith("import ")]
        self.assertEqual(imports, ["house"])

    def test_it_holds_no_google_sdk_reference(self):
        with open("standfirst.py") as fh:
            self.assertNotIn("googleapiclient", fh.read())


if __name__ == "__main__":
    unittest.main()
