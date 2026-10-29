"""Direct unit tests for `d0_warmredirect` -- the closed-set addressee redirects
`one_strategy()` (d0_warmitems.py) falls back to only when its own per-item pass
would otherwise leave a warm-up with zero items. See that module's docstring for
the six real lessons this exists for; `test_d0_warmitems.py`'s
`TestLastResortAddresseeRedirect` covers the end-to-end wiring through
`one_strategy`. This file is the "no orphan files" companion -- direct tests of
`redirect_addressee` itself, isolated from that wiring.
"""

import d0_warmredirect as R


class TestTellPartnerRedirect:
    def test_sentence_initial_tell_your_partner_is_capitalised(self):
        out = R.redirect_addressee("Tell your partner one page fact with 0.")
        assert out == "Tell the class one page fact with 0."

    def test_mid_sentence_tell_your_partner_stays_lowercase(self):
        out = R.redirect_addressee(
            "Show 0 fingers and tell your partner one page fact with 0.")
        assert out == "Show 0 fingers and tell the class one page fact with 0."

    def test_recalled_content_survives_verbatim(self):
        out = R.redirect_addressee(
            "Tell your partner ONE of yesterday's five space words and what it means.")
        assert out == "Tell the class ONE of yesterday's five space words and what it means."

    def test_other_partner_determiners_also_match(self):
        assert R.redirect_addressee("tell the partner your answer.") == \
            "tell the class your answer."
        assert R.redirect_addressee("tell a partner your answer.") == \
            "tell the class your answer."


class TestPartnerRoleLabelRedirect:
    def test_partner_a_opens_the_string_capitalised(self):
        out = R.redirect_addressee(
            "Partner A recalls one word from the previous English lesson.")
        assert out == "One student recalls one word from the previous English lesson."

    def test_partner_b_opens_the_string_capitalised(self):
        out = R.redirect_addressee("Partner B says what was heard.")
        assert out == "Another student says what was heard."

    def test_partner_b_mid_sentence_is_lowercased(self):
        out = R.redirect_addressee(
            "Partner A recalls one writing idea from an earlier lesson; "
            "Partner B repeats it.")
        assert out == ("One student recalls one writing idea from an earlier lesson; "
                        "another student repeats it.")

    def test_lowercase_partner_a_indefinite_article_is_not_touched(self):
        # "partner a" (lowercase) is the indefinite article, not the role label --
        # not one of the six real items, included to pin the case-sensitivity choice.
        out = R.redirect_addressee("Ask your partner a question about the story.")
        assert out is None


class TestNoMatchReturnsNone:
    def test_a_phrase_outside_the_closed_set_is_not_redirected(self):
        # "turn to your partner and whisper" is a different banned-move family
        # entirely (turn-and-talk); this module must not invent a repair for it.
        assert R.redirect_addressee("Turn to your partner and whisper your guess.") is None

    def test_a_clean_sentence_with_no_banned_addressee_is_unom(self):
        assert R.redirect_addressee("Show 0 fingers and count silently.") is None


class TestRedirectDroppedItems:
    def test_a_fully_redirectable_batch_yields_all_survivors_and_gaps(self):
        dropped = [
            (0, {"q": "Partner A recalls one word.", "kind": "scaffold"},
             "Partner A recalls one word.", "banned"),
            (1, {"q": "Partner B says what was heard.", "kind": "scaffold"},
             "Partner B says what was heard.", "banned"),
        ]
        survivors, still_dropped, gaps = R.redirect_dropped_items(dropped)
        assert len(survivors) == 2
        assert still_dropped == []
        assert len(gaps) == 2
        assert survivors[0][1]["q"] == "One student recalls one word."
        assert survivors[1][1]["q"] == "Another student says what was heard."
        assert all("bd-y7hst" in msg for _, msg in gaps)

    def test_an_unredirectable_item_stays_dropped(self):
        dropped = [
            (0, {"q": "Turn to your partner and whisper your guess.", "kind": "scaffold"},
             "Turn to your partner and whisper your guess.", "banned"),
        ]
        survivors, still_dropped, gaps = R.redirect_dropped_items(dropped)
        assert survivors == []
        assert gaps == []
        assert still_dropped == dropped

    def test_kind_and_other_fields_are_preserved_on_the_new_item(self):
        dropped = [
            (0, {"q": "Tell your partner one page fact with 0.", "kind": "scaffold",
                 "a": "varies"},
             "Tell your partner one page fact with 0.", "banned"),
        ]
        survivors, _, _ = R.redirect_dropped_items(dropped)
        assert survivors[0][1]["kind"] == "scaffold"
        assert survivors[0][1]["a"] == "varies"
