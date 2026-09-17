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
import skills


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
        # The room for the book is the budget MINUS the Foundations block:
        # those six weeks are not available to the textbook at any rate.
        room = sum(self.sizes) - sum(self.sizes[:6])
        segments = [seg(1) for _ in range(room + 25)]
        _periods, stats = ramp.allocate(1, "English", segments, {1})
        self.assertEqual(stats["placed"], room)
        self.assertEqual(stats["dropped"], 25)

    def test_dropped_is_never_negative(self):
        segments = [seg(1) for _ in range(10)]
        _periods, stats = ramp.allocate(2, "English", segments, {1})
        self.assertGreaterEqual(stats["dropped"], 0)

    def test_every_period_of_the_year_is_accounted_for(self):
        # Four kinds of period now, not three: the Grade 1 Foundations block
        # is a fourth. The sum is the whole point of this test — a period
        # that belongs to no named kind is a period that quietly vanished.
        segments = [seg(1) for _ in range(40)]
        periods, stats = ramp.allocate(1, "English", segments, {1})
        self.assertEqual(len(periods), stats["budget"])
        self.assertEqual(stats["placed"] + stats["onramp"] + stats["fill"]
                         + stats["foundations"], stats["budget"])
        self.assertEqual(stats["foundations"],
                         sum(1 for p in periods if p["kind"] == "foundations"))


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

    # 80, not 110: the Foundations block takes the first six weeks off the
    # table, so a 110-period book now fills every week that is left and there
    # are no on-ramp periods at all to make the point with.
    def test_grade_1_english_teaches_communicative_language(self):
        skills = [p["skill"] for p in self.basics(1, "English", 80)]
        self.assertIn("communicative", skills)

    def test_grade_1_urdu_teaches_communicative_language_from_the_start(self):
        # Urdu's on-ramp is arkaan saazi — letter forms and joins. The child
        # still has to be talked with while learning to write.
        # Read off the ON-RAMP, not the whole year. Foundations week 1 is
        # oral language in every subject, so looking at period 0 would now
        # pass whatever the on-ramp did.
        segments = [seg(1) for _ in range(100)]
        periods, _st = ramp.allocate(1, "Urdu", segments, {1})
        ramped = [p for p in periods if p["kind"] == "onramp"]
        first = next((i for i, p in enumerate(ramped)
                      if p["skill"] == "communicative"), None)
        self.assertIsNotNone(first, "Urdu never teaches oral language")
        self.assertLess(first, 10)

    def test_the_code_work_still_gets_most_of_the_onramp(self):
        skills = [p["skill"] for p in self.basics(1, "English", 80)]
        self.assertGreater(skills.count("phonics"),
                           skills.count("communicative"))

    def test_communicative_language_starts_early_not_in_week_20(self):
        segments = [seg(1) for _ in range(80)]
        periods, _st = ramp.allocate(1, "English", segments, {1})
        ramped = [p for p in periods if p["kind"] == "onramp"]
        first = next(i for i, p in enumerate(ramped)
                     if p["skill"] == "communicative")
        self.assertLess(first, 10, "communicative language is backloaded")

    def test_phonics_arrives_in_the_foundations_block_not_in_week_20(self):
        # This test used to demand phonics in the first three periods. The
        # Foundations block supersedes that: weeks 1-2 are routines, oral
        # language and rhyme on purpose — phonological awareness before the
        # alphabetic code — and phonics opens week 3. What still must not
        # happen is phonics arriving after the block, in February.
        segments = [seg(1) for _ in range(80)]
        periods, _st = ramp.allocate(1, "English", segments, {1})
        block = sum(ramp._week_sizes("English", 1)[:6])
        first = next(i for i, p in enumerate(periods)
                     if p["skill"] == "phonics")
        self.assertLess(first, block, "phonics must be inside the block")


GOLDEN_SIZES = [5, 3, 5, 4, 5, 5, 2, 5, 5, 5, 6, 6, 4, 5]
# _take_per_week's answers for GOLDEN_SIZES at queue lengths 0/17/34/51/68,
# read off the implementation BEFORE the `weeks` parameter existed. Grades 1
# and 2 are ramped and 3 and 5 are not, so two rows cover all four.
GOLDEN = {
    1: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [1, 0, 1, 0, 1, 1, 0, 2, 2, 2, 2, 2, 1, 2],
        [2, 1, 2, 1, 2, 2, 1, 4, 3, 3, 4, 4, 2, 3],
        [3, 1, 3, 2, 3, 3, 1, 5, 5, 5, 6, 6, 3, 5],
        [5, 3, 5, 4, 5, 5, 2, 5, 5, 5, 6, 6, 4, 5]],
    3: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [2, 0, 2, 1, 2, 1, 0, 1, 1, 1, 2, 2, 1, 1],
        [3, 1, 3, 2, 3, 3, 1, 2, 2, 2, 4, 4, 2, 2],
        [4, 2, 4, 3, 4, 4, 1, 4, 4, 4, 5, 5, 3, 4],
        [5, 3, 5, 4, 5, 5, 2, 5, 5, 5, 6, 6, 4, 5]],
}
GOLDEN[2], GOLDEN[5] = GOLDEN[1], GOLDEN[3]
QUEUES = (0, 17, 34, 51, 68)


class TakePerWeekKeepsItsOldAnswer(unittest.TestCase):
    """`weeks` is new. Everything that does not pass it must get byte-for-byte
    what it got yesterday — the G2-5 calendars are not part of this change and
    a silent shift in them would be invisible until the sheet was read."""

    def test_weeks_none_returns_exactly_the_pre_parameter_answer(self):
        for grade, rows in GOLDEN.items():
            for n, want in zip(QUEUES, rows):
                self.assertEqual(
                    ramp._take_per_week(n, GOLDEN_SIZES, grade), want,
                    "grade %d, queue %d" % (grade, n))

    def test_naming_every_week_is_the_same_as_naming_none(self):
        every = list(range(len(GOLDEN_SIZES)))
        for grade in (1, 3):
            for n in QUEUES:
                self.assertEqual(
                    ramp._take_per_week(n, GOLDEN_SIZES, grade, weeks=every),
                    ramp._take_per_week(n, GOLDEN_SIZES, grade))

    def test_a_blocked_week_is_given_nothing(self):
        # The water-fill's `or 1` guard and its one-at-a-time fallback both
        # hand overflow back to whatever week is still open, so a weight of
        # zero cannot express a prohibition. Absence has to.
        weeks = [w for w in range(len(GOLDEN_SIZES)) if w not in (0, 1, 2)]
        takes = ramp._take_per_week(68, GOLDEN_SIZES, 1, weeks=weeks)
        self.assertEqual(takes[:3], [0, 0, 0])

    def test_a_blocked_year_still_places_everything_it_has_room_for(self):
        weeks = [w for w in range(len(GOLDEN_SIZES)) if w not in (0, 1, 2)]
        room = sum(GOLDEN_SIZES[w] for w in weeks)
        takes = ramp._take_per_week(room, GOLDEN_SIZES, 1, weeks=weeks)
        self.assertEqual(sum(takes), room)


if __name__ == "__main__":
    unittest.main()
