"""dayfold Rule 4 — the 5E cycle is completed by a swap, never by an addition.

Science is taught on 5E and no chapter currently runs the full cycle: Grade 4
has no Engage day in 8 of its 9 chapters, Grade 5 no Apply-and-connect day in
5 of its 9. Both books already sit at their period ceiling -- 84 and 83 -- so
the repair retags one Investigate day rather than buying a tenth period. The
totals must come out of complete_5e exactly as they went in, and that is
asserted against the real books below.

A chapter always keeps at least one Investigate day: a complete cycle with no
hands-on period in it is a worse lesson than an incomplete one, so a chapter
with only two Investigate days and two holes fills one hole, not both.

Scope is Grades 4-5 General Science, which is the whole of Science here.
Rule 3 and its Urdu corpus numbers live in test_dayfold_urdu.py.
"""
import json
import os
import unittest

import dayfold

HERE = os.path.dirname(os.path.abspath(__file__))
SEG = os.path.join(HERE, "corpus", "seg")

PHASES = ("engage_hook", "investigate_handson", "concept_build",
          "apply_connect")


def seg(ch, label, skill, **kw):
    return dict({"chapter_number": ch, "day_label": label,
                 "skill_type": skill, "slo_codes": [], "pages_printed": [],
                 "notes": ""}, **kw)


def science_chapter(ch, skills_list):
    return [seg(ch, f"Day {i + 1}", k) for i, k in enumerate(skills_list)]


def skills_of(segments, ch=None):
    return [s["skill_type"] for s in segments
            if ch is None or s["chapter_number"] == ch]


NO_ENGAGE = ["investigate_handson", "concept_build", "investigate_handson",
             "concept_build", "apply_connect", "review_assess", "assessment"]
NO_APPLY = ["engage_hook", "investigate_handson", "concept_build",
            "investigate_handson", "concept_build", "review_assess",
            "assessment"]


class ACompletedCycleCostsNoExtraPeriod(unittest.TestCase):

    def test_a_chapter_with_no_engage_day_swaps_its_first_investigate(self):
        out, swaps = dayfold.complete_5e(science_chapter(1, NO_ENGAGE),
                                         "Science")
        self.assertEqual(swaps, 1)
        self.assertEqual(skills_of(out)[:3],
                         ["engage_hook", "concept_build",
                          "investigate_handson"])

    def test_a_chapter_with_no_apply_day_swaps_its_last_investigate(self):
        out, swaps = dayfold.complete_5e(science_chapter(1, NO_APPLY),
                                         "Science")
        self.assertEqual(swaps, 1)
        self.assertEqual(skills_of(out),
                         ["engage_hook", "investigate_handson",
                          "concept_build", "apply_connect", "concept_build",
                          "review_assess", "assessment"])

    def test_the_period_count_is_identical_before_and_after(self):
        before = science_chapter(1, NO_ENGAGE) + science_chapter(2, NO_APPLY)
        out, _swaps = dayfold.complete_5e(before, "Science")
        self.assertEqual(len(out), len(before))

    def test_a_chapter_missing_both_phases_spends_only_the_spare_investigate(self):
        # Two Investigate days and two holes. Filling both would leave the
        # chapter with no Investigate day at all — a complete 5E cycle on
        # paper and no hands-on period in it. Engage is filled, Apply is not.
        rows = science_chapter(1, ["investigate_handson", "concept_build",
                                   "investigate_handson", "assessment"])
        out, swaps = dayfold.complete_5e(rows, "Science")
        self.assertEqual(swaps, 1)
        self.assertEqual(skills_of(out),
                         ["engage_hook", "concept_build",
                          "investigate_handson", "assessment"])

    def test_the_swapped_day_keeps_its_day_label_and_chapter(self):
        out, _swaps = dayfold.complete_5e(science_chapter(3, NO_ENGAGE),
                                          "Science")
        self.assertEqual(out[0]["day_label"], "Day 1")
        self.assertEqual(out[0]["chapter_number"], 3)


