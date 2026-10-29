"""Tests for d0_board_art_shapes.py -- whole_board_spec(board), a FOURTH chance at a
real drawing, spliced into d0_board_draw.board_diagram right after `d0_board_art.
spec_for(board)` and before the per-panel loop.

Why it has to sit THERE and not later (measured, not assumed -- see
$SCRATCH/dump_current.py's real output against the live corpus boards, and
d0_board_art.spec_for's own gate, `len(panels) != 1: return None`):

  * Science_seg3 and Science_seg4 (g4_ch9) are BOTH multi-panel boards, so
    `spec_for` (chance 1) always refuses them outright -- it never reaches a
    builder for either. The wrong `{"type": "flow", ...}` diagram they get TODAY
    comes from chance 2, `d0_board_draw.board_diagram`'s per-panel loop calling
    `d0_board_art.panel_spec(board, panel)`: it takes the FIRST panel with a
    homogeneous, fully-covered row list, and for both boards that is an
    unrelated single-row `arrow` panel (Science_seg3 panel[0]'s
    "PREDICT -> OBSERVE -> EXPLAIN"; Science_seg4's "Everyday objects: orange ->
    sphere; ..." panel) -- reached and matched by `_try_flow` BEFORE the loop
    ever gets to the panel with the actual cube/sphere wireframe. The wireframe
    panel itself never independently reaches a builder, because its own row
    list mixes `boxart` and `text` kinds -- exactly the "homogeneous panel"
    requirement `panel_spec`'s builder chain refuses on.
  * g1_ch10/Maths_seg1 and g4_ch10/Maths_seg10 are also multi-panel (`spec_for`
    refuses) and every one of their panels mixes row kinds or shape names in a
    way the existing per-panel builders refuse too, so `board_diagram` returns
    None for both today -- confirmed by direct execution, not inferred.
  * g1_ch9/Maths_seg1 is single-panel but MIXED-kind, so `spec_for` and
    `panel_spec` both refuse it too; it already gets a clock today ONLY because
    `d0_board_art_scan.scan_spec` (chance 3, whole-board-blob, kind-ignored)
    runs last and catches it -- confirmed by direct execution.

So inserting `whole_board_spec` right after chance 1 and before the per-panel
loop is both NECESSARY (nothing else in the per-panel loop can ever reach the
right panel for Science_seg3/4, since a homogeneous-panel scan always meets the
unrelated arrow panel first) and SAFE (every fixture below is a byte-exact
reconstruction of the real board's panel/row shape, taken from
`d0_board_read.read_board`'s actual output against the real .lp.json `board`
blocks -- not invented).

This file holds the solid (cube/sphere) and shape-safari fixtures. The
architect's-model, analogue-clock and regression fixtures continue in
`test_d0_board_art_shapes_more.py` (split to stay under the 300-line limit;
that file's own docstring points back here for the shared rationale).
"""

import unittest

import d0_board_art_shapes as S


def _row(kind, text, cells=None, term=None, gloss=None):
    return {"kind": kind, "text": text, "term": term, "gloss": gloss, "cells": cells}


def _panel(label, *rows):
    return {"label": label, "rows": list(rows)}


def _board(*panels, title=None, instruction=""):
    return {"title": title, "panels": list(panels), "instruction": instruction}


