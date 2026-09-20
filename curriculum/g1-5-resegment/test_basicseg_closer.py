"""Grounding walks past a chapter's Connect-and-Create tail.

Measured 20 Sep 2026 across all eighteen books: 43 of the 366 basics periods
(11.7%) resolve their grounding to a chapter-closer page and nothing else --
grade_3_math 16, grade_4_math 11, grade_2_english 7, grade_5_math 7, one each
in grade_3_english and grade_4_english; by skill, word_problem 20,
number_fluency 14, communicative 5, phonics 4.

The worked case is `grade_3_math_ch7_nf1`. It asks for a number-fluency period
on M-03-DE-01 and M-03-DE-02 -- tenths and hundredths -- and anchors on
printed page 137 alone, which is the Decimal Dance journal: a materials list,
three instructions, and no numbers at all. The chapter's own practice pages
133 to 136 carry fourteen keyed exercises between them and are never reached.

`_usable` asked only whether a day carried page NUMBERS. A closer page has
one, so it passed. This is the same class of day as the 990 and 995 sentinels
that `_grounding` already walks past, and it is walked past the same way.

`basicseg` imports nothing, on purpose -- that is what lets it be tested
without the gitignored corpus -- so the page knowledge arrives as a predicate
the caller supplies, and the default stays page-blind.
"""

import unittest

import basicseg


def rec(**kw):
    out = {"id": "grade_3_math_ch7_nf1", "skill": "number_fluency",
           "ordinal": 1, "chapter": 7, "kind": "fill", "near": 4}
    out.update(kw)
    return out


def days(spec):
    """One row per {segment_index: [printed pages]}."""
    return [{"segment_index": i, "pages_printed": list(p), "pages_pdf": list(p),
             "chapter_number": 7, "chapter_title": "Decimal Dance",
             "skill_type": "conceptual", "slo_codes": ["M-03-DE-01"],
             "slo_descriptions": ["I know that hundredths arise."]}
            for i, p in sorted(spec.items())]


def closes(*pages):
    """A predicate standing in for the book's page truth."""
    return lambda printed: printed in set(pages)


class WalkingPastTheChapterTail(unittest.TestCase):

    def test_it_does_not_build_a_drill_from_the_connect_and_create_page(self):
        rows = days({3: [133, 134], 4: [137]})
        out = basicseg.segment(rec(near=4), rows, closer=closes(137))
        self.assertEqual(out["pages_printed"], [133, 134])
        self.assertEqual(out["basics_near"], 3)

    def test_without_the_predicate_the_behaviour_is_unchanged(self):
        # The default is page-blind, so every existing caller and every test
        # written before this one keeps the row it already had.
        rows = days({3: [133, 134], 4: [137]})
        self.assertEqual(basicseg.segment(rec(near=4), rows)["pages_printed"],
                         [137])

    def test_a_day_that_is_only_partly_closer_pages_is_still_usable(self):
        # A lesson that runs onto the tail page still teaches on its own page,
        # and narrowing to it beats falling back to the whole chapter.
        rows = days({3: [133], 4: [136, 137]})
        out = basicseg.segment(rec(near=4), rows, closer=closes(137))
        self.assertEqual(out["pages_printed"], [136, 137])

    def test_the_walk_prefers_the_day_before(self):
        # Same rule the sentinels use: the class has been there.
        rows = days({2: [130], 3: [133], 4: [137], 5: [140]})
        self.assertEqual(basicseg.segment(rec(near=4), rows,
                                          closer=closes(137))["basics_near"], 3)

    def test_a_chapter_that_is_only_closer_pages_still_grounds(self):
        # Nothing to walk to. Better a broad row than an ungrounded one, which
        # is the same call `_grounding` already makes for the sentinels.
        rows = days({4: [137]})
        out = basicseg.segment(rec(near=4), rows, closer=closes(137))
        self.assertEqual(out["pages_printed"], [137])

    def test_a_closer_day_is_never_walked_TO(self):
        # The nearest-teaching-day search must not land on one either.
        rows = days({3: [137], 4: [138], 5: [133]})
        out = basicseg.segment(rec(near=4), rows, closer=closes(137, 138))
        self.assertEqual(out["pages_printed"], [133])

    def test_what_it_feeds_is_still_the_whole_chapter(self):
        rows = days({3: [133], 4: [137]})
        rows[0]["slo_codes"] = ["M-03-DE-01"]
        rows[1]["slo_codes"] = ["M-03-DE-02"]
        out = basicseg.segment(rec(near=4), rows, closer=closes(137))
        self.assertEqual(out["supports_slo_codes"], ["M-03-DE-01", "M-03-DE-02"])

    def test_the_slos_come_from_the_day_it_walked_to(self):
        # Not from the tail page it refused. A period rehearses the lesson it
        # is grounded on, and the codes have to follow the pages.
        rows = days({3: [133], 4: [137]})
        rows[0]["slo_codes"] = ["M-03-DE-02"]
        rows[0]["slo_descriptions"] = ["I can identify the tenths."]
        rows[1]["slo_codes"] = ["M-03-XX-99"]
        rows[1]["slo_descriptions"] = ["Journal."]
        out = basicseg.segment(rec(near=4), rows, closer=closes(137))
        self.assertEqual(out["slo_codes"], ["M-03-DE-02"])

    def test_a_pageless_day_is_still_refused_when_a_predicate_is_given(self):
        # The old reason to refuse a day did not go away.
        rows = days({3: [133], 4: []})
        self.assertEqual(basicseg.segment(rec(near=4), rows,
                                          closer=closes(137))["pages_printed"],
                         [133])

    def test_a_bookkeeping_day_is_still_walked_past_when_a_predicate_is_given(self):
        rows = days({3: [133], 995: [130, 133, 137]})
        rows[-1]["skill_type"] = "assessment"
        self.assertEqual(basicseg.segment(rec(near=995), rows,
                                          closer=closes(137))["basics_near"], 3)


if __name__ == "__main__":
    unittest.main()
