"""The half of a worksheet a lint cannot refuse but a gate should still weigh.

`wslint` answers "may this render?" — eight to twelve questions, a mark badge
on each, an answer for every closed one. Those are refusals: a sheet failing
any of them is broken, and the engine stops.

This is the other question: "is it any good?" A sheet can clear every WS rule
and still be a poor paper. Ten questions of three kinds when the child could
have shown six. An mcq whose answer is not among its own options, which a
teacher discovers at the front of a class. The same sentence of common errors
copied under all ten questions, which is a key that tells a teacher nothing.
A drawing question offering ruled lines. Instructions written at an adult's
sentence length for a six-year-old who is being assessed on reading them.

None of those should stop a render, and all of them should cost marks. That is
what a soft score is for, and until now a 995 had none — `soft_pct` came back
None, `S1` said so, and the composite could not form (bd-nr311, from bd-4p01d).

Two things this suite deliberately does NOT do. It does not re-ask a WS rule:
the total-vs-badges sum, the three-type floor and answer coverage are already
refusals, and scoring them twice would make a broken sheet look doubly broken
while telling nobody anything new. And it does not guess a grade — where the
grade is unknown the reading band is reported as NOT MEASURED rather than
passed, because an instruction is only long or short relative to who reads it.
"""
import unittest

import wssoft

PROMPTS = ["Write your favourite food.",
           "Circle the picture that starts with m.",
           "Join each word to the one that rhymes.",
           "Finish the sentence about your family.",
           "Draw the animal you like best.",
           "Count the apples and write the number.",
           "Write the days of the week in order.",
           "Write how the child in the picture feels."]

TYPES = ["mcq", "fill", "match", "short", "draw", "compute", "word", "short"]


def q(i, type="short", **kw):
    d = {"id": "q%d" % i, "type": type, "marks": 2,
         "childText": PROMPTS[(i - 1) % len(PROMPTS)],
         "space": "box" if type == "draw" else "lines",
         "answer": "the answer to question %d" % i,
         "marking": "1 mark for a word, 1 for the initial sound",
         "common_errors": ["the error children make on question %d" % i]}
    d.update(kw)
    return d


def sheet(n=8, grade=1, **kw):
    """A realistic clean worksheet: varied, keyed, illustrated, readable."""
    qs = []
    for i in range(n):
        t = TYPES[i % len(TYPES)]
        extra = {}
        if t == "mcq":
            extra = {"options": ["a", "b"], "answer": "a", "space": "none"}
        elif t == "match":
            extra = {"pairs": [{"left": "Cat", "right": "Bat"}], "space": "none"}
        elif i == 1:
            extra = {"illustration": {"ascii": "[apple][apple]", "groups": [2]}}
        qs.append(q(i + 1, type=t, **extra))
    g = {"title": "Chapter 1 Worksheet", "questions": qs,
         "total_marks": sum(x["marks"] for x in qs)}
    g.update(kw)
    return {"lesson_id": "grade_%d_english_ch1_seg995" % grade,
            "lp_type": "assessment", "generated": g}


def run(env, segment=None):
    return wssoft.checks(env, segment)


def codes(env, segment=None):
    """The soft checks this sheet FAILED."""
    return sorted(c["id"] for c in run(env, segment)["checks"] if not c["pass"])


def edit(env, i, **kw):
    env["generated"]["questions"][i].update(kw)
    return env


class TheShapeOfTheAnswer(unittest.TestCase):
    """Whatever reads `qa_checks` must be able to read this unchanged."""

    def test_a_clean_sheet_scores_a_hundred(self):
        self.assertEqual(run(sheet())["soft_pct"], 100.0)

    def test_every_check_carries_the_fields_the_lesson_suite_carries(self):
        for c in run(sheet())["checks"]:
            self.assertEqual(sorted(c), ["detail", "hard", "id", "name", "pass"])

    def test_nothing_here_is_hard(self):
        # Refusals live in wslint. A soft check that could fail a render would
        # be a second, quieter engine guard — and the one place that decides
        # is `worksheet_findings`.
        self.assertTrue(all(c["hard"] is False for c in run(sheet())["checks"]))

    def test_the_score_is_the_share_of_checks_that_passed(self):
        r = run(edit(sheet(), 0, options=["a", "b"], answer="z"))
        passed = sum(1 for c in r["checks"] if c["pass"])
        self.assertEqual(r["soft_pct"],
                         round(100.0 * passed / len(r["checks"]), 1))


class VarietyAndProduction(unittest.TestCase):
    """Three kinds is the floor a render needs, not the paper a child deserves."""

    def test_three_kinds_clears_the_lint_and_still_loses_a_soft_mark(self):
        env = sheet()
        for i, t in enumerate(["mcq", "fill", "short"] * 3):
            if i < len(env["generated"]["questions"]):
                edit(env, i, type=t)
        self.assertIn("WSS-01", codes(env))

    def test_a_sheet_of_only_recognition_questions_is_flagged(self):
        # Circling and joining show a child can pick. Nothing on the sheet
        # asks them to produce anything, so nothing shows what they can make.
        env = sheet()
        for i in range(len(env["generated"]["questions"])):
            edit(env, i, type="mcq", options=["a", "b"], answer="a",
                 space="none")
        self.assertIn("WSS-02", codes(env))

    def test_the_clean_sheet_asks_for_production(self):
        self.assertNotIn("WSS-02", codes(sheet()))


