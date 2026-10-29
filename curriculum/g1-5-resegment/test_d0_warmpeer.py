"""bd-y7hst -- ONE strategy, never one that pairs children up. Unit tests.

`d0_warmpeer`'s two selectors (`_candidates`, `is_banned_move`) are exercised here
directly; the classes below then exercise them through `d0_warmscript.method_of` /
`.apply_method`, the same way `test_d0_warmscript.py` tests the rest of that module --
split into its own file only to keep both source files under the 300-line limit (see
`d0_warmscript.py`'s docstring, and `d0_warmpeer.py`'s for the operator's quotes).

Run: python3 -m pytest test_d0_warmpeer.py -q
"""

import json
import os
import re
import shutil
import subprocess

import pytest

import d0_warmpeer as P
import d0_warmscript as W

# PARITY (bd-y7hst, reopened): `is_banned_move` and peertalk.js's own `peerTalkDefects`
# are two independent vocabularies, and the build runs the JS one as a HARD GATE after
# generation, before render (`ch9-10-build/build_render.sh`) -- a drift here fails a
# whole chapter build, not one lesson. A second agent is widening peertalk.js live in a
# sibling worktree right now, so `TestParityWithLivePeerTalkJs` below re-checks against
# the ACTUAL file on every run, shelling out to node ONCE, rather than trusting a
# point-in-time manual copy of its vocabulary.
_LP_V9 = ("/Users/amenaahmed/rumi/Rumi 10 April 2026/.claude/worktrees/bd-yjmxh"
          "/bot/vendor/lp-v9")
_PEERTALK_JS = os.path.join(_LP_V9, "lib", "peertalk.js")
_NODE_SCRIPT = (
    # argv[1], not argv[2]: `node -e <script> <args...>` does NOT reserve an argv
    # slot for the eval string itself (confirmed against the node on this machine,
    # v25.9.0) -- argv is [node, ...args]. The off-by-one here used to make every
    # `require()` throw ERR_INVALID_ARG_TYPE (undefined id), which `_gate_flags`
    # swallowed as a SubprocessError and reported as None -- so this test was
    # silently SKIPPING, not passing, on every run before this fix.
    "const { peerTalkDefects } = require(process.argv[1]);"
    "const strings = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
    "process.stdout.write(JSON.stringify("
    "strings.map(s => peerTalkDefects(s).length > 0)));"
)


def _gate_flags(strings):
    """[bool, ...] -- whether the LIVE peertalk.js flags each string, one node call.

    None (not a list) when node or the vendored file isn't reachable -- the caller
    skips rather than reds, since this environment fact is outside this bead's control.
    """
    node = shutil.which("node")
    if not node or not os.path.isfile(_PEERTALK_JS):
        return None
    try:
        proc = subprocess.run(
            [node, "-e", _NODE_SCRIPT, _PEERTALK_JS],
            input=json.dumps(list(strings)), capture_output=True, text=True,
            timeout=30, check=True)
        return json.loads(proc.stdout)
    except (subprocess.SubprocessError, ValueError, OSError):
        return None

# The operator's own examples, reconstructed into the NUMBERED SCRIPT shape this
# module's selectors act on. `renders/g1_ch8/docs/Maths_seg4.lp.json` is locally
# reachable and confirmed read (bd-y7hst, reopened) -- but its `warmUp.script` field is
# empty, like all 335 shipping lessons' (see `d0_warmscript.py`'s docstring); the real
# defect lives in `warmUp.items[]` instead, covered by `d0_warmitems.py` and
# `test_d0_warmitems.py` against that same doc's actual items. This fixture stays a
# synthetic stand-in for the numbered-script shape -- one clean written retrieval, and
# three peer-talk moves she named verbatim ("Partner-check before reveal",
# "Fact-fluency pair game: Partner A says a number 1-10; Partner B instantly says a
# bigger or smaller number"), plus two more of her banned families (turn-and-talk,
# whisper-to-a-partner) -- in the shape she described: *"If I see the Opening, there is
# a strategy, then 3 questions then a hook..."* -- four things stacked where one
# belongs.
FOUR_ITEMS = (
    "1. Say: 'Flash a number card 1 to 10 and ask what number makes 10 with it.' "
    "Write your answer on your slate. "
    "2. Partner-check before reveal. "
    "3. Fact-fluency pair game: Partner A says a number 1-10; Partner B instantly "
    "says a bigger or smaller number. "
    "4. Turn to your partner and whisper your guess before the reveal."
)

