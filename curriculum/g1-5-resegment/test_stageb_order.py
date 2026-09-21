"""stageb.order_segments — the chapter tail in the order it is taught.

The source files carry the assessment above the revision in Urdu (as day
numbers), in English (as a labelless tail above a numbered Review day) and in
Maths/Science (two labelless tails). One sort has to fix all three without
moving a book that is already right.
"""
import json
import os
import shutil
import tempfile
import unittest

import stageb


def seg(ch, label, **kw):
    return dict({"chapter_number": ch, "day_label": label}, **kw)


class OrderSegments(unittest.TestCase):

    def labels(self, segments):
        return [s["day_label"] for s in stageb.order_segments(segments)]

    def test_urdu_assessment_day_10_follows_revision_day_9(self):
        rows = [seg(1, "Day 1"), seg(1, "Day 10"), seg(1, "Day 9")]
        self.assertEqual(self.labels(rows), ["Day 1", "Day 9", "Day 10"])

    def test_english_labelless_assessment_follows_the_review_day(self):
        rows = [seg(1, "Day 7"), seg(1, "Assessment"), seg(1, "Day 8 (Review)")]
        self.assertEqual(self.labels(rows),
                         ["Day 7", "Day 8 (Review)", "Assessment"])

    def test_two_labelless_tails_revise_then_check(self):
        rows = [seg(1, "Day 1"), seg(1, "Assessment"), seg(1, "Chapter Review")]
        self.assertEqual(self.labels(rows),
                         ["Day 1", "Chapter Review", "Assessment"])

    def test_lp_type_names_the_tail_when_the_label_does_not(self):
        rows = [seg(1, "Chapter close", lp_type="assessment"),
                seg(1, "Mastery", lp_type="review")]
        self.assertEqual(self.labels(rows), ["Mastery", "Chapter close"])

    def test_chapters_keep_the_order_they_first_appear_in(self):
        rows = [seg(3, "Day 1"), seg(1, "Day 1"), seg(3, "Day 2")]
        self.assertEqual([s["chapter_number"]
                          for s in stageb.order_segments(rows)], [3, 3, 1])

    def test_a_book_already_in_order_is_untouched(self):
        rows = [seg(1, "Day 1"), seg(1, "Day 2"), seg(1, "Chapter Review"),
                seg(1, "Assessment"), seg(2, "Day 1")]
        self.assertEqual(stageb.order_segments(rows), rows)

    def test_a_segment_with_no_chapter_number_is_kept(self):
        rows = [seg(None, "Day 2"), seg(None, "Day 1")]
        self.assertEqual(self.labels(rows), ["Day 1", "Day 2"])


class LoadBookAppliesTheTwoPeriodRulesOnTheWayIn(unittest.TestCase):
    """load_book is the only door the corpus comes through (build.py:75), so
    the fold and the 5E swap belong here rather than at each of the four
    consumers, which would then be free to disagree about the same book."""

    def book(self, stem, segments):
        path = os.path.join(self.tmp, f"{stem}.json")
        with open(path, "w") as fh:
            json.dump({"_meta": {"book_stem": stem},
                       "segments": segments}, fh)
        return path

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)

    def test_an_urdu_chapters_revision_day_is_folded_away_by_load_book(self):
        path = self.book("grade_5_urdu", [
            seg(1, "Day 1", skill_type="tafheem", slo_codes=["U-05-CO-01"]),
            seg(1, "Day 3", skill_type="assessment", slo_codes=[]),
            # Grade 5 writes the RAW key. Canonicalising is the whole test.
            seg(1, "Day 2", skill_type="revision", topic="\u062f\u06c1\u0631\u0627\u0626\u06cc",
                slo_codes=["U-05-CO-01", "U-05-WR-02"]),
        ])
        _stem, grade, subject, _meta, segments = stageb.load_book(path)
        self.assertEqual((grade, subject), (5, "Urdu"))
        self.assertEqual([s["skill_type"] for s in segments],
                         ["tafheem", "assessment"])
        self.assertIn("U-05-WR-02", segments[0]["slo_codes"])

    def test_a_science_chapter_gains_its_engage_day_without_gaining_a_period(self):
        path = self.book("grade_4_general_science", [
            seg(1, "Day 1", skill_type="investigate_handson"),
            seg(1, "Day 2", skill_type="concept_build"),
            seg(1, "Day 3", skill_type="investigate_handson"),
            seg(1, "Day 4", skill_type="apply_connect"),
        ])
        _stem, _grade, _subject, _meta, segments = stageb.load_book(path)
        self.assertEqual(len(segments), 4)
        self.assertEqual([s["skill_type"] for s in segments],
                         ["engage_hook", "concept_build",
                          "investigate_handson", "apply_connect"])

    def test_an_english_books_revision_day_is_folded_away_too(self):
        # This asserted `len(segments) == 3` until 2026-09-21, when Grades
        # 2-5 English and Maths joined the fold (bd-2ctk6). Grade 3 is the
        # case that changed: before, only grade 1 came out short.
        rows = [seg(1, "Day 1", skill_type="reading_comprehension",
                    slo_codes=["E-03-RD-01"]),
                seg(1, "Day 2", skill_type="revision",
                    slo_codes=["E-03-RD-01", "E-03-VO-02"]),
                seg(1, "Day 3", skill_type="assessment")]
        path = self.book("grade_3_english", rows)
        _stem, _grade, _subject, _meta, segments = stageb.load_book(path)
        self.assertEqual([s["skill_type"] for s in segments],
                         ["reading_comprehension", "assessment"])
        self.assertIn("E-03-VO-02", segments[0]["slo_codes"])

    def test_a_science_book_keeps_its_revision_day(self):
        # Science is the one subject Rule 3 still refuses, and Rule 4 is
        # why: its chapters are at the period ceiling, so a 5E cycle is
        # completed by swapping a period rather than by freeing one. With
        # English and Maths now folding at every grade, this is the only
        # test left that holds the gate shut anywhere.
        rows = [seg(1, "Day 1", skill_type="investigate_handson"),
                seg(1, "Day 2", skill_type="revision"),
                seg(1, "Day 3", skill_type="assessment")]
        path = self.book("grade_4_general_science", rows)
        _stem, _grade, subject, _meta, segments = stageb.load_book(path)
        self.assertEqual(subject, "Science")
        self.assertEqual(len(segments), 3)
