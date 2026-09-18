"""The standfirst height has to come from the standfirst.

The Coverage Map lost the last line of its own reading instruction — "...not
the same thing." — to a hardcoded 36px note row. A merged 11pt paragraph wraps,
and a wrapped paragraph in a pinned row is clipped in silence: nothing errors,
the sheet just stops saying the thing it was written to say. That is the one
failure mode a formatter cannot be allowed to have on a tab whose whole job is
to surface what is missing.

These tests pin the rule, not the pixel count: a longer note is never shorter,
a short note never drops below the house floor, and a note row that holds no
text falls back rather than raising.
"""
import unittest

import covfmt
import house


def plan(n_cols=8, width=60):
    return {"n_cols": n_cols, "widths": {i: width for i in range(n_cols)},
            "title_row": 0}


class TheStandfirstIsHeightedFromItsText(unittest.TestCase):
    def test_a_short_note_stays_at_the_house_floor(self):
        rows = [["COVERAGE MAP"], ["Short."]]
        self.assertEqual(covfmt._note_px(rows, 1, plan()), covfmt.H_NOTE)

    def test_a_note_that_wraps_gets_a_row_per_line(self):
        rows = [["COVERAGE MAP"], ["x" * 600]]
        self.assertGreater(covfmt._note_px(rows, 1, plan()), covfmt.H_NOTE)

    def test_a_longer_note_is_never_given_less_room(self):
        short = covfmt._note_px([[""], ["y" * 400]], 1, plan())
        long = covfmt._note_px([[""], ["y" * 900]], 1, plan())
        self.assertGreater(long, short)

    def test_a_narrower_tab_needs_more_rows_for_the_same_text(self):
        wide = covfmt._note_px([[""], ["z" * 600]], 1, plan(n_cols=12))
        narrow = covfmt._note_px([[""], ["z" * 600]], 1, plan(n_cols=4))
        self.assertGreater(narrow, wide)

    def test_the_height_is_a_multiple_of_the_subtitle_size(self):
        # If the row height stopped tracking house.SUB_PT, a font-size change
        # in house would clip every standfirst again without a test failing.
        px = covfmt._note_px([[""], ["q" * 600]], 1, plan())
        self.assertEqual((px - 10) % (house.SUB_PT + 5), 0)

    def test_it_reads_the_first_non_empty_cell_not_column_a(self):
        # `titled` puts the standfirst at the first UNFROZEN column, so the
        # note can legitimately start at C.
        px = covfmt._note_px([[""], ["", "", "w" * 600]], 1, plan())
        self.assertGreater(px, covfmt.H_NOTE)


class AnEmptyNoteRowFallsBack(unittest.TestCase):
    def test_a_row_of_blanks_returns_the_floor(self):
        self.assertEqual(covfmt._note_px([[""], ["", ""]], 1, plan()),
                         covfmt.H_NOTE)

    def test_a_row_that_does_not_exist_returns_the_floor(self):
        self.assertEqual(covfmt._note_px([[""]], 9, plan()), covfmt.H_NOTE)


if __name__ == "__main__":
    unittest.main()
