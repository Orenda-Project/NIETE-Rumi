"""What a lesson author must be handed, and what it must be refused.

Stage C's one guarantee is that nothing is invented: "the #1 partner-rejected
failure is FABRICATION from no grounding" (the skill's stage-c brief). That
guarantee is not made by the author — it is made by what the author is given,
which is why this is a module and not a paragraph of prose in a prompt.

Three things it has to get right, each one a defect that already happened:

  The warm-up spirals to the PREVIOUS lesson. The operator found Grade 2 Maths
  Chapter 1 warming up on "ordering of numbers" — which is the SLO of the
  lesson it was warming up FOR. A warm-up that rehearses today's objective is
  not a warm-up, and the author cannot avoid it if the context hands it only
  today's SLOs. So the previous lesson's SLOs are carried, and today's are
  named as unavailable.

  A character may be named and may not be ventriloquised. SP-003: a silent
  recurring character is legal, and inventing a speech bubble for one is not.
  The page truth already distinguishes them — `text_in_image` is either the
  words on the page or null — so the context carries that distinction rather
  than leaving the author to guess.

  Every exercise gets solved. Not "the exercises referenced in the lesson" —
  every exercise on every page the segment resolved to, with the page's own
  answer key beside it.
"""
import unittest

import bodysurface
import cbrief


def page(printed, pdf, chapter=1, **kw):
    d = {"printed_page_number": printed, "pdf_page_index": pdf,
         "chapter": {"number": chapter, "title": "Hello World!"},
         "headings": [], "text_verbatim": "", "exercises": [],
         "illustrations": []}
    d.update(kw)
    return d


def seg(index, **kw):
    d = {"segment_index": index, "chapter_number": 1, "lp_type": "content",
         "topic": "Key Words", "skill_type": "vocabulary_grammar",
         "cpa_phase": None, "pages_printed": [2], "slo_codes": ["E-01-VO-01"],
         "slo_descriptions": ["Name various objects through pictures"],
         "blooms": "remember", "duration_min": 30}
    d.update(kw)
    return d


BOOK = {"stem": "grade_1_english", "grade": 1, "subject": "English",
        "chapter_title": "Hello World!"}


def ctx(segment=None, pages=None, **kw):
    return cbrief.context(segment or seg(1), pages or [page(2, 5)],
                          book=BOOK, **kw)


class TheEnvelope(unittest.TestCase):
    """The facts the lesson is about, carried whole."""

    def test_it_carries_the_grade_subject_and_chapter(self):
        e = ctx()["envelope"]
        self.assertEqual((e["grade"], e["subject"]), (1, "English"))
        self.assertEqual(e["chapter_number"], 1)
        self.assertEqual(e["chapter_title"], "Hello World!")

    def test_the_slo_codes_arrive_with_their_descriptions(self):
        # Operator, 2026-09-04: "dont remove the SLOs pls" and "make sure the
        # SLO matches the activities". A bare code cannot be matched against
        # an activity by anyone who does not already hold the SLO catalogue.
        e = ctx()["envelope"]
        self.assertEqual(e["slo_refs"], ["E-01-VO-01"])
        self.assertEqual(e["slo"], [("E-01-VO-01",
                                     "Name various objects through pictures")])

    def test_a_code_with_no_description_is_shown_as_missing_not_dropped(self):
        e = ctx(seg(1, slo_codes=["E-01-VO-01", "E-01-PH-01"],
                    slo_descriptions=["Name various objects"]))["envelope"]
        self.assertEqual(e["slo"][1], ("E-01-PH-01", None))

    def test_the_day_is_stated_as_n_of_m(self):
        e = ctx(day=3, total_days=7)["envelope"]
        self.assertEqual((e["day_num"], e["total_days"]), (3, 7))

    def test_the_printed_pages_are_the_ones_that_resolved(self):
        # Not the ones the segment asked for. A segment naming three pages of
        # which two resolved must not tell the author it has three.
        e = ctx(seg(1, pages_printed=[2, 3, 4]),
                [page(2, 5), page(3, 6)])["envelope"]
        self.assertEqual(e["pages_printed"], [2, 3])


