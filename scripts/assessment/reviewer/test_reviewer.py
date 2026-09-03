"""
Tests for the assessment reviewer (bd-60021).

    cd scripts/assessment/reviewer && python3 -m unittest test_reviewer -v

Every case is either a property the two source rubrics require, or a defect our
own eval runs actually produced.
"""
import unittest

import rubric_v1 as R
from qa_checks import run_checks
from gate import gate
from prompt import build_reviewer_prompt


# The two exam papers below are the shapes the generator really emits.
def mcq(q="Which animal says meow?", opts=("(a) Dog", "(b) Cat"), ans="(b) Cat", marks=1, **kw):
    return {"main_question": "Choose the correct option", "question": q,
            "options": list(opts), "answer": ans, "marks": marks, "blooms": "Remember", **kw}


def paper(**over):
    p = {
        "unseen": {"objective": {
            "MCQs": [mcq(), mcq("Which is a fruit?", ("(a) Mango", "(b) Chair"), "(a) Mango")],
            "True/False": [{"main_question": "Write True or False", "question": "A cat is a bird.",
                            "answer": "False", "marks": 1, "blooms": "Understand"}],
        }},
    }
    p.update(over)
    return p


class RubricShape(unittest.TestCase):
    def test_five_criteria_and_stable_ids(self):
        r = R.get_active_rubric()
        self.assertEqual([c["criterion_id"] for c in r], ["A1", "A2", "A3", "A4", "A5"])
        ids = R.check_ids()
        self.assertEqual(len(ids), len(set(ids)), "check ids must be unique")
        self.assertEqual(R.grand_total_max(), len(ids) * 4)

    def test_every_check_has_four_ascending_descriptors(self):
        for c in R.get_active_rubric():
            for chk in c["checks"]:
                self.assertEqual(sorted(chk["descriptors"]), [1, 2, 3, 4], chk["id"])
                for k in (1, 2, 3, 4):
                    self.assertTrue(str(chk["descriptors"][k]).strip(), f"{chk['id']} band {k}")

    def test_every_standard_code_is_named(self):
        for c in R.get_active_rubric():
            for chk in c["checks"]:
                self.assertTrue(chk["standards"], f"{chk['id']} cites no standard")
                for s in chk["standards"]:
                    self.assertIn(s, R.STANDARD_NAMES, f"{chk['id']} cites unnamed {s}")

    def test_every_check_declares_a_scope_and_a_source(self):
        for c in R.get_active_rubric():
            for chk in c["checks"]:
                self.assertIn(chk["scope"], ("item", "paper"), chk["id"])
                self.assertTrue(chk.get("source"), f"{chk['id']} has no provenance")

    def test_both_source_rubrics_are_represented(self):
        srcs = " ".join(chk["source"] for c in R.get_active_rubric() for chk in c["checks"])
        self.assertIn("exam sheet v2", srcs)
        self.assertIn("LP rubric", srcs)
        self.assertIn("ours", srcs)

    def test_every_exam_sheet_v2_row_is_accounted_for(self):
        """The v2 tab has 15 scored rows. Each must be carried by some check — either
        alone or explicitly MERGED into one — so none is silently dropped. Provenance
        cites the row number, so this counts rows, not checks."""
        import re
        srcs = " ".join(chk["source"] for c in R.get_active_rubric() for chk in c["checks"])
        rows = {int(n) for n in re.findall(r"exam sheet v2 row (\d+)", srcs)}
        rows |= {int(n) for n in re.findall(r"row (\d+)[^)]*\)", srcs)}
        expected = {2, 3, 4, 5, 7, 8, 10, 11, 13, 14, 15, 18, 19, 20}
        missing = expected - rows
        self.assertFalse(missing, f"v2 rows dropped with no merge note: {sorted(missing)}")

    def test_a_merged_check_says_what_it_merged(self):
        """A check carrying two source rows must say MERGED, so the merge is a decision
        on the record rather than an accident."""
        for c in R.get_active_rubric():
            for chk in c["checks"]:
                if chk["source"].count("row ") > 1:
                    self.assertIn("MERGED", chk["source"], chk["id"])

    def test_unassessable_standards_are_listed_with_a_reason(self):
        self.assertIn("P4", R.NOT_YET_ASSESSABLE)
        self.assertIn("P2", R.NOT_YET_ASSESSABLE)
        for code, why in R.NOT_YET_ASSESSABLE.items():
            self.assertTrue(len(why) > 20, f"{code} needs a real reason")


