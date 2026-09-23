# -*- coding: utf-8 -*-
"""The tab registry: who may repaint what.

`--derived` drops and rebuilds every tab it is handed. The guarantee under
test is that the list it is handed cannot contain a tab whose contents
came from anywhere but the corpus -- a subject tab's Stage C enrichment,
or a tab built by reading the live sheet.
"""
import unittest

import taborder


class TheRegistry(unittest.TestCase):

    def test_no_subject_tab_is_derived(self):
        for title in taborder.SUBJECT_TABS.values():
            self.assertNotIn(title, taborder.DERIVED, title)

    def test_no_live_owned_tab_is_derived(self):
        for title in taborder.LIVE_OWNED:
            self.assertNotIn(title, taborder.DERIVED, title)

    def test_every_live_owned_tab_is_a_real_tab(self):
        for title in taborder.LIVE_OWNED:
            self.assertIn(title, taborder.TAB_ORDER, title)

    def test_derived_is_every_other_tab(self):
        self.assertEqual(
            set(taborder.DERIVED) | set(taborder.SUBJECT_TABS.values())
            | set(taborder.LIVE_OWNED), set(taborder.TAB_ORDER))

    def test_derived_keeps_the_sheet_order(self):
        order = [t for t in taborder.TAB_ORDER if t in taborder.DERIVED]
        self.assertEqual(list(taborder.DERIVED), order)

    def test_every_tab_has_a_navigation_label(self):
        for title in taborder.TAB_ORDER:
            self.assertEqual(taborder.NAV_LABEL_TO_TAB[title], title)

    def test_the_titles_are_unique(self):
        self.assertEqual(len(set(taborder.TAB_ORDER)),
                         len(taborder.TAB_ORDER))


if __name__ == "__main__":
    unittest.main()
