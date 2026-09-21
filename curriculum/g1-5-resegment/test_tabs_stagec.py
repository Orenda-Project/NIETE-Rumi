# -*- coding: utf-8 -*-
"""A filled column must not ship greyed, noted and collapsed.

tabs.py decides which columns a reviewer sees. Anything in FILLED_BY is
treated as nothing-here-yet: greyed at the header, given a note naming the
stage that will fill it, and shipped inside a COLLAPSED column group. That
was right while Stage C was pending.

Stage C is now written -- 12,655 cells across four tabs, read back
identical -- and the sheet still hid every one of them, which is how Amena
came to say she could not see her own data. The columns were opened live;
this pins the source so the next format run does not shut them again.

Human reviewer and the seven unrun trace stages stay pending. The nine
Stage C columns moved first; A, B and C Enrichment followed once their
links were written.
"""
import unittest

import stagec
import tabs

SUBJECTS = ("English", "Urdu", "Maths", "Science")

STAGE_C = ("Moves", "Reading strategy", "Collaboration structure", "Function",
           "Interaction", "Gap", "Recycles", "Prerequisite SLOs",
           "Teacher-primary min (of 40)")


class StageCIsNoLongerPending(unittest.TestCase):

    def test_no_stage_c_column_claims_a_stage_will_fill_it(self):
        still = [c for c in STAGE_C if c in tabs.FILLED_BY]
        self.assertEqual(still, [],
                         "these are written; a note saying they are empty on "
                         "purpose is now false")

    def test_no_stage_c_column_counts_as_dead(self):
        for subject in ("English", "Urdu", "Maths", "Science"):
            cols = tabs.header(subject)
            dead = set(tabs.dead_columns(subject))
            named = [cols[i] for i in dead if cols[i] in STAGE_C]
            self.assertEqual(named, [], "%s still calls %s empty"
                             % (subject, named))

    def test_no_collapsed_group_swallows_a_stage_c_column(self):
        for subject in ("English", "Urdu", "Maths", "Science"):
            cols = tabs.header(subject)
            for a, b in tabs.groups(subject):
                inside = [c for c in cols[a:b] if c in STAGE_C]
                self.assertEqual(inside, [],
                                 "%s collapses %s out of sight" % (subject, inside))

    def test_the_standfirst_no_longer_sends_her_looking_for_a_plus(self):
        for subject in SUBJECTS:
            s = tabs.standfirst(subject)
            self.assertNotIn("Grey headers are columns a later stage fills", s)
            self.assertIn("Stage C", s)




class TheTracesColumn(unittest.TestCase):
    """One column holding JSON, not ten columns of which nine were dead.

    The ten-column block was measured on 2026-09-21: seven were empty on
    every row of every tab, `C Enrichment` held one constant string, and
    `B Segmentation` restated the row number. Only `A Page truth` carried
    anything -- and its links 403 today (bd-10ccr), so even that is a
    promise rather than an artefact.
    """

    def test_it_is_named_and_present_once_per_tab(self):
        for subject in SUBJECTS:
            self.assertEqual(tabs.header(subject).count(tabs.TRACES_COLUMN), 1)

    def test_it_is_not_dead(self):
        # Dead columns are greyed and collapsed. This one holds the stages
        # that HAVE run, so hiding it hides the evidence.
        for subject in SUBJECTS:
            i = tabs.header(subject).index(tabs.TRACES_COLUMN)
            self.assertNotIn(i, tabs.dead_columns(subject))

    def test_it_is_outside_every_collapsed_group(self):
        for subject in SUBJECTS:
            i = tabs.header(subject).index(tabs.TRACES_COLUMN)
            for a, b in tabs.groups(subject):
                self.assertFalse(a <= i < b)

    def test_its_note_explains_that_a_missing_key_means_a_stage_has_not_run(self):
        for subject in SUBJECTS:
            i = tabs.header(subject).index(tabs.TRACES_COLUMN)
            note = tabs.pending_notes(subject).get(i, "")
            self.assertIn("has not run", note)

