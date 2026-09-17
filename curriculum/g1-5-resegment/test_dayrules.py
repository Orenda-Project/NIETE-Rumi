"""dayrules — an SLO gets one introducing day, a printed page never moves.

Two promises live in dayrules.py's own docstring and this file exists to hold
it to both of them.

  Rule 1: most books list fewer distinct SLOs than teaching days (the module
  cites G4 English: 23 SLOs across 99 days), so "one SLO per day" cannot be
  built without deleting codes. assign_slo_roles instead marks the first day
  on a code as the one that introduces it and every later day as developing
  it -- and it must keep every code it was given, not just the primary one a
  naive read would stop at.

  Rule 2: two days sometimes print the same page (a poem read across three
  Urdu days, or a boundary slip where one day starts on the page the last one
  finished). page_overlaps must never silently hand the page to one day and
  drop it from the other -- that asymmetry is the actual defect this rule
  exists to prevent, and it would look correct in a test that only checked
  one side.
"""
import unittest

import dayrules

PENDING = dayrules.PENDING


def _day(codes=None, descs=None, pages=None, label=None):
    return {
        "slo_codes": codes or [],
        "slo_descriptions": descs or [],
        "pages_printed": pages or [],
        "day_label": label or "?",
    }


# --------------------------------------------------------------------------
# Rule 1 -- assign_slo_roles
# --------------------------------------------------------------------------

class EveryCodeHasExactlyOneIntroducingDayAndItIsTheFirstDayListingIt(unittest.TestCase):

    def setUp(self):
        # A: day0, day2.  B: day0, day1.  C: day1, day2. Every code repeats,
        # and the repeats are in different orders, so a test that only
        # checked day0 would not catch a code introduced twice.
        self.days = [_day(["A", "B"]), _day(["B", "C"]), _day(["A", "C"])]
        self.roles = dayrules.assign_slo_roles(self.days)

    def test_each_code_introduces_on_exactly_one_day(self):
        for code in ("A", "B", "C"):
            introducing = [i for i, r in enumerate(self.roles)
                          if code in r["new_codes"]]
            self.assertEqual(len(introducing), 1,
                             f"{code} introduces on {introducing}, not once")

    def test_the_introducing_day_is_the_first_day_that_lists_the_code(self):
        for code in ("A", "B", "C"):
            introducing = next(i for i, r in enumerate(self.roles)
                               if code in r["new_codes"])
            first_listed = next(i for i, d in enumerate(self.days)
                                if code in d["slo_codes"])
            self.assertEqual(introducing, first_listed)


class NothingIsDroppedWhenOneSLOPerDayIsNotArithmeticallyAvailable(unittest.TestCase):
    """A test that only inspected primary_slo would pass even if the codes a
    day was not made primary for were thrown away -- exactly the "deletion in
    disguise" the module's docstring warns against. Union primary back with
    supporting and it must reconstruct the day's original set exactly."""

    def test_primary_plus_supporting_recovers_the_days_full_code_set(self):
        days = [_day(["A", "B", "C"]), _day(["B", "D"]), _day(["A", "D", "E"])]
        for day, role in zip(days, dayrules.assign_slo_roles(days)):
            recovered = {role["primary_slo"]} | set(role["supporting_slos"])
            self.assertEqual(recovered, set(day["slo_codes"]))

    def test_supporting_descriptions_line_up_one_for_one_with_supporting_codes(self):
        day = _day(["A", "B", "C"], ["desc A", "desc B", "desc C"])
        role = dayrules.assign_slo_roles([day])[0]
        by_code = dict(zip(role["supporting_slos"], role["supporting_descs"]))
        self.assertEqual(by_code.get("B"), "desc B")
        self.assertEqual(by_code.get("C"), "desc C")


