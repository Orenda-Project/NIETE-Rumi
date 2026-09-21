# -*- coding: utf-8 -*-
"""`build.py --derived` repaints what the corpus derives, and nothing else.

Why this mode exists. dayfold Rule 3 opened to Grades 2-5 English and Maths
on 2026-09-21 (bd-2ctk6) and removed 103 chapter-revision periods from the
books. The subject tabs were edited in place, but the Teaching Calendar,
Coverage Map and their neighbours are computed from the same books and were
left quoting the pre-fold period counts -- the calendar said Grade 2 Maths
costs 118 periods where the book now costs 103. That disagreement is the
exact failure `stageb.load_book` puts the fold behind one door to prevent,
and it was reachable only because a full `build.py` is not an option: it
calls `sheetio.reset_tabs` on the subject tabs, which would drop every Stage
C enrichment cell the sheet holds.

So the contract under test is a boundary, not a feature: DERIVED and
SUBJECT_TABS may never overlap, and the mode may never reset a subject tab.
"""
import unittest

import build


class TheDerivedSetIsDisjointFromTheSubjectTabs(unittest.TestCase):

    def test_no_subject_tab_is_in_the_derived_set(self):
        """The one that matters. A subject tab in here is 12,655 cells of
        Stage C enrichment dropped by a mode whose whole point is to be the
        safe repaint."""
        for title in build.SUBJECT_TABS.values():
            self.assertNotIn(title, build.DERIVED, title)

    def test_every_derived_tab_is_a_tab_the_build_knows(self):
        for title in build.DERIVED:
            self.assertIn(title, build.TAB_ORDER, title)

    def test_the_calendar_and_coverage_are_both_in_it(self):
        # The two that disagreed. Coverage counts a chapter's revision row in
        # its "Revision, assessment & review" line, so it moves with the
        # calendar or the workbook contradicts itself again.
        self.assertIn("Teaching Calendar", build.DERIVED)
        self.assertIn("Coverage Map", build.DERIVED)

    def test_navigation_is_in_it(self):
        # It quotes each tab's row count, so it is stale the moment any
        # derived tab changes height.
        self.assertIn("Navigation", build.DERIVED)

    def test_the_index_can_still_quote_every_subject_tab(self):
        """Navigation quotes each tab's row count. --derived does not write
        the subject tabs, but it must still SIZE them, or the index comes
        back listing four tabs with no size beside them -- which is how a
        reviewer learns the sheet is broken rather than that it was skipped.
        """
        import inspect
        body = inspect.getsource(build.main)
        after = body.split("if derived_only:", 2)[-1]
        self.assertIn("sizes[title]", after)

    def test_the_derived_set_keeps_the_workbook_order(self):
        order = [t for t in build.TAB_ORDER if t in build.DERIVED]
        self.assertEqual(list(build.DERIVED), order)


if __name__ == "__main__":
    unittest.main()
