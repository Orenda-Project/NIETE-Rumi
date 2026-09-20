"""Can the judge reach a lesson whose segment row does not exist on disk?

Every other lesson in this build is named by a row in `corpus/seg/<book>.json`,
and `judgerun.main` finds its work by reading that file. A basics period has no
row there and never will: `basicseg` synthesises it into a brief, because the
period is a calendar slot rather than a span of book. Point `judgerun` at
segment 801 and it reports "no authored artefact" — not because the artefact is
missing, but because it never found the segment to look for.

So the selection is what this module owns, and it is all this file tests. The
judging itself belongs to `judgerun` and is tested there; what is tested here is
that the right artefacts are chosen, that the ones not yet written are NAMED
rather than skipped in silence, and that subject and grade come off the brief
instead of off a flag somebody has to remember to type correctly.
"""
import json
import os
import shutil
import tempfile
import unittest

import basicsjudge


def brief(name, stem="grade_2_math", skill="number_fluency", grade=2,
          subject="Maths", chapter=1, index=801):
    return {
        "id": name,
        "name": name,
        "segment": {"segment_index": index, "chapter_number": chapter,
                    "skill_type": skill, "is_basics": True,
                    "duration_min": 40, "content_min": 30},
        "brief": {"envelope": {"book_stem": stem, "grade": grade,
                               "subject": subject, "chapter_number": chapter,
                               "skill_type": skill}},
    }


class Corpus(unittest.TestCase):

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.briefs = os.path.join(self.root, "briefs")
        self.authored = os.path.join(self.root, "authored")
        os.makedirs(self.briefs)
        os.makedirs(self.authored)

    def tearDown(self):
        shutil.rmtree(self.root)

    def write_brief(self, b):
        with open(os.path.join(self.briefs, b["name"] + ".json"), "w") as fh:
            json.dump(b, fh)
        return b

    def write_artefact(self, name):
        with open(os.path.join(self.authored, name + ".json"), "w") as fh:
            json.dump({"lesson_id": name, "generated": {}}, fh)


class ChoosingWhichBriefsToJudge(Corpus):

    def test_every_brief_on_disk_is_found(self):
        self.write_brief(brief("grade_2_math_ch1_seg801"))
        self.write_brief(brief("grade_2_math_ch2_seg802", chapter=2, index=802))
        self.assertEqual([b["name"] for b in basicsjudge.load(briefs=self.briefs)],
                         ["grade_2_math_ch1_seg801", "grade_2_math_ch2_seg802"])

    def test_a_book_narrows_the_list(self):
        self.write_brief(brief("grade_2_math_ch1_seg801"))
        self.write_brief(brief("grade_3_math_ch1_seg801", stem="grade_3_math",
                               grade=3))
        got = basicsjudge.load(stem="grade_3_math", briefs=self.briefs)
        self.assertEqual([b["name"] for b in got], ["grade_3_math_ch1_seg801"])

    def test_a_skill_narrows_the_list(self):
        self.write_brief(brief("grade_2_math_ch1_seg801"))
        self.write_brief(brief("grade_2_math_ch1_seg802", skill="word_problem",
                               index=802))
        got = basicsjudge.load(skill="word_problem", briefs=self.briefs)
        self.assertEqual([b["name"] for b in got], ["grade_2_math_ch1_seg802"])

    def test_names_pick_out_single_periods(self):
        self.write_brief(brief("grade_2_math_ch1_seg801"))
        self.write_brief(brief("grade_2_math_ch2_seg802", chapter=2, index=802))
        got = basicsjudge.load(names=["grade_2_math_ch2_seg802"],
                               briefs=self.briefs)
        self.assertEqual([b["name"] for b in got], ["grade_2_math_ch2_seg802"])

    def test_a_missing_brief_directory_is_not_an_error(self):
        self.assertEqual(basicsjudge.load(briefs=os.path.join(self.root, "no")),
                         [])