class PrimaryFallsBackToTheFirstCodeOnlyWhenEverythingIsAlreadyIntroduced(unittest.TestCase):

    def setUp(self):
        # day0 introduces A and B. day1 lists B (old) then C (new) -- C must
        # be primary. day2 lists A then C, both already introduced elsewhere
        # -- nothing is new, so it falls back to the day's own first code.
        self.days = [_day(["A", "B"]), _day(["B", "C"]), _day(["A", "C"])]
        self.roles = dayrules.assign_slo_roles(self.days)

    def test_a_day_with_one_new_code_introduces_that_code(self):
        self.assertEqual(self.roles[1]["slo_role"], "introduces")
        self.assertEqual(self.roles[1]["primary_slo"], "C")

    def test_a_day_with_no_new_codes_develops_and_uses_its_own_first_code(self):
        self.assertEqual(self.roles[2]["slo_role"], "develops")
        # Both A and C were introduced on earlier days, so neither is "new"
        # here -- the fallback is the day's own listed order, not a re-sort.
        self.assertEqual(self.roles[2]["primary_slo"], "A")


class DescriptionsTravelWithTheirCodeNotWithDayPosition(unittest.TestCase):
    """primary_slo_desc must be the description zipped to the code that WON
    primary, not the day's first description. Ordering the day so the winning
    code sits second is the only way to catch an implementation that quietly
    reads slo_descriptions[0] instead of looking the code up."""

    def test_the_primary_description_is_the_one_zipped_to_the_primary_code(self):
        first_day = _day(["A"], ["Learn A"])
        second_day = _day(["A", "B"], ["A again", "Learn B"])
        roles = dayrules.assign_slo_roles([first_day, second_day])
        role = roles[1]
        self.assertEqual(role["primary_slo"], "B")
        self.assertEqual(role["primary_slo_desc"], "Learn B")
        # The naive off-by-one bug this guards against: printing the day's
        # first description regardless of which code actually won primary.
        self.assertNotEqual(role["primary_slo_desc"], second_day["slo_descriptions"][0])


class ADayWithNoSLOsGetsAnEmptyRoleAndNoPrimaryWithoutCrashing(unittest.TestCase):

    def test_an_empty_codes_list_is_handled(self):
        role = dayrules.assign_slo_roles([_day(codes=[])])[0]
        self.assertEqual(role["slo_role"], "")
        self.assertIsNone(role["primary_slo"])
        self.assertEqual(role["primary_slo_desc"], "")
        self.assertEqual(role["supporting_slos"], [])

    def test_a_day_dict_missing_the_slo_keys_entirely_does_not_raise(self):
        role = dayrules.assign_slo_roles([{}])[0]
        self.assertEqual(role["slo_role"], "")
        self.assertIsNone(role["primary_slo"])


# --------------------------------------------------------------------------
# Rule 2 -- page_overlaps / overlap_label
# --------------------------------------------------------------------------

class BothDaysKeepAContestedPageAndEachNamesTheOther(unittest.TestCase):
    """The defect this rule exists to prevent is asymmetric: one day silently
    keeps the page and the other loses it. Checking only one day's output
    would not catch that -- both sides have to be asserted."""

    def setUp(self):
        self.days = [_day(pages=[12], label="Day 3"), _day(pages=[12], label="Day 7")]
        self.shared = dayrules.page_overlaps(self.days)

    def test_both_days_still_list_the_page_as_their_own(self):
        self.assertIn(12, self.shared[0])
        self.assertIn(12, self.shared[1])

    def test_each_day_names_the_other_by_index(self):
        self.assertEqual(self.shared[0][12], [1])
        self.assertEqual(self.shared[1][12], [0])

    def test_each_days_label_names_the_other_days_label_not_its_own(self):
        label0 = dayrules.overlap_label(self.shared[0], self.days)
        label1 = dayrules.overlap_label(self.shared[1], self.days)
        self.assertIn("Day 7", label0)
        self.assertNotIn("Day 3", label0)
        self.assertIn("Day 3", label1)
        self.assertNotIn("Day 7", label1)


class APageClaimedByOnlyOneDayProducesNoOverlapEntry(unittest.TestCase):

    def test_unshared_pages_are_silent(self):
        days = [_day(pages=[5], label="Day 1"), _day(pages=[9], label="Day 2")]
        shared = dayrules.page_overlaps(days)
        self.assertEqual(shared[0], {})
        self.assertEqual(shared[1], {})
        self.assertEqual(dayrules.overlap_label(shared[0], days), "")


