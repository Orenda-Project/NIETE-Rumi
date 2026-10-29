"""WRITE ON THE BOARD is a drawing -- the seam that makes ALWAYS true.

The operator has asked four times, the fourth in capitals: *"pls make sure write on
the board section is an actual image ALWAYS rather than text instructions"*. This
module picks the one picture that board becomes.

WHY A SINGLE SPEC, NOT A LIST. `page2.board_final.diagram` is one `diagram_spec`,
and the renderer draws it through `boardPlanAtoms` (template.js:3325) -- the primary
-calibrated figure path, with `primaryRedraw`, `figureFit` and the WRITE ON THE BOARD
label already attached.

WHAT CHANGED IN bd-287sn. This module used to guarantee a figure for EVERY board by
falling back to `d0_board_chalk` -- the board text laid out as a `panels` spec. A judge
measured that figure across all 335 rebuilt documents: mean 97.3% word-token overlap
with the board text directly above it, 61.4 phone pages of duplicate ink. The slot is
ADDITIVE -- the `board` block keeps printing every authored word -- so the guarantee
bought a second copy and nothing else. It is now a real drawing or None.

WHY NOT A BLOCK IN THE INTRODUCTION. Replacing the `board` block was tried and is
wrong. `bdHoisted` (template.js:2801) and `laidOutBoard` (:3314) both key on
`b.type === "board"`, so removing it silently takes the WRITE ON THE BOARD label and
its furniture position with it, and un-suppresses `board_final.draw_order` -- the draw
script the operator ruled off the page. The board block stays; it gains a picture.
"""
import d0_board_draw
import d0_board_read


def _bd(**kw):
    """A board that HAS a drawable shape. bd-287sn: the fixture used to be three
    lines of prose, which only ever drew because the chalk text-dump supplier drew
    everything. With that supplier gone these tests would have been asserting
    against None and proving nothing."""
    b = {"title": "Opposites", "content": "Found -> Lost\nSmall -> Big\nSad -> Happy",
         "instruction": "Match the opposites"}
    b.update(kw)
    return b


def test_no_board_work_draws_nothing():
    assert d0_board_draw.board_diagram(None) is None
    assert d0_board_draw.board_diagram({}) is None
    assert d0_board_draw.board_diagram("not a dict") is None


def test_a_board_with_a_drawable_shape_becomes_a_picture():
    assert isinstance(d0_board_draw.board_diagram(_bd()), dict)


def test_the_spec_carries_a_type_because_that_is_what_renderdiagram_dispatches_on():
    assert (d0_board_draw.board_diagram(_bd()).get("type") or "").strip()


def test_no_routing_key_reaches_the_spec():
    """`replaces`/`slot` are D0 bookkeeping. The schema is additionalProperties:false."""
    spec = d0_board_draw.board_diagram(_bd())
    assert "replaces" not in spec and "slot" not in spec


def test_a_list_content_board_is_handled():
    """12 of 335 carry `content` as a JSON list, not a newline string."""
    assert isinstance(d0_board_draw.board_diagram(
        _bd(content=["Found -> Lost", "Sad -> Happy"])), dict)


def test_it_never_raises_on_junk():
    for junk in (_bd(content=None), _bd(content=123), _bd(title=None),
                 {"content": ""}, {"instruction": "x"}):
        d0_board_draw.board_diagram(junk)


def test_art_is_preferred_over_chalk_when_it_can_draw_truthfully(monkeypatch):
    import d0_board_art
    monkeypatch.setattr(d0_board_art, "spec_for",
                        lambda b: {"type": "grid", "rows": [["H", "T", "O"]]})
    assert d0_board_draw.board_diagram(_bd())["type"] == "grid"


def test_a_throwing_chooser_costs_the_figure_not_the_document(monkeypatch):
    """bd-287sn: the fall-through target is None, not a text dump. Every authored
    word is still on the page -- the `board` block above this slot prints it."""
    import d0_board_art

    def boom(*_a, **_k):
        raise ValueError("no")

    monkeypatch.setattr(d0_board_art, "spec_for", boom)
    monkeypatch.setattr(d0_board_art, "panel_spec", boom)
    assert d0_board_draw.board_diagram(_bd()) is None


