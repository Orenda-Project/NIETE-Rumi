"""Printable lines, split into scannable sentences — unit tests.

MEASURED, not guessed. Over the 335-lesson ch9-10 render corpus, the words a
teacher meets as ONE unbroken run sit here (words held in units over 40 words):

    key_points.item   43,396w   <- `you-do-task` alone is 34,269w
    practice.item.a   24,466w
    faded_example.prompt 22,351w
    turn.do (both moves) 21,435w
    worked_example.step (d0_primary's `worked`) 9,682w

I-Do and We-Do already escape this: `d0_script.turns` prints one row per
sentence. The blocks above get no such pass, so the same 150-word paragraph that
is 10 rows inside WORKED EXAMPLE is still one bullet inside YOU DO.

This module does the same thing for a plain printable LINE — the strings that
live in `steps` and `items`, which the renderer prints as a list. Splitting an
item into several items needs no renderer change at all: it is the same list.

NOTHING IS CUT. `test_no_word_is_lost_over_the_corpus` holds that on every
line of all 335 lessons: the split lines' words, concatenated, are the input's
words, in order.

Run: /usr/bin/python3 -W ignore -m pytest test_d0_lines.py -q
"""

import glob
import json
import os
import re

import d0_lines as L

ROOT = ("/Users/amenaahmed/rumi/Rumi 10 April 2026/"
        "10_Grades 1-5 LP Rebuild/ch9-10-build/renders")

# The real thing: a 121-word `you-do-task` item from g5_ch10/Urdu_seg9, the
# lesson holding the corpus's heaviest page (788 words on p6).
LONG_SAY = (
    'Say: “Now it is your turn. Think of one special day in your own life — Eid, '
    'Basant, a wedding, a fair, or any moment you remember. Write the opening and '
    'the middle on your slate — exactly the way we did it with Zainab and Ahmed. '
    'When you have written, read it to your partner. Your partner will tell you '
    'one line they liked and one suggestion. Then you will revise your own draft '
    'using what your partner said, and that revised draft is what you bring '
    'tomorrow.”')

SHORT = "Say: “Open your books at page 104.”"
ACTION = "Write the model diary opening on the board under Zainab's name."


def words(s):
    return [w for w in re.split(r"\s+", (s or "").strip()) if w]


def test_a_long_say_becomes_one_line_per_sentence():
    out = L.split_line(LONG_SAY)
    assert len(out) == 6, out


def test_the_say_label_lands_once_not_on_every_line():
    out = L.split_line(LONG_SAY)
    assert out[0].startswith("Say:")
    assert not any(l.startswith("Say:") for l in out[1:]), out


def test_the_speech_quote_opens_on_the_first_line_and_closes_on_the_last():
    out = L.split_line(LONG_SAY)
    assert out[0].startswith("Say: “")
    assert out[-1].endswith("”")
    assert '”' not in "".join(out[:-1])


def test_a_short_line_is_left_exactly_alone():
    assert L.split_line(SHORT) == [SHORT]


def test_a_one_sentence_line_is_left_alone_however_long():
    one = "Say: “" + " ".join(["word"] * 80) + ".”"
    assert L.split_line(one) == [one]


def test_a_plain_action_line_splits_without_gaining_a_say_label():
    two = (ACTION + " Then point to the second paragraph and wait for the class to"
           " settle before you read the next line of the model aloud to them.")
    out = L.split_line(two)
    assert len(out) == 2, out
    assert not any(l.startswith("Say:") for l in out)


def test_a_short_two_sentence_line_is_left_alone():
    """Splitting these would ADD rows to a page already fighting an 8-page cap.

    Over the corpus, lines at or under 25 words hold 25.1% of the script's words
    and are already one or two clauses; the wall is above that. THRESHOLD is the
    line where splitting starts paying for the row it costs.
    """
    assert L.split_line("Open your books. Find page 104.") == \
        ["Open your books. Find page 104."]


def test_urdu_splits_on_its_own_full_stop():
    urdu = ("Say: 'دیکھیں، سب سے پہلے میں اپنی زندگی کا کوئی خاص خاندانی دن سوچتی ہوں۔ "
            "پھر میں بورڈ پر زینب کے نام سے ایک نمونہ ڈائری کا ابتدائیہ لکھتی ہوں۔ "
            "اب آپ سب میرے ساتھ مل کر یہ جملے بلند آواز میں پڑھیں۔ "
            "آخر میں ہم اسے ایک بار پھر سے دہراتے ہیں۔'")
    out = L.split_line(urdu)
    assert len(out) == 4, out


def test_a_trailing_fragment_joins_the_sentence_before_it():
    """A split must never leave a two-word orphan standing as its own bullet."""
    s = "Say: “Read the first line with me. Now the second line and the third. Yes.”"
    out = L.split_line(s)
    assert all(len(words(l)) >= 3 for l in out), out


