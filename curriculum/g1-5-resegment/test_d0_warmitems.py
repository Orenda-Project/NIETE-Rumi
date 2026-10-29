"""bd-y7hst, REOPENED -- ONE strategy in `warmUp.items[]`. Unit tests for `one_strategy`.

Every fixture below is transcribed VERBATIM from a shipping doc under
`10_Grades 1-5 LP Build/ch9-10-build/renders/<lesson>/docs/<Segment>.lp.json`,
`sections[0].warmup.items` -- not reconstructed, not synthetic. Each is cited by its
real path so anyone can re-open the source. See `d0_warmitems.py`'s docstring for the
two-stage rule these pin.

Run: python3 -m pytest test_d0_warmitems.py -q
"""

import d0_warmitems as I
from d0_warmpeer import is_banned_move

_A = "design pending — not carried by primary Stage-C enrichment"


def _item(q, kind="prerequisite", a=_A):
    return {"q": q, "a": a, "kind": kind}


# renders/g1_ch8/docs/Maths_seg4.lp.json -- THE flagship example: two banned families
# (Partner-check tail, twice; a Fact-fluency pair game that opens on the ban itself).
MATHS_SEG4 = [
    _item("Recall: yesterday we measured length/height with blocks, leaves, pencils, "
          "end to end, no gaps. Today: measuring how HEAVY something is. — peer says "
          "it together.", kind="scaffold"),
    _item("Subitise: a 3-dot triangle flashed for 2 seconds — how many? Partner-check "
          "before reveal."),
    _item("Subitise: a 4-dot square flashed for 2 seconds — how many? Partner-check "
          "before reveal."),
    _item("Fact-fluency pair game: Partner A says a number 1-10; Partner B instantly "
          "says a bigger or smaller number (their choice which); swap roles. No "
          "counting on fingers, no timer."),
]

# renders/g1_ch8/docs/Maths_seg3.lp.json -- same shape, different banned tail phrasing
# ("Tell your partner..."), plus an unrelated real gap ("...one pair shares aloud")
# that names no family either author has written a pattern for -- left alone.
MATHS_SEG3 = [
    _item("Recall: how did we measure length yesterday? (things lined up end to end, "
          "no gaps) — peer says it together, then one pair shares aloud.",
          kind="scaffold"),
    _item("Subitise: 4 dots flashed for 2 seconds — how many? Tell your partner, then "
          "we reveal and check together."),
    _item("Subitise: 3 dots flashed for 2 seconds — how many? Tell your partner, then "
          "reveal and check."),
    _item("Fact-fluency pair game: Partner A flashes 1-5 fingers, Partner B says the "
          "number instantly with no counting one by one; swap after five turns each. "
          "No timer, no whole-class pressure — just your own pair's pace."),
]

# renders/g3_ch8/docs/Maths_seg5.lp.json -- pure whole-item ban, nothing to repair
# (the banned item has no legal prefix sentence at all).
MATHS_SEG5 = [
    _item("retrieval 1: 5,10,15,20 -> jump +5, next 25", kind="scaffold"),
    _item("retrieval 2: 30,27,24,21 -> jump -3, next 18"),
    _item("choral skip-count by 2s to 20"),
    _item("choral skip-count by 5s to 50"),
    _item("Jump Relay (self-referenced pair game, not timed against classmates)"),
]

# renders/g1_ch9/docs/Maths_seg7.lp.json -- the one real doc that fires BOTH stages:
# item 0's banned "(choral + partner check)" lead is stripped and repaired (the
# colon-boundary widening gives "Days chain:" its own non-banned label segment -- see
# `d0_warmitems.py`'s "UPDATE ... flagship re-audit" docstring paragraph); item 6
# survives stage 1 (names no banned family) but is then cut in stage 2 as a second,
# distinct strategy (a named game) stacked behind five plain retrieval/chain items.
MATHS_SEG7 = [
    _item("Days chain: Sunday→Monday→Tuesday (choral + partner check)",
          kind="scaffold"),
    _item("Days chain: Saturday→Sunday"),
    _item("Solar months chain: January→February→March"),
    _item("Solar months chain: June→July"),
    _item("Islamic months chain: Muharram→Safar"),
    _item("Number sense: skip-count by 2s to 12; 12 = 1 ten + 2 ones"),
    _item("Self-paced partner fluency game: recite months Jan-Dec as far as "
          "possible"),
]

# renders/g1_ch8/docs/Urdu_seg5.lp.json -- 13-item single-word Urdu list. THE case the
# correction is about: one strategy, thirteen instances of it, nothing banned, nothing
# capped by count.
URDU_WORDLIST_13 = [_item(w, kind="scaffold" if i == 0 else "prerequisite") for i, w in
                     enumerate(["تُم", "گُم", "سُم", "چُپ", "پُل", "سُن", "بُدھ",
                                "کُھل", "کُچھ", "چُنّوں", "مُنّوں", "بِلّی", "اور"])]

