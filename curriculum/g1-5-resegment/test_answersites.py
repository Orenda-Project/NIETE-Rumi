# -*- coding: utf-8 -*-
"""Where the lesson asks, and where nobody has said whether it asks.

Two halves of one contract. `questions()` reads an explicit allowlist of
field paths, so these tests pin what counts as a question put to the class
and what is the teacher talking to herself. `coverage()` guards the list
against the schema growing past it -- the one way the answer check could
pass a lesson it should have failed is a new question field nobody
classified, and a silent pass is exactly what bd-ieesv is about.
"""
import unittest

import answersites


def body(**kw):
    """A minimal Stage-C body; tests add only the field under test."""
    b = {"segment_id": "grade_2_math_ch1_seg1", "steps": [], "problems": []}
    b.update(kw)
    return b


class FindsTheQuestions(unittest.TestCase):

    def test_a_question_inside_a_say_line_is_put_to_the_class(self):
        b = body(steps=[{"say": u"Look at the tens column. How many tens?"}])
        self.assertEqual([a["text"] for a in answersites.questions(b)],
                         [u"How many tens?"])

    def test_an_urdu_question_mark_counts(self):
        # U+061F. Four of the five books are Urdu-bearing; a checker that
        # only knows '?' would pass every Urdu lesson silently.
        b = body(steps=[{"say": u"یہ کیا ہے؟"}])
        self.assertEqual(len(answersites.questions(b)), 1)

    def test_a_statement_is_not_a_question(self):
        b = body(steps=[{"say": u"Write the number 42 on the board."}])
        self.assertEqual(answersites.questions(b), [])

    def test_the_teachers_own_reflection_is_not_put_to_the_class(self):
        # coachingReflection is the teacher asking herself. Counting it would
        # demand an answer to 'did my pacing work?', which is not a thing the
        # page truth can ground.
        b = body(coachingReflection=u"Did every child get a turn?")
        self.assertEqual(answersites.questions(b), [])

    def test_the_self_prediction_line_is_rhetorical(self):
        # 'Will you get it right?' is rule 24's self-prediction prompt. It is
        # asked of the class and has no answer the teacher could mark, so
        # counting it would force an author to invent one.
        b = body(exitTicket={"task": u"What is 24 + 18?",
                             "answer": u"42",
                             "self_prediction": u"Will you get it right?"})
        self.assertEqual([a["text"] for a in answersites.questions(b)],
                         [u"What is 24 + 18?"])

    def test_several_questions_in_one_prose_field_are_found_separately(self):
        b = body(boardWork={"content": u"What is 3 x 4? And 4 x 3?"})
        self.assertEqual(len(answersites.questions(b)), 2)


class SurfacesWhatNobodyClassified(unittest.TestCase):
    """The allowlist is the whole contract, so it must not rot in silence.

    `questions()` reads an explicit list of sites. A field added to the
    schema later is neither checked nor complained about, which is the one
    way this module could pass a lesson it should have failed. `coverage()`
    walks the body generically and names any path holding a question mark
    that neither list knows, so the gap shows up as a line to read rather
    than as a silent pass.
    """

    def test_a_field_on_the_class_facing_list_is_not_surfaced(self):
        b = body(steps=[{"say": u"How many tens?"}])
        self.assertEqual(answersites.coverage(b), [])

    def test_a_field_on_the_not_asked_list_is_not_surfaced(self):
        b = body(coachingReflection=u"Did every child get a turn?")
        self.assertEqual(answersites.coverage(b), [])

    def test_a_field_nobody_has_classified_is_surfaced(self):
        b = body(reviewPrompt=u"What did we learn yesterday?")
        self.assertEqual(answersites.coverage(b), ["reviewPrompt"])

    def test_an_unclassified_field_with_no_question_is_left_alone(self):
        b = body(reviewPrompt=u"Recall yesterday's lesson.")
        self.assertEqual(answersites.coverage(b), [])

    def test_partner_activity_is_excluded_by_prefix(self):
        # Child-to-child dialogue frames. The child asks the question and the
        # other child answers it; there is nothing for the teacher to mark.
        b = body(partnerActivity={"dialogueFrameA": u"How many do you have?"})
        self.assertEqual(answersites.coverage(b), [])

    def test_a_nested_unclassified_field_carries_its_path(self):
        b = body(steps=[{"probe": u"Why does that work?"}])
        self.assertEqual(answersites.coverage(b), ["steps[].probe"])

if __name__ == "__main__":
    unittest.main()
