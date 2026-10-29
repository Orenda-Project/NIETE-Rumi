"""A drawn table keeps its columns and puts a wrapped cell back together."""

from d0_board_table import split_table

# Verbatim from grade_3_english_ch9_seg2 boardWork.content -- the three-column chart
# whose columns were being erased and concatenated into one run-on row (bd-pmv8n).
G3_EN2 = """┌──────┬───────┬────────┐
│ Scene            │ Exact words   │ What must happen?  │
├──────┼───────┼────────┤
│ TV screen, p.100 │ “Hold tight!” │ Hold tight.        │
│ Aeroplane, p.101 │ “Fasten your   │ Fasten your seat.  │
│                  │ seatbelts.”   │                    │
└──────┴───────┴────────┘""".split("\n")


def test_a_top_border_with_a_tee_is_read_as_a_table_not_as_frame_to_strip():
    before, table, after = split_table(G3_EN2)
    assert before == [] and after == []
    assert table is not None
    assert table["header"] == ["Scene", "Exact words", "What must happen?"]


def test_every_cell_of_a_row_stays_its_own_cell():
    _, table, _ = split_table(G3_EN2)
    assert table["rows"][0] == ["TV screen, p.100", "“Hold tight!”", "Hold tight."]


def test_a_cell_wrapped_onto_a_second_line_is_put_back_together():
    """`“Fasten your / seatbelts.”` is ONE authored cell the author wrapped to fit the
    drawn column. The continuation line's first cell is empty, which is the only thing
    that tells it from a row of its own."""
    _, table, _ = split_table(G3_EN2)
    assert len(table["rows"]) == 2
    assert table["rows"][1] == [
        "Aeroplane, p.101",
        "“Fasten your seatbelts.”",
        "Fasten your seat.",
    ]


def test_lines_around_the_table_are_handed_back_untouched():
    lines = ["New words", *G3_EN2, "Copy it into your notebook."]
    before, table, after = split_table(lines)
    assert before == ["New words"]
    assert after == ["Copy it into your notebook."]
    assert table is not None


def test_a_header_needs_a_divider_under_it():
    """Without a `├─┼─┤` rule under it the opening line is a row, not a header --
    g1_ch10 Urdu_seg1 draws a two-column vocab table whose FIRST line is already a
    word and its meaning, and promoting it to a header loses that pair."""
    lines = [
        "┌────┬─────┐",
        "│ sway │ move │",
        "│ spin │ turn │",
        "└────┴─────┘",
    ]
    _, table, _ = split_table(lines)
    assert table["header"] is None
    assert table["rows"] == [["sway", "move"], ["spin", "turn"]]


def test_two_boxes_side_by_side_are_not_one_table():
    """g1_ch9 English_seg6 draws LONG /u/ beside NOT long /u/. Four `│` on a line, no
    `┬` anywhere -- the gap between them is board, not a column rule."""
    lines = [
        "┌──────┐     ┌──────┐",
        "│ LONG │     │ NOT  │",
        "└──────┘     └──────┘",
    ]
    assert split_table(lines) == (lines, None, [])


def test_an_arrow_join_on_a_bottom_border_is_not_a_table():
    """g2_ch10 Urdu_seg6 hangs a `↓` off `└──┬──┘`. The tee is on a CLOSING border,
    so it marks where the arrow leaves the box, not where a column divides it."""
    lines = [
        "┌─────────┐",
        "│ my school │",
        "└───┬─────┘",
        "    ↓",
    ]
    assert split_table(lines) == (lines, None, [])


def test_a_drawn_shape_that_crosses_itself_is_not_a_table():
    """g4_ch10 Maths_seg3 draws a rectilinear shape: its `┼` line OPENS with `┌` and
    CLOSES with `┘`, which no table border ever does."""
    lines = [
        "          ┌──── 3 m ────┐",
        "          │   Shape 2   │ 4 m",
        "┌── 4 m ──┼─────────────┘",
        "│ Shape 1 │",
        "└─────────┘",
    ]
    assert split_table(lines) == (lines, None, [])


def test_a_board_with_no_box_at_all_is_handed_straight_back():
    lines = ["sway = move slowly", "twirl = spin around"]
    assert split_table(lines) == (lines, None, [])
