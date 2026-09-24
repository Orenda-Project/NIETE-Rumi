"""Tests for `d0_openingpeer.py` -- bd-y7hst Opening-section peer-talk filter.

Real corpus strings only, per module scope: this is a pass-through filter over
already-assembled Opening `blocks` content, never a generator. Fixtures below
are copied verbatim (encoding-for-encoding) from the renders under
`renders/*/docs/*.lp.json` in this directory's parent build
(`10_Grades 1-5 LP Build/ch9-10-build/renders/`), captured 2026-09-24 during
the swarm coordinator's own full-corpus validation of this module.

Two families of case, both load-bearing:

  - THE THREE GENUINE MISSES (coordinator's own validation, ISSUE #2): the
    LP's own "Today we will..." framing sits inside a `Say: "..."` quoted
    span, or is glued to an adjacent sentence by a closing quote mark, so
    ordinary sentence-level segmentation cannot isolate it. Each must come
    back REPAIRED to the coordinator's exact specified text.

  - THE FOUR MUST-STAY-UNCHANGED RESIDUALS: two textbook-report gaps
    (page reference tight against the banned clause) and two quoted-book-
    dialogue gaps. These must NEVER be touched -- asserted byte-identical,
    every time this module runs, so a future needle can never regress them.
"""
from __future__ import annotations

import d0_openingpeer as m


# --- the three genuine misses (must repair) --------------------------------

def test_g2_ch10_english_seg1_lead_clause_embedded_in_quote_is_excised():
    text = (
        'Open textbook p.123 and point to the large blue shape. Say: '
        '"Look at Sir Riaz. He is speaking. The boy has a question mark and '
        'an exclamation mark above his head. The girl is laughing and giving '
        'a thumbs-up. Today we will listen to Sir Riaz’s jokes and facts, '
        'choose how we feel, and tell a buddy which one made us laugh or '
        'think."'
    )
    expected = (
        'Open textbook p.123 and point to the large blue shape. Say: '
        '"Look at Sir Riaz. He is speaking. The boy has a question mark and '
        'an exclamation mark above his head. The girl is laughing and giving '
        'a thumbs-up. Today we will listen to Sir Riaz’s jokes and facts, '
        'choose how we feel."'
    )
    new_text, reason = m._redirect(text)
    assert new_text == expected
    assert reason == "embedded_clause_removed"


def test_g4_ch9_english_seg4_mid_sentence_clause_not_flagged_by_oracle_alone():
    """`is_banned_move` never flags this field as a whole (the oracle does not
    itself ban the phrase "sit in a circle"), yet the live gate's own rule
    does -- the closed-set pass must run unconditionally, not only when the
    pipeline's own banned-move gate has already fired."""
    text = (
        'Show textbook pp.104–105. Say: “Pinky invites us to '
        '‘chat about our poem and the beautiful dances of our '
        'country.’ In the picture, one girl stands and speaks while '
        'three children sit together on an orange round rug. Today we will '
        'sit in a circle, share an idea, ask a question, and explain our '
        'reasons clearly.”'
    )
    expected = (
        'Show textbook pp.104–105. Say: “Pinky invites us to '
        '‘chat about our poem and the beautiful dances of our '
        'country.’ In the picture, one girl stands and speaks while '
        'three children sit together on an orange round rug. Today we will '
        'share an idea, ask a question, and explain our reasons '
        'clearly.”'
    )
    assert not m.is_banned_move(text), (
        "fixture assumption changed: the oracle now flags the whole field; "
        "re-check this test still exercises the unconditional-pass path")
    new_text, reason = m._redirect(text)
    assert new_text == expected
    assert reason == "embedded_clause_removed"


def test_g2_ch8_english_seg5_two_nonadjacent_runs_both_excised():
    """Two non-contiguous banned runs in one field: a whole sentence ("Say it
    out loud with your partner.") glued to the PRECEDING sentence by a
    closing quote mark right after the period (the `_BOUNDARY` regex's
    lookbehind never fires there, so ordinary segmentation cannot isolate it
    without losing the legal quoted sentence ahead of it too), and a
    mid-sentence clause (", guess with your partner") elsewhere in the same
    field. Both are closed-set needles; neither needs the segment pipeline's
    contiguous-run machinery."""
    text = (
        "Listen to this sentence from page 103: 'Pinky gave Pinky's book to "
        "Aisha.' Say it out loud with your partner. Does anything sound "
        "funny or repeated? We say 'Pinky' TWICE in one short sentence! "
        "Before I teach you the trick, guess with your partner: what SHORT "
        "word could stand in for 'Pinky' the second time, so we do not say "
        "her name twice? Write your one-word guess in your copy now "
        "— we will check it in a minute."
    )
    expected = (
        "Listen to this sentence from page 103: 'Pinky gave Pinky's book to "
        "Aisha.' Does anything sound funny or repeated? We say 'Pinky' "
        "TWICE in one short sentence! Before I teach you the trick: what "
        "SHORT word could stand in for 'Pinky' the second time, so we do "
        "not say her name twice? Write your one-word guess in your copy "
        "now — we will check it in a minute."
    )
    new_text, reason = m._redirect(text)
    assert new_text == expected
    assert reason == "embedded_clause_removed"
    assert "partner" not in new_text.lower()


