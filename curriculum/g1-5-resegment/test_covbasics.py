"""The Coverage Map's zero that is not a gap — basics periods.

Three rows of the mix count zero textbook days in all five grades:
Communicative language in English, Communicative language in Urdu, and Number
fluency in Maths. None of them is a gap. The Teaching Calendar teaches them in
BASICS periods, which sit outside the textbook days this tab counts — the
Skills Map already says so under its own heading, and the Coverage Map used to
say nothing at all.

That silence is the expensive kind. This tab is the one that goes to FDE, an
em-dash beside a 0% share reads as "this subject never teaches speaking", and
the chapter grid below rings the same three columns in red as holes. So the
fact is asserted here, in three parts:

  * THE ROW SAYS WHERE THE SKILL IS TAUGHT, in the overflow lane the tab
    already uses for the bookkeeping line — the one place the reader is
    looking when they read the dash.
  * IT INVENTS NO NUMBER. The count and the share stay dashes. A basics
    allocation is periods in the calendar, not textbook days in this corpus,
    and adding them together would be a third number nobody could source.
  * A SKILL THAT REALLY IS UNTAUGHT KEEPS ITS BARE DASH. If every zero gets
    an excuse, the tab can no longer report a gap, which is what it is for.

The set of basics skills is NOT restated here or in `covtab`: `skillgrid`
names it for the Skills Map and both tabs read the one set, so the two tabs
cannot come to disagree about which zero is innocent.
"""
import unittest

import covdata
import covtab
import skillgrid
import skills
from test_covtab import corpus


def mix_rows(rows, plan):
    """The rows of the mix block, without its header."""
    block = [f for f in plan["filters"] if f[-1]][0]
    return rows[block[1] + 1:block[2]]


class ABasicsSkillSaysWhereItIsTaught(unittest.TestCase):

    def setUp(self):
        self.rows, self.plan = covtab.build(corpus())
        self.mix = mix_rows(self.rows, self.plan)

    def _basics(self):
        labels = {skills.label(k, s) for k in skillgrid.BASICS
                  for s in covdata.SUBJECTS}
        return [r for r in self.mix if r[covtab.TEXT_C] in labels]

    def test_the_fixture_has_a_basics_row_to_check(self):
        # English carries Communicative language and Maths carries Number
        # fluency in ORDER, and no fixture day teaches either.
        self.assertEqual(len(self._basics()), 2, self._basics())

    def test_each_one_names_basics_periods_in_the_overflow_lane(self):
        for row in self._basics():
            self.assertIn("basics period", row[covtab.BAR_C], row)

    def test_each_one_says_the_calendar_allocates_them_elsewhere(self):
        # "Taught somewhere" is not enough for a reader who has to answer
        # FDE: the row has to name the artefact that allocates the periods.
        for row in self._basics():
            self.assertIn("Teaching Calendar", row[covtab.BAR_C], row)

    def test_it_invents_no_number_for_them(self):
        for row in self._basics():
            self.assertEqual(row[covtab.NUM_C], "—", row)
            self.assertEqual(row[covtab.SHARE_C], "—", row)

    def test_the_row_is_marked_as_a_note_rather_than_as_a_bar(self):
        # Same treatment as the bookkeeping line: a row whose bar column holds
        # a sentence is flagged, so it does not read as a bar of length zero.
        at = {self.rows.index(row) for row in self._basics()}
        flagged = {r for r, c in self.plan["flags"] if c == covtab.TEXT_C}
        self.assertTrue(at, "no basics row found")
        self.assertTrue(at <= flagged, f"unflagged basics rows: {at - flagged}")

    def test_no_bar_is_drawn_for_a_row_that_carries_the_sentence(self):
        # The bar and the sentence share one column; a bar there would be
        # painted over the words.
        bars = {r for r, c, _hex in self.plan["bars"] if c == covtab.BAR_C}
        for row in self._basics():
            self.assertNotIn(self.rows.index(row), bars, row)


class AGenuineZeroKeepsItsBareDash(unittest.TestCase):

    def test_an_untaught_skill_that_is_not_basics_gets_no_excuse(self):
        # Phonics is a textbook skill the fixture's English book never
        # teaches. That IS the gap the tab exists to show.
        rows, plan = covtab.build(corpus())
        phonics = [r for r in mix_rows(rows, plan)
                   if r[covtab.TEXT_C] == skills.label("phonics")]
        self.assertEqual(len(phonics), 1, phonics)
        self.assertEqual(phonics[0][covtab.NUM_C], "—")
        self.assertEqual(phonics[0][covtab.BAR_C], "")

    def test_a_basics_skill_with_textbook_days_is_counted_like_any_other(self):
        # If the corpus ever does tag a communicative day, that day is a
        # textbook day and belongs in the bars — the sentence steps aside.
        book = corpus()
        book["English"][0][1].append(
            {"kind": "day", "skill_type": "communicative", "chapter": 1,
             "chapter_title": "Chapter 1", "primary_slo": "E-3",
             "supporting_slos": "", "slo_role": "introduces"})
        rows, plan = covtab.build(book)
        row = [r for r in mix_rows(rows, plan)
               if r[covtab.TEXT_C] == skills.label("communicative")][0]
        self.assertEqual(row[covtab.NUM_C], 1)
        self.assertNotIn("basics", row[covtab.BAR_C])


class TheChapterGridSaysItToo(unittest.TestCase):
    """Its empty cells are ringed red, which is a louder false gap than a dash."""

    def test_the_note_names_the_basics_skills_of_that_subject(self):
        rows, plan = covtab.build(corpus())
        notes = [rows[i][0] for i in plan["note_rows"]]
        english = [n for n in notes
                   if skills.label("communicative") in n]
        maths = [n for n in notes if skills.label("number_fluency") in n]
        self.assertTrue(english, notes)
        self.assertTrue(maths, notes)

    def test_the_note_of_a_subject_with_no_basics_skill_is_unchanged(self):
        # Science has neither in its vocabulary, so its note must not carry
        # an exception for skills its grid does not show.
        note = covtab.grid_note(["engage_hook"], "Science")
        self.assertEqual(note, covtab.GRID_NOTE)

    def test_the_exception_says_it_is_not_a_gap(self):
        note = covtab.grid_note(["communicative"], "English")
        self.assertNotEqual(note, covtab.GRID_NOTE)
        self.assertIn("not a gap", note)


class TheBasicsSetHasOneHome(unittest.TestCase):

    def test_covtab_reads_the_set_rather_than_restating_it(self):
        # A second copy of {communicative, number_fluency} is exactly the
        # failure the Days column was dropped for.
        with open(covtab.__file__, encoding="utf-8") as fh:
            source = fh.read()
        self.assertIn("skillgrid.BASICS", source)
        self.assertNotIn('"number_fluency"', source)


if __name__ == "__main__":
    unittest.main()
