# -*- coding: utf-8 -*-
"""bd-6kp1a — a folded day must leave no hole and no silence behind it.

Rule 3 folds each Urdu chapter's revision into its last teaching day and
frees the period. The fold works: the SLOs and the review move across, and
88 Urdu periods come back. What it left behind was a chapter that counts
Day 1 .. Day 9 and then says Day 11.

`day_label` is baked at split time, BEFORE the fold, and `stageb` never
renumbered after it. So the assessment kept the number it had when the
revision still owned a period, and the gap sat on the sheet exactly where a
missing day would sit. Reading the tab back, that is indistinguishable from
88 lost rows -- which is how it was first reported. A reviewer costing the
Urdu year off this tab has to know a fold happened to know the hole is not
a hole, and nothing on the tab told them: `_absorb` wrote its note into
`seg["notes"]`, `stageb` copied it into the row dict, and no column ever
read it. The one visible trace was four supporting SLOs appearing on the
chapter's last teaching day for no stated reason.

So: renumber after the fold, and say on the row that the fold happened.

WHAT IS DELIBERATELY NOT DONE HERE: `segsplit.renumber` already renumbers
day labels and would have been the obvious call. It also renumbers
`segment_index`, and `dayobj.key` joins objectives on
(chapter_number, segment_index). Reusing it would have silently rekeyed
every objective in the corpus to fix a caption.
"""
import json
import os
import unittest

import dayfold
import stageb

HERE = os.path.dirname(os.path.abspath(__file__))
SEG = os.path.join(HERE, "corpus", "seg")


def seg(ch, label, skill, idx, **kw):
    return dict({"chapter_number": ch, "day_label": label,
                 "skill_type": skill, "segment_index": idx,
                 "slo_codes": [], "pages_printed": [], "notes": ""}, **kw)


def chapter(ch, first_idx=1, day1=1):
    """Teaching days, then the assessment, then the revision.

    That order is the corpus's, and it is worth stating because it looks
    wrong: the row STORED last is numbered second-to-last. Every Urdu
    chapter reads `... Day 7, Day 9 [assessment], Day 8 [duhrai]`. The
    calendar order is the numbers; the file order is not. Renumbering
    walks the file, so after the fold takes the revision out, the
    assessment is simply the last row left and gets the last number --
    which is the number it should have had all along.
    """
    return [
        seg(ch, "Day %d" % day1, "buland_khwani", first_idx,
            slo_codes=["U-05-RD-01"]),
        seg(ch, "Day %d" % (day1 + 1), "tafheem", first_idx + 1,
            slo_codes=["U-05-CO-01"]),
        seg(ch, "Day %d" % (day1 + 2), "takhleeqi_likhai", first_idx + 2,
            slo_codes=["U-05-WR-01"]),
        seg(ch, "Day %d" % (day1 + 4), "assessment", 995,
            topic=u"سبق کا جائزہ", slo_codes=["U-05-RD-01"]),
        seg(ch, "Day %d" % (day1 + 3), "duhrai", 990,
            topic=u"دُہرائی — پورے سبق کا اعادہ",
            slo_codes=["U-05-RD-01", "U-05-GR-02"]),
    ]


def labels(segments):
    return [s["day_label"] for s in segments]


class TheHoleAFoldLeaves(unittest.TestCase):

    def setUp(self):
        folded, self.freed = dayfold.fold_revision(chapter(9), "Urdu")
        self.folded = folded

    def test_the_fold_itself_still_frees_the_period(self):
        self.assertEqual(self.freed, 1)
        self.assertEqual(len(self.folded), 4)

    def test_unrenumbered_the_assessment_keeps_its_pre_fold_number(self):
        # The defect, stated: four rows, and the last one says Day 5.
        self.assertEqual(labels(self.folded), ["Day 1", "Day 2", "Day 3",
                                               "Day 5"])

    def test_renumbering_closes_it(self):
        out = dayfold.renumber_days(self.folded)
        self.assertEqual(labels(out), ["Day 1", "Day 2", "Day 3", "Day 4"])


