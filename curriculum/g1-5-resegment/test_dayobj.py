# -*- coding: utf-8 -*-
"""The objective the DAY puts in front of the child, not the one its code does.

Amena, 21 Sep 2026: *"yes write the sub-objectives"*, answering the measured
finding that G4 English carries 23 SLO codes across 99 teaching days and G5
Urdu 22 across 108. The brief tells the author to target ONE SLO and echo
`slo_refs`, so on 207 days it hands over the same sentence.

The defect is not that the sentence repeats. It is that it is often WRONG
for the day. `E-04-RD-01` "use pre-reading strategies to predict" sits on a
writing day. `U-05-WR-01` "make rhyming words" sits on twenty days of
essays, letters and diaries. `U-05-GR-01` "change past/present/future
sentences" sits on punctuation and on counting. That is Amena's standing
rule from the original brief -- *"make sure the SLO matches the activities,
objectives of the day"* -- failing on 207 days at once.

The SLO codes are not touched. She has said twice not to remove them, and
they are the curriculum's claim, not ours. The day states its own objective
and rolls up to them.

The voice is `basicslo`'s, for `basicslo`'s reasons: English in the child's
own "I can", Urdu in the CLASS's voice, because Urdu's first person singular
carries a grammatical gender the objective has no business choosing for the
child reading it.
"""
import unittest

import dayobj


def seg(ch, idx, skill="tafheem", topic="t"):
    return {"chapter_number": ch, "segment_index": idx,
            "skill_type": skill, "topic": topic}


ENG = {"ch1s1": "I can name the new words in the chapter and use each one "
                "in a sentence of my own.",
       "ch1s2": "I can read 'Pinky has a bad tooth' aloud and say what "
                "happens in it."}


class WhichDaysNeedOne(unittest.TestCase):
    """Teaching days. A revision or assessment day rehearses, it does not
    introduce, and it already says so on its own row."""

    def test_a_teaching_day_needs_one(self):
        self.assertEqual([s["segment_index"] for s in dayobj.teaching(
            [seg(1, 1, "tafheem")])], [1])

    def test_the_five_bookkeeping_spellings_do_not(self):
        rows = [seg(1, i, k) for i, k in enumerate(
            ("duhrai", "jaiza", "revision", "assessment", "review_assess"))]
        self.assertEqual(dayobj.teaching(rows), [])

    def test_grade_5_urdu_says_revision_and_grade_4_says_duhrai(self):
        # The seam dayfold documents: both spellings live in the corpus and
        # both are bookkeeping. Scoping by one string leaves the other in.
        self.assertEqual(dayobj.teaching(
            [seg(1, 1, "revision"), seg(1, 2, "duhrai")]), [])


class TheKeyThatJoinsThem(unittest.TestCase):
    def test_it_is_the_chapter_and_the_segment(self):
        self.assertEqual(dayobj.key(seg(3, 7)), "ch3s7")

    def test_two_chapters_sharing_a_segment_index_do_not_collide(self):
        self.assertNotEqual(dayobj.key(seg(3, 1)), dayobj.key(seg(4, 1)))


class EveryTeachingDayIsCoveredBothWays(unittest.TestCase):
    """A missing objective silently leaves the day on its generic code. A
    spare one means the authoring was done against a corpus that has moved."""

    def test_a_covered_book_has_nothing_to_say(self):
        self.assertEqual(
            dayobj.check([seg(1, 1), seg(1, 2)], ENG), [])

    def test_a_day_with_no_objective_is_named(self):
        out = dayobj.check([seg(1, 1), seg(1, 2), seg(1, 3)], ENG)
        self.assertEqual(len(out), 1)
        self.assertIn("ch1s3", out[0])

    def test_an_objective_with_no_day_is_named(self):
        out = dayobj.check([seg(1, 1)], ENG)
        self.assertEqual(len(out), 1)
        self.assertIn("ch1s2", out[0])

    def test_a_bookkeeping_day_is_not_demanded(self):
        self.assertEqual(dayobj.check(
            [seg(1, 1), seg(1, 2), seg(1, 9, "assessment")], ENG), [])


class NoTwoDaysSayTheSameThing(unittest.TestCase):
    """The whole point. If two days can carry one sentence, the sentence is
    the code again under another name."""

    def test_a_repeated_objective_is_a_failure(self):
        out = dayobj.check([seg(1, 1), seg(1, 2)],
                           {"ch1s1": ENG["ch1s1"], "ch1s2": ENG["ch1s1"]})
        self.assertEqual(len(out), 1)
        self.assertIn("ch1s2", out[0])

    def test_and_it_says_which_day_it_repeats(self):
        out = dayobj.check([seg(1, 1), seg(1, 2)],
                           {"ch1s1": ENG["ch1s1"], "ch1s2": ENG["ch1s1"]})
        self.assertIn("ch1s1", out[0])


