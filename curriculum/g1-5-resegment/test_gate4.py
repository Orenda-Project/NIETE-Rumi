"""Gate G4: the scoring gate must exist, and be calibrated, BEFORE a lesson is enriched.

SKILL.md line 181 states the gate and why it comes first: "at 2,000-lesson scale,
unmeasured quality is drift you find after the money is spent."

Most of the gate is already built and already calibrated — the v3 rubric, the
deterministic QA checks and `production_gate.gate` v1.1 were migrated on
2026-08-03 and tuned against trial data. What has never existed is the piece
between them. `score_lp.py` writes `score_pct`; `production_gate.gate` reads
`composite_pct`, `qa_hard_pass`, `qa_hard_failures` and `judge`. Nothing
produces the second shape from the first, so the calibrated gate has never
actually been runnable end to end.

This module is that piece, plus the two hard checks this build owns and the
imported reviewer cannot know about:

  THE WORD BUDGET (DECIDED B, operator 2026-09-18). The imported QA checks read
  a camelCase v9 body; this build's surfaces are snake_case, and the budget is
  this build's law. Over cap fails — the renderer never trims.

  PAGE GROUNDING. `qa_checks` H5 asks only whether the segment CARRIES a page
  reference, not whether that page exists in the book or belongs to the
  segment's chapter. Grade 5 Urdu prints pages 130-137 twice, so "carries a
  page number" and "is grounded on the right page" are different questions, and
  the whole no-fabrication guarantee rests on the second one.

Both enter as HARD failures on the existing report rather than as a forked
gate. The gate's thresholds were calibrated on real scores; re-deriving them
here would throw that calibration away.
"""
import unittest

import gate4


def qa(hard_pass=True, soft_pct=100.0, failures=None):
    return {"hard_pass": hard_pass, "hard_failures": failures or [],
            "soft_pct": soft_pct, "checks": []}


class TheCompositeNumber(unittest.TestCase):
    """composite = mean(judge %, deterministic soft-QA %) — production_gate's contract."""

    def test_it_is_the_mean_of_the_judge_and_the_soft_checks(self):
        s = gate4.compose(qa(soft_pct=80.0), judge_pct=90.0)
        self.assertEqual(s["composite_pct"], 85.0)

    def test_the_judge_percentage_is_carried_through_for_the_report(self):
        s = gate4.compose(qa(), judge_pct=93.5)
        self.assertEqual(s["judge_pct"], 93.5)
        self.assertEqual(s["soft_pct"], 100.0)

    def test_a_lesson_with_no_judge_score_is_not_silently_given_one(self):
        # A missing judge is an unscored lesson, not a perfect one. It must not
        # round up into a pass.
        s = gate4.compose(qa(), judge_pct=None)
        self.assertIsNone(s["composite_pct"])
        self.assertIn("not-judged", s["qa_hard_failures"][0]["id"])
        self.assertFalse(s["qa_hard_pass"])


class TheShapeProductionGateExpects(unittest.TestCase):

    def test_the_hard_verdict_is_renamed_to_what_the_gate_reads(self):
        s = gate4.compose(qa(hard_pass=False, failures=[{"id": "H3"}]),
                          judge_pct=99.0)
        self.assertFalse(s["qa_hard_pass"])
        self.assertEqual(s["qa_hard_failures"][0]["id"], "H3")

    def test_the_judge_model_is_carried_because_the_bar_depends_on_it(self):
        # production_gate raises the bar to 94 for a sonnet judge. A score that
        # drops the model name is silently judged at the opus bar.
        s = gate4.compose(qa(), judge_pct=93.0, judge="anthropic/claude-sonnet-5")
        self.assertEqual(s["judge"], "anthropic/claude-sonnet-5")

    def test_the_review_is_carried_so_the_gate_can_find_low_ratings(self):
        review = {"criteria": [{"checks": [{"id": "2B", "rating": 1}]}]}
        s = gate4.compose(qa(), judge_pct=95.0, review=review)
        self.assertEqual(s["review"], review)


