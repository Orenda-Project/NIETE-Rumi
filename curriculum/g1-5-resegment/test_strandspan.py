"""A segment that teaches two things at once is not automatically broken.

Grade 1 English segment 5 genuinely is: it carries onset-rime rhyming
(E-01-PA-01) and days of the week (E-01-VG-01) in one 30-minute period, the
judge caps three checks at 2 because of it, and no amount of authoring gets it
past the gate. Before splitting that row by hand it is worth knowing how many
others are like it -- which is what bd-4lx8q asks for.

The trap this module exists to avoid is answering that question with the easy
number. 565 of 2,038 segments carry SLO codes from more than one strand, and
reporting 565 would be wrong twice over:

  A revision or assessment row SHOULD sweep a chapter's strands. Only the
  1,569 rows the router sends to `d0_primary` become a single taught period,
  so only those can carry a segmentation fault at all.

  Two strands are not two unrelated strands. Phonics beside reading, grammar
  beside writing, reading beside vocabulary -- those are one teaching sequence
  written as two codes, and they are the COMMON case in this corpus.

So the signal is rarity, not multiplicity: a pairing the corpus makes over and
over is a pedagogical convention, and a pairing it makes once is more likely an
accident of how the chapter was divided. `PA+VG` -- segment 5's own pair --
occurs exactly once in 1,569 content rows, which is the evidence that the
measure finds the thing it was built to find.

A flagged row is a CANDIDATE FOR REVIEW and this module never calls it a fault.
Which of the 29 are real is a pedagogical judgement a person makes by reading
them, not something a strand token can settle.
"""
import unittest

import strandspan


def seg(codes, index=1, **kw):
    d = {"segment_index": index, "slo_codes": list(codes)}
    d.update(kw)
    return d


class ReadingTheStrandOffACode(unittest.TestCase):

    def test_the_strand_is_the_third_token(self):
        self.assertEqual(strandspan.strands(seg(["E-01-PA-01"])), ("PA",))

    def test_two_codes_in_one_strand_are_one_strand(self):
        self.assertEqual(strandspan.strands(seg(["E-01-RD-01", "E-01-RD-04"])),
                         ("RD",))

    def test_strands_come_back_sorted_so_a_pair_has_one_spelling(self):
        self.assertEqual(strandspan.strands(seg(["E-01-VG-01", "E-01-PA-01"])),
                         ("PA", "VG"))

    def test_a_code_too_short_to_carry_a_strand_is_skipped_not_guessed(self):
        self.assertEqual(strandspan.strands(seg(["E-01", "E-01-RD-01"])), ("RD",))

    def test_a_segment_with_no_codes_has_no_strands(self):
        self.assertEqual(strandspan.strands(seg([])), ())
        self.assertEqual(strandspan.strands({}), ())


class CountingWhatIsActuallyComparable(unittest.TestCase):
    """Only a row that becomes one taught period can hold a segmentation fault."""

    def test_a_revision_row_sweeping_four_strands_is_not_a_candidate(self):
        rows = [("g1_english", seg(["E-01-RD-01", "E-01-PA-01"]), "revision")]
        self.assertEqual(strandspan.candidates(rows), [])

    def test_an_assessment_row_sweeping_four_strands_is_not_a_candidate(self):
        rows = [("g1_english", seg(["E-01-RD-01", "E-01-PA-01"]), "assessment")]
        self.assertEqual(strandspan.candidates(rows), [])

    def test_a_single_strand_content_row_is_not_a_candidate(self):
        rows = [("g1_english", seg(["E-01-RD-01", "E-01-RD-02"]), "content")]
        self.assertEqual(strandspan.candidates(rows), [])