class ThreeDaysSharingAPageEachNameTheOtherTwo(unittest.TestCase):

    def test_every_day_lists_both_of_the_other_two(self):
        days = [_day(pages=[20], label="Day A"),
                _day(pages=[20], label="Day B"),
                _day(pages=[20], label="Day C")]
        shared = dayrules.page_overlaps(days)
        for i in range(3):
            others = set(shared[i][20])
            self.assertEqual(others, {j for j in range(3) if j != i})
        label = dayrules.overlap_label(shared[0], days)
        self.assertIn("Day B", label)
        self.assertIn("Day C", label)


class OverlapLabelIsDeterministicSoARebuildDoesNotChurnTheSheet(unittest.TestCase):

    def test_the_who_list_is_sorted_not_insertion_ordered(self):
        days = [_day(label="Day 10"), _day(label="Day 2")]
        label = dayrules.overlap_label({5: [0, 1]}, days)
        # "Day 10" < "Day 2" as strings -- a rebuild that iterated the dict of
        # other-day indices in claim order rather than sorting would risk
        # printing "Day 2, Day 10" on one run and the reverse on another.
        self.assertEqual(label, "p.5 also Day 10, Day 2")

    def test_pages_print_in_ascending_order_regardless_of_dict_build_order(self):
        days = [_day(label="X"), _day(label="Y")]
        shared = {12: [0], 3: [1]}
        self.assertEqual(dayrules.overlap_label(shared, days),
                         "p.3 also Y; p.12 also X")


# --------------------------------------------------------------------------
# Derived fields
# --------------------------------------------------------------------------

class FluencySkillTypeOverridesWhateverTheStrandLetterWouldSay(unittest.TestCase):

    def test_the_bare_strand_letter_says_input(self):
        # Control: without a fluency skill_type, RD reads as "input" per
        # STRAND_MAP -- proving the two calls below actually disagree rather
        # than coincidentally landing on the same answer either way.
        self.assertEqual(dayrules.strand_for("G4-U-RD-12", "reading_comprehension"),
                         "input")

    def test_a_fluency_skill_type_overrides_that_same_code_to_fluency(self):
        self.assertEqual(dayrules.strand_for("G4-U-RD-12", "buland_khwani"),
                         "fluency")


class AMalformedOrMissingSLOCodeIsPendingNotAnException(unittest.TestCase):
    """This runs over thousands of rows, so a code that does not parse must
    come back as data (PENDING), never as a raised exception."""

    def test_no_primary_code_at_all(self):
        self.assertEqual(dayrules.strand_for(None, "reading"), PENDING)

    def test_a_code_with_only_one_segment(self):
        self.assertEqual(dayrules.strand_for("G4", "reading"), PENDING)

    def test_a_code_with_only_two_segments(self):
        self.assertEqual(dayrules.strand_for("G4-U", "reading"), PENDING)


class AnUnknownStrandLetterIsPendingNotAKeyError(unittest.TestCase):

    def test_a_third_segment_outside_strand_map_is_pending_not_a_crash(self):
        self.assertEqual(dayrules.strand_for("G4-U-ZZ-1", "reading"), PENDING)


class PagesLabelCollapsesRunsAndSortsUnsortedInput(unittest.TestCase):

    def test_unsorted_pages_collapse_into_ranges_and_leave_singletons_alone(self):
        self.assertEqual(dayrules.pages_label([3, 1, 2, 7]), "1-3, 7")

    def test_a_single_missing_page_breaks_the_run_in_two(self):
        # 1..3 and 5..7 are each internally consecutive; page 4 is simply
        # absent. A version tolerant of small gaps would wrongly print "1-7".
        self.assertEqual(dayrules.pages_label([1, 2, 3, 5, 6, 7]), "1-3, 5-7")

    def test_no_pages_is_the_empty_string(self):
        self.assertEqual(dayrules.pages_label([]), "")


if __name__ == "__main__":
    unittest.main()