class TheWordBudgetIsAHardFailure(unittest.TestCase):
    """Over cap fails. The renderer never trims, so nothing downstream absorbs it."""

    def test_a_lesson_over_a_cap_fails_hard(self):
        s = gate4.compose(qa(), judge_pct=99.0,
                          body={"big_idea": "word " * 200})
        self.assertFalse(s["qa_hard_pass"])

    def test_the_failure_names_the_surface_its_count_and_its_cap(self):
        s = gate4.compose(qa(), judge_pct=99.0,
                          body={"big_idea": "word " * 200})
        f = [h for h in s["qa_hard_failures"] if h["id"] == "W1"][0]
        self.assertIn("big_idea", f["name"])
        self.assertIn("200", f["name"])
        self.assertIn("80", f["name"])

    def test_a_lesson_inside_the_budget_adds_no_failure(self):
        s = gate4.compose(qa(), judge_pct=99.0, body={"big_idea": "word " * 80})
        self.assertTrue(s["qa_hard_pass"])

    def test_no_body_means_no_budget_verdict_rather_than_a_pass(self):
        # Scoring an HTML render has no snake_case body to measure. Claiming
        # the budget passed would be asserting something never checked.
        s = gate4.compose(qa(), judge_pct=99.0, body=None)
        self.assertTrue(s["qa_hard_pass"])
        self.assertIn("W1", s["not_checked"])

    def test_a_body_carrying_no_capped_surface_is_unchecked_not_passed(self):
        # THE SILENT FAILURE. The imported QA checks read a camelCase v9 body
        # (`warmUp`, `keyWords`, `exitTicket`); the budget is written against
        # this build's snake_case surfaces. Handed a v9 body, `wordbudget` finds
        # none of its surfaces and returns no findings — which reads exactly
        # like a lesson inside the budget. A gate that cannot tell "measured and
        # fine" from "measured nothing" is decoration.
        s = gate4.compose(qa(), judge_pct=99.0,
                          body={"warmUp": "word " * 400,
                                "exitTicket": "word " * 400})
        self.assertIn("W1", s["not_checked"])

    def test_one_capped_surface_is_enough_to_count_as_measured(self):
        s = gate4.compose(qa(), judge_pct=99.0,
                          body={"warmUp": "x", "big_idea": "word " * 10})
        self.assertNotIn("W1", s["not_checked"])


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


class TheGateIsTheImportedCalibratedOne(unittest.TestCase):
    """v1.1, tuned on real scores. Re-deriving its thresholds here would lose that."""

    def test_a_clean_high_scoring_lesson_passes(self):
        s = gate4.compose(qa(), judge_pct=95.0, review={},
                          body={"big_idea": "word " * 50},
                          grounding={"resolved": True, "flags": []})
        self.assertTrue(gate4.verdict(s)["pass"])

    def test_a_lesson_over_the_word_budget_is_refused_by_the_gate_itself(self):
        s = gate4.compose(qa(), judge_pct=99.0, review={},
                          body={"big_idea": "word " * 200},
                          grounding={"resolved": True, "flags": []})
        v = gate4.verdict(s)
        self.assertFalse(v["pass"])
        self.assertTrue(any("big_idea" in r for r in v["reasons"]))

    def test_a_check_rated_one_still_fails_however_high_the_composite(self):
        s = gate4.compose(qa(), judge_pct=99.0,
                          review={"criteria": [{"checks": [{"id": "2B",
                                                            "rating": 1}]}]},
                          body={}, grounding={"resolved": True, "flags": []})
        self.assertFalse(gate4.verdict(s)["pass"])

    def test_the_sonnet_bar_is_higher_than_the_opus_bar(self):
        # Calibration 2026-08-03: a sonnet judge rates ~+1.9 leniently, so it
        # faces 94 where opus faces 92. A judge score of 86 against clean soft
        # checks composites to 93.0 — between the two bars, which is the only
        # place the difference is observable.
        base = dict(review={}, body={}, grounding={"resolved": True, "flags": []})
        opus = gate4.compose(qa(), judge_pct=86.0, judge="anthropic/claude-opus-5", **base)
        sonn = gate4.compose(qa(), judge_pct=86.0, judge="anthropic/claude-sonnet-5", **base)
        self.assertTrue(gate4.verdict(opus)["pass"])
        self.assertFalse(gate4.verdict(sonn)["pass"])


