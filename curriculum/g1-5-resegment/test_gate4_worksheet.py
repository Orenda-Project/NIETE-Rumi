"""Gate G4, the 995 half: a worksheet is gated as a worksheet.

Split out of `test_gate4.py` when that file passed 300 lines. The two classes
here are one story told twice, because the defect landed twice — once in
`compose` and once, a day later, in `evaluate`.

W1 measures five surfaces a worksheet does not have, and `qa_checks` asks for
three fields it does not have either. Both were silently charged against the
real `grade_1_english_ch1_seg995`, a clean ten-question sheet: the first as a
useless "not checked", the second as six hard failures no worksheet can ever
clear. `wslint` already asks the question that does apply, for free, so it
takes their place — and `worksheet_findings` is the single place that decides
which artefact is in hand.
"""
import unittest

import gate4


def qa(hard_pass=True, soft_pct=100.0, failures=None):
    return {"hard_pass": hard_pass, "hard_failures": failures or [],
            "soft_pct": soft_pct, "checks": []}


class AnAssessmentIsGatedAsAWorksheet(unittest.TestCase):
    """W1 measures five surfaces a worksheet does not have.

    Handed a worksheet, `wordbudget.totals` returns nothing and the gate
    records W1 as "not checked" — which is true, and useless. The question a
    worksheet has to answer is a different one, and `wslint` already asks it
    for free. So for a 995 the lint takes W1's place: same report, same
    calibrated bar, a check that is actually about the artefact in hand.

    Stated as its own class because the failure it prevents is silent. A
    worksheet with six questions and no answer key would have passed every
    hard check this gate ran, on the strength of having no capped surfaces.
    """

    from test_wslint import good as _good

    def env(self, n=8, **kw):
        return AnAssessmentIsGatedAsAWorksheet._good(n, **kw)

    SEG = {"segment_index": 995, "chapter_number": 1,
           "lp_type": "assessment", "skill_type": "assessment"}

    def test_a_short_worksheet_fails_the_gate_on_the_lint(self):
        s = gate4.compose(qa(), judge_pct=96.0, lint=gate4.worksheet_findings(
            self.env(6), self.SEG))
        self.assertIn("WS-02", [f["id"] for f in s["qa_hard_failures"]])
        self.assertFalse(s["qa_hard_pass"])

    def test_the_failure_says_what_is_wrong_in_words(self):
        s = gate4.compose(qa(), judge_pct=96.0, lint=gate4.worksheet_findings(
            self.env(6), self.SEG))
        self.assertIn("6", [f for f in s["qa_hard_failures"]
                            if f["id"] == "WS-02"][0]["name"])

    def test_a_clean_worksheet_passes_its_hard_checks(self):
        s = gate4.compose(qa(), judge_pct=96.0, lint=gate4.worksheet_findings(
            self.env(), self.SEG))
        self.assertEqual(s["qa_hard_failures"], [])
        self.assertTrue(s["qa_hard_pass"])

    def test_the_word_budget_is_not_reported_as_unchecked_on_a_worksheet(self):
        # "Not checked" means someone should go and check it. Nobody should:
        # a worksheet has no `key_points` and never will.
        s = gate4.compose(qa(), judge_pct=96.0, lint=[])
        self.assertNotIn("W1", s["not_checked"])

    def test_a_lesson_still_gets_the_word_budget(self):
        # The control. Nothing above may switch the caps off for a lesson.
        s = gate4.compose(qa(), judge_pct=96.0, render=None)
        self.assertIn("W1", s["not_checked"])

    def test_the_lint_is_only_run_for_an_assessment(self):
        # `worksheet_findings` is the single place that decides, so a content
        # lesson cannot be measured against worksheet rules by accident.
        env = self.env()
        env["lp_type"] = "content"
        content = {"segment_index": 1, "lp_type": "content",
                   "skill_type": "writing"}
        self.assertIsNone(gate4.worksheet_findings(env, content))

    def test_an_envelope_that_calls_itself_an_assessment_is_one(self):
        # `d0_route.kind` ORs the envelope and the segment, and that is the
        # safe direction: where the two disagree the artefact is treated as
        # the assessment it claims to be and refused as a lesson plan, rather
        # than slipping through as four pages of teacher script.
        content = {"segment_index": 1, "lp_type": "content",
                   "skill_type": "writing"}
        self.assertEqual(gate4.worksheet_findings(self.env(), content), [])

    def test_an_assessment_with_no_questions_at_all_is_caught(self):
        env = self.env()
        env["generated"]["questions"] = []
        ids = [f["id"] for f in gate4.worksheet_findings(env, self.SEG)]
        self.assertIn("WS-02", ids)


