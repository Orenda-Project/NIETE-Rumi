"""The whole-board scan: a maths board becomes a real drawing, or nothing.

Every fixture here is lifted from a REAL board in the 105-lesson Maths corpus
(ch9-10-build/renders/*/docs/Maths_*.lp.json), not invented, so a builder that
passes these passes on content that actually ships.
"""

import unittest

import d0_board_art_scan as S


def board(*lines, title=None, instruction=""):
    """The Board shape d0_board_read produces: one panel, one row per line."""
    rows = [{"kind": "text", "text": ln, "term": None, "gloss": None, "cells": None}
            for ln in lines]
    return {"title": title, "panels": [{"label": None, "rows": rows}],
            "instruction": instruction}


class AClockBoardBecomesAClockFace(unittest.TestCase):
    # g1_ch9/Maths_seg1.lp.json
    def test_a_time_repeated_across_the_board_is_still_one_clock(self):
        spec = S.scan_spec(board(
            "ANALOGUE CLOCK                         DIGITAL CLOCK",
            "12                         09:00",
            "long thin minute hand -> 12",
            "Minute hand on 12 + hour hand on 9 = 9 o'clock = 09:00"))
        self.assertEqual(spec["type"], "clock")
        self.assertEqual(spec["time"], "9:00")

    def test_two_different_times_refuse_because_one_face_cannot_carry_both(self):
        self.assertIsNone(S.scan_spec(board(
            "CLOCK: the hour hand", "school starts 08:00", "school ends 13:30")))

    def test_a_time_with_no_clock_word_is_not_assumed_to_be_a_clock(self):
        self.assertIsNone(S.scan_spec(board("bus fare table", "09:00 departure")))


class AShapeWithItsCountsBecomesAnOutline(unittest.TestCase):
    def test_one_named_shape_with_stated_counts_draws_that_shape(self):
        spec = S.scan_spec(board("RECTANGLE", "4 sides, 4 corners"))
        self.assertEqual(spec["type"], "geometry")
        self.assertEqual(spec["shapes"][0]["kind"], "polygon")
        self.assertIn("4 sides", spec["caption"])

    def test_two_named_shapes_refuse_rather_than_draw_the_wrong_one(self):
        self.assertIsNone(S.scan_spec(board(
            "RECTANGLE and SQUARE", "4 sides, 4 corners")))

    def test_a_shape_named_with_no_count_is_a_picture_not_this_board(self):
        self.assertIsNone(S.scan_spec(board("Find a circle in the room")))


class ANamedValueListBecomesASizeComparison(unittest.TestCase):
    # g1_ch8/Maths_seg6.lp.json
    def test_named_values_under_a_comparison_word_become_compare_size(self):
        spec = S.scan_spec(board(
            "BALANCE SCALE = the tool for mass",
            "DOWN side = heavier, UP side = lighter",
            "lettuce=4, carrot=8, cake=10 (buttons)",
            "lightest -> heaviest: lettuce, carrot, cake"))
        self.assertEqual(spec["type"], "compare_size")
        self.assertEqual([i["label"] for i in spec["items"]],
                         ["lettuce", "carrot", "cake"])
        self.assertEqual([i["size"] for i in spec["items"]], [4, 8, 10])

    def test_named_values_with_no_comparison_word_are_a_key_not_a_comparison(self):
        self.assertIsNone(S.scan_spec(board("a=4, b=8, c=10")))

    def test_one_named_value_is_not_a_comparison(self):
        self.assertIsNone(S.scan_spec(board("heavier", "cake=10")))

    def test_more_than_three_items_refuse_because_the_engine_calls_that_sorting(self):
        # compare_size.js:46 THROWS above 3, and a throw prints a dashed
        # "DIAGRAM - not rendered" box, which is worse for the teacher than no figure.
        self.assertIsNone(S.scan_spec(board(
            "compare", "a=1, b=2, c=3, d=4")))

    def test_all_equal_sizes_refuse_because_there_is_nothing_to_compare(self):
        # compare_size.js:51 THROWS when every size matches.
        self.assertIsNone(S.scan_spec(board("heavier", "Bunty=2, Babloo=2")))

    def test_an_arithmetic_fragment_is_never_taken_as_an_item_name(self):
        # Real board: "4 x 4 = 16" and "3 x 3 x 3 = 27" are calculations. Reading
        # "x 4" and "x 3 x 3" as the names of things being compared is nonsense.
        self.assertIsNone(S.scan_spec(board(
            "compare squared and cubed", "4 x 4 = 16", "3 x 3 x 3 = 27")))

    def test_a_non_numeric_value_is_dropped_not_guessed(self):
        # "BALANCE SCALE = the tool for mass" must never become an item.
        spec = S.scan_spec(board(
            "heavier", "BALANCE SCALE = the tool for mass",
            "lettuce=4, carrot=8"))
        self.assertEqual([i["label"] for i in spec["items"]], ["lettuce", "carrot"])


class AScaleBecomesANumberLine(unittest.TestCase):
    # g1_ch8/Maths_seg10.lp.json
    def test_an_evenly_spaced_scale_list_becomes_a_number_line(self):
        spec = S.scan_spec(board("scale: 0, 10, 20, 30, 40, 50, 60 (degrees Celsius)"))
        self.assertEqual(spec["type"], "numberline")
        self.assertEqual((spec["from"], spec["to"], spec["step"]), (0, 60, 10))

    def test_an_unevenly_spaced_list_refuses_rather_than_invent_a_step(self):
        self.assertIsNone(S.scan_spec(board("scale: 0, 10, 25, 60")))

    def test_an_explicit_range_beside_a_thermometer_becomes_a_number_line(self):
        spec = S.scan_spec(board("thermometer = a number line", "marked 0 to 50"))
        self.assertEqual((spec["from"], spec["to"]), (0, 50))

    def test_a_descending_range_refuses(self):
        self.assertIsNone(S.scan_spec(board("ruler marked 50 to 0")))


