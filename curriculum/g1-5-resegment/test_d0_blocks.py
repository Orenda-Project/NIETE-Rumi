"""Stage D0 block builders — unit tests.

Run: python3 test_d0_blocks.py
"""

import json

import d0_blocks as B


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


# ── the walls: a paragraph in a list is a paragraph ───────────────────────────
# `you-do-task` is 41,152 words over the 335-lesson corpus and 34,269 of them sit
# in a single unbroken item of more than 40 words -- the largest such pool in the
# render. I-Do and We-Do escape it through `d0_script.turns`; this list never did.

WALL = ('Say: “Now it is your turn to write. Think of one special day in your own '
        'life, any moment at all that you still remember clearly today. Write the '
        'opening and the middle of it on your slate, exactly the way we just did it '
        'together with Zainab. When you have written both, read the whole thing out '
        'to the partner sitting beside you.”')


def _words(s):
    import re
    return [w for w in re.split(r"\s+", (s or "").strip()) if w]


def test_the_you_do_task_wall_is_split_into_one_item_per_sentence():
    out = B.you_do_blocks([{"phase": "You-Do", "minutes": 8, "say": WALL[5:].strip()}], [])
    task = [b for b in out if b["type"] == "key_points"][0]
    assert len(task["items"]) == 4, task["items"]
    assert all(len(_words(i)) <= 40 for i in task["items"]), task["items"]


def test_splitting_the_task_removes_no_word_of_it():
    steps = [{"phase": "You-Do", "minutes": 8, "say": WALL[5:].strip()}]
    out = B.you_do_blocks(steps, [])
    task = [b for b in out if b["type"] == "key_points"][0]
    assert _words(" ".join(task["items"])) == _words(" ".join(B.move_lines(steps)))


def test_the_say_label_is_not_authored_twice():
    """111 strings over 37 corpus docs arrived as `Say: “Say: "...."”`."""
    steps = [{"phase": "You-Do", "minutes": 8,
              "say": 'Say: "Page 132 says to write the opposite of the word you found."'}]
    task = [b for b in B.you_do_blocks(steps, []) if b["type"] == "key_points"][0]
    assert task["items"][0].count("Say:") == 1, task["items"][0]


def test_the_stage_directions_of_a_move_are_split_too():
    """`_with_turns` is the one place turns reach a block, so the split lands there."""
    action = ("Draw the three-column table on the left half of the board and head the "
              "columns Sound, Word and Picture. Hand each pair one slate and one piece "
              "of chalk as they settle. Keep the textbook open at page 104 on the desk.")
    blk = B.i_do_block([{"phase": "I-Do", "minutes": 7, "action": action}])
    dos = [t for t in blk["turns"] if t["kind"] == "do"]
    assert len(dos) == 3, dos
    assert _words(" ".join(t["text"] for t in dos)) == _words(action)


def test_the_say_label_is_authored_once_at_source():
    lines = B.move_lines([{"say": 'Say: "Page 132 says to write the opposite."'}])
    assert lines == ['Say: "Page 132 says to write the opposite."']
