"""The 990 builder: four pages, three groups, and no teaching blocks anywhere.

121 segments across English, Maths and Science route to `revision` and cannot
be folded away -- both Science books are already at their period ceiling. Until
this module existed they had no builder at all, which is the whole reason the
route text said so out loud.

What the tests below hold on to, in the order they matter:

  A 990 that is not a 990 is refused, not built. `d0_route` owns that call and
  this module does not second-guess it.

  A 990 with nothing in it is refused BEFORE assembly, by the free lint. That
  is the pilot defect -- `revisionPanels: null` reaching the renderer -- and
  the refusal has to happen where it costs nothing.

  The practice page carries NO answers. The spec puts every answer in one
  footnote for the teacher, and an answer that leaks into a child-facing card
  is a card a child can copy from.

  Nothing in the output dereferences or reproduces `iDo`/`youDo`. A revision
  script legally has neither, and a progress log doing `script.iDo.steps` is
  how the render of every revision lesson in a batch dies at once.
"""
import unittest

import d0_panels
import d0_route
import test_panellint as fixtures


PT = {"book_stem": "grade_1_english", "grade": 1, "subject": "English",
      "printed_page_number": 12, "chapter": {"number": 1, "title": "My School"}}
PAGES = [dict(PT, printed_page_number=n) for n in (10, 11, 12)]


def enr(**kw):
    return fixtures.enr(**kw)


class TheWrongSegment(unittest.TestCase):

    def test_a_content_lesson_is_refused(self):
        e = {"lesson_id": "seg3", "lp_type": None, "generated": {}}
        with self.assertRaises(d0_route.WrongRoute):
            d0_panels.build(e, PT)

    def test_an_assessment_is_refused_and_told_where_to_go(self):
        e = {"lesson_id": "seg995", "lp_type": "jaiza", "generated": {}}
        with self.assertRaises(d0_route.WrongRoute) as caught:
            d0_panels.build(e, PT)
        self.assertIn("worksheet", str(caught.exception).lower())

    def test_the_refusal_names_the_segment(self):
        e = {"lesson_id": "grade_2_maths_ch1_seg3", "generated": {}}
        with self.assertRaises(d0_route.WrongRoute) as caught:
            d0_panels.build(e, PT)
        self.assertIn("grade_2_maths_ch1_seg3", str(caught.exception))


class TheLintRunsFirst(unittest.TestCase):
    """Nothing is assembled until the free check has passed."""

    def test_empty_panels_raise_before_anything_is_built(self):
        with self.assertRaises(d0_panels.Unfit):
            d0_panels.build(enr(rp=None), PT)

    def test_the_exception_carries_the_findings_not_just_a_string(self):
        with self.assertRaises(d0_panels.Unfit) as caught:
            d0_panels.build(enr(rp=None), PT)
        self.assertEqual([f["id"] for f in caught.exception.findings], ["RP-02"])

    def test_a_missing_panel_is_unfit_too(self):
        rp = fixtures.panels(advanced=None)
        with self.assertRaises(d0_panels.Unfit):
            d0_panels.build(enr(rp=rp), PT)

    def test_the_message_names_the_finding(self):
        with self.assertRaises(d0_panels.Unfit) as caught:
            d0_panels.build(enr(rp=None), PT)
        self.assertIn("RP-02", str(caught.exception))


class ThePageSet(unittest.TestCase):

    def setUp(self):
        self.built = d0_panels.build(enr(), PT, pages=PAGES)

    def test_it_is_four_pages(self):
        self.assertEqual(len(self.built["pages"]), 4)

    def test_they_are_glance_explain_practice_exit_in_that_order(self):
        self.assertEqual([p["kind"] for p in self.built["pages"]],
                         ["glance", "explain", "practice", "exit"])

    def test_the_glance_page_is_portrait_and_the_rest_are_landscape(self):
        got = [p["orientation"] for p in self.built["pages"]]
        self.assertEqual(got, ["portrait"] + ["landscape"] * 3)

    def test_every_landscape_page_is_four_by_three(self):
        for p in self.built["pages"][1:]:
            self.assertEqual(p["aspect"], "4:3", p["kind"])

    def test_the_pages_are_numbered_from_one(self):
        self.assertEqual([p["number"] for p in self.built["pages"]],
                         [1, 2, 3, 4])

    def test_it_says_what_kind_of_document_it_is(self):
        self.assertEqual(self.built["doc_type"], "revision_pages")

    def test_the_doc_id_is_the_segment_stem(self):
        self.assertEqual(self.built["doc_id"], "GRADE_1_ENGLISH_CH1_SEG990")


