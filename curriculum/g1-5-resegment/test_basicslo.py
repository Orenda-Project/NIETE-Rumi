"""Turning the day's SLO into an objective a child could read out.

Amena, 20 Sep 2026: *"slo codes should cover the SLOs that the lesson states,
support slos make sense, objective is student facing SLO."* That reverses the
earlier design, where a basics row claimed no SLO and carried a skill-worded
sentence of its own instead. The row now states the SLOs of the lesson it is
anchored to, and its objective is one of them, said in the child's voice.

The corpus does not say them in one voice, which is the whole reason this is a
module rather than a format string. Measured across the 676 SLO descriptions
the 366 basics rows are grounded on:

  212 already open "I can" or "I know" -- every Maths and Science one does.
  211 are Urdu, and the Urdu SLO form (`... سکیں`) is already what the child
      can do. Nothing to convert, and converting it would introduce a
      grammatical gender the original does not carry.
  253 are English written as a bare instruction to the teacher: "Use phonetic
      knowledge and rhyme ...", "Recognise sounds, words or phrases ...". Every
      one of the 42 distinct opening words is a verb, so "I can " + a
      lower-cased first letter is safe here in a way it would not be on a
      corpus containing a proper noun.
  129 are empty strings, and 3 are not SLOs at all but a note explaining that
      the chapter roadmap has none ("Chapter roadmap has no dedicated
      word-formation SLO; DERIVED from the نئے الفاظ box ..."). An objective
      reading "I can chapter roadmap has no dedicated ..." is worse than no
      objective, so both are walked past.

The lens is the second sentence: the same SLO, but the way THIS period works
on it. Without it the objective of a number-fluency period and of the book
lesson it sits beside are word for word identical, and the teacher has no way
to tell from the plan that one is a drill.
"""
import unittest

import basicslo


class TheObjectiveIsTheDaysOwnSLO(unittest.TestCase):

    def test_an_i_can_slo_is_used_as_it_stands(self):
        # Every Maths and Science description in the corpus is already
        # written this way. Rewriting it would only risk changing it.
        out = basicslo.objective(
            "number_fluency",
            ["I can count numbers up to and across 999 (3-digit numbers) "
             "forwards and backwards, beginning from zero or one, or from "
             "any given number."])
        self.assertIn("I can count numbers up to and across 999", out)

    def test_an_i_know_slo_is_left_alone_too(self):
        # grade_3_math_ch7_nf1. First person already; not "I can".
        out = basicslo.objective(
            "number_fluency",
            ["I know that hundredths arise by dividing an object, single-digit "
             "numbers and quantities into hundred equal parts."])
        self.assertIn("I know that hundredths arise", out)
        self.assertNotIn("I can I know", out)

    def test_a_teacher_worded_english_slo_is_turned_into_the_childs_voice(self):
        # grade_1_english_ch2_cl1's lead SLO, verbatim.
        out = basicslo.objective(
            "communicative",
            ["Use phonetic knowledge and rhyme to attempt to write and spell "
             "simple words (e.g., bat, cat, is, was etc)."])
        self.assertTrue(out.startswith("I can use phonetic knowledge and rhyme"))

    def test_only_the_first_letter_moves(self):
        # "Roman" is a proper noun and stays capitalised. grade_3_math_ch1_wp1.
        out = basicslo.objective("word_problem",
                                 ["Read and write Roman numerals up to 20."])
        self.assertTrue(out.startswith("I can read and write Roman numerals"))
        self.assertIn("Roman", out)

    def test_an_urdu_slo_is_not_translated_or_re_voiced(self):
        # The `... سکیں` form already states what the child can do, and Urdu
        # first-person singular is gendered -- "I" would pick a gender the
        # SLO does not.
        urdu = "نظم سن کر سوالات کے زبانی جوابات دے سکیں اور سرگرمیوں میں حصہ لے سکیں۔"
        out = basicslo.objective("arkaan_saazi", [urdu])
        self.assertIn(urdu, out)
        self.assertNotIn("I can", out)

    def test_the_lead_slo_is_the_one_the_day_states_first(self):
        out = basicslo.objective("number_fluency",
                                 ["I can order numbers.", "I can add tens."])
        self.assertIn("I can order numbers", out)
        self.assertNotIn("I can add tens", out)


class ThingsThatAreNotAnSLO(unittest.TestCase):

    def test_an_empty_description_is_walked_past(self):
        # 129 of the 676 are empty strings.
        out = basicslo.objective("phonics", ["", "  ", "Recognise the sound."])
        self.assertTrue(out.startswith("I can recognise the sound"))

    def test_a_roadmap_note_is_not_read_as_an_objective(self):
        # grade_5_urdu_ch3_as1: the first description explains that the
        # chapter has no SLO. The second is a real one.
        out = basicslo.objective(
            "arkaan_saazi",
            ["Chapter roadmap has no dedicated vocabulary SLO; DERIVED from "
             "the نئے الفاظ box (تکمیل، مذمت).",
             "۵۔ سادہ جملے بنا سکیں۔"])
        self.assertIn("سادہ جملے", out)
        self.assertNotIn("roadmap", out)

    def test_with_nothing_but_a_roadmap_note_the_lens_stands_alone(self):
        # grade_5_urdu_ch2_cl1 and ch12_as1 are exactly this. The period still
        # has to tell a teacher what it is for.
        out = basicslo.objective(
            "communicative",
            ["Chapter roadmap has no dedicated word-formation SLO; this drill "
             "recurs as a book-wide skill."])
        self.assertEqual(out, basicslo.LENS["communicative"])

    def test_no_descriptions_at_all_leaves_the_lens(self):
        self.assertEqual(basicslo.objective("phonics", []),
                         basicslo.LENS["phonics"])

    def test_a_derived_provenance_bracket_is_stripped_from_the_objective(self):
        # The corpus marks a derived SLO by appending a bracket to the
        # sentence. It is a note to us, not something a child reads.
        out = basicslo.objective(
            "communicative",
            ["Fill in missing information to complete simple sentences. "
             "[DERIVED — opener has no explicit writing SLO]"])
        self.assertNotIn("DERIVED", out)
        self.assertTrue(out.startswith("I can fill in missing information"))


class TheLensSaysWhatThisPeriodDoesWithIt(unittest.TestCase):

    def test_every_basics_skill_has_one(self):
        import basicseg
        for skill in basicseg.SLOT:
            self.assertIn(skill, basicslo.LENS)

    def test_the_objective_carries_both_the_slo_and_the_lens(self):
        out = basicslo.objective("number_fluency", ["I can add tens."])
        self.assertIn("I can add tens", out)
        self.assertIn(basicslo.LENS["number_fluency"], out)

    def test_an_slo_without_a_full_stop_still_ends_before_the_lens(self):
        out = basicslo.objective("phonics", ["Recognise the sound"])
        self.assertIn("I can recognise the sound. ", out)

    def test_an_urdu_slo_keeps_its_own_full_stop(self):
        out = basicslo.objective("arkaan_saazi", ["سادہ جملے بنا سکیں۔"])
        self.assertIn("سکیں۔ ", out)

    def test_the_urdu_lens_is_in_urdu(self):
        # An Urdu objective that switches to English halfway is not one a
        # child reads. `arkaan_saazi` is the only Urdu-only skill.
        self.assertNotIn("I ", basicslo.LENS["arkaan_saazi"])

    def test_an_unknown_skill_has_no_lens_rather_than_a_borrowed_one(self):
        self.assertIsNone(basicslo.objective("pictorial", ["I can add tens."]))


if __name__ == "__main__":
    unittest.main()
