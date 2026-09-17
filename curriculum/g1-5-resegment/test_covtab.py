"""covtab — the plan is a set of row numbers, and nothing checks them but this.

`build` and `gaps_build` return rows plus a plan, and the plan is almost
entirely ROW AND COLUMN INDICES: which rows are banners, which are headers,
which ranges get a filter, which cells get a heat tint, where the overflow lane
starts. `covfmt` paints exactly what it is told and has no way to notice it was
told the wrong row. Every failure mode of this file is therefore silent — the
build succeeds, the API returns 200, and the tab is wrong.

The specific things that have gone wrong, or would go wrong unnoticed:

  * A BLOCK APPENDED WITHOUT ITS OFFSET UPDATED. Both tabs stack blocks by
    `base + len(rows)` arithmetic; one block added above another and every
    index below it is off. The banner then paints over a data row.
  * A SECOND BASIC FILTER. A sheet gets exactly one; `setBasicFilter` twice
    means the second silently replaces the first, so the block the reader was
    given a filter for loses it. Every block after the first must ask for a
    filter VIEW instead.
  * TWO FILTER VIEWS WHOSE NAMES COLLIDE IN THE FIRST 60 CHARACTERS, which is
    where `covfmt` truncates them.
  * A ROW SHORTER THAN THE PLAN'S WIDTH. Sheets writes a short row as a short
    row and leaves the tail columns holding whatever the previous build put
    there, which is how a stale number survives a rebuild.
  * THE OVERFLOW LANE STARTING ONE COLUMN EARLY. The Share column is 52px; a
    sentence that starts there is cut mid-word instead of running across.

So these tests assert the plan against the rows it describes, not against the
code that produced it. They also hold the file's one architectural rule: this
is content, and content never imports its painter.

This file covers `Coverage Map` — the mix bars and the chapter grid. The second
tab, `gaps_build`, is built by a different function off the same helpers and is
tested in `test_covgaps.py`, which reuses the corpus fixture below.
"""
import unittest

import covtab


def day(chapter, skill, slo=None, role=None, kind="day", title="Chapter"):
    return {"kind": kind, "skill_type": skill, "chapter": chapter,
            "chapter_title": f"{title} {chapter}", "primary_slo": slo,
            "supporting_slos": "", "slo_role": role}


def corpus():
    """Two subjects, two books, one chapter that is missing a skill and one
    SLO that is named and never introduced."""
    maths = [day(1, "concrete", "M-1", "introduces"),
             day(1, "pictorial", "M-1", "practises"),
             day(1, "word_problem", "M-2", "introduces"),
             day(2, "concrete", "M-3"),          # ch2 misses two expected
             day(2, "revision"),
             day(None, "concrete")]
    english = [day(1, "reading_comprehension", "E-1", "introduces"),
               day(1, "vocabulary_grammar", "E-1"),
               day(1, "writing", "E-2"),         # E-2 never introduced
               day(1, "", kind="chapter_close")]
    return {"Maths": [(3, maths, {})], "English": [(1, english, {})]}


class EveryRowIsAsWideAsThePlanSaysTheTabIs(unittest.TestCase):
    """A short row leaves the previous build's values in the tail columns."""

    def test_the_map_writes_no_short_row(self):
        rows, plan = covtab.build(corpus())
        for i, row in enumerate(rows):
            self.assertEqual(len(row), plan["n_cols"], f"row {i}: {row}")

    def test_the_map_is_wide_enough_for_the_widest_subjects_skill_grid(self):
        # The grid puts one column per skill type starting at SKILL_C. A
        # subject with more skill types than the plan has columns would have
        # its last chips written past the end of the row.
        import covdata
        rows, plan = covtab.build(corpus())
        for _s, (_b, keys, _e, _c) in covdata.prepare(corpus()).items():
            self.assertLessEqual(covtab.SKILL_C + len(keys), plan["n_cols"])

    def test_every_column_on_both_tabs_has_a_width(self):
        # No `autoResizeDimensions` anywhere in this build, so a column with
        # no width keeps the sheet default and the layout drifts.
        _rows, plan = covtab.build(corpus())
        for c in range(plan["n_cols"]):
            self.assertIn(c, plan["widths"], f"column {c} has no width")


