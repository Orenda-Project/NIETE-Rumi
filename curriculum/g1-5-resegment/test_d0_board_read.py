"""d0_board_read: the board as a structured tree of typed rows, not a run-on string.

read_board(board_work) turns generated.boardWork {content, instruction} into
Board {title, panels, instruction}, where each panel's rows carry a `kind` tag
(table/arrow/slot/gloss/calc/boxart/step/frame/text) so a downstream renderer can
draw the board as an actual image instead of laid-out text. This module only reads
-- it never draws, never touches disk, never joins the corpus's own "\\n\\n" bug.
"""

import d0_board_read as R


def test_kinds_constant_matches_the_fixed_tuple():
    assert R.KINDS == ("table", "arrow", "slot", "gloss", "calc", "boxart",
                        "step", "frame", "text")


def test_empty_content_produces_an_empty_board_with_no_panels():
    board = R.read_board({"content": "", "instruction": "draw it"})
    assert board == {"title": None, "panels": [], "instruction": "draw it"}


def test_missing_instruction_defaults_to_empty_string():
    board = R.read_board({"content": "hello"})
    assert board["instruction"] == ""


def test_a_leading_standalone_line_above_other_groups_becomes_the_title():
    content = "CHAPTER 9 REVIEW: THE DANCING POEM\n\nREAD → EXPLAIN → ASK → WRITE"
    board = R.read_board({"content": content, "instruction": ""})
    assert board["title"] == "CHAPTER 9 REVIEW: THE DANCING POEM"
    assert len(board["panels"]) == 1


def test_a_single_group_board_has_no_title_even_if_it_is_one_line():
    board = R.read_board({"content": "just one line", "instruction": ""})
    assert board["title"] is None
    assert len(board["panels"]) == 1


def test_a_single_line_group_becomes_an_unlabeled_one_row_panel():
    content = "TITLE HERE\n\nREAD → EXPLAIN → ASK → WRITE"
    board = R.read_board({"content": content, "instruction": ""})
    panel = board["panels"][0]
    assert panel["label"] is None
    assert len(panel["rows"]) == 1


def test_a_colon_terminated_first_line_becomes_the_panel_label():
    content = "TITLE\n\nVocabulary:\nsway = move slowly side to side\ntwirl = spin around"
    board = R.read_board({"content": content, "instruction": ""})
    panel = board["panels"][0]
    assert panel["label"] == "Vocabulary:"
    assert len(panel["rows"]) == 2


def test_an_all_caps_short_first_line_becomes_the_panel_label():
    content = "TITLE\n\nCINQUAIN LADDER\n[1 word] Title\n[2 words] Describe"
    board = R.read_board({"content": content, "instruction": ""})
    panel = board["panels"][0]
    assert panel["label"] == "CINQUAIN LADDER"
    assert len(panel["rows"]) == 2


def test_content_arriving_as_a_list_is_supported():
    board = R.read_board({"content": ["a = one", "b = two"], "instruction": ""})
    assert len(board["panels"]) == 1
    assert len(board["panels"][0]["rows"]) == 2


def test_a_vocab_list_arriving_as_a_json_list_stays_one_panel():
    content = [
        "ROUND 1: vocabulary",
        "ROUND 2: capital letters",
        "ROUND 3: reading",
        "ROUND 4: position words",
    ]
    board = R.read_board({"content": content, "instruction": ""})
    assert len(board["panels"]) == 1
    assert len(board["panels"][0]["rows"]) == 4


