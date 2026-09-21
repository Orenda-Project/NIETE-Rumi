"""stageb.load_book over the real corpus -- what the period rules may touch.

Split out of test_stageb_order.py on 2026-09-21, when Rule 3 opened to
Grades 2-5 English and Maths (bd-2ctk6) and pushed that file past the
300-line limit. The other half keeps `order_segments` on hand-built
fixtures; this one holds every guarantee that reads the books on disk.
"""
import json
import os
import unittest

import skills
import stageb

# --------------------------------------------------------------------------
# load_book runs every period rule over every book, so the grades no period
# rule is meant to touch have to come out of it with the same days, in the
# same order, saying the same thing. Against the real corpus, when this
# machine has it.
#
# The only sanctioned differences are the three CPA rules, and each is allowed
# by name and by direction: cparamp renames the bridge to `abstract`; cpatrust
# drops a concrete label the page does not support, marking what the page said
# instead; cpaopen opens a chapter that has none in children's hands, moving
# the phase with the skill type and recording what they hold. The last two run
# in that order on purpose and may both touch the same day: Grade 5's chapter
# openers were labelled concrete off a section heading, so the day is demoted
# on the page's word and then opened honestly with counters, ending at the
# same skill type by a different route and carrying both marks. Any other
# edited field, any other renaming, and any change at all to English fails.
# --------------------------------------------------------------------------

SEG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "corpus", "seg")
HAVE_CORPUS = os.path.isdir(SEG)


def stems(*words):
    """English is spelled one way; Maths is `maths` in Grade 1 and `math` in
    Grades 2-5. Glob rather than hardcode, so a renamed book is not silently
    dropped out of the guarantee."""
    found = []
    for name in sorted(os.listdir(SEG)):
        stem = name[:-5]
        if name.endswith(".json") and stem.rsplit("_", 1)[-1] in words:
            found.append(stem)
    return found


ABSTRACT = {"skill_type": ("pictorial_abstract", "abstract")}
CONCRETE_FROM = ("pictorial", "pictorial_abstract")
PAGE_READ = ("pictorial", "pictorial_abstract", "abstract")
FIELDS = {"skill_type", "cpa_phase", "concrete_added", "page_phase"}


def marked(changed, field):
    return bool((changed.get(field, (None, ""))[1] or "").strip())


def re_read(changed):
    """cpatrust: a concrete claim the page denies, demoted to what it says.

    `abstract` is reachable here because cparamp may rename the bridge this
    rule just put the day on — one day, two renames, both by the book.
    """
    was, now = changed.get("skill_type", (None, None))
    if was != "concrete" or now not in PAGE_READ:
        return False
    if "cpa_phase" in changed:
        return False
    return marked(changed, "page_phase") and set(changed) <= FIELDS


def opened(changed):
    """cpaopen, on its own or on a day cpatrust has just re-read.

    A day that comes out concrete having gone in concrete is only allowed
    when it carries the page mark: it means the heading's claim was dropped
    and the day re-opened on our own evidence, with the kit named.
    """
    was, now = changed.get("skill_type", ("concrete", "concrete"))
    if now != "concrete" or was not in CONCRETE_FROM + ("concrete",):
        return False
    if changed.get("cpa_phase", (None, "concrete"))[1] != "concrete":
        return False
    if not marked(changed, "concrete_added"):
        return False
    if was == "concrete" and not marked(changed, "page_phase"):
        return False
    return set(changed) <= FIELDS


def is_the_ramp(changed):
    """True when one day's changes are the CPA ramp and nothing else."""
    return changed == ABSTRACT or re_read(changed) or opened(changed)


