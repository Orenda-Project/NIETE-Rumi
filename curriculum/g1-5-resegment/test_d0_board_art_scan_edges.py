"""Boundary + contract tests for d0_board_art_scan (bd-f2khb).

Every test here was written to KILL a specific surviving mutant from the lane's
mutation run. They are boundary and characterisation tests: the module's caps are
read off the ENGINE (compare_size.js:45-46, count_frame.js MAX), so a cap that
drifts silently is a silent blank waiting to happen (trap A, bd-6v5gh).
"""
import d0_board_art_scan as S


def board(*lines, title=None, label=None):
    rows = [{"kind": "text", "text": ln, "term": None, "gloss": None, "cells": None}
            for ln in lines]
    return {"title": title, "panels": [{"label": label, "rows": rows}],
            "instruction": ""}


# --- the shape table is a designed constant, not an accident ----------------

def test_the_shape_outlines_are_the_exact_closed_polygons_they_were_designed_as():
    assert S._SHAPE_POINTS == {
        "triangle": [[0, 0], [4, 0], [2, 3.2]],
        "square": [[0, 0], [3, 0], [3, 3], [0, 3]],
        "rectangle": [[0, 0], [4, 0], [4, 2.4], [0, 2.4]],
        "circle": None,
        "pentagon": [[2, 4], [4.3, 2.3], [3.4, -0.5], [0.6, -0.5], [-0.3, 2.3]],
        "hexagon": [[1, 3.6], [3, 3.6], [4, 2], [3, 0.4], [1, 0.4], [0, 2]],
    }


def test_every_outline_is_a_closed_shape_with_no_repeated_vertex():
    for name, pts in S._SHAPE_POINTS.items():
        if pts is None:
            continue
        assert len(pts) >= 3, name
        assert len({tuple(p) for p in pts}) == len(pts), name


# --- count_frame: the engine's own capacity --------------------------------

def test_a_frame_of_exactly_twenty_is_drawn_and_twenty_one_is_refused():
    assert S.scan_spec(board("20 blocks"))["count"] == 20
    assert S.scan_spec(board("21 blocks")) is None


def test_a_frame_of_one_is_drawn_and_zero_is_refused():
    assert S.scan_spec(board("1 block"))["count"] == 1
    assert S.scan_spec(board("0 blocks")) is None


# --- compare_size: 2..3, the engine THROWS outside it ----------------------

def _cmp(*pairs):
    # the comparison word goes on its OWN line: _NAMED_VALUE reads a label up to the
    # nearest comma or newline, so a "compare:" prefix would be swallowed into it.
    return board("compare these", ", ".join("%s=%s" % p for p in pairs))


def test_two_named_values_compare_and_one_alone_does_not():
    assert len(S.scan_spec(_cmp(("cake", 10), ("pie", 4)))["items"]) == 2
    assert S.scan_spec(_cmp(("cake", 10))) is None


def test_three_named_values_compare_and_four_are_a_sorting_exercise():
    got = S.scan_spec(_cmp(("cake", 10), ("pie", 4), ("bun", 7)))
    assert len(got["items"]) == 3
    assert S.scan_spec(_cmp(("cake", 10), ("pie", 4), ("bun", 7), ("jam", 2))) is None


def test_things_that_are_all_the_same_size_are_refused_not_drawn():
    assert S.scan_spec(_cmp(("cake", 5), ("pie", 5))) is None


def test_a_value_of_zero_is_not_a_thing_with_a_size():
    assert S.scan_spec(_cmp(("cake", 0), ("pie", 4))) is None


def test_a_label_of_eighteen_code_points_fits_and_nineteen_does_not():
    assert len([*("a" * 17 + "b")]) == 18
    assert S.scan_spec(_cmp(("a" * 17 + "b", 10), ("pie", 4))) is not None
    assert S.scan_spec(_cmp(("a" * 18 + "b", 10), ("pie", 4))) is None


def test_the_same_name_in_a_different_case_is_the_same_thing():
    assert S.scan_spec(_cmp(("Cat", 4), ("CAT", 9), ("dog", 2)))["items"] == [
        {"label": "Cat", "size": 4}, {"label": "dog", "size": 2}]


def test_an_arithmetic_fragment_is_not_the_name_of_a_thing():
    # "x 4" and "+ 45 min" are calculation, not things being compared.
    assert S.scan_spec(board("compare these", "4 x 4 = 16, (2 x 60) + 45 = 165")) is None