# renders/g5_ch8/docs/Urdu_seg6.lp.json -- same shape, 14 items, the other >12-item
# case named explicitly in the reopening.
URDU_WORDLIST_14 = [_item(w, kind="scaffold" if i == 0 else "prerequisite") for i, w in
                     enumerate(["ماہِرِ نَفسِیات", "تَعَینات", "اَثاثَہ", "اَقَلِّیَت",
                                "رائِج", "مَطلَع", "سُہولَت", "تَعاوُن", "مَسئَلَہ",
                                "حَل", "خاکَہ", "کِردار", "مَکالَمَہ", "پیشکَش"])]

# renders/g1_ch10/docs/English_seg6.lp.json -- a real, unrelated gap: "With your
# partner, recall..." names no family in `d0_warmpeer._BANNED_MOVE`. Passes through
# unchanged -- documented, not silently patched with an invented pattern.
ENGLISH_SEG6 = [
    _item("With your partner, recall one detail from the earlier Chapter 10 story.",
          kind="scaffold", a="Pinky found an injured bird."),
    _item("Say together: Who found the injured bird?", a="Pinky."),
]

# renders/g1_ch10/docs/English_seg1.lp.json -- clean phonics word-list baseline.
ENGLISH_SEG1 = [
    _item("m-a-t", kind="scaffold", a="mat"),
    _item("c-u-p", a="cup"),
    _item("r-u-n", a="run"),
]

# renders/g5_ch10/docs/Urdu_seg6.lp.json -- real Urdu lead-strip (item 1: "جوڑی میں
# ایک دوسرے سے پوچھیں" fused behind a colon with the legal embedded question -- the
# colon-boundary widening gives the banned label its own segment, so it is now
# lead-stripped, not dropped whole; see `d0_warmitems.py`'s "UPDATE ... flagship
# re-audit" docstring paragraph). Item 2 uses the transliterated "پارٹنر کو بتائیں:" --
# UPDATE (2026-09-24): this was a real miss in the copied ban list (passed through
# unchanged); Worker F closed it in `lib/peertalk.js` and mirrored it into
# `d0_warmpeer._BANNED_MOVE_UR`, so it is now caught and lead-stripped by the same
# colon-boundary mechanism as item 1, not passed through.
URDU_SEG6_G5CH10 = [
    _item("پوری کلاس کورَس میں بتائے: 'لبریز' لفظ کن دو ارکان سے مل کر بنا ہے؟",
          kind="scaffold", a="ریز + لب"),
    _item("جوڑی میں ایک دوسرے سے پوچھیں: 'بگولا' لفظ میں کون سے ارکان ہیں؟",
          a="بَ + گو + لا"),
    _item("پارٹنر کو بتائیں: ببلو کے صبر کا پیمانہ کیوں لبریز ہوا تھا؟",
          a="اس کے ٹفن سے میٹھی روٹی کا ایک ٹکڑا غائب تھا اور اسے شک ہوا کہ کوئی اسے "
          "کھا گیا۔"),
    _item("پوری کلاس کورَس میں دہرائے: نئے لڑکے نے آخر میں کیا کہہ کر معافی مانگی؟",
          a="'میں نے آپ کے ٹفن سے ٹکڑا لیا تھا کیوں کہ میرے پاس ٹامی کو دینے کے لیے "
          "کچھ نہیں تھا۔'"),
]

# renders/g5_ch9/docs/Urdu_seg7.lp.json -- the Urdu tail-strip boundary case: item 0's
# "(جوڑی میں پوچھیں، پھر کورس میں جواب دیں)" is a banned protocol note, but it is a
# balanced parenthetical sitting at the very END of an otherwise entirely legal Urdu
# retrieval question -- UPDATE (2026-09-24): stripping it is a REMOVAL, not an
# invention (no Urdu is written or transliterated, the recalled subject matter
# survives verbatim), so it is no longer dropped whole; see `d0_warmitems.py`'s
# `_repair_or_drop` Urdu "trail" branch. Item 1's "...اپنے ساتھی کو سنائیں" ("...tell
# it to your companion") was a second real miss -- none of the six copied peertalk.js
# patterns required "سنائیں" without "زبانی" nearby -- UPDATE (2026-09-24): Worker F
# closed that gap too (see `d0_warmpeer._BANNED_MOVE_UR`), so this item is now caught
# and dropped, mid-sentence in its addressee with no `_BOUNDARY` to lead/trail-strip
# it, same as the six last-resort-redirect lessons.
URDU_SEG7_G5CH9 = [
    _item("ہمارے سبق ۹ کا بہادر ڈرائیور کون تھا؟ (جوڑی میں پوچھیں، پھر کورس میں "
          "جواب دیں)", kind="scaffold", a="عبدالشکور"),
    _item("'راہ گیر' لفظ کو دو اجزا میں توڑ کر اپنے ساتھی کو سنائیں۔",
          a="را-ہ + گِیر"),
]


