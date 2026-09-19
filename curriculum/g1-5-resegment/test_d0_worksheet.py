"""A 995 is two printed things, and only one of them goes to the child.

The defect this replaces rendered an assessment as a four-page teacher lesson
plan: the right words, well formed, scored clean, and nothing a child could
write on. `d0_route` now refuses that. This is what the refusal points at.

The rule that shapes the whole module: ONE authored source produces BOTH
artefacts. A worksheet and an answer key written separately drift -- the key
loses a question, or keeps an answer to a question the sheet no longer asks --
and the teacher discovers it in front of the class. So `build` splits one
`questions[]` down the middle, and the split is itself the check: an answer
that appears on the child's sheet is a leaked key, and a question the key
skips is a hole.
"""
import unittest

import d0_route
import d0_worksheet
import wslint
from test_wslint import good


PT = {"book_stem": "grade_1_english", "grade": 1, "subject": "English",
      "printed_page_number": 1, "pdf_page_index": 4,
      "chapter": {"number": 1, "title": "Hello World!"}}


def build(env=None, **kw):
    return d0_worksheet.build(env or good(), PT, **kw)


class ItRefusesWhatIsNotAWorksheet(unittest.TestCase):
    """The mirror of the engine guard, pointing the other way."""

    def test_a_content_lesson_does_not_come_through_here(self):
        with self.assertRaises(d0_route.WrongRoute):
            build(dict(good(), lp_type="content"))

    def test_a_revision_day_is_not_a_worksheet_either(self):
        with self.assertRaises(d0_route.WrongRoute):
            build(dict(good(), lp_type="revision"))


class TheLintRunsBeforeAnythingIsBuilt(unittest.TestCase):
    """A free check that the builder may not be talked out of."""

    def test_a_malformed_worksheet_is_refused_with_its_findings(self):
        env = good(6)
        try:
            build(env)
        except d0_worksheet.Unfit as e:
            self.assertIn("WS-02", [f["id"] for f in e.findings])
        else:
            raise AssertionError("a six-question worksheet was built")

    def test_the_message_names_what_is_wrong(self):
        try:
            build(good(6))
        except d0_worksheet.Unfit as e:
            self.assertIn("WS-02", str(e))

    def test_the_builder_runs_the_same_lint_a_wrapper_would(self):
        env = good()
        self.assertEqual(wslint.findings(env), [])
        self.assertTrue(build(env))


class TwoArtefactsFromOneSource(unittest.TestCase):

    def test_it_returns_the_sheet_and_the_key(self):
        out = build()
        self.assertEqual(sorted(out), ["answer_key", "worksheet"])

    def test_the_key_is_its_own_file_named_after_the_sheet(self):
        out = build()
        self.assertEqual(out["answer_key"]["doc_id"],
                         out["worksheet"]["doc_id"] + "_ANSWER_KEY")

    def test_neither_is_an_lp_doc(self):
        # The whole defect was an assessment that looked like a lesson plan to
        # everything downstream. These must not be mistakable for one.
        for doc in build().values():
            self.assertNotIn("lp_type", doc)
            self.assertNotIn("sections", doc)
        self.assertEqual(build()["worksheet"]["doc_type"], "worksheet")
        self.assertEqual(build()["answer_key"]["doc_type"], "answer_key")

    def test_both_carry_every_question_exactly_once(self):
        out = build()
        self.assertEqual([q["number"] for q in out["worksheet"]["questions"]],
                         list(range(1, 9)))
        self.assertEqual([a["number"] for a in out["answer_key"]["answers"]],
                         list(range(1, 9)))


