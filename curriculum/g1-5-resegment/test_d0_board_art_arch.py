"""Tests for d0_board_art_arch.py -- `_architect_spec`, split out of
d0_board_art_shapes.py purely to keep that file under the 300-line limit (see
this module's own docstring). Fixture is the REAL g4_ch10/Maths_seg10.lp.json
board content, byte-exact (confirmed against the corpus enrichment source).

bd-1fr0w fix #2: "Make the caption short: one line per shape, name plus P/A
formula, in English only. The full facts are already on the board text."
These tests are the RED-then-GREEN evidence for that fix.
"""

import unittest

import d0_board_art_arch as A


def _row(kind, text, cells=None, term=None, gloss=None):
    return {"kind": kind, "text": text, "term": term, "gloss": gloss, "cells": cells}


def _panel(label, *rows):
    return {"label": label, "rows": list(rows)}


def _board(*panels, title=None, instruction=""):
    return {"title": title, "panels": list(panels), "instruction": instruction}


_RECT_PANEL = _panel(
    "RECTANGULAR BUILDING PLOT",
    _row("boxart", "+----------------------+"),
    _row("gloss", "|                      |  width = W"),
    _row("text", "|     SHADE INSIDE     |"),
    _row("text", "|                      |"),
    _row("boxart", "+----------------------+"),
    _row("gloss", "       length = L"),
    _row("text", "Arrow around all outside edges: PERIMETER / محیط"),
    _row("text", "Arrow to shaded inside: AREA / رقبہ"),
    _row("calc", "P = 2 x (L + W) = 2L + 2W"),
    _row("gloss", "A = L x W = LW"),
)

_SQUARE_PANEL = _panel(
    "SQUARE PARK PLOT",
    _row("boxart", "+----------+"),
    _row("table", "| SHADE    | side = s"),
    _row("text", "| INSIDE   |"),
    _row("boxart", "+----------+"),
    _row("gloss", "All 4 sides = s"),
    _row("calc", "P = s + s + s + s = 4s"),
    _row("gloss", "A = s x s = s (squared)"),
)

_RECTILINEAR_PANEL = _panel(
    None,
    _row("text", "RECTILINEAR BUILDING OUTLINE (two rectangles joined)"),
    _row("boxart", "+--------+"),
    _row("text", "|        |"),
    _row("boxart", "|   A    +------+"),
    _row("text", "|        |  B   |"),
    _row("boxart", "+--------+------+"),
    _row("step", "Step 1: DRAW a dashed line to split it into rectangle A and rectangle B."),
    _row("step", "Step 2: MEASURE each rectangle's own length and width."),
    _row("gloss", "Step 3: AREA of rectilinear shape = area A + area B (add the two areas)."),
    _row("gloss", "Step 4: PERIMETER = trace only the OUTER outline, not the dashed split line."),
)

_BOARD = _board(_RECT_PANEL, _SQUARE_PANEL, _RECTILINEAR_PANEL,
                title="TALEEMABAD ARCHITECT'S MODEL")


class FormulaLinesFindsOnlyTheAlgebraicRows(unittest.TestCase):
    def test_rect_panel_yields_its_two_formula_rows_in_board_order(self):
        self.assertEqual(
            A._formula_lines(_RECT_PANEL),
            ["P = 2 x (L + W) = 2L + 2W", "A = L x W = LW"],
        )

    def test_rectilinear_panel_has_no_algebraic_formula_row(self):
        self.assertEqual(A._formula_lines(_RECTILINEAR_PANEL), [])


class NamedShapeLineBuildsANameFormulaClause(unittest.TestCase):
    def test_rectangle_clause(self):
        self.assertEqual(
            A._named_shape_line("Rectangle", _RECT_PANEL),
            "Rectangle: P = 2 x (L + W) = 2L + 2W; A = L x W = LW",
        )

    def test_square_clause(self):
        self.assertEqual(
            A._named_shape_line("Square", _SQUARE_PANEL),
            "Square: P = s + s + s + s = 4s; A = s x s = s (squared)",
        )

    def test_a_panel_with_no_formula_falls_back_to_the_bare_name(self):
        empty = _panel("Empty", _row("text", "nothing algebraic here"))
        self.assertEqual(A._named_shape_line("Empty", empty), "Empty")


class RectilinearLineUsesStepsThreeAndFourAsTheFormula(unittest.TestCase):
    def test_strips_the_step_numbering_but_keeps_the_fact_verbatim(self):
        line = A._rectilinear_line(_RECTILINEAR_PANEL)
        self.assertTrue(line.startswith("Rectilinear outline: "))
        self.assertIn("AREA of rectilinear shape = area A + area B (add the two areas).", line)
        self.assertIn("PERIMETER = trace only the OUTER outline, not the dashed split line.", line)
        self.assertNotIn("Step 3", line)
        self.assertNotIn("Step 4", line)
        # Steps 1/2 are procedural, not a P/A fact -- not the formula clause
        self.assertNotIn("DRAW a dashed line", line)
        self.assertNotIn("MEASURE each rectangle", line)

    def test_a_panel_with_no_step_three_or_four_falls_back_to_the_bare_name(self):
        empty = _panel(None, _row("text", "no steps here"))
        self.assertEqual(A._rectilinear_line(empty), "Rectilinear outline")


