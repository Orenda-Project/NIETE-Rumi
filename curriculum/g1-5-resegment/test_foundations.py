"""The Grade 1 Foundations block, made legible on the Teaching Calendar.

Grade 1 children arrive with no ECE. The first six weeks of the session are
integrated FLN work — oral language, rhyme, syllables, initial sounds, print
concepts, pencil control, counting — and they are not the textbook at all.

The grid is banded by CHAPTER, so a phase with no chapter to sit in has
nothing to colour it. Left unmarked it reads as six weeks where the book
should be: a gap, not a decision. So it gets four things, and this file holds
all four to the standard the rest of the tab is held to.

  1. a colour of its own — warm gold, far enough from every other swatch that
     the legend does not print one mark twice (test_caltab's JND rule);
  2. a line in MARKS that names it, in a name that fits the column it is
     written in. Four separate defects on these tabs have been exactly a
     legend string quietly clipped at its column edge;
  3. its periods counted in the Basics column, so the tab's own numbers add
     up rather than under-reporting Grade 1 by six weeks;
  4. a sentence on the overview tab saying in plain words what those weeks
     are, for a teacher who is not a subject expert.

`ramp.allocate` grows a `"foundations"` count alongside `"onramp"` and
`"fill"`, and emits periods of `{"chapter": None, "skill": ..., "kind":
"foundations"}`. That is M1's change and it is not this file's to make, so the
fixtures here stub the contract: these tests state it either way.
"""
import unittest

import calfmt
import caltab
import calover


PX_PER_CHAR = 6.5      # fontSize 10, measured the hard way on this sheet


def _rng(sid, r0, r1, c0, c1):
    return {"sheetId": sid, "startRowIndex": r0, "endRowIndex": r1,
            "startColumnIndex": c0, "endColumnIndex": c1}


def _grid_plan(kinds, bands):
    lead = 5
    return {"lead": lead, "grid_top": 0, "body_top": 1, "body_rows": 1,
            "n_cols": lead + len(kinds), "bands": [bands], "kinds": [kinds],
            "assessment_cols": [], "break_cols": [],
            "content_cut": lead + len(kinds)}


def _stats(**over):
    """One allocator stats record, carrying the key M1's change adds."""
    base = {"factual": 90, "fill": 8, "onramp": 10, "foundations": 12}
    base.update(over)
    return base


class TheGridPaintsFoundationsAsAMarkOfItsOwn(unittest.TestCase):

    def test_the_painter_has_a_background_for_the_foundations_kind(self):
        self.assertIn("foundations", calfmt.KIND_BG)
        self.assertEqual(calfmt.KIND_BG["foundations"], calfmt.FOUNDATION)

    def test_the_legend_can_actually_draw_the_swatch_it_promises(self):
        self.assertTrue(calfmt.knows_swatch("foundations"))
        self.assertEqual(calfmt.SWATCH_BG["foundations"], calfmt.FOUNDATION)

    def test_the_gold_is_tellable_apart_from_every_other_swatch(self):
        # The same redmean rule test_caltab applies to the palette, asserted
        # here against the new colour specifically so a future nudge to the
        # gold fails in the file that introduced it.
        from test_caltab import NoTwoMarksLookTheSameInTheLegend as Rule
        for name, colour in calfmt.SWATCH_BG.items():
            if name == "foundations":
                continue
            d = Rule._distance(calfmt.FOUNDATION, colour)
            self.assertGreaterEqual(
                d, Rule.JND,
                f"foundations and {name} are one mark to the eye ({d:.0f})")

    def test_a_foundations_run_is_painted_gold_AND_set_italic(self):
        # Both, not either. The gold says "this phase is not the book"; the
        # italic says "this is a basics period", the same thing it says for
        # every other non-textbook period on the grid. `_grid` used to pick
        # one branch or the other, so a kind in KIND_BG could never also be
        # italic and the ITALIC membership was dead.
        plan = _grid_plan(["foundations", "foundations", "book", "book"],
                          [None, None, 1, 1])
        reqs = calfmt._grid(_rng, 7, plan)
        gold = [r for r in reqs
                if r.get("repeatCell", {}).get("cell", {})
                .get("userEnteredFormat", {})
                .get("backgroundColor") == calfmt.FOUNDATION]
        italic = [r for r in reqs
                  if r.get("repeatCell", {}).get("fields")
                  == "userEnteredFormat.textFormat.italic"]
        self.assertEqual(len(gold), 1, "the foundations run was not painted")
        self.assertEqual(len(italic), 1, "the foundations run was not italic")
        for req in gold + italic:
            self.assertEqual(
                (req["repeatCell"]["range"]["startColumnIndex"],
                 req["repeatCell"]["range"]["endColumnIndex"]), (5, 7))


