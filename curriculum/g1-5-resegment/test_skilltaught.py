"""skilltaught — the live count the Skills Map checks its snapshot against.

The value of this module is an identity, not an algorithm: a skill it reports
days for must be a skill the Coverage Map gives days to. So these tests assert
against `covdata` rather than against hand-written numbers, and against the
two ways a lookup can miss a bucket that is really there — the grade arriving
as an int on one side and a string on the other, and an aliased Urdu key.
"""
import unittest

import covdata
import skilltaught


def day(chapter, skill, kind="day"):
    return {"kind": kind, "skill_type": skill, "chapter": chapter,
            "chapter_title": f"Chapter {chapter}", "primary_slo": None,
            "supporting_slos": "", "slo_role": None}


def corpus():
    """Grade 4 Maths teaches concrete and abstract — the two skills the stale
    snapshot has none of — and Grade 4 Urdu writes its assessment as an
    ordinary day row under the English key the aliasing exists for."""
    maths = [day(1, "concrete"), day(1, "concrete"), day(1, "abstract"),
             day(1, "pictorial"), day(2, "revision"),
             day(None, "", kind="chapter_close")]
    urdu = [day(1, "buland_khwani"), day(1, "assessment")]
    return {"Maths": [(4, maths, {})], "Urdu": [(4, urdu, {})]}


class ASkillTheCoverageMapCountsIsCountedHere(unittest.TestCase):
    """One tally or two tabs that disagree — there is no third option."""

    def test_every_skill_covdata_counts_days_for_is_reported(self):
        live = skilltaught.counts(corpus())
        for subject, books in corpus().items():
            for grade, rows, _st in books:
                per, _by_ch, _admin = covdata.count(rows, subject)
                for key, n in per.items():
                    with self.subTest(subject=subject, key=key):
                        self.assertEqual(
                            skilltaught.days(live, subject, key, grade), n)

    def test_a_skill_with_no_day_row_counts_zero(self):
        live = skilltaught.counts(corpus())
        self.assertEqual(skilltaught.days(live, "Maths", "word_problem", 4), 0)
        self.assertEqual(skilltaught.days(live, "Maths", "word_problem"), 0)

    def test_a_grade_with_no_book_counts_zero_rather_than_raising(self):
        live = skilltaught.counts(corpus())
        self.assertEqual(skilltaught.days(live, "Science", "engage_hook", 1), 0)


class TheGradeIsTheSameGradeOnBothSides(unittest.TestCase):
    """The corpus numbers grades with ints; the snapshot's grades are JSON
    object keys, so they arrive as "1".."5". Compared unconverted, every
    lookup misses and every skill reads as never taught — the bug this module
    exists to stop, arriving through the back door."""

    def test_an_int_grade_and_a_string_grade_find_the_same_days(self):
        live = skilltaught.counts(corpus())
        self.assertEqual(skilltaught.days(live, "Maths", "concrete", 4), 2)
        self.assertEqual(skilltaught.days(live, "Maths", "concrete", "4"), 2)


class AnAliasedKeyFindsItsOwnDays(unittest.TestCase):
    """Grade 5 Urdu was tagged with the English keys for revision and
    assessment; `skills.ALIAS` is there because those are one skill. Counted
    under one name and looked up under the other, the real days sit in a
    bucket nothing reads."""

    def test_urdu_assessment_and_jaiza_are_one_skill(self):
        live = skilltaught.counts(corpus())
        self.assertEqual(skilltaught.days(live, "Urdu", "jaiza", 4), 1)
        self.assertEqual(skilltaught.days(live, "Urdu", "assessment", 4), 1)


if __name__ == "__main__":
    unittest.main()
