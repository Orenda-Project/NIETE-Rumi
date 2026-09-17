"""ramp — the year's periods, and the promise that none of them vanish.

The allocator does two things at once: it stretches a short book evenly across
a long year, and for Grades 1-2 it tilts that same total towards the back so
April is mostly code and oral work. The tilt is the dangerous half. Weight
pushed to the back of the year lands on weeks that are already full, and the
first version of this file capped each week at its size and let the remainder
fall on the floor — 41 periods of Grade 1 and 2 content that no week ever
taught, while the Calendar (overview) tab reported the year as having room to
spare.

So the tests below are mostly one test asked in different ways: whatever the
ramp does to the SHAPE of the year, the COUNT has to come out whole.
"""
import unittest

import ramp


def seg(ch, skill="reading"):
    return {"chapter_number": ch, "skill_type": skill}


class TakePerWeek(unittest.TestCase):
    """_take_per_week decides how many of each week's periods are textbook."""

    def test_a_ramped_grade_places_every_period_the_year_has_room_for(self):
        # 28 weeks x 5 = 140 periods, a 120-period book. The slack is real but
        # thin, which is the shape every actual G1-2 book has: the ramp tilts
        # those 120 towards the back, the back weeks are already full, and the
        # remainder used to be dropped. 6 periods went missing here.
        takes = ramp._take_per_week(120, [5] * 28, grade=1)
        self.assertEqual(sum(takes), 120)

    def test_an_unramped_grade_places_every_period_too(self):
        takes = ramp._take_per_week(120, [5] * 28, grade=3)
        self.assertEqual(sum(takes), 120)

    def test_a_book_that_exactly_fills_the_year_loses_nothing(self):
        # The worst case: no slack at all, so every week must be taken whole
        # and the ramp has nowhere to tilt to. 15 periods went missing here.
        takes = ramp._take_per_week(140, [5] * 28, grade=1)
        self.assertEqual(sum(takes), 140)

    def test_a_book_longer_than_the_year_fills_the_year_exactly(self):
        takes = ramp._take_per_week(200, [5] * 28, grade=1)
        self.assertEqual(sum(takes), 140)

    def test_no_week_is_given_more_periods_than_it_has(self):
        sizes = [5, 3, 5, 4, 5, 5, 2, 5, 5, 5]
        takes = ramp._take_per_week(42, sizes, grade=1)
        for size, take in zip(sizes, takes):
            self.assertLessEqual(take, size)

    def test_a_short_week_does_not_swallow_the_shortfall_silently(self):
        # Week 3 has one period. Whatever it cannot take must appear somewhere
        # else in the year, not go missing.
        sizes = [5, 5, 1, 5, 5]
        takes = ramp._take_per_week(20, sizes, grade=1)
        self.assertEqual(sum(takes), 20)

    def test_the_ramp_still_tilts_the_book_towards_the_back(self):
        # The fix must not flatten the ramp: the whole point of Grades 1-2 is
        # that April is lighter on the textbook than November.
        takes = ramp._take_per_week(60, [5] * 20, grade=1)
        self.assertLess(sum(takes[:6]), sum(takes[-6:]))

    def test_an_unramped_grade_is_not_tilted(self):
        takes = ramp._take_per_week(60, [5] * 20, grade=3)
        self.assertEqual(sum(takes[:6]), sum(takes[-6:]))


class AllocateReportsWhatItPlaced(unittest.TestCase):
    """The stats block is what the Calendar (overview) tab prints. It has to
    describe the calendar that was built, not the one that was intended."""

    def setUp(self):
        self.sizes = ramp._week_sizes("English", 1)

    def test_placed_counts_the_book_periods_actually_in_the_year(self):
        segments = [seg(1) for _ in range(40)]
        periods, stats = ramp.allocate(1, "English", segments, {1})
        real = sum(1 for p in periods if p["kind"] in ("book", "omitted"))
        self.assertEqual(stats["placed"], real)

    def test_a_book_that_fits_is_taught_whole(self):
        segments = [seg(1) for _ in range(40)]
        _periods, stats = ramp.allocate(1, "English", segments, {1})
        self.assertEqual(stats["placed"], 40)
        self.assertEqual(stats["dropped"], 0)

    def test_a_book_too_long_for_the_year_reports_what_it_lost(self):
        n = sum(self.sizes) + 25
        segments = [seg(1) for _ in range(n)]
        _periods, stats = ramp.allocate(1, "English", segments, {1})
        self.assertEqual(stats["placed"], sum(self.sizes))
        self.assertEqual(stats["dropped"], 25)

    def test_dropped_is_never_negative(self):
        segments = [seg(1) for _ in range(10)]
        _periods, stats = ramp.allocate(2, "English", segments, {1})
        self.assertGreaterEqual(stats["dropped"], 0)

    def test_every_period_of_the_year_is_accounted_for(self):
        segments = [seg(1) for _ in range(40)]
        periods, stats = ramp.allocate(1, "English", segments, {1})
        self.assertEqual(len(periods), stats["budget"])
        self.assertEqual(stats["placed"] + stats["onramp"] + stats["fill"],
                         stats["budget"])


class OnrampTeachesOralLanguageToo(unittest.TestCase):
    """Amena asked for "phonics, communicative language can also be added so
    we see how it rolls". The first build queued communicative language behind
    the on-ramp, so in Grades 1-2 — where the on-ramp owns the spare periods
    outright — it never ran at all, in either English or Urdu.

    It belongs alongside the code work, not after it: decoding and oral
    language comprehension are the two strands of the reading rope and a child
    with no ECE needs both from April. So the on-ramp rotates.
    """

    def basics(self, grade, subject, n_book):
        segments = [seg(1) for _ in range(n_book)]
        periods, _st = ramp.allocate(grade, subject, segments, {1})
        return [p for p in periods if p["kind"] in ("onramp", "fill")]

    def test_grade_1_english_teaches_communicative_language(self):
        skills = [p["skill"] for p in self.basics(1, "English", 110)]
        self.assertIn("communicative", skills)

    def test_grade_1_urdu_teaches_communicative_language_from_the_start(self):
        # Urdu's on-ramp is arkaan saazi — letter forms and joins. The child
        # still has to be talked with while learning to write.
        segments = [seg(1) for _ in range(120)]
        periods, _st = ramp.allocate(1, "Urdu", segments, {1})
        first = next((i for i, p in enumerate(periods)
                      if p["skill"] == "communicative"), None)
        self.assertIsNotNone(first, "Urdu never teaches oral language")
        self.assertLess(first, 30)

    def test_the_code_work_still_gets_most_of_the_onramp(self):
        skills = [p["skill"] for p in self.basics(1, "English", 110)]
        self.assertGreater(skills.count("phonics"),
                           skills.count("communicative"))

    def test_communicative_language_starts_early_not_in_week_20(self):
        segments = [seg(1) for _ in range(110)]
        periods, _st = ramp.allocate(1, "English", segments, {1})
        first = next(i for i, p in enumerate(periods)
                     if p["skill"] == "communicative")
        self.assertLess(first, 30, "communicative language is backloaded")

    def test_phonics_still_opens_the_year(self):
        segments = [seg(1) for _ in range(110)]
        periods, _st = ramp.allocate(1, "English", segments, {1})
        first = next(i for i, p in enumerate(periods)
                     if p["skill"] == "phonics")
        self.assertLess(first, 3, "phonics must be there from the first days")


if __name__ == "__main__":
    unittest.main()