# renders/g1_ch10/docs/Maths_seg4.lp.json -- LAST-RESORT REDIRECT case (bd-y7hst,
# reopened again): all three items fuse the legal verb "tell" directly onto the banned
# "your partner" addressee with no `_BOUNDARY` between them ("tell your partner one page
# fact with 0" is ONE segment, no colon/dash/sentence-end to split on), so stage 1 drops
# all three whole and the warm-up ships EMPTY -- the defect this pass exists to close.
G1_CH10_MATHS_SEG4 = [
    _item("Show 0 fingers and tell your partner one page fact with 0.",
          kind="scaffold"),
    _item("Show 1 finger and tell your partner one page fact with 1."),
    _item("Show 2 fingers and tell your partner one page fact with 2."),
]

# renders/g2_ch10/docs/English_seg4.lp.json -- LAST-RESORT REDIRECT case: both items
# carry the "Partner A"/"Partner B" named-pair-protocol LABEL peertalk.js bans outright
# (`\bPartner\s+[AB]\b`, case-sensitive) as the whole item's subject, no clean
# prefix/tail to strip -- both drop whole, empty warm-up. Item 0's real `a`
# (verbatim from the source doc, NOT the `_item` default placeholder) ALSO names
# "Partner B" -- caught only by the full-corpus gate run, not a q-only fixture; pinned
# here so it cannot silently regress.
G2_CH10_ENGLISH_SEG4 = [
    _item("Partner A recalls one word, phrase, or speaking action from the previous "
          "English lesson.", kind="scaffold",
          a="Any accurate recall from the previous English lesson, repeated by "
            "Partner B."),
    _item("Partner B says what was heard.", a="I heard you say ..."),
]

# renders/g3_ch9/docs/English_seg7.lp.json -- same Partner A/B shape; item 0 fuses BOTH
# labels into one semicolon-joined sentence.
G3_CH9_ENGLISH_SEG7 = [
    _item("Partner A recalls one writing idea from an earlier lesson; Partner B "
          "repeats it.", kind="scaffold"),
    _item("Partner B says whether the recalled idea helps a reader understand."),
]

# renders/g4_ch8/docs/English_seg2.lp.json -- the smallest possible last-resort case:
# ONE item, "Tell your partner" fused to the recalled content -- redirect or the warm-up
# is empty, there is no second item to fall back on.
G4_CH8_ENGLISH_SEG2 = [
    _item("Tell your partner ONE of yesterday's five space words and what it means.",
          kind="scaffold"),
]

# renders/g4_ch8/docs/English_seg3.lp.json -- same one-item shape, different recalled
# content.
G4_CH8_ENGLISH_SEG3 = [
    _item("Tell your partner ONE thing you remember about Namira or Pinky from "
          "yesterday's story.", kind="scaffold"),
]

# renders/g5_ch9/docs/English_seg6.lp.json -- Partner A/B shape again, two items, each
# its own sentence (no semicolon fusion this time). BOTH items' real `a` fields ALSO
# name the opposite partner label ("confirmed by Partner B"/"confirmed by Partner A") --
# same real-corpus gate-only catch as G2_CH10_ENGLISH_SEG4 above, pinned here too.
G5_CH9_ENGLISH_SEG6 = [
    _item("Partner A says one remembered learning point from the previous English "
          "lesson.", kind="scaffold",
          a="A correct learning point from the previous lesson, confirmed by "
            "Partner B."),
    _item("Partner B says a different remembered learning point from the previous "
          "English lesson.",
          a="A correct learning point from the previous lesson, confirmed by "
            "Partner A."),
]


