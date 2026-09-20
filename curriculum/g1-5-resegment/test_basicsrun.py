"""basicsrun — turning a book's basics periods into briefs an author can work from.

Eight lessons have been authored so far and every one of them was briefed by
hand, in a throwaway script. That was fine for eight. The pilot is 36, the
build is 366, and a hand-written brief has two failure modes that only show up
at that size: a period quietly skipped, and a brief built for the wrong
artefact name. Both look like a smaller build rather than a broken one.

So the naming is the first thing under test. `judgerun` looks for
`corpus-local/authored/<stem>_ch<N>_seg<I>.json` and nothing else. The record's
own id — `grade_3_math_ch14_nf3` — is the readable name and is NOT that path;
an artefact written under it is invisible to the judge, and the judge's answer
to a missing file is "no authored artefact", which reads as work not started.

The second is what a period that cannot be grounded does. One of the pilot's
36 is expected to fail — `grade_3_math_ch14_nf3` resolves to no page, the
pdf-257 mislabel on bd-pglby. A run that stops there delivers nothing; a run
that drops it silently delivers 35 and calls it 36. It carries its reason.

The third is quieter than either. `cbrief` reads the book it is handed under
the keys `stem` and `chapter_title`; hand it `book_stem` instead and it does
not complain, it emits `null`. The brief still looks complete -- every other
field is there -- and the author is told the grade and the subject but not
which of the five Maths books this is, or what the chapter is called. The
first pilot brief shipped exactly that, so the envelope's own naming is under
test beside the artefact's.
"""
import unittest

import basicsrun
import pageres


def p(chapter, skill, kind="fill"):
    return {"chapter": chapter, "skill": skill, "kind": kind, "anchored": True}


def rec(skill="number_fluency", ordinal=1, chapter=4):
    return {"id": "grade_2_math_ch%d_nf%d" % (chapter, ordinal),
            "stem": "grade_2_math", "grade": 2, "subject": "Maths",
            "chapter": chapter, "skill": skill, "kind": "fill",
            "ordinal": ordinal, "position": 30, "of": 150}


def chapter_rows(printed=7, pdf=10):
    return [{"chapter_number": 4, "chapter_title": "Numberland",
             "pages_printed": [printed], "pages_pdf": [pdf],
             "slo_codes": ["M-02-NS-03"],
             "slo_descriptions": ["Order numbers up to 99"],
             "segment_index": 1}]


def index(printed=7, pdf=10):
    return pageres.index([{"pdf_page_index": pdf, "printed_page_number": printed,
                           "chapter": {"number": 4, "title": "Numberland"},
                           "text": "Count on in tens: 10, 20, 30."}])


META = {"grade": 2, "subject": "Maths", "stem": "grade_2_math"}


class TheArtefactNameIsWhatTheJudgeLooksFor(unittest.TestCase):

    def test_it_is_the_stem_chapter_and_minted_index(self):
        # judgerun globs corpus-local/authored/<stem>_ch<N>_seg<I>.json. An
        # artefact written under any other name is invisible to it.
        seg = {"chapter_number": 4, "segment_index": 803}
        self.assertEqual(basicsrun.artefact("grade_2_math", seg),
                         "grade_2_math_ch4_seg803")

    def test_the_readable_id_is_kept_beside_it_not_instead_of_it(self):
        got = basicsrun.one(rec(), chapter_rows(), index(), META)
        self.assertEqual(got.id, "grade_2_math_ch4_nf1")
        self.assertTrue(got.name.startswith("grade_2_math_ch4_seg8"))


class ChoosingWhichPeriodsToBuild(unittest.TestCase):

    def test_every_basics_period_of_the_book_is_wanted(self):
        recs = [rec(ordinal=1), rec(skill="concrete", ordinal=1)]
        self.assertEqual(len(basicsrun.wanted(recs)), 2)

    def test_a_named_skill_narrows_it(self):
        recs = [rec(ordinal=1), rec(skill="concrete", ordinal=1)]
        got = basicsrun.wanted(recs, "number_fluency")
        self.assertEqual([r["skill"] for r in got], ["number_fluency"])

    def test_a_skill_this_book_does_not_have_is_an_empty_run_not_an_error(self):
        # Grade 4 Science allocates no basics at all. That is a fact about the
        # book, not a typo.
        self.assertEqual(basicsrun.wanted([rec()], "word_problem"), [])

    def test_a_skill_that_is_not_a_basics_skill_at_all_is_an_error(self):
        # "numberfluency" returning [] would read as "this book has none".
        with self.assertRaises(KeyError):
            basicsrun.wanted([rec()], "numberfluency")


class APeriodThatCannotBeGrounded(unittest.TestCase):
    """One bad period must not cost the other thirty-five."""

    def test_it_carries_its_reason_instead_of_a_brief(self):
        got = basicsrun.one(rec(), chapter_rows(), pageres.index([]), META)
        self.assertIsNone(got.brief)
        self.assertIn("page", got.error.lower())

    def test_it_is_not_counted_as_briefed(self):
        got = basicsrun.one(rec(), chapter_rows(), pageres.index([]), META)
        self.assertFalse(got.ok)

    def test_a_chapter_with_no_segments_at_all_is_a_reason_too(self):
        # basicseg raises ValueError here, not cbrief.Ungrounded. Both are
        # "this period has nothing behind it" and both have to be survivable.
        got = basicsrun.one(rec(), [], index(), META)
        self.assertFalse(got.ok)
        self.assertTrue(got.error)

    def test_a_period_that_grounds_is_briefed(self):
        got = basicsrun.one(rec(), chapter_rows(), index(), META)
        self.assertTrue(got.ok)
        self.assertIsNone(got.error)
        self.assertIn("envelope", got.brief)

    def test_the_brief_carries_the_basics_section(self):
        # Without it the author has the fields but not the three rules that
        # cannot be read off them. See cbriefbasics.
        got = basicsrun.one(rec(), chapter_rows(), index(), META)
        self.assertIn("basics", got.brief)
        self.assertEqual(got.brief["basics"]["content_min"], 30)


class ReportingARun(unittest.TestCase):

    def test_a_line_names_the_period_and_whether_it_briefed(self):
        got = basicsrun.one(rec(), chapter_rows(), index(), META)
        self.assertIn("grade_2_math_ch4_nf1", got.line())
        self.assertIn("OK", got.line())

    def test_a_failed_line_says_why(self):
        got = basicsrun.one(rec(), chapter_rows(), pageres.index([]), META)
        self.assertNotIn("OK", got.line())
        self.assertIn("page", got.line().lower())


if __name__ == "__main__":
    unittest.main()


class TheBriefNamesTheBookItComesFrom(unittest.TestCase):
    """An author briefed on "Grade 2, Maths" cannot tell which book it is."""

    def brief(self):
        return basicsrun.one(rec(), chapter_rows(), index(), META).brief

    def test_the_envelope_carries_the_book_stem(self):
        self.assertEqual(self.brief()["envelope"]["book_stem"], "grade_2_math")

    def test_the_envelope_carries_the_chapter_title(self):
        # It lives on the chapter's own rows, not on the book-level meta --
        # one brief is one chapter, so the title is read from the rows.
        self.assertEqual(self.brief()["envelope"]["chapter_title"], "Numberland")


if __name__ == "__main__":
    unittest.main()
