"""bd-mi5b6 -- RED-first tests for the Opening adverbial peer-talk excision.

Every fixture below is a VERBATIM corpus string (renders/*/docs/*.lp.json,
Opening sections only), not an invented example. The lesson each came from is
named in the comment so a future reader can re-pull it.

The rule being tested: an adverbial "with a partner" / "to a partner" phrase is
an ADDRESSEE, and removing it leaves a complete whole-class instruction. It is
excised. Anything that is narrative, quoted dialogue, a textbook report, or
maths jargon where "partner" is a matching VALUE is left BYTE-FOR-BYTE
unchanged -- a teacher who reads "work alone" and then sees "with a partner"
printed on the page stops trusting the plan, so a residual flag is the cheaper
error than a mangled sentence.
"""

import unittest

import d0_openpeer_adverbial as adv


class TestLeadAdverbialIsExcised(unittest.TestCase):
    def test_with_a_partner_lead_is_removed_and_remainder_recased(self):
        # g4_ch10/English_seg8 warmup/items[0]/q
        got, changed = adv.strip_adverbial(
            "With a partner, recall one idea from the previous Chapter 10 lesson.")
        self.assertTrue(changed)
        self.assertEqual(got, "Recall one idea from the previous Chapter 10 lesson.")

    def test_with_your_partner_lead_is_removed(self):
        # g1_ch10/English_seg6 warmup/items[0]/q
        got, changed = adv.strip_adverbial(
            "With your partner, recall one detail from the earlier Chapter 10 story.")
        self.assertTrue(changed)
        self.assertEqual(got, "Recall one detail from the earlier Chapter 10 story.")

    def test_lead_strip_keeps_an_embedded_page_reference_intact(self):
        # g1_ch10/Maths_seg1 warmup/items[0]/q -- p.243 is a DIAGRAM pointer,
        # not a textbook report of a partner task, so this one does excise.
        got, changed = adv.strip_adverbial(
            "With a partner, point to a triangular roof in the p.243 dollhouse "
            "and show how many sides a triangle has.")
        self.assertTrue(changed)
        self.assertEqual(
            got,
            "Point to a triangular roof in the p.243 dollhouse and show how "
            "many sides a triangle has.")


class TestTrailingAdverbialIsExcised(unittest.TestCase):
    def test_trailing_with_a_partner_before_full_stop(self):
        # g4_ch10/Maths_seg8 warmup/items[0]/q
        got, changed = adv.strip_adverbial(
            "Classify 45°, 90°, 135°, and 180° with a partner.")
        self.assertTrue(changed)
        self.assertEqual(got, "Classify 45°, 90°, 135°, and 180°.")

    def test_trailing_adverbial_before_a_colon_keeps_the_list(self):
        # g1_ch9/Maths_seg1 warmup/items[0]/q
        got, changed = adv.strip_adverbial(
            "Complete the day order aloud with a partner: Monday, Tuesday, "
            "Wednesday, Thursday, Friday, Saturday, Sunday.")
        self.assertTrue(changed)
        self.assertEqual(
            got,
            "Complete the day order aloud: Monday, Tuesday, Wednesday, "
            "Thursday, Friday, Saturday, Sunday.")

    def test_to_a_partner_is_the_same_addressee_construction(self):
        # g2_ch9/Maths_seg1 warmup/items[0]/q
        got, changed = adv.strip_adverbial("Say the number after 1 to a partner.")
        self.assertTrue(changed)
        self.assertEqual(got, "Say the number after 1.")

    def test_to_your_partner_trailing(self):
        # g3_ch9/English_seg5 warmup/items[2]/q
        got, changed = adv.strip_adverbial("Explain the difference to your partner.")
        self.assertTrue(changed)
        self.assertEqual(got, "Explain the difference.")

    def test_adverbial_before_a_semicolon_keeps_the_second_clause(self):
        # g4_ch9/Maths_seg1 warmup/items[3]/q
        got, changed = adv.strip_adverbial(
            "Solve 3 + 12 and 8 + 12 with a partner; improve your own accuracy, "
            "not your speed.")
        self.assertTrue(changed)
        self.assertEqual(
            got,
            "Solve 3 + 12 and 8 + 12; improve your own accuracy, not your speed.")


