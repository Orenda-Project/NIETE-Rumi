"""FLN Coverage — the literacy and numeracy the year actually schedules.

The tab this replaces claimed to be "counted off the Teaching Calendar" and
was not. Grade 1, April 2026: it read 20 phonics periods against the
calendar's 11, one oral-language period against 16, three writing periods
against none at all, and it carried no Number fluency row while number
fluency was 12 of Grade 1's 23 Maths periods that month. No code in the build
wrote it, so no rebuild ever corrected it (bd-adqb0).

These tests hold the replacement to the claim. `periods` reads the printed
grid — the same cells a teacher reads — so the tab and the calendar cannot
drift apart, and the accounting test makes a newly added skill type fail
loudly here rather than vanish quietly from the totals.
"""
import datetime
import os
import unittest

import flntab
import skills

HERE = os.path.dirname(os.path.abspath(__file__))
SEG = os.path.join(HERE, "corpus", "seg")
HAVE_CORPUS = os.path.isdir(SEG)

LEAD = 5
DAYS = [datetime.date(2026, 4, 6), datetime.date(2026, 4, 7),
        datetime.date(2026, 4, 8), datetime.date(2026, 5, 4)]


def grid(*rows):
    """(cal_rows, plan), shaped the way caltab.build returns them."""
    head = [[""] * (LEAD + len(DAYS)) for _ in range(3)]
    body, stats = [], []
    for grade, subject, cells in rows:
        stats.append((grade, subject, {}))
        body.append([f"G{grade}", subject, 5, 0, 0] + list(cells))
    return head + body, {"lead": LEAD, "body_top": len(head), "stats": stats}


class TheGridIsTheOnlySource(unittest.TestCase):

    def test_a_code_in_a_cell_is_a_period_of_that_skill(self):
        rows, plan = grid((1, "English", ["PH", "PH", "CL", "PH"]))
        got = flntab.periods(rows, plan, DAYS)
        self.assertEqual(got[(1, "English", "phonics", "Apr 26")], 2)
        self.assertEqual(got[(1, "English", "phonics", "May 26")], 1)
        self.assertEqual(got[(1, "English", "communicative", "Apr 26")], 1)

    def test_a_double_cell_is_two_periods_not_one_day(self):
        rows, plan = grid((2, "Maths", ["C/P", "", "", ""]))
        got = flntab.periods(rows, plan, DAYS)
        self.assertEqual(got[(2, "Maths", "concrete", "Apr 26")], 1)
        self.assertEqual(got[(2, "Maths", "pictorial", "Apr 26")], 1)

    def test_an_empty_cell_counts_nothing(self):
        rows, plan = grid((1, "English", ["", "", "", ""]))
        self.assertEqual(sum(flntab.periods(rows, plan, DAYS).values()), 0)

    def test_urdu_reads_in_its_own_vocabulary(self):
        rows, plan = grid((3, "Urdu", ["AS", "BK", "TF", "AM"]))
        got = flntab.periods(rows, plan, DAYS)
        self.assertEqual(got[(3, "Urdu", "arkaan_saazi", "Apr 26")], 1)
        self.assertEqual(got[(3, "Urdu", "buland_khwani", "Apr 26")], 1)


class WhatIsNotFlnTeaching(unittest.TestCase):

    def total(self, *rows):
        cal, plan = grid(*rows)
        return sum(flntab.periods(cal, plan, DAYS).values())

    def test_revision_and_assessment_are_not_counted(self):
        self.assertEqual(self.total((1, "English", ["RV", "AX", "RV", "AX"])), 0)

    def test_urdu_revision_and_assessment_are_not_counted_either(self):
        self.assertEqual(self.total((3, "Urdu", ["DH", "JZ", "DH", "JZ"])), 0)

    def test_board_prep_is_not_counted(self):
        self.assertEqual(self.total((5, "English", ["BP", "BP", "BP", "BP"])), 0)

    def test_science_is_not_fln_and_its_row_is_skipped_whole(self):
        self.assertEqual(self.total((4, "Science", ["EN", "IN", "CB", "AP"])), 0)


class EverySkillIsAccountedFor(unittest.TestCase):
    """The guard. A new skill type must be placed or excluded on purpose."""

    def strand_keys(self):
        return {k for _g, _s, keys in flntab.STRANDS for k in keys}

    def test_every_literacy_and_numeracy_skill_has_a_home(self):
        placed = self.strand_keys() | set(flntab.EXCLUDED)
        for subject in ("English", "Urdu", "Maths"):
            for key in skills.ORDER[subject]:
                key = skills.canonical(key, subject)
                self.assertIn(key, placed,
                              f"{subject} skill {key} is in neither a strand "
                              "nor EXCLUDED — it would vanish from the totals")

    def test_no_skill_is_both_counted_and_excluded(self):
        self.assertEqual(self.strand_keys() & set(flntab.EXCLUDED), set())

    def test_no_skill_is_counted_under_two_strands(self):
        seen = [k for _g, _s, keys in flntab.STRANDS for k in keys]
        self.assertEqual(len(seen), len(set(seen)))

    def test_number_fluency_is_a_strand_of_its_own(self):
        named = [s for _g, s, keys in flntab.STRANDS
                 if "number_fluency" in keys]
        self.assertEqual(named, ["Number fluency"])


