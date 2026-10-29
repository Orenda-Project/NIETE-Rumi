"""The board keeps its authored order and loses none of its words."""

import json
import unittest

import d0_board as BD

# Verbatim from grade_4_english_ch9 boardWork.content -- title, a labelled pair panel,
# a banner, and an unlabelled worked example.
REAL = """CHAPTER 9 REVIEW: THE DANCING POEM

READ → EXPLAIN → ASK → WRITE

Vocabulary:
sway = move slowly side to side
twirl = spin around quickly

CINQUAIN LADDER
[1 word] Title
[2 words] Describe

Dance
Colourful, lively
Twirling, leaping, spinning"""


# Verbatim from grade_4_english_ch9_seg6 -- two finished boards, an arrow between them,
# and not one blank line in the whole field.
TWO_BOARDS = """\u250c\u2500\u2500\u2500\u2500 Apostrophe Alley \u2500\u2500\u2500\u2500\u2510
Apostrophe = belonging OR missing letters
Jojo's ball \u2192 the ball belongs to Jojo
is not \u2192 isn't
cannot \u2192 can't
\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518
                         \u2192 APPLY THE CLUE \u2192
\u250c\u2500\u2500\u2500\u2500 Present Simple Party \u2500\u2500\u2500\u2500\u2510
Often / always true
The sun ______ in the east. \u2192 The sun rises in the east.
Birds ______ in the sky. \u2192 Birds fly in the sky.
\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518"""

# Verbatim from grade_4_science_ch9_seg2 -- ONE table, drawn as a box.
TABLE = """\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2510
\u2502 INSTRUMENT / APPARATUS \u2502 WHAT IT DOES \u2502
\u251c\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2524
\u2502 Thermometer \u2502 measures temperature \u2502
\u2502 Digital balance \u2502 measures weight \u2502
\u2502 Stopwatch \u2502 measures time passed \u2502
\u2502 Calculator \u2502 does maths and calculations \u2502
\u2502 Blood pressure apparatus \u2502 measures blood pressure \u2502
\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2518"""

# Verbatim from grade_4_maths_ch9_seg9 -- two boxes, SIDE BY SIDE, one arrow across.
SIDE_BY_SIDE = """\u250c\u2500\u2500\u2500\u2500\u2510      5 years later      \u250c\u2500\u2500\u2500\u2500\u2510
\u2502 TODAY'S DATE (year) \u2502 \u2500\u2500\u2500\u2500\u2500> \u2502 INTENDED OPENING DATE (year) \u2502
\u2502 starting time \u2502     ADD 5 years     \u2502 future time \u2502
\u2514\u2500\u2500\u2500\u2500\u2518                        \u2514\u2500\u2500\u2500\u2500\u2518"""

# Verbatim board["text"] from renders/g5_ch9/docs/Science_seg4.lp.json (board-plan,
# sections[0]/blocks[4]) -- bd-obv6l. The source trace double-escaped every newline, so
# it survives JSON decoding as the two characters backslash+"n", not one line break.
DOUBLE_ESCAPED = 'INVESTIGATE FIRST\\nPREDICT \u2192 BUILD / CONNECT \u2192 OBSERVE \u2192 EXPLAIN \u2192 IMPROVE\\n\\nFOOTBRIDGE\\n[sticks side-by-side] \u2192 flat floor\\nadd sides + string / extra sticks \u2192 test light weight first\\n\\nBOOKSHELF STARTING SIZE\\n          30 cm tall\\n     \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\\n     \u2502 back:        \u2502 20 cm wide\\n     \u2502 30 cm \u00d7 20 cm\u2502\\n     \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\\nside: 30 cm \u00d7 15 cm\\nshelf/top/bottom: 20 cm \u00d7 15 cm\\n\\nLED POLARITY\\n     LED\\n      \u25cf\\nlong leg        short leg\\n   +                -\\n   |                |\\nbattery +       battery -\\n\\nSafety: Keep wires neat. Do not let wires touch. Cover connections with tape.'