class TheSwapRefusesWhereItWouldEmptyTheCycle(unittest.TestCase):

    def test_a_chapter_with_a_single_investigate_day_is_left_alone(self):
        rows = science_chapter(1, ["investigate_handson", "concept_build",
                                   "assessment"])
        out, swaps = dayfold.complete_5e(rows, "Science")
        self.assertEqual(swaps, 0)
        self.assertEqual(out, rows)

    def test_a_chapter_that_already_runs_the_full_cycle_is_untouched(self):
        rows = science_chapter(1, ["engage_hook", "investigate_handson",
                                   "investigate_handson", "concept_build",
                                   "apply_connect", "assessment"])
        out, swaps = dayfold.complete_5e(rows, "Science")
        self.assertEqual(swaps, 0)
        self.assertEqual(out, rows)

    def test_a_non_science_subject_is_never_touched(self):
        rows = [seg(1, "Day 1", "investigate_handson"),
                seg(1, "Day 2", "investigate_handson")]
        out, swaps = dayfold.complete_5e(rows, "Maths")
        self.assertEqual(swaps, 0)
        self.assertEqual(out, rows)

    def test_the_input_list_is_not_mutated_in_place(self):
        rows = science_chapter(1, NO_ENGAGE)
        dayfold.complete_5e(rows, "Science")
        self.assertEqual(rows[0]["skill_type"], "investigate_handson")


# --------------------------------------------------------------------------
# Against the real corpus, when this machine has it. It is gitignored, so a
# fresh clone skips these rather than failing on a file it cannot have.
# --------------------------------------------------------------------------

def book(stem):
    with open(os.path.join(SEG, f"{stem}.json")) as fh:
        return json.load(fh)["segments"]


def phases_by_chapter(segments):
    out = {}
    for s in segments:
        out.setdefault(s["chapter_number"], set()).add(s["skill_type"])
    return out


HAVE_CORPUS = os.path.isdir(SEG)


@unittest.skipUnless(HAVE_CORPUS, "corpus/ is gitignored and not present")
class TheRealCorpusScienceNumbers(unittest.TestCase):

    def test_grade_4_science_still_has_exactly_eighty_four_periods(self):
        out, swaps = dayfold.complete_5e(book("grade_4_general_science"),
                                         "Science")
        self.assertEqual(len(out), 84)
        self.assertEqual(swaps, 8)

    def test_grade_5_science_still_has_exactly_eighty_three_periods(self):
        out, swaps = dayfold.complete_5e(book("grade_5_general_science"),
                                         "Science")
        self.assertEqual(len(out), 83)
        self.assertEqual(swaps, 5)

    def test_grade_4_was_missing_engage_in_eight_of_its_nine_chapters(self):
        # The before-picture the swap is answering. If the corpus is ever
        # regenerated with Engage days already in it, this goes red and the
        # swap count above should be re-derived rather than re-pinned.
        before = phases_by_chapter(book("grade_4_general_science"))
        self.assertEqual(len(before), 9)
        self.assertEqual(
            sum(1 for found in before.values() if "engage_hook" not in found),
            8)

    def test_grade_5_was_missing_apply_in_five_of_its_nine_chapters(self):
        before = phases_by_chapter(book("grade_5_general_science"))
        self.assertEqual(len(before), 9)
        self.assertEqual(
            sum(1 for found in before.values() if "apply_connect" not in found),
            5)

    def test_every_science_chapter_runs_the_full_cycle_afterwards(self):
        for stem in ("grade_4_general_science", "grade_5_general_science"):
            out, _swaps = dayfold.complete_5e(book(stem), "Science")
            for ch, found in sorted(phases_by_chapter(out).items()):
                for phase in PHASES:
                    self.assertIn(phase, found, f"{stem} ch{ch} has no {phase}")

    def test_no_science_chapter_is_left_without_a_hands_on_period(self):
        for stem in ("grade_4_general_science", "grade_5_general_science"):
            out, _swaps = dayfold.complete_5e(book(stem), "Science")
            for ch, found in sorted(phases_by_chapter(out).items()):
                self.assertIn("investigate_handson", found,
                              f"{stem} ch{ch} lost its last Investigate day")


if __name__ == "__main__":
    unittest.main()
