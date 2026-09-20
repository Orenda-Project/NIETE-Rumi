"""What the first Grade 3 period sent back, on 20 Sep 2026.

`test_lessonrules.py` carries the grade_1_english batch and the first two
Number Fluency periods; this file carries the findings that only appeared once
the pilot crossed into Grade 3, and it is separate so neither file passes 300
lines.

grade_3_math_ch1_seg801 was the first of the 36 pilot periods to fail the
production gate -- composite 95.3, three checks rated 2 where two are
tolerated. Fifteen Grade 2 periods had passed before it, so the interesting
thing is what CHANGED, and both changes are properties of the pages rather
than of the author:

  6B  x1  printed pages 4-5 of grade_3_math carry no characters at all. Every
          Grade 2 period had Bunty and Babloo printed on the page and named
          them without thinking about it; the moment the page went quiet, the
          lesson had no child's name anywhere in it and the rubric read that
          as no representation -- "the lesson uses no student names or
          characters at all ... only ability diversity appears".
  7A  x1  the extension prompt asked which number sits in NO column while its
          own key said 8264 "is even and nothing else", which names a column.
  7B  x1  the same contradiction, scored again as content accuracy: a child
          taught that answer is taught a wrong result for the book's own
          Discovery Playground table. The scope declaration's claim that two
          numbers were "the only numbers on these pages with a zero sitting
          inside them" was false in the same lesson -- page 4's 302 and 802
          were in the warm-up.

grade_3_math_ch2_seg801, the SECOND Grade 3 period, then failed on a
different trio -- 6C, 7A, 7B -- and neither failure repeated the first:

  6C  x1  the judge granted that the contexts were fully local (rupees, clay
          pots, handwoven shawls, a mela stall, slates and straws) and that
          the names were balanced, and still rated Student Voice 2, because
          "students are never invited to bring their own experience into the
          lesson: all talk beats are mathematical". Fixing 6B bought nothing
          here. Local context and student voice are scored separately.
  7A  x1  the deliberate error was mis-computed. Writing 10 into the tens box
          of 3456 + 1153 leaves the boxes reading 4, 5, 1, 0, 9 -- 45,109, not
          the 46,109 the lesson announced in three places.
  7B  x1  the same figure, scored again as content accuracy: the teacher
          would read aloud a number the board does not show, in the one
          demonstration the period is built on.

The tests assert the rules are STATED. Obedience is the judge's question.
"""
import unittest

import lessonrules


class WhatTheFirstGradeThreePeriodAdded(unittest.TestCase):

    def one(self, phrase):
        # A code is not a key -- 7A and 7B each name several rules. A rule is
        # found by something only that rule says.
        hits = [r for r in lessonrules.RULES if phrase in r.lower()]
        self.assertEqual(len(hits), 1, phrase)
        return hits[0]

    def test_a_quiet_page_still_owes_the_class_named_children(self):
        r = self.one("named children")
        self.assertIn("[6B]", r)
        self.assertIn("hookcharacters", r.lower())

    def test_the_names_go_where_they_cost_no_word_budget(self):
        # The capped surfaces are big_idea, key_points and practice. The pair
        # roles and the problems prompts are the cheap places to put a name.
        r = self.one("named children")
        self.assertIn("partneractivity", r.lower())
        self.assertIn("problems", r.lower())

    def test_the_names_do_not_licence_changing_the_books_numbers(self):
        self.assertIn("as the page prints them", self.one("named children"))

    def test_the_key_is_written_before_the_prompt(self):
        r = self.one("answer key first")
        self.assertIn("[7B]", r)
        self.assertIn("prompt", r.lower())

    def test_an_only_claim_is_checked_against_every_page_of_the_segment(self):
        r = self.one("answer key first")
        self.assertIn("'the only", r.lower())
        self.assertIn("every page", r.lower())

    def test_local_context_is_not_the_same_thing_as_student_voice(self):
        r = self.one("student voice is the child's")
        self.assertIn("scores them separately", r)

    def test_one_beat_asks_for_the_childs_own_life(self):
        r = self.one("child's own life")
        self.assertIn("not", r.lower())
        self.assertIn("fact about the numbers", r)

    def test_the_voice_beat_is_used_not_merely_collected(self):
        r = self.one("child's own life")
        self.assertIn("spare sum", r)

    def test_a_deliberate_error_is_computed_as_carefully_as_a_right_one(self):
        r = self.one("deliberate error must be worked out")
        self.assertIn("45,109", r)
        self.assertIn("46,109", r)

    def test_the_wrong_figure_is_written_identically_everywhere(self):
        r = self.one("deliberate error must be worked out")
        self.assertIn("bigIdea", r)
        self.assertIn("set-up check", r)

    # grade_3_math_ch4_seg801 passed at composite 95.8 but scored judge 91.7,
    # the weakest Grade 3 result, on 1A/1E and 5D.  Two defects, both mine and
    # both systematic.  The exit ticket asked page 75's Division by 0 box,
    # which no phase had taught -- "cold" had drifted from "a new presentation
    # of the taught skill" into "a rule the period never reached", and the
    # judge called it testing outside the stated objective.  And the success
    # criteria, in this lesson and in the twenty before it, were written as
    # marking notes for the teacher; nothing told her to say them to the
    # children, so no child could check their own work.

    def test_cold_means_a_new_presentation_not_an_untaught_rule(self):
        r = self.one("new presentation")
        self.assertIn("never reached", r)
        self.assertIn("division by 0 box", r.lower())

    def test_every_printed_rule_the_period_leans_on_is_taught_first(self):
        r = self.one("new presentation")
        self.assertIn("scaffold removed", r)

    def test_two_codes_but_one_student_facing_objective(self):
        r = self.one("two slo codes")
        self.assertIn("slo_refs", r)
        self.assertIn("warm-up retrieval", r)

    def test_the_second_code_is_named_as_retrieval_in_the_statement(self):
        r = self.one("two slo codes")
        self.assertIn("two objectives wearing one", r)

    def test_success_criteria_are_spoken_to_the_children(self):
        r = self.one("success criteria are said")
        self.assertIn("before a single slate is collected", r)
        self.assertIn("marking", r)

    def test_success_criteria_are_quoted_child_facing(self):
        r = self.one("success criteria are said")
        self.assertIn("mark their own", r)

    def test_all_three_exit_ticket_elements_are_instructed(self):
        r = self.one("success criteria are said")
        self.assertIn("self-prediction", r)
        self.assertIn("not implied", r)

    # grade_3_math_ch5_seg801 passed at composite 96.1 (judge 92.2) but was
    # marked down on 2L and 9A, both in the warm-up: it rehearsed the day's
    # own skill instead of retrieving prior learning, and it counted questions
    # rather than handling any quantity.  This is bd-br860's prior_slo gap
    # showing up as a score.

    def test_the_warm_up_opens_on_prior_learning(self):
        r = self.one("opens on prior learning")
        self.assertIn("name the prior slo", r.lower())
        self.assertIn("expected answer", r)

    def test_the_spiral_inversion_does_not_excuse_a_missing_retrieval(self):
        r = self.one("opens on prior learning")
        self.assertIn("spiral inverts", r)

    def test_a_maths_warm_up_does_number_sense_work(self):
        r = self.one("number-sense work")
        self.assertIn("magnitude", r)
        self.assertIn("calculating forbidden", r)

    def test_estimation_numbers_are_not_the_ones_the_period_tests(self):
        r = self.one("number-sense work")
        self.assertIn("without giving it away", r)

    def test_the_i_do_script_and_the_worked_example_share_one_budget(self):
        r = self.one("share one word budget")
        self.assertIn("[7A]", r)
        self.assertIn("470", r)
        self.assertIn("sums", r.lower())

    def test_the_worked_example_field_is_preparation_not_a_second_telling(self):
        r = self.one("share one word budget")
        self.assertIn("before she says it", r)


