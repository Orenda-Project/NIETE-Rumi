"""d0_board_strip: strip drawn-ASCII / bare clock-face numerals from the
PRINTED board once a picture exists for it (bd-1fr0w fix #1).

`board_panels()` (d0_board.py) keeps any line neither `_unbox` nor `_unbox_ascii`
recognizes as a framed box, verbatim -- box-drawing glyphs and scattered clock
numerals included (d0_board.py:118, `kept.append(l)`). This module runs AFTER
`board_panels()`, on its own panel/row output, gated on the board's diagram
spec `type` (d0_board_draw.board_diagram) so it only ever touches "solid" and
"clock" boards -- the two the coordinator named. Fixtures below are the REAL
`board_panels()` output captured from the corpus for Science_seg3, Science_seg4
and g1_ch9 Maths_seg1 (bd-1fr0w's three named boards).
"""

import d0_board_strip as S


# ---------------------------------------------------------------------------
# _clean_token / _strip_drawn -- token-level unit tests
# ---------------------------------------------------------------------------

def test_a_pure_box_glyph_token_is_dropped():
    assert S._clean_token("+---+") is None
    assert S._clean_token("/|") is None


def test_a_lone_pipe_or_plus_is_kept_as_a_protected_candidate():
    # Ambiguous between a stray box-corner/leader-line fragment and ordinary
    # authored punctuation (a pipe-table divider, a "+" meaning "and") --
    # see test_strip_drawn_preserves_a_plus_sign_used_as_a_word_connector.
    assert S._clean_token("|") == "|"
    assert S._clean_token("+") == "+"


def test_a_glued_edge_char_is_trimmed_off_a_real_word():
    assert S._clean_token("FACE|") == "FACE"
    assert S._clean_token("^vertex") == "vertex"


def test_strip_drawn_drops_a_fully_ascii_line():
    assert S._strip_drawn("+---+") is None
    assert S._strip_drawn("/   /|") is None
    assert S._strip_drawn("|   |/") is None


def test_strip_drawn_cleans_a_mixed_line():
    assert S._strip_drawn("/     /|                       one face") == "one face"
    assert S._strip_drawn("FACE| +                       0 vertices") == "FACE + 0 vertices"


def test_strip_drawn_preserves_a_legitimate_pipe_table():
    assert S._strip_drawn("Hours | Minutes") == "Hours | Minutes"
    assert S._strip_drawn("09   |   00") == "09 | 00"


def test_strip_drawn_preserves_a_plus_sign_used_as_a_word_connector():
    # bd-1fr0w: a solitary "+" is ambiguous (box-corner fragment vs. authored
    # "and") -- only drop it when EVERY surviving token in the row is itself
    # one of the ambiguous connectors ("+" / "|"), never on its own.
    assert S._strip_drawn("height + width + depth") == "height + width + depth"


# ---------------------------------------------------------------------------
# apply_panels -- Science_seg3 (all-ascii panel folds its label into a row)
# ---------------------------------------------------------------------------

_SEG3_BOARD = {"content": "irrelevant for this fixture -- board_diagram is stubbed"}
_SEG3_PANELS = [
    {"rows": [{"text": "PREDICT → OBSERVE → EXPLAIN"}]},
    {"rows": [{"text": "Sphere       playdough rolled in palms                □"}]},
    {"rows": [{"text": "height ↕     width ↔     depth ↗"}]},
    {
        "rows": [
            {"text": "+---+"}, {"text": "/   /|"}, {"text": "+---+ |"},
            {"text": "|   | +"}, {"text": "|   |/"}, {"text": "+---+"},
        ],
        "label": "Draw a small cube at the side",
    },
    {"rows": [{"text": "Label one corner: vertex; label one line: edge; shade one square side: face."}]},
]


def test_seg3_cube_panel_folds_its_label_into_the_sole_surviving_row(monkeypatch):
    monkeypatch.setattr(S.d0_board_draw, "board_diagram", lambda b: {"type": "solid"})
    out = S.apply_panels(_SEG3_PANELS, _SEG3_BOARD)
    cube_panel = out[3]
    assert cube_panel["rows"] == [{"text": "Draw a small cube at the side"}]
    assert "label" not in cube_panel