# Verbatim from renders/g1_ch10/docs/Maths_seg1.lp.json (board-plan, sections[0]/blocks[2])
# -- NOT a defect. Every backslash here is triangle ASCII art sitting immediately before a
# real newline or an underscore, never before the letter n, so it must survive unchanged.
CIRCLE_TRIANGLE_ART = ('2-D Shape Safari\n\nRECTANGLE                 SQUARE\n+--------+                '
                        '+----+\n|        |                |    |\n+--------+                +----+\n'
                        '4 sides, 4 corners        4 equal sides, 4 corners\n\nCIRCLE                    '
                        'TRIANGLE\n  (    )                    /\\\n /      \\                  /  \\\n '
                        '\\      /                 /____\\\n  (____)                 0 sides, 0 corners'
                        '      3 sides, 3 corners\n\nvertices = corners\nTrace the edge \u2192 count sides '
                        '\u2192 count corners')


def words_of(out):
    """Every WORD the parse put somewhere, in panel order then row order.

    Words, not lines: the ` = ` and the heading's colon are deliberately consumed -- they
    become the gloss column and the panel label, which is the whole point. Everything the
    author actually wrote has to still be on the board, in the order they wrote it.
    """
    got = [out["title"]] if out.get("title") else []
    for p in out["panels"]:
        # A connector prints between two boards, above the one it leads into, so it is a
        # place the parse puts words and it is read back here like any other.
        if p.get("connector"):
            got.append(p["connector"])
        if p.get("label"):
            got.append(p["label"])
        for r in p["rows"]:
            got.append(r["text"] if "text" in r else f'{r["term"]} {r["gloss"]}')
    return " ".join(got).split()


class TestTheBoardIsOrdered(unittest.TestCase):
    def test_the_title_spans_the_board_and_is_not_a_panel(self):
        out = BD.board_panels(REAL)
        self.assertEqual(out["title"], "CHAPTER 9 REVIEW: THE DANCING POEM")
        self.assertNotIn("CHAPTER 9 REVIEW: THE DANCING POEM",
                         [p.get("label") for p in out["panels"]])

    def test_panels_come_out_in_the_order_they_go_up(self):
        out = BD.board_panels(REAL)
        self.assertEqual([p.get("label") for p in out["panels"]],
                         [None, "Vocabulary", "CINQUAIN LADDER", None])

    def test_a_heading_labels_its_panel_and_stops_being_a_row(self):
        panel = BD.board_panels(REAL)["panels"][1]
        self.assertEqual(panel["label"], "Vocabulary")
        self.assertEqual([r.get("term") for r in panel["rows"]], ["sway", "twirl"])
        self.assertEqual(panel["rows"][0]["gloss"], "move slowly side to side")

    def test_a_one_line_group_is_a_banner_not_a_pair(self):
        """`READ → EXPLAIN → ASK → WRITE` is a sequence across the whole panel.

        It has arrows in it, so the pair split would happily make `READ` the term and
        the rest its gloss -- correct code, wrong board.
        """
        rows = BD.board_panels(REAL)["panels"][0]["rows"]
        self.assertEqual(rows, [{"text": "READ → EXPLAIN → ASK → WRITE"}])

    def test_lines_that_are_not_pairs_stay_the_string_the_author_wrote(self):
        rows = BD.board_panels(REAL)["panels"][2]["rows"]
        self.assertEqual([r["text"] for r in rows], ["[1 word] Title", "[2 words] Describe"])

    def test_the_looser_separator_binds_last(self):
        """"sway → may → display  = rhyme" is one chain glossed "rhyme"."""
        out = BD.board_panels("Poem clue:\nsway → may → display  = rhyme\nx = y")
        self.assertEqual(out["panels"][0]["rows"][0],
                         {"term": "sway → may → display", "gloss": "rhyme"})

    def test_a_board_with_no_blank_lines_is_one_panel_of_rows(self):
        out = BD.board_panels("a = 1\nb = 2")
        self.assertEqual(len(out["panels"]), 1)
        self.assertEqual(len(out["panels"][0]["rows"]), 2)

    def test_nothing_is_dropped_and_nothing_is_reordered(self):
        # Only a TRAILING colon is consumed (it marks a heading). The one inside
        # "CHAPTER 9 REVIEW: THE DANCING POEM" is part of the title and stays.
        want = " ".join(l.strip().rstrip(":") for l in REAL.split("\n") if l.strip())
        want = want.replace(" = ", " ").split()
        self.assertEqual(words_of(BD.board_panels(REAL)), want)


