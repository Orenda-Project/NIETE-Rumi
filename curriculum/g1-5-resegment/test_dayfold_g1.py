"""Rule 3 reaches Grade 1 English and Maths — and stops there.

Six weeks of Foundations cost Grade 1 99 periods and the year's whole spare
is 66. The bill is paid by folding each Grade 1 chapter's revision into its
last teaching day, exactly as every Urdu chapter already is. It has to happen
at the load door, not in the allocator: a fold that only the calendar sees
leaves the subject tab, Coverage and the FDE tab counting periods that the
year does not have, and a fold that DROPS the row loses the SLO codes it
carries. Grades 2-5 English and Maths are not folded — those 130 periods are
a separate pedagogy decision (bd filed), not an accident of this gate.
"""
import json
import os
import unittest

import dayfold

HERE = os.path.dirname(os.path.abspath(__file__))
SEG = os.path.join(HERE, "corpus", "seg")


def seg(ch, label, skill, **kw):
    return dict({"chapter_number": ch, "day_label": label,
                 "skill_type": skill, "slo_codes": [], "pages_printed": [],
                 "notes": ""}, **kw)


def english_chapter(ch=1):
    return [seg(ch, "Day 1", "phonics", slo_codes=["E-01-PA-01"],
                pages_printed=[1]),
            seg(ch, "Day 2", "reading", slo_codes=["E-01-RD-01"],
                pages_printed=[2]),
            seg(ch, "Day 3", "revision", slo_codes=["E-01-PA-01", "E-01-VO-01"],
                pages_printed=None),
            seg(ch, "Day 4", "assessment", pages_printed=None)]


class TheGateOpensForGradeOneEnglishAndMaths(unittest.TestCase):

    def test_grade_1_english_folds_its_revision(self):
        out, freed = dayfold.fold_revision(english_chapter(), "English", 1)
        self.assertEqual(freed, 1)
        self.assertEqual([s["skill_type"] for s in out],
                         ["phonics", "reading", "assessment"])

    def test_the_host_keeps_every_slo_the_revision_carried(self):
        out, _freed = dayfold.fold_revision(english_chapter(), "English", 1)
        host = out[1]
        self.assertEqual(host["slo_codes"],
                         ["E-01-RD-01", "E-01-PA-01", "E-01-VO-01"])
        self.assertTrue(host["revision_folded"])
        self.assertEqual(host["pages_printed"], [2])

    def test_the_note_is_in_the_language_of_the_book(self):
        out, _freed = dayfold.fold_revision(english_chapter(), "English", 1)
        self.assertIn("Revision folded in", out[1]["notes"])
        self.assertNotIn("دہرائی", out[1]["notes"])

    def test_grade_1_maths_folds_both_of_a_chapter_s_revision_days(self):
        rows = [seg(2, "Day 1", "concrete", slo_codes=["M-01-NO-01"]),
                seg(2, "Day 2", "revision", slo_codes=["M-01-NO-01"]),
                seg(2, "Day 3", "revision", slo_codes=["M-01-NO-02"]),
                seg(2, "Day 4", "assessment")]
        out, freed = dayfold.fold_revision(rows, "Maths", 1)
        self.assertEqual(freed, 2)
        self.assertEqual(out[0]["slo_codes"], ["M-01-NO-01", "M-01-NO-02"])
        self.assertEqual(len(out), 2)

    def test_a_recap_that_opens_a_chapter_folds_into_its_first_day(self):
        # Grade 1 Maths chapters 2-4 open with a "Memory Lane recap" of the
        # chapter before, printed on the opening page and carrying the
        # COMING chapter's SLOs. It is prerequisite activation, so it folds
        # into the day it sits beside. Folding it into the chapter's last
        # teaching day would run the warm-up after the learning and strand
        # page 31 on a day that teaches page 52.
        rows = [seg(2, "Day 1", "revision", slo_codes=["M-01-PV-03"],
                    pages_printed=[31], topic="Memory Lane recap"),
                seg(2, "Day 2", "concrete", slo_codes=["M-01-PV-01"],
                    pages_printed=[32]),
                seg(2, "Day 3", "pictorial", slo_codes=["M-01-PV-02"],
                    pages_printed=[52]),
                seg(2, "Chapter Review", "revision",
                    slo_codes=["M-01-PV-04"], pages_printed=[53])]
        out, freed = dayfold.fold_revision(rows, "Maths", 1)
        self.assertEqual(freed, 2)
        self.assertEqual(len(out), 2)
        # The recap landed on the first teaching day, the chapter review on
        # the last, and each says so.
        self.assertEqual(out[0]["slo_codes"], ["M-01-PV-01", "M-01-PV-03"])
        self.assertEqual(out[1]["slo_codes"], ["M-01-PV-02", "M-01-PV-04"])
        self.assertTrue(out[0].get("fold_note"))
        self.assertTrue(out[1].get("fold_note"))
        # Rule 2 still holds: no printed page was reassigned.
        self.assertEqual(out[0]["pages_printed"], [32])
        self.assertEqual(out[1]["pages_printed"], [52])


