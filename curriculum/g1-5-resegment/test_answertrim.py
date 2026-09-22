# -*- coding: utf-8 -*-
"""bd-sk3zr. A trim shortens an answer; it must not change what is true."""
import copy
import unittest

import answertrim as at


def body(*solutions):
    """A v9 body whose practice holds one problem per solution given."""
    return {"lesson_id": "grade_2_math_ch4_seg801",
            "asks": [{"ask": "Ready?", "answer": "yes, hands up"}],
            "problems": [{"prompt": "p.95 Q%d: how much change?" % k,
                          "solution": s}
                         for k, s in enumerate(solutions)]}


LONG = ("answers vary -- accept any three fruits from page 95 whose prices "
        "add up to under Rs. 50. E.g. apple + banana = 9 + 18 = Rs. 27.")
SHORT = "answers vary -- accept any three page 95 fruits under Rs. 50."


class Trim(unittest.TestCase):

    def test_a_shorter_answer_replaces_the_long_one(self):
        out = at.trim(body(LONG), {0: SHORT})
        self.assertEqual(out["problems"][0]["solution"], SHORT)

    def test_the_prompt_and_the_other_problems_are_untouched(self):
        out = at.trim(body(LONG, "Rs. 13 change"), {0: SHORT})
        self.assertEqual(out["problems"][0]["prompt"],
                         "p.95 Q0: how much change?")
        self.assertEqual(out["problems"][1]["solution"], "Rs. 13 change")

    def test_everything_outside_practice_is_untouched(self):
        out = at.trim(body(LONG), {0: SHORT})
        self.assertEqual(out["asks"], [{"ask": "Ready?",
                                        "answer": "yes, hands up"}])
        self.assertEqual(out["lesson_id"], "grade_2_math_ch4_seg801")

    def test_the_caller_s_body_is_not_mutated(self):
        src = body(LONG)
        before = copy.deepcopy(src)
        at.trim(src, {0: SHORT})
        self.assertEqual(src, before)

    def test_several_answers_trim_in_one_call(self):
        out = at.trim(body(LONG, LONG), {0: SHORT, 1: SHORT})
        self.assertEqual([p["solution"] for p in out["problems"]],
                         [SHORT, SHORT])

    # -- refusals ---------------------------------------------------------

    def test_an_answer_that_is_not_shorter_is_refused(self):
        longer = LONG + " Or pear + lime = 27 + 22 = Rs. 49."
        with self.assertRaises(at.Refused) as c:
            at.trim(body(LONG), {0: longer})
        self.assertIn("shorter", str(c.exception))

    def test_an_answer_of_the_same_length_is_refused(self):
        with self.assertRaises(at.Refused):
            at.trim(body(LONG), {0: LONG})

    def test_a_number_the_original_never_had_is_refused(self):
        with self.assertRaises(at.Refused) as c:
            at.trim(body(LONG), {0: "accept any fruits under Rs. 60 today."})
        self.assertIn("60", str(c.exception))

    def test_a_trim_that_stops_being_an_answer_is_refused(self):
        with self.assertRaises(at.Refused) as c:
            at.trim(body(LONG), {0: "answers vary"})
        self.assertIn("answer", str(c.exception).lower())

    def test_an_empty_answer_is_refused(self):
        with self.assertRaises(at.Refused):
            at.trim(body(LONG), {0: "   "})

    def test_an_index_out_of_range_is_refused(self):
        with self.assertRaises(at.Refused) as c:
            at.trim(body(LONG), {3: SHORT})
        self.assertIn("3", str(c.exception))

    def test_a_slot_with_no_answer_yet_is_refused(self):
        with self.assertRaises(at.Refused) as c:
            at.trim(body(""), {0: SHORT})
        self.assertIn("trim", str(c.exception).lower())

    def test_an_empty_patch_is_refused(self):
        with self.assertRaises(at.Refused):
            at.trim(body(LONG), {})

    def test_a_body_with_no_problems_is_refused(self):
        with self.assertRaises(at.Refused):
            at.trim({"problems": []}, {0: SHORT})

    def test_an_index_that_is_not_a_number_is_refused(self):
        with self.assertRaises(at.Refused):
            at.trim(body(LONG), {"solution": SHORT})


class Numbers(unittest.TestCase):

    def test_it_reads_every_number_in_a_sentence(self):
        self.assertEqual(at.numbers("9 + 18 = Rs. 27, p.95"),
                         set(["9", "18", "27", "95"]))

    def test_a_decimal_point_is_not_a_number_boundary(self):
        self.assertEqual(at.numbers("4:10 p.m. lasts 1 hour"),
                         set(["4", "10", "1"]))

    def test_no_numbers_at_all_is_an_empty_set(self):
        self.assertEqual(at.numbers("accept any fruit"), set())


class Words(unittest.TestCase):

    def test_it_counts_whitespace_separated_words(self):
        self.assertEqual(at.words("  one  two\nthree "), 3)

    def test_nothing_is_no_words(self):
        self.assertEqual(at.words(""), 0)


if __name__ == "__main__":
    unittest.main()
