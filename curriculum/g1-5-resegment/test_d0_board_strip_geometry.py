"""d0_board_strip: the geometry-board half of bd-1fr0w fix #1 (split out of
test_d0_board_strip.py purely to keep that file under the 300-line limit --
no behavioural or ownership boundary between the two, see that file's own
module docstring for the shared architecture).

bd-1fr0w coordinator verify round 1: "Pass: g1_ch9 Maths_seg1, g4_ch9
Science_seg3 and g4_ch9 Science_seg4 print no ASCII art ... FAIL, defect #1
is still visible where the drawn picture replaces a *geometry* board. Your
strip is gated on board type solid/clock only." Fixtures below are
`board_panels()`'s real output shape for g1_ch10/Maths_seg1.lp.json and
g4_ch10/Maths_seg10.lp.json (page 2), byte-exact -- confirmed by actually
calling `d0_board.board_panels()` on the real `enr/*.json` source and
transcribing its output (the earlier round's `_G4_CH10_PANELS` guessed a
plain-`text` shape for two rows that the real parser actually splits into
`term`/`gloss` pairs -- corrected here, see round 2 below).

bd-1fr0w coordinator verify round 2: "g4_ch10 Maths_seg10 p.2 still FAILS on
the raster ... lone box-edge pipes survive: 'SHADE INSIDE |', 'SHADE | side
s' (panel 2 header), 'INSIDE |', 'B |'; the arrow-art run 'road: > > > > >
dashed lane-divider lines' (the > > > > > is drawn lane art)." Root cause,
confirmed by running `apply_panels` on the real board pre-fix: `_PROTECTED`
keeps a lone "|" token verbatim on EVERY mode including geometry, so it
survives in any row that also has real words (a pure "|"-only row already
dropped -- and still does, see below); and the real source's directional
arrows ("-> -> -> -> ->") get their leading "-" edge-stripped by the
already-shipped fix, leaving a bare "> > > > >" run that reads as drawn lane
art, not text. Corpus-checked (`d0_board_draw.board_diagram(...) ==
"geometry"` over all 15 chapters' `enr/*.json`): exactly the 2 boards below
carry a lone "|" token, and only g4_ch10 carries a "<"/">" run; nothing in
the corpus uses a standalone "|" as a real table divider or formula
character, so blanket-stripping it on geometry boards has no false positive.
"""

import re

import d0_board_strip as S

# The coordinator's own verification grep (pdftotext -layout | grep -E ...):
# a paired box corner run, or a pipe-gap(2+)-pipe. Reused here so the Python
# unit test checks the same thing the rendered-PDF check does.
_ART_RE = re.compile(r"\+-{2,}|-{2,}\+|\|\s{2,}\|")


def _texts(out):
    """A row's searchable text -- `row["text"]`, or `"term gloss"` for a
    term/gloss row (real `board_panels()` output splits some lines that
    way; see the module docstring's round-2 note)."""
    result = []
    for p in out:
        for r in p.get("rows", ()):
            if "text" in r:
                result.append(r["text"])
            else:
                result.append(f"{r.get('term', '')} {r.get('gloss', '') or ''}".strip())
    return result


def _no_lone_pipe_or_arrow_run(rows_text):
    """Per-row (not across the joined blob, which could paste a false run
    across a row boundary): no token is a bare "|", and no run of 3+
    consecutive bare "<"/">" tokens survives."""
    for text in rows_text:
        toks = text.split()
        for t in toks:
            assert t != "|", f"lone pipe survived: {text!r}"
        run = 0
        for t in toks:
            run = run + 1 if t in ("<", ">") else 0
            assert run < 3, f"arrow run survived: {text!r}"


# ---------------------------------------------------------------------------
# apply_panels -- g1_ch10 Maths_seg1 (geometry: 2-D Shape Safari,
# circle/triangle drawn with parens: "( )" / "(____)"). bd-1fr0w coordinator
# verify FAIL: "the drawn picture replaces a *geometry* board. Your strip is
# gated on board type solid/clock only ... still prints `+--------+ +----+`,
# `| | | |`, `( ) /\`, `/ \ / \`, `\ / /___\`, `(___)`."
# ---------------------------------------------------------------------------

