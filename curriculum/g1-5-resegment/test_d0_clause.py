"""The clause pass is DECLINED — unit tests that hold it at `[line]`.

bd-1nndm asked for a second splitting pass under `d0_lines`: cut a run that is ONE
over-long sentence at the author's own clause punctuation. Two implementations were
written and both were rejected by a judge, for the same defect at the same place.

    v1  cut at `m.end()` for every mark. 884 new rows, 884 of them ending on a
        non-terminal mark, 437 opening on a bare "and"/"so"/"then".
    v2  moved the cut one token LEFT for `;`/`؛`/dashes so the mark opens the
        next row. 568 interior new rows (judge's counting; 1,047 over every
        corpus run on the instrument below), and 568 of 568 still failed to
        close a sentence — 342 ended ON a coordinating conjunction. The fragment
        did not move; only the last character of the row did, and both of v2's
        own fragment predicates read only the last character.

A third arm (v3) was built and measured before this file was written: semicolon
only, cut AFTER the mark, Urdu excluded outright, balanced-quote guard. It is the
only rule of the three whose rows close a clause — 0 of 108 fail — and it is still
not worth shipping:

    arm    printed rows   rows >25w   runs cut   new rows   fail to close
    base        16,852       1,733          —          —              —
    v2          17,938       1,002        965      1,047     1,044 / 1,047
    v3          16,961       1,653        104        108         0 / 108

    pages, 9 documents rendered base vs v3:  5/5  8/8  21/21  10/10  6/6
                                             7/7  6/6   9/9   14/14
    teach blocks past the 8-page cap, base -> v2 -> v3:
        g5_ch8 Urdu_seg9   62 -> 70 -> 62      g2_ch9 English_seg1  61 -> 66 -> 61
        g5_ch9 Science_s4   5 ->  6 ->  5      g4_ch10 Urdu_seg2    10 -> 11 -> 10

v3 adds 108 rows across 60 of 335 documents and removes ZERO pages and ZERO blocks
past the cap. The brief's own bar — "do not ship a change that adds rows and
reduces nothing" — is not cleared, so the pass stands down.

The real cause of the operator's "difficult to read these pages" is elsewhere and
is recorded in `d0_clause`'s docstring: 2,573 of the 3,052 over-threshold printed
rows (84%) are runs the EXISTING sentence pass already splits and that never
reached it — a routing hole, not a missing splitter.

Run: /usr/bin/python3 -W ignore -m pytest test_d0_clause.py -q
"""

import glob
import json
import os
import re

import d0_clause as C
import d0_lines as L

# The SOURCE enrichment, not `renders/*/docs/*.lp.json`. The built docs are the
# OUTPUT of `d0_lines`, so proving a splitter on them proves it against text that
# has already been split once; and this tree's built corpus (mtime 11:41) predates
# the current `d0_lines` (14:43), so it is not even the output of the live code.
SRC = ("/Users/amenaahmed/rumi/Rumi 10 April 2026/"
       "10_Grades 1-5 LP Rebuild/ch9-10-build/work")

# The enrichment fields that become printable prose lines downstream.
SRC_KEYS = ("action", "say", "flex_note", "keyFact", "workedExample", "homework",
            "task", "structure", "teacher_role", "weakLearnerSupport",
            "challengeExtension", "cfuExplain", "coachingReflection",
            "nextTopicPreview", "instruction", "student_definition", "prompt",
            "expected", "model_solution", "question", "pass_signal",
            "if_struggle", "success_criteria", "self_prediction", "script",
            "hookStory", "speechBubble")

URDU = re.compile(r"[؀-ۿ]")


def words(s):
    return [w for w in re.split(r"\s+", (s or "").strip()) if w]


def _walk(o, key, out):
    if isinstance(o, dict):
        for k, v in o.items():
            _walk(v, k, out)
    elif isinstance(o, list):
        for v in o:
            _walk(v, key, out)
    elif isinstance(o, str) and key in SRC_KEYS and o.strip():
        out.append(o)


def _corpus_runs():
    """Every authored prose run of the source enrichment, pre-split."""
    for p in sorted(glob.glob(os.path.join(SRC, "*", "enr", "*.json"))):
        try:
            d = json.load(open(p))
        except Exception:
            continue
        out = []
        _walk(d.get("generated") or d, None, out)
        for s in out:
            yield p, s


# ── fixtures: the three runs each rejected arm cut, and the row it produced ───

# work/g4_ch8/enr/Science_seg7…json `keyFact`: 43 words, ONE full stop, three
# authored clause marks. v1 and v2 both cut it; the row v2 opened was
# "so one body's shadow falls on another —" — not a sentence, not a clause.
KEYFACT = (
    "An eclipse happens when the Sun, Earth and Moon line up exactly straight, "
    "so one body's shadow falls on another — a solar eclipse is the Moon's "
    "shadow falling on Earth, and a lunar eclipse is Earth's shadow falling on "
    "the Moon.")

