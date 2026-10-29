"""Tests for d0_board_art_shapes.py, continued from test_d0_board_art_shapes.py.

Split in two purely to stay under the 300-line file limit -- there is no
behavioural or ownership boundary between the files. See
test_d0_board_art_shapes.py's own module docstring for the full rationale on
why `whole_board_spec()` must sit between `d0_board_art.spec_for()` and the
per-panel loop in `d0_board_draw.board_diagram()`; that reasoning applies
equally to the architect's-model, clock and regression fixtures below.
"""

import unittest

import d0_board_art_shapes as S


def _row(kind, text, cells=None, term=None, gloss=None):
    return {"kind": kind, "text": text, "term": term, "gloss": gloss, "cells": cells}


def _panel(label, *rows):
    return {"label": label, "rows": list(rows)}


def _board(*panels, title=None, instruction=""):
    return {"title": title, "panels": list(panels), "instruction": instruction}


class AnArchitectsModelDrawsThreeFootprints(unittest.TestCase):
    # g4_ch10/Maths_seg10.lp.json -- today: None (measured). panel[3]/[4] are
    # out of scope by design (BONUS LABEL / CREATE-CHECK) and are not fixtured.
    #
    # `_architect_spec` itself (the detector this dispatches to, including its
    # bd-1fr0w-fix-#2 short/English-only caption behaviour) now lives in
    # d0_board_art_arch.py with its own direct tests -- this class only checks
    # that `whole_board_spec` still WIRES an architect board to it.
    def test_the_rect_square_and_rectilinear_panels_draw_together(self):
        board = _board(
            _panel("RECTANGULAR BUILDING PLOT",
                   _row("boxart", "+----------------------+"),
                   _row("calc", "P = 2 x (L + W) = 2L + 2W"),
                   _row("gloss", "A = L x W = LW")),
            _panel("SQUARE PARK PLOT",
                   _row("boxart", "+----------+"),
                   _row("calc", "P = s + s + s + s = 4s"),
                   _row("gloss", "A = s x s = s (squared)")),
            _panel(None,
                   _row("text", "RECTILINEAR BUILDING OUTLINE (two rectangles joined)"),
                   _row("step", "Step 1: DRAW a dashed line to split it into rectangle A and rectangle B."),
                   _row("gloss", "Step 3: AREA of rectilinear shape = area A + area B (add the two areas)."),
                   _row("gloss", "Step 4: PERIMETER = trace only the OUTER outline, not the dashed split line.")),
            title="TALEEMABAD ARCHITECT'S MODEL",
        )
        spec = S.whole_board_spec(board)
        self.assertIsNotNone(spec, "expected a geometry spec, got None")
        self.assertEqual(spec["type"], "geometry")
        self.assertEqual(len(spec["shapes"]), 4)  # rect plot, square plot, rect A, rect B
        self.assertIn("Rectangle: P = 2 x (L + W) = 2L + 2W; A = L x W = LW", spec["caption"])

    def test_without_the_architect_title_it_refuses(self):
        board = _board(
            _panel("RECTANGULAR BUILDING PLOT", _row("boxart", "+----+")),
            _panel("SQUARE PARK PLOT", _row("boxart", "+----+")),
            _panel(None, _row("text", "rectangle a and rectangle b")),
            title="some other lesson",
        )
        self.assertIsNone(S.whole_board_spec(board))


class AnAnalogueClockGetsAllTwelveNumerals(unittest.TestCase):
    # g1_ch9/Maths_seg1.lp.json -- today: {"type":"clock","time":"9:00"} via the
    # pre-existing d0_board_art_scan fallback (chance 3), no numerals override
    # (defaults to "quarters"). This board explicitly authors BOTH an analogue
    # clock face (numerals 1-12) and a separate digital readout -- the fuller,
    # execution-verified fixture, still only one one distinct time on the board.
    def test_an_analogue_and_digital_clock_panel_gets_all_numerals(self):
        board = _board(
            _panel(None,
                   _row("text", "ANALOGUE CLOCK: face with numbers 1 to 12, hour hand short "
                                 "pointing at 9, minute hand long pointing at 12"),
                   _row("table", "DIGITAL CLOCK   |  Hours | Minutes"),
                   _row("table", "     09:00      |   09   |   00")),
            title="What time is it?",
        )
        spec = S.whole_board_spec(board)
        self.assertIsNotNone(spec, "expected a clock spec, got None")
        self.assertEqual(spec["type"], "clock")
        self.assertEqual(spec["time"], "9:00")
        self.assertEqual(spec["numerals"], "all")
        self.assertNotIn("digital", spec)

    def test_analogue_alone_without_digital_clock_wording_refuses(self):
        board = _board(
            _panel(None, _row("text", "ANALOGUE CLOCK showing 9:00")),
            title="clock",
        )
        self.assertIsNone(S.whole_board_spec(board))

    def test_two_different_times_refuse_as_ambiguous(self):
        board = _board(
            _panel(None, _row("text",
                "ANALOGUE CLOCK at 9:00, DIGITAL CLOCK later reads 10:15")),
            title="clock",
        )
        self.assertIsNone(S.whole_board_spec(board))


class RegressionOrdinaryBoardsAreUntouched(unittest.TestCase):
    def test_an_ordinary_single_panel_gloss_board_is_not_claimed(self):
        board = _board(
            _panel(None, _row("gloss", "hot", term="hot", gloss="garam")),
            title="Urdu vocabulary",
        )
        self.assertIsNone(S.whole_board_spec(board))

    def test_a_board_with_no_panels_is_not_claimed(self):
        self.assertIsNone(S.whole_board_spec({"title": None, "panels": [], "instruction": ""}))

    def test_not_a_dict_is_not_claimed(self):
        self.assertIsNone(S.whole_board_spec(None))
        self.assertIsNone(S.whole_board_spec("board"))


if __name__ == "__main__":
    unittest.main()