class TestFlagshipMathsSeg4:
    """g1_ch8 Maths seg4 -- the doc the reopening names by path."""

    def test_the_banned_pair_game_lead_is_stripped_not_dropped_whole(self):
        # UPDATE (bd-y7hst, target refresh): the colon-boundary widening makes
        # "Fact-fluency pair game:" its own banned LABEL segment, with "No counting
        # on fingers, no timer." surviving as a non-banned trailing segment -- so
        # stage 1 now repairs this item (lead-shape) instead of dropping it whole.
        # Same segment-not-clause gap the module docstring already admits for
        # Urdu_seg6 item 1, not a new one -- see d0_warmitems.py's "UPDATE ...
        # flagship re-audit" paragraph.
        kept, gaps = I.one_strategy(MATHS_SEG4)
        assert len(kept) == 4
        assert gaps == []
        assert kept[3]["q"] == "No counting on fingers, no timer."

    def test_the_two_partner_check_tails_are_stripped_and_repaired_not_cut(self):
        kept, _ = I.one_strategy(MATHS_SEG4)
        assert kept[1]["q"] == ("Subitise: a 3-dot triangle flashed for 2 seconds — "
                                 "how many? On a clap, the whole class reveals "
                                 "together.")
        assert kept[2]["q"] == ("Subitise: a 4-dot square flashed for 2 seconds — how "
                                 "many? On a clap, the whole class reveals together.")

    def test_the_first_items_peer_says_tail_is_now_repaired_too(self):
        # UPDATE (bd-y7hst, target refresh): identical "-- peer says it together."
        # tail to Maths_seg3 item 0 (see the module docstring's earlier "UPDATE"
        # paragraph) -- now caught by the same "peer (talk verb, subject form)"
        # widening and repaired, no longer left untouched.
        kept, _ = I.one_strategy(MATHS_SEG4)
        assert kept[0]["q"] == (
            "Recall: yesterday we measured length/height with blocks, leaves, "
            "pencils, end to end, no gaps. Today: measuring how HEAVY something is. "
            "On a clap, the whole class reveals together."
        )

    def test_kind_and_answer_survive_untouched_on_repaired_items(self):
        kept, _ = I.one_strategy(MATHS_SEG4)
        assert kept[1]["kind"] == "prerequisite"
        assert kept[1]["a"] == _A


class TestMathsSeg3TailRepairAndAnHonestMiss:
    def test_both_tell_your_partner_tails_are_repaired(self):
        kept, gaps = I.one_strategy(MATHS_SEG3)
        assert len(kept) == 4
        assert kept[1]["q"].endswith("On a clap, the whole class reveals together.")
        assert kept[2]["q"].endswith("On a clap, the whole class reveals together.")
        # UPDATE (bd-y7hst, target refresh): the pair-game item's own banned lead is
        # now stripped too (colon-boundary widening), not dropped whole -- see
        # test_the_pair_games_own_lead_is_now_stripped_too below. Nothing left to
        # drop, so no gap.
        assert gaps == []

    def test_the_pair_games_own_lead_is_now_stripped_too(self):
        kept, gaps = I.one_strategy(MATHS_SEG3)
        assert gaps == []
        assert kept[3]["q"] == (
            "No timer, no whole-class pressure — just your own pair's pace."
        )

    def test_one_pair_shares_aloud_is_now_swept_into_the_banned_tail(self):
        # UPDATE (bd-y7hst, target refresh): "one pair shares aloud" still names no
        # family on its own, but the widened `_BOUNDARY` groups it into the SAME
        # comma-joined trailing segment as "peer says it together" (no
        # sentence-end/colon/dash between them) -- so it is swept away with that
        # segment's ban rather than preserved as an untouched honest miss. The
        # segment-not-clause gap the module docstring admits cuts both ways: this is
        # the over-cut side (a few extra words already bound to a real ban), not the
        # under-cut side documented elsewhere.
        kept, _ = I.one_strategy(MATHS_SEG3)
        assert "one pair shares aloud" not in kept[0]["q"]


class TestMathsSeg5PureWholeItemBan:
    def test_the_pair_game_with_no_legal_prefix_is_dropped_whole(self):
        kept, gaps = I.one_strategy(MATHS_SEG5)
        assert len(kept) == 4
        assert len(gaps) == 1
        assert "pair game" in gaps[0]
        assert [k["q"] for k in kept] == [it["q"] for it in MATHS_SEG5[:4]]


class TestMathsSeg7BothStagesFire:
    def test_the_partner_check_lead_and_the_distinct_game_both_get_handled(self):
        # UPDATE (bd-y7hst, target refresh): item 0 no longer has "no clean prefix"
        # -- the colon-boundary widening makes "Days chain:" its own non-banned
        # label segment, so stage 1 now repairs it (lead-shape) instead of dropping
        # it whole. Only the distinct-game drop (item 6) still produces a gap.
        kept, gaps = I.one_strategy(MATHS_SEG7)
        assert len(kept) == 6
        assert len(gaps) == 1
        assert kept[0]["q"] == "Days chain: On a clap, the whole class reveals together."

    def test_the_five_plain_chain_items_all_survive_unchanged(self):
        kept, _ = I.one_strategy(MATHS_SEG7)
        assert [k["q"] for k in kept[1:]] == [it["q"] for it in MATHS_SEG7[1:6]]

    def test_the_named_game_is_dropped_as_distinct_not_as_banned(self):
        _, gaps = I.one_strategy(MATHS_SEG7)
        distinct = [g for g in gaps if "distinct strategy" in g]
        assert len(distinct) == 1
        assert "fluency game" in distinct[0]


