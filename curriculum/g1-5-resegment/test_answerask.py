# -*- coding: utf-8 -*-
"""What a repair asks the author for, and what it hands them to answer with.

bd-eakp8. Two things decide whether the repair pass produces answers or
fabrications. The first is that it asks for the RIGHT slots: brief v4 makes
four of them mandatory whether or not the prompt ends in a question mark,
so the target list is not the gate's failure list. 48 of the 56 dark
`problems[]` prompts are imperatives -- 'Add 24 + 18.' -- and never entered
the 407 unanswered questions, but a teacher marking that page needs the
answer exactly as much.

The second is that it hands over the page truth's OWN answer keys. Rule 32
of v4: fill from the book, never invent. Coverage across the 17 ICT books
is 90.2%, and 163 of those keys sit under a field name the schema never
settled on -- `solved_answer`, `answer_computed`, `correct_answer` -- so a
reader that looks only at `answer_key` drops them and teaches the author to
make something up instead. Five field names that match the same pattern are
not keys at all (`key_span`, `total_keys`, `keys`, `resolution`,
`fans_row_smileys`), and passing one off as an answer is worse than passing
nothing.
"""
import unittest

import answerask


def body(**kw):
    b = {"segment_id": "grade_2_math_ch1_seg1", "steps": [], "problems": []}
    b.update(kw)
    return b


class AsksForTheRightSlots(unittest.TestCase):

    def test_a_prose_question_becomes_an_asks_target(self):
        # Verbatim, filler and all: the author is told to copy the `ask`
        # word for word, and `answerslot._key` strips the lead at lookup
        # time. Handing over a tidied question invites a tidied lesson.
        t = answerask.targets(body(steps=[{"say": u"So, how many tens?"}]))
        self.assertEqual([a["text"] for a in t["asks"]], [u"So, how many tens?"])

    def test_an_answered_prose_question_is_not_asked_for_again(self):
        b = body(steps=[{"say": u"How many tens?"}],
                 asks=[{"ask": u"How many tens?", "answer": u"4 tens."}])
        self.assertEqual(answerask.targets(b)["asks"], [])

    def test_every_warm_up_item_is_listed_because_the_list_is_replaced(self):
        # `answerfix` refuses a patch that drops an item, so an already
        # answered one still has to come back -- with its answer echoed, not
        # reworded.
        b = body(warmUp={"items": [{"prompt": u"What is 5 + 5?",
                                    "expected": u"10"},
                                   u"And 6 + 6?"]})
        t = answerask.targets(b)["warmUp.items"]
        self.assertEqual([i["ask"] for i in t], [u"What is 5 + 5?", u"And 6 + 6?"])
        self.assertEqual([i["answer"] for i in t], [u"10", None])

    def test_an_answered_ask_comes_back_with_the_unanswered_ones(self):
        # The table is replaced wholesale, so leaving an answered entry out
        # of the request is how the repair would delete it.
        b = body(steps=[{"say": u"How many tens? How many ones?"}],
                 asks=[{"ask": u"How many tens?", "answer": u"4 tens."}])
        t = answerask.targets(b)["asks"]
        self.assertEqual([a["answer"] for a in t], [u"4 tens.", None])

    def test_a_fully_answered_warm_up_is_not_asked_for(self):
        b = body(warmUp={"items": [{"ask": u"What is 5 + 5?", "answer": u"10"}]})
        self.assertNotIn("warmUp.items", answerask.wanted(b))

    def test_the_exit_ticket_is_asked_for_whether_or_not_it_is_a_question(self):
        # v4 makes all four exitTicket fields mandatory. 25 of 43 tasks are
        # phrased as questions; the other 18 are the ones a teacher marks
        # with nothing to mark against.
        b = body(exitTicket={"task": u"Write 42 in words."})
        self.assertEqual(answerask.targets(b)["exitTicket.answer"],
                         u"Write 42 in words.")

    def test_a_dark_problem_is_asked_for_even_as_an_imperative(self):
        b = body(problems=[{"prompt": u"Add 24 + 18.", "solution": None},
                           {"prompt": u"Add 11 + 11.", "solution": u"22"}])
        self.assertEqual(answerask.targets(b)["problems[].solution"],
                         {"0": u"Add 24 + 18."})

    def test_a_placeholder_solution_counts_as_dark(self):
        b = body(problems=[{"prompt": u"Add 24 + 18.",
                            "solution": u"Let the children answer."}])
        self.assertIn("0", answerask.targets(b)["problems[].solution"])

    def test_a_cfu_without_its_pass_signal_is_asked_for(self):
        b = body(steps=[{"cfu": {"question": u"How many tens?"}},
                        {"cfu": {"question": u"And ones?",
                                 "pass_signal": u"Says 2."}}])
        self.assertEqual(answerask.targets(b)["steps[].cfu.pass_signal"],
                         {"0": u"How many tens?"})

    def test_a_lesson_that_answers_itself_wants_nothing(self):
        b = body(steps=[{"cfu": {"question": u"How many tens?",
                                 "pass_signal": u"Says 4."}}])
        self.assertEqual(answerask.wanted(b), ())

    def test_wanted_names_only_the_paths_with_work_in_them(self):
        b = body(steps=[{"say": u"How many tens?"}],
                 exitTicket={"task": u"Write 42.", "answer": u"42"})
        self.assertEqual(answerask.wanted(b), ("asks",))


