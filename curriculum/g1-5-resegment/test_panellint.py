"""A 990 that reaches the renderer with no panels costs a render slot and
reports clean. This is the test that stops it.

Measured on the GK/Islamiat/SST pilot: three of the four revision lessons
arrived with `revisionPanels: null`, each burned a paid render, and the batch
log still said "30/30 lint clean". The engine guard alone did not catch it
because the engine guard only refuses the wrong OBJECT -- a 990 rendered as a
four-page lesson plan -- and these were correctly routed 990s that were empty.

So the first and most important case below is the placeholder: a `generated`
block that HAS the key and holds null. Present-but-null is ABSENT, everywhere,
and the renderer proves it -- `normaliseRevisionPanels` returns null for a
missing panel, `generate.js` then picks the ORDINARY page set, and a revision
day renders as a lesson plan with the teaching removed.

The rest of the rules come off the four revision page builders in
`prompts.js`, which dereference `rp.groupingNote`, `rp[level].focus`,
`.explain.say`, `.guided.prompt`, `.practice[i].prompt`, `.practice.length`
and `.exit.prompt` without a guard. Every one of those is a crash or a blank
card, and every one is visible in JSON before anything is spent.
"""
import unittest

import panellint


def panel(**over):
    """A panel with nothing wrong with it. Tests break one thing at a time."""
    p = {
        "focus": "Hearing the first sound in a word",
        "board": ["m - m - mat", "s - s - sun"],
        "explain": {"say": "Say the word slowly. The very first sound you "
                           "hear is the one we write first.",
                    "sayLocal": "Lafz ahista bolo. Jo pehli awaaz sunai de, "
                                "wahi pehle likhte hain."},
        "guided": {"prompt": "What sound does 'mat' start with?",
                   "strategy": "Stretch the word, point at the first letter.",
                   "answer": "m"},
        "practice": [{"prompt": "sun", "answer": "s"},
                     {"prompt": "pen", "answer": "p"}],
        "exit": {"prompt": "What sound does 'dog' start with?", "answer": "d"},
    }
    p.update(over)
    return p


def panels(**over):
    p = {"groupingNote": "Split the class into three groups by where they are "
                         "today. Teach one group for about twelve minutes "
                         "while the others do their practice items.",
         "beginner": panel(), "intermediate": panel(), "advanced": panel()}
    p.update(over)
    return p


def enr(rp="use-default", lp_type="revision"):
    gen = {}
    if rp != "use-default":
        gen["revisionPanels"] = rp
    else:
        gen["revisionPanels"] = panels()
    return {"lesson_id": "grade_1_english_ch1_seg990", "lp_type": lp_type,
            "generated": gen}


def codes(*a, **kw):
    return [f["id"] for f in panellint.findings(*a, **kw)]


class ASegmentThatIsNotARevisionDay(unittest.TestCase):
    """The lint declines rather than inventing findings about a lesson plan."""

    def test_a_content_segment_gets_one_finding_and_no_others(self):
        e = {"lesson_id": "seg3", "lp_type": None, "generated": {}}
        self.assertEqual(codes(e), ["RP-01"])

    def test_an_assessment_is_the_worksheet_lints_business_not_this_one(self):
        e = {"lesson_id": "seg995", "lp_type": "jaiza", "generated": {}}
        self.assertEqual(codes(e), ["RP-01"])

    def test_the_urdu_type_word_routes_here_too(self):
        # 72 of the 236 revision segments say `duhrai`, not `revision`.
        self.assertNotIn("RP-01", codes(enr(lp_type="duhrai")))

    def test_review_assess_routes_here_too(self):
        self.assertNotIn("RP-01", codes(enr(lp_type="review_assess")))


class ThePanelsThatNeverArrived(unittest.TestCase):
    """The pilot defect, in all three shapes it actually takes."""

    def test_the_key_present_and_null_is_absent(self):
        self.assertIn("RP-02", codes(enr(rp=None)))

    def test_the_key_missing_altogether_is_the_same_finding(self):
        e = {"lesson_id": "seg990", "lp_type": "revision", "generated": {}}
        self.assertIn("RP-02", codes(e))

    def test_an_empty_object_is_absent_too(self):
        self.assertIn("RP-02", codes(enr(rp={})))

    def test_nothing_else_is_reported_once_the_panels_are_gone(self):
        # A cascade of forty findings hides the one that matters.
        self.assertEqual(codes(enr(rp=None)), ["RP-02"])

    def test_a_string_where_the_object_should_be_is_absent(self):
        self.assertEqual(codes(enr(rp="pending")), ["RP-02"])


class TheThreeGroups(unittest.TestCase):

    def test_a_missing_panel_is_named(self):
        found = panellint.findings(enr(rp=panels(advanced=None)))
        self.assertEqual([f["id"] for f in found], ["RP-04"])
        self.assertIn("advanced", found[0]["name"])

    def test_each_of_the_three_is_checked(self):
        for level in ("beginner", "intermediate", "advanced"):
            e = enr(rp=panels(**{level: None}))
            self.assertEqual(codes(e), ["RP-04"], level)

    def test_a_fourth_group_is_a_finding_because_the_page_holds_three(self):
        self.assertIn("RP-05", codes(enr(rp=panels(gifted=panel()))))

    def test_the_grouping_note_is_the_dominant_card_and_must_be_there(self):
        self.assertIn("RP-03", codes(enr(rp=panels(groupingNote=None))))