def test_no_word_is_lost_on_the_fixture():
    assert words(" ".join(L.split_line(LONG_SAY))) == words(LONG_SAY)


def test_split_items_leaves_a_list_of_short_lines():
    out = L.split_items([SHORT, LONG_SAY])
    assert out[0] == SHORT
    assert len(out) == 7


def test_the_threshold_is_stated_once_and_is_the_measured_one():
    assert L.THRESHOLD == 25


def test_a_doubled_say_label_lands_once():
    """111 strings over 37 corpus docs arrive as `Say: “Say: "...`."""
    assert L.undouble_say('Say: “Say: "Page 132 says this."”') == 'Say: "Page 132 says this."'
    assert L.undouble_say(SHORT) == SHORT


def _corpus_lines():
    for p in sorted(glob.glob(os.path.join(ROOT, "*", "docs", "*.json"))):
        doc = json.load(open(p))

        def walk(o):
            if isinstance(o, dict):
                yield o
                for v in o.values():
                    yield from walk(v)
            elif isinstance(o, list):
                for x in o:
                    yield from walk(x)

        for b in walk(doc):
            for s in (b.get("items") or []) + (b.get("steps") or []):
                if isinstance(s, str) and s.strip():
                    yield p, s


def test_no_word_is_lost_over_the_corpus():
    """Every printable line of all 335 lessons, split and reassembled."""
    n = 0
    for p, s in _corpus_lines():
        got = words(" ".join(L.split_line(s)))
        assert got == words(s), (p, s[:120])
        n += 1
    assert n > 5000, n


def test_the_corpus_wall_shrinks_and_no_line_gains_words():
    """The number the operator feels: words sitting in units over 40 words."""
    before = after = 0
    for _, s in _corpus_lines():
        if len(words(s)) > 40:
            before += len(words(s))
        for l in L.split_line(s):
            if len(words(l)) > 40:
                after += len(words(l))
    assert after < before * 0.35, (before, after)


# ── the stage direction is a wall too ─────────────────────────────────────────
# `d0_script` splits the SPEECH into one row per sentence but keeps the `action`
# whole, on the measured ground that the action is not a restatement of the script
# (median 33% overlap). That is an argument for keeping every WORD of it, not for
# keeping it on one row: over the corpus, `do` turns hold 21,435 words inside rows
# of more than 40 words -- the widest rows on the page sit in the narrowest column.

DO_WALL = ("Draw the three-column table on the left half of the board and head the "
           "columns Sound, Word and Picture before the lesson starts. Hand each pair "
           "one slate and one piece of chalk as they settle into their seats. Keep the "
           "textbook open at page 104 on your own desk where the class can see it.")


def test_a_long_do_turn_becomes_one_turn_per_sentence():
    out = L.split_do_turns([{"kind": "do", "text": DO_WALL}])
    assert len(out) == 3, out
    assert all(t["kind"] == "do" for t in out)


def test_splitting_a_do_turn_loses_no_word():
    out = L.split_do_turns([{"kind": "do", "text": DO_WALL}])
    assert words(" ".join(t["text"] for t in out)) == words(DO_WALL)


def test_a_page_ref_stays_on_the_sentence_that_earned_it():
    """`ref` is a chip on ONE row; copying it onto three would print it three times."""
    out = L.split_do_turns([{"kind": "do", "text": DO_WALL, "ref": "p.104"}])
    assert [t.get("ref") for t in out] == [None, None, "p.104"]


def test_speech_and_every_other_kind_are_left_exactly_alone():
    """Only `do` is unsplit upstream; `say` rows are already one sentence each."""
    turns = [{"kind": "say", "text": DO_WALL}, {"kind": "ask", "text": "Ready?"},
             {"kind": "routine", "parts": ["Circle.", "Box."]}]
    assert L.split_do_turns(turns) == turns


def test_a_short_do_turn_is_left_alone():
    t = [{"kind": "do", "text": "Write the word on the board."}]
    assert L.split_do_turns(t) == t


def test_a_response_pill_rides_the_last_sentence_like_the_ref():
    out = L.split_do_turns([{"kind": "do", "text": DO_WALL, "expect": ["2028"]}])
    assert [t.get("expect") for t in out] == [None, None, ["2028"]]


# ── the label is authored twice, at source ────────────────────────────────────

def test_say_line_does_not_wrap_a_script_that_already_carries_the_label():
    """`move_lines` could not see its own label through the leading S.

    111 strings over 37 corpus docs came out as `Say: “Say: "...."”`. 37 of them sit
    in lists; the other 74 go through `d0_script`, whose `_strip_say` takes off ONE
    label — so the turn row still printed a stray `Say:` in the middle of the speech.
    """
    assert L.say_line('Say: "Page 132 says this."') == 'Say: "Page 132 says this."'