# A `turn.do` of 33 words whose only mark is a semicolon. v2 cut it one token to
# the LEFT of the mark, which dragged "mark;" onto the next row — the word-drag
# the deleted `test_a_semicolon_is_a_cut_and_opens_the_line_it_belongs_to` had
# asserted as the specification. 86 such drags over the corpus.
DO_TURN = (
    "Whole-class echo/choral reading of the full passage (p.127) in short "
    "phrases, pausing exactly at each punctuation mark; then teacher models one "
    "Story Emotions item and one Following Along question together with the class.")

# The operator's ruling: "dont cut anything from Urdu yet, let it reach its cap."
# v2 cut 225 source runs across 83 lessons, severing compound verbs at the
# auxiliary (لکھتے | ہیں) and tearing round headings.
URDU_RUN = (
    "طلبہ جوڑوں میں بیٹھ کر شعر کا مفہوم اپنے الفاظ میں لکھتے ہیں؛ پھر ہر جوڑا "
    "اپنا مفہوم پوری جماعت کے سامنے پڑھ کر سناتا ہے اور استاد اصلاح کرتے ہیں۔")


# ── the decline ───────────────────────────────────────────────────────────────

def test_an_over_long_one_sentence_run_is_left_unsplit():
    """The v1/v2 headline fixture. A run with no sentence-safe boundary stays
    whole: one long row reads worse than nothing, but a row that stops mid-clause
    reads worse than the long row."""
    assert C.split_clause(KEYFACT) == [KEYFACT]


def test_a_semicolon_run_is_left_unsplit():
    """Replaces `test_a_semicolon_is_a_cut_and_opens_the_line_it_belongs_to`,
    which asserted `out[1].startswith("mark;")` — the word-drag as spec."""
    assert C.split_clause(DO_TURN) == [DO_TURN]


def test_no_urdu_run_is_cut():
    """The operator's exemption, held on the fixture."""
    assert C.split_clause(URDU_RUN) == [URDU_RUN]


def test_a_short_line_is_left_exactly_alone():
    assert C.split_clause("Ask: what do you notice?") == \
        ["Ask: what do you notice?"]


def test_an_empty_line_survives():
    assert C.split_clause("") == [""]
    assert C.split_clause(None) == [""]


def test_the_threshold_is_the_one_d0_lines_measured():
    """Kept live so a future arm cannot quietly disagree with the sentence pass
    about what "too long" means."""
    assert C.THRESHOLD == L.THRESHOLD == 25


# ── the corpus proof ──────────────────────────────────────────────────────────

def test_the_clause_pass_returns_every_corpus_run_unchanged():
    """The decline itself, over every authored run of the source enrichment:
    not one row is added anywhere, and no string differs by a character."""
    n = touched = 0
    for p, s in _corpus_runs():
        out = C.split_clause(s)
        n += 1
        if out != [s]:
            touched += 1
            assert False, (p, len(out), s[:160])
    assert n > 5000, n
    assert touched == 0


def test_no_urdu_run_is_cut_anywhere_in_the_corpus():
    """The exemption held where v2 broke it: 225 source runs, 83 lessons."""
    seen = 0
    for p, s in _corpus_runs():
        if not URDU.search(s):
            continue
        seen += 1
        assert C.split_clause(s) == [s], (p, s[:160])
    assert seen > 500, seen


def test_no_word_is_lost_over_the_corpus():
    """Law 16 at CHARACTER level, which only a declined pass can satisfy as
    byte-identity: with the pass standing down the authored string comes back
    exactly, whitespace included.

    A pass that DOES split can only be held to this ignoring the whitespace at
    the row boundary, since each row is printed separately and is stripped. v2
    was checked that way before it was declined and is clean: of 22,290 source
    runs it byte-differs at 5,706, and at 0 of them once whitespace is ignored.
    v2's defect was never word loss — it was where the cut landed."""
    n = chars = 0
    for p, s in _corpus_runs():
        assert "".join(C.split_clause(s)) == s, (p, s[:160])
        n += 1
        chars += len(s)
    assert n > 5000 and chars > 1_000_000, (n, chars)


# ── the sentence pass is untouched by the decline ─────────────────────────────

def test_d0_lines_still_splits_a_multi_sentence_wall():
    """Regression guard: standing the clause pass down must not stand the
    SENTENCE pass down with it."""
    wall = (
        "Hold up the pencil box and the eraser. Ask the class which one feels "
        "heavier before anything is measured. Write both guesses on the board "
        "where every learner can see them. Then place the pencil box in one pan "
        "of the balance and the eraser in the other.")
    out = L.split_line(wall)
    assert len(out) > 1
    assert "".join(out).replace(" ", "") == wall.replace(" ", "")
    assert all(len(words(o)) <= L.THRESHOLD for o in out)
