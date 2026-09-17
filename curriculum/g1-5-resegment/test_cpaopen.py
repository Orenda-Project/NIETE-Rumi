"""The C in CPA — giving every chapter a day that starts in children's hands.

Grade 4 ran a whole year of Maths without one concrete period: 5-digit place
value, 4-digit multiplication and long division, all in symbols. Grade 3 had
one. Grade 5 has 33, so this was never a seniors-skip-concrete design
(bd-wi85y).

Unlike the abstract end of the ramp, this could NOT be fixed by relabelling.
The Grade 1 and Grade 5 books open a topic with Adventure Begins and Leap and
Learn pages that put real objects, number discs and counters in front of the
child; from Grade 2 on the same sections open with printed prices and
place-value tables instead. A scan of every G2-G4 day found no manipulative
to recover — the hits were all `Disc`overy and the CUBES word-problem
acronym. There was nothing there.

So this rule ADDS a hands-on start where the book gives none, and says so.
The day already exists and keeps its pages, SLO and place in the year — no
period is spent, which matters because the content has to land by 24 December.
What changes is how it opens: counters and straws before the printed page,
which is the anchoring-in-the-book-while-teaching-basics that the whole
revamp is for.

Because this is our addition and not the book's, every day it touches is
marked `concrete_added` with the manipulative named, and that surfaces in the
Flags column. A teacher, a reviewer and the LP writer can all tell our
concrete days from the book's own.

A chapter with no picture or bridge day to convert is left alone. We add a
hands-on start to a day that was going to be taught anyway; we do not turn
the application end of the ramp into its beginning.
"""
import glob
import json
import os
import unittest

import cpaopen
import stageb

HERE = os.path.dirname(os.path.abspath(__file__))
SEG = os.path.join(HERE, "corpus", "seg")
HAVE_CORPUS = os.path.isdir(SEG)


def day(topic, chapter=1, skill="pictorial", label="Day 1", title="Ch"):
    return {"day_label": label, "chapter_number": chapter, "topic": topic,
            "chapter_title": title, "skill_type": skill,
            "cpa_phase": "pictorial", "section": "Leap and Learn"}


def run(*days):
    out, n = cpaopen.open_concrete(list(days), "Maths")
    return [d["skill_type"] for d in out], n


class EveryChapterStartsInChildrensHands(unittest.TestCase):

    def test_a_chapter_with_no_concrete_day_gets_one(self):
        got, n = run(day("Place value"), day("More place value", label="Day 2"))
        self.assertEqual(got, ["concrete", "pictorial"])
        self.assertEqual(n, 1)

    def test_a_chapter_that_already_has_concrete_is_left_alone(self):
        got, n = run(day("Counting bears", skill="concrete"),
                     day("Place value", label="Day 2"))
        self.assertEqual(got, ["concrete", "pictorial"])
        self.assertEqual(n, 0)

    def test_each_chapter_is_judged_on_its_own(self):
        got, n = run(day("Place value", chapter=1),
                     day("Sharing sweets", chapter=2, skill="concrete"),
                     day("Dividing", chapter=2, skill="pictorial"),
                     day("Fractions", chapter=3))
        self.assertEqual(got, ["concrete", "concrete", "pictorial", "concrete"])
        self.assertEqual(n, 2)

    def test_it_is_the_first_teachable_day_that_opens_the_chapter(self):
        got, _n = run(day("Word problems", skill="word_problem"),
                      day("Place value", label="Day 2"),
                      day("More", label="Day 3"))
        self.assertEqual(got, ["word_problem", "concrete", "pictorial"])

    def test_a_bridge_day_can_open_a_chapter_that_has_nothing_else(self):
        got, n = run(day("Place value", skill="pictorial_abstract"))
        self.assertEqual(got, ["concrete"])
        self.assertEqual(n, 1)


class WhatIsNeverConverted(unittest.TestCase):

    def test_revision_and_assessment_days_are_not_touched(self):
        for skill in ("revision", "assessment"):
            got, n = run(day("Chapter review", skill=skill))
            self.assertEqual(got, [skill])
            self.assertEqual(n, 0)

    def test_a_chapter_of_only_word_problems_is_left_dark(self):
        """We add a hands-on start to a day that was going to be taught
        anyway. We do not turn the application end of the ramp into its
        beginning."""
        got, n = run(day("Word problems", skill="word_problem"),
                     day("More word problems", skill="word_problem",
                         label="Day 2"))
        self.assertEqual(got, ["word_problem", "word_problem"])
        self.assertEqual(n, 0)

    def test_a_chapter_header_is_not_a_teaching_day(self):
        header = {"chapter_number": 1, "skill_type": "pictorial",
                  "topic": "Place value", "cpa_phase": "pictorial"}
        out, n = cpaopen.open_concrete([header, day("Place value",
                                                    label="Day 1")], "Maths")
        self.assertEqual([d["skill_type"] for d in out],
                         ["pictorial", "concrete"])
        self.assertEqual(n, 1)

    def test_no_other_subject_has_a_cpa_ramp(self):
        for subject in ("English", "Urdu", "Science"):
            out, n = cpaopen.open_concrete([day("Reading")], subject)
            self.assertEqual([d["skill_type"] for d in out], ["pictorial"])
            self.assertEqual(n, 0)