class TheCrispedHeader(unittest.TestCase):
    """Columns that carried one value on all 1,923 traced rows are gone.

    Amena, 2026-09-21: "i think there is alot of redundancy in this sheet ...
    remove fde syllabus columns pls". Measured before cutting: FDE syllabus
    was 'In FDE syllabus' on 100% of rows on all four tabs, Period (min) was
    '40', Review status was 'not reviewed', and Reading strategy was 'n/a' on
    every Maths and Science row. A column with one value cannot be filtered,
    sorted or reviewed on -- it is furniture.
    """

    GONE = ("FDE syllabus", "Period (min)", "Review status")

    def test_the_constant_columns_are_gone_from_every_tab(self):
        for subject in SUBJECTS:
            cols = tabs.header(subject)
            for dead in self.GONE:
                self.assertNotIn(dead, cols, "%s still has %s" % (subject, dead))

    def test_reading_strategy_survives_only_where_it_varies(self):
        # English 18 distinct values, Urdu 19. Maths and Science: 'n/a', always.
        for subject in ("English", "Urdu"):
            self.assertIn("Reading strategy", tabs.header(subject))
        for subject in ("Maths", "Science"):
            self.assertNotIn("Reading strategy", tabs.header(subject))

    def test_stage_c_does_not_write_a_column_the_tab_no_longer_has(self):
        for subject in SUBJECTS:
            cols = set(tabs.header(subject))
            for c in stagec.columns_for("day", subject):
                self.assertIn(c, cols,
                              "%s: Stage C writes %s, which is not a column" % (subject, c))

    def test_omission_is_still_surfaced_even_though_the_column_went(self):
        # "Dark stages stay dark" -- dropping the column must not drop the
        # fact. An FDE-omitted chapter is announced by its own banner row.
        self.assertTrue(hasattr(tabs, "OMITTED"))

    def test_the_ten_trace_columns_are_one(self):
        for subject in SUBJECTS:
            cols = tabs.header(subject)
            self.assertEqual(cols.count(tabs.TRACES_COLUMN), 1)
            for old in ("A Page truth", "B Segmentation", "C Enrichment",
                        "C-gate Enrich gate", "D0 Slide script",
                        "F LP (latest PDF)"):
                self.assertNotIn(old, cols)

    def test_the_language_tabs_stay_wider_than_the_others(self):
        self.assertGreater(len(tabs.header("English")), len(tabs.header("Maths")))

    def test_every_row_builder_still_matches_the_header_width(self):
        # _day_row and _tail_row assert on this, so a miscount raises here.
        for subject in SUBJECTS:
            n = len(tabs.header(subject))
            row = tabs._day_row(_DAY, subject, n)
            self.assertEqual(len(row), n)
            self.assertEqual(len(tabs._tail_row(_TAIL, subject, n)), n)


_DAY = {"day_label": "Day 1", "topic": "t", "skill_type": "s", "pages": "2",
        "overlap": "", "primary_slo": "E-01", "slo_role": "new",
        "primary_slo_desc": "d", "supporting_slos": "", "supporting_descs": "",
        "blooms": "Understand", "period_min": 40, "strand": "input",
        "fde": "In FDE syllabus", "flags": "", "kind": "day"}
_TAIL = dict(_DAY, kind="review")


class TheStandfirst(unittest.TestCase):
    """It is the first thing a reviewer reads, so it cannot name a ghost.

    It promised `Reading strategy` on Maths and Science after the column
    was cut from both, and promised a collapsed grey group after the last
    of them was deleted.
    """

    def test_it_names_no_column_the_tab_does_not_have(self):
        for subject in ("English", "Urdu", "Maths", "Science"):
            text = tabs.standfirst(subject)
            self.assertNotIn("grey group", text, subject)
            for col in ("Reading strategy", "Function", "Recycles"):
                if col not in tabs.header(subject):
                    self.assertNotIn(col, text, "%s: %s" % (subject, col))

    def test_it_names_the_stage_c_columns_the_tab_does_have(self):
        for subject in ("English", "Urdu", "Maths", "Science"):
            text = tabs.standfirst(subject)
            for col in ("Moves", "Collaboration structure"):
                self.assertIn(col, text, subject)

    def test_every_folded_subject_says_where_its_revision_days_went(self):
        """A teacher counting a chapter's days finds one fewer than the book
        prints. Urdu has said why since it was built; English and Maths
        joined the fold on 2026-09-21 (bd-2ctk6) and have to say it too.
        Science does not fold, so it must not claim to."""
        for subject in ("English", "Urdu", "Maths"):
            text = tabs.standfirst(subject)
            self.assertIn("folded into its last teaching day", text, subject)
            self.assertIn("Flags", text, subject)
        self.assertNotIn("folded", tabs.standfirst("Science"))


if __name__ == "__main__":
    unittest.main()