class TheGlancePage(unittest.TestCase):

    def setUp(self):
        self.page = d0_panels.build(enr(), PT, pages=PAGES)["pages"][0]

    def test_it_carries_the_grouping_note(self):
        self.assertIn("three groups", self.page["grouping_note"])

    def test_it_holds_three_cards_in_order(self):
        self.assertEqual([g["level"] for g in self.page["groups"]],
                         ["beginner", "intermediate", "advanced"])

    def test_each_card_carries_its_focus_and_its_board_lines(self):
        for g in self.page["groups"]:
            self.assertTrue(g["focus"])
            self.assertEqual(g["board"], ["m - m - mat", "s - s - sun"])

    def test_each_card_is_labelled_for_the_teacher_not_keyed_for_a_machine(self):
        self.assertEqual([g["label"] for g in self.page["groups"]],
                         ["BEGINNER", "INTERMEDIATE", "ADVANCED"])

    def test_the_subtitle_says_what_the_group_is(self):
        self.assertIn("foundations", self.page["groups"][0]["subtitle"])


class TheExplainPage(unittest.TestCase):

    def setUp(self):
        self.page = d0_panels.build(enr(), PT)["pages"][1]

    def test_one_panel_per_group(self):
        self.assertEqual(len(self.page["panels"]), 3)

    def test_the_script_is_what_she_says(self):
        self.assertIn("Say the word slowly", self.page["panels"][0]["say"])

    def test_the_code_switched_line_comes_across_when_it_is_there(self):
        self.assertIn("Lafz", self.page["panels"][0]["say_local"])

    def test_a_panel_with_no_local_line_simply_has_none(self):
        rp = fixtures.panels(beginner=fixtures.panel(
            explain={"say": "Say the word slowly and listen."}))
        page = d0_panels.build(enr(rp=rp), PT)["pages"][1]
        self.assertIsNone(page["panels"][0]["say_local"])


class ThePracticePage(unittest.TestCase):

    def setUp(self):
        self.page = d0_panels.build(enr(), PT)["pages"][2]

    def test_the_guided_item_comes_first_with_its_modelling_move(self):
        g = self.page["panels"][0]["guided"]
        self.assertIn("mat", g["prompt"])
        self.assertIn("Stretch", g["strategy"])

    def test_the_items_a_child_works_alone_on_are_numbered(self):
        items = self.page["panels"][0]["practice"]
        self.assertEqual([i["number"] for i in items], [1, 2])

    def test_no_answer_reaches_a_child_facing_card(self):
        for panel in self.page["panels"]:
            self.assertNotIn("answer", panel["guided"])
            for item in panel["practice"]:
                self.assertNotIn("answer", item)

    def test_every_answer_is_in_the_one_footnote_instead(self):
        note = self.page["answers"]
        self.assertIn("BEGINNER guided: m", note)
        self.assertIn("BEGINNER 1. s", note)
        self.assertEqual(len(note), 9)      # three groups x (guided + two)

    def test_the_answer_boxes_are_drawn_empty(self):
        self.assertTrue(self.page["empty_answer_boxes"])


class TheExitPage(unittest.TestCase):

    def setUp(self):
        self.page = d0_panels.build(enr(), PT)["pages"][3]

    def test_one_ticket_per_group_at_that_groups_level(self):
        self.assertEqual(len(self.page["panels"]), 3)
        self.assertIn("dog", self.page["panels"][0]["prompt"])

    def test_the_answer_is_the_teachers_and_it_is_here(self):
        # The only page where an answer sits beside its question -- it is a
        # one-minute check she marks on the spot, not something a child copies.
        self.assertEqual(self.page["panels"][0]["answer"], "d")


class WhatIsNotThere(unittest.TestCase):
    """A revision script legally has no iDo and no youDo."""

    def test_nothing_in_the_output_mentions_a_teaching_block(self):
        built = d0_panels.build(enr(), PT, pages=PAGES)
        flat = repr(built)
        for block in ("iDo", "weDo", "youDo"):
            self.assertNotIn(block, flat)

    def test_an_authored_ido_is_refused_rather_than_carried(self):
        e = enr()
        e["generated"]["iDo"] = {"steps": ["..."]}
        with self.assertRaises(d0_panels.Unfit):
            d0_panels.build(e, PT)


class WhereItCameFrom(unittest.TestCase):

    def test_the_provenance_names_the_book_and_the_chapter(self):
        prov = d0_panels.build(enr(), PT, pages=PAGES)["provenance"]
        self.assertEqual(prov["book_stem"], "grade_1_english")
        self.assertEqual(prov["chapter"], "Ch.1 · My School")

    def test_a_run_of_pages_reads_as_a_range(self):
        prov = d0_panels.build(enr(), PT, pages=PAGES)["provenance"]
        self.assertEqual(prov["printed_pages"], "10-12")

    def test_one_page_is_itself(self):
        prov = d0_panels.build(enr(), PT)["provenance"]
        self.assertEqual(prov["printed_pages"], "12")


class TheRouteKnowsAboutIt(unittest.TestCase):
    """The route text told callers there was no builder. There is one now."""

    def test_the_panel_route_names_the_builder(self):
        self.assertIn("d0_panels", d0_route.PANEL_ROUTE)

    def test_it_no_longer_says_there_is_none(self):
        self.assertNotIn("no panel builder", d0_route.PANEL_ROUTE)

    def test_it_still_says_a_990_has_no_teaching_blocks(self):
        self.assertIn("iDo", d0_route.PANEL_ROUTE)


if __name__ == "__main__":
    unittest.main()