# --- the four must-stay-unchanged residuals ---------------------------------

def test_g3_ch10_maths_seg4_textbook_page_report_untouched():
    text = (
        'On p.177, the Match and Weigh Partner Challenge asks each partner '
        'to write a mass up to 3 kg, add the two masses, and see how close '
        'the total is to 5 kg. Today we will use kilograms and grams '
        'carefully so that our totals and amounts left are correct. Where '
        'do YOU see things being weighed at home or in your community?'
    )
    new_text, reason = m._redirect(text)
    assert new_text == text
    assert reason == "textbook_quote_or_report"


def test_g5_ch10_maths_seg6_textbook_page_report_untouched():
    text = (
        'Show textbook p.210. Say: "The Skill Sharpener asks, ‘With a '
        'partner, calculate how many seconds are in 15 minutes and 30 '
        'seconds.’ The page also asks, ‘If it takes 2 minutes and '
        '30 seconds to boil an egg, how many seconds does it take?’ '
        'Today we will use a picture of minute-groups, each worth 60 '
        'seconds, so that every conversion is visible. At the biryani '
        'cooking scene, the page says, ‘Babloo, we need to figure out '
        'the total cooking time for biryani. It simmers for 25 minutes and '
        'then rests for 15 minutes.’ Time units help us make sense of '
        'cooking, football, movies, and school-day activities.'
    )
    new_text, reason = m._redirect(text)
    assert new_text == text
    assert reason == "textbook_quote_or_report"


def test_g2_ch10_english_seg4_quotes_book_character_untouched():
    text = (
        'Open textbook p.129 and point to the two speaking portraits. Say: '
        '"On this page, a boy asks, ‘Can you help me sort out the '
        'words given below into the right column?’ Then an older man '
        'says, ‘Hey buddies! Discuss with your classmates which is '
        'your most favourite season.’ Today we will use simple English '
        'words and phrases in a small circle. We will listen, nod, and add '
        'to the speaking chain with, ‘I like... because...’"'
    )
    new_text, reason = m._redirect(text)
    assert new_text == text
    assert reason is not None


def test_g2_ch8_english_seg2_sir_riaz_quoted_dialogue_untouched():
    text = (
        'Sir Riaz: “What is a question you can ask your neighbour? How '
        'is it different from a statement?”'
    )
    new_text, reason = m._redirect(text)
    assert new_text == text
    assert reason is not None


# --- baseline behaviour, unaffected by the closed-set pass ------------------

def test_legal_text_passes_through_unflagged():
    text = "Look at the picture on page 12 and tell me what you see."
    new_text, reason = m._redirect(text)
    assert new_text == text
    assert reason is None


def test_whole_banned_string_with_blessed_fallback_is_redirected():
    text = "Whisper your first guess to your partner."
    new_text, reason = m._redirect(text)
    assert new_text == (
        "Write the word in your copy. When I clap, the whole class says it "
        "together and you tick or fix your own."
    )
    assert reason == "redirected_to_blessed_whole_class_form"


def test_empty_string_is_untouched():
    assert m._redirect("") == ("", None)


# --- apply_opening_peer_talk wrapper ----------------------------------------

def test_apply_opening_peer_talk_no_opening_section_is_noop():
    sections = [{"id": "development", "title": "Guided Practice", "blocks": []}]
    assert m.apply_opening_peer_talk(sections) == []


def test_apply_opening_peer_talk_gaps_a_whole_banned_field_with_no_safe_removal():
    """A whole-item banned string with no blessed substitute (see
    `_ALL_DROP_FALLBACK`) is left byte-for-byte unchanged in place, and the
    wrapper records exactly one gap message naming the field's path."""
    original = "Turn to your partner and tell them the answer."
    sections = [
        {"id": "introduction", "title": "Opening", "blocks": [
            {"type": "prompt", "question": original},
        ]},
    ]
    gaps = m.apply_opening_peer_talk(sections)
    assert sections[0]["blocks"][0]["question"] == original
    assert len(gaps) == 1
    assert "blocks[0].question" in gaps[0]


def test_apply_opening_peer_talk_skips_meaning_leaf():
    sections = [
        {"id": "introduction", "title": "Opening", "blocks": [
            {"type": "vocab", "items": [
                {"word": "dialogue",
                 "meaning": "when two characters in a story talk to each "
                            "other, that is called dialogue"},
            ]},
        ]},
    ]
    gaps = m.apply_opening_peer_talk(sections)
    assert gaps == []
    assert sections[0]["blocks"][0]["items"][0]["meaning"] == (
        "when two characters in a story talk to each other, that is called "
        "dialogue")