class TestUrduWordListsSurviveWhole:
    """OPERATOR: a 12-14 item word list is ONE strategy with many instances, "not
    fourteen strategies. Capping those to one item would gut the lesson" -- the
    correction this bead exists to make. Both fixtures MUST assert full survival.
    """

    def test_all_thirteen_items_survive(self):
        kept, gaps = I.one_strategy(URDU_WORDLIST_13)
        assert len(kept) == 13
        assert gaps == []
        assert [k["q"] for k in kept] == [it["q"] for it in URDU_WORDLIST_13]

    def test_all_fourteen_items_survive(self):
        kept, gaps = I.one_strategy(URDU_WORDLIST_14)
        assert len(kept) == 14
        assert gaps == []
        assert [k["q"] for k in kept] == [it["q"] for it in URDU_WORDLIST_14]


class TestEnglishBaselinesPassThroughClean:
    def test_no_banned_family_two_item_lesson_is_unchanged(self):
        kept, gaps = I.one_strategy(ENGLISH_SEG6)
        assert gaps == []
        assert [k["q"] for k in kept] == [it["q"] for it in ENGLISH_SEG6]

    def test_three_item_phonics_word_list_is_unchanged(self):
        kept, gaps = I.one_strategy(ENGLISH_SEG1)
        assert gaps == []
        assert [k["q"] for k in kept] == [it["q"] for it in ENGLISH_SEG1]


class TestUrduBannedMovesFromCopiedPeertalkVocabulary:
    """g5_ch10 Urdu_seg6 and g5_ch9 Urdu_seg7 -- the real corpus hits against
    `d0_warmpeer._BANNED_MOVE_UR`. UPDATE (2026-09-24): the vocabulary's two former
    misses (transliterated "پارٹنر"; "سنائیں" without "زبانی" nearby) were closed by
    Worker F in `lib/peertalk.js`/`d0_warmpeer._BANNED_MOVE_UR`, and a `NEGATORS.ur`
    boundary fix (bare "نہ " no longer matches inside words like "پیمانہ") -- so both
    are now caught, not left alone. See `test_d0_warmpeer.py`'s
    `test_two_real_corpus_urdu_misses_are_now_caught` for the vocabulary-side proof.
    """

    def test_the_fused_colon_ban_is_now_lead_stripped_not_dropped_whole(self):
        # UPDATE (bd-y7hst, target refresh): the colon-boundary widening now
        # isolates "جوڑی میں ایک دوسرے سے پوچھیں:" as its own banned label segment
        # ahead of the legal embedded question -- so stage 1 repairs it (lead-shape)
        # instead of dropping the whole item, same mechanism as Maths_seg7 item 0.
        kept, gaps = I.one_strategy(URDU_SEG6_G5CH10)
        assert len(kept) == 4
        assert gaps == []
        assert kept[1]["q"] == "'بگولا' لفظ میں کون سے ارکان ہیں؟"

    def test_the_transliterated_partner_item_is_now_caught(self):
        # Was "test_the_transliterated_partner_item_is_an_honest_miss": this pinned a
        # DOCUMENTED GAP (the transliterated "پارٹنر" was not in the copied ban list)
        # as a passing test. The gap is closed (2026-09-24) -- Worker F added
        # `/پارٹنر\s*کو\s*(?:سنا|بتا)/` to `d0_warmpeer._BANNED_MOVE_UR` -- so the
        # assertion inverts: the item's banned "پارٹنر کو بتائیں:" label is now its own
        # colon-bounded segment and gets lead-stripped, same mechanism as item 1.
        kept, _ = I.one_strategy(URDU_SEG6_G5CH10)
        assert not any("پارٹنر کو بتائیں" in k["q"] for k in kept)
        assert kept[2]["q"] == "ببلو کے صبر کا پیمانہ کیوں لبریز ہوا تھا؟"

    def test_the_surrounding_choral_items_are_unchanged(self):
        # Scope narrowed (2026-09-24): item 2 moved to
        # `test_the_transliterated_partner_item_is_now_caught` above, since its q is
        # no longer the original fixture string (it is now lead-stripped) -- this test
        # only owns the two full-class choral items, which the vocabulary widening
        # does not touch.
        kept, _ = I.one_strategy(URDU_SEG6_G5CH10)
        assert kept[0]["q"] == URDU_SEG6_G5CH10[0]["q"]
        assert kept[3]["q"] == URDU_SEG6_G5CH10[3]["q"]

    def test_the_urdu_protocol_note_is_now_stripped_not_dropped(self):
        # Was "test_the_clean_urdu_tail_is_dropped_whole_with_its_own_reason": that
        # name and its "no vetted Urdu replacement phrase exists -- dropped, not
        # invented" reasoning are now WRONG for item 0 specifically (2026-09-24) --
        # its only banned text is the trailing parenthetical protocol note
        # "(جوڑی میں پوچھیں، پھر کورس میں جواب دیں)", a balanced `(...)` at the very
        # end of the string, so `_repair_or_drop` strips the parenthetical (a REMOVAL,
        # no Urdu invented or transliterated) and keeps the legal question underneath,
        # recording a gap note instead of a drop reason. Item 1 still drops (its ban
        # is mid-sentence in the addressee, no `_BOUNDARY` to strip at) -- see
        # `test_the_second_item_is_now_caught` below.
        kept, gaps = I.one_strategy(URDU_SEG7_G5CH9)
        assert len(kept) == 1
        assert kept[0]["q"] == "ہمارے سبق ۹ کا بہادر ڈرائیور کون تھا؟"
        assert len(gaps) == 2
        assert "protocol note" in gaps[0] or "stripped" in gaps[0]

    def test_the_second_item_is_now_caught(self):
        # Was "test_the_second_item_is_an_honest_miss_not_a_guess": this pinned a
        # DOCUMENTED GAP ("سنائیں" without "زبانی" nearby was not in the copied ban
        # list) as a passing test -- item 1 used to be the fixture's sole survivor.
        # The gap is closed (2026-09-24) -- Worker F added
        # `/ساتھی\s*کو\s*(?:سنا|بتا)/` to `d0_warmpeer._BANNED_MOVE_UR` -- so the
        # assertion inverts: the item is now caught and dropped whole (its ban is
        # fused mid-sentence onto the addressee, no `_BOUNDARY` between them), not
        # kept as an honest miss.
        kept, gaps = I.one_strategy(URDU_SEG7_G5CH9)
        assert not any(k["q"] == URDU_SEG7_G5CH9[1]["q"] for k in kept)
        assert any("banned peer-to-peer talk" in g for g in gaps)


