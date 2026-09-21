# -*- coding: utf-8 -*-
"""The Bloom re-rate: the SLO's own verb decides, not the skill type.

The column shipped as a relabel of `Skill type` -- 83.4% of segments carried
the modal Bloom for their skill type, eleven skill types were 99-100%
deterministic, and `remember` appeared on 22 of 2,039 segments because no
skill type mapped to it. Urdu had none at all across five books, so Grade 1
qaida -- recognising letter shapes -- could not be rated `remember` even in
principle. These tests pin the rating to the words of the SLO.
"""
import unittest

import bloom


class TheVerbDecides(unittest.TestCase):

    def test_recognise_and_repeat_is_remember(self):
        # Rated `understand` on E-01-RD-01 and `apply` on E-01-OC-03 -- the
        # same sentence, two levels, which is how we know it was not read.
        level, why = bloom.rate(
            "Recognise sounds, words or phrases in the language and repeat them",
            "phonics")
        self.assertEqual(level, "remember")
        self.assertEqual(why, "verb")

    def test_identical_text_rates_identically(self):
        text = "Recognise sounds, words or phrases in the language and repeat them."
        a, _ = bloom.rate(text, "reading_comprehension")
        b, _ = bloom.rate(text, "oral_communication")
        self.assertEqual(a, b)

    def test_naming_and_sorting_is_not_create(self):
        # E-01-VO-02 was rated `create` for naming objects in pictures.
        level, _ = bloom.rate(
            "Name various objects through pictures to sort, group, "
            "pick the odd one out", "vocabulary_grammar")
        self.assertNotEqual(level, "create")

    def test_the_hardest_verb_in_the_sentence_wins(self):
        # The day asks them to recognise AND use AND classify; its demand is
        # the hardest thing it asks, not the first thing it names.
        level, _ = bloom.rate(
            "Recognise and use naming words from the environment and "
            "classify them into different categories", "vocabulary_grammar")
        self.assertEqual(level, "apply")

    def test_solving_is_apply(self):
        self.assertEqual(bloom.rate("I can solve two-step word problems",
                                    "word_problem")[0], "apply")

    def test_designing_an_investigation_is_create(self):
        self.assertEqual(bloom.rate("I can design a fair test to compare two soils",
                                    "investigate_handson")[0], "create")

    def test_justifying_is_evaluate(self):
        self.assertEqual(bloom.rate("I can justify which method is better",
                                    "concept_build")[0], "evaluate")


class TheUrduLexicon(unittest.TestCase):

    def test_recognising_letter_shapes_is_remember(self):
        # U-01-RD-01, rated `apply`. This is qaida: letter recognition.
        level, why = bloom.rate(
            u"حروف کی آدھی اشکال کو پہچان سکیں۔", "arkaan_saazi")
        self.assertEqual(level, "remember")
        self.assertEqual(why, "verb")

    def test_explaining_is_understand(self):
        self.assertEqual(bloom.rate(u"حمد کی تعریف بیان کر سکیں۔",
                                    "tafheem")[0], "understand")

    def test_writing_your_own_introduction_is_create(self):
        self.assertEqual(bloom.rate(
            u"اپنا مختصر تعارف لکھ سکیں۔ تخلیقی", "takhleeqi_likhai")[0], "create")

    def test_an_urdu_row_can_reach_remember(self):
        # Zero `remember` across five Urdu books was the original symptom.
        self.assertEqual(bloom.rate(u"نئے الفاظ یاد کر سکیں۔",
                                    "alfaaz_maani")[0], "remember")


class TheSkillTypeIsOnlyATieBreak(unittest.TestCase):

    def test_a_verbless_description_falls_back_to_the_skill_type(self):
        level, why = bloom.rate("Chapter 3, pages 40-44", "concept_build")
        self.assertEqual(level, "understand")
        self.assertEqual(why, "skill")

    def test_a_verbless_description_with_an_unknown_skill_stays_dark(self):
        level, why = bloom.rate("Chapter 3, pages 40-44", "something_new")
        self.assertEqual(level, "")
        self.assertEqual(why, "none")

    def test_the_skill_type_never_overrides_a_verb(self):
        # `duhrai` is 100% `understand` in the shipped data. A revision day
        # that asks children to compose still asks them to compose.
        level, why = bloom.rate("Compose a short poem of your own", "duhrai")
        self.assertEqual(level, "create")
        self.assertEqual(why, "verb")