class WhatChapterElevenAdded(unittest.TestCase):
    """grade_3_math_ch11_seg801, 20 Sep 2026: PASS 98.3 with one check at 2.

    The capacity pages print Bunty and Babloo and nobody else. 6B was already
    stated -- a quiet page still owes named children -- and the lesson obeyed
    it, because the page was not quiet: it handed over two names and the
    lesson used them. The judge still rated Cultural Relevance 2, and the
    rationale says why: "representation is limited to the textbook's two male
    characters ... no female name appears anywhere in the warm-up, examples,
    partner frames or exit ticket". Naming the printed children is not the
    same thing as the class seeing itself, and a chapter whose printed cast is
    all boys cannot be fixed by borrowing a girl from another chapter -- the
    anchor forbids it. It is fixed in the teacher's instructions, where the
    real classroom supplies the names the book did not.
    """

    one = WhatTheFirstGradeThreePeriodAdded.one

    def test_the_printed_cast_being_all_one_gender_is_the_authors_problem(self):
        r = self.one("printed cast is all boys")
        self.assertIn("[6B]", r)

    def test_the_fix_is_in_the_teacher_instructions_not_a_borrowed_character(self):
        r = self.one("printed cast is all boys")
        self.assertIn("anchor forbids", r)
        self.assertIn("girls and boys", r)

    def test_naming_the_printed_children_is_not_enough_on_its_own(self):
        r = self.one("printed cast is all boys")
        self.assertIn("not the same thing as the class seeing itself", r)


if __name__ == "__main__":
    unittest.main()


class WhatChapterTwelveAdded(unittest.TestCase):
    """grade_3_math_ch12_seg801, 20 Sep 2026: PASS 95.6 with 5D rated 2.

    The exit ticket was built from the two times the class had just worked,
    which lessons 26 and 27 had done successfully -- but there the TASK
    changed (a reversal, a carry never met all period). Here the numbers and
    the operation were both the same, so nothing was cold.
    """

    one = WhatTheFirstGradeThreePeriodAdded.one

    def test_reusing_the_class_own_answers_is_not_automatically_cold(self):
        r = self.one("same numbers and the same operation")
        self.assertIn("[1E]", r)

    def test_what_makes_it_cold_is_a_changed_task_not_a_changed_number(self):
        r = self.one("same numbers and the same operation")
        self.assertIn("direction", r)

    def test_the_anchor_still_forbids_inventing_an_unseen_number(self):
        r = self.one("same numbers and the same operation")
        self.assertIn("anchor", r)