class EvaluatingOneLesson(unittest.TestCase):
    """The single call Stage C makes, against the real migrated reviewer."""

    # Shaped for the imported `qa_checks`, which reads a camelCase v9 body.
    LP = {"warmUp": "Ask two children what they ate for breakfast today.",
          "steps": [{"cfu": {"question": "Which sound does 'cat' start with?"}},
                    {"cfu": {"question": "Point to the word that rhymes."}}],
          "exitTicket": "Write one word that begins with the letter C and read it aloud.",
          "problems": [{"solution": "c-a-t"}],
          "keyWords": ["cat"], "homework": "Read page 3 aloud at home.",
          "hookStory": "A cat sat on a mat.", "boardWork": "c a t",
          "weakLearnerSupport": "Say the sound with the child.",
          "challengeExtension": "Find two more words starting with C.",
          "duration_min": 40}
    SEG = {"pages_printed": [2, 3], "slo_codes": ["E-1-A-1"]}

    def test_the_judge_score_becomes_a_percentage_not_a_tuple(self):
        # `score_lp.tally` returns (total, denom, flags). Passing that straight
        # through as a percentage is how a gate silently stops gating.
        review = {"criteria": [{"checks": [{"id": "1A", "rating": 4},
                                           {"id": "1B", "rating": 3}]}]}
        score, _ = gate4.evaluate(self.LP, self.SEG, review, subject="English")
        self.assertEqual(score["judge_pct"], 87.5)      # 7 of 8

    def test_a_review_with_nothing_rated_is_not_scored_as_zero(self):
        # Every check notAssessable shrinks the denominator to nothing. That is
        # an unscored lesson, not a failed one.
        score, _ = gate4.evaluate(self.LP, self.SEG,
                                  {"criteria": [{"checks": [
                                      {"id": "1A", "rating": None}]}]},
                                  subject="English")
        self.assertIsNone(score["judge_pct"])
        self.assertFalse(score["qa_hard_pass"])

    def test_the_deterministic_checks_actually_ran(self):
        review = {"criteria": [{"checks": [{"id": "1A", "rating": 4}]}]}
        score, _ = gate4.evaluate(self.LP, self.SEG, review, subject="English")
        self.assertTrue(score["qa_hard_pass"], score["qa_hard_failures"])
        self.assertIsNotNone(score["soft_pct"])

    def test_a_lesson_missing_its_exit_ticket_fails_the_hard_checks(self):
        lp = dict(self.LP)
        del lp["exitTicket"]
        review = {"criteria": [{"checks": [{"id": "1A", "rating": 4}]}]}
        score, v = gate4.evaluate(lp, self.SEG, review, subject="English")
        self.assertFalse(score["qa_hard_pass"])
        self.assertFalse(v["pass"])


class TheReviewerItDependsOn(unittest.TestCase):
    """It lives outside this repo, so the dependency is explicit and loud."""

    def test_the_migrated_reviewer_is_where_gate4_expects_it(self):
        import os
        self.assertTrue(os.path.isfile(
            os.path.join(gate4.reviewer_path(), "production_gate.py")),
            "migrated lp_reviewer not found at " + gate4.reviewer_path())

    def test_the_path_is_relative_to_this_build_not_hardcoded(self):
        with open("gate4.py") as fh:
            self.assertNotIn("/Users/", fh.read())


if __name__ == "__main__":
    unittest.main()
