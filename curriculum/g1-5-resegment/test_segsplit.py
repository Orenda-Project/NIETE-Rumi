"""Splitting one segment renumbers everything downstream of it.

Grade 1 English chapter 1 day 5 teaches rhyming words off page 8 and days of
the week off page 9 in one period. The book itself makes the cut -- page 8 is
Activity 1 Rhyme Match end to end, page 9 is Activity 2 Calendar Quest -- so
the split is not a judgement call about content. What it is, is eight rows of
bookkeeping: the poster day slides from 6 to 7, the review day's label moves
from "Day 7 (Review)" to "Day 8 (Review)", and every prev/next link either
side of the cut has to follow.

That is done here rather than by hand because a wrong link does not fail
loudly. It produces a chapter that still loads, still renders, and teaches a
day twice or skips one.

Two conventions have to survive the trip. English and Science books link with
string ids (`e_g1_ch1_2`); every Maths and Urdu book links with bare integers.
A helper that normalised them would corrupt eleven books to tidy six.

The tail sentinels stay put. 990 is the review and 995 the assessment, in both
books' own `chapter_tail_order`, and those indices are addresses rather than
positions -- renumbering them to 7 and 8 would break every reference.
"""
import unittest

import segsplit


def row(index, chapter=1, label=None, **kw):
    d = {"segment_index": index, "chapter_number": chapter,
         "day_label": label if label is not None else f"Day {index}",
         "topic": f"topic {index}", "slo_codes": [], "pages_printed": []}
    d.update(kw)
    return d


def chapter(n=3, ids="str"):
    rows = [row(i) for i in range(1, n + 1)]
    rows.append(row(995, label="Assessment"))
    rows.append(row(990, label=f"Day {n + 1} (Review)"))
    return segsplit.relink(rows, prefix="e_g1" if ids == "str" else None)


class RenumberingTheDaysAfterTheCut(unittest.TestCase):

    def setUp(self):
        self.rows = chapter(3)

    def test_the_chapter_grows_by_exactly_one_row(self):
        out = segsplit.split(self.rows, 2, [{"topic": "a"}, {"topic": "b"}])
        self.assertEqual(len(out), len(self.rows) + 1)

    def test_the_two_halves_take_the_cut_day_and_the_one_after_it(self):
        out = segsplit.split(self.rows, 2, [{"topic": "a"}, {"topic": "b"}])
        self.assertEqual([(r["segment_index"], r["topic"]) for r in out[:4]],
                         [(1, "topic 1"), (2, "a"), (3, "b"), (4, "topic 3")])

    def test_the_day_labels_follow_the_new_numbering(self):
        out = segsplit.split(self.rows, 2, [{}, {}])
        self.assertEqual([r["day_label"] for r in out if r["segment_index"] < 990],
                         ["Day 1", "Day 2", "Day 3", "Day 4"])

    def test_a_half_inherits_every_field_it_does_not_override(self):
        rows = chapter(3)
        rows[1]["skill_type"] = "vocabulary_grammar"
        out = segsplit.split(rows, 2, [{"topic": "a"}, {"topic": "b"}])
        self.assertEqual(out[1]["skill_type"], "vocabulary_grammar")
        self.assertEqual(out[2]["skill_type"], "vocabulary_grammar")

    def test_splitting_into_three_is_allowed(self):
        out = segsplit.split(self.rows, 1, [{}, {}, {}])
        self.assertEqual([r["segment_index"] for r in out
                          if r["segment_index"] < 990], [1, 2, 3, 4, 5])

    def test_refusing_to_split_a_day_that_is_not_there(self):
        with self.assertRaises(KeyError):
            segsplit.split(self.rows, 9, [{}, {}])

    def test_a_split_into_one_is_refused_rather_than_silently_doing_nothing(self):
        with self.assertRaises(ValueError):
            segsplit.split(self.rows, 2, [{}])


