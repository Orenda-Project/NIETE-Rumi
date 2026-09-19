"""The free check that runs BEFORE the paid call, not after it.

The engine refusing to render an assessment as a lesson plan (d0_route) stops
the wrong OBJECT. It cannot stop a worksheet that is the right object and the
wrong shape — six questions, no mark badges, an answer key with nothing in it,
a picture asking a six-year-old to count nine things at once. Every one of
those is only discoverable after generation unless something checks the
envelope first, and the skill says so in as many words: mirror every engine
refusal in the free pre-render lint.

So this runs on the authored JSON, costs nothing, and is the reason a bad
worksheet never reaches a paid call. Verified red on a known-bad envelope and
green on the known-good one at the bottom of the file.
"""
import unittest

import wslint


def q(i, type="short", **kw):
    d = {"id": "q%d" % i, "type": type, "marks": 2,
         "childText": "Write your favourite food.", "space": "lines",
         "answer": "any food word spelled phonetically",
         "marking": "1 mark for a word, 1 for the initial sound",
         "common_errors": ["draws instead of writing"]}
    d.update(kw)
    return d


TYPES = ["mcq", "fill", "match", "short", "draw", "compute", "word", "short"]


def good(n=8, **kw):
    qs = [q(i + 1, type=TYPES[i % len(TYPES)],
            options=["a", "b"] if TYPES[i % len(TYPES)] == "mcq" else None,
            pairs=[{"left": "Cat", "right": "Bat"}]
                  if TYPES[i % len(TYPES)] == "match" else None)
          for i in range(n)]
    g = {"title": "Chapter 1 Worksheet", "instructions": "Do your best work.",
         "questions": qs, "total_marks": sum(x["marks"] for x in qs)}
    g.update(kw)
    return {"lesson_id": "grade_1_english_ch1_seg995",
            "lp_type": "assessment", "generated": g}


def codes(env, segment=None):
    return sorted({f["id"] for f in wslint.findings(env, segment)})


class TheKnownGoodEnvelopePasses(unittest.TestCase):
    """A lint that fires on everything is a lint nobody runs."""

    def test_it_reports_nothing(self):
        self.assertEqual(wslint.findings(good()), [])

    def test_twelve_questions_is_still_fine(self):
        self.assertEqual(codes(good(12)), [])

    def test_clean_means_ok(self):
        self.assertTrue(wslint.ok(good()))


class ItOnlyJudgesWorksheets(unittest.TestCase):

    def test_a_content_lesson_is_the_wrong_artefact_for_this_lint(self):
        env = dict(good(), lp_type="content")
        self.assertIn("WS-01", codes(env))

    def test_the_segment_can_be_what_declares_it_an_assessment(self):
        env = dict(good(), lp_type=None)
        self.assertEqual(codes(env, {"skill_type": "assessment"}), [])


class TheShapeOfTheSheet(unittest.TestCase):
    """8-12 questions with variety, and marks that add up."""

    def test_seven_questions_is_too_few(self):
        self.assertIn("WS-02", codes(good(7)))

    def test_thirteen_questions_is_too_many(self):
        self.assertIn("WS-02", codes(good(13)))

    def test_eight_of_the_same_type_is_not_variety(self):
        env = good()
        for x in env["generated"]["questions"]:
            x["type"] = "short"
            x.pop("options", None)
            x.pop("pairs", None)
        self.assertIn("WS-03", codes(env))

    def test_a_type_outside_the_closed_set_is_named(self):
        env = good()
        env["generated"]["questions"][0]["type"] = "essay"
        self.assertIn("WS-04", codes(env))

    def test_the_finding_says_which_question_is_wrong(self):
        env = good()
        env["generated"]["questions"][2]["type"] = "essay"
        self.assertTrue(any("q3" in f["name"]
                            for f in wslint.findings(env)))


class EveryQuestionCarriesItsMarks(unittest.TestCase):
    """The badge is the child's own map of where the effort goes."""

    def test_a_question_with_no_marks_is_flagged(self):
        env = good()
        del env["generated"]["questions"][1]["marks"]
        self.assertIn("WS-05", codes(env))

    def test_marks_present_but_null_counts_as_absent(self):
        # The skill names this case. `"marks": null` is not zero marks and it
        # is not "marks handled elsewhere" -- it is a missing badge.
        env = good()
        env["generated"]["questions"][1]["marks"] = None
        self.assertIn("WS-05", codes(env))

    def test_zero_marks_is_not_a_question(self):
        env = good()
        env["generated"]["questions"][1]["marks"] = 0
        self.assertIn("WS-05", codes(env))

    def test_a_total_that_does_not_add_up_is_flagged(self):
        env = good()
        env["generated"]["total_marks"] = 99
        self.assertIn("WS-06", codes(env))

    def test_a_missing_total_is_flagged(self):
        env = good()
        env["generated"].pop("total_marks")
        self.assertIn("WS-06", codes(env))


