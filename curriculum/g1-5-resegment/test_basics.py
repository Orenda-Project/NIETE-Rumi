"""basics — naming the 366 periods that have no segment row.

A basics period is not a row in `corpus/seg`. It is a slot `ramp.allocate`
produces where the book does not claim the week: `{chapter, skill, kind}`,
with the chapter stamped on afterwards by `ramp._anchor`. Nothing downstream
can reach it — Stage C is driven entirely off `corpus/seg/<book>.json`, so a
period with no row there has no brief, no render and no lesson plan. That is
the whole of bd-0gzqf: 366 taught periods with nothing behind them.

Before any of them can be authored they have to be NAMEABLE, and the name is
the part that is easy to get wrong. The obvious key is where the period falls
in the year, and it is the one key that cannot be used: the year is rebalanced
every time a chapter is folded, split or re-paced, and a key built on position
silently renames every basics period downstream of the edit. Authored work
would re-attach to the wrong day, and nothing would fail while it happened.

So the identity here is (chapter, skill, ordinal-within-that-pair). It moves
only when the chapter's own basics allocation changes, which is the one case
where a rename is the correct answer.
"""
import unittest

import basics


def p(chapter, skill, kind="fill", anchored=True):
    d = {"chapter": chapter, "skill": skill, "kind": kind}
    if anchored:
        d["anchored"] = True
    return d


def book(chapter, n=1):
    return [{"chapter": chapter, "skill": "reading", "kind": "book"}] * n


class WhichPeriodsAreBasics(unittest.TestCase):

    def test_a_book_period_is_not_a_basics_period(self):
        # It already has a segment row; it is not what this bead is about.
        self.assertEqual(basics.records("g2_eng", 2, "English", book(1, 3)), [])

    def test_an_omitted_period_is_not_a_basics_period(self):
        rows = basics.records("g2_eng", 2, "English",
                              [p(1, "reading", kind="omitted")])
        self.assertEqual(rows, [])

    def test_a_foundations_period_is_not_a_basics_period(self):
        # The six-week Grade 1 Foundations block is bd-rpe8r and has its own
        # shape. Pulling it in here would double-build it.
        rows = basics.records("g1_eng", 1, "English",
                              [p(None, "phonics", kind="foundations",
                                 anchored=False)])
        self.assertEqual(rows, [])

    def test_onramp_and_fill_are_both_basics_periods(self):
        rows = basics.records("g2_eng", 2, "English",
                              [p(1, "phonics", kind="onramp"),
                               p(1, "communicative", kind="fill")])
        self.assertEqual([r["kind"] for r in rows], ["onramp", "fill"])


class TheOrdinal(unittest.TestCase):

    def test_it_counts_within_one_chapter_and_skill(self):
        rows = basics.records("g2_mth", 2, "Maths",
                              [p(1, "number_fluency")] * 3)
        self.assertEqual([r["ordinal"] for r in rows], [1, 2, 3])

    def test_a_second_skill_in_the_same_chapter_counts_separately(self):
        rows = basics.records("g2_mth", 2, "Maths",
                              [p(1, "number_fluency"), p(1, "concrete"),
                               p(1, "number_fluency")])
        self.assertEqual([(r["skill"], r["ordinal"]) for r in rows],
                         [("number_fluency", 1), ("concrete", 1),
                          ("number_fluency", 2)])

    def test_it_restarts_in_the_next_chapter(self):
        rows = basics.records("g2_mth", 2, "Maths",
                              [p(1, "concrete"), p(2, "concrete")])
        self.assertEqual([r["ordinal"] for r in rows], [1, 1])

    def test_a_chapter_returned_to_later_keeps_counting(self):
        # The allocator interleaves, so a chapter's periods are not always
        # contiguous. Restarting at 1 here would mint a duplicate id.
        rows = basics.records("g2_mth", 2, "Maths",
                              [p(1, "concrete"), p(2, "concrete"),
                               p(1, "concrete")])
        self.assertEqual([(r["chapter"], r["ordinal"]) for r in rows],
                         [(1, 1), (2, 1), (1, 2)])


class TheIdSurvivesARebalance(unittest.TestCase):
    """The property the whole key exists for."""

    def test_inserting_a_book_period_before_it_does_not_rename_it(self):
        one = basics.records("g2_mth", 2, "Maths",
                             book(1, 2) + [p(1, "concrete")])
        two = basics.records("g2_mth", 2, "Maths",
                             book(1, 9) + [p(1, "concrete")])
        self.assertEqual(one[0]["id"], two[0]["id"])

    def test_its_position_in_the_year_does_move(self):
        # Position is reported, because a teacher needs to know when the day
        # falls. It is simply not the identity.
        one = basics.records("g2_mth", 2, "Maths",
                             book(1, 2) + [p(1, "concrete")])
        two = basics.records("g2_mth", 2, "Maths",
                             book(1, 9) + [p(1, "concrete")])
        self.assertEqual((one[0]["position"], two[0]["position"]), (3, 10))

    def test_the_id_names_the_book_the_chapter_and_the_skill(self):
        rows = basics.records("grade_2_math", 2, "Maths",
                              [p(4, "number_fluency")] * 2)
        self.assertEqual([r["id"] for r in rows],
                         ["grade_2_math_ch4_nf1", "grade_2_math_ch4_nf2"])

    def test_every_id_in_a_book_is_unique(self):
        rows = basics.records("g2_mth", 2, "Maths",
                              [p(1, "concrete"), p(1, "number_fluency"),
                               p(2, "concrete"), p(1, "concrete")])
        self.assertEqual(len({r["id"] for r in rows}), len(rows))


class ASkillWithNoShortCode(unittest.TestCase):

    def test_it_is_refused_rather_than_silently_abbreviated(self):
        # An abbreviation invented on the fly would collide the first time two
        # skills shared an opening letter, and the collision would look like a
        # duplicate lesson rather than a bug.
        with self.assertRaises(KeyError):
            basics.records("g2_mth", 2, "Maths", [p(1, "telepathy")])

    def test_the_eight_live_basics_skills_all_have_one(self):
        # Measured 20 Sep 2026 off ramp.allocate across all 17 books.
        for skill in ("number_fluency", "concrete", "word_problem",
                      "communicative", "phonics", "arkaan_saazi",
                      "investigate_handson", "engage_hook"):
            self.assertIn(skill, basics.SHORT)

    def test_no_two_skills_share_a_short_code(self):
        self.assertEqual(len(set(basics.SHORT.values())), len(basics.SHORT))


class AnUnanchoredBasicsPeriod(unittest.TestCase):

    def test_it_is_refused_because_anchor_promises_it_cannot_happen(self):
        # `ramp._anchor` stamps every non-foundations period, and all 366 came
        # back anchored when measured. A None here is a bug upstream, and a
        # chapterless id would hide it.
        with self.assertRaises(ValueError):
            basics.records("g2_mth", 2, "Maths",
                           [p(None, "concrete", anchored=False)])


class TheRecordCarriesWhatAuthoringNeeds(unittest.TestCase):

    def test_it_names_the_grade_the_subject_and_the_book(self):
        r = basics.records("grade_2_math", 2, "Maths",
                           book(1, 1) + [p(1, "concrete")])[0]
        self.assertEqual((r["stem"], r["grade"], r["subject"]),
                         ("grade_2_math", 2, "Maths"))

    def test_it_reports_the_length_of_the_year_it_sits_in(self):
        rows = basics.records("g2_mth", 2, "Maths", book(1, 4) + [p(1, "concrete")])
        self.assertEqual(rows[0]["of"], 5)


if __name__ == "__main__":
    unittest.main()
