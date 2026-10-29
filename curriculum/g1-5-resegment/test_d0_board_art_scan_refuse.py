"""The three refusals, unit by unit. Fixtures are the real g2_ch9 and g5_ch9
boards off the 335-doc D0 build, plus the near-misses each rule must NOT refuse.
"""

import d0_board_art_scan_refuse as R


# --- a unit torn off the previous value ------------------------------------

def test_the_g_of_250_g_opening_the_next_label_is_debris():
    assert R.debris_label("g Babloo: clay pot") is True


def test_the_same_label_without_the_torn_unit_is_a_real_name():
    assert R.debris_label("Babloo: clay pot") is False


def test_every_unit_in_the_class_is_recognised_whatever_its_case():
    for unit in ("g", "gm", "kg", "mg", "ml", "l", "cl", "dl", "mm", "cm", "m", "km"):
        assert R.debris_label(unit + " sack of wheat") is True
        assert R.debris_label(unit.upper() + " sack of wheat") is True


def test_min_is_not_in_the_class_because_min_temp_is_a_real_name():
    assert R.debris_label("min temp") is False
    assert R.debris_label("max temp") is False


def test_a_name_that_merely_starts_with_a_unit_letter_is_not_debris():
    # "grape" starts with "g" but the first WORD is "grape", not "g".
    assert R.debris_label("grape jam") is False
    assert R.debris_label("mango") is False


def test_an_empty_or_missing_label_is_not_debris():
    assert R.debris_label("") is False
    assert R.debris_label(None) is False


# --- exponent vocabulary ---------------------------------------------------

def test_the_two_live_exponent_labels_are_refused():
    assert R.exponent_label("squared") is True
    assert R.exponent_label("cubed") is True


def test_the_urdu_spellings_are_refused_and_are_four_code_points_each():
    # rule 20: code points, never bytes -- "مربع" is 4 letters and 8 bytes.
    assert len([*"مربع"]) == 4
    assert len([*"مکعب"]) == 4
    assert R.exponent_label("مربع") is True
    assert R.exponent_label("مکعب") is True


def test_power_wording_and_the_word_exponent_are_refused():
    assert R.exponent_label("to the power of 3") is True
    assert R.exponent_label("to the power three") is True  # the "of"-less phrasing
    assert R.exponent_label("power of ten") is True
    assert R.exponent_label("exponent") is True


def test_a_board_that_shouts_its_labels_is_refused_too():
    # maths boards are written in caps far more often than not.
    assert R.exponent_label("SQUARED") is True
    assert R.exponent_label("Cubed") is True


def test_the_shapes_square_and_cube_are_not_exponents():
    assert R.exponent_label("cube") is False
    assert R.exponent_label("square") is False


def test_an_ordinary_name_is_not_exponent_vocabulary():
    assert R.exponent_label("carrot") is False
    assert R.exponent_label(None) is False


# --- a lang tag the labels do not support ----------------------------------

ENGLISH_LABELS = {"type": "compare_size", "lang": "ur",
                  "items": [{"label": "squared", "size": 2},
                            {"label": "cubed", "size": 3}],
                  "caption": "smallest to largest: squared, cubed"}
URDU_LABELS = {"type": "compare_size", "lang": "ur",
               "items": [{"label": "سیب", "size": 4}, {"label": "آم", "size": 9}],
               "caption": "smallest to largest: آم, سیب"}


def test_visible_text_is_the_labels_captions_and_titles_only():
    assert R.visible_text(ENGLISH_LABELS) == [
        "squared", "cubed", "smallest to largest: squared, cubed"]


def test_visible_text_never_counts_engine_words_as_text():
    # "compare_size", "ur" and a shape "kind" are engine words, not board text.
    assert R.visible_text({"type": "geometry", "lang": "ur",
                           "shapes": [{"kind": "triangle"}]}) == []


def test_english_labels_under_a_ur_tag_are_incoherent():
    assert R.lang_unsupported(ENGLISH_LABELS) is True


def test_urdu_labels_under_a_ur_tag_are_coherent():
    assert R.lang_unsupported(URDU_LABELS) is False


def test_a_spec_with_no_visible_text_has_nothing_to_contradict():
    # g3_ch8/Maths_seg3 live: a numberline carries no label, caption or title.
    assert R.lang_unsupported(
        {"type": "numberline", "from": 1, "to": 10, "lang": "ur"}) is False


def test_a_title_is_visible_text_even_when_the_spec_has_no_labels():
    # clock carries no label or caption; the board title is all the teacher reads.
    assert R.lang_unsupported(
        {"type": "clock", "time": "9:00", "title": "Morning time", "lang": "ur"}) is True
    assert R.lang_unsupported(
        {"type": "clock", "time": "9:00", "title": "صبح کا وقت", "lang": "ur"}) is False


def test_a_spec_with_no_lang_tag_is_never_unsupported():
    assert R.lang_unsupported({"type": "compare_size",
                               "items": [{"label": "cake", "size": 10}]}) is False


def test_a_lang_that_is_not_ur_is_left_alone():
    assert R.lang_unsupported({"type": "compare_size", "lang": "en",
                               "caption": "cake and pie"}) is False


def test_something_that_is_not_a_spec_is_never_unsupported():
    assert R.lang_unsupported(None) is False
    assert R.lang_unsupported("lang") is False