class TestPageAbbreviationsAreNotClauseBoundaries(unittest.TestCase):
    """The stub guard splits on '.', so "on p. 150." looked like a one-word
    clause "150" and a perfectly good excision was refused. A page reference
    is an abbreviation, not a sentence end."""

    def test_spaced_page_reference(self):
        # g3_ch9/Maths_seg1 warmup/items[0]/q
        got, changed = adv.strip_adverbial(
            "With a partner, count from 1 to 10 in order while pointing to the "
            "ten small spaces between 1 and 2 on the ruler diagram on p. 150.")
        self.assertTrue(changed)
        self.assertEqual(
            got,
            "Count from 1 to 10 in order while pointing to the ten small "
            "spaces between 1 and 2 on the ruler diagram on p. 150.")

    def test_unspaced_page_reference(self):
        # g4_ch9/English_seg8 warmup/items[1]/q
        got, changed = adv.strip_adverbial(
            "With a partner, name the three kinds of texts named on p.110.")
        self.assertTrue(changed)
        self.assertEqual(got,
                         "Name the three kinds of texts named on p.110.")

    def test_a_decimal_is_not_a_clause_boundary(self):
        got, changed = adv.strip_adverbial(
            "Measure 2.5 cm and 3.5 cm with a partner.")
        self.assertTrue(changed)
        self.assertEqual(got, "Measure 2.5 cm and 3.5 cm.")


class TestStringsThatMustNeverChange(unittest.TestCase):
    def test_maths_jargon_partner_is_a_matching_value_not_a_child(self):
        # g1_ch9/Maths_seg3 -- "partner" here means the matching clock value.
        for s in ("Say the whole-hour partner for 03:00.",
                  "Write the digital-time partner for 6 o'clock."):
            got, changed = adv.strip_adverbial(s)
            self.assertFalse(changed, s)
            self.assertEqual(got, s)

    def test_story_narration_with_quoted_dialogue_is_left_alone(self):
        # g2_ch8/English_seg6 blocks[0]/question -- narration, no textbook
        # framing, so only the quoted-dialogue guard protects it.
        s = ("Pinky says: 'Yesterday, I shared my colour pencils with Ali.' "
             "Listen carefully — does she say 'share' or 'shared'? "
             "Something changed at the end of the word! With your partner, "
             "guess: if 'help' happened yesterday, what would the word become? "
             "Write your guess now — we will check it in a minute.")
        got, changed = adv.strip_adverbial(s)
        self.assertFalse(changed)
        self.assertEqual(got, s)

    def test_textbook_report_is_left_alone(self):
        # g5_ch10/Maths_seg6 blocks[0]/question
        s = ("Show textbook p.210. Say: “The Skill Sharpener asks, "
             "‘With a partner, calculate how many seconds are in 15 "
             "minutes and 30 seconds.’”")
        got, changed = adv.strip_adverbial(s)
        self.assertFalse(changed)
        self.assertEqual(got, s)

    def test_excision_leaving_a_stub_sentence_is_refused(self):
        # g4_ch10/Maths_seg5 warmup/items[1]/q -- stripping would leave the
        # bare word "Agree.", which is not a usable instruction.
        s = ("Are the lines forming the five-pointed star parallel or "
             "non-parallel? Agree with your partner.")
        got, changed = adv.strip_adverbial(s)
        self.assertFalse(changed)
        self.assertEqual(got, s)

    def test_possessive_partner_is_an_artifact_not_an_addressee(self):
        # g5_ch10/Maths_seg5 blocks[0]/text. "with your partner’s" modifies
        # the WRITING, and written peer exchange is explicitly permitted:
        # "Work with a partner's written answer in your copy." Stripping the
        # phrase here would leave "Compare your writing , then both of you...".
        s = ("Next, quietly write both facts in your notebook, once each. "
             "Compare your writing with your partner’s, then both of you "
             "compare against the board.")
        got, changed = adv.strip_adverbial(s)
        self.assertFalse(changed)
        self.assertEqual(got, s)

    def test_blessed_written_exchange_form_survives(self):
        for s in ("Work with a partner’s written answer in your copy.",
                  "Write one line on your partner’s answer, then slide the "
                  "copy back."):
            got, changed = adv.strip_adverbial(s)
            self.assertFalse(changed, s)
            self.assertEqual(got, s)

    def test_a_string_with_no_peer_word_is_untouched(self):
        s = "Count 7 bottle caps or stones."
        got, changed = adv.strip_adverbial(s)
        self.assertFalse(changed)
        self.assertEqual(got, s)