class AWorksheetIsNotMeasuredByLessonChecks(unittest.TestCase):
    """The other half of the same defect, found gating the real 995.

    `compose` already knows a worksheet has no `key_points`, so W1 steps aside
    for the lint. `evaluate` did not: it ran `qa_checks` — the LESSON suite —
    before anything had looked at the route. Handed
    `grade_1_english_ch1_seg995`, a clean ten-question worksheet that passes
    every one of WS-01..WS-16, it reported six hard failures:

        H2.warmUp, H2.steps, H2.exitTicket, H4 ("Exit ticket has real
        content"), H5, H6

    None of them is a defect in the worksheet. A student worksheet has no warm
    up, no I-Do/We-Do/You-Do and no exit ticket, and never will. A gate that
    charges an artefact with failures it cannot clear is a gate that gets
    switched off, which is how the one check that DOES apply — the lint —
    would have stopped being read.

    The soft half was a genuine gap rather than a bug: there was no worksheet
    soft-check suite, so it was reported as unmeasured rather than papered
    over with a 0.0 that reads as "scored zero". `wssoft` closed it
    (bd-nr311), and the tests below now hold the other end — a measured soft
    half, and a composite that forms.

    The fixture is `test_wssoft.sheet` rather than `test_wslint.good`. The
    lint fixture is minimal on purpose — every question carries the same
    childText, the same answer and the same common errors, and the drawing
    question is offered ruled lines. That is a legitimate LINT fixture,
    because none of it is a refusal. It is not a clean worksheet, and a gate
    test that called it one would be asserting the gate ignores quality.
    """

    from test_wssoft import sheet as _good

    SEG = {"segment_index": 995, "chapter_number": 1,
           "lp_type": "assessment", "skill_type": "assessment"}
    REVIEW = {"criteria": [{"checks": [{"id": "1A", "rating": 4}]}]}

    def env(self, n=8, **kw):
        return AWorksheetIsNotMeasuredByLessonChecks._good(n, **kw)

    def ev(self, n=8):
        return gate4.evaluate(self.env(n), self.SEG, self.REVIEW,
                              subject="English")

    def test_the_lesson_shaped_hard_checks_do_not_run_on_a_worksheet(self):
        score, _ = self.ev()
        self.assertEqual(
            [h["id"] for h in score["qa_hard_failures"]
             if str(h.get("id", "")).startswith("H")], [])

    def test_the_exit_ticket_check_is_not_charged_against_a_worksheet(self):
        # Named on its own because H4 is the one that reads most like a real
        # finding: "Exit ticket has real content" is true of every worksheet
        # ever printed, vacuously.
        score, _ = self.ev()
        self.assertNotIn("H4", [h["id"] for h in score["qa_hard_failures"]])

    def test_a_clean_worksheet_clears_its_hard_checks(self):
        score, _ = self.ev()
        self.assertTrue(score["qa_hard_pass"], score["qa_hard_failures"])

    def test_the_soft_half_is_measured_by_the_worksheet_suite(self):
        # It used to come back None with `S1` in not_checked, because nothing
        # measured a worksheet's quality. `wssoft` does.
        score, _ = self.ev()
        self.assertEqual(score["soft_pct"], 100.0)
        self.assertNotIn("S1", score["not_checked"])

    def test_the_composite_now_forms(self):
        score, _ = self.ev()
        self.assertIsNotNone(score["composite_pct"])

    def test_a_clean_worksheet_with_a_judge_score_passes(self):
        # The whole point of the route: a good worksheet can now get through
        # the same gate a good lesson does.
        _, v = self.ev()
        self.assertTrue(v["pass"], v)

    def test_a_worksheet_that_clears_the_lint_can_still_lose_soft_marks(self):
        # Ruled lines for a drawing question is not a refusal. It is a worse
        # paper, and the composite should say so.
        env = self.env()
        for q in env["generated"]["questions"]:
            if q["type"] == "draw":
                q["space"] = "lines"
        score, _ = gate4.evaluate(env, self.SEG, self.REVIEW, subject="English")
        self.assertTrue(score["qa_hard_pass"])
        self.assertLess(score["soft_pct"], 100.0)
        self.assertIn("WSS-06", [c["id"] for c in score["checks"]
                                 if not c["pass"]])

    def test_a_soft_check_that_could_not_be_measured_reaches_the_gate(self):
        # An unknown grade means the reading band was not measured. That has
        # to surface where `S1` used to, or the blur comes straight back.
        env = self.env()
        env["lesson_id"] = "seg995"
        score, _ = gate4.evaluate(env, self.SEG, self.REVIEW, subject="English")
        self.assertIn("WSS-07", score["not_checked"])

    def test_a_broken_worksheet_still_fails_on_its_own_lint(self):
        score, v = self.ev(6)
        self.assertIn("WS-02", [h["id"] for h in score["qa_hard_failures"]])
        self.assertFalse(score["qa_hard_pass"])
        self.assertFalse(v["pass"])

    def test_a_lesson_is_still_measured_by_the_lesson_checks(self):
        # The control. Nothing above may switch the hard checks off for an
        # ordinary content lesson.
        lp = {"warmUp": {}, "steps": [], "exitTicket": None}
        seg = {"segment_index": 1, "chapter_number": 1, "lp_type": "content",
               "skill_type": "writing", "pages_printed": [2]}
        score, _ = gate4.evaluate(lp, seg, self.REVIEW, subject="English")
        self.assertFalse(score["qa_hard_pass"])
        self.assertIsNotNone(score["soft_pct"])


if __name__ == "__main__":
    unittest.main()