class WhatRenumberingMustNotTouch(unittest.TestCase):

    def test_the_segment_index_is_left_alone(self):
        # dayobj.key joins objectives on (chapter_number, segment_index).
        # Renumbering a caption must not rekey the corpus.
        rows = chapter(9)
        out = dayfold.renumber_days(rows)
        self.assertEqual([s["segment_index"] for s in out],
                         [1, 2, 3, 995, 990])

    def test_the_input_is_not_mutated(self):
        rows = chapter(9)
        dayfold.renumber_days(dayfold.fold_revision(rows, "Urdu")[0])
        self.assertEqual(labels(rows),
                         ["Day 1", "Day 2", "Day 3", "Day 5", "Day 4"])

    def test_a_label_that_is_not_a_day_is_stepped_over(self):
        rows = [seg(1, "Day 1", "tafheem", 1),
                seg(1, "Assessment", "assessment", 995),
                seg(1, "Day 3", "tafheem", 2)]
        self.assertEqual(labels(dayfold.renumber_days(rows)),
                         ["Day 1", "Assessment", "Day 2"])

    def test_a_suffix_on_the_label_survives(self):
        rows = [seg(1, "Day 2 (Review)", "tafheem", 1)]
        self.assertEqual(labels(dayfold.renumber_days(rows)),
                         ["Day 1 (Review)"])

    def test_a_row_with_no_label_is_left_as_it_is(self):
        rows = [seg(1, "", "tafheem", 1), seg(1, "Day 2", "tafheem", 2)]
        self.assertEqual(labels(dayfold.renumber_days(rows)), ["", "Day 1"])


class TheCountResetsAtEachChapter(unittest.TestCase):

    def test_two_chapters_each_start_at_day_one(self):
        rows = chapter(9) + chapter(10, first_idx=10)
        out = dayfold.renumber_days(
            dayfold.fold_revision(rows, "Urdu")[0])
        self.assertEqual(labels(out), ["Day 1", "Day 2", "Day 3", "Day 4",
                                       "Day 1", "Day 2", "Day 3", "Day 4"])

    def test_a_book_with_nothing_folded_comes_back_unchanged(self):
        rows = [seg(1, "Day 1", "tafheem", 1), seg(1, "Day 2", "tafheem", 2)]
        self.assertEqual(labels(dayfold.renumber_days(rows)),
                         ["Day 1", "Day 2"])


class TheBookKeepsItsOwnNumberingScheme(unittest.TestCase):
    """Grade 4 Urdu counts days across the whole book -- its chapters open
    at Day 1, 10, 17, 21, 30, 38, 46, 53, and that is what its tab shows.
    Every other language book counts within the chapter. Closing a fold's
    hole is not a licence to convert one book to the other's scheme."""

    def test_a_per_chapter_book_is_recognised(self):
        rows = chapter(1) + chapter(2, first_idx=10)
        self.assertTrue(dayfold.numbering_scheme(rows))

    def test_a_book_continuous_book_is_recognised(self):
        rows = chapter(1) + chapter(2, first_idx=10, day1=6)
        self.assertFalse(dayfold.numbering_scheme(rows))

    def test_a_book_continuous_book_stays_continuous(self):
        rows = chapter(1) + chapter(2, first_idx=10, day1=6)
        out = dayfold.renumber_days(
            dayfold.fold_revision(rows, "Urdu")[0], per_chapter=False)
        # One count, the length of the book, with the freed period closed
        # up: chapter 2 now opens at 5 rather than 6.
        self.assertEqual(labels(out), ["Day 1", "Day 2", "Day 3", "Day 4",
                                       "Day 5", "Day 6", "Day 7", "Day 8"])

    def test_it_resumes_from_the_number_the_book_opened_on(self):
        rows = chapter(1, day1=4)
        out = dayfold.renumber_days(rows, per_chapter=False)
        self.assertEqual(labels(out)[0], "Day 4")

    def test_the_scheme_must_be_read_before_the_fold(self):
        # Grade 1 Maths opens chapters 2 onward with a revision day
        # captioned `Day 1`. Fold it away and the chapter looks like it
        # starts at Day 2, which reads exactly like a continuous book.
        rows = [seg(1, "Day 1", "concrete", 1),
                seg(2, "Day 1", "revision", 990),
                seg(2, "Day 2", "concrete", 2)]
        self.assertTrue(dayfold.numbering_scheme(rows))
        folded = dayfold.fold_revision(rows, "Maths", 1)[0]
        self.assertFalse(dayfold.numbering_scheme(folded))