def _strings(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for v in o.values():
            yield from _strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from _strings(v)


def test_the_picture_draws_the_board_content_not_just_the_script():
    """THE BUG THIS TEST EXISTS FOR. Both suppliers consume the PARSED board --
    `read_board`'s {title, panels, instruction} -- not the raw `boardWork`, whose
    `content` is one string. Handing them the raw board made `flatten` find no
    `panels` at all, so every one of the 335 pictures came out holding the draw
    script and nothing else: the exact text dump the operator rejected.
    """
    board = {"instruction": "Match each word to its meaning",
             "content": "hundreds = the H column\ntens = the T column"}
    blob = " ".join(_strings(d0_board_draw.board_diagram(board)))
    assert "the H column" in blob, "the board's own content never reached the picture"


def test_the_draw_script_is_never_inside_the_picture():
    """OPERATOR: *"its a block of text that should show clearly how it should be
    ordered rather than give a script of what to draw and how"*. `instruction` is a
    script FOR the board, addressed to the teacher. It is not on the board, so it is
    not in the drawing of the board -- and it already has its own home in
    `page2.board_final.draw_order`, which is where the one-home rule keeps it.
    """
    board = {"instruction": "Match each word to its own three columns",
             "content": "hundreds = the H column\ntens = the T column"}
    blob = " ".join(_strings(d0_board_draw.board_diagram(board)))
    assert "three columns" not in blob, "the draw script was drawn into the picture"


# ---------------------------------------------------------------------------
# bd-287sn -- the picture must be a PICTURE, or there must be no picture.
#
# A judge measured the figure this module shipped across all 335 rebuilt
# documents: mean 97.3% word-token overlap with the board text block directly
# above it, 266 of 335 at or above 95%. It is the board, re-set in SVG, printed
# twice. 61.4 phone pages of duplicate ink. The operator's *"actual image ALWAYS
# rather than text instructions"* is not answered by setting the instructions in
# a different font, and `page2.board_final.diagram` is an ADDITIVE slot -- the
# `board` block still prints every authored word above it (schema `block`:
# type=board is additionalProperties:false and has no figure slot), so a figure
# that is only the text is pure duplication with nothing gained.
# ---------------------------------------------------------------------------


def test_an_undrawable_board_gets_no_picture_rather_than_its_own_text_twice():
    prose = {"title": "Kindness", "content": "Kindness means helping others "
             "without being asked for anything at all in return."}
    assert d0_board_draw.board_diagram(prose) is None


def test_the_text_dump_type_is_never_emitted():
    """`panels` is d0_board_chalk's laid-out-text spec. It is not a drawing."""
    for board in (_bd(), _bd(content=["H T O", "3 4 5"]),
                  {"content": "Read the poem on page 40 with your partner."}):
        spec = d0_board_draw.board_diagram(board)
        assert spec is None or spec.get("type") != "panels"


def test_a_drawable_panel_wins_even_when_the_board_has_other_panels():
    """181 of 335 boards were refused outright by spec_for's `len(panels) != 1`
    gate. That gate exists for the REPLACE path (d0_diagram.py:105 overwrites the
    block, so an uncovered panel would be lost). `board_final.diagram` replaces
    nothing, so a real figure for one panel loses no word -- the board block still
    prints all of them."""
    board = {"content": "Say it aloud with me\n\nFound -> Lost\nSmall -> Big\n"
                        "Sad -> Happy\n\nCopy the pairs into your book"}
    spec = d0_board_draw.board_diagram(board)
    assert spec is not None and spec["type"] == "match"


def test_a_matching_instruction_can_still_reach_the_chooser():
    """`_readable` stripped `instruction` before `d0_board_art._meta` read it, so
    `_MATCH_SIGNAL_RE` could never fire and the `match` branch of `_try_gloss` was
    structurally unreachable in the shipping path."""
    board = {"instruction": "Match each word to its meaning",
             "content": "cat = a small furry pet\ndog = a loyal pet"}
    spec = d0_board_draw.board_diagram(board)
    assert spec is not None and spec["type"] == "match"


# bd-f2khb -- the whole-board scan, the THIRD chance.
#
# `spec_for` and `panel_spec` both refuse a board whose rows mix kinds, which is
# what a real maths board does: "thermometer = a number line" parses as `calc`,
# "lettuce=4" as `gloss`. The scan reads the whole board as text and runs LAST, so
# it can only ADD a figure where there was none -- never change one the two earlier
# chances already found.


def test_a_mixed_kind_maths_board_now_draws():
    # g1_ch8/Maths_seg6.lp.json, verbatim: `gloss` rows beside `text` rows.
    spec = d0_board_draw.board_diagram({
        "content": "BALANCE SCALE = the tool for mass\n"
                   "DOWN side = heavier, UP side = lighter\n"
                   "lettuce=4, carrot=8, cake=10 (buttons)\n"
                   "lightest -> heaviest: lettuce, carrot, cake",
        "instruction": "Draw the balance scale"})
    assert spec["type"] == "compare_size"
    assert [i["label"] for i in spec["items"]] == ["lettuce", "carrot", "cake"]


def test_a_board_the_earlier_chances_already_draw_is_left_alone():
    # An arrow chain: `panel_spec` answers this with `flow`. The scan gets no vote.
    spec = d0_board_draw.board_diagram({"content": "seed -> sprout -> plant",
                                        "instruction": ""})
    assert spec["type"] == "flow"


def test_a_board_with_nothing_drawable_is_still_none():
    assert d0_board_draw.board_diagram({
        "content": "Discuss the weather with your partner today",
        "instruction": ""}) is None


def test_a_throwing_scan_yields_none_not_a_placeholder():
    import d0_board_art_scan
    real = d0_board_art_scan.scan_spec
    d0_board_art_scan.scan_spec = lambda b: (_ for _ in ()).throw(ValueError("boom"))
    try:
        # A board only the SCAN can draw, so the throw is actually reached.
        assert d0_board_draw.board_diagram({
            "content": "BALANCE SCALE = the tool for mass\nlettuce=4, carrot=8",
            "instruction": ""}) is None
    finally:
        d0_board_art_scan.scan_spec = real


def test_the_scan_spec_is_cleaned_of_routing_keys():
    import d0_board_art_scan
    real = d0_board_art_scan.scan_spec
    d0_board_art_scan.scan_spec = lambda b: {"type": "clock", "time": "9:00",
                                             "replaces": "board-plan", "slot": "hook"}
    try:
        spec = d0_board_draw.board_diagram({"content": "xyzzy", "instruction": ""})
        assert spec == {"type": "clock", "time": "9:00"}
    finally:
        d0_board_art_scan.scan_spec = real


def test_a_scan_spec_with_no_type_is_refused_rather_than_drawn_as_a_placeholder():
    # TRAP A (bd-6v5gh). renderDiagram dispatches on `type`; a spec without one makes
    # the renderer print a visible dashed "DIAGRAM - / not rendered" box
    # (template.js:1710) -- worse for the teacher than no figure at all.
    import d0_board_art_scan
    real = d0_board_art_scan.scan_spec
    for typeless in ({"from": 0, "to": 10}, {"type": "", "from": 0}, {"type": "   "}):
        d0_board_art_scan.scan_spec = lambda b, t=typeless: t
        try:
            assert d0_board_draw.board_diagram(
                {"content": "xyzzy", "instruction": ""}) is None, typeless
        finally:
            d0_board_art_scan.scan_spec = real


def test_the_scan_runs_last_so_a_figure_the_earlier_chances_found_is_kept():
    # This board is drawable BOTH ways: the arrow chain gives `panel_spec` a `flow`,
    # and "scale: 0, 10, 20" gives the scan a `numberline`. The earlier chance wins,
    # because the scan may only ADD a figure, never replace one.
    work = {"content": "LEFT (life cycle):\nseed -> sprout -> plant\n\n"
                       "RIGHT (the ruler):\nscale: 0, 10, 20", "instruction": ""}
    import d0_board_art_scan
    assert d0_board_art_scan.scan_spec(
        d0_board_read.read_board(work))["type"] == "numberline"
    assert d0_board_draw.board_diagram(work)["type"] == "flow"