class Prompt(unittest.TestCase):
    def test_renders_every_check_with_its_descriptors(self):
        p = build_reviewer_prompt(subject="English", grade=3)
        for cid in R.check_ids():
            self.assertIn(f"[{cid}]", p)
        _, chk = R.find_check("A5a")
        self.assertIn(chk["descriptors"][1], p)

    def test_context_absent_instructs_not_assessable_not_a_penalty(self):
        p = build_reviewer_prompt(subject="English", grade=3, available_context=set())
        self.assertIn("A1d", p)
        self.assertIn("notAssessable", p)
        self.assertIn("do NOT score it 1", p)

    def test_context_present_says_score_normally(self):
        p = build_reviewer_prompt(subject="English", grade=3,
                                  available_context={R.CONTEXT_BOOK})
        i = p.index("[A1d]")
        self.assertIn("score normally", p[i:i + 1200])

    def test_urdu_medium_subject_gets_the_script_instruction(self):
        p = build_reviewer_prompt(subject="urdu", grade=2)
        self.assertRegex(p, r"Urdu script|Urdu-medium")

    def test_item_and_paper_scopes_are_both_explained(self):
        p = build_reviewer_prompt(subject="Maths", grade=4)
        self.assertIn("per item", p)
        self.assertIn("once for the whole paper", p)

    def test_output_contract_names_the_json_shape(self):
        p = build_reviewer_prompt(subject="English", grade=1)
        for token in ('"checks"', '"rating"', '"notAssessable"', '"rationale"'):
            self.assertIn(token, p)


class DeterministicChecks(unittest.TestCase):
    """No LLM. These must catch what a judge should never be asked to eyeball."""

    def test_clean_paper_passes_hard_checks(self):
        rep = run_checks(paper(), requested_count=3, total_marks=3)
        self.assertTrue(rep["hard_pass"], rep["hard_failures"])

    def test_picture_dependent_item_is_a_hard_failure(self):
        p = paper(seen={"objective": {"Brief Answers": [
            {"main_question": "Label the Picture",
             "question": "Write the name of each object under its picture.",
             "marks": 2}]}})
        rep = run_checks(p, requested_count=4, total_marks=5)
        self.assertFalse(rep["hard_pass"])
        self.assertIn("D1", [f["id"] for f in rep["hard_failures"]])

    def test_marks_missing_is_a_hard_failure(self):
        p = paper()
        del p["unseen"]["objective"]["MCQs"][0]["marks"]
        rep = run_checks(p, requested_count=3, total_marks=2)
        self.assertIn("D2", [f["id"] for f in rep["hard_failures"]])

    def test_printed_total_must_equal_the_sum_of_items(self):
        rep = run_checks(paper(), requested_count=3, total_marks=99)
        self.assertIn("D3", [f["id"] for f in rep["hard_failures"]])

    def test_duplicate_question_is_caught(self):
        p = paper()
        p["unseen"]["objective"]["MCQs"].append(mcq())      # same stem twice
        rep = run_checks(p, requested_count=4, total_marks=4)
        self.assertIn("D4", [f["id"] for f in rep["hard_failures"]])

    def test_mcq_with_one_option_is_caught(self):
        p = paper()
        p["unseen"]["objective"]["MCQs"][0]["options"] = ["(a) only"]
        rep = run_checks(p, requested_count=3, total_marks=3)
        self.assertIn("D5", [f["id"] for f in rep["hard_failures"]])

    def test_mcq_answer_must_be_one_of_its_options(self):
        p = paper()
        p["unseen"]["objective"]["MCQs"][0]["answer"] = "(z) Elephant"
        rep = run_checks(p, requested_count=3, total_marks=3)
        self.assertIn("D6", [f["id"] for f in rep["hard_failures"]])

    def test_self_answering_stem_is_caught(self):
        p = paper(unseen={"objective": {"MCQs": [
            {"question": "There are 3 balloons. How many balloons are there?",
             "options": ["(a) 2", "(b) 3"], "answer": "(b) 3", "marks": 1}]}})
        rep = run_checks(p, requested_count=1, total_marks=1)
        self.assertIn("D7", [f["id"] for f in rep["hard_failures"]])

    def test_a_legitimate_named_target_is_not_self_answering(self):
        """'mark the level at 300 mL' names its target; the child still must produce it."""
        p = paper(unseen={"objective": {"Fill in the Blanks": [
            {"question": "Mark the water level at 300 mL on the beaker scale.",
             "answer": "300 mL line", "marks": 1}]}})
        rep = run_checks(p, requested_count=1, total_marks=1)
        self.assertNotIn("D7", [f["id"] for f in rep["hard_failures"]])

    def test_short_stem_self_answer_is_still_caught(self):
        """The guard must not early-out on short questions (the LP skill's own bug)."""
        p = paper(unseen={"objective": {"Fill in the Blanks": [
            {"question": "There are 5 cats. How many cats?", "answer": "5", "marks": 1}]}})
        rep = run_checks(p, requested_count=1, total_marks=1)
        self.assertIn("D7", [f["id"] for f in rep["hard_failures"]])

    def test_requested_count_mismatch_is_soft_not_hard(self):
        """Length is a judged band (A5e), so code reports it without failing the paper."""
        rep = run_checks(paper(), requested_count=20, total_marks=3)
        self.assertTrue(rep["hard_pass"])
        self.assertIn("D8", [f["id"] for f in rep["soft_failures"]])

    def test_counts_items_as_a_child_sees_them(self):
        p = paper(unseen={"subjective": {"Word Meanings": [
            {"question": "Write the meanings.", "words": ["a", "b", "c", "d", "e", "f"],
             "answer": "…", "marks": 6}]}})
        rep = run_checks(p, requested_count=1, total_marks=6)
        self.assertEqual(rep["item_count"], 1)
        self.assertEqual(rep["word_units"], 6)

    def test_answer_key_gap_is_reported(self):
        p = paper()
        del p["unseen"]["objective"]["True/False"][0]["answer"]
        rep = run_checks(p, requested_count=3, total_marks=3)
        self.assertIn("D9", [f["id"] for f in rep["soft_failures"]])


