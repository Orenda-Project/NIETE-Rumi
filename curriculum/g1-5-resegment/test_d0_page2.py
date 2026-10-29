"""Stage D0 — page 2, and who is quoted in the slip box. Unit tests.

Run: python3 -m pytest test_d0_page2.py -q     (or: python3 test_d0_page2.py)
"""

import d0_blocks
import d0_page2
from test_d0_primary import ENR

DP = d0_blocks.DESIGN_PENDING

# The corpus writes `misconception_preempt` two ways. 13 of the 38 segments carry it at all.
MOVE = "Explicitly contrast the two apostrophe purposes before the pairs work."
PAIR = {"misconception": "They add 's to every word ending in s.",
        "correction": "Ask who owns it before you write anything."}


def _mistakes(se):
    return d0_page2.build({**ENR["generated"], "subject_elements": se})["mistakes"]


def test_a_string_preempt_is_a_teacher_move_and_prints_as_one():
    """The box is labelled "What pupils write" / "You ask". A string
    `misconception_preempt` is an instruction to the TEACHER -- it starts with a verb she
    performs -- so printing it under "What pupils write" puts her own move in a child's
    mouth and leaves the column she actually reads blank."""
    m = _mistakes({"misconception_preempt": MOVE})[0]
    assert m["you_ask"] == MOVE
    assert m["pupil_says"] == DP


def test_the_error_itself_is_not_invented_to_fill_the_column():
    """Dark stages stay dark. Stage C authored the move and not the error, so the error
    says so rather than being reverse-engineered from the move."""
    assert _mistakes({"misconception_preempt": MOVE})[0]["pupil_says"] == DP


def test_a_pair_still_prints_in_both_columns():
    """The dict form carries both halves and already routed correctly. It must keep doing so."""
    m = _mistakes({"misconception_preempt": PAIR})[0]
    assert m["pupil_says"] == PAIR["misconception"]
    assert m["you_ask"] == PAIR["correction"]


def test_a_list_of_strings_routes_every_one_of_them():
    got = _mistakes({"misconception_preempt": [MOVE, "Name the owner out loud first."]})
    assert [x["you_ask"] for x in got] == [MOVE, "Name the owner out loud first."]
    assert {x["pupil_says"] for x in got} == {DP}


def test_no_preempt_at_all_leaves_both_columns_dark():
    assert _mistakes({}) == [{"pupil_says": DP, "you_ask": DP}]


# --- WRITE ON THE BOARD is a DRAWING (bd-18e9x) ---------------------------------
#
# OPERATOR, five times, the fourth in capitals: *"pls make sure write on the board
# section is an actual image ALWAYS rather than text instructions"*. The whole
# `d0_board_draw` pipeline existed and was tested, but nothing ever called it, so
# `page2.board_final` reached the renderer with `draw_order` alone and `boardPlanAtoms`
# (template.js:3325) had no figure to draw. These tests are the seam.


def _board_final(**over):
    g = {**ENR["generated"], **over}
    return d0_page2.build(g)["board_final"]


def test_a_board_reaches_the_renderer_as_a_drawing():
    """THE POINT. `boardPlanAtoms` only draws when `B.diagram` is present."""
    assert isinstance(_board_final().get("diagram"), dict)


def test_the_drawing_carries_a_type_because_renderdiagram_dispatches_on_it():
    """A spec without a `type` fails the schema (`diagram_spec.required`) and would
    render as the dashed "DIAGRAM - ? / not rendered" box (template.js:1710)."""
    assert (_board_final()["diagram"].get("type") or "").strip()


def test_the_draw_script_keeps_its_own_home_beside_the_drawing():
    """One home per fact. `instruction` stays in `draw_order`; the picture draws the
    board's CONTENT. Adding the figure must not disturb the required field."""
    bf = _board_final()
    assert bf["draw_order"] == ["Draw four labelled boxes", "Add arrows."]


def test_a_lesson_with_no_board_carries_no_empty_figure():
    """`diagram` is optional in the schema. An absent key is a board that was never
    written; an empty dict would be a spec the engine cannot dispatch."""
    assert "diagram" not in _board_final(boardWork={})
    assert "diagram" not in _board_final(boardWork={"instruction": "Draw it."})


def test_a_board_that_cannot_be_drawn_never_takes_the_document_down(monkeypatch):
    """Totality. `board_diagram` is already total, but the CALL must be too: page2 is
    required, so an exception here loses the whole lesson, not just the picture."""
    import d0_board_draw

    def boom(_):
        raise ValueError("no")

    monkeypatch.setattr(d0_board_draw, "board_diagram", boom)
    assert "diagram" not in _board_final()


if __name__ == "__main__":
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ok   {name}")
            except Exception as e:
                fails += 1
                print(f"  FAIL {name}: {type(e).__name__}: {e}")
    print("FAILED" if fails else "all passed")
    raise SystemExit(1 if fails else 0)