def test_seg3_untouched_panels_are_not_mangled(monkeypatch):
    monkeypatch.setattr(S.d0_board_draw, "board_diagram", lambda b: {"type": "solid"})
    out = S.apply_panels(_SEG3_PANELS, _SEG3_BOARD)
    assert out[0]["rows"] == [{"text": "PREDICT → OBSERVE → EXPLAIN"}]
    assert out[1]["rows"] == [{"text": "Sphere       playdough rolled in palms                □"}]
    assert out[2]["rows"] == [{"text": "height ↕     width ↔     depth ↗"}]
    assert out[4]["rows"][0]["text"].startswith("Label one corner")


# ---------------------------------------------------------------------------
# apply_panels -- Science_seg4 (mixed cube/sphere panel, partial drop)
# ---------------------------------------------------------------------------

_SEG4_PANELS = [
    {"rows": [{"term": "3-D OBJECTS", "gloss": "height + width + depth"}]},
    {
        "rows": [
            {"text": "cube                         sphere"},
            {"text": "( curved )"},
            {"text": "/     /|                       one face"},
            {"text": "0 edges"},
            {"text": "FACE| +                       0 vertices"},
            {"text": "|     |/"},
            {"text": "+-----+"},
            {"term": "^ vertex        one outlined line", "gloss": "edge"},
        ],
    },
]


def test_seg4_gloss_plus_sign_survives(monkeypatch):
    monkeypatch.setattr(S.d0_board_draw, "board_diagram", lambda b: {"type": "solid"})
    out = S.apply_panels(_SEG4_PANELS, {})
    assert out[0]["rows"] == [{"term": "3-D OBJECTS", "gloss": "height + width + depth"}]


def test_seg4_mixed_panel_drops_only_the_pure_frame_rows(monkeypatch):
    monkeypatch.setattr(S.d0_board_draw, "board_diagram", lambda b: {"type": "solid"})
    out = S.apply_panels(_SEG4_PANELS, {})
    rows = out[1]["rows"]
    texts = [r.get("text") for r in rows if "text" in r]
    assert "cube                         sphere" in texts  # untouched, no edge chars
    assert "( curved )" in texts                            # untouched
    assert "one face" in texts
    assert "0 edges" in texts
    assert "FACE + 0 vertices" in texts
    assert "|     |/" not in texts and "+-----+" not in texts
    assert not any(t.strip() in ("+-----+", "|     |/") for t in texts)
    assert {"term": "vertex one outlined line", "gloss": "edge"} in rows


# ---------------------------------------------------------------------------
# apply_panels -- g1_ch9 Maths_seg1 (clock board)
# ---------------------------------------------------------------------------

_CLOCK_PANELS = [
    {
        "rows": [
            {"text": "12                         09:00"},
            {"text": "11        1                    Hours | Minutes"},
            {"text": "10              2                    09   |   00"},
            {"text": "9       short       3"},
            {"text": "hour hand"},
            {"term": "long thin minute hand", "gloss": "12"},
            {"text": "8              4"},
            {"text": "7        5"},
            {"text": "6"},
            {"text": "Minute hand on 12 + hour hand on 9 = 9 o'clock = 09:00"},
        ],
        "label": "ANALOGUE CLOCK                         DIGITAL CLOCK",
    }
]


def test_clock_board_strips_bare_position_numerals(monkeypatch):
    monkeypatch.setattr(S.d0_board_draw, "board_diagram", lambda b: {"type": "clock"})
    out = S.apply_panels(_CLOCK_PANELS, {})
    rows = out[0]["rows"]
    texts = [r.get("text") for r in rows if "text" in r]
    assert "09:00" in texts
    assert "Hours | Minutes" in texts
    assert "09 | 00" in texts
    assert "short" in texts
    assert "hour hand" in texts


def test_clock_board_drops_pure_numeral_rows(monkeypatch):
    monkeypatch.setattr(S.d0_board_draw, "board_diagram", lambda b: {"type": "clock"})
    out = S.apply_panels(_CLOCK_PANELS, {})
    texts = [r.get("text") for r in out[0]["rows"] if "text" in r]
    assert not any(t.strip() in ("8              4", "7        5", "6") for t in texts)


def test_clock_board_converts_an_emptied_gloss_to_a_text_row(monkeypatch):
    monkeypatch.setattr(S.d0_board_draw, "board_diagram", lambda b: {"type": "clock"})
    out = S.apply_panels(_CLOCK_PANELS, {})
    assert {"text": "long thin minute hand"} in out[0]["rows"]