def test_a_name_with_no_two_letters_is_refused_even_though_it_has_no_operator():
    assert S.scan_spec(_cmp(("a", 10), ("b", 4))) is None


# --- geometry --------------------------------------------------------------

def test_a_triangle_is_drawn_as_a_triangle_and_a_square_as_a_polygon():
    assert S.scan_spec(board("a triangle has 3 sides"))["shapes"][0]["kind"] == "triangle"
    assert S.scan_spec(board("a square has 4 sides"))["shapes"][0]["kind"] == "polygon"


def test_a_circle_is_drawn_from_a_centre_and_a_radius_not_a_point_list():
    got = S.scan_spec(board("a circle has 0 corners and 1 face"))["shapes"][0]
    assert got == {"kind": "circle", "c": [0, 0], "r": 2}


def test_the_caption_is_lower_cased_so_the_same_count_said_twice_is_said_once():
    got = S.scan_spec(board("a square has", "4 SIDES", "4 sides", "4 corners"))
    assert got["caption"] == "4 sides, 4 corners"


def test_two_named_shapes_cannot_be_drawn_as_the_shape():
    assert S.scan_spec(board("a square and a triangle have 4 sides")) is None


# --- numberline ------------------------------------------------------------

def test_an_evenly_spaced_fractional_list_keeps_its_real_step():
    assert S.scan_spec(board("scale: 0.5, 1, 1.5, 2")) == {
        "type": "numberline", "from": 0.5, "to": 2, "step": 0.5}


def test_a_descending_list_is_refused_rather_than_given_a_negative_step():
    assert S.scan_spec(board("scale: 10, 8, 6, 4")) is None


def test_an_unevenly_spaced_list_is_refused_rather_than_given_an_invented_step():
    # 1,2,4,8 doubles; there is no one step, and no "to"-range to fall back on.
    assert S.scan_spec(board("ruler: 1, 2, 4, 8")) is None


def test_a_range_that_does_not_ascend_is_not_a_line():
    assert S.scan_spec(board("thermometer 50 to 10")) is None


# --- the blob: title and panel label are authored words too -----------------

def test_a_signal_carried_only_by_the_title_still_reaches_the_scan():
    got = S.scan_spec(board("0, 10, 20", title="Thermometer scale"))
    assert got["type"] == "numberline"


def test_a_signal_carried_only_by_the_panel_label_still_reaches_the_scan():
    got = S.scan_spec(board("0, 10, 20", label="Thermometer scale"))
    assert got["type"] == "numberline"


def test_the_title_reaches_the_spec_trimmed():
    got = S.scan_spec(board("scale: 0, 10, 20", title="  Thermometer  "))
    assert got["title"] == "Thermometer"


# --- rule 20: Urdu is measured in CODE POINTS ------------------------------

def test_three_urdu_letters_mark_the_board_urdu_and_two_do_not():
    assert S._is_urdu("پیم") is True
    assert S._is_urdu("پی") is False


def test_an_urdu_terminal_mark_is_not_an_urdu_letter():
    # U+06D4 and U+061F are punctuation; a board of nothing but marks is not Urdu.
    assert S._is_urdu("۔۔۔؟") is False


def test_an_urdu_board_carries_lang_and_an_english_one_does_not():
    assert S.scan_spec(board("پیمانہ: 0, 10, 20"))["lang"] == "ur"
    assert "lang" not in S.scan_spec(board("scale: 0, 10, 20"))


# --- refusals are None, never an empty dict --------------------------------

def test_a_board_that_is_not_a_dict_is_refused():
    assert S.scan_spec("not a board") is None
    assert S.scan_spec(None) is None


def test_panels_that_are_not_a_list_are_refused_rather_than_walked():
    assert S.scan_spec({"title": None, "panels": "scale: 0, 10, 20"}) is None
    assert S.scan_spec({"title": None, "panels": []}) is None


def test_an_unfinished_board_gets_no_confident_figure():
    assert S.scan_spec(board("TODO: scale 0, 10, 20")) is None
    assert S.scan_spec(board("scale 0, 10, 20 #ff0000")) is None


