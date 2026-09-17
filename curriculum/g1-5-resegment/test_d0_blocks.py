"""Stage D0 block builders — unit tests.

Run: python3 test_d0_blocks.py
"""

import json

import d0_blocks as B


def test_first_warmup_item_is_the_scaffold():
    """Schema: the scaffold for TODAY'S concept comes first."""
    items = B.warmup_items({"items": [{"prompt": "Count to ten."},
                                      {"prompt": "Name a shape."}]})
    assert [i["kind"] for i in items] == ["scaffold", "prerequisite"]


def test_retrieval_flavoured_items_are_spaced():
    items = B.warmup_items({"items": [
        {"prompt": "Recall yesterday.", "type": "cumulative peer retrieval"}]})
    assert items[0]["kind"] == "spaced"


def test_expected_answer_is_read_under_all_four_spellings():
    for key, val in [("expected_answer", "A"), ("expected", "B"),
                     ("expected_answers", ["C", "D"]),
                     ("expected_spelling_check", "E")]:
        got = B.warmup_items({"items": [{"prompt": "Name it?", key: val}]})[0]["a"]
        assert got in ("A", "B", "C; D", "E"), (key, got)


def test_missing_answer_surfaces_as_design_pending():
    """Dark stages stay dark — never a plausible-looking proxy."""
    assert B.warmup_items({"items": ["bare string"]})[0]["a"] == B.DESIGN_PENDING


def test_move_minutes_come_from_the_source_not_a_guess():
    blk = B.we_do_block([{"phase": "We-Do", "minutes": 9, "action": "Try together."}], None)
    assert blk["minutes"] == 9 and blk["type"] == "faded_example"
    out = B.you_do_blocks([{"phase": "You-Do", "minutes": 8, "action": "Alone."}],
                          [{"prompt": "Do one.", "solution": "Like this."}])
    prac = [b for b in out if b["type"] == "practice"][0]
    assert prac["minutes"] == 8 and prac["mode"] == "independent"


def test_we_do_script_is_not_dressed_as_a_question():
    """The teacher's own words are prose. An earlier pass printed them as items
    with a fabricated "design pending" answer beside each one."""
    blk = B.we_do_block([{"phase": "We-Do", "minutes": 9, "action": "Try together.",
                          "say": "Say it with me."}],
                        {"dialogueFrameA": "Our word is __.", "teacher_role": "Circulate."})
    assert blk["type"] == "faded_example"
    assert "items" not in blk
    assert B.DESIGN_PENDING not in json.dumps(blk, ensure_ascii=False)
    assert blk["steps"] == ["Try together.", "Say: \u201cSay it with me.\u201d",
                            "Our word is __."]


def test_you_do_task_is_a_move_list_and_only_problems_become_items():
    """The task script was a `paragraph` until the readability pass.

    `" ".join(lines)` printed 153 unbroken words on the G4 English segment -- the tallest
    block in the render. `move_lines` already separates the moves; the paragraph threw
    that structure away. Same words, same order, one line each.
    """
    out = B.you_do_blocks([{"phase": "You-Do", "minutes": 8, "action": "In groups of four."}],
                          [{"prompt": "Show me sway.", "solution": "Move side to side."}])
    assert [b["type"] for b in out] == ["key_points", "practice"]
    assert out[0]["items"] == ["In groups of four."]
    assert out[1]["items"] == [{"q": "Show me sway.", "a": "Move side to side."}]


def test_script_is_kept_verbatim_beside_its_action():
    lines = B.move_lines([{"action": "Model it.", "say": "Watch me."}])
    assert lines == ["Model it.", "Say: “Watch me.”"]


def test_worked_example_drops_only_what_the_script_already_says():
    """Per line, not per field. Urdu worked examples are 100% restatement and
    Science's are 100% new, so a blanket rule either way loses or duplicates."""
    said = ["Model two words using the title and picture.", "Say: \u201cI read the title.\u201d"]
    lines = ["Model two words using the title and picture.",   # already said -> drop
             "word: crescendo",                                 # new -> keep
             "word: crescendo"]                                 # internal repeat -> drop
    out = B.drop_lines_already_said(lines, said)
    assert out == ["word: crescendo"]


def test_a_fuller_worked_line_survives_a_shorter_script_line():
    """Containment the other way keeps the richer line; the script line it
    swallows carries the move's minutes and stays where it is."""
    out = B.drop_lines_already_said(
        ["Divide 84 by 12 to get 7, then label the answer 7 years."], ["Divide 84 by 12"])
    assert len(out) == 1


def test_the_script_rides_along_as_turns_and_the_flat_lines_stay():
    """The additive-field pattern (SYNC §3.16): `turns` is added, `steps` is kept.

    `steps` is the home the lint profile, Stage E's voicenotes and the WhatsApp body
    already address. Moving the script into `turns` would have gone dark in three
    readers to win one page, so both are emitted and the renderer chooses.
    """
    blk = B.i_do_block([{"phase": "I-Do", "minutes": 6,
                         "action": "Model two words on p.102.",
                         "say": "Look at the title. What do you see?"}])
    assert blk["steps"] == ["Model two words on p.102.",
                            "Say: “Look at the title. What do you see?”"]
    assert [t["kind"] for t in blk["turns"]] == ["do", "say", "ask"]
    assert blk["turns"][0]["ref"] == "p.102", "the citation moves to a chip"


def test_a_move_with_no_script_emits_no_turns_key_at_all():
    """Absent, not empty. An empty list is a script of no turns; the renderer has to
    be able to tell that apart from one it should fall back to `steps` for."""
    blk = B.i_do_block([{"phase": "I-Do", "minutes": 4, "action": "", "say": ""}])
    assert blk is None
    blk = B.i_do_block([{"phase": "I-Do", "minutes": 4, "action": "A", "say": ""}])
    assert blk is None or "turns" not in blk


def test_the_dialogue_frames_join_the_we_do_script_not_the_end_of_it():
    """They are the pupils' words and already carry `___`, so they belong with the
    speech that sets them up rather than as two more paragraphs after it."""
    blk = B.we_do_block(
        [{"phase": "We-Do", "minutes": 9, "action": "Try together.",
          "say": "Say it with me."}],
        {"structure": "Pairs rehearse.", "dialogueFrameA": "Our word is ___.",
         "dialogueFrameB": "I agree because ___.", "teacher_role": "Circulate."})
    assert [t["kind"] for t in blk["turns"]] == ["do", "say", "frame", "frame"]
    # the flat fallback still carries them, in the same order
    assert blk["steps"][-2:] == ["Our word is ___.", "I agree because ___."]


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
