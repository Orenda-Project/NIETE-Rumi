"""The Grade 1 Foundations block, as the allocator builds it.

Six weeks of integrated FLN work at the top of Grade 1, and the compression
of every chapter's close that pays for them. Named `_alloc` because
test_foundations.py already holds the RENDERING side of the same block —
colour, legend, the Basics count, the overview sentence. This file is the
arithmetic: which weeks the book may not use, what fills them instead, and
the promise that funding the block does not quietly delete 33 periods of
the book to do it.
"""
import unittest

import foundations
import ramp
import skills


def seg(ch, skill="reading"):
    return {"chapter_number": ch, "skill_type": skill}


class FoundationsBlock(unittest.TestCase):
    """Children reach Grade 1 with no ECE at all. The first six weeks are
    integrated FLN work — routines and oral language, then rhyme, syllable,
    initial sound and print concepts, pencil control and counting, then
    consolidation. They are not Chapter 1 taught slowly; they are a phase
    the book has no page for, so the book does not start until week seven."""

    def sizes(self, subject):
        return ramp._week_sizes(subject, 1)

    def block(self, subject):
        return sum(self.sizes(subject)[:6])

    def test_grade_1_is_the_only_grade_with_a_block(self):
        self.assertEqual(set(foundations.FOUNDATION_WEEKS), {1})
        self.assertEqual(foundations.FOUNDATION_WEEKS[1], (0, 1, 2, 3, 4, 5))

    def test_no_book_period_falls_inside_the_block(self):
        segments = [seg(1) for _ in range(110)]
        periods, _st = ramp.allocate(1, "English", segments, {1})
        inside = periods[:self.block("English")]
        self.assertEqual([p for p in inside
                          if p["kind"] in ("book", "omitted")], [])

    def test_the_block_fills_the_first_six_weeks_whole(self):
        segments = [seg(1) for _ in range(110)]
        periods, stats = ramp.allocate(1, "English", segments, {1})
        n = self.block("English")
        self.assertEqual(stats["foundations"], n)
        self.assertTrue(all(p["kind"] == "foundations" for p in periods[:n]))

    def test_grade_2_gets_no_block_and_keeps_its_onramp(self):
        segments = [seg(1) for _ in range(110)]
        periods, stats = ramp.allocate(2, "English", segments, {1})
        self.assertEqual(stats["foundations"], 0)
        self.assertNotIn("foundations", [p["kind"] for p in periods])
        self.assertGreater(stats["onramp"], 0)

    def test_the_rotation_walks_the_progression_one_week_at_a_time(self):
        for subject in ("English", "Urdu", "Maths"):
            segments = [seg(1) for _ in range(110)]
            periods, _st = ramp.allocate(1, subject, segments, {1})
            i, seen = 0, []
            for size in self.sizes(subject)[:6]:
                week = periods[i:i + size]
                i += size
                self.assertEqual(len({p["skill"] for p in week}), 1,
                                 "%s week is not one phase" % subject)
                seen.append(week[0]["skill"])
            self.assertEqual(seen, list(foundations.FOUNDATION[subject]))

    def test_every_foundation_skill_is_one_the_tab_can_paint(self):
        # An unknown key renders white and unlabelled, and the KEY block is
        # built from skills.ORDER, so a key outside it vanishes from the
        # legend while its chips go on appearing in the grid.
        for subject, keys in foundations.FOUNDATION.items():
            for key in keys:
                self.assertIn(skills.canonical(key, subject),
                              [skills.canonical(k, subject)
                               for k in skills.ORDER[subject]],
                              "%s: %s" % (subject, key))

    def test_the_block_is_not_stamped_with_chapter_1(self):
        # `_anchor`'s backward pass gives a chapterless period the chapter of
        # the next book period, so the whole block read as "Chapter 1" — six
        # weeks of a chapter nobody had opened. The block is a phase before
        # the book, not the book's first chapter.
        segments = [seg(1) for _ in range(110)]
        periods, _st = ramp.allocate(1, "English", segments, {1})
        for p in periods[:self.block("English")]:
            self.assertIsNone(p["chapter"], "foundations period was anchored")
            self.assertFalse(p.get("anchored"))

    def test_anchor_leaves_a_foundations_period_alone(self):
        periods = [{"chapter": None, "skill": "communicative",
                    "kind": "foundations"},
                   {"chapter": 1, "skill": "phonics", "kind": "book"}]
        ramp._anchor(periods)
        self.assertIsNone(periods[0]["chapter"])
        self.assertFalse(periods[0].get("anchored"))

    def test_anchor_still_back_fills_an_ordinary_basics_period(self):
        periods = [{"chapter": None, "skill": "phonics", "kind": "onramp"},
                   {"chapter": 1, "skill": "phonics", "kind": "book"}]
        ramp._anchor(periods)
        self.assertEqual(periods[0]["chapter"], 1)
        self.assertTrue(periods[0]["anchored"])


class TheBlockIsPaidForAtTheLoadDoor(unittest.TestCase):
    """Six weeks of Grade 1 cost 99 periods and the year's whole spare is 66,
    so the block has to be funded, not wished for. Every Grade 1 chapter ends
    in two or three close periods — revision, revision, assessment — and
    collapsing each chapter's close to a single period buys back exactly what
    the block costs. A block that lands with `dropped > 0` is not a block,
    it is 33 periods of the book quietly deleted."""

    def book(self, name):
        import os
        import fde
        import stageb
        here = os.path.dirname(os.path.abspath(__file__))
        stem, _g, subject, _m, segments = stageb.load_book(
            os.path.join(here, "corpus", "seg", name + ".json"))
        rec = fde.load(os.path.join(here, "corpus", "fde"), stem)
        return subject, segments, (set(rec["chapters"]) if rec else None)

    def test_the_real_grade_1_books_lose_nothing_to_the_block(self):
        for name in ("grade_1_english", "grade_1_maths", "grade_1_urdu"):
            subject, segments, syllabus = self.book(name)
            _periods, st = ramp.allocate(1, subject, segments, syllabus)
            self.assertEqual(st["dropped"], 0, "%s dropped %d periods"
                             % (name, st["dropped"]))

    def test_the_allocator_places_exactly_what_it_is_given(self):
        # Paying the bill is dayfold's job at the load door. If the allocator
        # compressed as well, the calendar would count a Grade 1 the subject
        # tab, Coverage and FDE never saw.
        segments = ([seg(1, "reading")] * 6 + [seg(1, "revision"),
                    seg(1, "revision"), seg(1, "assessment")])
        _p, st = ramp.allocate(1, "English", segments, {1})
        self.assertEqual(st["placed"], 9)

    def test_a_grade_without_a_block_keeps_every_close_period(self):
        segments = ([seg(1, "reading")] * 20
                    + [seg(1, "revision"), seg(1, "assessment")])
        _p, st = ramp.allocate(3, "English", segments, {1})
        self.assertEqual(st["placed"], 22)


if __name__ == "__main__":
    unittest.main()