class TheMonthColumnsAreTheSessions(unittest.TestCase):
    """Which months get a column is a claim about the year, so it is tested.

    The grid jumps May to August. That is the summer break, not a dropped
    column, and the difference matters: a zero means "taught nothing that
    month", a missing column means "no school days to teach in".
    """

    def test_a_month_with_no_school_days_has_no_column(self):
        for gone in ("Jun 26", "Jul 26"):
            self.assertNotIn(gone, flntab.session_months())

    def test_every_column_is_a_month_that_has_school_days(self):
        import schoolyear as sy
        self.assertEqual(set(flntab.session_months()),
                         {flntab.month_of(d) for d in sy.school_days()})

    def test_the_columns_run_april_to_march_in_order(self):
        months = flntab.session_months()
        self.assertEqual((months[0], months[-1]), ("Apr 26", "Mar 27"))
        self.assertEqual(len(months), len(set(months)))


class TheTableAddsUp(unittest.TestCase):

    def setUp(self):
        cal, plan = grid((1, "English", ["PH", "CL", "WR", "PH"]),
                         (1, "Maths", ["NF", "C", "C", "P"]))
        self.rows, self.plan = flntab.build(cal, plan, DAYS)

    def row(self, strand):
        return next(r for r in self.rows if len(r) > 1 and r[1] == strand)

    def test_a_strand_row_totals_its_own_months(self):
        row = self.row("Phonics & decoding")
        months = self.plan["month_cols"]
        self.assertEqual(row[self.plan["total_col"]],
                         sum(row[c] for c in months))

    def test_the_grade_total_is_the_sum_of_its_strands(self):
        total = self.row("All FLN periods")[self.plan["total_col"]]
        self.assertEqual(total, 8)

    def test_the_shares_sum_to_one_hundred_percent(self):
        share = self.plan["share_col"]
        pct = [float(self.rows[r][share].rstrip("%"))
               for r in self.plan["strand_rows"]]
        self.assertAlmostEqual(sum(pct), 100.0, places=0)

    def test_january_to_march_carry_no_teaching(self):
        self.assertIn("Jan 27", self.plan["months"])
        for r in self.plan["strand_rows"]:
            for c, month in zip(self.plan["month_cols"], self.plan["months"]):
                if month.endswith("27"):
                    self.assertEqual(self.rows[r][c], 0)


@unittest.skipUnless(HAVE_CORPUS, "corpus/ is gitignored and not present")
class TheRealAprilOfGradeOne(unittest.TestCase):
    """The numbers the old tab got wrong, against the calendar that is built."""

    @classmethod
    def setUpClass(cls):
        import build
        import caltab
        _corpus, runs, _books, _breaks = build.load_corpus()
        cls.cal, cls.plan = caltab.build(runs)
        cls.days = caltab.day_columns()[0]
        cls.got = flntab.periods(cls.cal, cls.plan, cls.days)

    def strand(self, name, grade=1, month="Apr 26"):
        keys = next(k for _g, s, k in flntab.STRANDS if s == name)
        return sum(self.got[(grade, subj, key, month)]
                   for key in keys for subj in ("English", "Urdu", "Maths"))

    def test_phonics_and_decoding_is_eleven_not_twenty(self):
        self.assertEqual(self.strand("Phonics & decoding"), 11)

    def test_oral_language_is_sixteen_not_one(self):
        self.assertEqual(self.strand("Oral language"), 16)

    def test_number_fluency_is_twelve_and_has_a_row(self):
        self.assertEqual(self.strand("Number fluency"), 12)

    def test_concrete_is_six_not_fifteen(self):
        self.assertEqual(self.strand("Concrete"), 6)

    def test_comprehension_is_not_taught_in_grade_1_april(self):
        self.assertEqual(self.strand("Comprehension"), 0)

    def test_writing_does_not_start_until_may(self):
        """Grade 1 writes nothing in April; the Foundations rotation reaches
        its writing phase in week 4. May carries 12 periods — English 6 and
        Urdu 6 — and the Urdu six fall on five days, because 4 May is a
        doubled `TL/TL` cell. Counting days would report 11 and quietly lose
        a period, which is why the unit here is periods."""
        self.assertEqual(self.strand("Writing"), 0)
        self.assertEqual(self.strand("Writing", month="May 26"), 12)

    def test_april_holds_every_grade_1_period_of_the_three_subjects(self):
        apr = sum(n for (g, _s, _k, m), n in self.got.items()
                  if g == 1 and m == "Apr 26")
        self.assertEqual(apr, 19 + 23 + 23)


if __name__ == "__main__":
    unittest.main()
