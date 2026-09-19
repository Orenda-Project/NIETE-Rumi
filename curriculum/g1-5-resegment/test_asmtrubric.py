"""A worksheet must be scored on an instrument a worksheet can answer.

Measured 19 Sep 2026 on the first paid judge batch (bd-6ss5g): the chapter
assessment `grade_1_english_ch1_seg995` came back with ZERO 1-ratings and ZERO
2-ratings — the judge found nothing wrong with it — and still failed the
production gate at composite 90.55. It failed because EIGHTEEN of its checks
came back `notAssessable`, its denominator collapsed from 220 to 148 where its
six sibling lessons sat at 204-216, and it was then judged against a bar
calibrated on lessons.

The exclusions were not scattered. They land on C2 Instructional Flow, which is
48 of the lesson rubric's 220 points, so what survived was SKEWED rather than
merely smaller. That is the bug: not a rubric with a few gaps, the wrong rubric.

So this module drops the checks a sat paper structurally cannot answer and adds
the ones it can, and these tests pin both halves. The drop list is measured, not
guessed — every id in it is one the judge itself reported as unassessable, with
a reason of the same shape: there is no teaching phase here to look at.

The seam is `reviewer_prompt_v3.build_reviewer_prompt(active_override=...)`,
already used by `build_multigrade_c9_prompt`. Nothing in the shared skill tree
is edited, so the lesson path and the other lineages that consume it are
untouched.
"""
import os
import sys
import unittest

import gate4

sys.path.insert(0, gate4.reviewer_path())

import asmtrubric
import reviewer_rubric_v3 as rubric
from reviewer_prompt_v3 import build_reviewer_prompt


class TheChecksASatPaperCannotAnswer(unittest.TestCase):
    """Every id here was reported unassessable by the judge, for one reason."""

    def setUp(self):
        self.active = asmtrubric.assessment_rubric("English")
        self.ids = [k["id"] for c in self.active for k in c["checks"]]

    def test_the_fourteen_lesson_only_checks_are_gone(self):
        for cid in ("0B", "0C", "0E", "0F", "2A", "2C", "2F", "2J", "2K", "2L",
                    "3A", "3B", "5B", "5D"):
            self.assertNotIn(cid, self.ids, cid)

    def test_the_drop_list_is_exactly_what_the_judge_reported(self):
        # Pinned so a later edit cannot quietly widen the drop. Widening it is
        # how a rubric stops measuring the thing it is for.
        self.assertEqual(len(asmtrubric.LESSON_ONLY), 14)

    def test_every_dropped_id_is_a_real_check_on_the_lesson_rubric(self):
        # A typo in the drop list would silently drop nothing at all.
        lesson = {k["id"] for c in rubric.get_active_rubric("English")
                  for k in c["checks"]}
        self.assertTrue(asmtrubric.LESSON_ONLY <= lesson,
                        asmtrubric.LESSON_ONLY - lesson)

    def test_what_a_worksheet_can_still_answer_survives(self):
        # Curriculum alignment, accuracy, accessibility and representation are
        # all answerable from a paper. Dropping them would be the opposite bug.
        for cid in ("0A", "0D", "1A", "1B", "1C", "1D", "1E", "1F", "2B", "2D",
                    "4A", "4B", "4C", "4D", "5A", "5C",
                    "6A", "6B", "6C", "6D", "7A", "7B", "7C"):
            self.assertIn(cid, self.ids, cid)

    def test_the_gates_one_strict_check_survives(self):
        # production_gate.JUDGE_STRICT = {"1A"}. A rubric that dropped it would
        # disarm the gate's only hard judge condition without saying so.
        self.assertIn("1A", self.ids)


class TheChecksAWorksheetCanAnswer(unittest.TestCase):

    def setUp(self):
        self.active = asmtrubric.assessment_rubric("English")
        self.crit = self.active[-1]

    def test_the_assessment_criterion_is_appended_last(self):
        self.assertEqual(self.crit["criterion"], asmtrubric.ASSESSMENT_CRITERION)

    def test_it_asks_about_coverage_spread_markability_and_the_lone_child(self):
        ids = [k["id"] for k in self.crit["checks"]]
        self.assertEqual(ids, ["AS1", "AS2", "AS3", "AS4", "AS5", "AS6", "AS7"])

    def test_its_ids_cannot_collide_with_a_lesson_check(self):
        lesson = {k["id"] for c in rubric.get_active_rubric("English")
                  for k in c["checks"]}
        self.assertEqual(lesson & {k["id"] for k in self.crit["checks"]}, set())

    def test_every_check_carries_the_shape_the_renderer_reads(self):
        # `_render_rubric` and `_context_note` read these by key. A missing one
        # is a KeyError at prompt-build time, i.e. at the top of a paid batch.
        for k in self.crit["checks"]:
            for key in ("id", "name", "requirement", "descriptors",
                        "standards", "requires_context"):
                self.assertIn(key, k, k.get("id"))

    def test_every_check_has_a_descriptor_for_all_four_ratings(self):
        # Keys are INTEGERS. `_render_rubric` does `d[1]`, so a string-keyed
        # map renders as a KeyError at the top of a paid batch rather than as
        # a bad prompt. This assertion started out wrong and the renderer
        # caught it.
        for k in self.crit["checks"]:
            self.assertEqual(sorted(k["descriptors"]), [1, 2, 3, 4], k["id"])

    def test_the_lesson_rubric_keys_its_descriptors_the_same_way(self):
        # Pins the contract this follows rather than trusting the memory of it.
        one = rubric.get_active_rubric("English")[0]["checks"][0]
        self.assertEqual(sorted(one["descriptors"]), [1, 2, 3, 4])

    def test_no_descriptor_is_a_placeholder(self):
        for k in self.crit["checks"]:
            for band, text in k["descriptors"].items():
                self.assertNotIn("TODO", text, k["id"])
                self.assertGreater(len(text), 20, (k["id"], band))


