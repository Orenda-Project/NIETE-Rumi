"""The routing the operator's page map asked for, and the three defects it fixed.

These cover d0_blocks/d0_primary changes that move a field to a different surface or a
different block. The transform's structural invariants stay in test_d0_primary.py; the
hook split has its own file. All three read the same fixture.
"""

import copy

import d0_blocks as B
import d0_primary as d0
from test_d0_primary import ENR, PT, build


def section(doc, sid):
    return [s for s in doc["sections"] if s["id"] == sid][0]


def blocks_of(doc, sid, btype=None):
    bs = section(doc, sid)["blocks"]
    return [b for b in bs if btype is None or b["type"] == btype]


class TestWriteOnTheBoardIsOnPageOne:
    """*"finally there should be a write on the board section here with all the relevant
    things that will go on the board"* -- `here` being page 1."""

    def test_the_finished_board_prints_in_the_opening_section(self):
        board = blocks_of(build(), "introduction", "board")
        assert len(board) == 1
        assert board[0]["text"] == "sway -> side to side"

    def test_it_is_the_last_thing_on_page_one(self):
        # She reads it immediately before she starts writing.
        assert section(build(), "introduction")["blocks"][-1]["type"] == "board"

    def test_the_board_carries_its_own_build_order(self):
        """*"a block of text that should show clearly how it should be ordered"* -- so the
        order is IN the board, as panels, not narrated beside it."""
        board = blocks_of(build(), "introduction", "board")[0]
        assert [r for p in board["panels"] for r in p["rows"]] == \
            [{"term": "sway", "gloss": "side to side"}]

    def test_the_draw_SCRIPT_is_still_stored_but_has_nowhere_to_print(self):
        # page2.board_final is required by the schema, so it is still emitted from
        # boardWork.instruction. The renderer drops it whenever the board above is
        # panelled (template.js laidOutBoard) -- see d0_page2's docstring.
        order = build()["page2"]["board_final"]["draw_order"]
        assert order == ["Draw four labelled boxes", "Add arrows."]
        assert not any("sway -> side to side" in l for l in order)

    def test_a_lesson_with_no_board_content_grows_no_empty_panel(self):
        enr = copy.deepcopy(ENR)
        enr["generated"]["boardWork"]["content"] = ""
        assert blocks_of(d0.to_lp_doc(enr, PT), "introduction", "board") == []


class TestTheYouDoWall:
    """153 unbroken words in one paragraph was the tallest block in the render."""

    def test_the_task_script_is_a_list_of_moves_not_one_paragraph(self):
        acts = blocks_of(build(), "activity")
        assert not any(b["type"] == "paragraph" for b in acts)
        task = [b for b in acts if b.get("id") == "you-do-task"]
        assert len(task) == 1 and task[0]["type"] == "key_points"

    def test_each_move_keeps_its_own_line(self):
        task = [b for b in blocks_of(build(), "activity") if b["id"] == "you-do-task"][0]
        assert task["items"] == ["On your own."]


class TestTeacherRoleIsNotAnAnswer:
    """faded_example prints `answer` as "Answer: ...", so the page read
    "Answer: Circulate." -- a label naming the wrong thing about the wrong field."""

    def test_the_we_do_box_no_longer_claims_to_hold_an_answer(self):
        we = [b for b in blocks_of(build(), "activity") if b["id"] == "we-do"][0]
        assert "answer" not in we

    def test_what_she_does_while_they_work_joins_the_set_up_line(self):
        we = [b for b in blocks_of(build(), "activity") if b["id"] == "we-do"][0]
        assert we["prompt"] == "Pairs rehearse. · Circulate."


class TestTheScriptIsQuotedExactlyOnce:
    def test_an_unquoted_line_is_given_its_quotes(self):
        assert B.move_lines([{"say": "Look at the picture."}]) == [
            "Say: “Look at the picture.”"
        ]

    def test_a_line_stage_c_already_quoted_is_not_quoted_again(self):
        # Roughly a third of the corpus arrives pre-quoted; wrapping it printed
        # ""Look at the picture."" on the page.
        for q in ("“Look at the picture.”", '"Look at the picture."'):
            got = B.move_lines([{"say": q}])
            assert got == [f"Say: {q}"]
            assert "““" not in got[0] and '""' not in got[0]
