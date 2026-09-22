#!/usr/bin/env python3
"""The Gate-O1 batch driver's routing. bd-58dss.

    python3 -m pytest test_build_o1_docs.py -q

Every chapter in this corpus ends the same way: N teaching days, then a `_seg995`
assessment worksheet, then a `_seg990` review day. `d0_route.assert_content` refuses
both -- correctly, and loudly, because a worksheet silently rendered as a lesson plan
is the failure Law 18 exists to stop.

The driver never branched on that. It called `to_lp_doc` on every manifest row, so the
first 995 raised `WrongRoute` out of `main`, and one assessment row took down the rest
of its subject AND every subject queued behind it. The first end-to-end run (Grade 3
Ch.2, English + Urdu + Maths off the live production traces) died on English chapter-day
10 with nothing written at all. The driver could never have finished a real chapter.

So the decision gets its own pure function: given what was loaded, say which rows build
and which ones belong to another artefact, and name that artefact. Routing away is not
an error -- those days are real, they are just not lesson plans -- so they are reported,
not swallowed, and the run goes on.
"""
import unittest

import build_o1_docs as drv
import d0_route

CONTENT = {"lesson_id": "grade_3_english_ch2_seg3", "lp_type": "content"}
WORKSHEET = {"lesson_id": "grade_3_english_ch2_seg995", "lp_type": "assessment"}
REVIEW = {"lesson_id": "grade_3_english_ch2_seg990", "lp_type": "revision"}
# The corpus spells these in Urdu too -- a check written against the English word
# misses ninety of 466 segments, which is why triage delegates to d0_route.kind.
JAIZA = {"lesson_id": "grade_3_urdu_ch2_seg995", "skill_type": "jaiza"}
DUHRAI = {"lesson_id": "grade_3_urdu_ch2_seg990", "skill_type": "duhrai"}


class TriageSplitsTheChapter(unittest.TestCase):

    def test_a_teaching_day_builds(self):
        build, routed = drv.triage([("English", 1, CONTENT)])
        self.assertEqual([r[2]["lesson_id"] for r in build], [CONTENT["lesson_id"]])
        self.assertEqual(routed, [])

    def test_a_995_is_routed_away_not_built(self):
        build, routed = drv.triage([("English", 10, WORKSHEET)])
        self.assertEqual(build, [])
        self.assertEqual(len(routed), 1)

    def test_a_990_is_routed_away_not_built(self):
        build, routed = drv.triage([("English", 11, REVIEW)])
        self.assertEqual(build, [])
        self.assertEqual(len(routed), 1)

    def test_the_urdu_spellings_route_too(self):
        """`jaiza` and `duhrai` are the same two days, and the corpus uses them."""
        build, routed = drv.triage([("Urdu", 7, JAIZA), ("Urdu", 8, DUHRAI)])
        self.assertEqual(build, [])
        self.assertEqual(len(routed), 2)

    def test_one_worksheet_does_not_take_the_chapter_with_it(self):
        """The bug, stated as behaviour: the days after a 995 still build."""
        rows = [("English", 1, CONTENT), ("English", 10, WORKSHEET),
                ("English", 11, REVIEW), ("Maths", 1, CONTENT)]
        build, routed = drv.triage(rows)
        self.assertEqual(len(build), 2, "both teaching days survive the assessment row")
        self.assertEqual(len(routed), 2)

    def test_a_routed_row_names_the_artefact_it_actually_needs(self):
        """Reported, not swallowed -- a skipped day must be findable in the log."""
        _, routed = drv.triage([("English", 10, WORKSHEET), ("English", 11, REVIEW)])
        kinds = [r["kind"] for r in routed]
        self.assertEqual(kinds, ["assessment", "revision"])
        for r in routed:
            self.assertIn(r["kind"], d0_route.ROUTES)
            self.assertTrue(r["note"], "a routed row explains where it should go")
            self.assertIn(r["subject"], ("English", "Urdu", "Maths", "Science"))


if __name__ == "__main__":
    unittest.main()
