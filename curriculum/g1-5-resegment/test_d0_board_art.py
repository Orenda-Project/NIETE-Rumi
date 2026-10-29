"""Tests for d0_board_art.py -- spec_for(board) -> renderDiagram spec, or None.

TDD red-before-green: written before d0_board_art.py exists.

WHOLE-BOARD-COVERAGE RULE (bd-e1e65 coordinator correction): the spec this
module returns REPLACES the entire board block outright (d0_diagram.py:105
overwrites section["blocks"][i]), so spec_for must refuse whenever the board
has content a chosen diagram type can't also carry -- a second panel, a row
of a different kind. Losing content silently is worse than refusing outright.

We never import d0_board_read (the sibling's reader) -- fixture dicts here are
built by hand, matching its documented output shape:
    Row   = {"kind": str, "text": str, "term": str|None, "gloss": str|None,
              "cells": list[str]|None}
    Panel = {"label": str|None, "rows": list[Row]}
    Board = {"title": str|None, "panels": list[Panel], "instruction": str}
"""

import json
import re

from d0_board_art import spec_for

HEX_RE = re.compile(r"#[0-9A-Fa-f]{6}")


def _row(kind, text="", term=None, gloss=None, cells=None):
    return {"kind": kind, "text": text, "term": term, "gloss": gloss, "cells": cells}


def _board(rows, title=None, instruction="", label=None):
    return {"title": title, "instruction": instruction, "panels": [{"label": label, "rows": rows}]}


def _no_hex_anywhere(spec):
    return not HEX_RE.search(json.dumps(spec))


# ── grid from a uniform table ───────────────────────────────────────────


def _shape_table_board():
    rows = [
        _row("table", cells=["Shape", "Sides", "Corners"]),
        _row("table", cells=["Triangle", "3", "3"]),
        _row("table", cells=["Square", "4", "4"]),
        _row("table", cells=["Circle", "0", "0"]),
    ]
    return _board(rows, title="Shape facts", instruction="Draw this table on the board.")


def test_uniform_table_becomes_grid():
    spec = spec_for(_shape_table_board())
    assert spec is not None
    assert spec["type"] == "grid"
    assert spec["rows"] == 4
    assert spec["cols"] == 3
    assert len(spec["cellText"]) == 12
    assert spec["alt"]
    assert _no_hex_anywhere(spec)


def test_ragged_table_refuses():
    rows = [
        _row("table", cells=["Shape", "Sides", "Corners"]),
        _row("table", cells=["Triangle", "3"]),  # missing a column
    ]
    assert spec_for(_board(rows)) is None


def test_table_with_blank_cell_refuses():
    rows = [
        _row("table", cells=["Shape", "Sides"]),
        _row("table", cells=["Triangle", ""]),
    ]
    assert spec_for(_board(rows)) is None


def test_narrow_table_tolerates_long_cell_text():
    # 2 columns: engine-verified legible up to ~20 chars/cell (renderedPx 18.72
    # at cap=20, measured against the real engine -- see d0_board_art module
    # docstring's calibration note).
    rows = [
        _row("table", cells=["Term", "Meaning"]),
        _row("table", cells=["capacity", "how much a container can hold ok"[:20]]),
    ]
    spec = spec_for(_board(rows))
    assert spec is not None
    assert spec["type"] == "grid"


def test_wide_table_refuses_long_cell_text():
    # 6 columns: the same 20-char cell that is fine at 2 columns is NOT fine at
    # 6 -- grid.js's MAX_BODY=640 width budget is shared across all columns, so
    # more columns means a much lower per-cell character budget (engine-verified:
    # 6 cols caps out around 6 chars/cell, see module docstring).
    header = _row("table", cells=["A", "B", "C", "D", "E", "F"])
    long_row = _row("table", cells=["short", "short", "short", "short", "short", "a much longer cell value here"])
    assert spec_for(_board([header, long_row])) is None


# ── gloss -> grid (default) or match (with a matching-signal instruction) ──


def _gloss_rows(n=3):
    # Meanings kept under the 2-column legibility cap (engine-verified ~20
    # chars/cell, see d0_board_art module docstring) -- a longer meaning is
    # exactly the real-corpus shape that must REFUSE, covered separately by
    # test_gloss_grid_refuses_when_meaning_too_long below.
    words = [("capacity", "how much it holds"), ("mass", "how heavy it is"),
             ("length", "how long it is")][:n]
    return [_row("gloss", term=t, gloss=g) for t, g in words]


def test_gloss_pairs_default_to_grid():
    board = _board(_gloss_rows(3), instruction="Copy this vocabulary list.")
    spec = spec_for(board)
    assert spec["type"] == "grid"
    assert spec["cols"] == 2
    assert spec["rows"] == 3


def test_gloss_grid_refuses_when_meaning_too_long():
    # This is the real bug found during corpus verification: a term/meaning
    # pair this long rendered at 11.2px against a 15.5px floor (engine-
    # verified), well below legibility, even though nothing THROWS. A spec
    # that renders but can't be read is worse than the refusal.
    rows = [
        _row("gloss", term="capacity", gloss="how much a container can hold"),
        _row("gloss", term="mass", gloss="how heavy something really is"),
    ]
    assert spec_for(_board(rows)) is None


def test_gloss_pairs_become_match_with_matching_instruction():
    board = _board(_gloss_rows(3), instruction="Draw a line to match each term to its meaning.")
    spec = spec_for(board)
    assert spec["type"] == "match"
    assert len(spec["left"]) == 3
    assert len(spec["right"]) == 3