def test_pipe_delimited_line_is_tagged_table_with_cells():
    row = R.read_board({"content": "| name | score |", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "table"
    assert row["cells"] == ["name", "score"]


def test_a_pipe_word_list_with_no_leading_or_trailing_pipe_is_still_table():
    row = R.read_board({"content": "butterfly | rose | seeds | bird", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "table"
    assert row["cells"] == ["butterfly", "rose", "seeds", "bird"]


def test_adjacent_pipes_used_as_tally_marks_are_not_tagged_table():
    row = R.read_board({"content": "sides ||| = 3", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] != "table"


def test_box_drawing_characters_are_tagged_boxart():
    row = R.read_board({"content": "┌────┐", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "boxart"


def test_hand_drawn_slash_and_backslash_shape_is_tagged_boxart():
    row = R.read_board({"content": "/____\\\\", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "boxart"


def test_a_slash_used_as_a_word_separator_is_not_tagged_boxart():
    row = R.read_board({"content": "has/have + past form", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] != "boxart"


def test_a_spaced_slash_word_choice_is_not_tagged_boxart():
    row = R.read_board({"content": "plant NEAR sofa / plant FAR from sofa", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] != "boxart"


def test_a_box_drawing_dash_run_ending_in_an_arrowhead_is_tagged_arrow_not_boxart():
    content = "Found  ─────────►  Lost"
    row = R.read_board({"content": content, "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "arrow"
    assert row["cells"] == ["Found", "Lost"]


def test_a_repeated_equals_sign_used_as_a_drawn_ruler_fill_is_not_tagged_calc():
    content = "Sewing machine bar: 0[============......]200, ending near 92"
    row = R.read_board({"content": content, "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] != "calc"


def test_a_long_prose_paragraph_with_an_incidental_equals_sign_is_not_tagged_calc():
    content = ("thermometer = a number line. Between two labelled tens there are 10 "
               "small sections. Each section = 1 degree. Count from the NEAREST "
               "labelled ten.")
    row = R.read_board({"content": content, "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] != "calc"


def test_a_worked_calculation_is_tagged_calc():
    row = R.read_board({"content": "P = 4 x L = 4 x 3 = 12 m", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "calc"


def test_subtraction_calculation_is_tagged_calc_not_gloss():
    row = R.read_board({"content": "5 l - 1 l = 4 l", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "calc"


def test_a_simple_arrow_chain_is_tagged_arrow_with_ordered_cells():
    row = R.read_board({"content": "sway -> may -> display", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "arrow"
    assert row["cells"] == ["sway", "may", "display"]


def test_bracketed_arrow_chain_strips_brackets_from_each_node():
    content = "[1 COMPOUND WORDS] -> [2 PARAGRAPHS] -> [3 QUANTIFIERS]"
    row = R.read_board({"content": content, "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "arrow"
    assert row["cells"] == ["1 COMPOUND WORDS", "2 PARAGRAPHS", "3 QUANTIFIERS"]


def test_a_multiplier_labelled_arrow_keeps_its_label_folded_into_the_node_text():
    row = R.read_board({"content": "[year] --×12--> [months]", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "arrow"
    assert row["cells"][0] == "year"
    assert "×12" in row["cells"][1] and "months" in row["cells"][1]


def test_a_long_unlabelled_dash_run_arrow_is_still_tagged_arrow():
    content = "8:30 am ------------------------------------> 6:30 pm"
    row = R.read_board({"content": content, "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "arrow"


def test_a_bracket_slot_is_tagged_slot():
    row = R.read_board({"content": "[1 box] Title", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "slot"


def test_a_blank_fill_line_is_tagged_frame():
    row = R.read_board({"content": "- I will ___ to help.", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "frame"


def test_arrow_outranks_frame_when_both_markers_are_on_one_line():
    row = R.read_board({"content": "s-u-nn-y  ->  ____", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "arrow"


def test_frame_outranks_a_leading_step_number_when_both_are_present():
    row = R.read_board({"content": "1. write your answer: ______", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "frame"


def test_slot_outranks_frame_and_step_when_all_three_are_present():
    content = "4. Write the time: [  ][  ] : [  ][  ]"
    row = R.read_board({"content": content, "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "slot"


def test_a_term_equals_gloss_line_is_tagged_gloss_with_term_and_gloss_populated():
    row = R.read_board({"content": "compare = look at the numbers", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "gloss"
    assert row["term"] == "compare"
    assert row["gloss"] == "look at the numbers"


def test_a_compound_word_breakdown_with_a_plus_sign_is_gloss_not_calc():
    row = R.read_board({"content": "Wheelbarrow = Wheel + Barrow", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "gloss"
    assert row["term"] == "Wheelbarrow"
    assert row["gloss"] == "Wheel + Barrow"


def test_a_numbered_line_with_no_other_marker_is_tagged_step():
    row = R.read_board({"content": "1. How did Pinky feel when she saw the bird?", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "step"


def test_urdu_extended_digit_with_urdu_full_stop_is_tagged_step():
    row = R.read_board({"content": "۱۔ میں چاند", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "step"


def test_an_unremarkable_line_defaults_to_text():
    row = R.read_board({"content": "just an ordinary sentence on the board", "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "text"


def test_row_text_field_preserves_the_original_line_unmodified():
    line = "Cone          1      1 flat + 1 curved = 2            1"
    row = R.read_board({"content": line, "instruction": ""})["panels"][0]["rows"][0]
    assert row["text"] == line


def test_non_populating_fields_stay_none_on_a_plain_text_row():
    row = R.read_board({"content": "just text", "instruction": ""})["panels"][0]["rows"][0]
    assert row["term"] is None
    assert row["gloss"] is None
    assert row["cells"] is None


def test_urdu_gloss_pair_round_trips_intact_at_the_code_point_level():
    content = "pronoun = ضَمِیر"
    row = R.read_board({"content": content, "instruction": ""})["panels"][0]["rows"][0]
    assert row["kind"] == "gloss"
    assert row["gloss"] == "ضَمِیر"
    assert len([*row["gloss"]]) == len([*"ضَمِیر"])


def test_blank_lines_between_panels_do_not_produce_empty_rows():
    content = "TITLE\n\nfirst panel line\n\nsecond panel line"
    board = R.read_board({"content": content, "instruction": ""})
    for panel in board["panels"]:
        assert all(row["text"].strip() for row in panel["rows"])


def test_instruction_is_passed_through_unchanged():
    board = R.read_board({"content": "x", "instruction": "Draw the five-line ladder."})
    assert board["instruction"] == "Draw the five-line ladder."