class TheFoldIsVisibleOnTheRowThatAbsorbedIt(unittest.TestCase):
    """A reviewer must not have to know the pipeline to read the tab."""

    def _host(self):
        folded, _ = dayfold.fold_revision(chapter(9), "Urdu")
        return folded[-2]

    def test_the_host_day_carries_a_fold_note_naming_the_revision(self):
        host = self._host()
        self.assertTrue(host.get("fold_note"))
        self.assertIn(u"دہرائی", host["fold_note"])
        self.assertIn(u"اعادہ", host["fold_note"])

    def test_the_note_does_not_disturb_an_existing_note(self):
        rows = chapter(9)
        rows[2]["notes"] = "copy work"
        folded, _ = dayfold.fold_revision(rows, "Urdu")
        host = folded[-2]
        self.assertIn("copy work", host["notes"])
        self.assertNotIn("copy work", host["fold_note"])

    def test_it_reaches_the_flags_column(self):
        # day_flags returns the joined cell, not the list.
        host = self._host()
        flags = stageb.day_flags(host, {"new_codes": []}, [])
        self.assertIn(u"دہرائی", flags)
        self.assertIn(u"اعادہ", flags)

    def test_an_ordinary_day_is_not_flagged(self):
        folded, _ = dayfold.fold_revision(chapter(9), "Urdu")
        flags = stageb.day_flags(folded[0], {"new_codes": []}, [])
        self.assertNotIn("folded", flags)


class AgainstTheRealUrduBooks(unittest.TestCase):

    def book(self, stem):
        p = os.path.join(SEG, stem + ".json")
        if not os.path.exists(p):
            self.skipTest("corpus not on this machine")
        d = json.load(open(p))
        return d["segments"] if isinstance(d, dict) else d

    def numbers(self, out):
        seen, book = {}, []
        for s in out:
            lab = str(s.get("day_label") or "")
            if not lab.startswith("Day "):
                continue
            n = int(lab.split()[1])
            seen.setdefault(s.get("chapter_number"), []).append(n)
            book.append(n)
        return seen, book

    def test_every_urdu_book_counts_its_days_without_a_gap(self):
        holes, schemes = [], {}
        for g in range(1, 6):
            stem = "grade_%d_urdu" % g
            rows = self.book(stem)
            scheme = dayfold.numbering_scheme(rows)
            schemes[stem] = scheme
            out = dayfold.renumber_days(
                dayfold.fold_revision(rows, "Urdu", g)[0], scheme)
            seen, book = self.numbers(out)
            if scheme:
                for ch, nums in seen.items():
                    if nums != list(range(1, len(nums) + 1)):
                        holes.append((stem, ch, nums))
            elif book != list(range(1, len(book) + 1)):
                holes.append((stem, "book", book[:12]))
        self.assertEqual(holes, [])
        # And the schemes themselves are what the tab shows today.
        self.assertEqual(schemes, {"grade_1_urdu": True, "grade_2_urdu": True,
                                   "grade_3_urdu": True,
                                   "grade_4_urdu": False,
                                   "grade_5_urdu": True})


if __name__ == "__main__":
    unittest.main()
