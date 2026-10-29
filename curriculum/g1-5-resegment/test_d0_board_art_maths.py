"""Tests for d0_board_art_maths.py -- the maths-only spec builders.

TDD red-before-green: this file is written before d0_board_art_maths.py exists,
so the first run must fail on import.

Board/Panel/Row contract (owned by the not-yet-existing d0_board_read.py -- we
code against the shape only, never import that module):
    Row   = {"kind": str, "text": str, "term": str|None, "gloss": str|None,
              "cells": list[str]|None}
    Panel = {"label": str|None, "rows": list[Row]}
    Board = {"title": str|None, "panels": list[Panel], "instruction": str}

Each try_*(rows, meta) here takes the ALREADY-panel-scoped row list (spec_for
in d0_board_art.py is what enforces "exactly one panel") and a meta dict of
{"title": str|None, "instruction": str}.
"""

from d0_board_art_maths import try_calc, try_clock, try_geometry, try_money, try_numberline


def _row(kind, text="", term=None, gloss=None, cells=None):
    return {"kind": kind, "text": text, "term": term, "gloss": gloss, "cells": cells}


def _meta(instruction=""):
    return {"title": None, "instruction": instruction}


# ── clock ─────────────────────────────────────────────────────────────────


def test_clock_from_explicit_single_time():
    rows = [_row("frame", "Draw a clock. The hour hand points near 3 and the "
                          "minute hand at 6, showing 3:30.")]
    spec = try_clock(rows, _meta())
    assert spec["type"] == "clock"
    assert spec["time"] == "3:30"
    assert spec["alt"]


def test_clock_refuses_when_two_times_are_stated():
    rows = [_row("frame", "First the clock reads 3:30, then later it reads 4:15.")]
    assert try_clock(rows, _meta()) is None


def test_clock_refuses_without_clock_vocabulary():
    # a bare time with no clock/hour-hand/minute-hand word isn't a clock board
    rows = [_row("frame", "The bus leaves at 3:30 sharp.")]
    assert try_clock(rows, _meta()) is None


def test_clock_refuses_non_text_row_kinds():
    rows = [_row("table", "clock shows 3:30", cells=["a", "b"])]
    assert try_clock(rows, _meta()) is None


# ── numberline ───────────────────────────────────────────────────────────


def test_numberline_from_stated_range():
    rows = [_row("frame", "Draw a number line from 0 to 10 with marks every 2.")]
    spec = try_numberline(rows, _meta())
    assert spec["type"] == "numberline"
    assert spec["from"] == 0
    assert spec["to"] == 10
    assert spec["alt"]


def test_numberline_refuses_without_a_stated_range():
    rows = [_row("frame", "Draw a number line and mark some points on it.")]
    assert try_numberline(rows, _meta()) is None


def test_numberline_refuses_without_numberline_vocabulary():
    rows = [_row("frame", "Count from 0 to 10 on your fingers.")]
    assert try_numberline(rows, _meta()) is None


# ── geometry ─────────────────────────────────────────────────────────────


def test_geometry_triangle_with_stated_counts():
    rows = [_row("frame", "A triangle has 3 sides and 3 corners.")]
    spec = try_geometry(rows, _meta())
    assert spec["type"] == "geometry"
    assert spec["shapes"][0]["kind"] == "triangle"
    assert "3 sides" in spec["caption"]
    assert "3 corners" in spec["caption"]


def test_geometry_refuses_when_no_count_is_stated():
    rows = [_row("frame", "Draw a triangle on the board.")]
    assert try_geometry(rows, _meta()) is None


def test_geometry_refuses_when_more_than_one_shape_is_named():
    rows = [_row("frame", "A triangle has 3 sides, a square has 4 sides.")]
    assert try_geometry(rows, _meta()) is None


def test_geometry_refuses_unsupported_3d_shape():
    # geometry.js only draws 2-D polygons/circles/lines/angles -- a cube isn't one
    rows = [_row("frame", "A cube has 6 faces, 12 edges and 8 vertices.")]
    assert try_geometry(rows, _meta()) is None


# ── money ────────────────────────────────────────────────────────────────


def test_money_from_stated_values():
    rows = [_row("frame", "Draw a Rs 10 coin and a Rs 50 note.")]
    spec = try_money(rows, _meta())
    assert spec["type"] == "money"
    values = {(it["value"], it["kind"]) for it in spec["items"]}
    assert (10, "coin") in values
    assert (50, "note") in values


def test_money_refuses_without_a_stated_value():
    rows = [_row("frame", "Draw some coins and notes on the board.")]
    assert try_money(rows, _meta()) is None


def test_money_refuses_more_than_twelve_pieces():
    text = " ".join(f"Rs {n} coin" for n in range(1, 14))
    rows = [_row("frame", text)]
    assert try_money(rows, _meta()) is None


# ── calc -> fraction_bar (never grid; grid's cells are square, see module docstring) ──


def test_calc_single_fraction_row_becomes_fraction_bar():
    rows = [_row("calc", "3/8 of the shape is shaded")]
    spec = try_calc(rows, _meta())
    assert spec["type"] == "fraction_bar"
    assert spec["bars"][0]["parts"] == 8
    assert spec["bars"][0]["shaded"] == 3


def test_calc_refuses_without_a_fraction():
    rows = [_row("calc", "2 x 60 = 120")]
    assert try_calc(rows, _meta()) is None


def test_calc_refuses_multi_row_chain():
    # grid cells are square (see d0_board_art_maths module docstring) so a
    # multi-line calc chain has no honest single-diagram representation here
    rows = [_row("calc", "12.8 cm -> 128 mm"), _row("calc", "128 mm - 59 mm = 69 mm")]
    assert try_calc(rows, _meta()) is None


def test_calc_refuses_improper_or_oversized_fraction():
    rows = [_row("calc", "9/8 of the pizza")]
    assert try_calc(rows, _meta()) is None
