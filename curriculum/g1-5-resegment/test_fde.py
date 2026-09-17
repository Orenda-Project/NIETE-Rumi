"""fde -- reading the FDE syllabus breakdown without dropping a chapter.

Every promise here traces back to a real misreading recorded in fde.py's own
comments:

  - The page-truth corpus names a book "..._math"; the FDE docs are saved as
    "..._maths" (and "..._general_science" as "..._science"). load() must
    translate through stem_for before it looks on disk, or every maths and
    science doc silently returns None.
  - Several Urdu docs put three chapters in one cell -- "سبق نمبر 16 … Chap
    17 … Chap 18" -- because the three are taught together in one week.
    Reading only the cell's first line made 17 and 18 look dropped from the
    syllabus. They were not; they shared 16's cell.
  - The same docs mix scripts: "Chap 10" and "سبق نمبر ۱۰" are the same cell
    written two ways, Urdu-Indic digits included.
  - A title that happens to open with a digit must not be misread as a second
    chapter -- only the head of the cell, up to the colon, is searched for a
    trailing ", N" chapter list.
  - A bare holiday cell between two week rows closes the week it trails and
    stands as its own break entry, so the calendar can honour the same break
    FDE does. A holiday swallowed into the previous week's topics is the
    defect.
"""
import gc
import os
import tempfile
import unittest
import warnings

import fde


def _write(dirpath, stem, cells):
    """A fixture .txt in the tab-per-cell shape the real Docs export uses."""
    path = os.path.join(dirpath, stem + ".txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\t" + "\t".join(cells))
    return path


THREE_WEEK_DOC = [
    "IMPORTANT NOTE: this book follows the printed chapter order.",
    "September 2026",
    "Week 1\n1-5 Sept", "Chap 1: Numbers", "Count objects\nWrite numerals",
    "Week 2\n8-12 Sept", "Chap 2: Addition", "Add single digits",
    "October 2026",
    "Week 3\n29 Sept-3 Oct", "Chap 3: Subtraction", "Subtract single digits",
]

HOLIDAY_DOC = [
    "September 2026",
    "Week 1\n1-5 Sept", "Chap 1: Numbers", "Count objects",
    "Independence Day Holiday",
    "Week 2\n8-12 Sept", "Chap 2: Addition", "Add single digits",
]


# --------------------------------------------------------------------------
# load / stem_for -- the book-name alias
# --------------------------------------------------------------------------

class LoadGoesThroughTheBookNameAliasNotJustStemFor(unittest.TestCase):
    """Asserting on stem_for alone would pass even if load() forgot to call
    it -- the real failure mode is load() building the raw stem's path
    directly and finding nothing. These go through load()."""

    def test_a_math_stem_finds_the_file_saved_as_maths(self):
        with tempfile.TemporaryDirectory() as d:
            _write(d, "grade4_maths", ["September 2026", "Week 1\n1-5 Sept",
                                       "Chap 1: Numbers", "Count objects"])
            doc = fde.load(d, "grade4_math")
        self.assertIsNotNone(doc)

    def test_a_general_science_stem_finds_the_file_saved_as_science(self):
        with tempfile.TemporaryDirectory() as d:
            _write(d, "grade5_science", ["September 2026", "Week 1\n1-5 Sept",
                                         "Chap 1: Water", "States of matter"])
            doc = fde.load(d, "grade5_general_science")
        self.assertIsNotNone(doc)

    def test_a_stem_needing_no_alias_still_loads(self):
        with tempfile.TemporaryDirectory() as d:
            _write(d, "grade3_english", ["September 2026", "Week 1\n1-5 Sept",
                                         "Chap 1: Story", "Read aloud"])
            doc = fde.load(d, "grade3_english")
        self.assertIsNotNone(doc)


class LoadReturnsNoneRatherThanCrashingOrFakingAResult(unittest.TestCase):

    def test_a_book_with_no_fde_doc_returns_none(self):
        # Seventeen docs exist; most books have none. None is the honest
        # answer -- an empty dict would let a caller print zero weeks as if
        # that were FDE's own calendar rather than "no doc for this book".
        with tempfile.TemporaryDirectory() as d:
            doc = fde.load(d, "grade2_urdu")
        self.assertIsNone(doc)


# --------------------------------------------------------------------------
# chapter_numbers / chapter_number -- every chapter a cell names
# --------------------------------------------------------------------------

