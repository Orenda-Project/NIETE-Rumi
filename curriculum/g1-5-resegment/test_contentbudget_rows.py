"""Which rows the content budget applies to at all -- bd-jfkl0.

Split from `test_contentbudget`, which asks what a plan spends. This asks
the prior question, and it is the one that was answered wrongly: for a day
the check said nothing about, the arithmetic never ran.

`failures()` used to ask the row for `content_min` and return [] when it
did not find it. No corpus segment spells `content_min` -- 0 of 2,039 --
so the C1 check `gate4` carries applied to the six basics lessons and to
nothing else. Every ordinary Stage C lesson was authored to a 30-minute
budget and then scored against no budget at all, which is the shape
`gate4`'s word budget already failed in once: handed an artifact carrying
none of the surfaces it measures, it reported clean.

The corpus states one number and calls it `duration_min`, and that number
is 25, 30 or 35 -- never 40. It is the budget wearing the period's name.
`cbriefbasics.minutes()` is the single place that resolves the pair for
the author; this is the same resolution reaching the gate, so the lesson
is scored against the numbers it was actually written to.

What does NOT change: a row that names no time at all is still unscored.
The rule belongs to the row. A row that has said nothing about minutes has
not quietly agreed to thirty of them.
"""
import unittest

import contentbudget


def lp(warm=4, steps=(5, 10, 9), exit_min=None, routine=()):
    """A plan, with the routine steps left out unless a test asks for them."""
    g = {"steps": [{"phase": "Settle", "kind": "routine", "minutes": m}
                   for m in routine]
                  + [{"phase": "I-Do", "minutes": m} for m in steps]}
    if warm is not None:
        g["warmUp"] = {"minutes": warm, "script": "..."}
    if exit_min is not None:
        g["exitTicket"] = {"minutes": exit_min}
    return {"generated": g}


def corpus(duration=30):
    """A row in the shape all 2,039 of them are actually in."""
    return {"segment_index": 801, "chapter_number": 1, "duration_min": duration}


class ARowThatStatesNoTimeAtAll(unittest.TestCase):
    """Still unscored, and this is the part that must not drift.

    Widening the check to the corpus shape is one step from scoring every
    row against a default nobody wrote down. The guard is that the row has
    to have named a number.
    """

    def test_it_is_not_scored(self):
        self.assertEqual(contentbudget.failures(lp(), {"segment_index": 1}), [])

    def test_not_even_when_the_plan_states_no_timings_either(self):
        self.assertEqual(
            contentbudget.failures({"generated": {}}, {"segment_index": 1}), [])

    def test_a_row_whose_minutes_are_not_a_number_has_named_none(self):
        self.assertEqual(
            contentbudget.failures(lp(), {"duration_min": "forty"}), [])

    def test_nor_is_a_missing_row_invented_a_budget_for(self):
        self.assertEqual(contentbudget.failures(lp(), None), [])


class TheCorpusShapeIsScoredNow(unittest.TestCase):
    """One number, named `duration_min`, and it is the budget."""

    def test_the_one_number_the_row_names_is_the_budget_it_is_held_to(self):
        # 6 + 12 + 14 = 32 teaching minutes against the 30 the row names.
        f = contentbudget.failures(lp(warm=6, steps=(12, 14)), corpus(30))
        self.assertEqual([x["id"] for x in f], ["C1"])
        self.assertIn("content budget 30", f[0]["name"])
        self.assertIn("over by 2", f[0]["name"])

    def test_a_twenty_five_minute_row_is_held_to_twenty_five(self):
        f = contentbudget.failures(lp(warm=4, steps=(10, 14)), corpus(25))
        self.assertIn("content budget 25", f[0]["name"])

    def test_the_finding_names_the_period_as_forty_not_as_the_budget(self):
        # The old message printed `duration_min` raw, so a corpus row read
        # "the period is 30 minutes long" -- telling the author to cut to a
        # period their own plan does not print.
        f = contentbudget.failures(lp(warm=6, steps=(12, 14)), corpus(30))
        self.assertIn("the period is 40 minutes long", f[0]["name"])


class TheAccountingRunsAgainstThePeriodThePlanPrints(unittest.TestCase):
    """40, always -- not the 30 the corpus row happens to spell.

    `_accounted` compared the plan's structural minutes to `duration_min`.
    For a corpus row that is 30, so a plan accounting for exactly 30 of a
    40-minute period reconciled perfectly against the wrong number, and the
    ten unowned minutes -- the whole reason this check exists -- passed.
    """

    def _lp(self, routine=()):
        # 5 + 5 + 8 + 9 + 3 = 30 minutes of teaching.
        return lp(warm=5, steps=(5, 8, 9), exit_min=3, routine=routine)

    def test_thirty_accounted_minutes_of_a_corpus_row_still_leaves_ten(self):
        f = contentbudget.failures(self._lp(), corpus(30))
        self.assertEqual([x["id"] for x in f], ["C1"])
        self.assertIn("belong to no step", f[0]["name"])
        self.assertIn("40-minute period", f[0]["name"])

    def test_naming_the_ten_minutes_as_routine_closes_it(self):
        self.assertEqual(
            contentbudget.failures(self._lp(routine=(5, 5)), corpus(30)), [])

    def test_a_row_with_no_period_is_held_to_the_forty_the_plan_prints(self):
        # The row omits `duration_min` and states only the budget. The
        # envelope the author was handed still printed 40, so the ten
        # minutes are still on the teacher's clock.
        f = contentbudget.failures(self._lp(), {"content_min": 30})
        self.assertEqual([x["id"] for x in f], ["C1"])
        self.assertIn("40-minute period", f[0]["name"])


class ARowThatNamesThePeriodButNoBudget(unittest.TestCase):
    """40 and nothing else. A silent budget is not the whole period."""

    def _seg(self):
        return {"segment_index": 801, "duration_min": 40}

    def test_the_house_budget_applies_rather_than_the_whole_forty(self):
        f = contentbudget.failures(lp(warm=5, steps=(10, 12, 13)), self._seg())
        self.assertIn("content budget 30", f[0]["name"])

    def test_a_plan_inside_that_budget_and_its_period_passes(self):
        # 28 teaching, 38 of 40 accounted.
        self.assertEqual(
            contentbudget.failures(lp(routine=(5, 5)), self._seg()), [])

    def test_a_plan_with_no_timings_is_no_longer_unmeasured(self):
        f = contentbudget.failures({"generated": {}}, self._seg())
        self.assertEqual([x["id"] for x in f], ["C1"])
        self.assertIn("no timings", f[0]["name"])


class ARowThatSpellsBothIsStillTakenAtItsWord(unittest.TestCase):
    """The basics rows. Nothing about them changes."""

    def test_the_stated_budget_wins_over_the_house_one(self):
        seg = {"duration_min": 40, "content_min": 25}
        f = contentbudget.failures(lp(warm=4, steps=(10, 14)), seg)
        self.assertIn("content budget 25", f[0]["name"])

    def test_a_budget_larger_than_the_period_cannot_exceed_it(self):
        seg = {"duration_min": 40, "content_min": 60}
        f = contentbudget.failures(lp(warm=10, steps=(15, 20)), seg)
        self.assertIn("content budget 40", f[0]["name"])


if __name__ == "__main__":
    unittest.main()