_G1_CH10_PANELS = [
    {
        "label": "RECTANGLE                 SQUARE",
        "rows": [
            {"text": "+--------+                +----+"},
            {"text": "|        |                |    |"},
            {"text": "+--------+                +----+"},
            {"text": "4 sides, 4 corners        4 equal sides, 4 corners"},
        ],
    },
    {
        "label": "CIRCLE                    TRIANGLE",
        "rows": [
            {"text": "  ______                   /\\"},
            {"text": " /      \\                 /  \\"},
            {"text": "(        )               /____\\"},
            {"text": "  (____)                 0 sides, 0 corners      3 sides, 3 corners"},
        ],
    },
    {
        "rows": [
            {"text": "vertices = corners"},
            {"text": "Trace the edge → count sides → count corners"},
        ],
    },
]


def test_g1_ch10_no_box_or_shape_art_survives(monkeypatch):
    monkeypatch.setattr(S.d0_board_draw, "board_diagram", lambda b: {"type": "geometry"})
    out = S.apply_panels(_G1_CH10_PANELS, {})
    blob = " ".join(_texts(out))
    assert not _ART_RE.search(blob), blob
    for glyph in ("+--------+", "+----+", "______", "/____\\", "(____)", "( ", " )"):
        assert glyph not in blob, f"art survived: {glyph!r} in {blob!r}"


def test_g1_ch10_every_real_word_survives(monkeypatch):
    monkeypatch.setattr(S.d0_board_draw, "board_diagram", lambda b: {"type": "geometry"})
    out = S.apply_panels(_G1_CH10_PANELS, {})
    blob = " ".join(_texts(out))
    for phrase in (
        "4 sides, 4 corners", "4 equal sides, 4 corners",
        "0 sides, 0 corners", "3 sides, 3 corners",
        "vertices = corners", "Trace the edge", "count sides", "count corners",
    ):
        assert phrase in blob, f"missing: {phrase!r}"
    assert out[0]["label"] == "RECTANGLE                 SQUARE"
    assert out[1]["label"] == "CIRCLE                    TRIANGLE"


# ---------------------------------------------------------------------------
# apply_panels -- g4_ch10 Maths_seg10, page 2 (geometry: architect's model --
# rectangle plot, square plot, two rectilinear rectangles, bonus label-only
# recap). Real `board_panels()` output, transcribed byte-exact by running it
# on the real `enr/*.json` source (see module docstring, round 2): two rows
# the parser splits as `term`/`gloss` ("width"/"W", "SHADE    | side"/"s"),
# and a 4th panel (no `label`, first row is its own title line) that round 1
# never fixtured at all -- "road: -> -> -> -> ->  dashed lane-divider lines:
# parallel" is the source of the coordinator's observed "> > > > >" arrow-art
# run (the already-shipped fix edge-strips each arrow's leading "-", not
# something new to cause here).
# ---------------------------------------------------------------------------

