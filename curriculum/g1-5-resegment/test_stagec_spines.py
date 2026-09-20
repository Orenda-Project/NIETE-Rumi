# -*- coding: utf-8 -*-
"""Every canonical move spine must be shippable before any row uses it.

A spine is a pedagogical claim about how a skill type spends 40 minutes.
Writing 1,657 of them by hand is 1,657 chances to breach the period; naming
ten shapes and checking each one mechanically is one chance, taken here.
"""
import unittest

import stagec
import stagec_spines as sp


class EverySpineIsShippable(unittest.TestCase):
    def test_each_spine_passes_the_stage_c_gate(self):
        for name, band in sp.all_spines():
            cell = stagec.format_moves(sp.SPINES[(name, band)])
            self.assertEqual(stagec.check_moves(cell), [],
                             "%s/%s: %s" % (name, band, stagec.check_moves(cell)))

    def test_no_spine_exceeds_the_teacher_primary_ceiling(self):
        for name, band in sp.all_spines():
            tp = stagec.teacher_primary_min(sp.SPINES[(name, band)])
            self.assertLessEqual(tp, stagec.TEACHER_PRIMARY_CEILING,
                                 "%s/%s is teacher-led at %d min" % (name, band, tp))

    def test_every_shape_exists_in_both_grade_bands(self):
        shapes = {n for n, _ in sp.all_spines()}
        for shape in shapes:
            self.assertIn((shape, "G1-2"), sp.SPINES, shape)
            self.assertIn((shape, "G3-5"), sp.SPINES, shape)


class EverySkillTypeInTheSheetIsMapped(unittest.TestCase):
    """The live tabs carry exactly these skill types. An unmapped one must
    raise, never silently fall back to a generic shape."""

    LIVE = {
        "English": ("Reading comprehension", "Vocabulary & grammar", "Writing",
                    "Oral communication", "Pre-reading", "Phonics"),
        "Urdu": (u"بلند خوانی · Reading aloud",
                 u"تفہیم · Comprehension",
                 u"جائزہ · Assessment",
                 u"قواعد · Grammar",
                 u"تخلیقی لکھائی · Creative writing",
                 u"الفاظ و معانی · Vocabulary",
                 u"ارکان سازی · Syllables"),
        "Maths": (u"Pictorial → Abstract", "Pictorial", "Concrete",
                  "Word problem", "Abstract"),
        "Science": ("Concept build", "Investigate", "Engage", "Apply & connect"),
    }

    def test_every_live_skill_type_resolves_to_a_shape(self):
        for subject, types in self.LIVE.items():
            for t in types:
                self.assertIn(sp.shape_for(t, subject), sp.SHAPES,
                              "%s / %s" % (subject, t))

    def test_an_unknown_skill_type_raises_rather_than_guessing(self):
        with self.assertRaises(KeyError):
            sp.shape_for("Interpretive dance", "English")

    def test_assessment_and_review_rows_get_their_own_shapes(self):
        self.assertEqual(sp.shape_for_kind("assessment"), "assessment_day")
        self.assertEqual(sp.shape_for_kind("review"), "review_day")
        self.assertIsNone(sp.shape_for_kind("chapter_header"))


class TheGradeBandRamp(unittest.TestCase):
    def test_grades_one_and_two_are_the_slow_band(self):
        self.assertEqual(sp.band(1), "G1-2")
        self.assertEqual(sp.band(2), "G1-2")
        self.assertEqual(sp.band(3), "G3-5")
        self.assertEqual(sp.band(5), "G3-5")

    def test_the_younger_band_never_explains_for_longer(self):
        """A G1 child cannot sit through more teacher exposition than a G5 one."""
        for shape in sp.SHAPES:
            young = sum(m for p, m in sp.SPINES[(shape, "G1-2")] if p == "explain")
            older = sum(m for p, m in sp.SPINES[(shape, "G3-5")] if p == "explain")
            self.assertLessEqual(young, older, shape)

    def test_the_younger_band_moves_at_least_as_often(self):
        """Shorter attention spans mean more, shorter moves -- never fewer."""
        for shape in sp.SHAPES:
            self.assertGreaterEqual(len(sp.SPINES[(shape, "G1-2")]),
                                    len(sp.SPINES[(shape, "G3-5")]), shape)


class TheOralShapesClearTheFloor(unittest.TestCase):
    def test_oral_shapes_carry_enough_child_production(self):
        for shape in ("oral_heavy", "decoding", "composition"):
            for b in ("G1-2", "G3-5"):
                cell = stagec.format_moves(sp.SPINES[(shape, b)])
                self.assertEqual(
                    stagec.check_oral_floor("Oral communication", "pair", cell), [],
                    "%s/%s" % (shape, b))


if __name__ == "__main__":
    unittest.main()