class RarityIsTheSignalNotMultiplicity(unittest.TestCase):

    def common(self, n):
        return [("b", seg(["E-01-PH-01", "E-01-RD-01"], i), "content")
                for i in range(n)]

    def test_a_pairing_the_corpus_makes_often_is_a_convention_not_a_fault(self):
        self.assertEqual(strandspan.candidates(self.common(20)), [])

    def test_a_pairing_made_once_among_many_is_flagged(self):
        rows = self.common(20) + [("b", seg(["E-01-PA-01", "E-01-VG-01"], 99),
                                   "content")]
        got = strandspan.candidates(rows)
        self.assertEqual([c.segment_index for c in got], [99])
        self.assertEqual(got[0].reason, "rare-pair")

    def test_the_flag_carries_the_pair_so_a_reader_can_judge_it(self):
        rows = self.common(20) + [("b", seg(["E-01-PA-01", "E-01-VG-01"], 99),
                                   "content")]
        self.assertEqual(strandspan.candidates(rows)[0].strands, ("PA", "VG"))

    def test_rarity_is_counted_over_content_rows_only(self):
        # A pair made common by revision rows is still rare as a taught period.
        rows = [("b", seg(["E-01-PA-01", "E-01-VG-01"], i), "revision")
                for i in range(20)]
        rows += self.common(20)
        rows.append(("b", seg(["E-01-PA-01", "E-01-VG-01"], 99), "content"))
        self.assertEqual([c.segment_index for c in strandspan.candidates(rows)],
                         [99])


class ThreeStrandsInOnePeriodIsFlaggedHowverCommon(unittest.TestCase):
    """Two strands can be one sequence. Three inside thirty minutes is a load
    question regardless of how often the corpus does it."""

    def test_three_strands_is_flagged_even_when_the_triple_repeats(self):
        rows = [("b", seg(["E-01-RD-01", "E-01-WR-01", "E-01-GR-01"], i),
                 "content") for i in range(20)]
        got = strandspan.candidates(rows)
        self.assertEqual(len(got), 20)
        self.assertEqual(got[0].reason, "three-or-more-strands")

    def test_the_louder_reason_wins_when_a_row_is_both(self):
        rows = [("b", seg(["E-01-PH-01", "E-01-RD-01"], i), "content")
                for i in range(20)]
        rows.append(("b", seg(["E-01-PA-01", "E-01-VG-01", "E-01-WR-01"], 99),
                     "content"))
        self.assertEqual(strandspan.candidates(rows)[0].reason,
                         "three-or-more-strands")


class ACandidateHasToBeFindable(unittest.TestCase):
    """`segment_index` alone does not name a row.

    It is the day WITHIN a chapter and it restarts: grade_1_urdu holds 142
    segments across only 10 distinct indices, so "seg 5" names fourteen
    different days in that one book. A report somebody cannot act on is not a
    report, so the chapter travels with the index.
    """

    def test_the_chapter_travels_with_the_segment_index(self):
        rows = [("b", seg(["E-01-PA-01", "E-01-VG-01"], 5, chapter_number=1),
                 "content")]
        self.assertEqual(strandspan.candidates(rows)[0].chapter, 1)

    def test_two_chapters_sharing_a_day_number_are_two_rows(self):
        rows = [("b", seg(["E-01-PA-01", "E-01-VG-01"], 5, chapter_number=c),
                 "content") for c in (1, 7)]
        self.assertEqual([c.chapter for c in strandspan.candidates(rows)],
                         [1, 7])

    def test_the_printed_line_names_book_chapter_and_day(self):
        rows = [("grade_1_urdu",
                 seg(["U-01-PA-01", "U-01-VG-01"], 5, chapter_number=7),
                 "content")]
        line = strandspan.candidates(rows)[0].line()
        self.assertIn("grade_1_urdu", line)
        self.assertIn("ch 7", line)
        self.assertIn("day 5", line)


class TheSurveyReportsItsOwnDenominators(unittest.TestCase):
    """A count with no denominator beside it is the number that gets misquoted."""

    def test_it_says_how_many_rows_it_could_have_flagged(self):
        rows = [("b", seg(["E-01-RD-01"], 1), "content"),
                ("b", seg(["E-01-PA-01", "E-01-VG-01"], 2), "content"),
                ("b", seg(["E-01-RD-01", "E-01-WR-01"], 3), "revision")]
        s = strandspan.survey(rows)
        self.assertEqual(s["segments"], 3)
        self.assertEqual(s["content"], 2)
        self.assertEqual(s["content_multi_strand"], 1)
        self.assertEqual(s["candidates"], 1)

    def test_it_never_calls_a_candidate_a_fault(self):
        self.assertNotIn("fault", " ".join(strandspan.survey([]).keys()))


if __name__ == "__main__":
    unittest.main()
