# -*- coding: utf-8 -*-
"""The Stage-B SLO columns on the sheet are made to say what the build says.

bd-t29rs. The matrix was painted before bd-fkc3a, so it still shows 88 Urdu
rows with a supporting code and an empty sentence beside it. Repainting the
tab is not available: `build.py English` drops and recreates the tab, which
would take 12,655 Stage C cells with it and hand the tab a new gid. So the
columns are patched in place, the way `dayobjsheet` patches the objective.

Two properties are the whole point of the file. The join is
(grade, chapter, day) and never the topic or the row index -- a row index
shifts the moment a column is inserted, and `grade_5_urdu` repeats three
topic strings inside itself. And a row this build has nothing to say about
keeps what it holds: a chapter header, a grade banner and an assessment
tail are not days, and blanking them would erase work to fix a defect they
do not have.
"""
import unittest

import stagebsync

HEADER = ["Day #", "Topic", "Skill type", "Pages (printed)", "Page overlap",
          "Primary SLO", "SLO role", "Primary SLO description",
          "Day objective", "Supporting SLOs", "Supporting SLO descriptions",
          "Bloom's", "Moves", "Flags"]

# Two teaching days of one chapter, with a grade banner and a chapter header
# above them and an assessment tail below -- the four row kinds a subject tab
# actually prints.
SHEET = [
    [u"GRADE 5", u"Urdu · 108 teaching days"],
    [u"Chapter 7:", u"حروف"],
    [u"Day 1", u"topic one", u"reading", u"7", u"", u"U-05-PH-01", u"introduces",
     u"", u"", u"U-05-RD-01", u"", u"Understand", u"{}", u""],
    [u"Day 2", u"topic two", u"reading", u"8", u"", u"U-05-RD-01", u"develops",
     u"stale sentence", u"", u"", u"", u"Apply", u"{}", u"old flag"],
    [u"✅ Ch. Assessment", u"jaiza", u"assessment", u"9", u"", u"", u"",
     u"", u"", u"U-05-RD-01", u"", u"", u"", u""],
]

#: Complete rows, because a real build row always is: a fixture missing a
#: key would let a bug that blanks a column pass as "the build says nothing
#: about it".
BUILT = [
    {"kind": "day", "grade": 5, "chapter": 7, "day_label": "Day 1",
     "topic": u"topic one", "skill_type": u"reading", "pages": u"7",
     "overlap": u"", "primary_slo": u"U-05-PH-01", "slo_role": u"introduces",
     "primary_slo_desc": u"", "supporting_slos": u"U-05-RD-01",
     "supporting_descs": u"نظم پڑھیں۔",
     "flags": u"SLO description missing from source — U-05-PH-01"},
    {"kind": "day", "grade": 5, "chapter": 7, "day_label": "Day 2",
     "topic": u"topic two", "skill_type": u"reading", "pages": u"8",
     "overlap": u"", "primary_slo": u"U-05-RD-01", "slo_role": u"develops",
     "primary_slo_desc": u"fresh sentence", "supporting_slos": u"",
     "supporting_descs": u"", "flags": u""},
]


class TheJoinIsGradeChapterDay(unittest.TestCase):

    def test_each_day_takes_its_own_build_row(self):
        p = stagebsync.plan(HEADER, SHEET, stagebsync.wanted(BUILT))
        self.assertEqual(p.values["Primary SLO description"],
                         [[u""], [u""], [u""], [u"fresh sentence"], [u""]])

    def test_a_day_the_build_does_not_have_is_reported_not_guessed(self):
        sheet = SHEET + [[u"Day 3", u"topic three"] + [u""] * 12]
        p = stagebsync.plan(HEADER, sheet, stagebsync.wanted(BUILT))
        self.assertEqual(p.missing, [(5, 7, 3)])

    def test_a_build_row_with_no_sheet_row_is_reported(self):
        built = BUILT + [dict(BUILT[0], chapter=9, day_label="Day 4")]
        p = stagebsync.plan(HEADER, SHEET, stagebsync.wanted(built))
        self.assertEqual(p.unplaced, [(5, 9, 4)])


class ARowThisBuildDoesNotOwnKeepsWhatItHolds(unittest.TestCase):

    def test_the_assessment_tail_keeps_its_supporting_codes(self):
        p = stagebsync.plan(HEADER, SHEET, stagebsync.wanted(BUILT))
        self.assertEqual(p.values["Supporting SLOs"][4], [u"U-05-RD-01"])

    def test_the_banner_rows_keep_their_blanks(self):
        p = stagebsync.plan(HEADER, SHEET, stagebsync.wanted(BUILT))
        self.assertEqual(p.values["Flags"][0], [u""])
        self.assertEqual(p.values["Flags"][1], [u""])