class TestGapMessagesCiteTheBead:
    def test_every_gap_names_bd_y7hst(self):
        for fixture in (MATHS_SEG4, MATHS_SEG3, MATHS_SEG5, MATHS_SEG7,
                         URDU_SEG6_G5CH10, URDU_SEG7_G5CH9):
            _, gaps = I.one_strategy(fixture)
            assert all("bd-y7hst" in g for g in gaps)


class TestEmptyAndAllBannedEdgeCases:
    def test_no_items_at_all_is_not_an_error(self):
        assert I.one_strategy([]) == ([], [])

    def test_none_items_is_not_an_error(self):
        assert I.one_strategy(None) == ([], [])

    def test_a_single_wholly_banned_item_keeps_nothing(self):
        kept, gaps = I.one_strategy([_item("Turn to your partner and whisper your "
                                            "guess.")])
        assert kept == []
        assert len(gaps) == 1


class TestLastResortAddresseeRedirect:
    """bd-y7hst, reopened again -- six real docs where EVERY warm-up item is
    student-to-student TALK with no clean prefix/label for stage 1's segment pipeline
    to strip (the ban IS the whole item), so the ordinary per-item pass drops the whole
    warm-up and the lesson loses its retrieval slot entirely. Every one of these six
    carries a perfectly legal retrieval -- only the ADDRESSEE is illegal -- so this is a
    LAST RESORT, tried only in the zero-survivor case, that redirects the addressee
    (never the recalled content) instead of shipping an empty warm-up. See
    `d0_warmredirect.py` for the mechanism.
    """

    def test_g1_ch10_maths_seg4_is_no_longer_empty(self):
        kept, _ = I.one_strategy(G1_CH10_MATHS_SEG4)
        assert len(kept) == 3

    def test_g1_ch10_maths_seg4_addressee_is_redirected_content_kept_verbatim(self):
        kept, _ = I.one_strategy(G1_CH10_MATHS_SEG4)
        assert kept[0]["q"] == "Show 0 fingers and tell the class one page fact with 0."
        assert kept[1]["q"] == "Show 1 finger and tell the class one page fact with 1."
        assert kept[2]["q"] == "Show 2 fingers and tell the class one page fact with 2."

    def test_g2_ch10_english_seg4_is_no_longer_empty(self):
        kept, _ = I.one_strategy(G2_CH10_ENGLISH_SEG4)
        assert len(kept) == 2
        assert kept[0]["q"] == ("One student recalls one word, phrase, or speaking "
                                 "action from the previous English lesson.")
        assert kept[1]["q"] == "Another student says what was heard."

    def test_g3_ch9_english_seg7_is_no_longer_empty(self):
        kept, _ = I.one_strategy(G3_CH9_ENGLISH_SEG7)
        assert len(kept) == 2
        assert kept[0]["q"] == ("One student recalls one writing idea from an earlier "
                                 "lesson; another student repeats it.")
        assert kept[1]["q"] == ("Another student says whether the recalled idea helps "
                                 "a reader understand.")

    def test_g4_ch8_english_seg2_single_item_survives(self):
        kept, _ = I.one_strategy(G4_CH8_ENGLISH_SEG2)
        assert len(kept) == 1
        assert kept[0]["q"] == ("Tell the class ONE of yesterday's five space words "
                                 "and what it means.")

    def test_g4_ch8_english_seg3_single_item_survives(self):
        kept, _ = I.one_strategy(G4_CH8_ENGLISH_SEG3)
        assert len(kept) == 1
        assert kept[0]["q"] == ("Tell the class ONE thing you remember about Namira "
                                 "or Pinky from yesterday's story.")

    def test_g5_ch9_english_seg6_is_no_longer_empty(self):
        kept, _ = I.one_strategy(G5_CH9_ENGLISH_SEG6)
        assert len(kept) == 2
        assert kept[0]["q"] == ("One student says one remembered learning point from "
                                 "the previous English lesson.")
        assert kept[1]["q"] == ("Another student says a different remembered learning "
                                 "point from the previous English lesson.")

    def test_none_of_the_six_lessons_ends_with_zero_items(self):
        for fixture in (G1_CH10_MATHS_SEG4, G2_CH10_ENGLISH_SEG4, G3_CH9_ENGLISH_SEG7,
                        G4_CH8_ENGLISH_SEG2, G4_CH8_ENGLISH_SEG3, G5_CH9_ENGLISH_SEG6):
            kept, _ = I.one_strategy(fixture)
            assert len(kept) > 0

    def test_every_redirect_is_logged_as_an_auditable_gap_citing_the_bead(self):
        for fixture in (G1_CH10_MATHS_SEG4, G2_CH10_ENGLISH_SEG4, G3_CH9_ENGLISH_SEG7,
                        G4_CH8_ENGLISH_SEG2, G4_CH8_ENGLISH_SEG3, G5_CH9_ENGLISH_SEG6):
            kept, gaps = I.one_strategy(fixture)
            assert len(gaps) == len(kept)  # every item in these six was redirected
            assert all("bd-y7hst" in g for g in gaps)

    def test_kind_and_answer_survive_untouched_on_redirected_items(self):
        kept, _ = I.one_strategy(G1_CH10_MATHS_SEG4)
        assert kept[0]["kind"] == "scaffold"
        assert kept[1]["kind"] == "prerequisite"
        assert kept[1]["a"] == _A

    def test_a_field_partner_label_is_also_redirected_not_just_q(self):
        # g2_ch10 English_seg4 item 0's real `a` ALSO names "Partner B" -- a real gate
        # defect the full-corpus verification run caught that no q-only fixture would
        # (see d0_warmredirect.py's module docstring). Content preserved verbatim,
        # only the addressee changes, same rule as q.
        kept, _ = I.one_strategy(G2_CH10_ENGLISH_SEG4)
        assert kept[0]["a"] == ("Any accurate recall from the previous English lesson, "
                                 "repeated by another student.")
        assert kept[1]["a"] == "I heard you say ..."  # unchanged, no banned move in it

    def test_g5_ch9_seg6_both_answers_redirect_their_opposite_partner_label(self):
        kept, _ = I.one_strategy(G5_CH9_ENGLISH_SEG6)
        assert kept[0]["a"] == ("A correct learning point from the previous lesson, "
                                 "confirmed by another student.")
        assert kept[1]["a"] == ("A correct learning point from the previous lesson, "
                                 "confirmed by one student.")

    def test_no_kept_item_across_all_six_lessons_still_names_partner_in_q_or_a(self):
        for fixture in (G1_CH10_MATHS_SEG4, G2_CH10_ENGLISH_SEG4, G3_CH9_ENGLISH_SEG7,
                        G4_CH8_ENGLISH_SEG2, G4_CH8_ENGLISH_SEG3, G5_CH9_ENGLISH_SEG6):
            kept, _ = I.one_strategy(fixture)
            for it in kept:
                assert not is_banned_move(it["q"])
                assert not is_banned_move(it["a"])