class ACubeWireframeBecomesASolid(unittest.TestCase):
    # g4_ch9/Science_seg3.lp.json -- today: board_diagram() returns a WRONG
    # {"type": "flow", "steps": [PREDICT, OBSERVE, EXPLAIN]} from panel[0],
    # never reaching panel[3]'s cube ascii at all (measured, dump_current.py).
    def test_a_lone_cube_wireframe_draws_a_cube_only(self):
        board = _board(
            _panel(None, _row("arrow", "PREDICT → OBSERVE → EXPLAIN",
                               cells=["PREDICT", "OBSERVE", "EXPLAIN"])),
            _panel(None,
                   _row("text", "Shape        Materials/pieces from pp.225-226        Our model"),
                   _row("text", "Sphere       playdough rolled in palms                □"),
                   _row("text", "Cube         6 same-size cardboard squares            □")),
            _panel("Draw a small cube at the side:",
                   _row("boxart", "      +---+"),
                   _row("text", "     /   /|"),
                   _row("boxart", "    +---+ |"),
                   _row("text", "    |   | +"),
                   _row("text", "    |   |/"),
                   _row("boxart", "    +---+")),
            _panel(None, _row("text",
                "Label one corner: vertex; label one line: edge; shade one square side: face.")),
            title="3D WORLD — DESIGN AND BUILD",
        )
        spec = S.whole_board_spec(board)
        self.assertIsNotNone(spec, "expected a solid spec, got None")
        self.assertEqual(spec["type"], "solid")
        self.assertEqual([s["kind"] for s in spec["shapes"]], ["cube"])
        self.assertIn("vertex", spec["caption"])
        self.assertIn("edge", spec["caption"])
        self.assertIn("face", spec["caption"])

    # g4_ch9/Science_seg4.lp.json -- today: WRONG flow diagram from the
    # "Everyday objects" arrow panel; the cube+sphere ascii panel (mixed
    # boxart/text/table/gloss rows) never independently reaches a builder.
    def test_a_cube_and_sphere_sharing_one_panel_draws_both(self):
        board = _board(
            _panel(None, _row("gloss",
                "FACE = surface      EDGE = line where faces meet      VERTEX = corner")),
            _panel(None,
                   _row("text", "     cube                         sphere"),
                   _row("boxart", "   +-----+                      ( curved )"),
                   _row("table", "  /     /|                       one face"),
                   _row("table", " +-----+ |                       0 edges"),
                   _row("table", " | FACE| +                       0 vertices"),
                   _row("text", " |     |/ "),
                   _row("boxart", " +-----+"),
                   _row("gloss", "   ^ vertex        one outlined line = edge")),
            _panel("MODEL TABLE",
                   _row("text", "sphere: 1 face, 0 edges, 0 vertices"),
                   _row("text", "cube: 6 faces, 12 edges, 8 vertices"),
                   _row("text", "prism: 4 faces, 6 edges, 5 vertices"),
                   _row("text", "cone: 1 face, 0 edges, 1 vertex"),
                   _row("text", "cylinder: 3 faces, 2 edges, 0 vertices")),
            _panel(None, _row("arrow",
                "Everyday objects: orange → sphere; ludo die → cube; birthday cap → cone",
                cells=["orange → sphere", "ludo die → cube", "birthday cap → cone"])),
            title="3-D OBJECTS = height + width + depth",
        )
        spec = S.whole_board_spec(board)
        self.assertIsNotNone(spec, "expected a solid spec, got None")
        self.assertEqual(spec["type"], "solid")
        self.assertEqual([s["kind"] for s in spec["shapes"]], ["cube", "sphere"])
        self.assertIn("cube: 6 faces, 12 edges, 8 vertices", spec["caption"])
        self.assertIn("sphere: 1 face, 0 edges, 0 vertices", spec["caption"])
        # prism/cone/cylinder stay text-only -- solid.js only draws cube/sphere,
        # out of scope, so those facts are deliberately NOT folded in here (they
        # remain in the board's own printed panel text, Option B is satisfied by
        # the additive slot, not by this spec)
        self.assertNotIn("prism", spec["caption"])
        self.assertNotIn("cone", spec["caption"])
        self.assertNotIn("cylinder", spec["caption"])

    def test_vertex_edge_face_words_alone_without_a_cube_wireframe_refuse(self):
        board = _board(
            _panel(None, _row("text", "A cube has 8 vertices, 12 edges and 6 faces.")),
            title="No boxart anywhere",
        )
        self.assertIsNone(S.whole_board_spec(board))

    def test_boxart_corners_without_vertex_edge_face_words_refuse(self):
        # g4_ch10's floor-plan boxes use the same "+---+" corner glyphs but
        # never say vertex/edge/face -- must not be mistaken for a solid.
        board = _board(
            _panel("RECTANGULAR BUILDING PLOT",
                   _row("boxart", "+----------------------+"),
                   _row("gloss", "|                      |  width = W"),
                   _row("text", "Arrow around all outside edges: PERIMETER / محیط"),
                   _row("boxart", "+----------------------+")),
            title="TALEEMABAD ARCHITECT'S MODEL",
        )
        self.assertIsNone(S.whole_board_spec(board))