class TheTailSentinelsAreAddressesNotPositions(unittest.TestCase):

    def test_990_and_995_keep_their_indices(self):
        out = segsplit.split(chapter(3), 2, [{}, {}])
        self.assertEqual([r["segment_index"] for r in out[-2:]], [995, 990])

    def test_the_review_day_label_counts_the_new_teaching_days(self):
        out = segsplit.split(chapter(3), 2, [{}, {}])
        review = [r for r in out if r["segment_index"] == 990][0]
        self.assertEqual(review["day_label"], "Day 5 (Review)")

    def test_a_label_without_a_day_number_is_left_alone(self):
        out = segsplit.split(chapter(3), 2, [{}, {}])
        assess = [r for r in out if r["segment_index"] == 995][0]
        self.assertEqual(assess["day_label"], "Assessment")


class TheLinksFollowTheBooksOwnConvention(unittest.TestCase):

    def test_string_ids_are_rebuilt_in_stored_order(self):
        out = segsplit.split(chapter(3, "str"), 2, [{}, {}])
        self.assertEqual([r["next_segment_id"] for r in out],
                         ["e_g1_ch1_2", "e_g1_ch1_3", "e_g1_ch1_4",
                          "e_g1_ch1_995", "e_g1_ch1_990", None])

    def test_the_chain_runs_backwards_too(self):
        out = segsplit.split(chapter(3, "str"), 2, [{}, {}])
        self.assertEqual([r["prev_segment_id"] for r in out],
                         [None, "e_g1_ch1_1", "e_g1_ch1_2", "e_g1_ch1_3",
                          "e_g1_ch1_4", "e_g1_ch1_995"])

    def test_an_integer_linked_book_stays_integer_linked(self):
        out = segsplit.split(chapter(3, "int"), 2, [{}, {}])
        self.assertEqual([r["next_segment_id"] for r in out],
                         [2, 3, 4, 995, 990, None])
        self.assertTrue(all(isinstance(r["next_segment_id"], int)
                            for r in out[:-1]))

    def test_every_link_names_a_row_that_is_actually_there(self):
        out = segsplit.split(chapter(5, "str"), 3, [{}, {}])
        ids = {segsplit.ident(r, "e_g1") for r in out}
        for r in out:
            for key in ("prev_segment_id", "next_segment_id"):
                if r[key] is not None:
                    self.assertIn(r[key], ids)


class SplittingTheRealRow(unittest.TestCase):
    """Grade 1 English ch1 d5, the row bd-4lx8q is about."""

    def setUp(self):
        self.rows = segsplit.relink(
            [row(i, pages_printed=[i]) for i in range(1, 7)] +
            [row(995, label="Assessment"), row(990, label="Day 7 (Review)")],
            prefix="e_g1")
        self.rows[4]["slo_codes"] = ["E-01-PA-01", "E-01-VG-01"]
        self.rows[4]["pages_printed"] = [8, 9]

    def test_neither_slo_is_lost_in_the_split(self):
        out = segsplit.split(self.rows, 5,
                             [{"slo_codes": ["E-01-PA-01"], "pages_printed": [8]},
                              {"slo_codes": ["E-01-VG-01"], "pages_printed": [9]}])
        kept = [c for r in out for c in r["slo_codes"]]
        self.assertIn("E-01-PA-01", kept)
        self.assertIn("E-01-VG-01", kept)

    def test_the_poster_day_slides_from_six_to_seven(self):
        out = segsplit.split(self.rows, 5, [{"pages_printed": [8]},
                                            {"pages_printed": [9]}])
        poster = [r for r in out if r["topic"] == "topic 6"][0]
        self.assertEqual(poster["segment_index"], 7)
        self.assertEqual(poster["day_label"], "Day 7")

    def test_the_review_becomes_day_eight(self):
        out = segsplit.split(self.rows, 5, [{}, {}])
        review = [r for r in out if r["segment_index"] == 990][0]
        self.assertEqual(review["day_label"], "Day 8 (Review)")

    def test_the_chapter_costs_one_more_teaching_period(self):
        before = sum(1 for r in self.rows if r["segment_index"] < 990)
        out = segsplit.split(self.rows, 5, [{}, {}])
        after = sum(1 for r in out if r["segment_index"] < 990)
        self.assertEqual((before, after), (6, 7))


if __name__ == "__main__":
    unittest.main()
