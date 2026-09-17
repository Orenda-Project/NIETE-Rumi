"""corpuscheck — the corpus is absent more often than it is corrupt.

The corpus is gitignored: page truth, the pipeline intermediates and every
rendered lesson plan are `restricted-educational-internal` and stay local. So
a fresh clone, or the same clone in a later session, has `corpus/` empty or
holding symlinks into a scratchpad directory that no longer exists — a dangling
link, which `os.path.exists` reports exactly as it reports nothing at all.

What the build did with that was open a glob over a missing directory, find no
books, and write four empty subject tabs over the live sheet without a word.
The quieter failure is the dangling symlink, which reaches `fde.load` and comes
back as `FileNotFoundError` on a path nobody recognises.

So the check runs before the first read and says the three things the reader
needs: which path, that it is a symlink to nowhere if it is, and that
CORPUS_DIR is the env var that moves it.
"""
import os
import unittest

import corpuscheck


class TheCheckNamesThePathAndTheWayOut(unittest.TestCase):

    def setUp(self):
        self.tmp = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                ".test-corpus")
        os.makedirs(self.tmp, exist_ok=True)

    def tearDown(self):
        for name in os.listdir(self.tmp):
            os.unlink(os.path.join(self.tmp, name))
        os.rmdir(self.tmp)

    def test_a_missing_directory_is_reported_by_name(self):
        gone = os.path.join(self.tmp, "not-here")
        problems = corpuscheck.problems(seg=gone, fde=self.tmp,
                                        skillsmap=__file__)
        self.assertTrue(problems)
        self.assertIn(gone, " ".join(problems))

    def test_a_dangling_symlink_says_so_rather_than_just_missing(self):
        # The failure this file exists for: the link is there, its target is
        # not, and "no such file" sends the reader looking at the link.
        link = os.path.join(self.tmp, "seg")
        os.symlink(os.path.join(self.tmp, "vanished"), link)
        problems = corpuscheck.problems(seg=link, fde=self.tmp,
                                        skillsmap=__file__)
        self.assertIn("symlink", " ".join(problems).lower())

    def test_every_problem_names_the_env_var_that_moves_the_corpus(self):
        problems = corpuscheck.problems(seg=os.path.join(self.tmp, "a"),
                                        fde=os.path.join(self.tmp, "b"),
                                        skillsmap=os.path.join(self.tmp, "c"))
        self.assertEqual(len(problems), 3)
        for line in problems:
            self.assertIn("CORPUS_DIR", line)

    def test_a_corpus_that_is_all_there_raises_nothing(self):
        stamp = os.path.join(self.tmp, "skillsmap.json")
        open(stamp, "w").write("{}")
        self.assertEqual(corpuscheck.problems(seg=self.tmp, fde=self.tmp,
                                              skillsmap=stamp), [])

    def test_require_stops_the_build_instead_of_writing_empty_tabs(self):
        # An empty corpus used to reach the sheet: four subject tabs cleared
        # and rewritten with nothing in them, on a live workbook.
        with self.assertRaises(SystemExit) as caught:
            corpuscheck.require(seg=os.path.join(self.tmp, "a"), fde=self.tmp,
                                skillsmap=__file__)
        self.assertIn("CORPUS_DIR", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
