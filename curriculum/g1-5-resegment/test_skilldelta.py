"""skilldelta — which question the FIRST APPEARANCE block is answering.

The Skills Map has two sources and they answer different questions. The
textbook's day sequence says where a skill sits in the BOOK. The allocator
says where it sits in the YEAR. For one build the tab printed the first under
the heading "how far into the year", and the gap was not small: the Grade 1
English book reaches phonics about a tenth of the way in, while the calendar
teaches phonics in the first week, because the Grades 1-2 ramp hands its spare
periods to phonics from April. The tab was reporting the opposite of what the
calendar does, and nothing caught it because nothing asserted which source it
read.

So these tests assert the source, not a number. The numbers move every time a
book or a break date moves; which question the tab answers must not.
"""
import unittest

import skilldelta
import skillmap
import skillgrid


BOOK = {
    "labels_seen_in_data": {"English": ["Phonics"]},
    "labels_not_in_ORDER": [],
    "skill_reference": [{"subject": "English", "label": "Phonics",
                         "key": "phonics"}],
    "subjects": {"English": {"grades": {
        "1": {"n_days": 100,
              "day_sequence_runs": [["Phonics", 100]],
              "slots_per_skill": {"Phonics": 100},
              "chapters": [],
              # The book reaches phonics halfway through.
              "first_appearance": {"Phonics": {"first_day_ordinal": 50,
                                               "n_days_in_grade": 100,
                                               "pct_through": 50.0,
                                               "chapter": 5}}}}}},
}

# What the calendar actually does with it: period 1 of the year.
CALENDAR = {("English", "1"): {"phonics": {"period": 1, "of": 135,
                                           "pct_through": 0.0}}}

KEYMAP = {("English", "Phonics"): "phonics"}


def _cells(rows, label):
    for row in rows:
        if row and str(row[0]).startswith(label):
            return row
    return None


class FirstAppearanceReadsTheCalendar(unittest.TestCase):

    def test_the_percentage_comes_from_the_calendar_not_the_book(self):
        rows, _c = skilldelta.delta_block(BOOK, KEYMAP, CALENDAR)
        row = _cells(rows, "English · Phonics")
        self.assertEqual(row[skillgrid.GRADE_C], "0%",
                         "the book's 50% leaked into the calendar column")

    def test_the_title_says_which_source_it_read(self):
        rows, _c = skilldelta.delta_block(BOOK, KEYMAP, CALENDAR)
        self.assertIn("Teaching Calendar", rows[0][0])

    def test_without_a_calendar_it_says_so_rather_than_implying_one(self):
        # The fallback is honest, not silent: a reader must not take a book
        # number for a calendar number twice.
        rows, _c = skilldelta.delta_block(BOOK, KEYMAP)
        self.assertIn("BOOK", rows[0][0])
        self.assertIn("NOT the calendar", rows[0][0])
        self.assertEqual(_cells(rows, "English · Phonics")[skillgrid.GRADE_C],
                         "50%")

    def test_a_skill_the_calendar_never_reaches_is_not_invented(self):
        rows, _c = skilldelta.delta_block(BOOK, KEYMAP, {("English", "1"): {}})
        row = _cells(rows, "English · Phonics")
        # It has slots in the book, so the tab marks it present-but-unplaced
        # rather than printing a percentage it does not have.
        self.assertEqual(row[skillgrid.GRADE_C], "·")

    def test_the_timeline_block_is_labelled_as_the_book(self):
        rows, *_rest = skillmap.timeline_block(
            "English", BOOK["subjects"]["English"], KEYMAP, ["Phonics"])
        self.assertIn("BOOK", rows[0][0])