class TestLastResortDoesNotFireWhenASurvivorAlreadyExists:
    """The redirect is a LAST RESORT ONLY -- a lesson that already keeps at least one
    item under the ordinary per-item pass must be byte-for-byte unaffected by this
    module existing at all."""

    def test_maths_seg4_flagship_is_unaffected(self):
        kept, gaps = I.one_strategy(MATHS_SEG4)
        assert len(kept) == 4
        assert gaps == []
        assert kept[3]["q"] == "No counting on fingers, no timer."

    def test_maths_seg5_pure_whole_item_ban_is_unaffected(self):
        kept, gaps = I.one_strategy(MATHS_SEG5)
        assert len(kept) == 4
        assert len(gaps) == 1
        assert "pair game" in gaps[0]

    def test_the_single_wholly_banned_turn_and_talk_item_is_still_unrepairable(self):
        # Different banned-move family ("turn and talk", not "tell a classmate" or
        # "Partner A/B") -- neither closed-set redirect pattern applies, so this stays
        # dropped exactly as before the redirect module existed.
        kept, gaps = I.one_strategy([_item("Turn to your partner and whisper your "
                                            "guess.")])
        assert kept == []
        assert len(gaps) == 1
        assert "bd-y7hst" in gaps[0]


class TestLastResortLeavesUrduWordListsUntouched:
    def test_all_thirteen_items_still_survive(self):
        kept, gaps = I.one_strategy(URDU_WORDLIST_13)
        assert len(kept) == 13
        assert gaps == []
        assert [k["q"] for k in kept] == [it["q"] for it in URDU_WORDLIST_13]

    def test_all_fourteen_items_still_survive(self):
        kept, gaps = I.one_strategy(URDU_WORDLIST_14)
        assert len(kept) == 14
        assert gaps == []
        assert [k["q"] for k in kept] == [it["q"] for it in URDU_WORDLIST_14]

    # NOTE: URDU_SEG7_G5CH9 (the Urdu tail-drop fixture) is deliberately NOT asserted
    # here. `d0_warmpeer._BANNED_MOVE_UR`'s vocabulary is owned by a different, actively
    # in-flight bead (bd-yjmxh/bd-v2ikv) -- pinning a specific kept-count against it here
    # would couple this module's tests to that moving target. This class's job is the
    # two word-list fixtures above, which are untouched by any Urdu vocabulary change
    # (plain single-word items, nothing any banned-move pattern matches).