_G4_CH10_PANELS = [
    {
        "label": "RECTANGULAR BUILDING PLOT",
        "rows": [
            {"text": "+----------------------+"},
            {"term": "width", "gloss": "W"},
            {"text": "SHADE INSIDE     |"},
            {"text": "|                      |"},
            {"text": "+----------------------+"},
            {"term": "length", "gloss": "L"},
            {"text": "Arrow around all outside edges: PERIMETER / محیط"},
            {"text": "Arrow to shaded inside: AREA / رقبہ"},
            {"text": "P = 2 x (L + W) = 2L + 2W"},
            {"text": "A = L x W = LW"},
        ],
    },
    {
        "label": "SQUARE PARK PLOT",
        "rows": [
            {"text": "+----------+"},
            {"term": "SHADE    | side", "gloss": "s"},
            {"text": "INSIDE   |"},
            {"text": "+----------+"},
            {"term": "All 4 sides", "gloss": "s"},
            {"text": "P = s + s + s + s = 4s"},
            {"text": "A = s x s = s (squared)"},
        ],
    },
    {
        "rows": [
            {"text": "RECTILINEAR BUILDING OUTLINE (two rectangles joined)"},
            {"text": "+--------+"},
            {"text": "|        |"},
            {"text": "A    +------+"},
            {"text": "B   |"},
            {"text": "+--------+------+"},
            {"text": "Step 1: DRAW a dashed line to split it into rectangle A and rectangle B."},
            {"text": "Step 2: MEASURE each rectangle's own length and width."},
            {"term": "Step 3: AREA of rectilinear shape",
             "gloss": "area A + area B (add the two areas)."},
            {"term": "Step 4: PERIMETER",
             "gloss": "trace only the OUTER outline, not the dashed split line."},
        ],
    },
    {
        "rows": [
            {"text": "BONUS LABEL ONLY (whole-chapter recap, not measured today)"},
            {"text": "road: -> -> -> -> ->  dashed lane-divider lines: parallel"},
            {"text": "|"},
            {"text": "branch road meets main road: non-parallel/intersecting"},
            {"text": "park fence: symmetrical design either side of the centre line"},
        ],
    },
]


def test_g4_ch10_no_paired_box_drawing_survives(monkeypatch):
    monkeypatch.setattr(S.d0_board_draw, "board_diagram", lambda b: {"type": "geometry"})
    out = S.apply_panels(_G4_CH10_PANELS, {})
    blob = " ".join(_texts(out))
    assert not _ART_RE.search(blob), blob
    for glyph in ("+----------------------+", "+----------+", "+--------+",
                  "+------+", "+--------+------+"):
        assert glyph not in blob, f"art survived: {glyph!r} in {blob!r}"


def test_g4_ch10_no_lone_pipe_or_arrow_run_survives(monkeypatch):
    """bd-1fr0w coordinator verify round 2: lone box-edge pipes ('SHADE
    INSIDE |', 'SHADE | side s', 'INSIDE |', 'B |') and the arrow-art run
    ('road: > > > > > dashed ...') must not survive -- fixing the grep isn't
    enough, the strip itself must change."""
    monkeypatch.setattr(S.d0_board_draw, "board_diagram", lambda b: {"type": "geometry"})
    out = S.apply_panels(_G4_CH10_PANELS, {})
    _no_lone_pipe_or_arrow_run(_texts(out))


def test_g4_ch10_every_real_word_and_formula_survives(monkeypatch):
    monkeypatch.setattr(S.d0_board_draw, "board_diagram", lambda b: {"type": "geometry"})
    out = S.apply_panels(_G4_CH10_PANELS, {})
    blob = " ".join(_texts(out))
    for phrase in (
        "width W", "length L", "SHADE INSIDE", "PERIMETER", "AREA",
        "P = 2 x (L + W) = 2L + 2W", "A = L x W = LW",
        "SHADE side", "side s", "All 4 sides s", "P = s + s + s + s = 4s",
        "A = s x s = s (squared)",
        "RECTILINEAR BUILDING OUTLINE (two rectangles joined)",
        "Step 1: DRAW a dashed line to split it into rectangle A and rectangle B.",
        "Step 2: MEASURE each rectangle's own length and width.",
        "AREA of rectilinear shape area A + area B (add the two areas).",
        "PERIMETER trace only the OUTER outline, not the dashed split line.",
        # the two named labels on the rectilinear panel must survive --
        # they're the only thing distinguishing rectangle A from rectangle B
        "A", "B",
        # bd-1fr0w round 2's exact required survivors, verbatim
        "SHADE INSIDE", "road: dashed lane-divider lines: parallel",
        "branch road meets main road: non-parallel/intersecting",
        "park fence: symmetrical design either side of the centre line",
    ):
        assert phrase in blob, f"missing: {phrase!r}"
    assert out[0]["label"] == "RECTANGULAR BUILDING PLOT"
    assert out[1]["label"] == "SQUARE PARK PLOT"