class TheLegendNamesTheGoldBand(unittest.TestCase):

    def _line(self):
        found = [m for m in caltab.MARKS if m[3] == "foundations"]
        self.assertEqual(len(found), 1,
                         "MARKS has no line for the foundations colour")
        return found[0]

    def test_the_gold_band_name_fits_the_column_it_is_written_in(self):
        # The mark NAME is written in column 1 of the key row and is NOT
        # registered as overflow — its neighbours in that row are the swatch
        # itself, which fences it. So it has LEAD_W[1] and no more.
        budget = int(calfmt.LEAD_W[1] / PX_PER_CHAR)
        name = self._line()[1]
        self.assertLessEqual(len(name), budget,
                             f"{name!r} is clipped at {budget} characters")

    def test_no_mark_name_outgrows_the_column_they_all_share(self):
        # The standing invariant, so the next line added here is measured
        # too. Green from the day it was written; that is the point of it.
        budget = int(calfmt.LEAD_W[1] / PX_PER_CHAR)
        for _code, name, _text, _sw in caltab.MARKS:
            self.assertLessEqual(len(name), budget, name)

    def test_the_explanation_says_what_the_weeks_are_in_plain_words(self):
        text = self._line()[2].lower()
        self.assertIn("grade 1", text)
        self.assertIn("six weeks", text)
        # Named as a decision, not as an absence. This is the whole reason
        # the mark exists.
        self.assertIn("not a gap", text)

    def test_the_explanation_is_registered_as_overflowing_prose(self):
        # Every MARKS explanation is written at column WIDE and listed in
        # `over`, which is what makes OVERFLOW_CELL legal for it. A line that
        # skipped that registration would be clipped at 30px.
        rows, _chips, _sections, over, _swatch = caltab.key_block(40)
        hit = [i for i, row in enumerate(rows)
               if row[caltab.WIDE] == self._line()[2]]
        self.assertEqual(len(hit), 1)
        self.assertIn(hit[0], over)

    def test_the_swatch_stops_short_of_the_explanation_it_labels(self):
        _rows, _chips, _sections, _over, swatch = caltab.key_block(40)
        gold = [s for s in swatch if s[3] == "foundations"]
        self.assertEqual(len(gold), 1)
        self.assertLessEqual(gold[0][2], caltab.WIDE)


class TheBasicsColumnCountsTheFoundationsPeriods(unittest.TestCase):
    """The Basics cell is the tab's own arithmetic. Grade 1's first six weeks
    are basics periods by every reading of the word; leaving them out of the
    count understates the one grade the block exists for."""

    def _basics(self, st):
        import schoolyear as sy
        days = sy.school_days()[:3]
        cells = [("", None, "")] * len(days)
        rows, _b, _k, head = caltab.grid_block([(1, "English", cells, st)],
                                               days)
        return rows[head][caltab.LEAD.index("Basics")]

    def test_the_basics_count_includes_the_foundations_periods(self):
        self.assertEqual(self._basics(_stats()), 30)      # 8 + 10 + 12

    def test_it_is_a_sum_and_not_one_of_the_three_numbers(self):
        # Separated so the assertion above cannot pass on a coincidence.
        self.assertEqual(self._basics(_stats(fill=1, onramp=2,
                                             foundations=4)), 7)


class TheOverviewTabNamesTheFoundationsBlock(unittest.TestCase):
    """A reader of the overview tab has to understand that Grade 1's first
    six weeks are not the book — otherwise the gold band on the other tab is
    a colour with no explanation anywhere in reach."""

    def setUp(self):
        base = {"ideal": 100, "budget": 120, "placed": 100, "dropped": 0,
                "onramp": 10, "fill": 8}
        self.rows, _s, _h = calover.assumption_block([(1, "English", base)])
        self.hits = [row for row in self.rows
                     if any("foundations" in str(c).lower() for c in row)]

    def test_the_block_is_named_on_the_tab(self):
        self.assertTrue(self.hits, "the overview never says Foundations")

    def test_it_says_which_grade_and_how_long(self):
        body = " ".join(str(c) for row in self.hits for c in row).lower()
        self.assertIn("grade 1", body)
        self.assertIn("six weeks", body)

    def test_every_line_it_adds_is_inside_the_overflow_budget(self):
        self.assertTrue(self.hits)
        for row in self.hits:
            for cell in row:
                self.assertLessEqual(
                    len(str(cell)), 150,
                    f"{cell!r} runs past where the sheet cuts it")

    def test_each_line_starts_in_a_column_whose_neighbours_are_empty(self):
        # OVERFLOW_CELL cannot run through an occupied neighbour, and it
        # stops at the last declared column. One cell per row, and not the
        # last one.
        self.assertTrue(self.hits)
        for row in self.hits:
            filled = [i for i, c in enumerate(row) if c]
            self.assertEqual(len(filled), 1,
                             f"the row has a neighbour to fence it: {row}")
            self.assertLess(filled[0], calover.WIDE,
                            "a line in the last column cannot overflow")

    def test_it_survives_a_stats_record_with_no_foundations_count(self):
        # The sentence is about the calendar's DESIGN, not one book's
        # arithmetic. Reading a stats key for it would couple this tab to
        # M1's allocator change and blank the note on any caller that has
        # not got the key yet — exactly when a reader most needs telling.
        thin = {"ideal": 1, "budget": 1, "placed": 1, "dropped": 0,
                "onramp": 0, "fill": 0}
        rows, _s, _h = calover.assumption_block([(3, "Maths", thin)])
        body = " ".join(str(c) for row in rows for c in row).lower()
        self.assertIn("foundations", body)


if __name__ == "__main__":
    unittest.main()
