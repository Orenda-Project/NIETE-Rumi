"""Navigation — the index has to name every tab, and only real tabs.

The index is the first thing anyone opens and the only map of the workbook,
so a tab missing from it is a tab nobody finds. `Coverage — gaps` was built
into the sheet and left out of the index for exactly that reason: nothing
checked the two lists against each other (bd-umwtp). An entry pointing at a
tab that no longer exists is the same failure read the other way — a dead link
in the table of contents.

The band over the list says "in order", so these tests hold it to that too.
Ordering is not decoration here: the index is what tells a reader the calendar
comes before the subject tabs and the review tabs come last.
"""
import unittest

import build
import navtab
import sheetio


class TheIndexNamesEveryTab(unittest.TestCase):

    def setUp(self):
        self.labels = [label for label, _text in navtab.TABS]

    def test_every_built_tab_has_an_index_entry(self):
        missing = [t for t in build.TAB_ORDER if t not in self.labels]
        self.assertEqual(missing, [], "built but not in the index")

    def test_every_index_entry_names_a_built_tab(self):
        stray = [x for x in self.labels if x not in build.TAB_ORDER]
        self.assertEqual(stray, [], "in the index but never built")

    def test_the_index_lists_them_in_workbook_order(self):
        self.assertEqual(self.labels, list(build.TAB_ORDER))

    def test_no_tab_is_listed_twice(self):
        self.assertEqual(len(self.labels), len(set(self.labels)))

    def test_every_entry_says_what_the_tab_holds(self):
        for label, text in navtab.TABS:
            self.assertTrue(text.strip(), f"{label} has an empty description")


class TheIndexCanOpenEveryTab(unittest.TestCase):
    """Each row carries a link; the link is resolved through build's map."""

    def test_every_entry_resolves_to_a_tab_that_is_built(self):
        for label, _text in navtab.TABS:
            self.assertIn(label, build.NAV_LABEL_TO_TAB,
                          f"{label} has no link target")
            self.assertIn(build.NAV_LABEL_TO_TAB[label], build.TAB_ORDER,
                          f"{label} links to a tab that is not built")


if __name__ == "__main__":
    unittest.main()