class ACountBecomesATenFrame(unittest.TestCase):
    # g1_ch8/Maths_seg3.lp.json
    def test_a_stated_count_of_objects_becomes_a_ten_frame(self):
        spec = S.scan_spec(board(
            "ROCKET drawn over: 3 blocks long (count only the filled cells)"))
        self.assertEqual(spec["type"], "count_frame")
        self.assertEqual(spec["count"], 3)

    def test_two_different_counts_refuse_because_one_frame_shows_one_number(self):
        self.assertIsNone(S.scan_spec(board("4 dots then 7 dots, which row is longer?")))

    def test_a_count_past_the_frame_capacity_refuses(self):
        self.assertIsNone(S.scan_spec(board("40 blocks in the tower")))


class TheScanRefusesRatherThanDegrade(unittest.TestCase):
    def test_a_non_board_is_none(self):
        for junk in (None, "board", 7, [], {}):
            self.assertIsNone(S.scan_spec(junk))

    def test_a_board_with_no_panels_is_none(self):
        self.assertIsNone(S.scan_spec({"title": None, "panels": [], "instruction": ""}))

    def test_a_lint_fatal_placeholder_in_real_board_text_refuses(self):
        self.assertIsNone(S.scan_spec(board("RECTANGLE TODO", "4 sides, 4 corners")))

    def test_a_hex_colour_in_real_board_text_refuses(self):
        self.assertIsNone(S.scan_spec(board("RECTANGLE #A1B2C3", "4 sides, 4 corners")))

    def test_no_spec_ever_sets_a_colour_field(self):
        spec = S.scan_spec(board("RECTANGLE", "4 sides, 4 corners"))
        self.assertNotIn("fill", spec)
        self.assertNotIn("color", spec)


class UrduBoardsAreMeasuredInCodePointsAndCarryLang(unittest.TestCase):
    def test_an_urdu_board_sets_lang_ur(self):
        spec = S.scan_spec(board("پیمانہ: 0, 10, 20, 30 ۔", "number line"))
        self.assertEqual(spec["lang"], "ur")

    def test_an_english_board_never_sets_lang(self):
        spec = S.scan_spec(board("scale: 0, 10, 20, 30"))
        self.assertNotIn("lang", spec)


class AWrongComparisonIsRefusedRatherThanDrawn(unittest.TestCase):
    """g2_ch9/Maths_seg4 and g5_ch9/Maths_seg5 on the real 335-doc D0 build.

    Both rendered cleanly and both taught something false, so neither is caught
    by an ink floor or a degeneracy check. They are caught here, on the defect.
    """

    def test_a_unit_torn_off_the_previous_value_refuses_the_whole_comparison(self):
        # g2_ch9/Maths_seg4, verbatim. _NAMED_VALUE reads a label up to the nearest
        # comma or newline, so the "g" of "250 g" starts the NEXT label and the
        # teacher sees "g Babloo: clay pot" printed on the figure.
        self.assertIsNone(S.scan_spec(board(
            "Question: How much weight needs to be added to make the balance equal?",
            "Bunty: wooden bird = 250 g     Babloo: clay pot = 650 g")))

    def test_exponent_vocabulary_is_not_a_set_of_comparable_magnitudes(self):
        # g5_ch9/Maths_seg5, verbatim. "small 2 = squared = 2 factors" parses as a
        # thing called "squared" of size 2. x^2 and x^3 are notations, not sizes,
        # and a bar chart of 2 against 3 asserts a magnitude that does not exist.
        self.assertIsNone(S.scan_spec(board(
            "Draw a smaller diamond in the centre.",
            "small 2 = squared = 2 factors",
            "small 3 = cubed = 3 factors")))

    def test_the_urdu_spelling_of_squared_and_cubed_is_refused_too(self):
        self.assertIsNone(S.scan_spec(board(
            "compare these", "مربع=2, مکعب=3")))

    def test_a_real_balance_board_still_draws(self):
        # g1_ch8/Maths_seg6, verbatim -- the one live compare_size that is sound.
        spec = S.scan_spec(board(
            "BALANCE SCALE = the tool for mass",
            "DOWN side = heavier, UP side = lighter",
            "lettuce=4, carrot=8, cake=10 (buttons)",
            "lightest -> heaviest: lettuce, carrot, cake"))
        self.assertEqual(spec["type"], "compare_size")
        self.assertEqual([i["label"] for i in spec["items"]],
                         ["lettuce", "carrot", "cake"])


class ALangTagThatTheLabelsDoNotSupportIsDropped(unittest.TestCase):
    def test_english_labels_on_an_urdu_board_do_not_carry_lang_ur(self):
        spec = S.scan_spec(board(
            "compare these", "cake=10, pie=4", "یہ تصویر بورڈ پر بنائیں"))
        self.assertNotIn("lang", spec)

    def test_urdu_labels_still_carry_lang_ur(self):
        spec = S.scan_spec(board("compare these", "سیب=4, آم=9"))
        self.assertEqual(spec["lang"], "ur")

    def test_a_spec_with_no_text_at_all_keeps_the_boards_own_language(self):
        # numberline carries no label, caption or title: there is nothing for the
        # tag to contradict, and g3_ch8/Maths_seg3 is exactly this spec live.
        spec = S.scan_spec(board("پیمانہ: 0, 10, 20, 30 ۔", "number line"))
        self.assertEqual(spec["lang"], "ur")


if __name__ == "__main__":
    unittest.main()