class TestItRefusesToGuess(unittest.TestCase):
    def test_empty_content_is_no_board(self):
        self.assertEqual(BD.board_panels(""), {"panels": []})
        self.assertEqual(BD.board_panels(None), {"panels": []})

    def test_a_lone_line_is_board_content_not_a_title(self):
        """One line and nothing else is what goes ON the board. Promoting it printed a
        board heading over an empty board -- three Urdu boards in the corpus do this."""
        out = BD.board_panels("Keep the word wall visible")
        self.assertIsNone(out.get("title"))
        self.assertEqual(out["panels"], [{"rows": [{"text": "Keep the word wall visible"}]}])

    def test_a_heading_with_no_lines_under_it_is_not_a_label(self):
        out = BD.board_panels("Vocabulary:\n\nsway = side to side")
        self.assertEqual(out.get("title"), "Vocabulary")
        self.assertEqual(out["panels"][0]["rows"][0]["term"], "sway")

    def test_a_row_of_several_pairs_is_not_one_pair(self):
        """`1 week = 7 days   1 day = 24 hours` is already laid out in columns. A greedy
        split made everything up to `1 hour` the term of `sixty minutes`."""
        out = BD.board_panels("LADDER\n1 week = 7 days   1 day = 24 hours\n1 year = 12 months")
        rows = out["panels"][0]["rows"]
        self.assertEqual(rows[0], {"text": "1 week = 7 days   1 day = 24 hours"})
        self.assertEqual(rows[1], {"term": "1 year", "gloss": "12 months"})