class TheSpiral(unittest.TestCase):
    """The Grade 2 Maths defect, written as a property."""

    PREV = seg(1, topic="Ordering numbers to 20", slo_codes=["M-02-NO-04"],
               slo_descriptions=["Order numbers up to 20"])
    TODAY = seg(2, topic="Comparing numbers", slo_codes=["M-02-NO-05"],
                slo_descriptions=["Compare two numbers using < and >"])

    def test_the_previous_lesson_is_named_with_its_own_slos(self):
        s = ctx(self.TODAY, prev=self.PREV)["spiral"]
        self.assertEqual(s["previous"]["topic"], "Ordering numbers to 20")
        self.assertEqual(s["previous"]["slo_refs"], ["M-02-NO-04"])

    def test_todays_objective_is_named_as_unavailable_to_the_warm_up(self):
        s = ctx(self.TODAY, prev=self.PREV)["spiral"]
        self.assertEqual(s["forbidden"], ["M-02-NO-05"])

    def test_the_grade_2_maths_case_would_now_be_caught(self):
        # The warm-up rehearsed "ordering of numbers" on the day that TAUGHT
        # ordering. Stated the way the author sees it: the SLO it reached for
        # is in `forbidden`, and the one it should have reached for is not.
        s = cbrief.context(self.PREV, [page(2, 5)], book=BOOK, prev=None)
        self.assertIn("M-02-NO-04", s["spiral"]["forbidden"])

    def test_the_first_lesson_of_a_chapter_says_so_rather_than_going_quiet(self):
        # Dark stages stay dark. An absent key reads as an oversight; a
        # `previous: None` with a reason reads as the fact it is.
        s = ctx(seg(1), prev=None)["spiral"]
        self.assertIsNone(s["previous"])
        self.assertIn("first", s["reason"].lower())

    def test_a_previous_lesson_carries_no_reason_because_there_is_nothing_to_explain(self):
        self.assertIsNone(ctx(self.TODAY, prev=self.PREV)["spiral"]["reason"])


class TheSourcePages(unittest.TestCase):
    """Pictures are source material, and so is every word on the page."""

    RICH = page(
        2, 5, headings=["Memory Lane"],
        text_verbatim="How old are you? New words to know: name, age.",
        exercises=[{"label": "Activity 1: Trace the Words!",
                    "instruction_verbatim": "Trace over each new word.",
                    "items": ["name", "age"],
                    "answer_key": "name, age (trace exercise)",
                    "answer_confidence": "high"}])

    def test_the_verbatim_text_of_each_page_is_carried(self):
        p = ctx(pages=[self.RICH])["source"]["pages"][0]
        self.assertIn("New words to know", p["text_verbatim"])
        self.assertEqual(p["headings"], ["Memory Lane"])

    def test_every_exercise_is_listed_for_solving_with_its_answer_key(self):
        ex = ctx(pages=[self.RICH])["source"]["exercises"]
        self.assertEqual(len(ex), 1)
        self.assertEqual(ex[0]["items"], ["name", "age"])
        self.assertIn("trace exercise", ex[0]["answer_key"])

    def test_an_exercise_says_which_page_it_is_on(self):
        # "Solve every referenced exercise" is only checkable if each one can
        # be found again on the paper.
        self.assertEqual(ctx(pages=[self.RICH])["source"]["exercises"][0]
                         ["printed_page"], 2)

    def test_exercises_from_several_pages_arrive_in_page_order(self):
        a = page(2, 5, exercises=[{"label": "A"}])
        b = page(3, 6, exercises=[{"label": "B"}, {"label": "C"}])
        got = [e["label"] for e in ctx(pages=[a, b])["source"]["exercises"]]
        self.assertEqual(got, ["A", "B", "C"])

    def test_a_page_with_no_exercises_contributes_none_rather_than_a_blank(self):
        self.assertEqual(ctx(pages=[page(2, 5)])["source"]["exercises"], [])