def test_clock_board_protects_a_calc_line_from_numeral_stripping(monkeypatch):
    monkeypatch.setattr(S.d0_board_draw, "board_diagram", lambda b: {"type": "clock"})
    out = S.apply_panels(_CLOCK_PANELS, {})
    texts = [r.get("text") for r in out[0]["rows"] if "text" in r]
    assert "Minute hand on 12 + hour hand on 9 = 9 o'clock = 09:00" in texts


# ---------------------------------------------------------------------------
# apply_panels -- g1_ch9 Maths_seg11 (mixed clock-rule + calendar board).
# Blast-radius corpus scan regression: this board is ALSO diagram type
# "clock" but is not one of bd-1fr0w's 3 named boards -- the scan (re-run
# across all 440 enr/*.json boardWork sources) caught it turning "Example: 5
# o'clock" into "Example: o'clock" and "4th Solar month" into "th Solar
# month". Neither is a clock-face layout numeral; both are real content.
# ---------------------------------------------------------------------------

_MIXED_CLOCK_PANELS = [
    {
        "rows": [
            {"text": "Example: 5 o'clock"},
            {"term": "5 o'clock", "gloss": "5:00"},
        ],
    },
    {
        "rows": [
            {"text": "CALENDAR FACTS FROM p.238-239"},
            {"term": "4th Solar month", "gloss": "April"},
            {"term": "7th Solar month", "gloss": "July"},
            {"term": "9th Islamic month", "gloss": "Ramadan"},
        ],
    },
]


def test_clock_board_protects_a_named_oclock_value_in_prose(monkeypatch):
    monkeypatch.setattr(S.d0_board_draw, "board_diagram", lambda b: {"type": "clock"})
    out = S.apply_panels(_MIXED_CLOCK_PANELS, {})
    texts = [r.get("text") for r in out[0]["rows"] if "text" in r]
    terms = [r.get("term") for r in out[0]["rows"] if "term" in r]
    assert "Example: 5 o'clock" in texts
    assert "5 o'clock" in terms


def test_clock_board_protects_an_ordinal_number_glued_to_a_letter(monkeypatch):
    monkeypatch.setattr(S.d0_board_draw, "board_diagram", lambda b: {"type": "clock"})
    out = S.apply_panels(_MIXED_CLOCK_PANELS, {})
    terms = [r.get("term") for r in out[1]["rows"] if "term" in r]
    assert "4th Solar month" in terms
    assert "7th Solar month" in terms
    assert "9th Islamic month" in terms


# ---------------------------------------------------------------------------
# Gating -- "solid" / "clock" / "geometry" boards are touched. The real-board
# g1_ch10/g4_ch10 geometry red-then-green evidence lives in
# test_d0_board_strip_geometry.py (split out to keep this file under 300
# lines -- no behavioural boundary between the two files).
# ---------------------------------------------------------------------------

def test_a_geometry_board_now_has_its_drawn_art_stripped(monkeypatch):
    # bd-1fr0w coordinator verify: the strip was gated to "solid"/"clock"
    # only, so a picture that replaces a GEOMETRY board's hand-drawn shape
    # printed its ASCII art untouched right next to the picture. Widened to
    # include "geometry" -- see test_d0_board_strip_geometry.py for the
    # g1_ch10/g4_ch10 real-board red-then-green evidence.
    monkeypatch.setattr(S.d0_board_draw, "board_diagram", lambda b: {"type": "geometry"})
    panels = [{"rows": [{"text": "+---+"}, {"text": "real label"}]}]
    out = S.apply_panels(panels, {})
    texts = [r.get("text") for p in out for r in p.get("rows", ())]
    assert "+---+" not in texts
    assert "real label" in texts


def test_a_board_with_no_diagram_is_returned_unchanged(monkeypatch):
    monkeypatch.setattr(S.d0_board_draw, "board_diagram", lambda b: None)
    panels = [{"rows": [{"text": "+---+"}]}]
    assert S.apply_panels(panels, {}) == panels


def test_a_raising_board_diagram_is_swallowed_and_returned_unchanged(monkeypatch):
    def boom(b):
        raise ValueError("no spec for this board")
    monkeypatch.setattr(S.d0_board_draw, "board_diagram", boom)
    panels = [{"rows": [{"text": "+---+"}]}]
    assert S.apply_panels(panels, {}) == panels
