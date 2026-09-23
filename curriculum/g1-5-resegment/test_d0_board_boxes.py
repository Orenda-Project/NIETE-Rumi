"""ASCII frames come off; the arrows drawn from the same characters stay on.

These are the two behaviours the corpus bugs named in `d0_board_boxes` were about --
38 arrows across 10 boards mangled into a bare ">" when frame-stripping was greedy
(and one panel deleted outright), and two boards drawn back to back read as one
15-row panel (bd-i44jn).
"""
import d0_board_boxes as BX


def test_a_frame_that_touches_the_edge_is_stripped():
    line = "┌──── Apostrophe Alley ────┐"
    content, framed = BX._unbox(line)
    assert framed is True
    assert content == "Apostrophe Alley"


def test_an_arrow_is_never_mistaken_for_a_frame():
    """`--> ` is drawn from the box-drawing block and is CONTENT, not a frame.
    Stripping it left a bare ">" and deleted a whole panel."""
    line = "[Question] ──> [KEY words] ──> [Main point]"
    content, framed = BX._unbox(line)
    assert framed is False
    assert content == line


def test_a_unicode_arrow_is_untouched_because_it_is_not_in_the_block():
    line = "→ APPLY THE CLUE →"
    assert BX._unbox(line) == (line, False)


def test_a_box_that_closes_before_another_opens_is_a_second_board():
    group = ("┌─ ONE ─┐\n"
             "a\n"
             "└────┘\n"
             "then chalk this\n"
             "┌─ TWO ─┐\n"
             "b\n"
             "└────┘")
    out = BX._boards(group)
    assert len(out) == 2, out
    # the line in the gap leads INTO the second board, so it is that board's connector
    assert out[1][1] == "then chalk this"


def test_one_box_alone_is_one_board():
    group = "┌─ ONE ─┐\na\nb\n└────┘"
    assert len(BX._boards(group)) == 1


def test_no_line_of_a_trailing_gap_is_lost():
    """A gap after the last close has no board to lead into, so it stays a row --
    nothing authored may be dropped."""
    group = "┌─ ONE ─┐\na\n└────┘\ntrailing note"
    out = BX._boards(group)
    assert len(out) == 1
    assert any("trailing note" in l for l in out[0][0])