class WhoMaySpeak(unittest.TestCase):
    """SP-003: a silent character is legal, a fabricated bubble is not."""

    SPEAKING = {"description": "Cartoon character Pinky waving.",
                "objects": ["Pinky (child, pink hair)"],
                "pedagogical_role": "prompts the memory-recall question",
                "text_in_image": "How old are you?"}
    SILENT = {"description": "A framed family photo.",
              "objects": ["framed family photo"],
              "pedagogical_role": "visual support for 'family'",
              "text_in_image": None}

    def page_with(self, *ills):
        return page(2, 5, illustrations=list(ills))

    def test_words_printed_in_a_picture_are_quotable(self):
        v = ctx(pages=[self.page_with(self.SPEAKING)])["source"]["voices"]
        self.assertEqual(v[0]["says"], "How old are you?")
        self.assertEqual(v[0]["printed_page"], 2)

    def test_a_picture_with_no_printed_words_is_offered_as_silent(self):
        s = ctx(pages=[self.page_with(self.SILENT)])["source"]["silent"]
        self.assertEqual(len(s), 1)
        self.assertIn("family photo", s[0]["description"])

    def test_a_silent_picture_is_never_given_words(self):
        # The whole of SP-003 in one assertion: the silent list carries no
        # field an author could mistake for a line to put in a speech bubble.
        s = ctx(pages=[self.page_with(self.SILENT)])["source"]["silent"][0]
        self.assertNotIn("says", s)

    def test_the_two_lists_are_disjoint(self):
        c = ctx(pages=[self.page_with(self.SPEAKING, self.SILENT)])["source"]
        self.assertEqual(len(c["voices"]), 1)
        self.assertEqual(len(c["silent"]), 1)

    def test_an_empty_string_is_not_a_voice(self):
        blank = dict(self.SILENT, text_in_image="   ")
        c = ctx(pages=[self.page_with(blank)])["source"]
        self.assertEqual(c["voices"], [])
        self.assertEqual(len(c["silent"]), 1)


class TheBudgetTravelsWithTheBrief(unittest.TestCase):
    """The caps reach the author, in the fields the author writes."""

    def test_it_is_the_measured_map_not_a_second_copy(self):
        self.assertEqual(ctx()["budget"], bodysurface.targets())

    def test_the_tightest_surface_is_named_so_it_can_be_written_last(self):
        self.assertEqual(ctx()["write_last"], "key_points")


class GroundingIsNotOptional(unittest.TestCase):
    """No pages, no lesson. This is the guarantee, not a nicety."""

    def test_a_segment_with_no_resolved_pages_is_refused(self):
        with self.assertRaises(cbrief.Ungrounded):
            cbrief.context(seg(1), [], book=BOOK)

    def test_the_refusal_names_the_segment(self):
        with self.assertRaises(cbrief.Ungrounded) as e:
            cbrief.context(seg(4), [], book=BOOK)
        self.assertIn("4", str(e.exception))

    def test_a_page_from_another_chapter_is_refused(self):
        # `pageres` should never hand one over, and if it ever does, the
        # brief is the last place that can still notice.
        with self.assertRaises(cbrief.Ungrounded):
            cbrief.context(seg(1), [page(2, 5, chapter=9)], book=BOOK)


class ItStaysPure(unittest.TestCase):
    """Testable without the restricted corpus and without credentials."""

    def test_it_reads_no_files_and_imports_only_pure_modules(self):
        # `d0_route` is itself import-free, so asking it which route a segment
        # takes costs this module nothing, and `lessonrules` is a tuple of
        # strings and a docstring. `cbriefbasics` is strings plus `basicseg`,
        # which imports nothing at all. `dayobj` reaches `dayfold` -> `skills`
        # -> `colorsys`, all stdlib or constants, with no file read anywhere in
        # the chain. Widened deliberately on 2026-09-19, 2026-09-20 and
        # 2026-09-21, rather than silently: the list is the guarantee.
        with open("cbrief.py") as fh:
            imports = [l for l in fh.read().splitlines()
                       if l.startswith(("import ", "from "))]
        self.assertEqual(imports, ["import bodysurface", "import cbriefbasics",
                                   "import d0_route", "import dayobj",
                                   "import lessonrules"])

    def test_it_does_not_mutate_the_segment_it_was_given(self):
        s = seg(1)
        before = dict(s)
        cbrief.context(s, [page(2, 5)], book=BOOK)
        self.assertEqual(s, before)