class TheAddedDayIsMarkedAsOurs(unittest.TestCase):

    def only(self, *days):
        out, _n = cpaopen.open_concrete(list(days), "Maths")
        return out[0]

    def test_it_records_that_we_added_it(self):
        self.assertTrue(self.only(day("Place value"))["concrete_added"])

    def test_it_names_what_goes_in_the_childrens_hands(self):
        got = self.only(day("Place value & reading 5-digit numbers"))
        self.assertIn("straws", got["concrete_added"])

    def test_the_manipulative_fits_the_topic(self):
        for topic, want in [("Proper and improper fractions", "paper"),
                            ("Reading & writing time on a clock", "clock"),
                            ("Units of mass: kilograms", "balance"),
                            ("Identifying currency & denominations", "money"),
                            ("Tally charts & pictographs", "sorted"),
                            ("Multiplying by a 1-digit number", "array")]:
            got = self.only(day(topic))
            self.assertIn(want, got["concrete_added"],
                          f"{topic!r} -> {got['concrete_added']!r}")

    def test_an_unfamiliar_topic_still_gets_something_to_hold(self):
        got = self.only(day("Rounding off to the nearest ten"))
        self.assertTrue(got["concrete_added"])

    def test_the_day_really_becomes_a_concrete_day(self):
        """Unlike the abstract rename, this changes what the day IS, so the
        phase moves with it — otherwise Skill Taxonomy counts every added
        day as a data conflict."""
        self.assertEqual(self.only(day("Place value"))["cpa_phase"], "concrete")

    def test_the_books_own_concrete_days_are_never_marked_as_ours(self):
        out, _n = cpaopen.open_concrete([day("Counting bears", skill="concrete")],
                                        "Maths")
        self.assertNotIn("concrete_added", out[0])

    def test_the_flags_column_shows_it_to_the_teacher(self):
        got = self.only(day("Place value"))
        flags = stageb.day_flags(got, {"new_codes": []}, set())
        self.assertIn("concrete opener added", flags)
        self.assertIn(got["concrete_added"], flags)


@unittest.skipUnless(HAVE_CORPUS, "corpus/ is gitignored and not present")
class EveryGradeGetsItsHandsOnWork(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.books = {}
        for path in sorted(glob.glob(os.path.join(SEG, "grade_*.json"))):
            _stem, grade, subject, _meta, segs = stageb.load_book(path)
            if subject == "Maths":
                cls.books[grade] = segs

    def days(self, grade):
        return [s for s in self.books[grade] if s.get("day_label")]

    def test_no_grade_teaches_a_year_without_concrete(self):
        for grade in (1, 2, 3, 4, 5):
            n = sum(1 for d in self.days(grade)
                    if d["skill_type"] == "concrete")
            self.assertGreater(n, 0, f"Grade {grade} has no concrete work")

    def test_grade_four_is_no_longer_the_outlier(self):
        """It ran 5-digit place value, 4-digit multiplication and long
        division entirely in symbols."""
        n = sum(1 for d in self.days(4) if d["skill_type"] == "concrete")
        self.assertGreaterEqual(n, 10, f"Grade 4 has only {n} concrete days")

    def test_every_chapter_that_can_start_in_hands_does(self):
        for grade, segs in self.books.items():
            chapters = {}
            for day in self.days(grade):
                chapters.setdefault(day["chapter_number"], []).append(day)
            for number, days in chapters.items():
                kinds = {d["skill_type"] for d in days}
                if kinds <= {"word_problem", "revision", "assessment"}:
                    continue
                self.assertIn("concrete", kinds,
                              f"G{grade} chapter {number} never starts in hands")

    def test_the_books_own_concrete_days_outnumber_the_ones_we_added(self):
        """A ramp we wrote more of than the book did would be a different
        curriculum, not a fixed one."""
        own = added = 0
        for grade in self.books:
            for day in self.days(grade):
                if day["skill_type"] != "concrete":
                    continue
                added += 1 if day.get("concrete_added") else 0
                own += 0 if day.get("concrete_added") else 1
        self.assertGreater(own, added, f"{added} added vs {own} from the book")

    def test_every_added_day_names_what_the_children_hold(self):
        for grade in self.books:
            for day in self.days(grade):
                kit = day.get("concrete_added")
                if kit:
                    self.assertTrue(kit.strip(), f"G{grade} {day['topic']}")

    def test_no_period_is_spent_adding_them(self):
        """The year has to land by 24 December, so the opener is a day that
        was already being taught, not a new one. Measured against the rule
        itself: Grade 1 legitimately loses rows at the same door, where its
        revision is folded to pay for the Foundations block."""
        total = 0
        for path in sorted(glob.glob(os.path.join(SEG, "grade_*math*.json"))):
            with open(path) as fh:
                raw = json.load(fh)["segments"]
            out, added = cpaopen.open_concrete(raw, "Maths")
            self.assertEqual(len(out), len(raw), f"{path} changed period count")
            total += added
        self.assertGreater(total, 0, "no book gained a hands-on start")

    def test_the_grades_whose_books_already_open_in_hands_are_left_alone(self):
        """Grade 1 opens every chapter with real objects already, so the rule
        has nothing to do there. If it ever starts adding days to Grade 1, it
        is overwriting the book rather than filling a gap in it."""
        for grade in (1, 5):
            marked = [d for d in self.days(grade) if d.get("concrete_added")]
            self.assertEqual(marked, [], f"G{grade} was given days it had")


if __name__ == "__main__":
    unittest.main()
