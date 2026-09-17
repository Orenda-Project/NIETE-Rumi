"""stageb.order_segments — the chapter tail in the order it is taught.

The source files carry the assessment above the revision in Urdu (as day
numbers), in English (as a labelless tail above a numbered Review day) and in
Maths/Science (two labelless tails). One sort has to fix all three without
moving a book that is already right.
"""
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


if __name__ == "__main__":
    unittest.main()
