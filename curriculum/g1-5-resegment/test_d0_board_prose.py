"""A board authored as a paragraph must still reach the teacher in build order.

OPERATOR, on the WRITE ON THE BOARD section: *"its a block of text that should show
clearly how it should be ordered rather than give a script of what to draw and how"*.

43 of the 335 shipping boards are a single prose paragraph with no blank lines and no
internal structure -- 20 of them Urdu. `d0_board._panel` makes one row per LINE, so a
500-character paragraph becomes ONE row, and the renderer lays it out as an unbroken
wall of text. That wall is the thing she has rejected four times.

This module splits such a paragraph into its sentences, so the existing board renderer
numbers them and the teacher can see what to chalk first, second, third.
"""
import d0_board_prose as P


def test_a_short_line_is_left_exactly_alone():
    """Structured boards are already right. Only the wall is in scope."""
    s = "km = kilometre | m = metre"
    assert P.split_prose(s) == [s]


def test_a_prose_paragraph_becomes_its_sentences_in_order():
    s = ("Draw a place value chart with three columns and label them hundreds, tens and ones. "
         "Write the number three hundred and forty five into the chart one digit at a time. "
         "Ask the class to read the number aloud from the chart before you rub it out again.")
    out = P.split_prose(s)
    assert len(out) == 3, out
    assert out[0].startswith("Draw a place value chart")
    assert out[1].startswith("Write the number")
    assert out[2].startswith("Ask the class")


def test_every_sentence_keeps_its_full_stop():
    s = ("Draw a place value chart with three columns and label them hundreds, tens and ones. "
         "Write the number three hundred and forty five into the chart one digit at a time. "
         "Ask the class to read the number aloud from the chart before you rub it out.")
    assert all(f.rstrip().endswith(".") for f in P.split_prose(s))


def test_urdu_splits_on_its_own_full_stop():
    """Urdu ends a sentence with U+06D4, not a period -- and Urdu is 20 of the 43
    prose boards, so a splitter that only knows "." would leave the worst half of
    the corpus exactly as it is."""
    s = ("تختہ سیاہ پر دائیں کالم میں نیا لفظ لکھیں اور اس کے سامنے بائیں کالم میں اس کا مطلب لکھیں۔ "
         "پھر ہر لفظ کے نیچے ایک سادہ جملہ لکھیں تاکہ بچے اس کا استعمال دیکھ سکیں۔ "
         "آخر میں مثالیں مٹا کر بچوں سے دوبارہ لکھوائیں تاکہ فرق واضح ہو۔")
    out = P.split_prose(s)
    assert len(out) == 3, out
    assert all("۔" in f for f in out)


def test_nothing_of_the_board_is_lost_in_the_split():
    """NOTHING MAY BE CUT (operator, page-packer option B). The split is a
    re-ordering of the same characters, never an edit of them."""
    s = ("Draw a two column table on the board and head the columns was and is. "
         "Write four sentences from the passage in the was column as the class dictates them. "
         "Leave the is column empty until the children have finished their own copies.")
    out = P.split_prose(s)
    assert "".join(out).replace(" ", "") == s.replace(" ", "")


def test_a_paragraph_with_no_sentence_end_is_left_alone():
    """A long line that is one unpunctuated run has no order to show. Chopping it
    at an arbitrary column would invent a build step the author never wrote."""
    s = "hundreds tens ones " * 12
    assert P.split_prose(s) == [s]


def test_it_never_raises_on_junk():
    for junk in (None, "", 17, [], {}):
        assert isinstance(P.split_prose(junk), list)


def test_a_decimal_number_is_not_a_sentence_end():
    """"1.5 metres" must not become two board rows."""
    s = ("Draw the ruler on the board and mark the point that reads 1.5 metres along it. "
         "Then ask the class which whole number that measurement sits between on the ruler.")
    out = P.split_prose(s)
    assert len(out) == 2, out
    assert "1.5" in out[0]