class ASkillTheCalendarTeachesGetsARowEvenIfTheBookNeverDoes(unittest.TestCase):
    """FIRST APPEARANCE reads its onset from the Teaching Calendar — that was
    the whole of bd-qazou. But it still got its LIST of skills from the book:
    the loop runs over `labels_seen_in_data`, the labels that have day rows in
    a textbook. Communicative language and number fluency have none, by
    definition — they are the basics periods the calendar allocates around the
    book. So the one part of the tab that knows exactly which period they start
    on printed no row for them at all.

    The absence block two blocks down says, correctly, that the calendar
    teaches them every week. This block said nothing, and a reader comparing
    the two concludes the calendar's claim is unevidenced.

    So: if the calendar reaches a skill, it gets a line here. Which is also
    why the row has to say where it came from — a percentage in a column
    headed by four textbook subjects, with no day row anywhere behind it,
    otherwise reads as a book number.
    """

    # The book teaches only phonics. The calendar teaches phonics AND the
    # oral-language periods that ride alongside it from April.
    CALENDAR = {("English", "1"): {
        "phonics": {"period": 1, "of": 135, "pct_through": 0.0},
        "communicative": {"period": 4, "of": 135, "pct_through": 2.2}}}

    def test_a_basics_only_skill_is_listed(self):
        rows, _c = skilldelta.delta_block(BOOK, KEYMAP, self.CALENDAR)
        self.assertIsNotNone(_cells(rows, "English · Communicative language"),
                             "the calendar teaches it and the tab is silent")

    def test_it_carries_the_calendar_percentage_it_was_silent_about(self):
        rows, _c = skilldelta.delta_block(BOOK, KEYMAP, self.CALENDAR)
        row = _cells(rows, "English · Communicative language")
        self.assertEqual(row[skillgrid.GRADE_C], "2%")

    def test_the_row_says_the_periods_are_not_in_any_book(self):
        rows, _c = skilldelta.delta_block(BOOK, KEYMAP, self.CALENDAR)
        row = _cells(rows, "English · Communicative language")
        self.assertIn("basics", str(row[skillgrid.NOTE_C]).lower())

    def test_a_book_skill_is_not_relabelled_as_basics(self):
        rows, _c = skilldelta.delta_block(BOOK, KEYMAP, self.CALENDAR)
        row = _cells(rows, "English · Phonics")
        self.assertNotIn("basics", str(row[skillgrid.NOTE_C]).lower())

    def test_the_book_fallback_invents_no_basics_row(self):
        # With no calendar there is no onset to report, and a row with five
        # dashes under it would be a new way of saying "never taught" about
        # something taught every week.
        rows, _c = skilldelta.delta_block(BOOK, KEYMAP)
        self.assertIsNone(_cells(rows, "English · Communicative language"))


URDU = {
    "labels_seen_in_data": {"Urdu": ["\u062c\u0627\u0626\u0632\u06c1 \u00b7 Assessment"]},
    "labels_not_in_ORDER": [],
    "skill_reference": [{"subject": "Urdu",
                         "label": "\u062c\u0627\u0626\u0632\u06c1 \u00b7 Assessment",
                         "key": "jaiza"}],
    "subjects": {"Urdu": {"grades": {
        "1": {"n_days": 100,
              "day_sequence_runs": [["\u062c\u0627\u0626\u0632\u06c1 \u00b7 Assessment", 100]],
              "slots_per_skill": {"\u062c\u0627\u0626\u0632\u06c1 \u00b7 Assessment": 100},
              "chapters": [],
              "first_appearance": {
                  "\u062c\u0627\u0626\u0632\u06c1 \u00b7 Assessment": {
                      "first_day_ordinal": 50, "n_days_in_grade": 100,
                      "pct_through": 50.0, "chapter": 5}}}}}},
}

URDU_KEYMAP = {("Urdu", "\u062c\u0627\u0626\u0632\u06c1 \u00b7 Assessment"): "jaiza"}


class OneSkillGetsOneRowWhateverTheCalendarCallsIt(unittest.TestCase):
    """The two sources name the same skill differently, and Urdu is where it
    shows. The corpus writes `skill_type: assessment` on an Urdu segment, so
    the allocator carries that word through and the calendar's onsets are
    keyed `assessment`. The book's own key is `jaiza` — skills.ALIAS exists
    precisely because those are one skill.

    This block compared the two as plain strings, so the tab printed Urdu
    assessment twice and told two contradictory stories about it:

      * the book's row found no onset and rendered five dots under "no Day N
        row in any grade" — about a skill with a day row in all five grades;
      * a second row appeared under the same name and the same JZ code,
        marked "calendar basics", which says the opposite: that it has no day
        row in any book and is a period the calendar adds around one.

    Revision did the same in Grade 5. A reader cannot tell which line to
    believe, and both are wrong.
    """

    CALENDAR = {("Urdu", "1"): {"assessment": {"period": 3, "of": 150,
                                               "pct_through": 1.3}}}

    def _rows(self):
        rows, _c = skilldelta.delta_block(URDU, URDU_KEYMAP, self.CALENDAR)
        return [r for r in rows
                if str(r[skillgrid.SKILL_C]).startswith("Urdu \u00b7 ")]

    def test_the_skill_is_listed_once_not_once_per_name_for_it(self):
        named = [str(r[skillgrid.SKILL_C]) for r in self._rows()]
        self.assertEqual(len(named), len(set(named)), f"duplicated: {named}")

    def test_the_book_row_carries_the_onset_the_calendar_reported(self):
        # The lookup is by the book's key. An alias on the calendar side used
        # to miss it, and a miss renders as "no Day N row in any grade".
        row = self._rows()[0]
        self.assertEqual(row[skillgrid.GRADE_C], "1%")

    def test_a_textbook_skill_is_never_marked_as_a_basics_period(self):
        # "calendar basics" means no book teaches it. This one fills a
        # hundred day rows in Grade 1 alone.
        for row in self._rows():
            self.assertNotIn("basics", str(row[skillgrid.NOTE_C]).lower())


if __name__ == "__main__":
    unittest.main()