@unittest.skipUnless(HAVE_CORPUS, "corpus/ is gitignored and not present")
class GradesTwoToFiveEnglishAndMathsFoldAndRampAndNothingElse(unittest.TestCase):
    """Until 2026-09-21 this class was called ...KeepEveryPeriodTheyCameWith
    and asserted the opposite: the fold stopped at Grade 1 and these eight
    books came out of load_book the same length they went in. Amena folded
    the remaining 103 revision periods (bd-2ctk6), so the guarantee is now
    the narrower one -- the fold and the CPA ramp are the ONLY things that
    touch these books, and both are accounted for by name.
    """

    #: Revision periods each book gives up. Pinned per book rather than as a
    #: total: a total can be right while two books are wrong in opposite
    #: directions.
    FOLDED = {"grade_2_english": 12, "grade_2_math": 15,
              "grade_3_english": 12, "grade_3_math": 15,
              "grade_4_english": 12, "grade_4_math": 11,
              "grade_5_english": 14, "grade_5_math": 12}

    #: What `dayfold._absorb` writes onto the host day.
    FOLD_FIELDS = ("revision_folded", "fold_note", "notes",
                   "slo_codes", "slo_descriptions", "folded_slo_codes")

    def diffs(self, stem):
        """(dropped rows, [(day, changed fields)]) for the rows that survive.

        Aligned on (chapter_number, segment_index), never on position. The
        fold removes rows, so zipping the before and after lists compares
        day 8 against day 9 from the revision onward and reports the rest of
        the book as rewritten -- which is exactly what it did on the first
        run of this change. `segment_index` alone will not do either: it
        restarts at each chapter, which is why `dayobj.key` joins on the
        pair and not on the index.
        """
        path = os.path.join(SEG, f"{stem}.json")
        with open(path) as fh:
            before = stageb.order_segments(json.load(fh)["segments"])
        _stem, _grade, _subject, _meta, after = stageb.load_book(path)
        key = lambda s: (s.get("chapter_number"), s.get("segment_index"))
        self.assertEqual(len(set(map(key, before))), len(before),
                         f"{stem}: (chapter, segment_index) is not unique")
        now_by = {key(s): s for s in after}
        dropped = [s for s in before if key(s) not in now_by]
        out = []
        for was in before:
            now = now_by.get(key(was))
            if now is None:
                continue
            changed = {f: (was.get(f), now.get(f)) for f in set(was) | set(now)
                       if was.get(f) != now.get(f)}
            if changed:
                out.append((now.get("day_label"), changed))
        return dropped, out

    def not_the_fold(self, changed):
        """`changed` with the fold's own fields taken out.

        A host day is allowed to gain the revision's SLOs and say so. What
        it is not allowed to do is gain anything else, so the fold fields
        are removed and whatever is left has to answer for itself.
        """
        return {f: v for f, v in changed.items() if f not in self.FOLD_FIELDS}

    def test_each_book_gives_up_exactly_its_revision_periods(self):
        got = {}
        for stem, _n in self.FOLDED.items():
            dropped, _changed = self.diffs(stem)
            got[stem] = len(dropped)
            for seg in dropped:
                self.assertEqual(
                    skills.canonical(seg.get("skill_type"),
                                     stageb.book_meta(stem)[1]),
                    skills.canonical("revision",
                                     stageb.book_meta(stem)[1]),
                    f"{stem} dropped a row that is not a revision: "
                    f"{seg.get('day_label')} {seg.get('skill_type')}")
        self.assertEqual(got, self.FOLDED)
        self.assertEqual(sum(got.values()), 103)

    def test_the_four_upper_english_books_change_only_by_the_fold(self):
        names = [n for n in stems("english") if "grade_1_" not in n]
        self.assertEqual(len(names), 4)
        for stem in names:
            _dropped, changes = self.diffs(stem)
            self.assertEqual(len(changes), self.FOLDED[stem], stem)
            for label, changed in changes:
                self.assertEqual(self.not_the_fold(changed), {},
                                 f"{stem} {label}: load_book also changed "
                                 f"{self.not_the_fold(changed)}")

    def test_the_four_upper_maths_books_change_by_the_fold_and_the_ramp(self):
        names = [n for n in stems("math", "maths") if "grade_1_" not in n]
        self.assertEqual(len(names), 4)
        for stem in names:
            _dropped, changes = self.diffs(stem)
            for label, changed in changes:
                rest = self.not_the_fold(changed)
                self.assertTrue(not rest or is_the_ramp(rest),
                                f"{stem} {label}: load_book changed {rest}")

    def test_the_fold_leaves_no_day_label_hole_in_these_books(self):
        """bd-6kp1a closed a hole the Urdu fold left. These eight books
        never had one, and the reason is worth pinning: their revision is
        the LAST numbered day of the chapter (the assessment that follows it
        is captioned `Assessment` or `Chapter Review`, with no day number).
        Drop Day 8 of 8 and the days still read 1..7. If a future book puts
        its revision mid-chapter, this fails and `renumber_days` is the fix
        -- it already runs, it simply has nothing to do here today.
        """
        for stem in self.FOLDED:
            _dropped, changes = self.diffs(stem)
            for label, changed in changes:
                self.assertNotIn("day_label", changed, f"{stem} {label}")

    def test_no_slo_code_is_lost_when_these_books_fold(self):
        for stem in self.FOLDED:
            path = os.path.join(SEG, f"{stem}.json")
            with open(path) as fh:
                before = json.load(fh)["segments"]
            _s, _g, _sub, _m, after = stageb.load_book(path)
            codes = lambda rows: {c for s in rows
                                  for c in s.get("slo_codes") or []}
            self.assertEqual(codes(before), codes(after), stem)

    def test_all_three_ramp_rules_reach_the_upper_grades(self):
        """Otherwise the test above passes by touching nothing at all. One
        name per rule, so a rule that stops firing is reported by name rather
        than hidden inside a set the other two still satisfy."""
        ran = set()
        for stem in stems("math", "maths"):
            if "grade_1_" in stem:
                continue
            _dropped, changes = self.diffs(stem)
            for _label, changed in changes:
                rest = self.not_the_fold(changed)
                if rest == ABSTRACT:
                    ran.add("cparamp")
                if marked(rest, "page_phase"):
                    ran.add("cpatrust")
                if marked(rest, "concrete_added"):
                    ran.add("cpaopen")
        self.assertEqual(ran, {"cparamp", "cpatrust", "cpaopen"},
                         f"the upper grades only reach {sorted(ran)}")


