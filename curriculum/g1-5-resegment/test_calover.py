"""calover — the overview must report the year that was BUILT, not the budget.

This tab is the one place a reader looks to answer "does the whole book
actually get taught?". For six months it answered the easy version of that
question instead. The verdict column was computed as `budget - ideal`: periods
the timetable has, minus periods the book needs. That arithmetic says "20
periods spare" for a book the allocator was in fact cutting six periods from,
because the allocator does not place periods evenly — the Grades 1-2 ramp
tilts the year's weight towards the back, the back weeks are already full, and
what does not fit is dropped. Budget and placement are different numbers and
this column asked the wrong one. `ramp` reports what it PLACED (`placed`,
`dropped`), counted off the built year; that is the only honest source.

Three more things on this tab are quietly load-bearing and are tested here:

  * every row overflows across the tab and then STOPS at its last column, so
    `sentences` exists to keep each line inside the budget. A paragraph
    written as one cell loses its tail silently: it looks fine in the API
    response and is cut on the sheet;

  * `month_block` leaves column 5 EMPTY on purpose, because the assessment
    window is written in column 4 and left to run through it. Anything put
    there fences the overflow and the window is clipped at 175px;

  * `build` hands the painter section and header ROW INDICES, computed with
    `base + r` offset arithmetic. Off by one there paints a banner over a data
    row, and nothing in the build fails — it just comes out wrong.

So these tests assert the SOURCE of the verdict and the SHAPE of the tab. The
wording moves every time Amena reads it; neither of those may move with it.
"""
import unittest

import calover
import schoolyear as sy


def stats(**over):
    """One allocator stats record, with the defaults of a book that fits."""
    base = {"ideal": 100, "budget": 120, "placed": 100, "dropped": 0,
            "onramp": 10, "fill": 8, "foundations": 0}
    base.update(over)
    return base


def text_of(rows):
    return " ".join(str(c) for row in rows for c in row)


def verdict_of(stat):
    """The verdict cell of the one book row. Row 0 is the banner, row 1 the
    column header; the trailing rows are the basics warnings and the closing
    paragraph, so `rows[-1]` is not the book."""
    rows, _s, heads = calover.assumption_block([(1, "English", stat)])
    return rows[heads[0] + 1][calover.WIDE]


class TheVerdictIsReadOffWhatWasPlacedNotOffTheBudget(unittest.TestCase):

    def test_a_book_with_room_to_spare_that_still_lost_periods_says_no(self):
        # The exact shape of the six-month defect: budget 140 against a
        # 120-period book, so `budget - ideal` is +20 and the naive column
        # said "20 periods spare". The allocator placed only 114. Six periods
        # of the book are not in the year, and the reader has to be told.
        verdict = verdict_of(stats(ideal=120, budget=140, placed=114,
                                   dropped=6))
        self.assertTrue(verdict.startswith("NO"),
                        f"budget slack hid a real shortfall: {verdict!r}")
        self.assertIn("6", verdict)

    def test_a_book_that_was_fully_placed_says_yes(self):
        # The other direction, so the test above is not passing because the
        # column simply always says NO.
        self.assertTrue(verdict_of(stats()).startswith("yes"))

    def test_the_spare_periods_are_counted_against_what_was_placed(self):
        # "Left for basics" is budget minus PLACED, not budget minus ideal.
        # With budget 120 and placed 100 that is 20 either way when nothing
        # was dropped, so the two are separated here: 130 - 118 = 12, while
        # 130 - 120 = 10. A column reading `ideal` reports 10 and is wrong.
        self.assertIn("12 periods left",
                      verdict_of(stats(ideal=120, budget=130, placed=118,
                                       dropped=0)))

    def test_one_spare_period_is_written_as_a_period_not_periods(self):
        # Tiny, but this line is read by teachers and "1 periods" is the kind
        # of thing that costs a tab its credibility.
        self.assertIn("1 period left",
                      verdict_of(stats(ideal=100, budget=101, placed=100)))

    def test_basics_periods_are_named_as_book_periods_spent_elsewhere(self):
        # When a book was cut, the on-ramp is not free time — it is the book's
        # own periods spent on basics. The tab has to say so beside the NO, or
        # the reader reads the shortfall as the timetable being too short.
        rows, _s, _h = calover.assumption_block(
            [(1, "English", stats(ideal=120, budget=140, placed=114,
                                  dropped=6, onramp=14, fill=4))])
        body = text_of(rows)
        self.assertIn("not free", body)
        self.assertIn("18", body)          # onramp + fill, named as one number
        self.assertIn(calover.ONRAMP_NAME["English"], body)

    def test_a_book_that_fits_gets_no_basics_warning(self):
        # The warning is a finding, so it may not fire on every row or it
        # stops being one.
        rows, _s, _h = calover.assumption_block([(3, "Maths", stats())])
        self.assertNotIn("not free", text_of(rows))