class ArchitectSpecCaptionIsShortAndEnglishOnly(unittest.TestCase):
    # bd-1fr0w fix #2's RED-then-GREEN case: before the fix, this caption was
    # the full 12-fact run-on dump (~500 chars, Urdu included) -- see this
    # module's git history / the coordinator's own report for the exact
    # before text. After the fix: one short clause per shape.
    def test_caption_is_one_short_clause_per_shape_in_english(self):
        spec = A._architect_spec(_BOARD)
        self.assertIsNotNone(spec)
        caption = spec["caption"]

        self.assertIn("Rectangle: P = 2 x (L + W) = 2L + 2W; A = L x W = LW", caption)
        self.assertIn("Square: P = s + s + s + s = 4s; A = s x s = s (squared)", caption)
        self.assertIn("Rectilinear outline:", caption)

        for dropped in ("width = W", "length = L", "All 4 sides = s",
                        "DRAW a dashed line", "MEASURE each rectangle",
                        "Arrow around", "Arrow to shaded"):
            self.assertNotIn(dropped, caption)

        self.assertNotIn("محیط", caption)
        self.assertNotIn("رقبہ", caption)
        self.assertLess(len(caption), 320, f"caption still too long: {caption!r}")

    def test_draws_four_shapes_rect_square_and_two_rectilinear_rectangles(self):
        spec = A._architect_spec(_BOARD)
        self.assertEqual(len(spec["shapes"]), 4)
        self.assertTrue(all(s["kind"] == "polygon" for s in spec["shapes"]))

    def test_without_the_architect_title_it_refuses(self):
        board = _board(_RECT_PANEL, _SQUARE_PANEL, _RECTILINEAR_PANEL, title="some other lesson")
        self.assertIsNone(A._architect_spec(board))

    def test_missing_the_rectilinear_panel_refuses(self):
        board = _board(_RECT_PANEL, _SQUARE_PANEL, title="TALEEMABAD ARCHITECT'S MODEL")
        self.assertIsNone(A._architect_spec(board))


class CaptionNeverLeaksBoxEdgeOrDoublePunctuation(unittest.TestCase):
    # bd-1fr0w round 3: the coordinator's raster of g4_ch10 Maths_seg10 page 3
    # (the drawn-shapes caption under "THE BOARD AT THE END OF THE LESSON")
    # showed a trailing box-edge "|" ending the Rectangle and Square clauses,
    # and a ".;" where Step 3's own trailing "." collided with the Step
    # 3/Step 4 joiner's "; ". Both come from this exact byte-exact real
    # g4_ch10 board fixture (_BOARD, above) -- confirmed by directly running
    # d0_board_draw.board_diagram() against the live enr source before this
    # fix: caption == "Rectangle: P = 2 x (L + W) = 2L + 2W; A = L x W = LW"
    # " | Square: P = s + s + s + s = 4s; A = s x s = s (squared) | "
    # "Rectilinear outline: AREA of rectilinear shape = area A + area B "
    # "(add the two areas).; PERIMETER = trace only the OUTER outline, not "
    # "the dashed split line."
    def test_caption_never_contains_a_literal_pipe(self):
        caption = A._architect_spec(_BOARD)["caption"]
        self.assertNotIn("|", caption, f"box-edge pipe survived into: {caption!r}")

    def test_caption_never_produces_double_terminal_punctuation(self):
        caption = A._architect_spec(_BOARD)["caption"]
        self.assertNotIn(".;", caption, f"'.;' joiner collision survived into: {caption!r}")

    def test_caption_is_byte_exact_after_the_fix(self):
        # Every authored word kept (Option B) -- only the join punctuation
        # changes: "; " between shape clauses (matching this file family's
        # own _solid_spec/_shape_safari_spec convention) instead of a literal
        # "|", and a plain space (not "; ") wherever the left-hand clause
        # already ends in terminal punctuation.
        self.assertEqual(
            A._architect_spec(_BOARD)["caption"],
            "Rectangle: P = 2 x (L + W) = 2L + 2W; A = L x W = LW; "
            "Square: P = s + s + s + s = 4s; A = s x s = s (squared); "
            "Rectilinear outline: AREA of rectilinear shape = area A + area B "
            "(add the two areas). PERIMETER = trace only the OUTER outline, "
            "not the dashed split line.",
        )


if __name__ == "__main__":
    unittest.main()
