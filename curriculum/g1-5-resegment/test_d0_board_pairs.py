"""A two-column pairing board is a MATCH picture, not a paragraph.

OPERATOR, bd-287sn: *"why is matching given in English instead of on the board?"*
Measured over the 335 ch9-10 boards, 60 panels are rows of exactly two arrow-joined
cells ("Found -> Lost", "Small -> Big"). `d0_board_art._try_flow` refuses every one
of them on purpose -- chaining independent pairs into one flow would draw a false
sequential relationship -- so they all fell through to the chalk text dump. They are
not a flow. They are a match, and `diagrams/types/match.js` draws exactly that.
"""
import d0_board_pairs


def _row(*cells):
    return {"kind": "arrow", "text": " -> ".join(cells), "cells": list(cells)}


META = {"title": "Opposites", "instruction": ""}


def test_two_column_arrow_rows_become_a_match():
    spec = d0_board_pairs.try_pairs(
        [_row("Found", "Lost"), _row("Small", "Big"), _row("Sad", "Happy")], META)
    assert spec["type"] == "match"
    assert spec["left"] == ["Found", "Small", "Sad"]
    assert spec["right"] == ["Lost", "Big", "Happy"]


def test_every_authored_word_reaches_the_picture():
    spec = d0_board_pairs.try_pairs([_row("Found", "Lost"), _row("Sad", "Happy")], META)
    blob = " ".join(spec["left"] + spec["right"])
    for word in ("Found", "Lost", "Sad", "Happy"):
        assert word in blob


def test_a_fill_in_the_blank_row_is_not_a_match():
    """`s-u-nn-y -> ____` is a blend to WRITE, not a pair to JOIN. Drawing it as a
    match would tell the child to join a word to an empty box."""
    assert d0_board_pairs.try_pairs(
        [_row("s-u-nn-y", "____"), _row("gr-ou-nd", "____")], META) is None


def test_one_row_is_not_a_pairing():
    assert d0_board_pairs.try_pairs([_row("Found", "Lost")], META) is None


def test_more_than_four_pairs_refuses_because_match_js_throws_above_four():
    """types/match.js:45 -- `more than 4 pairs does not fit a phone`. A spec the
    engine throws on renders a dashed 'not rendered' box, worse than no figure."""
    rows = [_row("a%d" % i, "b%d" % i) for i in range(5)]
    assert d0_board_pairs.try_pairs(rows, META) is None


def test_a_three_hop_row_is_a_chain_not_a_pair():
    assert d0_board_pairs.try_pairs(
        [_row("seed", "plant", "tree"), _row("egg", "chick", "hen")], META) is None


def test_a_non_arrow_row_refuses():
    assert d0_board_pairs.try_pairs(
        [_row("Found", "Lost"), {"kind": "text", "text": "Read page 40"}], META) is None


def test_a_long_entry_refuses_rather_than_render_below_the_legibility_floor():
    assert d0_board_pairs.try_pairs(
        [_row("Found", "L" * 40), _row("Sad", "Happy")], META) is None


def test_urdu_pairs_are_flagged_so_match_js_mirrors_the_columns():
    """match.js:50 keys the lettered column's side on spec.lang === 'ur'."""
    spec = d0_board_pairs.try_pairs(
        [_row("دن", "رات"), _row("گرم", "ٹھنڈا")], META)
    assert spec["lang"] == "ur"


def test_english_pairs_are_not_flagged_urdu():
    spec = d0_board_pairs.try_pairs([_row("Found", "Lost"), _row("Sad", "Happy")], META)
    assert spec.get("lang") != "ur"


def test_it_never_raises_on_junk():
    for junk in ([], [{}], [{"kind": "arrow"}], [{"kind": "arrow", "cells": None}]):
        assert d0_board_pairs.try_pairs(junk, META) is None


def test_panel_spec_reaches_this_builder_for_one_panel_of_many():
    """bd-287sn, and it lives here rather than beside `d0_board_art` because that
    suite is at the 300-line cap. `spec_for` keeps the whole-board rule for the
    REPLACE path; `panel_spec` is the same chain applied to one named panel, for
    the additive `page2.board_final.diagram` slot where nothing is replaced."""
    from d0_board_art import panel_spec

    board = {"title": "Opposites", "panels": []}
    panel = {"label": "Pairs", "rows": [
        {"kind": "arrow", "text": "Found -> Lost", "cells": ["Found", "Lost"]},
        {"kind": "arrow", "text": "Sad -> Happy", "cells": ["Sad", "Happy"]}]}
    spec = panel_spec(board, panel)
    assert spec["type"] == "match"
