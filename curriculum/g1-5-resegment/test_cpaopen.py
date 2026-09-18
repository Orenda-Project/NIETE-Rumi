"""The C in CPA — giving every chapter a day that starts in children's hands.

Grade 4 ran a whole year of Maths without one concrete period: 5-digit place
value, 4-digit multiplication and long division, all in symbols. Grade 3 had
one. Grade 5 appeared to have 33 and was skipped on that basis, until the
pages were read: every one of them is a context scene and a worked method,
and the corpus's own `cpa_phase` column calls 28 of them pictorial. The label
came from the section heading, not the book (bd-x2su1). cpatrust drops it
before this rule runs, which is why Grade 5 is tested here as a grade the
rule reaches rather than one it leaves alone.

Unlike the abstract end of the ramp, this could NOT be fixed by relabelling.
The Grade 1 book opens a topic with Adventure Begins and Leap and Learn pages
that really do put objects in front of the child, and says so in its own page
text on 21 of its 36 concrete days; from Grade 2 on the same sections open
with printed prices and place-value tables instead. A scan of every G2-G5 day
found no manipulative to recover — the hits were all `Disc`overy, cube
NUMBERS and the CUBES word-problem acronym. There was nothing there.

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

The corpus-backed half of this suite — what the rule does to Grades 1-5 as
actually segmented — is in test_cpaopen_corpus.py, split off at the
300-line limit.
"""
import unittest

import cpaopen
import stageb


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


if __name__ == "__main__":
    unittest.main()
