"""Rule 3 across English and Maths, and the Grade 1 bill it was bought for.

Six weeks of Foundations cost Grade 1 99 periods and the year's whole spare
is 66. The bill is paid by folding each Grade 1 chapter's revision into its
last teaching day, exactly as every Urdu chapter already is. It has to happen
at the load door, not in the allocator: a fold that only the calendar sees
leaves the subject tab, Coverage and the FDE tab counting periods that the
year does not have, and a fold that DROPS the row loses the SLO codes it
carries.

Grades 2-5 English and Maths were held back from the fold as a pedagogy
question rather than a gate setting. Amena decided it on 2026-09-21: fold
them (bd-2ctk6). That is 103 further periods -- NOT the 130 the old comment
claimed, which double-counted Grade 1's own 27. Grade 1 keeps its own tests
here because its counts are the ones the Foundations block is sized against.

Science is the only subject the gate still shuts on, and Rule 4 is why: its
chapters are already at the period ceiling and a 5E cycle is completed by
swapping a period, never by freeing one.
"""
import json
import os
import unittest

import dayfold
import skills
import stageb

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


class TheGateIsOpenForEveryEnglishAndMathsGrade(unittest.TestCase):
    """Since bd-2ctk6 the gate turns on subject alone for these two.

    It used to name grade 1 explicitly, so every assertion here was the
    mirror image of what it is now. Keeping them as live tests rather than
    deleting them is deliberate: the fold changes how many periods eight
    books cost, and a silent revert to the grade-1-only gate would otherwise
    show up as nothing worse than a calendar that quietly gained 103 days.
    """

    def test_grade_2_english_folds(self):
        rows = english_chapter()
        out, freed = dayfold.fold_revision(rows, "English", 2)
        self.assertEqual(freed, 1)
        self.assertEqual(len(out), len(rows) - 1)

    def test_grade_5_maths_folds(self):
        rows = [seg(1, "Day 1", "concrete", slo_codes=["M-05-NU-01"]),
                seg(1, "Day 2", "revision", slo_codes=["M-05-NU-02"])]
        out, freed = dayfold.fold_revision(rows, "Maths", 5)
        self.assertEqual(freed, 1)
        self.assertEqual(out[0]["slo_codes"], ["M-05-NU-01", "M-05-NU-02"])

    def test_english_with_no_grade_given_folds(self):
        # `None` means "no grade was supplied", and with the gate open for
        # the whole subject there is no longer a grade it could fail.
        rows = english_chapter()
        out, freed = dayfold.fold_revision(rows, "English")
        self.assertEqual(freed, 1)
        self.assertEqual(len(out), len(rows) - 1)

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

    def test_the_rest_of_english_and_maths_frees_one_hundred_and_three(self):
        """bd-2ctk6. Pinned per book, because the total is the only number
        anyone quotes and a total can be right while two books are wrong.

        103, not the 130 the module used to claim: that figure was every
        English and Maths revision row in Grades 1-5, and Grade 1's 27 were
        folded long before this.
        """
        want = {("grade_2_english", "English"): 12,
                ("grade_2_math", "Maths"): 15,
                ("grade_3_english", "English"): 12,
                ("grade_3_math", "Maths"): 15,
                ("grade_4_english", "English"): 12,
                ("grade_4_math", "Maths"): 11,
                ("grade_5_english", "English"): 14,
                ("grade_5_math", "Maths"): 12}
        got = {}
        for (stem, subject), _n in want.items():
            before = book(stem)
            after, freed = dayfold.fold_revision(before, subject,
                                                 int(stem.split("_")[1]))
            got[(stem, subject)] = freed
            self.assertEqual(len(after), len(before) - freed, stem)
        self.assertEqual(got, want)
        self.assertEqual(sum(got.values()), 103)

    def test_none_of_the_hundred_and_three_is_a_chapter_opening_recap(self):
        """The Grade 1 Maths case that made the host positional does not
        recur here, and this is what says so if a future book adds one.

        A revision row with no teaching day before it is prerequisite
        activation, not a chapter close: it carries the COMING chapter's
        SLOs and its opening page. Folding it forward would run the warm-up
        after the learning it prepares. Every one of the 103 has teaching
        before it, so each folds into the day it sits beside, which is also
        its chapter's last.
        """
        for stem, subject in (("grade_2_english", "English"),
                              ("grade_2_math", "Maths"),
                              ("grade_3_english", "English"),
                              ("grade_3_math", "Maths"),
                              ("grade_4_english", "English"),
                              ("grade_4_math", "Maths"),
                              ("grade_5_english", "English"),
                              ("grade_5_math", "Maths")):
            rows = stageb.order_segments(book(stem))
            seen = set()
            for i, s in enumerate(rows):
                ch = s.get("chapter_number")
                key = skills.canonical(s.get("skill_type"), subject)
                if key == skills.canonical("revision", subject):
                    self.assertIn(ch, seen,
                                  "%s ch%s opens on a revision row" % (stem, ch))
                elif key not in dayfold.BOOKKEEPING:
                    seen.add(ch)

    def test_no_slo_code_is_lost_in_the_rest_of_the_books_either(self):
        for stem, subject in (("grade_2_english", "English"),
                              ("grade_3_math", "Maths"),
                              ("grade_5_english", "English"),
                              ("grade_5_math", "Maths")):
            before = book(stem)
            after, _freed = dayfold.fold_revision(before, subject,
                                                  int(stem.split("_")[1]))
            codes = lambda rows: {c for s in rows for c in s.get("slo_codes") or []}
            self.assertEqual(codes(before), codes(after), stem)


if __name__ == "__main__":
    unittest.main()