class TestATerminalFrameIsNotBoardContent(unittest.TestCase):
    """bd-59vvo. Ten of the 38 G4 Ch9 boards frame a panel in box-drawing characters --
    38 such rows, 30 of them carrying a title. They are an ASCII drawing of the box the
    HTML renderer already draws, and a 60-character run of U+2500 has no break
    opportunity in it, so on a 520px page the panel laid itself out wider than the sheet
    and printed its whole gloss column off the right edge. The frame is not content: the
    title inside it is the panel's label, the closing rule carries nothing at all."""

    BOXED = ("\u250c\u2500\u2500 Apostrophe Alley \u2500\u2500\u2510\n"
             "Apostrophe = belonging OR missing letters\n"
             "Jojo's ball = the ball belongs to Jojo\n"
             "\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2518")

    def test_the_title_in_the_frame_becomes_the_panels_label(self):
        p = BD.board_panels(self.BOXED)["panels"][0]
        self.assertEqual(p["label"], "Apostrophe Alley")
        self.assertNotIn("\u2500", repr(p))

    def test_a_rule_that_carries_nothing_is_dropped_not_printed(self):
        rows = BD.board_panels(self.BOXED)["panels"][0]["rows"]
        self.assertEqual([r.get("term") for r in rows], ["Apostrophe", "Jojo's ball"])

    def test_no_word_the_author_wrote_is_lost_with_the_frame(self):
        got = " ".join(words_of(BD.board_panels(self.BOXED)))
        for w in ("Apostrophe", "Alley", "belonging", "missing", "letters", "Jojo's",
                  "ball", "belongs", "Jojo"):
            self.assertIn(w, got)

    def test_an_arrow_banner_is_not_box_art_and_stays(self):
        """\u2192 is not in the box-drawing block. `\u2192 APPLY THE CLUE \u2192` is the author
        telling the teacher what the next panel does, and it is a row."""
        out = BD.board_panels("A = one\n\n\u2192 APPLY THE CLUE \u2192\n\nB = two")
        self.assertEqual(out["panels"][1]["rows"][0], {"text": "\u2192 APPLY THE CLUE \u2192"})

    def test_a_dashed_arrow_is_an_arrow_and_not_a_frame(self):
        """`\u2500\u2500>` is drawn from the SAME block as a frame, and the first cut of this
        read it as one: it mangled 38 rows across 10 corpus boards into a bare `>` and
        deleted a whole panel of English_seg3 — `[Question] \u2500\u2500> [KEY words] \u2500\u2500>
        [Main point]` was one line, so stripping it left nothing and the panel vanished.
        A frame TOUCHES A LINE EDGE; an arrow points between two things the author wrote."""
        src = ("Diving deeper:\n\n"
               "[Question] \u2500\u2500> [KEY words/phrase] \u2500\u2500> [Main point]\n\n"
               "dhol's beat + bhangra \u2500\u2500> Bhangra matches the dhol.")
        out = BD.board_panels(src)
        self.assertEqual(len(out["panels"]), 2, out["panels"])
        self.assertIn("\u2500\u2500>", json.dumps(out, ensure_ascii=False))
        for w in ("Question", "KEY", "words/phrase", "Main", "point", "dhol's", "bhangra"):
            self.assertIn(w, " ".join(words_of(out)))

    def test_a_box_that_closes_before_another_opens_is_a_SECOND_panel(self):
        """bd-i44jn. The author drew two boards and an arrow joining them, with no blank
        line anywhere. Grouping on blank lines alone made that ONE panel of 15 rows -- the
        7th-heaviest board in the corpus and the only one-panel board that size -- and the
        second board's title printed as a plain row indistinguishable from its content.

        THE BOUNDARY IS A CLOSE FOLLOWED BY AN OPEN, and it is deliberately that narrow.
        "A frame touches a line edge" already tells `_unbox` what a frame is; it does not
        tell it what a BOARD is. Three shapes in the corpus would break under any looser
        rule: `Science_seg2` is one box-drawn TABLE whose rows all touch the frame,
        `Maths_seg9` opens two boxes SIDE BY SIDE on the same lines, and `Maths_seg6`
        draws diagonals out of the same block. Only a box that has finished before the
        next one starts is a second board, and exactly one board in 38 is shaped that way.
        """
        out = BD.board_panels(TWO_BOARDS)
        self.assertEqual(len(out["panels"]), 2, out["panels"])
        self.assertEqual(out["panels"][0]["label"], "Apostrophe Alley")
        self.assertEqual(out["panels"][1]["label"], "Present Simple Party")
        # The second title stops being a row of the first panel.
        first = json.dumps(out["panels"][0], ensure_ascii=False)
        self.assertNotIn("Present Simple Party", first)

    def test_the_line_between_two_boxes_joins_them_and_is_not_a_row_of_either(self):
        """On a real board the teacher chalks it BETWEEN the two boxes, which is where the
        author put it -- after the close, before the open. As a row it read as something to
        write inside the second board."""
        out = BD.board_panels(TWO_BOARDS)
        self.assertEqual(out["panels"][1]["connector"], "\u2192 APPLY THE CLUE \u2192")
        self.assertNotIn("connector", out["panels"][0])
        for p in out["panels"]:
            for r in p["rows"]:
                self.assertNotIn("APPLY THE CLUE", json.dumps(r, ensure_ascii=False))

    def test_a_box_drawn_TABLE_is_still_one_panel(self):
        """`Science_seg2`: one instrument table. Every row touches the frame, and five of
        them would have become five panels under a rule that split on any framed line."""
        out = BD.board_panels(TABLE)
        self.assertEqual(len(out["panels"]), 1, out["panels"])
        self.assertEqual(len(out["panels"][0]["rows"]), 5)

    def test_two_boxes_drawn_SIDE_BY_SIDE_are_still_one_panel(self):
        """`Maths_seg9`: both boxes open on the same line with an arrow across the middle.
        Nothing closed before the second opened, so nothing is sequential here."""
        out = BD.board_panels(SIDE_BY_SIDE)
        self.assertEqual(len(out["panels"]), 1, out["panels"])

    def test_no_word_survives_the_split_any_less_than_before(self):
        got = " ".join(words_of(BD.board_panels(TWO_BOARDS)))
        for w in ("Apostrophe", "Alley", "belonging", "Jojo's", "isn't", "can't",
                  "Present", "Simple", "Party", "rises", "APPLY", "CLUE", "fly"):
            self.assertIn(w, got, w)

    def test_a_frame_with_nothing_in_it_leaves_no_empty_panel(self):
        out = BD.board_panels("\u250c\u2500\u2500\u2500\u2510\n\u2514\u2500\u2500\u2500\u2518")
        self.assertEqual(out["panels"], [])


