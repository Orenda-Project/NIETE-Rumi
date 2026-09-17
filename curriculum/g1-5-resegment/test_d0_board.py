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


if __name__ == "__main__":
    unittest.main()
