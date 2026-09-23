# -*- coding: utf-8 -*-
"""A code the book never describes says so on the row.

bd-fkc3a leaves three codes with no sentence anywhere in their book --
`E-05-LG-09`, `E-05-WR-27` and `U-05-PH-01 [DERIVED]`. The lexicon cannot
invent one and must not: a plausible sentence beside a code nobody wrote is
the worst outcome on a sheet a curriculum lead reviews by eye.

What is left is a blank cell, and a blank cell is ambiguous -- it reads as
"the build has not got there yet" exactly like the columns that really are
pending. The flag is what makes it a finding instead: the row states that
the description is missing from the source, so the gap is reviewable rather
than merely invisible.
"""
import unittest

import stageb

ROLE = {"primary_slo": "U-05-PH-01 [DERIVED]", "primary_slo_desc": "",
        "slo_role": "introduces", "new_codes": ["U-05-PH-01 [DERIVED]"],
        "supporting_slos": [], "supporting_descs": []}


def _day(**kw):
    day = {"slo_codes": ["U-05-PH-01 [DERIVED]"], "day_label": "Day 1",
           "topic": u"حرفوں کی پہچان", "pages_printed": [7]}
    day.update(kw)
    return day


class ACodeWithNoSentenceInTheBookIsFlagged(unittest.TestCase):

    def test_the_primary_code_is_named_in_the_flag(self):
        flags = stageb.day_flags(_day(), ROLE, [])
        self.assertIn("U-05-PH-01 [DERIVED]", flags)
        self.assertIn("SLO description missing", flags)

    def test_a_supporting_code_with_no_sentence_is_named_too(self):
        role = dict(ROLE, primary_slo="U-05-RD-01",
                    primary_slo_desc=u"نظم پڑھ سکیں۔",
                    supporting_slos=["U-05-PH-01 [DERIVED]"],
                    supporting_descs=[""])
        flags = stageb.day_flags(_day(), role, [])
        self.assertIn("U-05-PH-01 [DERIVED]", flags)

    def test_a_fully_described_day_is_not_flagged(self):
        role = dict(ROLE, primary_slo_desc=u"حروف پہچان سکیں۔")
        self.assertNotIn("SLO description missing",
                         stageb.day_flags(_day(), role, []))

    def test_a_day_with_no_codes_at_all_keeps_its_own_flag(self):
        # "no SLO in source" already says it; a second flag about a missing
        # description for a code that does not exist would be noise.
        flags = stageb.day_flags(_day(slo_codes=[]),
                                 dict(ROLE, primary_slo=None,
                                      new_codes=[]), [])
        self.assertIn("no SLO in source", flags)
        self.assertNotIn("SLO description missing", flags)


if __name__ == "__main__":
    unittest.main()