class Gate(unittest.TestCase):
    def _score(self, **over):
        s = {"qa_hard_pass": True, "composite_pct": 95.0, "judge": "google/gemini-3.1-pro-preview",
             "review": {"criteria": [{"checks": [{"id": "A1a", "rating": 4}]}]}}
        s.update(over)
        return s

    def test_clean_score_passes(self):
        self.assertTrue(gate(self._score())["pass"])

    def test_hard_qa_failure_fails_whatever_the_score(self):
        g = gate(self._score(qa_hard_pass=False, qa_hard_failures=[{"id": "D1", "name": "picture"}],
                             composite_pct=99.0))
        self.assertFalse(g["pass"])
        self.assertTrue(any("hard-QA" in r for r in g["reasons"]))

    def test_any_rating_of_1_fails(self):
        g = gate(self._score(review={"criteria": [{"checks": [{"id": "A1b", "rating": 1}]}]}))
        self.assertFalse(g["pass"])
        self.assertTrue(any("A1b" in r for r in g["reasons"]))

    def test_a_blocking_check_rated_2_fails_immediately(self):
        """Answerability and sensitive content have no tolerance — a 2 is a defect that reaches a child."""
        g = gate(self._score(review={"criteria": [{"checks": [{"id": "A5a", "rating": 2}]}]}))
        self.assertFalse(g["pass"])

    def test_two_non_blocking_twos_are_tolerated_three_are_not(self):
        two = [{"id": "A2a", "rating": 2}, {"id": "A2b", "rating": 2}]
        self.assertTrue(gate(self._score(review={"criteria": [{"checks": two}]}))["pass"])
        three = two + [{"id": "A3a", "rating": 2}]
        self.assertFalse(gate(self._score(review={"criteria": [{"checks": three}]}))["pass"])

    def test_composite_below_the_bar_fails(self):
        self.assertFalse(gate(self._score(composite_pct=80.0))["pass"])

    def test_judge_bias_shifts_the_bar(self):
        """Inherited from the LP gate: a lenient judge faces a higher bar for the same standard."""
        lenient = self._score(judge="anthropic/claude-sonnet-5", composite_pct=93.0)
        strict = self._score(judge="google/gemini-3.1-pro-preview", composite_pct=93.0)
        self.assertFalse(gate(lenient)["pass"])
        self.assertTrue(gate(strict)["pass"])

    def test_not_assessable_checks_never_count_as_low(self):
        g = gate(self._score(review={"criteria": [{"checks": [
            {"id": "A1d", "rating": None, "notAssessable": True}]}]}))
        self.assertTrue(g["pass"], g["reasons"])


class Scoring(unittest.TestCase):
    def test_percentage_excludes_not_assessable_from_the_denominator(self):
        from score import tally
        review = {"criteria": [{"checks": [
            {"id": "A1a", "rating": 4},
            {"id": "A1d", "rating": None, "notAssessable": True, "contextMissing": "book_content"},
        ]}]}
        total, denom, flags = tally(review)
        self.assertEqual((total, denom), (4, 4))
        self.assertTrue(any("not-assessable" in f for f in flags))

    def test_an_unjustified_not_assessable_reverts_to_absent(self):
        """The LP skill's SP-068 lesson: the escape hatch must fail closed."""
        from score import tally
        review = {"criteria": [{"checks": [
            {"id": "A1d", "rating": None, "notAssessable": True},   # no contextMissing given
        ]}]}
        total, denom, flags = tally(review)
        self.assertEqual((total, denom), (1, 4))
        self.assertTrue(any("unjustified" in f for f in flags))

    def test_item_ratings_average_into_one_check_score(self):
        from score import tally
        review = {"criteria": [{"checks": [
            {"id": "A1a", "items": [{"n": 1, "rating": 4}, {"n": 2, "rating": 2}]},
        ]}]}
        total, denom, flags = tally(review)
        self.assertEqual(denom, 4)
        self.assertEqual(total, 3)          # mean of 4 and 2
        self.assertTrue(any("A1a#2" in f for f in flags))   # the weak item is named


if __name__ == "__main__":
    unittest.main()