class AnAssessmentIsBriefedAsAWorksheet(unittest.TestCase):
    """Law 18's third clause: the shape goes in the brief, not only in a guard.

    The engine refuses a 995 that arrives as a lesson plan and the free lint
    refuses one of the wrong shape — but an author who was handed the five
    lesson caps and a list of `hookStory`/`workedExample` fields will write a
    lesson plan, be refused, and have been given no way to do otherwise. A
    guard that fires on work nobody could have got right is a guard that
    teaches nothing. So the brief itself changes shape.
    """

    ASSESS = seg(995, lp_type="assessment", skill_type="assessment",
                 topic="Chapter 1 Assessment")

    def brief(self):
        return cbrief.context(self.ASSESS, [page(2, 5)], book=BOOK)

    def test_a_content_segment_is_still_briefed_as_a_lesson(self):
        self.assertEqual(ctx()["shape"], "lesson")

    def test_an_assessment_segment_is_briefed_as_a_worksheet(self):
        self.assertEqual(self.brief()["shape"], "worksheet")

    def test_the_lesson_word_caps_are_not_handed_to_a_worksheet_author(self):
        # `key_points`, `worked_example` and the rest are the surfaces of a
        # four-page lesson. Handing them over is an instruction to write one.
        b = self.brief()
        self.assertNotIn("budget", b)
        self.assertNotIn("write_last", b)

    def test_a_lesson_still_gets_its_caps(self):
        self.assertIn("budget", ctx())
        self.assertEqual(set(ctx()["budget"]), set(bodysurface.targets()))

    def test_the_worksheet_brief_names_every_field_a_question_carries(self):
        fields = self.brief()["worksheet"]["fields"]
        for f in ("id", "type", "marks", "childText", "space", "answer",
                  "marking", "common_errors"):
            self.assertIn(f, fields, f)

    def test_it_names_the_two_fields_that_keep_a_key_honest(self):
        # An open-personal question has no answer and still owes a model, and
        # a teacher directive has somewhere to go other than the child's
        # sheet. Both are legal states an author will not guess at.
        fields = self.brief()["worksheet"]["fields"]
        self.assertIn("open_personal", fields)
        self.assertIn("model_solution", fields)
        self.assertIn("directive", fields)

    def test_the_rules_say_how_many_questions_and_how_much_variety(self):
        rules = " ".join(self.brief()["worksheet"]["rules"])
        self.assertIn("8", rules)
        self.assertIn("12", rules)

    def test_it_names_an_exemplar_file_that_is_actually_there(self):
        # A brief naming a file that does not exist is worse than naming none.
        import os
        path = self.brief()["worksheet"]["exemplar"]
        self.assertTrue(os.path.exists(path), path)

    def test_the_exemplar_passes_the_lint_it_is_an_example_for(self):
        # The one test that stops the example rotting into an example of the
        # wrong thing.
        import json
        import wslint
        with open(self.brief()["worksheet"]["exemplar"]) as fh:
            self.assertEqual(wslint.findings(json.load(fh)), [])

    def test_the_exemplar_is_marked_as_shape_and_not_as_content(self):
        # It is invented. Nothing of it may reach a real sheet.
        import json
        with open(self.brief()["worksheet"]["exemplar"]) as fh:
            self.assertIn("NOT CONTENT", json.load(fh)["_note"])

    def test_a_revision_segment_is_briefed_as_neither(self):
        # The 990 panel route is refused and unbuilt (bd filed). Briefing it
        # as a lesson would be how it quietly became one.
        b = cbrief.context(seg(990, lp_type="revision", skill_type="revision"),
                           [page(2, 5)], book=BOOK)
        self.assertEqual(b["shape"], "revision")
        self.assertNotIn("budget", b)

    def test_the_source_and_spiral_are_unchanged_whatever_the_shape(self):
        # Grounding does not depend on the artefact. Every exercise on every
        # resolved page still arrives, and so does the previous lesson.
        b = self.brief()
        self.assertIn("source", b)
        self.assertIn("spiral", b)
        self.assertIn("envelope", b)


if __name__ == "__main__":
    unittest.main()