class TheArithmeticTheGateDependsOn(unittest.TestCase):

    def setUp(self):
        self.active = asmtrubric.assessment_rubric("English")

    def test_criterion_ids_are_stamped_by_position_with_no_gaps(self):
        self.assertEqual([c["criterion_id"] for c in self.active],
                         ["C%d" % i for i in range(len(self.active))])

    def test_max_score_matches_the_checks_that_actually_survived(self):
        # The bug this catches: filtering the checks but keeping the lesson's
        # max_score, which would put the denominator back where it started.
        for c in self.active:
            self.assertEqual(c["max_score"],
                             rubric.SCALE_MAX * len(c["checks"]), c["criterion_id"])

    def test_no_criterion_survives_with_zero_checks(self):
        for c in self.active:
            self.assertTrue(c["checks"], c["criterion_id"])

    def test_the_grand_total_is_the_sum_of_the_criteria(self):
        self.assertEqual(asmtrubric.grand_total_max("English"),
                         sum(c["max_score"] for c in self.active))

    def test_it_is_a_smaller_instrument_than_the_lesson_rubric(self):
        self.assertLess(asmtrubric.grand_total_max("English"),
                        rubric.grand_total_max("English"))

    def test_it_recovers_most_of_what_the_995_lost(self):
        # The measured failure: 148 assessable of 220. Anything near 148 means
        # the fix did not fix it.
        self.assertGreater(asmtrubric.grand_total_max("English"), 148)


class ItDoesNotCorruptTheLessonRubric(unittest.TestCase):
    """`get_active_rubric` shares its check lists with module-level state."""

    def test_the_lesson_rubric_is_unchanged_afterwards(self):
        before = [k["id"] for c in rubric.get_active_rubric("English")
                  for k in c["checks"]]
        asmtrubric.assessment_rubric("English")
        after = [k["id"] for c in rubric.get_active_rubric("English")
                 for k in c["checks"]]
        self.assertEqual(before, after)

    def test_two_calls_do_not_compound(self):
        first = asmtrubric.assessment_rubric("English")
        second = asmtrubric.assessment_rubric("English")
        self.assertEqual([c["criterion_id"] for c in first],
                         [c["criterion_id"] for c in second])
        self.assertEqual(asmtrubric.grand_total_max("English"),
                         sum(c["max_score"] for c in second))

    def test_editing_the_returned_rubric_cannot_reach_the_shared_one(self):
        got = asmtrubric.assessment_rubric("English")
        got[0]["checks"].pop()
        self.assertEqual(len(rubric.get_active_rubric("English")[0]["checks"]), 6)


class EverySubjectGetsOne(unittest.TestCase):
    """The drop list is universal; only C8 differs by subject."""

    def test_it_composes_for_every_subject_the_lesson_rubric_knows(self):
        for subject in rubric.SUBJECTS:
            active = asmtrubric.assessment_rubric(subject)
            self.assertTrue(active, subject)
            self.assertEqual(active[-1]["criterion"],
                             asmtrubric.ASSESSMENT_CRITERION, subject)

    def test_the_subject_criterion_is_kept_untouched(self):
        # Only English's C8 was measured. The rest are NOT guessed at — their
        # inapplicable checks will still come back notAssessable, which is a
        # visible gap rather than an invented one. bd-cds95 carries this.
        for subject in rubric.SUBJECTS:
            active = asmtrubric.assessment_rubric(subject)
            subj = [c for c in active if c["criterion"].startswith(
                "Subject Specific Review")]
            self.assertEqual(len(subj), 1, subject)


class TheFrameTheJudgeIsGiven(unittest.TestCase):
    """A rubric change with a lesson frame still tells the judge it is a lesson."""

    def setUp(self):
        self.prompt = build_reviewer_prompt(
            "English", active_override=asmtrubric.assessment_rubric("English"),
            frame_override=asmtrubric.FRAME)

    def test_the_frame_says_worksheet_not_lesson_plan(self):
        head = self.prompt[:len(asmtrubric.FRAME)]
        self.assertIn("worksheet", head.lower())

    def test_the_prompt_carries_the_assessment_checks(self):
        for cid in ("AS1", "AS7"):
            self.assertIn(cid, self.prompt)

    def test_the_prompt_asks_for_none_of_the_dropped_checks_by_name(self):
        # By NAME, not by keyword. A bare `assertNotIn("Gradual Release")`
        # fails on the standards LABEL `P1b (Gradual Release - Guided /
        # Scaffolded Practice)` carried by 1C Scaffolded Activities, which is
        # a tag on a check a worksheet can answer (do the items ladder?) and
        # not a request for a teaching phase. Dropping 1C over its tag would
        # be the opposite bug.
        names = {k["name"] for c in rubric.get_active_rubric("English")
                 for k in c["checks"] if k["id"] in asmtrubric.LESSON_ONLY}
        self.assertEqual(len(names), 14)
        for name in names:
            self.assertNotIn(name, self.prompt, name)

    def test_the_scaffolding_check_a_worksheet_can_answer_is_kept(self):
        self.assertIn("Scaffolded Activities", self.prompt)

    def test_the_output_contract_is_built_from_the_assessment_rubric(self):
        # `_render_output_contract` reads the same active list, so the keys the
        # judge is asked for follow the rubric automatically.
        self.assertIn("C%d" % (len(asmtrubric.assessment_rubric("English")) - 1),
                      self.prompt)


if __name__ == "__main__":
    unittest.main()