class TestBoardBlockAcceptsAListedContent(unittest.TestCase):
    """bd-v2ikv. Verbatim from grade_1_maths_ch8_seg990 (English_seg9 and Maths_seg13 carry
    the same shape) -- Stage C sometimes emits `boardWork.content` as a list of strings,
    already split into the groups a string-authored board carries as blank-line-separated
    paragraphs, instead of one string. `board_block` only ever exercised the string shape and
    called `.strip()` straight on the field, which is a list method AttributeError against a
    list -- and that raised out of `to_lp_doc`, out of `main`, and took the other 23 rows of
    the G2 Ch8 build down with the one row that carried it."""

    CONTENT = [
        "ROUND 1: height",
        "ROUND 2: mass and capacity",
        "ROUND 3: capacity, length and temperature",
        "compare = which word fits?",
        "measure = read the number",
    ]

    def test_a_listed_content_does_not_raise(self):
        BD.board_block({"content": self.CONTENT})

    def test_a_listed_content_is_joined_on_the_blank_line_the_string_form_uses(self):
        # Not `str(CONTENT)` -- that is a Python repr, and a teacher reading the page
        # would see `['ROUND 1: height', ...]` printed on it. Each list entry is already
        # one authored group, so `\n\n` is the same boundary a string-authored board
        # marks a group with, and board_panels splits it back apart the same way.
        blk = BD.board_block({"content": self.CONTENT})
        self.assertEqual(blk["text"], "\n\n".join(self.CONTENT))

    def test_no_word_of_a_listed_content_is_lost(self):
        blk = BD.board_block({"content": self.CONTENT})
        got = " ".join(words_of(blk))
        for w in ("ROUND", "height", "mass", "capacity", "temperature",
                  "compare", "fits?", "measure", "number"):
            self.assertIn(w, got, w)


class TestDoubleEscapedNewlinesAreRecovered(unittest.TestCase):
    """bd-obv6l. g4_ch9/Science_seg1 and g5_ch9/Science_seg4 -- 7 board strings across the
    two lessons -- carry a literal backslash+"n" where the source trace double-escaped a
    real newline: it survives JSON decoding as two characters, not one, so the join in
    board_block never turned it back into a line break and a teacher copying the board saw
    the escape code. `board_panels`'s blank-line regex only matches a REAL newline, so the
    broken board also panelled as one blob instead of by its authored groups.
    """

    def test_a_double_escaped_board_loses_the_literal_backslash_n(self):
        blk = BD.board_block({"content": DOUBLE_ESCAPED})
        self.assertNotIn("\\n", blk["text"])

    def test_a_double_escaped_board_recovers_its_authored_line_breaks(self):
        blk = BD.board_block({"content": DOUBLE_ESCAPED})
        lines = blk["text"].splitlines()
        self.assertEqual(lines[0], "INVESTIGATE FIRST")
        self.assertTrue(lines[1].startswith("PREDICT"))

    def test_a_double_escaped_board_panels_by_its_authored_groups_not_as_one_blob(self):
        blk = BD.board_block({"content": DOUBLE_ESCAPED})
        self.assertEqual(
            [p.get("label") for p in blk["panels"]],
            ["INVESTIGATE FIRST", "FOOTBRIDGE", "BOOKSHELF STARTING SIZE", "LED POLARITY", None],
        )

    def test_ascii_art_with_a_backslash_before_a_real_newline_is_untouched(self):
        """g1_ch10/Maths_seg1's triangle -- `/\\` then a real line break, `/____\\` then an
        underscore -- must not be mistaken for the defect above; only backslash-then-n is."""
        blk = BD.board_block({"content": CIRCLE_TRIANGLE_ART})
        self.assertEqual(blk["text"], CIRCLE_TRIANGLE_ART)

    def test_a_listed_content_items_own_escape_is_unescaped_too(self):
        blk = BD.board_block({"content": ["Vocabulary:", "sway\\nmove slowly"]})
        self.assertEqual(blk["text"], "Vocabulary:\n\nsway\nmove slowly")


def test_board_block_runs_its_panels_through_the_ascii_stripper(monkeypatch):
    """bd-1fr0w fix #1. `board_panels()`'s raw output must pass through
    `d0_board_strip.apply_panels` (gated on the board's own diagram spec, so
    it is a no-op for every board except "solid"/"clock") before it reaches
    `blk["panels"]` -- that is the only place the printed board text can
    still be cleaned of drawn-ASCII/bare clock-numerals once a picture exists
    for it. This does not care WHAT the stripper does, only that its output,
    not board_panels()'s raw output, is what board_block emits."""
    monkeypatch.setattr(BD.d0_board_strip, "apply_panels", lambda panels, board: [{"stub": True}])
    blk = BD.board_block({"content": REAL})
    assert blk["panels"] == [{"stub": True}]


