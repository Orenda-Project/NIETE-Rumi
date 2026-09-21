# -*- coding: utf-8 -*-
"""A column cannot be more varied than the rows it describes.

The flatness rules assume a uniform column means the annotator stopped
reading the days. Usually true. Not true when the days themselves are
identical: urdu_G5's sixteen جائزہ · Assessment rows carry one description
between them -- "پورے سبق کے SLOs کی تشخیص — طلبہ خود سے مکمل کریں گے"
repeated with only the lesson number changing -- and it says in so many
words that students complete the work themselves. `individual-only` on all
sixteen is a transcription of that sentence, and the gate rejected it.

Meanwhile urdu_G3's eighteen assessment rows, equally identical in the
source, were split three ways and passed. So the rule as written rejected
the two slices that read the rows and passed the one that invented a split
-- the exact inversion of what it exists to do.

The fix is not to weaken the threshold. It is to ask, before complaining,
whether the source gave the annotator anything to tell these days apart.
Where it did and the column is still uniform, the complaint stands.
"""
import unittest

import stagec_columns as c

SKILL = u"جائزہ · Assessment"
COL = "Collaboration structure"
N = 16          # urdu_G5's real assessment-day count


def rows(descs, skill=SKILL):
    return [{"row": 10 + i, "day": i + 1, "skill_type": skill,
             "slo": "U-05-AS-%02d" % (i + 1), "topic": "", "slo_desc": d}
            for i, d in enumerate(descs)]


def cells(values):
    return dict((str(10 + i), {COL: v}) for i, v in enumerate(values))


def findings(descs, values):
    return [f for f in c.check_diversity(rows(descs), cells(values), [COL])
            if "single value" in f]


SAME = [u"سبق %d کے SLOs کی تشخیص — طلبہ خود سے مکمل کریں گے۔" % (i + 1)
        for i in range(N)]
_TOPICS = (u"الفاظ", u"تفہیم", u"قواعد", u"تحریر",
           u"بلند خوانی", u"سماعت", u"ارکان", u"جملہ سازی",
           u"املا", u"زبانی اظہار", u"مكالمہ", u"خط لکھنا",
           u"روزنامچہ", u"نظم", u"تلخیص", u"تقریر")
DISTINCT = [u"جائزہ: %s" % t for t in _TOPICS]
FLAT = ["individual-only"] * N


class UniformSourceRowsEarnAUniformColumn(unittest.TestCase):

    def test_identical_rows_do_not_make_a_uniform_column_a_defect(self):
        """The urdu_G5 shape: one sentence, repeated, that names solo work."""
        self.assertEqual(findings(SAME, FLAT), [],
                         "a column was faulted for matching rows that are "
                         "themselves identical in the source")

    def test_rows_that_differ_still_must_be_told_apart(self):
        """The rule keeps its teeth where the source gave something to read."""
        self.assertTrue(findings(DISTINCT, FLAT),
                        "a uniform column over genuinely distinct days was "
                        "not caught")

    def test_only_the_lesson_number_differing_is_still_identical(self):
        """Digits are the lesson counter, not a difference between days."""
        self.assertEqual(findings(SAME, FLAT), findings(
            [d.replace(u"سبق", u"سبق ") for d in SAME], FLAT))

    def test_the_exemption_does_not_silence_other_findings(self):
        """It answers one question -- is uniformity honest -- and no other."""
        found = c.check_diversity(rows(SAME), cells(FLAT), [COL])
        self.assertTrue(all("single value" not in f for f in found))

    def test_a_topic_difference_counts_as_signal(self):
        """Signal is whatever the row carries, not one named field."""
        rs = rows(SAME)
        for i, r in enumerate(rs):
            r["topic"] = DISTINCT[i]
        self.assertTrue([f for f in c.check_diversity(rs, cells(FLAT), [COL])
                         if "single value" in f],
                        "a difference carried in Topic was not read as signal")

    def test_rows_carrying_no_text_are_unread_not_undifferentiated(self):
        """Absence of evidence is not evidence the days are the same."""
        bare = [{"row": 10 + i, "day": i + 1, "skill_type": SKILL}
                for i in range(N)]
        self.assertTrue([f for f in c.check_diversity(bare, cells(FLAT), [COL])
                         if "single value" in f],
                        "a group with nothing recorded was exempted anyway")



if __name__ == "__main__":
    unittest.main()
