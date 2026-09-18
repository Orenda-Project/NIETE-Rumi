"""The page-truth fetch has to survive the network, and land in one place.

Two failures already happened, one each way. The first run wrote 276 files
into `curriculum/corpus-local/` instead of the build's own `corpus-local/`,
because `corpus/seg` is a symlink and a symlink's target resolves relative to
the LINK's directory, not to the module that reads it. The second died whole
on a single `socket.timeout` — one thread's exception comes back out of
`pool.map`, so sixteen healthy books stopped because one read dropped.

Neither is reachable by a test that needs Drive. What is testable is the part
that decides: where the files go, which books are asked for, and how a
transient failure is treated. That is what is pinned here.
"""
import os
import socket
import unittest

import fetchtruth


class TheDestination(unittest.TestCase):
    """The symlink trap, stated as an assertion rather than a comment."""

    def test_pages_land_inside_this_build_directory(self):
        here = os.path.dirname(os.path.abspath(fetchtruth.__file__))
        self.assertEqual(os.path.dirname(os.path.dirname(fetchtruth.OUT)),
                         here)

    def test_it_writes_beside_the_segmentation_corpus_not_above_it(self):
        # `corpus/seg` points at `../corpus-local/seg` FROM `corpus/`, which
        # is this directory — not the parent. Resolving it the other way is
        # how 276 files went to the wrong tree.
        here = os.path.dirname(os.path.abspath(fetchtruth.__file__))
        self.assertTrue(fetchtruth.OUT.startswith(
            os.path.join(here, "corpus-local") + os.sep))

    def test_the_path_is_gitignored_because_the_corpus_is_restricted(self):
        # NBF/FBISE copyright, and NIETE-Rumi is a PUBLIC fork. If this ever
        # moves, the .gitignore entry moves with it or the corpus ships.
        with open(os.path.join(os.path.dirname(os.path.dirname(
                os.path.abspath(fetchtruth.__file__))), ".gitignore")) as fh:
            self.assertIn("corpus-local/", fh.read())


class TheBooksItAsksFor(unittest.TestCase):
    """Seventeen, and only the seventeen this build segments."""

    def test_there_are_seventeen(self):
        self.assertEqual(len(fetchtruth.IN_SCOPE), 17)

    def test_every_grade_one_to_five_has_english_urdu_and_maths(self):
        for g in range(1, 6):
            got = [b for b in fetchtruth.IN_SCOPE if b.startswith(f"grade_{g}_")]
            self.assertTrue(any("english" in b for b in got), g)
            self.assertTrue(any("urdu" in b for b in got), g)
            self.assertTrue(any("math" in b for b in got), g)

    def test_science_is_grades_four_and_five_only(self):
        # Operator, 2026-09-04: Science means G4-5 General Science.
        self.assertEqual(
            sorted(b for b in fetchtruth.IN_SCOPE if "science" in b),
            ["grade_4_general_science", "grade_5_general_science"])

    def test_the_out_of_scope_subjects_in_the_drive_tree_are_not_asked_for(self):
        # 01_page_truth holds 27 books. Ten of them are not this build's.
        for subject in ("islamiat", "social_studies", "general_knowledge"):
            self.assertEqual([b for b in fetchtruth.IN_SCOPE if subject in b],
                             [], subject)


class Retrying(unittest.TestCase):
    """A dropped read is weather, not a reason to stop."""

    def setUp(self):
        self.slept = []

    def sleep(self, s):
        self.slept.append(s)

    def run_with(self, op, **kw):
        kw.setdefault("sleep", self.sleep)
        kw.setdefault("jitter", lambda: 0.5)
        return fetchtruth.with_retry(op, **kw)

    def test_a_call_that_works_is_not_retried(self):
        calls = []
        self.assertEqual(self.run_with(lambda: calls.append(1) or "ok"), "ok")
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.slept, [])

    def test_a_timeout_is_retried_and_the_later_answer_is_kept(self):
        seen = []

        def flaky():
            seen.append(1)
            if len(seen) < 3:
                raise socket.timeout("read timed out")
            return "page"

        self.assertEqual(self.run_with(flaky), "page")
        self.assertEqual(len(seen), 3)

    def test_it_waits_longer_each_time(self):
        def always():
            raise socket.timeout("read timed out")

        with self.assertRaises(socket.timeout):
            self.run_with(always)
        self.assertEqual(self.slept, sorted(self.slept))
        self.assertGreater(self.slept[-1], self.slept[0])

    def test_it_gives_up_rather_than_hammering_drive_forever(self):
        seen = []

        def always():
            seen.append(1)
            raise socket.timeout("read timed out")

        with self.assertRaises(socket.timeout):
            self.run_with(always, attempts=4)
        self.assertEqual(len(seen), 4)

    def test_a_permission_error_is_not_retried(self):
        # Retrying a 403 fails four times slower and buries the one message
        # that says what is actually wrong.
        seen = []

        def denied():
            seen.append(1)
            raise ValueError("insufficient permissions")

        with self.assertRaises(ValueError):
            self.run_with(denied)
        self.assertEqual(len(seen), 1)


class OneBookCannotTakeTheRunDown(unittest.TestCase):
    """The second failure: sixteen healthy books stopped for one dropped read."""

    def test_a_failed_book_comes_back_as_a_value_not_an_exception(self):
        def boom(*_a):
            raise socket.timeout("read timed out")

        real, fetchtruth.book = fetchtruth.book, boom
        try:
            name, got, skip, err = fetchtruth.attempt("grade_1_urdu", "x")
        finally:
            fetchtruth.book = real
        self.assertEqual((name, got, skip), ("grade_1_urdu", 0, 0))
        self.assertIn("timeout", err)

    def test_a_book_that_worked_reports_no_error(self):
        real, fetchtruth.book = fetchtruth.book, lambda n, f: (n, 5, 2)
        try:
            self.assertEqual(fetchtruth.attempt("grade_1_urdu", "x"),
                             ("grade_1_urdu", 5, 2, None))
        finally:
            fetchtruth.book = real


if __name__ == "__main__":
    unittest.main()