def test_a_spec_only_placeholder_in_the_emitted_spec_refuses_on_its_own():
    # "<foo>" carries neither TODO nor a hex colour: each half of the guard must
    # be able to refuse by itself.
    assert S._finish({"type": "numberline", "title": "<foo>"}, "scale", {}) is None
    assert S._finish({"type": "numberline", "title": "[ ]"}, "scale", {}) is None
    assert S._finish({"type": "numberline", "title": "ok"}, "scale", {}) is not None


def test_a_size_of_exactly_one_is_a_real_size():
    # the floor is "greater than zero", not "greater than one".
    assert S.scan_spec(_cmp(("cake", 1), ("pie", 4)))["items"] == [
        {"label": "cake", "size": 1}, {"label": "pie", "size": 4}]


def test_a_list_that_never_moves_is_not_a_line():
    # step 0 is not a step; the floor is "greater than zero", not "at least zero".
    assert S.scan_spec(board("scale: 5, 5, 5")) is None


def test_a_board_whose_every_row_is_blank_is_refused_as_none():
    blank = {"title": None, "instruction": "",
             "panels": [{"label": None, "rows": [
                 {"kind": "text", "text": "", "term": None, "gloss": None, "cells": None}]}]}
    assert S.scan_spec(blank) is None


# --- the signal-word vocabularies -------------------------------------------
#
# Each word in each vocabulary is a PROMISE: a teacher who writes it on the board
# gets that figure. Before these tests every one of those promises but one was
# untested, so dropping any single word from any vocabulary was a silent, passing
# change. Maths boards are written in capitals as often as not, hence the upper()
# half of each loop.

def test_every_clock_word_opens_a_clock_face():
    for word in ("clock", "clocks", "hour hand", "minute hand"):
        for text in (word, word.upper()):
            assert S.scan_spec(board(text, "09:00"))["type"] == "clock", text


def test_a_minute_past_fifty_nine_is_not_a_time_on_a_clock():
    assert S.scan_spec(board("clock", "09:65")) is None


def test_every_comparison_word_opens_a_comparison():
    for word in ("heavier", "lighter", "heaviest", "lightest", "longer", "shorter",
                 "longest", "shortest", "taller", "tallest", "bigger", "smaller",
                 "mass", "compare", "balance"):
        for text in (word, word.upper()):
            got = S.scan_spec(board(text, "cake=10, pie=4"))
            assert got is not None and got["type"] == "compare_size", text


def test_every_counted_part_of_a_shape_is_read_as_a_count():
    for word in ("side", "sides", "corner", "corners", "edge", "edges",
                 "face", "faces", "vertices", "vertex"):
        for text in (word, word.upper()):
            got = S.scan_spec(board("triangle", "3 " + text))
            assert got is not None and got["type"] == "geometry", text
            assert got["caption"] == "3 " + word.lower()


def test_every_number_line_word_opens_a_number_line():
    for word in ("number line", "numberline", "ruler", "thermometer", "scale", "پیمانہ"):
        for text in (word, word.upper()):
            got = S.scan_spec(board(text, "0, 10, 20, 30"))
            assert got is not None and got["type"] == "numberline", text


def test_every_countable_thing_fills_a_ten_frame():
    for word in ("block", "dot", "stone", "bead", "stick", "cube",
                 "counter", "square", "tile", "button"):
        for text in (word, word + "s", word.upper()):
            got = S.scan_spec(board("7 " + text))
            assert got is not None and got["type"] == "count_frame", text
            assert got["count"] == 7


def test_every_unfinished_marker_refuses_the_whole_board():
    for word in ("TODO", "FIXME", "TBD", "XXX", "lorem ipsum", "INSERT", "PLACEHOLDER"):
        for text in (word, word.lower()):
            assert S.scan_spec(board("7 blocks", text)) is None, text


def test_every_range_dash_is_read_as_a_range():
    for sep in ("to", "-", "–", "—"):
        got = S.scan_spec(board("number line", "0 %s 10" % sep))
        assert got is not None and (got["from"], got["to"]) == (0, 10), sep


def test_a_range_that_ends_where_it_starts_is_not_a_line():
    assert S.scan_spec(board("number line", "5 to 5")) is None


def test_a_label_is_stripped_of_its_bullet_and_dash():
    got = S.scan_spec(board("compare these", "- cake = 10", "- pie = 4"))
    assert [i["label"] for i in got["items"]] == ["cake", "pie"]