class AShapeSafariDrawsFourNamedShapes(unittest.TestCase):
    # g1_ch10/Maths_seg1.lp.json -- today: None (measured). Two panels each
    # name 2 shapes in their label ("RECTANGLE   SQUARE", "CIRCLE   TRIANGLE").
    def test_two_shape_pair_panels_draw_all_four_shapes_in_order(self):
        board = _board(
            _panel("RECTANGLE                 SQUARE",
                   _row("boxart", "+--------+                +----+"),
                   _row("text", "|        |                |    |"),
                   _row("boxart", "+--------+                +----+"),
                   _row("text", "4 sides, 4 corners        4 equal sides, 4 corners")),
            _panel("CIRCLE                    TRIANGLE",
                   _row("boxart", "  ______                   /\\"),
                   _row("boxart", " /      \\                 /  \\"),
                   _row("boxart", "(        )               /____\\"),
                   _row("boxart", "  (____)                 0 sides, 0 corners      3 sides, 3 corners")),
            _panel(None,
                   _row("gloss", "vertices = corners"),
                   _row("arrow", "Trace the edge → count sides → count corners",
                        cells=["Trace the edge", "count sides", "count corners"])),
            title="2-D Shape Safari",
        )
        spec = S.whole_board_spec(board)
        self.assertIsNotNone(spec, "expected a geometry spec, got None")
        self.assertEqual(spec["type"], "geometry")
        kinds = [s["kind"] for s in spec["shapes"]]
        self.assertEqual(kinds, ["polygon", "polygon", "circle", "triangle"])
        self.assertIn("rectangle: 4 sides, 4 corners", spec["caption"])
        self.assertIn("square: 4 equal sides, 4 corners", spec["caption"])
        self.assertIn("circle: 0 sides, 0 corners", spec["caption"])
        self.assertIn("triangle: 3 sides, 3 corners", spec["caption"])

    def test_a_single_named_shape_panel_is_not_enough_to_qualify(self):
        board = _board(
            _panel("SQUARE PARK PLOT",
                   _row("boxart", "+----------+"),
                   _row("gloss", "All 4 sides = s")),
            title="one shape only",
        )
        self.assertIsNone(S.whole_board_spec(board))

    # bd-1fr0w fix #3, g1_ch10/Maths_seg1: "the circle has a centre dot, which
    # isn't needed for Grade 1. Put each shape's name under the shape itself,
    # not only in the caption." geometry.js (diagrams/types/geometry.js) now
    # honours a shape's own `name` (renders it under the shape) and a circle's
    # `showCenter` (default True; False drops the centre dot) -- this is the
    # Python-side wiring so the real board's spec actually sets them.
    def test_every_drawn_shape_carries_its_own_capitalised_name(self):
        board = _board(
            _panel("RECTANGLE                 SQUARE",
                   _row("boxart", "+--------+                +----+"),
                   _row("text", "|        |                |    |"),
                   _row("boxart", "+--------+                +----+"),
                   _row("text", "4 sides, 4 corners        4 equal sides, 4 corners")),
            _panel("CIRCLE                    TRIANGLE",
                   _row("boxart", "  ______                   /\\"),
                   _row("boxart", " /      \\                 /  \\"),
                   _row("boxart", "(        )               /____\\"),
                   _row("boxart", "  (____)                 0 sides, 0 corners      3 sides, 3 corners")),
            _panel(None,
                   _row("gloss", "vertices = corners"),
                   _row("arrow", "Trace the edge → count sides → count corners",
                        cells=["Trace the edge", "count sides", "count corners"])),
            title="2-D Shape Safari",
        )
        spec = S.whole_board_spec(board)
        names = [s.get("name") for s in spec["shapes"]]
        self.assertEqual(names, ["Rectangle", "Square", "Circle", "Triangle"])

    def test_the_circle_alone_turns_its_centre_dot_off(self):
        board = _board(
            _panel("RECTANGLE                 SQUARE",
                   _row("boxart", "+--------+                +----+"),
                   _row("text", "4 sides, 4 corners        4 equal sides, 4 corners")),
            _panel("CIRCLE                    TRIANGLE",
                   _row("boxart", "  ______"),
                   _row("text", "0 sides, 0 corners      3 sides, 3 corners")),
            title="2-D Shape Safari",
        )
        spec = S.whole_board_spec(board)
        by_kind = {s["kind"]: s for s in spec["shapes"]}
        self.assertEqual(by_kind["circle"].get("showCenter"), False)
        self.assertNotIn("showCenter", by_kind["polygon"])
        self.assertNotIn("showCenter", by_kind["triangle"])


if __name__ == "__main__":
    unittest.main()