class HandsOverThePageTruth(unittest.TestCase):

    def test_the_canonical_key_is_read(self):
        pages = [{"printed_page": 12,
                  "exercises": [{"label": "Q3", "answer_key": u"42"}]}]
        self.assertEqual(answerask.keys(pages)[0]["answer"], u"42")

    def test_a_key_under_a_name_the_schema_never_settled_is_still_read(self):
        # 163 of the 7,974 ICT exercises carry their key only this way.
        pages = [{"printed_page": 12,
                  "exercises": [{"label": "Q3", "solved_answer": u"42"}]}]
        self.assertEqual(answerask.keys(pages)[0]["answer"], u"42")

    def test_the_page_number_is_read_from_the_shape_pageres_returns(self):
        # `pageres`/`cbrief` call it `printed_page_number`; `cbrief`'s own
        # copy of an exercise calls it `printed_page`. The runner hands over
        # the former, so reading only the latter puts "pNone" on every row
        # of THE BOOK and takes the anchor away from the one reader who
        # needs it.
        pages = [{"printed_page_number": 12,
                  "exercises": [{"label": "Q3", "answer_key": "42"}]}]
        self.assertEqual(answerask.keys(pages)[0]["page"], 12)

    def test_a_field_that_only_looks_like_a_key_is_not_one(self):
        pages = [{"printed_page": 12,
                  "exercises": [{"label": "Q3", "total_keys": 4,
                                 "key_span": "a-c", "resolution": "300dpi",
                                 "keys": ["a"], "fans_row_smileys": 3}]}]
        self.assertEqual(answerask.keys(pages), [])

    def test_an_exercise_with_no_key_is_left_out_rather_than_faked(self):
        pages = [{"printed_page": 12, "exercises": [{"label": "Q3"}]}]
        self.assertEqual(answerask.keys(pages), [])

    def test_the_page_and_the_instruction_travel_with_the_key(self):
        pages = [{"printed_page": 12,
                  "exercises": [{"label": "Q3", "answer_key": u"42",
                                 "instruction_verbatim": u"Add 24 + 18.",
                                 "answer_confidence": u"high"}]}]
        k = answerask.keys(pages)[0]
        self.assertEqual((k["page"], k["instruction"], k["confidence"]),
                         (12, u"Add 24 + 18.", u"high"))

    def test_a_key_nested_in_an_item_is_reached(self):
        # `answer_key` sits on exercises[].items[] 217 times.
        pages = [{"printed_page": 12,
                  "exercises": [{"label": "Q3",
                                 "items": [{"answer_key": u"42"}]}]}]
        self.assertEqual(answerask.keys(pages)[0]["answer"], u"42")


class WritesTheRequest(unittest.TestCase):
    """The prompt is generated from the target list, never hand-written.

    `answersites` is the authoritative map of where an answer goes, and a
    prompt kept in a separate string drifts from it the first time a path
    is added. Generating it means the request can only ever ask for slots
    `answerfix` will accept.
    """

    def test_the_request_names_every_wanted_path_and_no_other(self):
        b = body(steps=[{"say": u"How many tens?"}],
                 exitTicket={"task": u"Write 42."})
        r = answerask.request(b)
        for path in ("asks", "exitTicket.answer"):
            self.assertIn(path, r)
        self.assertNotIn("problems[].solution", r)

    def test_the_request_quotes_the_question_to_be_answered(self):
        r = answerask.request(body(steps=[{"say": u"How many tens?"}]))
        self.assertIn(u"How many tens?", r)

    def test_the_request_carries_the_page_keys_when_there_are_any(self):
        b = body(problems=[{"prompt": u"Add 24 + 18.", "solution": None}])
        r = answerask.request(b, keys=[{"page": 12, "label": "Q3",
                                        "instruction": u"Add 24 + 18.",
                                        "answer": u"42", "confidence": "high"}])
        self.assertIn(u"42", r)
        self.assertIn("12", r)

    def test_the_request_says_what_to_do_when_the_book_does_not_answer_it(self):
        # Rule 32 of v4. Without this line the model invents a key, which is
        # the failure partners reject a lesson for.
        r = answerask.request(body(steps=[{"say": u"How many tens?"}]))
        self.assertIn("answers vary", r)

    def test_a_lesson_needing_nothing_has_no_request(self):
        self.assertEqual(answerask.request(body()), "")


if __name__ == "__main__":
    unittest.main()
