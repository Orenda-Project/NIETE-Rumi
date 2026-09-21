# -*- coding: utf-8 -*-
"""A filled slot is not an answered question.

These are the cases that decide whether bd-ieesv actually changes anything.
The legacy plans teachers ask to have back carried an 'Ans' line under every
'Ask', and 91% of those lines were the vocabulary below. If the checker
accepts them, the revamp ships the same product with a new schema.
"""
import unittest

import answerwords


class RejectsTheLegacyPlaceholder(unittest.TestCase):

    def test_let_the_children_answer_is_not_an_answer(self):
        # 466 of the legacy plans' 1,780 'Ans' steps said exactly this.
        self.assertFalse(answerwords.is_answer(u"Let the children answer."))

    def test_take_childrens_responses_is_not_an_answer(self):
        self.assertFalse(answerwords.is_answer(u"Take children's responses."))

    def test_an_empty_slot_is_not_an_answer(self):
        self.assertFalse(answerwords.is_answer(u"  "))

    def test_a_missing_slot_is_not_an_answer(self):
        self.assertFalse(answerwords.is_answer(None))

    def test_a_dash_is_not_an_answer(self):
        # 34 of the 56 dark `problems[]` slots held an empty string and 22
        # held nothing at all; a typographic stand-in is the same gesture.
        self.assertFalse(answerwords.is_answer(u"—"))


class AcceptsTheHonestOnes(unittest.TestCase):

    def test_a_worked_answer_is_an_answer(self):
        self.assertTrue(answerwords.is_answer(u"24 + 18 = 42"))

    def test_answers_vary_IS_an_answer_when_it_says_what_to_accept(self):
        # Rule (3) of bd-ieesv. An honest slot beats an empty one.
        self.assertTrue(answerwords.is_answer(
            u"answers vary — accept any fruit named with a colour word."))

    def test_a_bare_answers_vary_with_no_criterion_is_still_dark(self):
        self.assertFalse(answerwords.is_answer(u"answers vary"))

    def test_a_vary_phrase_with_a_token_tail_is_still_dark(self):
        # 'answers vary - yes' clears a presence check and a naive
        # 'does it say more than the phrase' check, and tells the teacher
        # nothing. MIN_CRITERION is what separates the two.
        self.assertFalse(answerwords.is_answer(u"answers vary - yes"))

    def test_an_urdu_vary_phrase_is_read_too(self):
        self.assertFalse(answerwords.is_answer(u"جواب مختلف"))

    def test_a_wrapped_slot_reads_the_same_as_a_short_one(self):
        self.assertFalse(answerwords.is_answer(u"Take children's\n  responses."))


if __name__ == "__main__":
    unittest.main()