class TestApplyOneStrategyWrapper:
    """`apply_one_strategy(sections)` -- the `d0_primary.py` call-site idiom, same shape
    as `d0_diagram.apply_slots`/`d0_media.apply_video`/`d0_crux.apply_crux`/
    `d0_warmscript.apply_method`. `one_strategy` itself is unchanged and still directly
    tested by every class above; this class covers only the wrapper's own job: finding
    the Opening section (not by index), mutating `warmup["items"]` in place, and
    returning gaps as a plain list of strings.
    """

    def _sections(self, *, opening_at, items):
        """A `sections` list with an Opening at position `opening_at` among two other,
        non-Opening sections, so "found by title, not index 0" is actually exercised."""
        sections = [
            {"title": "Hook", "warmup": {"items": []}},
            {"title": "Guided Practice"},
        ]
        opening = {"title": "Opening", "warmup": {"items": items}}
        sections.insert(opening_at, opening)
        return sections, opening

    def test_opening_not_at_index_zero_is_still_found(self):
        sections, opening = self._sections(opening_at=1, items=list(MATHS_SEG4))
        gaps = I.apply_one_strategy(sections)
        assert opening["warmup"]["items"] != []
        assert isinstance(gaps, list)

    def test_case_insensitive_title_match(self):
        sections, opening = self._sections(opening_at=2, items=list(MATHS_SEG4))
        opening["title"] = "OPENING (retrieval)"
        gaps = I.apply_one_strategy(sections)
        assert opening["warmup"]["items"] != []
        assert isinstance(gaps, list)

    def test_a_doc_with_no_opening_section_returns_empty_list(self):
        sections = [{"title": "Hook"}, {"title": "Guided Practice", "warmup": {"items": []}}]
        assert I.apply_one_strategy(sections) == []

    def test_an_opening_with_no_warmup_key_returns_empty_list(self):
        sections = [{"title": "Opening"}]
        assert I.apply_one_strategy(sections) == []

    def test_an_opening_with_no_items_returns_empty_list(self):
        sections = [{"title": "Opening", "warmup": {"items": []}}]
        assert I.apply_one_strategy(sections) == []

    def test_items_list_is_genuinely_mutated_in_place(self):
        sections, opening = self._sections(opening_at=0, items=list(MATHS_SEG4))
        before_id = id(opening["warmup"])
        kept, _ = I.one_strategy(MATHS_SEG4)
        gaps = I.apply_one_strategy(sections)
        assert opening["warmup"]["items"] == kept
        assert id(opening["warmup"]) == before_id  # same dict, mutated, not replaced
        assert isinstance(gaps, list)

    def test_gaps_are_plain_strings_and_match_one_strategy(self):
        sections, opening = self._sections(opening_at=0, items=list(MATHS_SEG5))
        _, expected_gaps = I.one_strategy(MATHS_SEG5)
        gaps = I.apply_one_strategy(sections)
        assert gaps == expected_gaps
        assert all(isinstance(g, str) for g in gaps)

    def test_the_six_last_resort_lessons_never_leave_the_opening_empty_via_the_wrapper(self):
        for fixture in (G1_CH10_MATHS_SEG4, G2_CH10_ENGLISH_SEG4, G3_CH9_ENGLISH_SEG7,
                        G4_CH8_ENGLISH_SEG2, G4_CH8_ENGLISH_SEG3, G5_CH9_ENGLISH_SEG6):
            sections, opening = self._sections(opening_at=0, items=list(fixture))
            I.apply_one_strategy(sections)
            assert opening["warmup"]["items"] != []