def test_say_line_wraps_an_unlabelled_script_in_the_label_and_quotes():
    assert L.say_line("Open your books.") == "Say: “Open your books.”"


def test_say_line_does_not_double_the_quotes_of_an_already_quoted_script():
    assert L.say_line("“Open your books.”") == "Say: “Open your books.”"


# ── bd-suk84: an abbreviation WITH a trailing space still ends a token ────────
# The old guard in `_sentences` only refused a cut when the next match started on
# a non-space character -- `Mrs.Khan`, `p.127`. It did nothing for the far more
# common case where the author left the normal space after the abbreviation's own
# period: `p. 252`, `Mrs. Khan`, `e.g. flowing`. Corpus census over all 335 built
# lessons (renders/*/docs/*.json, `d0_lines.split_line` run on every string):
# 118 real breaks at `p.`, 10 at `pp.`, plus confirmed breaks at `e.g.` and `i.e.`
# -- see FIXWAVE_BRIEF measurements in the done-report for the full count.

PAGE_CITE = (
    "STEP 2 (Two describing words): From the passage, 'graceful' is given -- "
    "add one more, e.g. 'flowing' -> 'Graceful, flowing' (count: 1 Graceful, "
    "2 flowing check) so the worked example still totals exactly two describing "
    "words for this step of the routine before moving to the next one.")


def test_an_abbreviation_with_a_trailing_space_does_not_end_the_sentence():
    """bd-suk84, the real corpus break in g4_ch9/English_seg7: `e.g.` followed by
    a space used to read as a sentence end, printing `...add one more, e.g.` on
    one row and `'flowing' -> 'Graceful, flowing'...` orphaned on the next. This
    is also the bd-nuvtm example -- the spurious extra split desyncs the printed
    STEP numbering from the author's own labels."""
    out = L.split_line(PAGE_CITE)
    assert not any(l.rstrip().endswith("e.g.") for l in out), out


PP_CITE = (
    "Use the textbook pictures on pp. 250-251 and real objects from around the "
    "classroom to sort every shape the class can find into flat shapes and solid "
    "shapes, then draw one example of each kind in the space provided on the "
    "worksheet before the bell rings.")


def test_pp_with_a_trailing_space_does_not_end_the_sentence():
    """bd-suk84, the real corpus break in g1_ch10/Maths_seg4."""
    out = L.split_line(PP_CITE)
    assert not any(l.rstrip().endswith("pp.") for l in out), out


TITLE_NAME = (
    "Write the name Mrs. Khan on the board in your neatest handwriting and then "
    "ask two students to read it aloud together before you move on to the next "
    "part of the lesson about titles and how we use them politely every day.")


def test_a_title_before_a_capitalised_name_does_not_end_the_sentence():
    """`Mrs.` `Mr.` `Ms.` `Dr.` are always followed by a capitalised name, so a
    guard keyed on the case of the next letter cannot save them -- they must be
    guarded outright, unconditionally."""
    out = L.split_line(TITLE_NAME)
    assert not any(l.rstrip().endswith("Mrs.") for l in out), out


IE_CITE = (
    "Change the time unit (grounded in Day 4, p.168: '1947 minus 1940 equals 7 "
    "years, in one year there are 12 months, so in 7 years there will be 7 "
    "multiplied by 12'), i.e. the rule 1 year = 12 months, and use it to solve "
    "every remaining item on the worksheet before checking your answers with a "
    "partner.")


def test_ie_with_a_trailing_space_does_not_end_the_sentence():
    """bd-suk84, the real corpus break in g4_ch9/Maths_seg9."""
    out = L.split_line(IE_CITE)
    assert not any(l.rstrip().endswith("i.e.") for l in out), out


def test_the_existing_no_space_guard_still_holds():
    """The ORIGINAL guard -- no space at all, `p.127` -- must still work; the new
    guard is additional, not a replacement."""
    src = ("Blend the Word Blender words from p.127 aloud with the class and "
           "then ask each pair to write one of them on the slate in front of "
           "them before you move on to the very next page of the lesson.")
    out = L.split_line(src)
    assert not any(l.rstrip().endswith("p.") for l in out), out


def test_a_standalone_no_before_a_capitalised_sentence_loses_no_word():
    """The corpus's OTHER `No.` is a one-word answer, not the `No. 5` reference --
    it sits right before a capitalised sentence. Guarding `No.` per the brief's
    minimum list is allowed to leave the two merged into one row; it must never
    lose or reorder a word."""
    src = ("Does a circle have any straight sides? No. So we write 0 sides and 0 "
           "corners on the worksheet, and then we turn to the next page and try "
           "the same question again for a different shape before moving on.")
    out = L.split_line(src)
    assert words(" ".join(out)) == words(src), out
