"""dayfold Rule 3 — the Urdu revision stops consuming a period of its own.

Every chapter of every Urdu book carries a revision day AND an assessment day
regardless of how long the chapter is -- 176 of the 646 Urdu rows, 27.2% of the
year, spent the same way on an eight-day chapter and a three-day one. The
revision does not need a period: the chapter's last teaching day can carry it.
The assessment does need one -- a check that shares a day with the teaching it
checks is not a check. Folding must free the period WITHOUT losing the
revision: its SLO codes and its name stay on the day that absorbs it.

The trap this file exists to hold: the corpus does not agree with itself about
what a revision day is called. Grades 1-4 write the CANONICAL `duhrai`;
Grade 5 writes the RAW `revision`. Likewise `assessment` is raw in all five
books and canonicalises to `jaiza`. A plain `== "duhrai"` folds four books and
silently skips Grade 5 -- 16 periods short, with nothing to show it is wrong;
a plain `== "revision"` does the exact opposite. Every comparison goes through
skills.canonical(key, subject) or it is a defect.

Rule 4 and its Science corpus numbers live in test_dayfold_science.py.
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


def urdu_chapter(ch, revision_key, assessment_key="assessment"):
    """A chapter as the corpus writes it: teaching days, then revision, then
    assessment. `revision_key` is the whole point -- G1-4 say duhrai, G5 says
    revision, and both mean the same day."""
    return [
        seg(ch, "Day 1", "buland_khwani", slo_codes=["U-01-RD-01"],
            pages_printed=[1, 2]),
        seg(ch, "Day 2", "tafheem", slo_codes=["U-01-CO-01"],
            pages_printed=[3]),
        seg(ch, "Day 3", "takhleeqi_likhai", slo_codes=["U-01-WR-01"],
            pages_printed=[4], notes="copy work"),
        seg(ch, "Day 4", revision_key, topic="دُہرائی — پورے سبق کا اعادہ",
            slo_codes=["U-01-RD-01", "U-01-CO-01", "U-01-WR-01"],
            pages_printed=[1, 2, 3, 4]),
        seg(ch, "Day 5", assessment_key, topic="سبق کا جائزہ ورک شیٹ",
            slo_codes=["U-01-RD-01", "U-01-WR-01"], pages_printed=[1, 4]),
    ]


def skills_of(segments, ch=None):
    return [s["skill_type"] for s in segments
            if ch is None or s["chapter_number"] == ch]


class TheRevisionDayGivesUpItsPeriodAndTheAssessmentKeepsOne(unittest.TestCase):

    def test_the_canonical_duhrai_revision_row_is_gone_from_the_chapter(self):
        out, _freed = dayfold.fold_revision(urdu_chapter(1, "duhrai"), "Urdu")
        self.assertEqual(skills_of(out),
                         ["buland_khwani", "tafheem", "takhleeqi_likhai",
                          "assessment"])

    def test_the_grade_5_raw_revision_key_folds_exactly_like_duhrai(self):
        # The seam. Grade 5 Urdu writes "revision", not "duhrai". A plain
        # string comparison against "duhrai" leaves all 16 Grade 5 chapters
        # unfolded and the freed-period count silently 16 short.
        out, freed = dayfold.fold_revision(urdu_chapter(1, "revision"), "Urdu")
        self.assertEqual(freed, 1)
        self.assertEqual(skills_of(out),
                         ["buland_khwani", "tafheem", "takhleeqi_likhai",
                          "assessment"])

    def test_the_assessment_day_is_never_folded(self):
        out, _freed = dayfold.fold_revision(urdu_chapter(1, "duhrai"), "Urdu")
        self.assertEqual(out[-1]["skill_type"], "assessment")

    def test_folding_frees_one_period_per_chapter_not_per_book(self):
        book_rows = urdu_chapter(1, "duhrai") + urdu_chapter(2, "revision")
        out, freed = dayfold.fold_revision(book_rows, "Urdu")
        self.assertEqual(freed, 2)
        self.assertEqual(len(out), len(book_rows) - 2)


class TheRevisionContentSurvivesOnTheLastTeachingDay(unittest.TestCase):

    def setUp(self):
        self.before = urdu_chapter(1, "duhrai")
        self.out, _freed = dayfold.fold_revision(self.before, "Urdu")
        self.host = self.out[2]          # Day 3, the last teaching day

    def test_no_slo_code_is_deleted_by_the_fold(self):
        kept = {c for s in self.out for c in s["slo_codes"]}
        lost = {c for s in self.before for c in s["slo_codes"]} - kept
        self.assertEqual(lost, set())

    def test_the_revisions_codes_land_on_the_last_teaching_day(self):
        self.assertEqual(sorted(self.host["slo_codes"]),
                         ["U-01-CO-01", "U-01-RD-01", "U-01-WR-01"])

    def test_the_host_days_own_code_stays_first_so_it_still_owns_it(self):
        # assign_slo_roles takes the first NEW code as primary; reordering
        # here would quietly hand the day's primary SLO to a revised code.
        self.assertEqual(self.host["slo_codes"][0], "U-01-WR-01")

    def test_the_revision_is_named_in_the_host_days_notes(self):
        self.assertIn("دُہرائی — پورے سبق کا اعادہ", self.host["notes"])

    def test_the_host_days_existing_notes_are_not_overwritten(self):
        self.assertIn("copy work", self.host["notes"])

    def test_the_host_day_is_marked_as_carrying_a_folded_revision(self):
        self.assertTrue(self.host["revision_folded"])

    def test_the_host_day_keeps_its_own_skill_type(self):
        self.assertEqual(self.host["skill_type"], "takhleeqi_likhai")

    def test_printed_pages_are_not_reassigned_to_the_host_day(self):
        # dayrules Rule 2: pages never move. The revision row's span is the
        # WHOLE chapter, so unioning it would make the last day claim every
        # page of the chapter and invent an overlap with every other day.
        self.assertEqual(self.host["pages_printed"], [4])


class TheFoldRefusesTheCasesWhereItWouldLoseSomething(unittest.TestCase):

    def test_a_chapter_whose_only_rows_are_tails_keeps_its_revision(self):
        rows = [seg(1, "Day 1", "duhrai", slo_codes=["U-01-RD-01"]),
                seg(1, "Day 2", "assessment")]
        out, freed = dayfold.fold_revision(rows, "Urdu")
        self.assertEqual(freed, 0)
        self.assertEqual(len(out), 2)

    def test_english_and_maths_revision_rows_are_out_of_scope(self):
        rows = [seg(1, "Day 1", "reading_comprehension"),
                seg(1, "Day 2", "revision"), seg(1, "Day 3", "assessment")]
        out, freed = dayfold.fold_revision(rows, "English")
        self.assertEqual(freed, 0)
        self.assertEqual(out, rows)

    def test_a_chapter_with_no_revision_row_is_left_exactly_as_it_was(self):
        rows = [seg(1, "Day 1", "tafheem"), seg(1, "Day 2", "assessment")]
        out, freed = dayfold.fold_revision(rows, "Urdu")
        self.assertEqual(freed, 0)
        self.assertEqual(out, rows)

    def test_the_input_list_is_not_mutated_in_place(self):
        rows = urdu_chapter(1, "duhrai")
        dayfold.fold_revision(rows, "Urdu")
        self.assertEqual(len(rows), 5)
        self.assertEqual(rows[2]["notes"], "copy work")


# --------------------------------------------------------------------------
# Against the real corpus, when this machine has it. It is gitignored, so a
# fresh clone skips these rather than failing on a file it cannot have.
# --------------------------------------------------------------------------

def book(stem):
    with open(os.path.join(SEG, f"{stem}.json")) as fh:
        return json.load(fh)["segments"]


HAVE_CORPUS = os.path.isdir(SEG)


@unittest.skipUnless(HAVE_CORPUS, "corpus/ is gitignored and not present")
class TheRealCorpusUrduNumbers(unittest.TestCase):

    def test_the_urdu_fold_frees_eighty_eight_periods_across_the_five_books(self):
        freed = sum(dayfold.fold_revision(book(f"grade_{g}_urdu"), "Urdu")[1]
                    for g in range(1, 6))
        self.assertEqual(freed, 88)

    def test_grade_1_urdu_alone_frees_eighteen_periods(self):
        _out, freed = dayfold.fold_revision(book("grade_1_urdu"), "Urdu")
        self.assertEqual(freed, 18)

    def test_grade_5_urdu_frees_sixteen_and_is_not_skipped_by_the_alias(self):
        _out, freed = dayfold.fold_revision(book("grade_5_urdu"), "Urdu")
        self.assertEqual(freed, 16)

    def test_no_urdu_slo_code_is_lost_anywhere_in_the_five_books(self):
        for g in range(1, 6):
            before = book(f"grade_{g}_urdu")
            after, _freed = dayfold.fold_revision(before, "Urdu")
            self.assertEqual(
                {c for s in before for c in s.get("slo_codes") or []}
                - {c for s in after for c in s.get("slo_codes") or []},
                set(), f"grade {g} Urdu lost an SLO code")


if __name__ == "__main__":
    unittest.main()