class TheChildsVoice(unittest.TestCase):
    """basicslo's rule, and basicslo's reasons."""

    def test_english_opens_in_the_childs_own_i_can(self):
        out = dayobj.check([seg(1, 1)], {"ch1s1": "Students will read the poem."})
        self.assertTrue(any("I can" in c for c in out), out)

    def test_urdu_speaks_as_the_class(self):
        self.assertEqual(dayobj.check(
            [seg(1, 1, "tafheem")],
            {"ch1s1": u"آج ہم نظم پڑھ کر اس کے سوالوں کے جواب دیتے ہیں۔"}), [])

    def test_urdu_in_the_singular_picks_a_gender_for_the_child(self):
        # "سکتا ہوں" is male, "سکتی ہوں" female. The objective has no
        # business choosing, so the class voice is the only one allowed.
        out = dayobj.check([seg(1, 1)],
                           {"ch1s1": u"میں نظم پڑھ سکتا ہوں۔"})
        self.assertTrue(out)

    def test_urdu_is_not_asked_for_an_english_i_can(self):
        out = dayobj.check([seg(1, 1)],
                           {"ch1s1": u"آج ہم نئے الفاظ سیکھتے ہیں۔"})
        self.assertEqual(out, [])


class ASentenceAChildCanBeReadAloud(unittest.TestCase):
    def test_it_ends_like_a_sentence(self):
        out = dayobj.check([seg(1, 1)], {"ch1s1": "I can read the poem"})
        self.assertTrue(out)

    def test_the_urdu_full_stop_counts(self):
        self.assertEqual(dayobj.check(
            [seg(1, 1)], {"ch1s1": u"آج ہم نئے الفاظ سیکھتے ہیں۔"}), [])

    def test_an_empty_objective_is_not_an_objective(self):
        self.assertTrue(dayobj.check([seg(1, 1)], {"ch1s1": "   "}))

    def test_a_paragraph_is_not_an_objective(self):
        out = dayobj.check([seg(1, 1)], {"ch1s1": "I can " + "x " * 120 + "."})
        self.assertTrue(any("long" in c for c in out), out)


class WritingItOntoTheCorpus(unittest.TestCase):
    def test_the_day_carries_it(self):
        rows = [seg(1, 1), seg(1, 2)]
        self.assertEqual(dayobj.apply(rows, ENG), 2)
        self.assertEqual(rows[0]["objective"], ENG["ch1s1"])

    def test_a_bookkeeping_day_is_left_exactly_as_it_was(self):
        rows = [seg(1, 9, "assessment")]
        dayobj.apply(rows, ENG)
        self.assertNotIn("objective", rows[0])

    def test_the_slo_codes_are_never_touched(self):
        # Amena, twice: "dont remove the SLOs pls". The objective rolls up
        # to the code; it does not replace it.
        rows = [dict(seg(1, 1), slo_codes=["E-04-RD-01"])]
        dayobj.apply(rows, ENG)
        self.assertEqual(rows[0]["slo_codes"], ["E-04-RD-01"])

    def test_re_applying_is_not_a_second_edit(self):
        rows = [seg(1, 1), seg(1, 2)]
        dayobj.apply(rows, ENG)
        self.assertEqual(dayobj.apply(rows, ENG), 2)
        self.assertEqual(rows[0]["objective"], ENG["ch1s1"])


if __name__ == "__main__":
    unittest.main()


class TheEnvelopeCarriesIt(unittest.TestCase):
    """The author is the whole audience. An objective the envelope drops is
    an objective that only the sheet ever saw."""

    def envelope(self, **kw):
        import cbrief
        s = dict(seg(2, 3, "writing"), blooms="create", duration_min=30, **kw)
        return cbrief._envelope(s, [], {"grade": 4, "subject": "English",
                                        "stem": "grade_4_english",
                                        "chapter_title": "c"}, 1, 9)

    def test_the_day_states_its_own_objective(self):
        env = self.envelope(objective="I can write a recipe for biryani.")
        self.assertEqual(env["objective"], "I can write a recipe for biryani.")

    def test_a_day_with_none_written_says_so_rather_than_inventing_one(self):
        # Dark stages stay dark. None is a fact the author can act on; a
        # borrowed SLO sentence is the defect this module exists to fix.
        self.assertIsNone(self.envelope()["objective"])

    def test_the_slo_codes_still_travel_beside_it(self):
        env = self.envelope(objective="I can write a recipe for biryani.",
                            slo_codes=["E-04-WR-01"])
        self.assertEqual(env["slo_refs"], ["E-04-WR-01"])