class NoLineOnThisTabRunsPastWhereTheSheetCutsIt(unittest.TestCase):
    """A row overflows across the tab and then stops. Over budget = silently
    truncated on the sheet, with nothing in the API response to show for it."""

    BUDGET = 150

    def test_every_sentence_it_emits_is_inside_the_budget(self):
        long = ("word " * 200).strip()
        for line in calover.sentences(long):
            self.assertLessEqual(len(line), self.BUDGET, line)

    def test_no_word_is_lost_on_the_way_through(self):
        # Wrapping that drops its tail is exactly the defect being prevented,
        # so the words out must be the words in, in order. Asserting only the
        # line lengths would pass for a function that returned [].
        source = ("Alpha bravo charlie delta echo foxtrot golf hotel india "
                  "juliet kilo lima mike november oscar papa quebec romeo "
                  "sierra tango uniform victor whiskey xray yankee zulu. "
                  "Second sentence here with a few more words in it to push "
                  "the buffer over the wrap boundary at least once more.")
        self.assertEqual(" ".join(calover.sentences(source)).split(),
                         source.split())

    def test_a_single_short_sentence_is_left_as_one_line(self):
        self.assertEqual(calover.sentences("Short and done."),
                         ["Short and done."])

    def test_every_deviation_the_year_carries_is_inside_the_budget(self):
        # The real text, not a synthetic one: DEVIATIONS is hand-written prose
        # and grows whenever FDE contradicts itself again.
        for _window, body in sy.DEVIATIONS:
            for line in calover.sentences(body):
                self.assertLessEqual(len(line), self.BUDGET, line)


class EveryDisagreementWithFDEReachesTheTab(unittest.TestCase):

    def test_no_deviation_is_dropped_between_schoolyear_and_the_tab(self):
        # A deviation that never renders is worse than no conflict block at
        # all: the tab then claims to name the disagreements and does not.
        rows, _s, _h = calover.conflict_block()
        body = text_of(rows)
        for window, _text in sy.DEVIATIONS:
            self.assertIn(window, body, f"{window!r} never reaches the tab")

    def test_the_grades_1_2_ramp_is_flagged_as_an_assumption(self):
        # The ramp shape is a design decision that the RDF quiz results were
        # checked for and cannot carry. If this tab presents it as measured,
        # the whole calendar reads as evidence-backed when it is not.
        body = text_of(calover.conflict_block()[0]).lower()
        self.assertIn("assumption, not a measurement", body)

    def test_it_says_where_to_change_the_ramp(self):
        # A named assumption the reader cannot act on is just a disclaimer.
        self.assertIn("ramp.RAMP", text_of(calover.conflict_block()[0]))


class TheMonthViewLeavesTheOverflowLaneClear(unittest.TestCase):

    def test_column_five_is_empty_on_every_data_row(self):
        # Column 4 holds the assessment window and is 175px; the window text
        # is longer than that and runs into column 5, which is sized and left
        # empty for exactly that reason. A value there fences the overflow and
        # the window is clipped mid-word.
        rows, _s, heads = calover.month_block()
        for row in rows[heads[0] + 1:]:
            self.assertEqual(row[5], "", f"column 5 fenced by {row[5]!r}")

    def test_a_month_with_no_assessment_and_no_closure_still_says_so(self):
        # A blank cell and "no assessment this month" read the same on a
        # sheet, so both columns print an em dash rather than nothing.
        rows, _s, heads = calover.month_block()
        for row in rows[heads[0] + 1:]:
            self.assertTrue(row[4], "the assessment cell went blank")
            self.assertTrue(row[6], "the closures cell went blank")

    def test_it_covers_every_month_the_session_actually_teaches(self):
        rows, _s, heads = calover.month_block()
        months = {(d.year, d.month) for d in sy.school_days()}
        self.assertEqual(len(rows) - heads[0] - 1, len(months))


