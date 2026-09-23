# -*- coding: utf-8 -*-
"""Every code on a day row prints with its own sentence, or with none.

bd-fkc3a. `assign_slo_roles` paired a day's `slo_codes` with its
`slo_descriptions` by position, and on 369 of the corpus's segments the
second list is shorter than the first -- an assessment or a chapter review
writes ONE sentence about the whole day ("Assesses the chapter's SLOs via a
student worksheet.") beside five codes. `zip` truncates in silence, so 2,034
supporting codes reached the Curriculum Matrix as a code in one column with
an empty cell beside it.

The sentence for those codes is not missing from the book -- it is on the
ordinary teaching day that introduced the code. These tests hold three
things at once:

  * a bare code takes the sentence the book already gives it;
  * a DAY-LEVEL sentence never becomes some code's description, because
    "assesses the chapter's SLOs" is not what any one code says; and
  * a code the book never describes stays blank. Three codes are in that
    state and an invented sentence on the sheet is worse than a visible gap.

Split from `test_dayrules.py` rather than added to it: that file is at 263
lines and these are a rule of their own.
"""
import unittest

import dayrules

VOWELS = u"I can hear and say the short vowel sounds."
NAMES = u"I can write my own name."
SUMMARY = u"Assesses the chapter's SLOs via a student worksheet."


def _day(codes, descs, chapter=1, lp_type="content", label="Day 1"):
    return {"slo_codes": list(codes), "slo_descriptions": list(descs),
            "chapter_number": chapter, "lp_type": lp_type,
            "day_label": label, "pages_printed": []}


def _supporting(role):
    return dict(zip(role["supporting_slos"], role["supporting_descs"]))


class ABareSupportingCodeTakesTheSentenceTheBookGivesIt(unittest.TestCase):

    def setUp(self):
        # Two teaching days, each describing its own code, then the chapter
        # assessment listing both with one sentence about the day.
        self.roles = dayrules.assign_slo_roles([
            _day(["E-01-PH-01"], [VOWELS], label="Day 1"),
            _day(["E-01-WR-01"], [NAMES], label="Day 2"),
            _day(["E-01-PH-01", "E-01-WR-01"], [SUMMARY],
                 lp_type="assessment", label="Assessment"),
        ])

    def test_the_supporting_code_is_described(self):
        self.assertEqual(_supporting(self.roles[2]), {"E-01-WR-01": NAMES})

    def test_no_supporting_code_prints_bare(self):
        self.assertTrue(all(self.roles[2]["supporting_descs"]))


class ADayLevelSentenceIsNeverReusedAsACodesDescription(unittest.TestCase):

    def test_a_code_described_only_by_an_assessment_stays_blank(self):
        # E-01-VO-01 is listed by the assessment and by no teaching day. The
        # assessment's own sentence is about the day, so it must not travel.
        roles = dayrules.assign_slo_roles([
            _day(["E-01-PH-01"], [VOWELS], label="Day 1"),
            _day(["E-01-PH-01", "E-01-VO-01"], [SUMMARY],
                 lp_type="assessment", label="Assessment"),
            _day(["E-01-VO-01", "E-01-PH-01"], [u"Consolidates the chapter."],
                 lp_type="revision", label="Day 8 (Review)"),
        ])
        self.assertEqual(_supporting(roles[2]), {"E-01-PH-01": VOWELS})

    def test_a_revision_summary_does_not_become_a_primary_description(self):
        roles = dayrules.assign_slo_roles([
            _day(["E-01-PH-01"], [VOWELS], label="Day 1"),
            _day(["E-01-VO-01", "E-01-PH-01"], [SUMMARY],
                 lp_type="revision", label="Day 8 (Review)"),
        ])
        # E-01-VO-01 is introduced here, so it wins primary -- and the only
        # sentence on the row is about the day, not about the code.
        self.assertEqual(roles[1]["primary_slo"], "E-01-VO-01")
        self.assertNotEqual(roles[1]["primary_slo_desc"], VOWELS)


class TheChaptersOwnWordingWinsOverAnotherChapters(unittest.TestCase):

    def test_the_same_code_keeps_its_chapter_specific_sentence(self):
        # 77 codes are worded per chapter (a vocabulary code names that
        # chapter's new words). The bare code must not borrow chapter 1's.
        ch1 = u"New words: pen, book, bag."
        ch2 = u"New words: river, hill, cloud."
        roles = dayrules.assign_slo_roles([
            _day(["E-01-VO-01"], [ch1], chapter=1, label="Day 1"),
            _day(["E-01-VO-01"], [ch2], chapter=2, label="Day 1"),
            _day(["E-01-PH-01", "E-01-VO-01"], [SUMMARY], chapter=2,
                 lp_type="assessment", label="Assessment"),
        ])
        self.assertEqual(_supporting(roles[2]), {"E-01-VO-01": ch2})


class ACodeTheBookNeverDescribesStaysBlank(unittest.TestCase):

    def test_nothing_is_invented_for_an_undescribed_code(self):
        # E-05-LG-09 is listed only by the assessment, so it is introduced
        # there and wins primary -- with no sentence anywhere to give it.
        roles = dayrules.assign_slo_roles([
            _day(["E-01-PH-01"], [VOWELS], label="Day 1"),
            _day(["E-01-PH-01", "E-05-LG-09"], [SUMMARY],
                 lp_type="assessment", label="Assessment"),
        ])
        self.assertEqual(roles[1]["primary_slo"], "E-05-LG-09")
        self.assertEqual(roles[1]["primary_slo_desc"], "")
        self.assertEqual(_supporting(roles[1]), {"E-01-PH-01": VOWELS})


class AnOrdinaryDayIsUnchanged(unittest.TestCase):
    """The control: the fix widens what gets described, nothing else."""

    def test_an_aligned_day_keeps_its_own_sentences(self):
        role = dayrules.assign_slo_roles([
            _day(["E-01-PH-01", "E-01-WR-01"], [VOWELS, NAMES]),
        ])[0]
        self.assertEqual(role["primary_slo_desc"], VOWELS)
        self.assertEqual(_supporting(role), {"E-01-WR-01": NAMES})

    def test_a_day_that_truncates_by_one_keeps_the_sentence_it_has(self):
        # The 13 grade_5_urdu days: two codes, one sentence, and the
        # sentence is the first code's -- the day is not a summary row.
        roles = dayrules.assign_slo_roles([
            _day(["U-05-WR-01"], [NAMES], label="Day 1"),
            _day(["U-05-OC-01", "U-05-WR-01"], [VOWELS], label="Day 7"),
        ])
        self.assertEqual(roles[1]["primary_slo_desc"], VOWELS)
        self.assertEqual(_supporting(roles[1]), {"U-05-WR-01": NAMES})


if __name__ == "__main__":
    unittest.main()