def test_a_named_punctuation_mark_is_not_a_sentence_end():
    """Urdu board work for a punctuation lesson QUOTES the mark it is teaching.

    Found in the corpus at g1_ch10 Urdu_seg8: *"write a sample sentence and at the
    end of it ? circle it"* -- one instruction naming the question mark, which the
    naive splitter cut in half into two build steps the author never wrote. A real
    sentence end never has whitespace in front of the terminator; a glyph being
    named always does.
    """
    line = (
        "ایک نمونہ جملہ لکھیں اور اس کے آخر میں ؟ کو دائرے میں نمایاں کریں۔ "
        "ایک یائے لین کی مثال بھی لکھیں۔ دائیں طرف نئے الفاظ کی فہرست لکھیں۔ "
        "نیچے زبر والے حروف کی قطار لکھیں۔"
    )
    parts = P.split_prose(line)
    assert all("؟ کو" not in p or p.startswith("ایک نمونہ") for p in parts)
    assert any("؟ کو دائرے" in p for p in parts), parts


def test_an_alphabetic_enumerator_stays_with_the_item_it_numbers():
    """Urdu lists label their items alif / bay / jeem, each followed by U+06D4.

    Found at g2_ch9 Urdu_seg3: a matching exercise whose three items are labelled
    'الف۔' 'ب۔' 'ج۔'. Those are labels, not sentences -- left alone the splitter
    made 'ب۔' a board row of its own, which tells the teacher to write a letter
    and nothing else. The label belongs to the item that FOLLOWS it.
    """
    line = (
        "بائیں طرف لکھیں۔ الف۔ ___ = کسی معاشرتی گروہ کی طرزِ زندگی۔ "
        "ب۔ ___ = جہاں پرانی عمارتوں کے آثار ہوں۔ ج۔ ___ = پتھر کا بت۔ "
        "دائیں طرف تینوں الفاظ لکھیں۔"
    )
    parts = P.split_prose(line)
    assert all(len(p.strip()) > 3 for p in parts), parts
    assert any(p.startswith("ب۔ ___") for p in parts), parts


def test_an_ellipsis_is_not_the_end_of_a_build_step():
    """A sentence STARTER quoted on the board trails off; it does not stop.

    Found in the rebuilt corpus at g1_ch8 English_seg4, whose last board line is
    *"Bottom row: the three ending words -- 'Finally... / In the end... / At last...'"*.
    That is one row of three ending words, and the splitter made it three numbered
    build steps, two of which told the teacher to chalk a lone slash and a phrase.
    A run of dots is a trailing-off, so only a terminator with ordinary text in
    front of it ends a step.
    """
    line = ("Write the three chalk faces along the top of the board. "
            "Bottom row: the three ending words - 'Finally... / In the end... / At last...' "
            "Leave the middle third clear for the story ladder.")
    parts = P.split_prose(line)
    assert not any(p.lstrip().startswith("/") for p in parts), parts
    assert any("'Finally... / In the end... / At last...'" in p for p in parts), parts


def test_a_slash_continues_the_step_it_follows():
    """These boards use ' / ' to stack alternatives inside ONE chalk row.

    g3_ch8 English_seg9 chalks a letter frame as *"Dear ___, / Thank you for ___. /
    Yours truly, ___"* -- three lines of one template, and the full stop inside it is
    a real one, so the splitter made 'Yours truly, ___' a build step that tells the
    teacher to write a sign-off and nothing else. A piece that opens with the
    separator is the rest of the row above it, never a step of its own.
    """
    line = ("Write the letter frame down the left of the board. "
            "Dear ___, / Thank you for ___. / Yours truly, ___ "
            "Keep the right half clear for the three job branches.")
    parts = P.split_prose(line)
    assert not any(p.lstrip().startswith("/") for p in parts), parts
    assert any("Yours truly" in p and "Dear ___" in p for p in parts), parts