# A trailing banned move with no numbering at all -- the more common real shape,
# since the live corpus never numbers its warm-up scripts (checked: zero of 30).
TRAILING_BANNED = (
    "Say: 'I will show a fact family.' Write the missing number on your slate. "
    "Partner-check before reveal."
)

# The banned move IS the only candidate -- nothing clean to fall back to.
ONLY_BANNED = ("Fact-fluency pair game: Partner A says a number 1-10; Partner B "
               "instantly says a bigger or smaller number.")

BANNED_PHRASES = ("Partner A", "Partner B", "Partner-check", "partner-check",
                   "pair game", "turn to your partner", "whisper")


def _strategy_count(text):
    """How many independent action-bearing sentences a kept method carries.

    A clean method has exactly one: the sentence that started it. A continuation
    clause ("then one clap and we say it together") carries no fresh action verb of
    its own, so it does not add to the count -- only a SECOND write-trigger would.
    """
    return sum(1 for s in W._SENTENCE.split(text) if s.strip() and W._has_action(s))


class TestCandidatesSplitsOnNumberedMarkers:
    """Direct unit tests for `d0_warmpeer._candidates`."""

    def test_four_numbered_items_become_four_candidates(self):
        assert len(P._candidates(FOUR_ITEMS)) == 4

    def test_an_unnumbered_script_is_one_candidate_unchanged(self):
        s = "Write your answer on your slate. Then walk the row."
        assert P._candidates(s) == [s]

    def test_a_single_marker_is_not_enough_to_split(self):
        # `_candidates` only splits at TWO OR MORE markers -- one alone is not a
        # stacked list, so `_method_from_one` still sees (and can stop inside) the
        # whole script as a single candidate.
        s = "1. Write the sum on your slate."
        assert P._candidates(s) == [s]


class TestIsBannedMoveMatchesHerNamedFamilies:
    """Direct unit tests for `d0_warmpeer.is_banned_move`."""

    def test_the_banned_vocabulary_matches_the_operators_own_list(self):
        for phrase in ("Partner A says a number", "Partner-check before reveal",
                       "turn to your partner and whisper",
                       "Think-pair-share with a neighbour",
                       "elbow partner", "shoulder partner",
                       "buzz groups first", "discussion circles form",
                       "group discussion starts", "discuss in pairs",
                       "tell your partner", "ask your partner",
                       "pair games are fun", "peer-mediated pair work",
                       "go round the class", "as many as time allows"):
            assert P.is_banned_move(phrase), phrase

    def test_fact_fluency_game_played_solo_is_not_banned(self):
        # Maths_seg2 in the live corpus: *"our calm fact-fluency game ... Beat your
        # own last score; nobody is racing another child"* -- individual work must
        # not trip on the bare word `game`.
        assert not P.is_banned_move(
            "For our calm fact-fluency game, solve these quietly on your slate.")

    def test_urdu_gender_pair_vocabulary_is_not_banned(self):
        # Urdu_seg6 in the live corpus: "اَپنی کاپی میں ایک جوڑا لِکھیں" -- write a
        # (gender) PAIR of words. Still not banned now that Urdu families are checked
        # too: word-form/order mismatch against every one of the six copied patterns.
        assert not P.is_banned_move("اَپنی کاپی میں ایک جوڑا لِکھیں")

    def test_the_urdu_vocabulary_matches_peertalkjs_own_six_families(self):
        # Copied verbatim from `bot/vendor/lp-v9/lib/peertalk.js`'s `lang: 'ur'`
        # entries -- see `d0_warmpeer.py`'s docstring for why copied, not imported.
        for phrase in (
            "سرگوشی میں بات کریں",                                    # whisper
            "اپنے ساتھی سے بات کریں",                                 # talk to your companion
            "جوڑی میں پوچھیں",                                        # pair talk
            "آپس میں بات چیت کریں",                                   # talk among yourselves
            "ایک دوسرے سے پوچھیں",                                    # talk to each other
            "اپنے ساتھی سے زبانی پوچھیں",                             # partner checks aloud
        ):
            assert P.is_banned_move(phrase), phrase

    def test_real_corpus_urdu_hits_are_caught(self):
        # renders/g5_ch10/docs/Urdu_seg6.lp.json item 1, and
        # renders/g5_ch9/docs/Urdu_seg7.lp.json item 0's parenthetical tail.
        assert P.is_banned_move(
            "جوڑی میں ایک دوسرے سے پوچھیں: 'بگولا' لفظ میں کون سے ارکان ہیں؟")
        assert P.is_banned_move("(جوڑی میں پوچھیں، پھر کورس میں جواب دیں)")

    def test_two_real_corpus_urdu_misses_are_now_caught(self):
        # Was "...stay_unbanned_not_guessed_at": these two pinned a DOCUMENTED GAP as a
        # passing test. The gap is closed (2026-09-24) -- peertalk.js gained
        # ساتھی/پارٹنر + کو + سنا/بتا, mirrored here -- so the assertion inverts.
        # renders/g5_ch10/docs/Urdu_seg6.lp.json item 2 (transliterated "پارٹنر") and
        # renders/g5_ch9/docs/Urdu_seg7.lp.json item 1 ("...اپنے ساتھی کو سنائیں").
        # The second also needed a NEGATORS.ur fix: bare "نہ " was matching INSIDE
        # پیمانہ and silently suppressing the defect.
        assert P.is_banned_move(
            "پارٹنر کو بتائیں: ببلو کے صبر کا پیمانہ کیوں لبریز ہوا تھا؟")
        assert P.is_banned_move(
            "'راہ گیر' لفظ کو دو اجزا میں توڑ کر اپنے ساتھی کو سنائیں۔")

    def test_a_genuine_urdu_prohibition_is_still_suppressed(self):
        """The نہ boundary fix must not un-suppress real prohibitions."""
        assert not P.is_banned_move("اپنے ساتھی کو نہ بتائیں، خاموشی سے لکھیں۔")
        assert not P.is_banned_move("ساتھی کو مت بتائیں۔")


