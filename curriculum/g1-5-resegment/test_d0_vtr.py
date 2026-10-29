"""bd-52j3b -- the opening's ONE visual thinking routine.

Operator, twice: *"yes add see think wonder to the hooks"*, then *"i dont see any VTRs
either in the LPs"*. Measured before this module existed: of the 335 built lp_docs,
ONE carried the string See-Think-Wonder (g5_ch10/Urdu_seg10) and it was a textbook-
sourced CLOSING reflection, not an opening. Zero openings carried a routine.

These tests pin the five constraints the operator set, each of which is a way the
change gets worse than doing nothing:

  1. ONE routine. The routine IS the provocation -- it rewrites the hook `ask` and
     adds no block. *"it should be just 1 not multiple strategies since opening is a
     whole provocation on its own"*.
  2. WRITTEN, never student-to-student talk (lint gate 10e, `peer_talk_gate.js`).
  3. It must ANCHOR to something on the page. No visual -> no routine, and a gap.
  4. SHORT. The page is already 367 words/page.
  5. Urdu in real Urdu, and TIGHTER than English -- Urdu is the densest subject.
"""

import re

import pytest

import d0_vtr


EN_HOOK = ("Open textbook p. 127 to the picture of Pinky and Jojo looking at the "
           "injured blue bird on the ground.")
UR_HOOK = "کتاب کا صفحہ ۱۰۷ کھولیں اور ثقافتی میلے کی تصویر دیکھیں۔"
BOARD = {"instruction": "Draw a large box labelled TITLE and an arrow to a "
                        "thought-bubble labelled MY PREDICTION.",
         "content": "TITLE\n  |\n  v\nMY PREDICTION: ____"}

ASK = "Where do YOU see a bird at home or in your street?"


def opening(question=ASK, extra=()):
    blocks = [{"type": "key_points", "id": "hook-setup", "items": ["Set it up."]},
              {"type": "ask", "id": "hook", "hook": True, "question": question}]
    blocks += list(extra)
    return [{"id": "introduction", "title": "Opening", "blocks": blocks},
            {"id": "development", "title": "I Do", "blocks": []}]


def words(s):
    return len([w for w in re.split(r"\s+", s or "") if w])


# --------------------------------------------------------------- the anchor

class TestAnchor:
    def test_prefers_the_picture_the_hook_already_names(self):
        kind, phrase = d0_vtr.visual_anchor({"hookStory": EN_HOOK,
                                             "boardWork": BOARD}, "en")
        assert kind == "picture"
        assert "127" in phrase

    def test_a_named_page_with_no_picture_word_is_still_a_page_to_look_at(self):
        g = {"hookStory": "Turn to page 42 and read the poem aloud.",
             "boardWork": BOARD}
        kind, phrase = d0_vtr.visual_anchor(g, "en")
        assert kind == "page"
        assert "42" in phrase

    def test_falls_back_to_the_board_figure_when_no_page_is_named(self):
        g = {"hookStory": "Hold up two bundles of ten sticks and one loose stick.",
             "boardWork": BOARD}
        assert d0_vtr.visual_anchor(g, "en") == ("board", d0_vtr.PHRASES["en"]["board"])

    def test_no_page_and_no_drawable_board_is_no_anchor(self):
        g = {"hookStory": "Ask the class how they came to school today.",
             "boardWork": {}}
        assert d0_vtr.visual_anchor(g, "en") is None

    def test_urdu_page_digits_are_carried_verbatim_not_transliterated(self):
        kind, phrase = d0_vtr.visual_anchor({"hookStory": UR_HOOK,
                                             "boardWork": BOARD}, "ur")
        assert kind == "picture"
        assert "۱۰۷" in phrase


# ------------------------------------------------------- the routine itself

class TestRoutine:
    def test_the_authored_provocation_survives_byte_for_byte(self):
        q = d0_vtr.routine_question(ASK, "the board figure", "en")
        assert ASK in q

    def test_all_three_stems_are_named_so_the_teacher_can_see_the_routine(self):
        q = d0_vtr.routine_question(ASK, "the board figure", "en").upper()
        assert "SEE" in q and "THINK" in q and "WONDER" in q

    def test_it_is_written_and_silent(self):
        q = d0_vtr.routine_question(ASK, "the board figure", "en").lower()
        assert "copy" in q and "silent" in q

    def test_english_costs_at_most_twenty_five_words(self):
        q = d0_vtr.routine_question(ASK, "the board figure", "en")
        assert words(q) - words(ASK) <= 25

    def test_urdu_is_real_urdu_with_no_latin_transliteration(self):
        ur_ask = "آپ نے میلے میں کیا دیکھا؟"
        q = d0_vtr.routine_question(ur_ask, d0_vtr.PHRASES["ur"]["board"], "ur")
        added = q.replace(ur_ask, "")
        assert not re.search(r"[A-Za-z]", added)

    def test_urdu_is_tighter_than_english_because_urdu_is_the_densest_subject(self):
        ur_ask = "آپ نے میلے میں کیا دیکھا؟"
        en = words(d0_vtr.routine_question(ASK, d0_vtr.PHRASES["en"]["board"], "en"))
        ur = words(d0_vtr.routine_question(ur_ask, d0_vtr.PHRASES["ur"]["board"], "ur"))
        assert ur - words(ur_ask) < en - words(ASK)