class OnlyWhatChangedIsCounted(unittest.TestCase):

    def test_a_column_reports_the_rows_it_would_change(self):
        p = stagebsync.plan(HEADER, SHEET, stagebsync.wanted(BUILT))
        # Day 1 gains a sentence, Day 2 loses the one it had.
        self.assertEqual(p.changed["Supporting SLO descriptions"], 1)
        self.assertEqual(p.changed["Primary SLO description"], 1)
        self.assertEqual(p.changed["Flags"], 2)

    def test_a_column_the_build_agrees_with_is_not_rewritten(self):
        p = stagebsync.plan(HEADER, SHEET, stagebsync.wanted(BUILT))
        self.assertEqual(p.changed["Supporting SLOs"], 0)
        self.assertEqual(p.dirty(), ["Primary SLO description",
                                     "Supporting SLO descriptions", "Flags"])


class AColumnOutsideStageBIsNeverTouched(unittest.TestCase):

    def test_moves_and_blooms_are_not_in_the_plan(self):
        p = stagebsync.plan(HEADER, SHEET, stagebsync.wanted(BUILT))
        self.assertNotIn("Moves", p.values)
        self.assertNotIn("Bloom's", p.values)


class TheBuildOwnsEveryStageBDayColumn(unittest.TestCase):
    """Not just the SLO cells.

    A chapter that re-folds changes the day's topic and its pages, not only
    the codes on it, so a sync that owned the SLO columns alone would leave
    a row whose topic described a lesson that no longer exists.
    """

    def test_a_topic_the_build_has_rewritten_is_corrected(self):
        built = [dict(BUILT[0], topic=u"rhyming only"), BUILT[1]]
        p = stagebsync.plan(HEADER, SHEET, stagebsync.wanted(built))
        self.assertEqual(p.values["Topic"][2], [u"rhyming only"])
        self.assertEqual(p.changed["Topic"], 1)

    def test_the_pages_travel_with_it(self):
        built = [dict(BUILT[0], pages=u"8"), BUILT[1]]
        p = stagebsync.plan(HEADER, SHEET, stagebsync.wanted(built))
        self.assertEqual(p.values["Pages (printed)"][2], [u"8"])


class ADayTheSheetIsMissingGetsARow(unittest.TestCase):
    """A split chapter needs a row before it can be written into.

    `plan` refuses a join that is not total, and rightly -- but the answer
    to "the build has a Day 7 and the sheet stops at Day 6" is a new row in
    the right place, not a silent skip. The position is found from the day
    BEFORE it so the insert lands inside its own chapter; appending at the
    end of the tab would put Chapter 1's new day after Chapter 20's.
    """

    def test_a_day_after_the_last_one_lands_at_the_end_of_its_chapter(self):
        built = BUILT + [dict(BUILT[1], day_label="Day 3", topic=u"new day")]
        got = stagebsync.inserts(HEADER, SHEET, stagebsync.wanted(built))
        self.assertEqual(got, [(4, (5, 7, 3))])

    def test_a_day_missing_from_the_middle_lands_after_the_one_before_it(self):
        sheet = [SHEET[0], SHEET[1], SHEET[2], SHEET[4]]      # Day 2 gone
        got = stagebsync.inserts(HEADER, sheet, stagebsync.wanted(BUILT))
        self.assertEqual(got, [(3, (5, 7, 2))])

    def test_a_total_join_needs_no_rows(self):
        self.assertEqual(
            stagebsync.inserts(HEADER, SHEET, stagebsync.wanted(BUILT)), [])

    def test_the_inserts_are_ordered_bottom_up(self):
        built = BUILT + [dict(BUILT[1], day_label="Day 3"),
                         dict(BUILT[1], day_label="Day 4")]
        got = stagebsync.inserts(HEADER, SHEET, stagebsync.wanted(built))
        # Applied in this order, an earlier insert cannot shift a later one.
        self.assertEqual([i for i, _ in got], sorted(
            [i for i, _ in got], reverse=True))


class AFreshRowSaysWhichStagesHaveNotRunOnIt(unittest.TestCase):
    """An inserted row starts empty, and empty is the wrong thing to say.

    Every other day row on the tab carries `pending` in the Stage C columns,
    so a blank one reads as a column that does not apply rather than a stage
    that has not reached this day yet. `Day objective` and `Human reviewer`
    stay blank on purpose -- nothing is coming for them automatically -- and
    so does `Traces`, which a later publish fills.
    """

    def test_the_build_columns_are_filled(self):
        row = stagebsync.fresh(HEADER, stagebsync.wanted(BUILT)[(5, 7, 1)])
        self.assertEqual(row[HEADER.index("Topic")], u"topic one")
        self.assertEqual(row[HEADER.index("Day #")], u"Day 1")

    def test_a_stage_c_column_says_pending(self):
        row = stagebsync.fresh(HEADER, stagebsync.wanted(BUILT)[(5, 7, 1)])
        self.assertEqual(row[HEADER.index("Moves")], stagebsync.PENDING)

    def test_the_columns_nobody_is_coming_for_stay_blank(self):
        row = stagebsync.fresh(HEADER, stagebsync.wanted(BUILT)[(5, 7, 1)])
        self.assertEqual(row[HEADER.index("Day objective")], u"")

    def test_the_row_is_exactly_as_wide_as_the_header(self):
        row = stagebsync.fresh(HEADER, stagebsync.wanted(BUILT)[(5, 7, 1)])
        self.assertEqual(len(row), len(HEADER))


if __name__ == "__main__":
    unittest.main()