class ThePainterIsToldTheRightRowsToPaint(unittest.TestCase):
    """`build` offsets each block's own row numbers by `base`. Off by one
    there paints a section banner over a data row and nothing fails."""

    def setUp(self):
        self.rows, self.plan = calover.build(
            [(1, "English", stats()), (5, "Maths", stats(dropped=3,
                                                         placed=97))])

    def test_every_section_index_points_at_a_banner_row(self):
        # A banner is one cell in column 0 with the rest of the row empty.
        for i in self.plan["sections"]:
            row = self.rows[i]
            self.assertTrue(row[0], f"row {i} is not a banner: {row}")
            self.assertEqual([c for c in row[1:] if c], [],
                             f"row {i} has data beside the banner: {row}")

    def test_every_head_index_points_at_a_column_header_row(self):
        # A header fills several columns; a banner fills one. If the offsets
        # slipped by one these would land on each other.
        for i in self.plan["heads"]:
            row = self.rows[i]
            self.assertGreater(len([c for c in row if c]), 1,
                               f"row {i} is not a header: {row}")

    def test_no_row_index_is_handed_out_twice_or_out_of_range(self):
        given = self.plan["sections"] + self.plan["heads"]
        self.assertEqual(len(given), len(set(given)))
        for i in given:
            self.assertLess(i, len(self.rows))

    def test_all_three_blocks_actually_made_it_into_the_tab(self):
        # The tab's own subtitle promises three tables. Three banners.
        self.assertEqual(len(self.plan["sections"]), 3)

    def test_every_row_is_exactly_as_wide_as_the_plan_claims(self):
        # A short row is written as a short row and its tail columns keep
        # whatever the last build left there, which is how a stale value
        # survives a rebuild.
        for i, row in enumerate(self.rows):
            self.assertEqual(len(row), self.plan["n_cols"],
                             f"row {i} is {len(row)} wide")

    def test_the_widths_cover_every_column_the_rows_use(self):
        self.assertEqual(len(calover.WIDTHS), self.plan["n_cols"])
        self.assertEqual(self.plan["wide"], self.plan["n_cols"] - 1)


def row_of(rows, grade):
    return " ".join(str(c) for c in next(r for r in rows if r and r[0] == grade))


class TheFoundationsBlockIsNotCountedAsSpare(unittest.TestCase):
    """G1 Maths lands at budget 163 = 35 Foundations + 128 book, zero slack.

    Read as budget minus placed, the fit table would call those 35 periods
    "left for basics". They are the block, already spent, and a teacher who
    plans a gap-fill week on that number loses the year.
    """

    def setUp(self):
        rows, _s, _h = calover.assumption_block(
            [(1, "Maths", stats(ideal=128, budget=163, placed=128, onramp=0,
                                fill=0, foundations=35)),
             (2, "Maths", stats())])
        self.g1, self.g2 = row_of(rows, "G1"), row_of(rows, "G2")

    def test_the_block_is_named_in_the_basics_column(self):
        self.assertIn("35 Foundations", self.g1)

    def test_periods_left_for_basics_excludes_the_block(self):
        self.assertIn("0 periods left for basics", self.g1)
        self.assertNotIn("35 periods left", self.g1)

    def test_a_grade_without_a_block_reads_exactly_as_before(self):
        self.assertNotIn("Foundations", self.g2)
        self.assertIn("10 + 8", self.g2)
        self.assertIn("20 periods left for basics", self.g2)


class TheRampAssumptionRowKnowsAboutFoundations(unittest.TestCase):
    """Grade 1 no longer takes the textbook at half rate for six weeks: it
    takes none, and the block is the reason. A row that still says 1-2 sends
    a reader to look for a half-rate Grade 1 that the calendar does not have."""

    def setUp(self):
        rows, _s, _h = calover.conflict_block()
        self.text = row_of(rows, "Our own ramp assumption").lower()

    def test_grade_1_is_the_foundations_case(self):
        self.assertIn("grade 1", self.text)
        self.assertIn("foundations", self.text)

    def test_the_half_rate_ramp_is_grade_2_only(self):
        self.assertNotIn("grades 1-2", self.text)
        self.assertIn("grade 2", self.text)
        self.assertIn("half rate", self.text)


if __name__ == "__main__":
    unittest.main()
