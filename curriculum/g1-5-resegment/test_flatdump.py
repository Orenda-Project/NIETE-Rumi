r"""The flat dump's `Day #` column is a machine-readable marker, not a caption.

"All Segments + SLOs" is the tab scripts read. The matrix convention is that a
row is identified by its marker in the first column and never by its position,
so `^Day \d+` is how a counting script finds the teaching days — and until this
was fixed the flat tab answered 1695 for a year that teaches 1657.

The 38 extra were chapter-review rows whose `day_label` came off the corpus as
`Day 8 (Review)`. They matched the pattern. Two more spellings of the same row
type sat beside them — `Chapter Review` (71) and `Review Day` (12) — so the tab
labelled one row type three ways, and one of the three lied to a regex. The
subject tabs never had the bug: they write `📋 Ch. Review` and
`✅ Ch. Assessment`, which cannot match a day pattern.

So the assertions below are the invariant, not the symptom:

  * NO ROW MATCHES `^Day \d+` UNLESS `Row type` SAYS IT IS A TEACHING DAY, and
    the two counts are equal. A future label like `Day 8 (Revision)` fails this
    without anybody having to think of it first.
  * THE MARKER IS THE SUBJECT TABS' MARKER. `tabs.tail_label` is the one place
    the two strings live; a copy here would be a third convention waiting to
    drift from the two it was meant to reconcile.
  * `Row type` STAYS THE ORACLE. It carried the truth all along, which is why
    the fix was safe: the live build reads day 1658 / assessment 145 /
    review 121 there, and the pattern count now agrees with it.
"""
import os
import re
import unittest

import support
import tabs

HERE = os.path.dirname(os.path.abspath(__file__))
HAVE_CORPUS = os.path.isdir(os.path.join(HERE, "corpus", "seg"))

DAY = re.compile(r"^Day \d+")


def row(kind, day_label, subject="English", grade=1):
    """A segment row with the fifteen fields the flat dump reads."""
    return {"grade": grade, "subject": subject,
            "book": f"grade_{grade}_{subject.lower()}", "chapter": 1,
            "chapter_title": "Chapter 1", "kind": kind,
            "day_label": day_label, "topic": "Topic", "skill_type": "Phonics",
            "pages": "3–4", "primary_slo": "E-1", "primary_slo_desc": "Read",
            "supporting_slos": "", "blooms": "Understand", "flags": ""}


def corpus():
    """Every spelling the live corpus carries, including the one that lies."""
    return [row("day", "Day 1"),
            row("day", "Day 2"),
            row("review", "Day 8 (Review)"),
            row("review", "Chapter Review"),
            row("review", "Review Day"),
            row("assessment", "Assessment")]


def flat(rows):
    """(header, body, Day # index, Row type index)."""
    out = support.all_segments(rows)
    head = out[0]
    return head, out[1:], head.index("Day #"), head.index("Row type")


class TheDayMarkerMeansATeachingDayAndNothingElse(unittest.TestCase):

    def setUp(self):
        self.head, self.body, self.day_c, self.kind_c = flat(corpus())

    def test_no_row_matches_the_day_pattern_unless_it_is_a_teaching_day(self):
        for r in self.body:
            if DAY.match(str(r[self.day_c])):
                self.assertEqual(r[self.kind_c], "day", r)

    def test_the_day_pattern_counts_exactly_the_teaching_days(self):
        # The equality is the point: a marker that matches too few rows is as
        # wrong as one that matches too many, and only one number can be right.
        matched = [r for r in self.body if DAY.match(str(r[self.day_c]))]
        days = [r for r in self.body if r[self.kind_c] == "day"]
        self.assertEqual(len(matched), len(days))

    def test_a_teaching_day_keeps_the_label_the_corpus_gave_it(self):
        # The fix must not reach the 1,657 rows that were already right.
        days = [r[self.day_c] for r in self.body if r[self.kind_c] == "day"]
        self.assertEqual(days, ["Day 1", "Day 2"])

    def test_every_row_still_names_its_row_type(self):
        # `Row type` is the oracle the fix was checked against; a marker that
        # overwrote it would take the check away with it.
        self.assertEqual([r[self.kind_c] for r in self.body],
                         ["day", "day", "review", "review", "review",
                          "assessment"])


class TheTailRowsCarryTheSubjectTabsMarker(unittest.TestCase):

    def setUp(self):
        self.head, self.body, self.day_c, self.kind_c = flat(corpus())

    def _labels(self, kind):
        return {r[self.day_c] for r in self.body if r[self.kind_c] == kind}

    def test_one_row_type_is_spelled_one_way(self):
        # Three spellings of a review row is what made the column unparseable.
        self.assertEqual(len(self._labels("review")), 1, self._labels("review"))

    def test_the_review_marker_is_the_one_the_subject_tabs_write(self):
        self.assertEqual(self._labels("review"), {"📋 Ch. Review"})

    def test_the_assessment_marker_is_the_one_the_subject_tabs_write(self):
        self.assertEqual(self._labels("assessment"), {"✅ Ch. Assessment"})

    def test_both_tabs_read_the_marker_from_the_same_place(self):
        # Not "the strings are equal today" — the same function returns them,
        # so the two surfaces cannot drift apart in a later pass.
        self.assertEqual(self._labels("review"), {tabs.tail_label("review")})
        self.assertEqual(self._labels("assessment"),
                         {tabs.tail_label("assessment")})

    def test_the_marker_can_never_match_a_day_pattern(self):
        for kind in ("review", "assessment"):
            self.assertIsNone(DAY.match(tabs.tail_label(kind)))


@unittest.skipUnless(HAVE_CORPUS, "corpus/ is gitignored and not present")
class TheLiveBuildAgreesWithItsOwnRowTypes(unittest.TestCase):
    """The counting script's answer, against the tab's own oracle column."""

    @classmethod
    def setUpClass(cls):
        import buildload
        by_subject, _runs, _books, _breaks = buildload.load_corpus()
        rows = []
        for subject in ("English", "Urdu", "Maths", "Science"):
            for grade, book_rows, _stats in by_subject[subject]:
                for r in book_rows:
                    rows.append({**r, "grade": grade, "subject": subject})
        cls.head, cls.body, cls.day_c, cls.kind_c = flat(rows)

    def kinds(self, kind):
        return [r for r in self.body if r[self.kind_c] == kind]

    def test_the_year_teaches_the_days_the_row_types_count(self):
        # 1,695 before the fix: the 38 `Day N (Review)` rows matched too.
        # 1,658 since 19 Sep 2026: bd-4lx8q split one Grade 1 English day in
        # two, so the year teaches one more period than it did.
        matched = [r for r in self.body if DAY.match(str(r[self.day_c]))]
        self.assertEqual(len(matched), 1658)
        self.assertEqual(len(matched), len(self.kinds("day")))

    def test_the_chapter_tails_are_counted_where_they_belong(self):
        self.assertEqual(len(self.kinds("review")), 121)
        self.assertEqual(len(self.kinds("assessment")), 145)

    def test_urdu_contributes_no_chapter_tail_and_that_is_by_design(self):
        # Urdu's جائزہ and دہرائی days sit on ordinary Day rows; both tabs say
        # so. A zero here is the documented shape, not a row the fix dropped.
        urdu = [r for r in self.body
                if r[self.head.index("Subject")] == "Urdu"]
        self.assertTrue(urdu)
        for r in urdu:
            self.assertEqual(r[self.kind_c], "day", r)


if __name__ == "__main__":
    unittest.main()