class TheGateStaysShutEverywhereElse(unittest.TestCase):

    def test_grade_2_english_is_untouched(self):
        rows = english_chapter()
        out, freed = dayfold.fold_revision(rows, "English", 2)
        self.assertEqual((freed, out), (0, rows))

    def test_grade_5_maths_is_untouched(self):
        rows = [seg(1, "Day 1", "concrete"), seg(1, "Day 2", "revision")]
        out, freed = dayfold.fold_revision(rows, "Maths", 5)
        self.assertEqual((freed, out), (0, rows))

    def test_english_with_no_grade_given_is_untouched(self):
        rows = english_chapter()
        out, freed = dayfold.fold_revision(rows, "English")
        self.assertEqual((freed, out), (0, rows))

    def test_science_never_folds(self):
        rows = [seg(1, "Day 1", "investigate_handson"),
                seg(1, "Day 2", "revision")]
        out, freed = dayfold.fold_revision(rows, "Science", 1)
        self.assertEqual((freed, out), (0, rows))

    def test_urdu_folds_in_every_grade_with_or_without_a_grade(self):
        rows = [seg(1, "Day 1", "tafheem"), seg(1, "Day 2", "duhrai")]
        for grade in (None, 1, 3, 5):
            out, freed = dayfold.fold_revision(list(rows), "Urdu", grade)
            self.assertEqual((freed, len(out)), (1, 1), grade)


HAVE_CORPUS = os.path.isdir(SEG)


def book(stem):
    with open(os.path.join(SEG, stem + ".json")) as fh:
        return json.load(fh)["segments"]


@unittest.skipUnless(HAVE_CORPUS, "corpus/ is gitignored and not present")
class TheRealGradeOneBooksPayTheFoundationsBill(unittest.TestCase):

    def test_grade_1_english_frees_twelve_periods(self):
        before = book("grade_1_english")
        after, freed = dayfold.fold_revision(before, "English", 1)
        # 111/99 since 19 Sep 2026, not 110/98: bd-4lx8q split chapter 1's
        # day 5 in two. It carried a rhyme SLO and a days-of-the-week SLO
        # that have nothing to do with each other, so the book teaches one
        # more period than it did. The freed count is unchanged -- the split
        # added a teaching day, not a revision row.
        self.assertEqual((len(before), len(after), freed), (111, 99, 12))

    def test_grade_1_maths_frees_fifteen_periods(self):
        before = book("grade_1_maths")
        after, freed = dayfold.fold_revision(before, "Maths", 1)
        self.assertEqual((len(before), len(after), freed), (143, 128, 15))

    def test_no_slo_code_is_lost_on_the_way(self):
        for stem, subject in (("grade_1_english", "English"),
                              ("grade_1_maths", "Maths")):
            before = book(stem)
            after, _freed = dayfold.fold_revision(before, subject, 1)
            codes = lambda rows: {c for s in rows for c in s.get("slo_codes") or []}
            self.assertEqual(codes(before), codes(after), stem)

    def test_grade_2_english_keeps_all_its_periods(self):
        before = book("grade_2_english")
        after, freed = dayfold.fold_revision(before, "English", 2)
        self.assertEqual((len(after), freed), (len(before), 0))


if __name__ == "__main__":
    unittest.main()