class WhatTheChildReadsAndWhatTheTeacherReads(unittest.TestCase):
    """childText-vs-directive separation, checked rather than hoped for."""

    def test_a_question_with_nothing_for_the_child_to_read_is_flagged(self):
        env = good()
        env["generated"]["questions"][0]["childText"] = ""
        self.assertIn("WS-07", codes(env))

    def test_a_teacher_directive_printed_as_child_text_is_flagged(self):
        env = good()
        env["generated"]["questions"][0]["childText"] = (
            "Ask the class to circle the odd one out.")
        self.assertIn("WS-08", codes(env))

    def test_the_same_words_are_fine_in_the_directive_field(self):
        env = good()
        env["generated"]["questions"][0]["directive"] = (
            "Ask the class to work alone for this one.")
        self.assertEqual(codes(env), [])

    def test_a_question_the_child_writes_in_needs_somewhere_to_write(self):
        env = good()
        env["generated"]["questions"][3].pop("space")
        self.assertIn("WS-09", codes(env))

    def test_an_mcq_does_not_need_writing_space(self):
        env = good()
        mcq = [x for x in env["generated"]["questions"] if x["type"] == "mcq"][0]
        mcq.pop("space", None)
        self.assertNotIn("WS-09", codes(env))


class TheAnswerKeyIsPartOfTheSameSource(unittest.TestCase):
    """One authored file, two printed artefacts. The key cannot go missing."""

    def test_a_question_with_no_answer_is_flagged(self):
        env = good()
        env["generated"]["questions"][4]["answer"] = None
        self.assertIn("WS-10", codes(env))

    def test_an_open_personal_question_legitimately_has_no_single_answer(self):
        # "Write your name here" has no key and never will. SP-005.
        env = good()
        env["generated"]["questions"][4].update(
            {"answer": None, "open_personal": True, "common_errors": [],
             "model_solution": "Pinky"})
        self.assertEqual(codes(env), [])

    def test_an_open_personal_question_still_needs_a_model_answer(self):
        env = good()
        env["generated"]["questions"][4].update(
            {"answer": None, "open_personal": True, "common_errors": []})
        self.assertIn("WS-10", codes(env))

    def test_marking_guidance_is_not_optional(self):
        env = good()
        env["generated"]["questions"][2]["marking"] = None
        self.assertIn("WS-11", codes(env))

    def test_a_key_with_no_common_errors_is_a_key_nobody_learns_from(self):
        env = good()
        env["generated"]["questions"][2]["common_errors"] = []
        self.assertIn("WS-12", codes(env))


class WhatAChildCanActuallyCount(unittest.TestCase):
    """≤4 per group, and the count said out loud."""

    def test_nine_objects_in_one_group_is_flagged(self):
        env = good()
        env["generated"]["questions"][0]["illustration"] = {
            "ascii": "nine apples", "groups": [9]}
        self.assertIn("WS-13", codes(env))

    def test_nine_as_a_four_and_a_five_is_still_flagged(self):
        env = good()
        env["generated"]["questions"][0]["illustration"] = {
            "ascii": "apples", "groups": [4, 5]}
        self.assertIn("WS-13", codes(env))

    def test_nine_as_four_four_and_one_is_fine(self):
        env = good()
        env["generated"]["questions"][0]["illustration"] = {
            "ascii": "o o o o | o o o o | o", "groups": [4, 4, 1]}
        self.assertNotIn("WS-13", codes(env))

    def test_an_illustration_with_no_ascii_count_is_flagged(self):
        env = good()
        env["generated"]["questions"][0]["illustration"] = {"groups": [3]}
        self.assertIn("WS-14", codes(env))


class TheLintIsCheapAndSelfContained(unittest.TestCase):

    def test_it_reaches_nothing_but_the_routing_rule(self):
        with open("wslint.py") as fh:
            imports = [l for l in fh.read().splitlines()
                       if l.startswith(("import ", "from "))]
        self.assertEqual(imports, ["import d0_route"])


if __name__ == "__main__":
    unittest.main()


class AQuestionMustBeAnswerable(unittest.TestCase):
    """Shape rules that are about the question, not about the key."""

    def test_an_mcq_with_one_option_is_not_a_choice(self):
        env = good()
        mcq = [x for x in env["generated"]["questions"] if x["type"] == "mcq"][0]
        mcq["options"] = ["a"]
        self.assertIn("WS-15", codes(env))

    def test_a_match_with_no_pairs_is_flagged(self):
        env = good()
        m = [x for x in env["generated"]["questions"] if x["type"] == "match"][0]
        m["pairs"] = []
        self.assertIn("WS-16", codes(env))

    def test_five_pairs_is_fine_because_the_book_has_five(self):
        # Chapter 1's rhyming exercise: Cat-Bat (the example), Mat-Pat,
        # Run-Fun, Man-Fan, Ball-Tall. The "groups of 4" rule is about
        # countable objects in a PICTURE and capping pairs with it would force
        # a worksheet that contradicts the page.
        env = good()
        m = [x for x in env["generated"]["questions"] if x["type"] == "match"][0]
        m["pairs"] = [{"left": l, "right": r} for l, r in
                      [("Cat", "Bat"), ("Mat", "Pat"), ("Run", "Fun"),
                       ("Man", "Fan"), ("Ball", "Tall")]]
        self.assertEqual(codes(env), [])

    def test_seven_options_is_fine_because_there_are_seven_days(self):
        env = good()
        mcq = [x for x in env["generated"]["questions"] if x["type"] == "mcq"][0]
        mcq["options"] = ["Monday", "Tuesday", "Wednesday", "Thursday",
                          "Friday", "Saturday", "Sunday"]
        self.assertEqual(codes(env), [])