class TheLevelsThemselves(unittest.TestCase):

    def test_they_are_the_six_in_hierarchy_order(self):
        self.assertEqual(bloom.LEVELS, ("remember", "understand", "apply",
                                        "analyze", "evaluate", "create"))

    def test_every_lexicon_entry_names_a_real_level(self):
        for verb, level in bloom.LEXICON.items():
            self.assertIn(level, bloom.LEVELS, verb)

    def test_every_skill_fallback_names_a_real_level(self):
        for skill, level in bloom.BY_SKILL.items():
            self.assertIn(level, bloom.LEVELS, skill)

    def test_remember_is_reachable_from_the_lexicon(self):
        self.assertTrue(any(v == "remember" for v in bloom.LEXICON.values()))



class TheUrduStemsDoNotMatchMidWord(unittest.TestCase):
    """`لے` (take) lives inside `جملے` (sentences), so substring
    matching rated 'change simple sentences' as remember. Urdu inflects by
    suffixing, so a stem may open a word and never sit inside one."""

    def test_changing_sentences_is_not_remember(self):
        d = u"سادہ جملے تبدیل کر سکیں۔"
        self.assertNotEqual(bloom.rate(d, "")[0], "remember")

    def test_a_stem_that_opens_a_word_still_counts(self):
        # پہچانیں is پہچان plus a suffix.
        d = u"حروف کی آدھی اشکال پہچانیں۔"
        self.assertEqual(bloom.rate(d, "")[0], "remember")

    def test_writing_is_apply_not_dark(self):
        d = u"املا کو صحت کے ساتھ تحریر کر سکیں۔"
        self.assertEqual(bloom.rate(d, "")[0], "apply")


class RecogniseAnAbstractionIsUnderstanding(unittest.TestCase):
    """`Recognise the letter A` is recall; `recognise the advantages of
    microorganisms` is comprehension. The verb is identical, so the object
    has to decide, or the rote-risk column calls whole units rote."""

    def test_recognising_an_advantage_is_understand(self):
        d = "I can recognise the advantages of microorganisms."
        self.assertEqual(bloom.rate(d, "")[0], "understand")

    def test_identify_that_a_claim_holds_is_understand(self):
        d = "I can identify that some animals have an exoskeleton."
        self.assertEqual(bloom.rate(d, "")[0], "understand")

    def test_recognising_how_something_works_is_understand(self):
        d = "I can recognise how electrical energy can be transformed."
        self.assertEqual(bloom.rate(d, "")[0], "understand")

    def test_identifying_a_purpose_is_understand(self):
        d = "Identify the main purpose of a text."
        self.assertEqual(bloom.rate(d, "")[0], "understand")

    def test_a_concrete_object_stays_remember(self):
        self.assertEqual(
            bloom.rate("I can recognise the items in the first aid box.", "")[0],
            "remember")
        self.assertEqual(
            bloom.rate("I can name days of the week.", "")[0], "remember")



class AVerbAfterADeterminerIsANoun(unittest.TestCase):
    """`in more than one group` is not the verb `group`, and `keep a record`
    is not the verb `record`. English SLOs put the verb first or after `and`,
    never after `a`, `the` or a number."""

    def test_one_group_does_not_make_the_day_apply(self):
        d = "I can compare number of objects in more than one group."
        self.assertEqual(bloom.rate(d, "")[0], "understand")

    def test_a_verb_in_verb_position_still_counts(self):
        d = "Sort and group the objects by colour."
        self.assertEqual(bloom.rate(d, "")[0], "apply")

    def test_and_does_not_suppress_the_second_verb(self):
        d = "Recognise and design a new pattern."
        self.assertEqual(bloom.rate(d, "")[0], "create")


if __name__ == "__main__":
    unittest.main()