class WhatEachPanelOwes(unittest.TestCase):
    """One rule per field the renderer dereferences without a guard."""

    def one(self, **over):
        return codes(enr(rp=panels(beginner=panel(**over))))

    def test_no_focus_means_a_blank_glance_card(self):
        self.assertIn("RP-06", self.one(focus=None))

    def test_no_board_lines_means_a_blank_board_card(self):
        self.assertIn("RP-07", self.one(board=[]))

    def test_more_than_three_board_lines_will_not_fit(self):
        self.assertIn("RP-07", self.one(board=["a", "b", "c", "d"]))

    def test_no_explanation_is_the_whole_point_of_the_day_missing(self):
        self.assertIn("RP-08", self.one(explain=None))

    def test_an_explanation_with_no_say_is_the_same_hole(self):
        self.assertIn("RP-08", self.one(explain={"sayLocal": "kuch"}))

    def test_the_local_line_is_optional(self):
        self.assertNotIn("RP-08", self.one(
            explain={"say": "Say the word slowly and listen."}))

    def test_no_guided_item_means_she_models_nothing(self):
        self.assertIn("RP-09", self.one(guided=None))

    def test_a_guided_item_with_no_answer_is_half_an_item(self):
        self.assertIn("RP-09", self.one(
            guided={"prompt": "What sound does 'mat' start with?"}))

    def test_one_practice_item_is_not_enough_to_work_alone_on(self):
        self.assertIn("RP-10", self.one(practice=[{"prompt": "sun",
                                                   "answer": "s"}]))

    def test_four_practice_items_overflow_the_panel(self):
        self.assertIn("RP-10", self.one(practice=[{"prompt": "x", "answer": "y"}
                                                  for _ in range(4)]))

    def test_a_practice_item_with_no_answer_leaves_the_footnote_short(self):
        self.assertIn("RP-10", self.one(practice=[{"prompt": "sun",
                                                   "answer": "s"},
                                                  {"prompt": "pen"}]))

    def test_no_exit_ticket_means_no_slo_check_for_that_group(self):
        self.assertIn("RP-11", self.one(exit=None))

    def test_an_exit_ticket_with_no_answer_prints_Ans_nothing(self):
        self.assertIn("RP-11", self.one(
            exit={"prompt": "What sound does 'dog' start with?"}))

    def test_the_finding_names_which_group_it_is_about(self):
        found = panellint.findings(enr(rp=panels(intermediate=panel(focus=None))))
        self.assertTrue(all("intermediate" in f["name"] for f in found), found)


class TheLengthsTheRendererWouldTruncate(unittest.TestCase):
    """Not style. Past these the render silently loses the end of a sentence."""

    def one(self, **over):
        return codes(enr(rp=panels(beginner=panel(**over))))

    def test_a_focus_line_past_eighty_characters_is_cut(self):
        self.assertIn("RP-12", self.one(focus="x" * 81))

    def test_a_guided_prompt_past_one_hundred_and_fifteen_is_cut(self):
        self.assertIn("RP-12", self.one(
            guided={"prompt": "x" * 116, "answer": "m"}))

    def test_an_answer_past_seventy_eight_is_cut(self):
        self.assertIn("RP-12", self.one(
            guided={"prompt": "What sound?", "answer": "x" * 79}))

    def test_an_exit_prompt_past_one_hundred_and_twenty_five_is_cut(self):
        self.assertIn("RP-12", self.one(
            exit={"prompt": "x" * 126, "answer": "d"}))

    def test_an_explanation_past_three_hundred_is_cut(self):
        self.assertIn("RP-12", self.one(
            explain={"say": "x" * 301}))

    def test_the_grouping_note_past_two_hundred_is_cut(self):
        self.assertIn("RP-12", codes(enr(rp=panels(groupingNote="x" * 201))))

    def test_the_finding_says_which_field_and_by_how_much(self):
        found = [f for f in panellint.findings(
            enr(rp=panels(beginner=panel(focus="x" * 90))))
            if f["id"] == "RP-12"]
        self.assertIn("focus", found[0]["name"])
        self.assertIn("90", found[0]["name"])


class TheTeachingThatIsNotThere(unittest.TestCase):
    """A revision script legally has no iDo and no youDo."""

    def test_an_ido_block_on_a_revision_day_is_a_finding(self):
        e = enr()
        e["generated"]["iDo"] = {"steps": ["..."]}
        self.assertIn("RP-13", codes(e))

    def test_a_youdo_block_is_the_same_finding(self):
        e = enr()
        e["generated"]["youDo"] = {"steps": ["..."]}
        self.assertIn("RP-13", codes(e))

    def test_a_null_ido_is_absent_and_not_a_finding(self):
        e = enr()
        e["generated"]["iDo"] = None
        self.assertNotIn("RP-13", codes(e))


class AGoodOne(unittest.TestCase):

    def test_nothing_blocks_it(self):
        self.assertEqual(panellint.findings(enr()), [])

    def test_ok_is_the_shape_a_caller_wants(self):
        self.assertTrue(panellint.ok(enr()))
        self.assertFalse(panellint.ok(enr(rp=None)))

    def test_a_segment_dict_can_carry_the_type_word_instead(self):
        e = enr(lp_type=None)
        self.assertTrue(panellint.ok(e, {"skill_type": "revision"}))

    def test_three_practice_items_are_fine(self):
        rp = panels(beginner=panel(practice=[{"prompt": "sun", "answer": "s"},
                                             {"prompt": "pen", "answer": "p"},
                                             {"prompt": "top", "answer": "t"}]))
        self.assertEqual(panellint.findings(enr(rp=rp)), [])


if __name__ == "__main__":
    unittest.main()