class TestWarmupItemsAreProcessedAtAll(unittest.TestCase):
    """The live gap: `apply_opening_peer_talk` walks only `section.blocks`, so
    every warmup item -- where 45 of the 53 corpus adverbial strings live --
    was never seen by any pipeline."""

    def _opening(self, items):
        return [{"title": "Opening", "id": "introduction",
                 "warmup": {"items": items}, "blocks": []}]

    def test_warmup_q_field_is_filtered(self):
        secs = self._opening([
            {"q": "With a partner, name the five 3-D shapes.", "a": "cube, cone"}])
        gaps = adv.apply_warmup_peer_talk(secs)
        self.assertEqual(secs[0]["warmup"]["items"][0]["q"],
                         "Name the five 3-D shapes.")
        self.assertEqual(secs[0]["warmup"]["items"][0]["a"], "cube, cone")
        self.assertEqual(gaps, [])

    def test_warmup_a_field_is_processed_and_gapped_not_rewritten(self):
        # g1_ch10/English_seg8 warmup/items[0]/a -- a whole-line partner-role
        # statement. There is no legal remainder, so it must be REPORTED,
        # never rewritten with invented prose.
        secs = self._opening([
            {"q": "What did your partner remember?",
             "a": "Partner repeats the writing idea or sentence heard."}])
        gaps = adv.apply_warmup_peer_talk(secs)
        self.assertEqual(secs[0]["warmup"]["items"][0]["a"],
                         "Partner repeats the writing idea or sentence heard.")
        self.assertTrue(any("items[0].a" in g for g in gaps), gaps)

    def test_guided_practice_warmup_is_never_touched(self):
        secs = [{"title": "Guided Practice", "id": "activity",
                 "warmup": {"items": [
                     {"q": "With a partner, name the five 3-D shapes."}]},
                 "blocks": []}]
        gaps = adv.apply_warmup_peer_talk(secs)
        self.assertEqual(secs[0]["warmup"]["items"][0]["q"],
                         "With a partner, name the five 3-D shapes.")
        self.assertEqual(gaps, [])

    def test_no_warmup_key_is_a_no_op(self):
        secs = [{"title": "Opening", "id": "introduction", "blocks": []}]
        self.assertEqual(adv.apply_warmup_peer_talk(secs), [])


if __name__ == "__main__":
    unittest.main()


def test_the_word_textbook_alone_does_not_shield_peer_talk():
    """The guard exists so a field that REPORTS what the book says is never
    rewritten. `\\btextbook\\b` on its own was too blunt: g5_ch10/English_seg5
    merely names the textbook as a place to look ("...in your earlier notes or
    textbook") and kept "With a partner, state..." on the Opening page, which is
    the exact partner-whisper the coaches asked to remove. The frame now needs a
    reporting construction -- show/open the textbook, or textbook p.N / asks /
    says -- so a bare mention no longer shields the adjunct."""
    out, changed = adv.strip_adverbial(
        "With a partner, state the earlier Chapter 10 title if it appears "
        "in your earlier notes or textbook.")
    assert changed
    assert out == ("State the earlier Chapter 10 title if it appears in your "
                   "earlier notes or textbook.")


def test_a_real_textbook_report_is_still_refused():
    """The three other Opening strings carrying both a peer word and 'textbook'
    stay untouched: two quote the page aloud, one reads a dial off p.180."""
    for s in ("Show the textbook pages. Say: “Pinky invites us to try "
              "‘Formal vs Informal Chit Chat’ on page 113.”",
              "Open textbook p.129 and point to the two speaking portraits.",
              "Partners point to and read 1 to 7 on the 0–7 kg dial in "
              "textbook p.180."):
        out, changed = adv.strip_adverbial(s)
        assert not changed, s
        assert out == s