class ChapterNumbersReadsEveryChapterACellNamesInOrderWithNoDuplicates(unittest.TestCase):

    def test_three_chapters_across_three_lines_all_come_back_in_order(self):
        # The real defect: reading only the first line finds 16 and stops,
        # so 17 and 18 read as dropped from the syllabus. They share the cell.
        cell = "سبق نمبر 16\nChap 17\nChap 18"
        self.assertEqual(fde.chapter_numbers(cell), [16, 17, 18])

    def test_a_comma_separated_pair_on_one_line(self):
        self.assertEqual(fde.chapter_numbers("Chap 14 , 15"), [14, 15])

    def test_an_ampersand_pair_survives_a_title_with_its_own_ampersand(self):
        cell = "Chapter 10 & 11: Mass & Capacity"
        # "Mass & Capacity" has its own "&" -- if the search were not bounded
        # to the head of the cell, that second ampersand could invent a
        # third chapter that was never in the label at all.
        self.assertEqual(fde.chapter_numbers(cell), [10, 11])


class UrduIndicDigitsAreTheSameChapterAsTheirAsciiSpelling(unittest.TestCase):

    def test_sabaq_number_in_indic_digits_reads_as_ten(self):
        self.assertEqual(fde.chapter_number("سبق نمبر ۱۰"), 10)

    def test_it_matches_the_ascii_spelling_of_the_same_chapter(self):
        # One table switches scripts mid-column -- the two forms must resolve
        # to the same integer or the chapter would look like two different
        # chapters depending which week wrote it.
        self.assertEqual(fde.chapter_number("سبق نمبر ۱۰"),
                         fde.chapter_number("Chap 10"))


class ATitleThatOpensWithADigitIsNotMistakenForASecondChapter(unittest.TestCase):
    """The most valuable test in this file. Only the head of the cell, up to
    the colon, is searched for a trailing ", N" chapter -- a title after the
    colon that happens to contain ", <digit>" must not be read as another
    chapter."""

    def test_a_digit_led_phrase_after_the_colon_is_not_a_second_chapter(self):
        # Without the colon boundary, "...Games, 5 Little Ducks" would match
        # the same ", N" pattern that correctly catches "Chap 14 , 15" above,
        # and chapter_numbers would wrongly return [3, 5] -- inventing a
        # chapter 5 that this cell never named.
        cell = "Chap 3: Fun and Games, 5 Little Ducks"
        self.assertEqual(fde.chapter_numbers(cell), [3])

    def test_a_title_line_that_is_just_a_number_is_not_read_as_a_chapter(self):
        # The title line itself opens with a digit and has no chapter word in
        # front of it at all, unlike the head line's labelled chapter.
        cell = "Chap 7: Shapes\n5 Little Monkeys Jumping"
        self.assertEqual(fde.chapter_numbers(cell), [7])


class ChapterTitleStripsTheLabelInEitherScriptAndKeepsTheRest(unittest.TestCase):

    def test_strips_an_english_label(self):
        self.assertEqual(fde.chapter_title("Chap 3: Hello World!"), "Hello World!")

    def test_strips_an_urdu_label(self):
        self.assertEqual(fde.chapter_title("سبق نمبر 10: کہانی"), "کہانی")

    def test_keeps_the_lines_that_follow_the_title_line(self):
        cell = "Chap 5: Title Line\nSecond line details"
        self.assertEqual(fde.chapter_title(cell), "Title Line Second line details")


class KindOfChecksBreakBeforeAssessment(unittest.TestCase):

    def test_an_assessment_word_alone_reads_as_assessment(self):
        self.assertEqual(fde.kind_of("Term Exam"), "assessment")

    def test_a_break_word_alongside_an_assessment_word_reads_as_break(self):
        # Same cell, an assessment word added to a break word -- break must
        # still win, deliberately, because BREAK is checked first.
        self.assertEqual(fde.kind_of("Winter Vacation & Term Exam"), "break")


# --------------------------------------------------------------------------
# parse -- columns recovered by order, not by counting
# --------------------------------------------------------------------------

class ParseCarriesMonthDownTheRowsInsteadOfReadingItPerRow(unittest.TestCase):
    """Month is merged down the month's rows in the real docs -- a Week cell
    with no Month cell of its own must inherit the last Month cell seen, not
    read as blank."""

    def test_a_week_with_no_month_cell_of_its_own_inherits_the_last_one_seen(self):
        with tempfile.TemporaryDirectory() as d:
            weeks = fde.parse(_write(d, "gradeX_english", THREE_WEEK_DOC))
        self.assertEqual(weeks[0]["month"], "September 2026")
        self.assertEqual(weeks[1]["month"], "September 2026")

    def test_a_later_month_cell_changes_it_for_the_weeks_that_follow(self):
        with tempfile.TemporaryDirectory() as d:
            weeks = fde.parse(_write(d, "gradeX_english", THREE_WEEK_DOC))
        self.assertEqual(weeks[2]["month"], "October 2026")