# Seeded with (a) the 10 real corpus items the build's own gate flags that the
# generator vocabulary still misses (`generator_gate_delta.txt`, bd-y7hst TARGET
# REFRESH -- superseding the prior 18-item snapshot, most of which the earlier
# widening in this same bead already closed on both sides) -- all must be True on
# both now, (b) the five strings the coordinator named that must stay False on both
# (the fifth is the possessive trap "partner's", guarded by both `_BANNED_MOVE`'s
# negative lookahead and `d0_warmitems._strip_addressee`'s matching one), and (c) the
# subset of the existing positive-fixture list above that peertalk.js's OWN
# vocabulary also names -- excluding "pair games are fun" and "peer-mediated pair
# work", this module's two documented, deliberate supersets (see `d0_warmpeer.py`'s
# `_BANNED_MOVE` comments), where equality would legitimately fail.
_PARITY_FIXTURES = (
    # The 10-item refreshed miss list, all one family: a talk-adjacent verb
    # (read/say/count/compare/point) ahead of "with a partner" in the same text.
    "Read the numeral 1 with a partner.",
    "Read the numeral 3 with a partner.",
    "Read the numerals 7, 8, 9, 10, and 12 with a partner.",
    "Say clock numbers 1 to 12 with a partner.",
    "Point and chorally count the clock numerals from 1 to 12 with a partner.",
    "Choose and solve 4 + 3, 4 + 4, or 3 + 2. Compare quietly with a partner.",
    "Say one number bond for 90 with a partner.",
    "Say number bonds to 10 with a partner.",
    "Number-sense-style quick count: with a partner, count the text types and "
    "count the task steps.",
    "Say the HOUR-spinner numbers from 1 to 12 with a partner.",
    # Must stay CLEAN in both -- the coordinator's explicit protected set.
    "Write one line on your partner's answer, then slide the copy back.",
    "Work with a partner's written answer in your copy.",
    "Write the word in your copy. When I clap, the whole class says it together "
    "and you tick or fix your own.",
    "Hands up — tell the class where you saw it.",
    "On a clap, the whole class reveals together.",
    # Existing positive fixtures peertalk.js's own vocabulary also names.
    "Partner A says a number",
    "Partner-check before reveal",
    "turn to your partner and whisper",
    "Think-pair-share with a neighbour",
    "elbow partner",
    "shoulder partner",
    "buzz groups first",
    "discussion circles form",
    "group discussion starts",
    "discuss in pairs",
    "tell your partner",
    "ask your partner",
    "go round the class",
    "as many as time allows",
    # A clean negative control the gate has always let straight through.
    "Write your answer on your slate.",
)


