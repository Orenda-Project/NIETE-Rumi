"""The same rule, measured against the real books rather than a fixture.

Split out of test_cpaopen.py when that file passed the 300-line limit. The
unit tests there pin the rule's behaviour on days we construct; these ask
what it actually does to Grades 1-5 as segmented, which is the half that
catches a premise going stale — the Grade 5 skip survived as long as it did
because nothing here had ever counted its concrete days against its pages
(bd-x2su1).

Skipped wholesale when `corpus/` is absent: it is gitignored, restricted
NBF/FBISE material, so a clone without it must not fail this suite.
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

    def test_we_add_at_most_one_hands_on_day_to_any_chapter(self):
        """The bound that keeps this a fix rather than a different
        curriculum. It used to be stated as "the book's own concrete days
        outnumber the ones we added", which was true only while Grade 5's 33
        section-name labels were counted as the book's (bd-x2su1). With those
        dropped the book supplies 44 days and this rule adds 45, so the
        honest bound is the per-chapter one: one opener, once, in a chapter
        that had none."""
        for grade in self.books:
            chapters = {}
            for day in self.days(grade):
                if day.get("concrete_added"):
                    chapters[day["chapter_number"]] = \
                        chapters.get(day["chapter_number"], 0) + 1
            for number, n in chapters.items():
                self.assertEqual(n, 1, f"G{grade} ch{number} gained {n} days")

    def test_almost_all_the_books_own_concrete_work_is_grade_one(self):
        """The finding the rule exists for, pinned as a number. Grade 1 opens
        in children's hands 36 times; Grades 2-5 together manage 8. A book
        that started doing this itself would fail here, and should — the rule
        would then be adding days the book had already written."""
        own = {}
        for grade in self.books:
            own[grade] = sum(1 for d in self.days(grade)
                             if d["skill_type"] == "concrete"
                             and not d.get("concrete_added"))
        self.assertEqual(own[1], 36, f"Grade 1 supplies {own[1]}")
        upper = sum(n for g, n in own.items() if g != 1)
        self.assertLess(upper, 12, f"Grades 2-5 now supply {upper} themselves")

    def test_a_fraction_to_decimal_day_gets_the_grid_not_paper_strips(self):
        """First match wins, and `fraction` used to be checked before
        `decimal`, so both Grade 5 chapters that convert BETWEEN the two were
        handed folded paper strips. Strips show halves and thirds; they
        cannot show a hundredth, which is the whole content of those
        chapters. The bug only became reachable once Grade 5 stopped being
        skipped (bd-w1r3k, on bd-x2su1). These are the only two days in the
        whole corpus that name both, so the pair is named here rather than
        left to a rule the next topic could quietly rejoin."""
        seen = 0
        for day in self.days(5):
            topic = (day.get("topic") or "").lower()
            kit = day.get("concrete_added") or ""
            if not kit:                      # not a chapter opener, no kit
                continue
            if "fraction" in topic and ("decimal" in topic
                                        or "percent" in topic):
                seen += 1
                self.assertIn("grid", kit, f"G5 {day['topic']}")
        self.assertEqual(seen, 2, "the two conversion chapters")

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

    def test_grade_one_is_left_alone_because_its_book_really_does_this(self):
        """Grade 1 opens its chapters with real objects already, and its page
        text says so in its own words — "Deal out real counters one-to-one",
        "Use a real balance and counters/stones". The rule has nothing to do
        there. If it ever starts adding days to Grade 1, it is overwriting
        the book rather than filling a gap in it."""
        marked = [d for d in self.days(1) if d.get("concrete_added")]
        self.assertEqual(marked, [], "G1 was given days it had")

    def test_grade_five_is_reached_now_that_its_labels_are_honest(self):
        """Grade 5 used to be excluded from this rule with Grade 1, on the
        strength of 33 concrete days. Not one of those pages puts an object
        in a child's hands; the label came from the section heading "Leap and
        Learn" (bd-x2su1). Dropping it is what lets the board-prep year get
        the same hands-on opener Grades 2-4 have had all along."""
        marked = [d for d in self.days(5) if d.get("concrete_added")]
        self.assertGreater(len(marked), 8, "G5 is still being skipped")


if __name__ == "__main__":
    unittest.main()


if __name__ == "__main__":
    unittest.main()