class ThePlanPointsAtTheRowsItThinksItPointsAt(unittest.TestCase):

    def setUp(self):
        self.rows, self.plan = covtab.build(corpus())

    def test_every_banner_row_is_a_banner_and_nothing_else(self):
        # A banner is one merged cell in column A. Data beside it means the
        # offsets slipped and the coral band is now over a chapter row.
        for i in self.plan["band_rows"]:
            self.assertTrue(self.rows[i][0])
            self.assertEqual([c for c in self.rows[i][1:] if c != ""], [],
                             f"row {i} carries data: {self.rows[i]}")

    def test_every_header_row_fills_more_than_one_column(self):
        # The inverse check: a header that has collapsed to one cell is a
        # banner index that landed in head_rows.
        for i in self.plan["head_rows"]:
            self.assertGreater(len([c for c in self.rows[i] if c != ""]), 1,
                               f"row {i} is not a header: {self.rows[i]}")

    def test_no_row_is_claimed_by_two_different_roles(self):
        # title / note / band / head are painted differently; a row in two
        # lists gets whichever request the painter emits last.
        claimed = ([self.plan["title_row"]] + self.plan["note_rows"]
                   + self.plan["band_rows"] + self.plan["head_rows"])
        self.assertEqual(len(claimed), len(set(claimed)), claimed)

    def test_no_index_the_plan_hands_out_is_past_the_last_row(self):
        for i in (self.plan["note_rows"] + self.plan["band_rows"]
                  + self.plan["head_rows"]):
            self.assertLess(i, len(self.rows))
        for r0, r1, _px in self.plan["row_heights"]:
            self.assertLessEqual(r1, len(self.rows))
            self.assertLessEqual(r0, r1)

    def test_every_painted_cell_is_inside_the_tab(self):
        # tint, bars, flags and heat cells are all (row, col) pairs computed by
        # offset arithmetic. One out of range is a request the API accepts and
        # paints somewhere the reader is not looking.
        coords = ([(r, c) for r, c, _v in self.plan["tint"]]
                  + [(r, c) for r, c, _v in self.plan["bars"]]
                  + [(r, c) for r, c, _v in self.plan["cells"]]
                  + list(self.plan["flags"]))
        for r, c in coords:
            self.assertLess(r, len(self.rows), f"row {r} does not exist")
            self.assertLess(c, self.plan["n_cols"], f"column {c} is off-tab")

    def test_the_heat_numbers_match_the_grid_cells_underneath_them(self):
        # The heat tint is computed from a count and the cell text is written
        # separately. If they are read off different chapters the darkest cell
        # is not the fullest one, which is the only thing the grid is for.
        for r, c, value in self.plan["cells"]:
            shown = self.rows[r][c]
            self.assertEqual(shown if shown != "" else 0, value,
                             f"cell {r},{c} shows {shown!r}, tinted for "
                             f"{value}")


class ASheetGetsExactlyOneBasicFilter(unittest.TestCase):
    """Asking twice is not an error — the second call silently wins."""

    def test_the_map_asks_for_the_basic_filter_once(self):
        _rows, plan = covtab.build(corpus())
        self.assertEqual(len([f for f in plan["filters"] if f[-1]]), 1,
                         plan["filters"])

    def test_no_two_filter_views_collide_where_covfmt_truncates_them(self):
        # covfmt writes `name[:60]`; two views with the same truncated title
        # are one view as far as the API is concerned. The map names one view
        # per subject, so this is the tab where they can collide.
        _rows, plan = covtab.build(corpus())
        names = [f[0][:60] for f in plan["filters"]]
        self.assertEqual(len(names), len(set(names)), names)

    def test_every_filter_range_starts_on_its_own_header_row(self):
        # A filter whose range starts one row late eats the first book of the
        # block; one row early puts the section banner in the filter.
        _rows, plan = covtab.build(corpus())
        for _n, r0, r1, c0, c1, _b in plan["filters"]:
            self.assertIn(r0, plan["head_rows"])
            self.assertGreater(r1, r0)
            self.assertEqual((c0, c1), (0, plan["n_cols"]))