class WhatHasBeenWrittenAndWhatHasNot(Corpus):
    """An unwritten lesson is reported by name, never skipped quietly."""

    def test_a_brief_with_an_artefact_is_ready(self):
        b = self.write_brief(brief("grade_2_math_ch1_seg801"))
        self.write_artefact("grade_2_math_ch1_seg801")
        ready, missing = basicsjudge.work([b], authored=self.authored)
        self.assertEqual(missing, [])
        self.assertEqual(len(ready), 1)
        self.assertEqual(ready[0].path,
                         os.path.join(self.authored,
                                      "grade_2_math_ch1_seg801.json"))

    def test_a_brief_with_no_artefact_is_named_as_missing(self):
        b = self.write_brief(brief("grade_2_math_ch1_seg801"))
        ready, missing = basicsjudge.work([b], authored=self.authored)
        self.assertEqual(ready, [])
        self.assertEqual(missing, ["grade_2_math_ch1_seg801"])

    def test_the_artefact_is_named_after_the_brief(self):
        b = brief("grade_3_math_ch14_nf3_seg803")
        self.assertEqual(
            basicsjudge.authored_path(b, authored=self.authored),
            os.path.join(self.authored, "grade_3_math_ch14_nf3_seg803.json"))


class SubjectAndGradeComeOffTheBrief(Corpus):
    """`judgerun.main` makes the caller type these. Here they are already known."""

    def test_they_are_read_from_the_envelope(self):
        b = self.write_brief(brief("grade_3_math_ch1_seg801",
                                   stem="grade_3_math", grade=3))
        self.write_artefact("grade_3_math_ch1_seg801")
        ready, _ = basicsjudge.work([b], authored=self.authored)
        self.assertEqual((ready[0].stem, ready[0].grade, ready[0].subject),
                         ("grade_3_math", 3, "Maths"))

    def test_the_segment_travels_with_it(self):
        b = self.write_brief(brief("grade_2_math_ch1_seg801"))
        self.write_artefact("grade_2_math_ch1_seg801")
        ready, _ = basicsjudge.work([b], authored=self.authored)
        self.assertEqual(ready[0].segment["content_min"], 30)


class RunningTheJudge(Corpus):
    """The wiring: one page index per book, and the exit code the shell sees."""

    def setUp(self):
        Corpus.setUp(self)
        self.calls = []

    def fake_run(self, pairs, idx, subject, grade, **kw):
        self.calls.append((idx, subject, grade,
                           [os.path.basename(p) for p, _ in pairs]))
        return [{"stem": os.path.splitext(os.path.basename(p))[0],
                 "score": {"judge_pct": 95.0, "soft_pct": 100.0,
                           "composite_pct": 97.5},
                 "verdict": {"pass": self.passing, "reasons": []}}
                for p, _ in pairs]

    passing = True

    def run_main(self, argv):
        return basicsjudge.main(argv, briefs=self.briefs,
                                authored=self.authored,
                                index=lambda stem: "idx:" + stem,
                                run=self.fake_run)

    def test_one_page_index_is_built_per_book_not_per_lesson(self):
        for n, ch in (("grade_2_math_ch1_seg801", 1), ("grade_2_math_ch2_seg802", 2)):
            self.write_brief(brief(n, chapter=ch, index=800 + ch))
            self.write_artefact(n)
        self.run_main(["--book", "grade_2_math"])
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0][0], "idx:grade_2_math")

    def test_two_books_are_judged_against_their_own_indexes(self):
        self.write_brief(brief("grade_2_math_ch1_seg801"))
        self.write_artefact("grade_2_math_ch1_seg801")
        self.write_brief(brief("grade_3_math_ch1_seg801", stem="grade_3_math",
                               grade=3))
        self.write_artefact("grade_3_math_ch1_seg801")
        self.run_main([])
        self.assertEqual([c[0] for c in self.calls],
                         ["idx:grade_2_math", "idx:grade_3_math"])
        self.assertEqual([c[2] for c in self.calls], [2, 3])

    def test_all_passing_exits_zero(self):
        self.write_brief(brief("grade_2_math_ch1_seg801"))
        self.write_artefact("grade_2_math_ch1_seg801")
        self.assertEqual(self.run_main([]), 0)

    def test_a_failing_lesson_exits_one(self):
        self.passing = False
        self.write_brief(brief("grade_2_math_ch1_seg801"))
        self.write_artefact("grade_2_math_ch1_seg801")
        self.assertEqual(self.run_main([]), 1)

    def test_nothing_to_judge_exits_one_rather_than_claiming_success(self):
        # An empty run passing would read as "all basics lessons are good".
        self.write_brief(brief("grade_2_math_ch1_seg801"))
        self.assertEqual(self.run_main([]), 1)
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