if __name__ == "__main__":
    unittest.main()


def test_a_prose_board_reaches_the_renderer_as_ordered_rows_not_one_wall():
    """OPERATOR: *"its a block of text that should show clearly how it should be
    ordered rather than give a script of what to draw and how"*.

    43 of the 335 shipping boards arrive as ONE paragraph with no line breaks. One
    row per line made them a single 500-character row, which the renderer lays out
    as an unbroken wall -- the exact thing rejected four times. Each sentence is a
    build step, so each sentence is a row and the renderer numbers it.
    """
    content = ("Draw a two column table on the board and head the columns was and is. "
               "Write four sentences from the passage in the was column as the class "
               "dictates them to you. Leave the is column empty until the children "
               "have finished copying the was column into their own notebooks.")
    out = BD.board_panels(content)
    rows = [r for p in out["panels"] for r in p["rows"]]
    assert len(rows) == 3, rows
    assert rows[0]["text"].startswith("Draw a two column table")
    assert rows[2]["text"].startswith("Leave the is column")


def test_splitting_a_prose_board_never_drops_a_word_of_it():
    """NOTHING MAY BE CUT (operator, page-packer option B)."""
    content = ("Draw a place value chart with three columns and label them hundreds, "
               "tens and ones. Write three hundred and forty five into the chart one "
               "digit at a time while the class reads each digit aloud with you.")
    rows = [r for p in BD.board_panels(content)["panels"] for r in p["rows"]]
    joined = "".join(r["text"] for r in rows).replace(" ", "")
    assert joined == content.replace(" ", "")


def test_a_structured_board_is_untouched_by_the_prose_split():
    """The 240 boards that already arrive as short lines must render exactly as
    they did -- this change is for the wall, and nothing else."""
    content = "LENGTH UNITS\nkm = kilometre\nm = metre\ncm = centimetre"
    rows = [r for p in BD.board_panels(content)["panels"] for r in p["rows"]]
    assert len(rows) == 3
    assert rows[0]["term"] == "km"


def test_a_prose_board_is_split_before_it_is_read_as_a_vocabulary_pair():
    """A 600-character gloss is not a gloss.

    Found in the rebuilt corpus at g4_ch10 English_seg1: the paragraph contains
    one '=' inside the phrase 'picture + words = main idea/theme', so `_split_pair`
    claimed the whole 636-character board as ONE term and ONE gloss and the prose
    split never ran. Seven boards came out of the rebuild that way. The order has
    to be the other way round -- split the paragraph into its build steps first,
    then read each step for a pair.
    """
    board = ("Write the heading: picture + words = main idea. "
             "Draw three connected boxes with arrows below it. "
             "Write the six page words in two rows underneath. "
             "Circle the two words you want the class to copy first.")
    panels = BD.board_panels(board)["panels"]
    assert len(panels) == 4, panels
    assert panels[0]["rows"] == [
        {"term": "Write the heading: picture + words", "gloss": "main idea."}
    ]
    assert panels[1]["rows"] == [{"text": "Draw three connected boxes with arrows below it."}]


def test_each_build_step_of_a_prose_board_gets_its_own_numbered_panel():
    """The renderer numbers PANELS, not rows -- so rows alone do not show the order.

    Rasterising g3_ch9 Maths_seg2 page 2 settles it: its board carries badges 1-5,
    one per blank-line group, and each group is a step the teacher chalks. A board
    authored as one paragraph is one group, so six ordered sentences came out under
    a single badge 1. The operator asked for a board that *"should show clearly how
    it should be ordered"*, which is the numbering. Each sentence is a step, so each
    sentence is a panel.
    """
    board = ("Write the title Moon Party in a circle in the middle. "
             "Draw three lines out of it and label them. "
             "Underneath write four numbered sentences with a gap in each. "
             "Leave the right-hand third of the board clear for the answers.")
    panels = BD.board_panels(board)["panels"]
    assert len(panels) == 4, panels
    assert panels[0]["rows"] == [{"text": "Write the title Moon Party in a circle in the middle."}]