@unittest.skipUnless(HAVE_CORPUS, "corpus/ is gitignored and not present")
class GradeOneEnglishAndMathsAreFoldedAtTheDoor(unittest.TestCase):
    """The calendar, the subject tab, Coverage and the FDE tab all read
    load_book, so this is the one place the fold can live and have every tab
    agree on how many periods Grade 1 has."""

    def counts(self, stem):
        path = os.path.join(SEG, f"{stem}.json")
        with open(path) as fh:
            raw = stageb.order_segments(json.load(fh)["segments"])
        _s, _g, _sub, _m, out = stageb.load_book(path)
        codes = lambda rows: {c for s in rows for c in s.get("slo_codes") or []}
        return len(raw), len(out), codes(raw) == codes(out)

    def test_grade_1_english_comes_out_at_99_with_every_slo(self):
        # 111/99 since 19 Sep 2026, not 110/98: bd-4lx8q split chapter 1's
        # day 5 in two. It carried a rhyme SLO and a days-of-the-week SLO
        # that have nothing to do with each other, so the book teaches one
        # more period than it did. The freed count is unchanged -- the split
        # added a teaching day, not a revision row.
        self.assertEqual(self.counts("grade_1_english"), (111, 99, True))

    def test_grade_1_maths_comes_out_at_128_with_every_slo(self):
        self.assertEqual(self.counts("grade_1_maths"), (143, 128, True))


if __name__ == "__main__":
    unittest.main()
