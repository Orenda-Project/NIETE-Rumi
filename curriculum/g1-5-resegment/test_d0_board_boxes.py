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


# bd-1fr0w: ASCII box art (`+`, `-`, `|`) survives verbatim on the teacher's page because
# `_unbox` only strips the Unicode block. Unlike that block, `-` is also a hyphen and `|`
# also separates a sound-map beat ("VC |     |"), so the ASCII path cannot reuse `_unbox`'s
# "any run touches an edge -> strip every run" rule without corrupting real prose. See
# `_unbox_ascii`'s own docstring for the narrower rule it uses instead.

def test_unbox_itself_never_fires_on_ascii_frame_characters():
    """`_unbox` stays Unicode-only -- the caller falls back to `_unbox_ascii`."""
    line = "|                      |  width"
    assert BX._unbox(line) == (line, False)


def test_ascii_leading_frame_strips_iteratively_to_the_label():
    line = "|                      |  width"
    content, framed = BX._unbox_ascii(line)
    assert framed is True
    assert content == "width"


def test_ascii_frame_strip_never_touches_a_mid_word_hyphen():
    """A naive port of `_unbox`'s rule (strip every matched run once ANY run touches
    an edge) deletes the hyphen out of "non-parallel" because a leading lone '|' on
    the same line makes it "framed". `_unbox_ascii` strips ONLY the leading run, so
    interior prose -- including a real hyphen -- is never touched."""
    line = "|   branch road meets main road: non-parallel/intersecting"
    content, framed = BX._unbox_ascii(line)
    assert framed is True
    assert content == "branch road meets main road: non-parallel/intersecting"


def test_ascii_frame_strip_leaves_a_pure_drawing_completely_alone():
    """Stripping every ASCII frame character off a line that is ONLY frame characters
    would empty it -- silently deleting a drawn shape the teacher must put on the
    board, which is the forbidden 'cutting'. `_unbox_ascii` must refuse instead."""
    for line in ("+----------------------+", "+---+", "|   |/", "+--------+------+"):
        assert BX._unbox_ascii(line) == (line, False), line


def test_ascii_frame_strip_ignores_a_stroke_drawn_from_a_slash():
    """A freehand stroke drawn from '/' (the cube's edge, a triangle's side) is not
    in the class this helper strips -- not even partially."""
    line = "/   /|"
    assert BX._unbox_ascii(line) == (line, False)


def test_ascii_frame_strip_never_mistakes_a_leading_ascii_arrow_for_a_frame():
    line = "-> next step"
    assert BX._unbox_ascii(line) == (line, False)


def test_ascii_frame_strip_never_touches_a_sound_map_beat_row():
    """English_seg1's phonics rows mark an empty beat with a bare trailing '|'
    ('VC |     |', 'CV |') -- not part of this ticket's 27-string sweep, and
    stripping it would delete real notation. Each line's own first character is a
    letter, so `_unbox_ascii` must never match at all."""
    for line in ("VC |     |", "CV |"):
        assert BX._unbox_ascii(line) == (line, False), line