def test_gloss_missing_meaning_refuses():
    rows = [_row("gloss", term="capacity", gloss=None, text="")]
    assert spec_for(_board(rows)) is None


# ── flow from an arrow chain ────────────────────────────────────────────


def test_arrow_chain_becomes_flow():
    rows = [
        _row("arrow", "Different units"),
        _row("arrow", "Convert to same unit"),
        _row("arrow", "Add or subtract"),
        _row("arrow", "Write answer with unit"),
    ]
    spec = spec_for(_board(rows))
    assert spec["type"] == "flow"
    assert len(spec["steps"]) == 4


def test_single_arrow_row_refuses():
    rows = [_row("arrow", "Only one step")]
    assert spec_for(_board(rows)) is None


def test_flow_refuses_long_step_text():
    rows = [
        _row("arrow", "a" * 60),
        _row("arrow", "short"),
    ]
    assert spec_for(_board(rows)) is None


def test_multi_row_arrow_refuses_when_each_row_is_its_own_mini_chain():
    # Real-corpus bug: 3 INDEPENDENT phonics items, each already its own
    # "word -> blank" arrow (its own 2-item `cells`). Chaining rows into one
    # flow draws a false sequence between unrelated words -- refuse, don't render.
    rows = [
        _row("arrow", "s-u-nn-y -> ____", cells=["s-u-nn-y", "____"]),
        _row("arrow", "gr-ou-nd -> ____", cells=["gr-ou-nd", "____"]),
        _row("arrow", "h-ur-t -> ____", cells=["h-ur-t", "____"]),
    ]
    assert spec_for(_board(rows)) is None


def test_single_row_arrow_chain_with_cells_becomes_flow():
    # d0_board_read.py parses a one-line chain ("A -> B -> C") into a SINGLE
    # arrow row with the hops in `cells`, not one row per hop -- the dominant
    # real-world shape, so spec_for must read `cells`, not just multi-row `text`.
    rows = [
        _row(
            "arrow",
            "Different units -> Convert to same unit -> Add or subtract -> Write answer with unit",
            cells=["Different units", "Convert to same unit", "Add or subtract", "Write answer with unit"],
        )
    ]
    spec = spec_for(_board(rows))
    assert spec is not None
    assert spec["type"] == "flow"
    assert len(spec["steps"]) == 4


def test_single_row_arrow_with_one_cell_refuses():
    rows = [_row("arrow", "Different units", cells=["Different units"])]
    assert spec_for(_board(rows)) is None


# ── pattern from slot rows ──────────────────────────────────────────────


def test_slot_sequence_with_one_blank_becomes_pattern():
    rows = [_row("slot", "circle"), _row("slot", "square"), _row("slot", "circle"),
            _row("slot", "square"), _row("slot", "?")]
    spec = spec_for(_board(rows))
    assert spec["type"] == "pattern"
    assert spec["items"].count("?") == 1
    assert len(spec["items"]) == 5


def test_pattern_refuses_without_a_blank():
    rows = [_row("slot", "circle"), _row("slot", "square"), _row("slot", "circle")]
    assert spec_for(_board(rows)) is None


def test_pattern_refuses_with_two_blanks():
    rows = [_row("slot", "circle"), _row("slot", "?"), _row("slot", "?"), _row("slot", "square")]
    assert spec_for(_board(rows)) is None


# ── word_blank from a single slot row ───────────────────────────────────


def test_single_slot_row_becomes_word_blank():
    rows = [_row("slot", "c _ t", term="cat")]
    spec = spec_for(_board(rows))
    assert spec["type"] == "word_blank"
    assert spec["word"] == "cat"
    assert spec["blanks"] == [1]


def test_word_blank_refuses_when_letters_disagree_with_term():
    rows = [_row("slot", "c _ x", term="cat")]
    assert spec_for(_board(rows)) is None


# ── whole-board-coverage refusals (the coordinator's correction) ───────


def test_second_panel_forces_refusal_even_when_first_panel_matches():
    board = {
        "title": None,
        "instruction": "",
        "panels": [
            {"label": None, "rows": [_row("arrow", "step one"), _row("arrow", "step two")]},
            {"label": None, "rows": [_row("text", "an unrelated note the diagram can't carry")]},
        ],
    }
    assert spec_for(board) is None


def test_mixed_kinds_in_one_panel_refuses():
    rows = [_row("table", cells=["a", "b"]), _row("arrow", "goes here")]
    assert spec_for(_board(rows)) is None


def test_empty_board_refuses():
    assert spec_for({"title": None, "instruction": "", "panels": []}) is None


def test_non_dict_input_refuses():
    assert spec_for(None) is None
    assert spec_for("not a board") is None


# ── placeholder / colour-trap guard ─────────────────────────────────────


def test_placeholder_bracket_in_cell_text_refuses():
    rows = [
        _row("table", cells=["Check", "Done"]),
        _row("table", cells=["Read the question", "[ ]"]),
    ]
    assert spec_for(_board(rows)) is None


def test_no_spec_ever_carries_a_literal_hex_colour():
    boards = [
        _shape_table_board(),
        _board(_gloss_rows(3), instruction="Match the terms."),
        _board([_row("arrow", "one"), _row("arrow", "two"), _row("arrow", "three")]),
    ]
    for board in boards:
        spec = spec_for(board)
        if spec is not None:
            assert _no_hex_anywhere(spec)
