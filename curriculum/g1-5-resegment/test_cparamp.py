"""The A in CPA — which bridging days are actually abstract.

The segmentation corpus never once uses `abstract` as a skill type. Every
day whose cpa_phase reads "abstract" was labelled `pictorial_abstract`, all
245 of them, so the ramp the Maths tab prints stopped at the bridge and the
FLN Coverage tab showed Abstract at 0.0% in all five grades (bd-f2z81). The
destination of the ramp was invisible to the teacher reading it.

The rule here recovers the distinction the source collapsed, from the
textbook's own section names, and it is deliberately conservative: a day is
only called abstract when it works in symbols alone AND the chapter has
already crossed the bridge. You bridge once; after that you practise in
symbols. A day with a section we do not recognise keeps its old label,
because no evidence is not the same as evidence of abstraction.
"""
import os
import unittest

import cparamp

HERE = os.path.dirname(os.path.abspath(__file__))
SEG = os.path.join(HERE, "corpus", "seg")
HAVE_CORPUS = os.path.isdir(SEG)

PA = "pictorial_abstract"


def day(section, chapter=1, skill=PA, label="Day 1"):
    return {"day_label": label, "chapter_number": chapter, "topic": "t",
            "skill_type": skill, "cpa_phase": "abstract", "section": section}


def run(*days):
    out, n = cparamp.name_abstract(list(days), "Maths")
    return [d["skill_type"] for d in out], n


class TheBridgeIsCrossedOnce(unittest.TestCase):

    def test_symbolic_practice_after_the_bridge_is_abstract(self):
        got, n = run(day("Discovery Playground + Skill Sharpener"),
                     day("Skill Sharpener + Copy Work"))
        self.assertEqual(got, [PA, "abstract"])
        self.assertEqual(n, 1)

    def test_the_first_bridging_day_of_a_chapter_stays_the_bridge(self):
        """Even symbol-only: it is where the picture meets the numeral."""
        got, _n = run(day("Skill Sharpener"), day("Skill Sharpener"))
        self.assertEqual(got, [PA, "abstract"])

    def test_each_chapter_crosses_its_own_bridge(self):
        got, _n = run(day("Skill Sharpener", chapter=1),
                      day("Skill Sharpener", chapter=1),
                      day("Skill Sharpener", chapter=2),
                      day("Skill Sharpener", chapter=2))
        self.assertEqual(got, [PA, "abstract", PA, "abstract"])


class OnlySymbolOnlyDaysQualify(unittest.TestCase):

    def test_a_day_that_still_uses_pictures_stays_the_bridge(self):
        got, _n = run(day("Skill Sharpener"),
                      day("Discovery Playground + Skill Sharpener"))
        self.assertEqual(got, [PA, PA])

    def test_a_hands_on_section_is_never_abstract(self):
        got, _n = run(day("Skill Sharpener"),
                      day("Leap and Learn + Copy Work"))
        self.assertEqual(got, [PA, PA])

    def test_an_unrecognised_section_keeps_its_label(self):
        """No evidence is not evidence of abstraction."""
        got, n = run(day("Skill Sharpener"), day("Rounding Decimals"))
        self.assertEqual(got, [PA, PA])
        self.assertEqual(n, 0)

    def test_a_day_with_no_section_keeps_its_label(self):
        got, _n = run(day("Skill Sharpener"), day(None), day(""))
        self.assertEqual(got, [PA, PA, PA])


class NothingElseIsTouched(unittest.TestCase):

    def test_the_other_cpa_stages_are_left_alone(self):
        for skill in ("concrete", "pictorial", "word_problem", "revision",
                      "assessment", "number_fluency"):
            got, n = run(day("Skill Sharpener", skill=skill),
                         day("Skill Sharpener", skill=skill))
            self.assertEqual(got, [skill, skill])
            self.assertEqual(n, 0)

    def test_no_other_subject_has_a_cpa_ramp(self):
        for subject in ("English", "Urdu", "Science"):
            days = [day("Skill Sharpener"), day("Skill Sharpener")]
            out, n = cparamp.name_abstract(days, subject)
            self.assertEqual([d["skill_type"] for d in out], [PA, PA])
            self.assertEqual(n, 0)

    def test_the_source_cpa_phase_is_not_rewritten(self):
        out, _n = cparamp.name_abstract(
            [day("Skill Sharpener"), day("Skill Sharpener")], "Maths")
        self.assertEqual([d["cpa_phase"] for d in out],
                         ["abstract", "abstract"])

    def test_a_non_teaching_row_is_not_counted_as_a_bridge(self):
        """A chapter header carries no day_label and must not use up the
        chapter's one bridge, or the first real day would be promoted."""
        header = {"chapter_number": 1, "skill_type": PA,
                  "section": "Skill Sharpener"}
        out, n = cparamp.name_abstract([header, day("Skill Sharpener")],
                                       "Maths")
        self.assertEqual([d["skill_type"] for d in out], [PA, PA])
        self.assertEqual(n, 0)


@unittest.skipUnless(HAVE_CORPUS, "corpus/ is gitignored and not present")
class TheRampReachesAbstractInEveryGrade(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        import collections
        import glob
        import stageb
        cls.by_grade = collections.defaultdict(collections.Counter)
        for path in sorted(glob.glob(os.path.join(SEG, "grade_*.json"))):
            _stem, grade, subject, _meta, segs = stageb.load_book(path)
            if subject != "Maths":
                continue
            for seg in segs:
                if seg.get("day_label"):
                    cls.by_grade[grade][seg.get("skill_type")] += 1

    def test_every_grade_reaches_abstract(self):
        for grade in (1, 2, 3, 4, 5):
            self.assertGreater(self.by_grade[grade]["abstract"], 0,
                               f"Grade {grade} never reaches abstract")

    def test_the_bridge_still_carries_more_days_than_the_destination(self):
        """Promotion must not swallow the bridge stage it came from."""
        for grade in (1, 2, 3, 4, 5):
            counts = self.by_grade[grade]
            self.assertGreater(counts[PA], counts["abstract"],
                               f"Grade {grade} has more abstract than bridge")

    def test_the_ramp_is_not_rewritten_wholesale(self):
        promoted = sum(c["abstract"] for c in self.by_grade.values())
        self.assertTrue(40 <= promoted <= 90, f"{promoted} days promoted")


if __name__ == "__main__":
    unittest.main()