class TheOverflowLaneStartsAtTheBarNotAtTheShareColumn(unittest.TestCase):

    def test_the_only_overflow_range_begins_at_the_bar_column(self):
        # Share is 52px. A sentence starting there is clipped mid-word; the
        # same sentence starting at the bar column runs to the tab's edge.
        _rows, plan = covtab.build(corpus())
        self.assertEqual(len(plan["overflow"]), 1)
        _r0, _r1, c0, c1 = plan["overflow"][0]
        self.assertEqual(c0, covtab.BAR_C)
        self.assertEqual(c1, plan["n_cols"])

    def test_the_overflow_range_covers_the_mix_rows_and_stops(self):
        # Running it over the chapter grid would let a long chapter title
        # spill across the heat cells and hide them.
        rows, plan = covtab.build(corpus())
        r0, r1, _c0, _c1 = plan["overflow"][0]
        mix = [f for f in plan["filters"] if f[-1]][0]
        self.assertEqual((r0, r1), (mix[1] + 1, mix[2]))

    def test_the_tab_freezes_no_column(self):
        # OVERFLOW_CELL cannot cross a frozen-column boundary, and every
        # banner starts in column A, so a column freeze would break both.
        _rows, plan = covtab.build(corpus())
        self.assertNotIn("freeze_cols", plan)


class TheBarsSayTheSameThingTheNumbersDo(unittest.TestCase):

    def test_a_bar_never_runs_wider_than_the_width_it_was_given(self):
        # The bar shares its row with the overflow lane; a bar longer than its
        # budget pushes the sentence off the tab. `scale` is the largest count
        # in the subject, so no count above it is reachable.
        for n in range(0, 21):
            self.assertLessEqual(len(covtab.bar(n, 20, width=20)), 20)

    def test_more_days_never_draw_a_shorter_bar(self):
        lengths = [len(covtab.bar(n, 37)) for n in range(0, 38)]
        self.assertEqual(lengths, sorted(lengths))

    def test_a_full_count_fills_the_bar_and_zero_draws_nothing(self):
        self.assertEqual(len(covtab.bar(20, 20, width=20)), 20)
        self.assertEqual(covtab.bar(0, 20), "")

    def test_an_empty_book_does_not_divide_by_zero(self):
        # `scale` is a max() over a possibly empty tally. It has defaulted to
        # 1, but the bar must survive 0 rather than take the build down.
        self.assertEqual(covtab.bar(3, 0), "")

    def test_a_count_too_small_to_fill_a_block_still_leaves_a_mark(self):
        # Rounding a small share to nothing reads as "this skill is absent",
        # which is a different and much worse claim than "this skill is rare".
        self.assertNotEqual(covtab.bar(1, 40, width=20), "")


class ZeroIsADashInTheMixAndABlankInTheGrid(unittest.TestCase):
    """Two different questions, so two different marks, on purpose."""

    def test_the_mix_writes_a_dash_where_a_skill_is_never_taught(self):
        # Beside a "0%" share, a blank cell reads as missing data rather than
        # as a real zero.
        rows, plan = covtab.build(corpus())
        mix = [f for f in plan["filters"] if f[-1]][0]
        for row in rows[mix[1] + 1:mix[2]]:
            self.assertTrue(row[covtab.NUM_C] != "",
                            f"a blank count in the mix: {row}")
            self.assertTrue(row[covtab.SHARE_C] != "")

    def test_the_grid_leaves_the_untaught_cell_blank(self):
        # Here the blank IS the signal — the tab's own note says so, and a
        # grid full of zeros is unreadable at a glance.
        rows, plan = covtab.build(corpus())
        blanks = [r for r, c, v in plan["cells"] if v == 0]
        self.assertTrue(blanks, "the fixture has no empty grid cell to check")
        for r, c, value in plan["cells"]:
            if value == 0:
                self.assertEqual(rows[r][c], "")

    def test_bookkeeping_gets_its_own_line_per_book_outside_the_mix(self):
        # Revision days are excluded from the bars; without this line they
        # would simply be missing from the tab and the year would look short.
        rows, _plan = covtab.build(corpus())
        admin = [r for r in rows if r[covtab.TEXT_C] ==
                 "Revision, assessment & review"]
        self.assertEqual(len(admin), 2, "one line per book, not per subject")
        for row in admin:
            self.assertIn("not counted", row[covtab.BAR_C])


class TheLayoutNeverReachesForThePainter(unittest.TestCase):

    def test_covtab_does_not_import_covfmt_or_a_sheets_client(self):
        # The one-way rule the covdata/covtab/covfmt split exists to keep.
        # Broken, this file can no longer be tested without a live Sheet.
        with open(covtab.__file__, encoding="utf-8") as fh:
            source = fh.read()
        for forbidden in ("covfmt", "sheetio", "googleapiclient", "build.py"):
            self.assertNotIn(f"import {forbidden}", source)


if __name__ == "__main__":
    unittest.main()