def test_a_structured_board_still_gets_one_panel_per_authored_group():
    """The 240 boards that already arrive as blank-line groups must not move."""
    board = "LENGTH UNITS\nkm = kilometre\n\nBirdhouse: 10 cm 3 mm\nBookshelf: 35 cm 5 mm"
    panels = BD.board_panels(board)["panels"]
    assert len(panels) == 2, panels
    assert panels[0]["label"] == "LENGTH UNITS"


# Verbatim from grade_3_english_ch9_seg2 boardWork.content (bd-pmv8n). The author drew a
# three-column chart; `_unbox` replaced every box-drawing run with a space, including the
# `│` between the columns, so the three cells of a row printed as one sentence and a
# wrapped cell printed as an orphan row below it -- on paper, "Fasten your Fasten your
# seatbelts. seatbelts.".
G3_EN2_TABLE = """TIME TRAVELLING TV — pp.100-102

READ → STOP → POINT TO THE WORDS

┌──────────────────────────┬─────────────────────┬──────────────────────────────┐
│ Scene                    │ Exact words in text   │ What must happen?            │
├──────────────────────────┼─────────────────────┼──────────────────────────────┤
│ TV screen, p.100         │ “Hold tight!”         │ Hold tight.                  │
│ Aeroplane, p.101         │ “Fasten your          │ Fasten your seatbelts.       │
│                          │ seatbelts.”           │                              │
│ Clinic, p.102            │ “Stay safe, wear      │ Stay safe; wear masks.       │
│                          │ masks!”               │                              │
└──────────────────────────┴─────────────────────┴──────────────────────────────┘

Text words: fact | fiction | nonfiction
Underline in p.101: instructed"""


def test_a_three_column_chart_does_not_print_its_row_as_one_sentence():
    """bd-pmv8n. The three cells of a row are three things the teacher writes in three
    columns; run together they read as the run-on *"Fasten your Fasten your seatbelts.
    seatbelts."* -- the quotation and the instruction, interleaved with the wrap."""
    panels = BD.board_panels(G3_EN2_TABLE)["panels"]
    table = [p for p in panels if p.get("label", "").startswith("Scene")][0]
    assert table["rows"] == [
        {"text": "TV screen, p.100 | “Hold tight!” | Hold tight."},
        {"text": "Aeroplane, p.101 | “Fasten your seatbelts.” | Fasten your seatbelts."},
        {"text": "Clinic, p.102 | “Stay safe, wear masks!” | Stay safe; wear masks."},
    ]
    assert table["label"] == "Scene | Exact words in text | What must happen?"


def test_a_two_column_table_prints_as_the_two_columns_the_renderer_already_has():
    """`.bb` is a two-track grid (`bk` + `bg`), which is exactly a two-column table --
    g4_ch9 Science_seg2 lists an instrument against what it does."""
    board = ("┌──────────────┬──────────────────┐\n"
             "│ INSTRUMENT   │ WHAT IT DOES     │\n"
             "├──────────────┼──────────────────┤\n"
             "│ Thermometer  │ measures heat    │\n"
             "│ Stopwatch    │ measures time    │\n"
             "└──────────────┴──────────────────┘")
    panel = BD.board_panels(board)["panels"][0]
    assert panel["label"] == "INSTRUMENT | WHAT IT DOES"
    assert panel["rows"] == [
        {"term": "Thermometer", "gloss": "measures heat"},
        {"term": "Stopwatch", "gloss": "measures time"},
    ]


HEADED_TABLE = """WORD BANK:
┌────────────┬──────────┐
│ protector  │ guards   │
│ shelter    │ cover    │
└────────────┴──────────┘"""


def test_a_heading_line_directly_above_a_table_is_still_the_panel_label():
    """g5_ch8 Urdu_seg9 labels its table on the line above it, and that line IS the
    panel's heading -- the table under it is the "something to head", so the one-line
    group is a label, not a row."""
    panel = BD.board_panels(HEADED_TABLE)["panels"][0]
    assert panel["label"] == "WORD BANK"
    assert panel["rows"] == [
        {"term": "protector", "gloss": "guards"},
        {"term": "shelter", "gloss": "cover"},
    ]
