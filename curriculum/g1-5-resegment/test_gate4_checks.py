"""The two hard checks Gate G4 owns, that the imported reviewer cannot know about.

THE WORD BUDGET (`spec/07-lp-production.md` §4, DECIDED B, operator
2026-09-18). Over cap fails — the renderer never trims, so nothing downstream
absorbs an overrun. It is measured on the D0 RENDER rather than the Stage-C
body, because the caps are a property of the printed page: they exist to hold
the p90 lesson inside the 5-8 phone-page band, and a body has no pages.

THE PAGE GROUNDING. `qa_checks` H5 asks only whether the segment CARRIES a page
reference, not whether that page exists in the book or belongs to the segment's
chapter. Grade 5 Urdu prints pages 130-137 twice, so "carries a page number"
and "is grounded on the right page" are different questions, and the whole
no-fabrication guarantee rests on the second one.

Both enter as HARD failures on the existing report rather than as a forked
gate, whose thresholds were calibrated on real scores.

This file exists apart from `test_gate4.py` because the two together crossed
the 300-line limit, and these two checks are the pair the module docstring
names — the gate's own contract with `production_gate` is the other half.
"""
import unittest

import gate4
from test_gate4 import block, qa, render


class TheWordBudgetIsAHardFailure(unittest.TestCase):
    """Over cap fails. The renderer never trims, so nothing downstream absorbs it."""

    def test_a_render_over_a_cap_fails_hard(self):
        s = gate4.compose(qa(), judge_pct=99.0,
                          render=render(block("big_idea", text="word " * 200)))
        self.assertFalse(s["qa_hard_pass"])

    def test_the_failure_names_the_surface_its_count_and_its_cap(self):
        s = gate4.compose(qa(), judge_pct=99.0,
                          render=render(block("big_idea", text="word " * 200)))
        f = [h for h in s["qa_hard_failures"] if h["id"] == "W1"][0]
        self.assertIn("big_idea", f["name"])
        self.assertIn("200", f["name"])
        self.assertIn("80", f["name"])

    def test_a_render_inside_the_budget_adds_no_failure(self):
        s = gate4.compose(qa(), judge_pct=99.0,
                          render=render(block("big_idea", text="word " * 80)))
        self.assertTrue(s["qa_hard_pass"])

    def test_the_real_lessons_broken_caps_are_all_reported(self):
        # Measured 18 Sep 2026 off `to_lp_doc` on the first lesson of the
        # approved slice. Five `key_points` blocks across the lesson total 367
        # against a cap of 120 — the "across all sections" case §4 names, and
        # the case a per-block check would also miss.
        s = gate4.compose(qa(), judge_pct=99.0, render=render(
            block("key_points", title="Set this up", items=["w"] * 200),
            block("key_points", id="remember", items=["w"] * 165),
            block("faded_example", title="WE DO", steps=["w"] * 625),
            block("worked_example", title="I DO", steps=["w"] * 513)))
        named = {h["name"].split()[0] for h in s["qa_hard_failures"]}
        self.assertEqual(named, {"key_points", "faded_example",
                                 "worked_example"})

    def test_no_render_means_no_budget_verdict_rather_than_a_pass(self):
        s = gate4.compose(qa(), judge_pct=99.0, render=None)
        self.assertTrue(s["qa_hard_pass"])
        self.assertIn("W1", s["not_checked"])

    def test_the_stage_c_body_carries_no_blocks_so_it_is_not_measured(self):
        # THE SILENT FAILURE, bd-8kdod. `evaluate` handed `compose` the Stage-C
        # body, which is camelCase v9 and holds no render blocks at all. Worse,
        # `generated.instance_ledger.worked_example` is a real dict KEY holding
        # a few words of provenance, so a key-matching budget found a surface,
        # measured five words, and passed. Measured and fine has to be
        # distinguishable from measured nothing, or the gate is decoration.
        body = {"warmUp": "word " * 400,
                "instance_ledger": {"worked_example": "seg1 p2 i-do"}}
        s = gate4.compose(qa(), judge_pct=99.0, render=body)
        self.assertIn("W1", s["not_checked"])

    def test_one_capped_block_is_enough_to_count_as_measured(self):
        s = gate4.compose(qa(), judge_pct=99.0, render=render(
            block("board", text="c a t"), block("big_idea", text="word " * 10)))
        self.assertNotIn("W1", s["not_checked"])

    def test_an_uncapped_block_is_never_a_failure_however_long(self):
        # `ask`, `warmup`, `board`, `keywords` and `exit_ticket` are uncapped
        # by DECIDED B. The budget must not invent a cap for them.
        s = gate4.compose(qa(), judge_pct=99.0, render=render(
            block("board", text="word " * 900),
            block("big_idea", text="word " * 10)))
        self.assertTrue(s["qa_hard_pass"])


class PageGroundingIsAHardFailure(unittest.TestCase):
    """The whole no-fabrication guarantee is 'the right page', not 'a page'."""

    def test_an_unresolved_segment_fails_hard(self):
        s = gate4.compose(qa(), judge_pct=99.0,
                          grounding={"resolved": False,
                                     "flags": [{"reason": "chapter-mismatch"}]})
        self.assertFalse(s["qa_hard_pass"])
        self.assertEqual([h["id"] for h in s["qa_hard_failures"]], ["G1"])

    def test_the_failure_names_the_reason_so_it_is_actionable(self):
        s = gate4.compose(qa(), judge_pct=99.0,
                          grounding={"resolved": False,
                                     "flags": [{"reason": "chapter-mismatch"}]})
        self.assertIn("chapter-mismatch", s["qa_hard_failures"][0]["name"])

    def test_a_resolved_segment_passes_even_though_its_keys_disagreed(self):
        # keys-disagree is resolved, and flagged. It is a note on the report,
        # not a reason to refuse the lesson.
        s = gate4.compose(qa(), judge_pct=99.0,
                          grounding={"resolved": True,
                                     "flags": [{"reason": "keys-disagree"}]})
        self.assertTrue(s["qa_hard_pass"])
        self.assertEqual(s["grounding_flags"], ["keys-disagree"])

    def test_no_grounding_given_is_recorded_as_unchecked_not_as_passed(self):
        s = gate4.compose(qa(), judge_pct=99.0)
        self.assertIn("G1", s["not_checked"])


if __name__ == "__main__":
    unittest.main()
