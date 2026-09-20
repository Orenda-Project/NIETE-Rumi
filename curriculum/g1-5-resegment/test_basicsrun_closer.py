"""The predicate that lends `basicseg` the book's page truth.

`basicseg` imports nothing so that it can be tested without the gitignored
corpus. The cost of that is it cannot tell a chapter's Connect-and-Create tail
from a lesson page, because both are normal teaching rows with real page
numbers. `basicsrun.closer` closes the gap from the side that already holds the
page index, and is tested here against the two shapes the corpus actually uses:
a heading that says so, and a `page_type` that says so.
"""

import unittest

import basicsrun


class Index(object):
    def __init__(self, by_printed):
        self.by_printed = by_printed


def idx(**pages):
    return Index({int(n): [p] for n, p in pages.items()})


class TheCloserPredicate(unittest.TestCase):

    def test_a_connect_and_create_heading_is_a_closer(self):
        i = idx(**{"137": {"headings": ["Connect and Create", "Materials:"],
                           "page_type": "content"}})
        self.assertTrue(basicsrun.closer(i)(137))

    def test_the_heading_match_ignores_case(self):
        i = idx(**{"13": {"headings": ["CONNECT AND CREATE"], "page_type": "activity"}})
        self.assertTrue(basicsrun.closer(i)(13))

    def test_a_chapter_closer_page_type_is_a_closer_without_the_heading(self):
        i = idx(**{"159": {"headings": ["Materials:"], "page_type": "chapter_closer"}})
        self.assertTrue(basicsrun.closer(i)(159))

    def test_an_ordinary_lesson_page_is_not(self):
        i = idx(**{"133": {"headings": ["Topic 1: Capacity"], "page_type": "content"}})
        self.assertFalse(basicsrun.closer(i)(133))

    def test_a_page_with_no_headings_at_all_is_not(self):
        # `grade_3_math` p.112 is pure exposition with no headings and no
        # exercises, and it authored and passed the judge. Thin is not closed.
        i = idx(**{"112": {"headings": [], "page_type": "content"}})
        self.assertFalse(basicsrun.closer(i)(112))

    def test_a_printed_number_the_book_does_not_have_is_not(self):
        # Refusing a page the index cannot see would narrow the grounding on
        # the strength of a missing file, which is the wrong direction to fail.
        self.assertFalse(basicsrun.closer(idx())(137))

    def test_a_printed_number_carrying_two_pages_needs_both_to_be_closers(self):
        # The corpus has printed-number collisions; one real lesson page under
        # the number is enough to keep the day.
        i = Index({137: [{"headings": ["Connect and Create"], "page_type": "content"},
                         {"headings": ["Topic 2"], "page_type": "content"}]})
        self.assertFalse(basicsrun.closer(i)(137))


if __name__ == "__main__":
    unittest.main()
