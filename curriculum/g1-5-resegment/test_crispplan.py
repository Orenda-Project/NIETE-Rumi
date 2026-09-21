# -*- coding: utf-8 -*-
"""The live sheet is migrated by deleting columns, never by rewriting rows.

Stage C wrote 12,655 values onto these four tabs. A migration that rebuilds
the tab loses them, so the planner refuses anything that is not a sequence of
deletes plus the one rename, and says so loudly rather than falling back.
"""
import unittest

import crispplan
import tabs

LIVE_LANG = ["Day #", "Topic", "Skill type", "Pages (printed)", "Page overlap",
             "Primary SLO", "SLO role", "Primary SLO description",
             "Supporting SLOs", "Supporting SLO descriptions", "Bloom's",
             "Period (min)", "Moves", "Reading strategy",
             "Collaboration structure", "Function", "Interaction", "Gap",
             "Strand", "Recycles", "FDE syllabus", "Prerequisite SLOs",
             "Teacher-primary min (of 40)", "Flags", "A Page truth",
             "B Segmentation", "C Enrichment", "C-gate Enrich gate",
             "D0 Slide script", "D Render meta", "E Voicenote script",
             "J Pedagogy review", "J Design review", "F LP (latest PDF)",
             "Human reviewer", "Review status"]

LIVE_CORE = [c for c in LIVE_LANG
             if c not in ("Function", "Interaction", "Gap", "Strand",
                          "Recycles")]


class ThePlan(unittest.TestCase):

    def test_english_cuts_exactly_the_measured_dead_columns(self):
        plan = crispplan.plan(LIVE_LANG, tabs.header("English"))
        self.assertEqual(
            set(LIVE_LANG[i] for i in plan.deletes),
            {"Period (min)", "FDE syllabus", "Review status",
             "B Segmentation", "C Enrichment", "C-gate Enrich gate",
             "D0 Slide script", "D Render meta", "E Voicenote script",
             "J Pedagogy review", "J Design review", "F LP (latest PDF)"})

    def test_maths_also_loses_reading_strategy(self):
        plan = crispplan.plan(LIVE_CORE, tabs.header("Maths"))
        self.assertIn("Reading strategy",
                      [LIVE_CORE[i] for i in plan.deletes])

    def test_english_keeps_reading_strategy(self):
        plan = crispplan.plan(LIVE_LANG, tabs.header("English"))
        self.assertNotIn("Reading strategy",
                         [LIVE_LANG[i] for i in plan.deletes])

    def test_page_truth_becomes_the_traces_column(self):
        plan = crispplan.plan(LIVE_LANG, tabs.header("English"))
        self.assertEqual(plan.renames,
                         {LIVE_LANG.index("A Page truth"): tabs.TRACES_COLUMN})

    def test_the_deletes_come_back_highest_first(self):
        # Applied left to right they would shift each other's indices.
        plan = crispplan.plan(LIVE_LANG, tabs.header("English"))
        self.assertEqual(plan.deletes, sorted(plan.deletes, reverse=True))

    def test_applying_the_plan_gives_exactly_the_target_header(self):
        for subject, live in (("English", LIVE_LANG), ("Urdu", LIVE_LANG),
                              ("Maths", LIVE_CORE), ("Science", LIVE_CORE)):
            target = tabs.header(subject)
            plan = crispplan.plan(live, target)
            got = list(live)
            for i, label in plan.renames.items():
                got[i] = label
            for i in plan.deletes:
                del got[i]
            self.assertEqual(got, target, subject)

    def test_a_second_run_is_a_no_op(self):
        target = tabs.header("English")
        plan = crispplan.plan(target, target)
        self.assertEqual(plan.deletes, [])
        self.assertEqual(plan.renames, {})

    def test_a_target_that_needs_a_reorder_is_refused(self):
        with self.assertRaises(ValueError):
            crispplan.plan(["a", "b", "c"], ["c", "a"])

    def test_a_target_column_the_live_sheet_lacks_is_refused(self):
        with self.assertRaises(ValueError):
            crispplan.plan(["a", "b"], ["a", "b", "brand new"])


if __name__ == "__main__":
    unittest.main()