class NothingOnTheChildsSheetGivesTheAnswerAway(unittest.TestCase):
    """The split is the check."""

    def test_the_sheet_carries_no_answers(self):
        for q in build()["worksheet"]["questions"]:
            for leak in ("answer", "marking", "common_errors",
                         "model_solution"):
                self.assertNotIn(leak, q)

    def test_the_sheet_carries_no_teacher_directives(self):
        # childText is what the child reads; a directive is the teacher's and
        # is printed nowhere on the sheet.
        env = good()
        env["generated"]["questions"][0]["directive"] = "Work alone for this."
        for q in build(env)["worksheet"]["questions"]:
            self.assertNotIn("directive", q)

    def test_the_directive_is_not_lost_it_moves_to_the_key(self):
        env = good()
        env["generated"]["questions"][0]["directive"] = "Work alone for this."
        self.assertEqual(build(env)["answer_key"]["answers"][0]["directive"],
                         "Work alone for this.")

    def test_the_child_still_gets_the_words_the_question_is_made_of(self):
        q = build()["worksheet"]["questions"][0]
        self.assertTrue(q["childText"])
        self.assertEqual(q["marks"], 2)


class TheKeyIsUsableAtTheFrontOfAClass(unittest.TestCase):

    def test_each_answer_repeats_the_question_so_it_can_be_read_alone(self):
        a = build()["answer_key"]["answers"][0]
        self.assertTrue(a["childText"])
        self.assertEqual(a["marks"], 2)

    def test_it_carries_the_answer_the_marking_and_the_common_errors(self):
        a = build()["answer_key"]["answers"][2]
        self.assertTrue(a["answer"])
        self.assertTrue(a["marking"])
        self.assertTrue(a["common_errors"])

    def test_an_open_personal_question_says_so_and_gives_a_model(self):
        env = good()
        env["generated"]["questions"][4].update(
            {"answer": None, "open_personal": True, "common_errors": [],
             "model_solution": "Pinky"})
        a = build(env)["answer_key"]["answers"][4]
        self.assertTrue(a["open_personal"])
        self.assertEqual(a["model_solution"], "Pinky")

    def test_the_key_totals_the_same_marks_the_sheet_prints(self):
        out = build()
        self.assertEqual(out["answer_key"]["total_marks"],
                         out["worksheet"]["total_marks"])


class TheSheetIsPrintable(unittest.TestCase):
    """Body-only render, header composited after — the skill's own route."""

    def test_the_top_of_the_page_is_left_blank_for_the_header(self):
        h = build()["worksheet"]["header_band"]
        self.assertTrue(h["composite"])
        self.assertGreaterEqual(h["blank_fraction"], 0.12)

    def test_the_header_holds_the_grade_the_marks_and_a_name_date_row(self):
        h = build()["worksheet"]["header_band"]
        self.assertEqual(h["grade"], 1)
        self.assertEqual(h["total_marks"], 16)
        self.assertTrue(h["name_date_row"])

    def test_every_question_says_how_much_room_the_child_gets(self):
        for q in build()["worksheet"]["questions"]:
            self.assertIn("space", q)

    def test_the_instruction_line_is_the_childs_not_the_teachers(self):
        self.assertEqual(build()["worksheet"]["instructions"],
                         "Do your best work.")


class ItRecordsWhereTheQuestionsCameFrom(unittest.TestCase):
    """Grounding is the guarantee; a worksheet drops it as easily as a lesson."""

    def test_the_sheet_names_its_book_and_chapter(self):
        p = build()["worksheet"]["provenance"]
        self.assertEqual(p["book_stem"], "grade_1_english")
        self.assertEqual(p["chapter"], "Ch.1 · Hello World!")

    def test_a_chapter_wide_worksheet_names_every_page_it_covers(self):
        out = build(pages=[{"printed_page_number": n} for n in range(1, 12)])
        self.assertEqual(out["worksheet"]["provenance"]["printed_pages"],
                         "1-11")

    def test_one_page_is_printed_as_itself_not_as_a_range(self):
        out = build(pages=[{"printed_page_number": 4}])
        self.assertEqual(out["worksheet"]["provenance"]["printed_pages"], "4")

    def test_the_key_carries_the_same_provenance(self):
        out = build()
        self.assertEqual(out["answer_key"]["provenance"],
                         out["worksheet"]["provenance"])


if __name__ == "__main__":
    unittest.main()