# ------------------------------------------------------------- the wiring

class TestApply:
    def test_it_adds_no_block_the_routine_IS_the_provocation(self):
        secs = opening()
        before = len(secs[0]["blocks"])
        d0_vtr.apply_visual_routine(secs, {"hookStory": EN_HOOK,
                                           "boardWork": BOARD}, "en")
        assert len(secs[0]["blocks"]) == before

    def test_it_rewrites_the_hook_ask_in_place(self):
        secs = opening()
        d0_vtr.apply_visual_routine(secs, {"hookStory": EN_HOOK,
                                           "boardWork": BOARD}, "en")
        ask = [b for b in secs[0]["blocks"] if b.get("hook")][0]
        assert ASK in ask["question"]
        assert ask["question"] != ASK
        assert "127" in ask["question"]

    def test_only_the_opening_is_touched(self):
        secs = opening()
        secs[1]["blocks"] = [{"type": "ask", "id": "x", "hook": True,
                              "question": ASK}]
        d0_vtr.apply_visual_routine(secs, {"hookStory": EN_HOOK,
                                           "boardWork": BOARD}, "en")
        assert secs[1]["blocks"][0]["question"] == ASK

    def test_no_anchor_leaves_the_question_byte_for_byte_and_says_why(self):
        secs = opening()
        gaps = d0_vtr.apply_visual_routine(
            secs, {"hookStory": "Ask them how they came to school.",
                   "boardWork": {}}, "en")
        assert secs[0]["blocks"][1]["question"] == ASK
        assert gaps and "visual" in gaps[0].lower()

    def test_no_hook_ask_is_a_gap_not_an_exception(self):
        secs = [{"id": "introduction", "title": "Opening", "blocks": []}]
        gaps = d0_vtr.apply_visual_routine(secs, {"hookStory": EN_HOOK,
                                                  "boardWork": BOARD}, "en")
        assert gaps and "hook" in gaps[0].lower()

    def test_applying_twice_does_not_stack_a_second_routine(self):
        secs = opening()
        g = {"hookStory": EN_HOOK, "boardWork": BOARD}
        d0_vtr.apply_visual_routine(secs, g, "en")
        once = secs[0]["blocks"][1]["question"]
        assert d0_vtr.apply_visual_routine(secs, g, "en") == []
        assert secs[0]["blocks"][1]["question"] == once

    def test_a_missing_opening_is_a_noop_not_a_crash(self):
        secs = [{"id": "development", "title": "I Do", "blocks": []}]
        assert d0_vtr.apply_visual_routine(secs, {"hookStory": EN_HOOK}, "en") == []

    @pytest.mark.parametrize("banned", ["partner", "neighbour", "classmate",
                                        "discuss", "turn and talk"])
    def test_the_routine_never_asks_a_child_to_talk_to_another_child(self, banned):
        q = d0_vtr.routine_question(ASK, "the board figure", "en").lower()
        assert banned not in q


# ------------------------------------------------- Urdu case, found in a render

class TestUrduCase:
    """`پر` is a postposition, so the noun in front of it must be OBLIQUE.

    Caught by rasterising g1_ch10/Urdu_seg1, not by a unit test: the page-anchor
    phrase was authored in the direct case (`کتاب کا صفحہ ۸۵`) and the lead appends
    `پر`, printing `کتاب کا صفحہ ۸۵ پر` -- wrong case, in the first line a Grade 1
    Urdu teacher reads. The picture and board phrases already end in a feminine
    noun that takes no change, so only the page phrase was ever wrong.
    """

    def test_the_page_anchor_is_oblique_before_the_postposition(self):
        q = d0_vtr.routine_question("کیا ہوا؟", d0_vtr.PHRASES["ur"]["page"].format(n="۸۵"), "ur")
        assert "کتاب کے صفحہ" in q
        assert "کتاب کا صفحہ" not in q

    def test_every_urdu_anchor_phrase_reads_into_the_lead(self):
        for kind in ("picture", "page", "board"):
            phrase = d0_vtr.PHRASES["ur"][kind].format(n="۸۵")
            assert d0_vtr.PHRASES["ur"]["lead"].format(anchor=phrase).endswith("سوال کرو۔")
            assert "کا پر" not in phrase + " پر"