class TheAnswerKeyReadsBack(unittest.TestCase):
    """A key is read at the front of a class, by someone who cannot pause."""

    def test_an_mcq_answer_that_is_not_one_of_its_options_is_caught(self):
        # wslint checks the mcq HAS options and the question HAS an answer.
        # Neither notices that the two do not meet.
        self.assertIn("WSS-03", codes(edit(sheet(), 0, answer="tree")))

    def test_an_mcq_answer_matching_an_option_is_fine(self):
        self.assertNotIn("WSS-03", codes(edit(sheet(), 0, answer="b")))

    def test_the_match_is_not_case_sensitive(self):
        # "Tree" against option "tree" is a transcription difference, not a
        # wrong key, and failing it would teach authors to distrust the check.
        self.assertNotIn("WSS-03",
                         codes(edit(sheet(), 0, options=["Tree", "b"],
                                    answer="tree")))

    def test_one_answer_repeated_down_the_key_is_flagged(self):
        env = sheet()
        for i in range(len(env["generated"]["questions"])):
            edit(env, i, answer="yes")
        self.assertIn("WSS-04", codes(env))

    def test_a_couple_of_repeats_are_normal(self):
        # Two questions whose answer is genuinely "yes" is a paper, not a bug.
        env = sheet()
        edit(env, 2, answer="yes")
        edit(env, 3, answer="yes")
        self.assertNotIn("WSS-04", codes(env))

    def test_the_same_common_error_under_every_question_is_flagged(self):
        env = sheet()
        for i in range(len(env["generated"]["questions"])):
            edit(env, i, common_errors=["writes too slowly"])
        self.assertIn("WSS-05", codes(env))

    def test_distinct_common_errors_pass(self):
        self.assertNotIn("WSS-05", codes(sheet()))


class RoomAndReadability(unittest.TestCase):

    def test_a_drawing_question_offered_ruled_lines_is_flagged(self):
        # wslint asks whether a space was DECLARED. This asks whether the
        # space declared is the one the answer needs.
        self.assertIn("WSS-06", codes(edit(sheet(), 4, space="lines")))

    def test_a_drawing_question_with_a_box_is_fine(self):
        self.assertNotIn("WSS-06", codes(sheet()))

    def test_an_instruction_too_long_for_the_grade_is_flagged(self):
        env = edit(sheet(), 0, childText=(
            "Look carefully at each of the pictures printed below and then "
            "write in the space provided the word which you think best "
            "describes what the child in that picture is doing."))
        self.assertIn("WSS-07", codes(env))

    def test_the_same_instruction_is_fine_for_grade_five(self):
        long = ("Look carefully at each picture below and write the word "
                "that best describes what the child is doing.")
        self.assertNotIn("WSS-07",
                         codes(edit(sheet(grade=5), 0, childText=long)))

    def test_only_the_instruction_is_measured_not_the_items(self):
        # The items under an instruction are the child's work -- a list of
        # seven days, a row of letters. Counting them as prose would fail
        # every well-made sheet.
        env = edit(sheet(), 0, childText=(
            "Write the missing letter.\n\n1. n a __ e\n2. s c h o __ l\n"
            "3. f a m __ l y\n4. c l a s __\n5. t e a c h e __"))
        self.assertNotIn("WSS-07", codes(env))


class PicturesOnAPrimarySheet(unittest.TestCase):
    """A six-year-old reads pictures before words."""

    def test_a_grade_one_sheet_with_no_illustration_is_flagged(self):
        env = sheet()
        for qn in env["generated"]["questions"]:
            qn.pop("illustration", None)
        self.assertIn("WSS-08", codes(env))

    def test_one_illustration_is_enough(self):
        self.assertNotIn("WSS-08", codes(sheet()))

    def test_the_rule_does_not_apply_above_grade_three(self):
        env = sheet(grade=5)
        for qn in env["generated"]["questions"]:
            qn.pop("illustration", None)
        r = run(env)
        self.assertNotIn("WSS-08", [c["id"] for c in r["checks"]])
        self.assertNotIn("WSS-08", r["not_checked"])


class WhatItCouldNotMeasure(unittest.TestCase):
    """Dark stages stay dark: unmeasured is not passed and is not failed."""

    def test_an_unknown_grade_leaves_the_reading_band_unmeasured(self):
        env = sheet()
        env["lesson_id"] = "seg995"
        r = wssoft.checks(env, None)
        self.assertIn("WSS-07", r["not_checked"])
        self.assertNotIn("WSS-07", [c["id"] for c in r["checks"]])

    def test_an_unmeasured_check_does_not_drag_the_score_down(self):
        env = sheet()
        env["lesson_id"] = "seg995"
        self.assertEqual(wssoft.checks(env, None)["soft_pct"], 100.0)

    def test_the_segment_can_supply_the_grade(self):
        env = sheet()
        env["lesson_id"] = "seg995"
        self.assertEqual(wssoft.checks(env, {"grade": 1})["not_checked"], [])

    def test_a_sheet_with_no_questions_is_not_scored_at_all(self):
        # wslint already refuses it. Reporting 0.0 here would put a number on
        # an artefact nothing looked at.
        env = sheet()
        env["generated"]["questions"] = []
        r = run(env)
        self.assertIsNone(r["soft_pct"])


class WhereTheGradeComesFrom(unittest.TestCase):

    def test_the_segment_wins_over_the_lesson_id(self):
        self.assertEqual(wssoft.grade_of(sheet(grade=1), {"grade": 4}), 4)

    def test_the_lesson_id_is_read_when_the_segment_is_silent(self):
        self.assertEqual(wssoft.grade_of(sheet(grade=3), {}), 3)

    def test_provenance_is_read_when_there_is_no_lesson_id(self):
        env = {"doc": {"provenance": {"grade": 2}}}
        self.assertEqual(wssoft.grade_of(env, None), 2)

    def test_an_unknown_grade_is_none_rather_than_a_default(self):
        self.assertIsNone(wssoft.grade_of({"lesson_id": "seg995"}, None))


if __name__ == "__main__":
    unittest.main()