class ParseKeepsEachWeeksTopicsWithThatWeekNotTheNextOne(unittest.TestCase):

    def test_topics_accumulate_into_the_row_that_opened_them(self):
        with tempfile.TemporaryDirectory() as d:
            weeks = fde.parse(_write(d, "gradeX_english", THREE_WEEK_DOC))
        self.assertEqual(weeks[0]["topics"], ["Count objects", "Write numerals"])
        self.assertEqual(weeks[1]["topics"], ["Add single digits"])

    def test_each_weeks_chapter_matches_its_own_chapter_cell(self):
        with tempfile.TemporaryDirectory() as d:
            weeks = fde.parse(_write(d, "gradeX_english", THREE_WEEK_DOC))
        self.assertEqual([w["chapter"] for w in weeks], [1, 2, 3])


class AHolidayCellClosesTheRowItTrailsAndStandsAsItsOwnEntry(unittest.TestCase):
    """A holiday swallowed into the previous week's topics is the defect --
    the calendar would then have no independent record of the break FDE
    itself observes."""

    def test_the_holiday_becomes_its_own_break_row_between_two_weeks(self):
        with tempfile.TemporaryDirectory() as d:
            weeks = fde.parse(_write(d, "gradeX_urdu", HOLIDAY_DOC))
        self.assertEqual([w["kind"] for w in weeks], ["teach", "break", "teach"])
        self.assertEqual(weeks[1]["week"], "")
        self.assertEqual(weeks[1]["title"], "Independence Day Holiday")

    def test_the_holiday_text_is_not_swallowed_into_the_previous_weeks_topics(self):
        with tempfile.TemporaryDirectory() as d:
            weeks = fde.parse(_write(d, "gradeX_urdu", HOLIDAY_DOC))
        self.assertEqual(weeks[0]["topics"], ["Count objects"])
        self.assertNotIn("Independence Day Holiday", weeks[0]["topics"])

    def test_the_week_after_the_holiday_opens_its_own_row_cleanly(self):
        with tempfile.TemporaryDirectory() as d:
            weeks = fde.parse(_write(d, "gradeX_urdu", HOLIDAY_DOC))
        self.assertEqual(weeks[2]["week"], "Week 2")
        self.assertEqual(weeks[2]["chapter"], 2)


# --------------------------------------------------------------------------
# book_chapters -- named-for-all-three, counted only for the leader
# --------------------------------------------------------------------------

class BookChaptersCountsEveryNamedChapterButOnlyTheLeaderAccruesTheWeek(unittest.TestCase):

    def setUp(self):
        week = {"kind": "teach", "chapters": [16, 17, 18],
                "title": "Combined Lessons", "topics": ["Revision"]}
        self.chapters = fde.book_chapters([week])

    def test_all_three_named_chapters_appear_in_the_book(self):
        # Half the promise: a chapter sharing a week's cell must still show
        # up as a chapter the book carries, not vanish because it did not
        # lead the week.
        self.assertEqual(set(self.chapters), {16, 17, 18})

    def test_only_the_leading_chapter_counts_the_week_the_other_two_do_not(self):
        # The other half: the week is one week, so counting it against all
        # three named chapters would inflate every book's week totals.
        self.assertEqual(self.chapters[16]["weeks"], 1)
        self.assertEqual(self.chapters[17]["weeks"], 0)
        self.assertEqual(self.chapters[18]["weeks"], 0)


class ReadingASyllabusLeavesNoFileHandleOpen(unittest.TestCase):
    """A build reads 20 docs; a leaked handle per read is a leak per book.

    `cells` is the only thing in this module that touches the filesystem, and
    it is called once per book per build. Reading through a bare `open(...)`
    expression hands the handle to the garbage collector instead of closing
    it, which CPython happens to survive and which is a real leak anywhere the
    refcount is not the thing closing the file. It also fills the test output
    with ResourceWarnings, and a suite that always prints warnings is a suite
    where nobody reads the new one.
    """

    def test_cells_closes_the_file_it_opened(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = _write(tmp, "grade1_english", ["Month: April", "Week 1"])
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")
                fde.cells(path)
                gc.collect()
        leaked = [w for w in caught
                  if issubclass(w.category, ResourceWarning)]
        self.assertEqual(leaked, [], f"fde.cells leaked a handle: "
                                     f"{[str(w.message) for w in leaked]}")


if __name__ == "__main__":
    unittest.main()