class TestParityWithLivePeerTalkJs:
    """The DURABLE half of this bead's reopen -- wanted more than the vocabulary
    widening itself. `is_banned_move` and peertalk.js's `peerTalkDefects` are two
    independent vocabularies; the build runs the JS one as a HARD GATE after
    generation, before render (`ch9-10-build/build_render.sh`), so a drift here fails
    a whole chapter build, not one lesson. A second agent is widening peertalk.js
    live in a sibling worktree right now, so this re-checks against the ACTUAL file
    on every run rather than trusting a point-in-time manual copy -- and skips
    cleanly, not red, when node or that file isn't reachable.
    """

    def test_is_banned_move_agrees_with_the_live_gate_on_every_fixture(self):
        flags = _gate_flags(_PARITY_FIXTURES)
        if flags is None:
            pytest.skip("node or the live peertalk.js is unavailable")
        # zip() truncates to the shorter side: a short/empty reply from node would
        # compare nothing and pass vacuously. Assert the shape before trusting it.
        assert len(flags) == len(_PARITY_FIXTURES), (
            "gate returned %d verdicts for %d fixtures -- parity check is not running"
            % (len(flags), len(_PARITY_FIXTURES)))
        mismatches = [
            "%r -- mine=%s gate=%s" % (text, P.is_banned_move(text), gate_flag)
            for text, gate_flag in zip(_PARITY_FIXTURES, flags)
            if P.is_banned_move(text) != gate_flag
        ]
        assert not mismatches, "\n".join(mismatches)


class TestExactlyOneStrategy:
    """DEFECT 1. OPERATOR: *"it should be just 1 not multiple strategies since
    opening is a whole provocation on its own"*; *"there is a strategy, then 3
    questions then a hook and then an open with this question, doesnt make sense
    what to do and what not to do."*
    """

    def test_four_numbered_candidates_seat_exactly_one_strategy(self):
        out = W.method_of(FOUR_ITEMS)
        assert _strategy_count(out) == 1

    def test_the_clean_first_candidate_is_the_one_kept(self):
        assert W.method_of(FOUR_ITEMS) == "Write your answer on your slate."


class TestNoStudentToStudentTalk:
    """DEFECT 2. OPERATOR: *"teachers dont let students talk to each other, that
    too when the class begins ... In large classrooms, its just not possible to do
    so much in a class of 40+ students ... all teachers have said they can do only
    1 activity per LP."*
    """

    def test_none_of_the_banned_families_survive_the_numbered_fixture(self):
        out = W.method_of(FOUR_ITEMS)
        for phrase in BANNED_PHRASES:
            assert phrase.lower() not in out.lower(), phrase

    def test_a_trailing_unnumbered_partner_check_is_cut(self):
        assert W.method_of(TRAILING_BANNED) == \
            "Write the missing number on your slate."

    def test_a_script_that_is_only_a_banned_move_seats_nothing(self):
        assert W.method_of(ONLY_BANNED) == ""


class TestDroppedCandidatesRecordWhy:
    def _sections(self):
        return [{"id": "introduction", "blocks": [
            {"type": "paragraph", "id": "routine", "text": "Class in, books out."},
            {"type": "ask", "id": "hook", "prompt": "Why?"}]}]

    def test_the_three_banned_candidates_each_leave_a_gap(self):
        secs = self._sections()
        gaps = W.apply_method(secs, {"script": FOUR_ITEMS})
        assert len(gaps) == 3
        assert all(re.search(r"peer|partner|bd-y7hst", g, re.I) for g in gaps)

    def test_the_clean_candidate_still_seats_despite_the_drops(self):
        secs = self._sections()
        W.apply_method(secs, {"script": FOUR_ITEMS})
        blk = next(b for b in secs[0]["blocks"] if b["id"] == W.BLOCK_ID)
        assert blk["text"] == "Write your answer on your slate."

    def test_a_wholly_banned_script_seats_nothing_and_says_why(self):
        secs = self._sections()
        gaps = W.apply_method(secs, {"script": ONLY_BANNED})
        assert [b["id"] for b in secs[0]["blocks"]] == ["routine", "hook"]
        assert any(re.search(r"peer|partner", g, re.I) for g in gaps)
