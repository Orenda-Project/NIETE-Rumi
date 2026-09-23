# -*- coding: utf-8 -*-
"""`judgerun --segments`: what it judged, and what it only appeared to judge.

bd-p8f1x. `test_judgerun.py` covers the judging itself -- the prompt, the
reply, the gate. This file covers the selection in front of it, which is the
part that decided, on a real run, that five lessons had been re-judged when
not one of them had been opened.

The corpus is two-sourced and always has been. A lesson that sits on a span
of book has a row in `corpus/seg/<book>.json`. A basics period is a calendar
slot rather than a span of book, so `basicseg.segment()` synthesises its row
into the brief and it appears in the segmentation corpus nowhere at all.
`judgerun.main` reads only the first source, which is correct -- `basicsjudge`
owns the second. The defect is not that the filter finds nothing. It is what
the filter did next: printed "judging 0 artefacts", printed "0/0 pass the
production gate", and exited 0.

`basicsjudge` already states the property being violated: "A brief with no
artefact yet is NAMED. A silent skip and a clean exit code is how a run of
thirty-six reports success having judged four." These tests hold `judgerun`
to the same two, and the last one holds the other direction -- naming a gap
must not become a way to stop judging the lessons that are there.
"""
import contextlib
import io
import sys
import unittest

import judgerun

#: The only book-row lessons in the authored corpus; every Maths artefact is
#: a basics period, which is the whole reason this file exists.
BOOK = "grade_1_english"


def run(*argv):
    """`judgerun.main` at its real entry point. Returns (exit code, stdout)."""
    old, out = sys.argv, io.StringIO()
    sys.argv = ["judgerun.py"] + list(argv)
    try:
        with contextlib.redirect_stdout(out):
            code = judgerun.main()
    finally:
        sys.argv = old
    return code, out.getvalue()


class ASegmentThatIsNotInTheBook(unittest.TestCase):
    """803 is a basics period. The book has rows 1-8, 990 and 995, never 803."""

    ARGV = ("--book", "grade_2_math", "--chapter", "2", "--subject", "Maths",
            "--grade", "2", "--segments", "803")

    def test_it_is_named(self):
        _, out = run(*self.ARGV)
        self.assertIn("803", out,
                      "a segment that was asked for and not found was not "
                      "mentioned at all:\n" + out)

    def test_the_run_does_not_report_success(self):
        code, out = run(*self.ARGV)
        self.assertNotEqual(0, code,
                            "judged nothing and exited 0:\n" + out)

    def test_the_name_points_at_where_a_basics_period_is_judged(self):
        _, out = run(*self.ARGV)
        self.assertIn("basicsjudge", out,
                      "named the gap but not the tool that closes it:\n" + out)


class ASegmentWithARowButNoArtefact(unittest.TestCase):
    """Already named -- "no authored artefact" -- but still exited 0."""

    def test_the_run_does_not_report_success(self):
        code, out = run("--book", BOOK, "--chapter", "1", "--subject",
                        "English", "--grade", "1", "--segments", "990")
        self.assertNotEqual(0, code, "judged nothing and exited 0:\n" + out)


class ARealSelectionStillReachesTheJudge(unittest.TestCase):
    """The other direction. No key and no spend: `run_batch` is substituted."""

    def test_the_pairs_are_built_and_handed_over(self):
        seen = {}

        def fake(pairs, idx, subject, grade, model=None, renders=None):
            seen["pairs"] = pairs
            seen["subject"], seen["grade"] = subject, grade
            return [{"stem": "grade_1_english_ch1_seg1",
                     "score": {"judge_pct": 91.2, "soft_pct": 100.0,
                               "composite_pct": 95.6},
                     "verdict": {"pass": True, "reasons": []}}]

        real = judgerun.run_batch
        judgerun.run_batch = fake
        try:
            code, out = run("--book", BOOK, "--chapter", "1", "--subject",
                            "English", "--grade", "1", "--segments", "1")
        finally:
            judgerun.run_batch = real

        self.assertEqual(1, len(seen.get("pairs") or []), out)
        self.assertEqual("English", seen["subject"])
        self.assertEqual(0, code, out)


if __name__ == "__main__":
    unittest.main()
