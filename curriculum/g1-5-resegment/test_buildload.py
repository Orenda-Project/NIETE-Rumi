"""The corpus load and the per-subject aggregation behind every tab.

`subject_totals` was inline in `build.main` and untested, which is why the
`tails` figure could drift: it is not counted, it is `rows - days`, so a
change to either one moves it silently. These tests pin the arithmetic and
the subject order the whole sheet is written in.
"""
import unittest

import buildload


def st(days, rows, introduces=0, overlapping=0, cpa_conflicts=0):
    return {"days": days, "rows": rows, "introduces": introduces,
            "overlapping": overlapping, "cpa_conflicts": cpa_conflicts}


def corpus(**by_subject):
    """corpus[subject] = [(grade, rows, stats), ...] — what load_corpus returns."""
    return dict(by_subject)


class SubjectTotals(unittest.TestCase):

    def test_tails_are_rows_minus_days_not_a_separate_count(self):
        stats, _rows, _total = buildload.subject_totals(
            corpus(English=[(1, [["Day 1"]] * 3, st(days=40, rows=46))]))
        self.assertEqual(dict(stats)["English"]["tails"], 6)

    def test_subject_order_is_fixed_whatever_order_the_corpus_came_in(self):
        stats, _rows, _total = buildload.subject_totals(
            corpus(Science=[(4, [], st(1, 1))], Maths=[(1, [], st(1, 1))],
                   Urdu=[(1, [], st(1, 1))], English=[(1, [], st(1, 1))]))
        self.assertEqual([s for s, _ in stats],
                         ["English", "Urdu", "Maths", "Science"])

    def test_a_subject_with_no_books_reads_zero_rather_than_raising(self):
        # Science is G4-5 only, so a one-grade build has empty subjects.
        stats, rows, total = buildload.subject_totals(
            corpus(English=[(1, [["Day 1"]], st(days=2, rows=2))]))
        self.assertEqual(dict(stats)["Science"],
                         {"days": 0, "tails": 0, "introduces": 0,
                          "overlapping": 0})
        self.assertEqual(rows, [["Day 1"]])
        self.assertEqual(total["days"], 2)

    def test_rows_concatenate_by_subject_then_by_grade(self):
        _stats, rows, _total = buildload.subject_totals(
            corpus(English=[(1, [["e1"]], st(1, 1)), (2, [["e2"]], st(1, 1))],
                   Urdu=[(1, [["u1"]], st(1, 1))]))
        self.assertEqual(rows, [["e1"], ["e2"], ["u1"]])

    def test_total_sums_every_subject(self):
        _stats, _rows, total = buildload.subject_totals(
            corpus(English=[(1, [], st(10, 12, introduces=5, overlapping=1))],
                   Maths=[(1, [], st(20, 23, introduces=7, overlapping=2))]))
        self.assertEqual(total, {"days": 30, "tails": 5, "introduces": 12,
                                 "overlapping": 3})

    def test_totals_keys_are_exactly_what_the_navigation_footer_prints(self):
        # navtab's footer line quotes days / tails / introduces; a renamed key
        # here would print a KeyError into the index at the end of a build.
        _stats, _rows, total = buildload.subject_totals(corpus())
        self.assertEqual(set(total),
                         {"days", "tails", "introduces", "overlapping"})


class CorpusPaths(unittest.TestCase):
    """build.py re-exports these, so existing callers keep working."""

    def test_the_four_corpus_paths_are_all_under_the_corpus_dir(self):
        for path in (buildload.SEG_DIR, buildload.FDE_DIR,
                     buildload.SKILLSMAP_JSON):
            self.assertTrue(path.startswith(buildload.CORPUS), path)

    def test_build_still_exposes_load_corpus_and_the_paths(self):
        import build
        self.assertIs(build.load_corpus, buildload.load_corpus)
        self.assertEqual(build.SKILLSMAP_JSON, buildload.SKILLSMAP_JSON)
        self.assertEqual(build.SEG_DIR, buildload.SEG_DIR)


if __name__ == "__main__":
    unittest.main()
