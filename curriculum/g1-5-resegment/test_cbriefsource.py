"""What an illustration says, when the page truth says it two different ways.

`text_in_image` is a string on almost every page and a list of label strings on
fifteen of them -- Grade 3 Maths pdf 228 holds
`["COMMUNITY CENTRE", "LIBRARY", "MARKET PLACE", "TOWN HALL"]`, which is a map
with four places named on it rather than one caption. Stage A described both
shapes and neither is wrong; only the reader assumed.

Measured 20 Sep 2026: fifteen pages across Grade 3 Maths and Grade 1 Maths carry
thirty such illustrations, and eight REAL segments resolve onto them. Every one
of those eight raised `AttributeError: 'list' object has no attribute 'strip'`
before a single word was authored, so this is eight lessons that could not be
built, not a basics-period detail.

The labels are joined with a newline rather than a space. They are separate
things named on one picture, and " ".join gives an author "COMMUNITY CENTRE
LIBRARY", which reads as one place that does not exist.

These live apart from `test_cbrief.py` only because that file is already 356
lines, over the 300 limit.
"""
import unittest

import cbrief


def page(text_in_image, printed=12):
    return {"printed_page_number": printed, "pdf_page_index": printed + 5,
            "page_type": "content", "headings": [], "text_verbatim": "",
            "exercises": [],
            "illustrations": [{"description": "a town map",
                               "objects": ["map"],
                               "pedagogical_role": "context",
                               "text_in_image": text_in_image}]}


class AnIllustrationMaySayItsWordsAsAList(unittest.TestCase):

    def test_a_list_of_labels_does_not_crash_the_brief(self):
        # The whole bug: eight real segments died here.
        src = cbrief._source([page(["COMMUNITY CENTRE", "LIBRARY"])])
        self.assertEqual(len(src["voices"]), 1)

    def test_every_label_reaches_the_author(self):
        src = cbrief._source([page(["COMMUNITY CENTRE", "LIBRARY",
                                    "MARKET PLACE", "TOWN HALL"])])
        says = src["voices"][0]["says"]
        for label in ("COMMUNITY CENTRE", "LIBRARY", "MARKET PLACE",
                      "TOWN HALL"):
            self.assertIn(label, says)

    def test_the_labels_stay_separate_things(self):
        # " ".join would hand an author "COMMUNITY CENTRE LIBRARY" -- one place,
        # and not one that is on the page.
        src = cbrief._source([page(["COMMUNITY CENTRE", "LIBRARY"])])
        self.assertEqual(src["voices"][0]["says"],
                         "COMMUNITY CENTRE\nLIBRARY")

    def test_an_empty_list_is_a_silent_picture(self):
        src = cbrief._source([page([])])
        self.assertEqual(src["voices"], [])
        self.assertEqual(len(src["silent"]), 1)
        self.assertNotIn("says", src["silent"][0])

    def test_a_list_of_nothing_but_blanks_is_silent_too(self):
        src = cbrief._source([page(["", "   "])])
        self.assertEqual(src["voices"], [])
        self.assertEqual(len(src["silent"]), 1)

    def test_a_blank_label_between_two_real_ones_is_dropped(self):
        src = cbrief._source([page(["LIBRARY", "  ", "TOWN HALL"])])
        self.assertEqual(src["voices"][0]["says"], "LIBRARY\nTOWN HALL")

    def test_each_label_is_trimmed(self):
        src = cbrief._source([page(["  LIBRARY  ", "TOWN HALL "])])
        self.assertEqual(src["voices"][0]["says"], "LIBRARY\nTOWN HALL")


class TheStringShapeIsUntouched(unittest.TestCase):
    """The other 99% of pages. A fix that changed these would be a new bug."""

    def test_a_plain_caption_still_speaks(self):
        src = cbrief._source([page("Ali counts the apples.")])
        self.assertEqual(src["voices"][0]["says"], "Ali counts the apples.")

    def test_it_is_still_trimmed(self):
        src = cbrief._source([page("  Ali counts.  ")])
        self.assertEqual(src["voices"][0]["says"], "Ali counts.")

    def test_an_empty_caption_is_still_silent(self):
        src = cbrief._source([page("   ")])
        self.assertEqual(src["voices"], [])
        self.assertEqual(len(src["silent"]), 1)

    def test_a_missing_field_is_still_silent(self):
        p = page("x")
        del p["illustrations"][0]["text_in_image"]
        src = cbrief._source([p])
        self.assertEqual(len(src["silent"]), 1)

    def test_a_null_field_is_still_silent(self):
        src = cbrief._source([page(None)])
        self.assertEqual(len(src["silent"]), 1)


if __name__ == "__main__":
    unittest.main()
