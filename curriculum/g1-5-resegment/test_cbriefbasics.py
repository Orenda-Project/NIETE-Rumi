"""What an author is told when the day has no syllabus objective.

`basicseg` mints a row for a period the book never claimed, and that row
claims no SLO on purpose: the FDE syllabus has no objective for number
fluency, so borrowing the chapter's codes would report the syllabus as
covered by a day that never taught it.

That decision has a cost, and this is where it is paid. The brief's whole
guarantee is that Stage C invents nothing, which it keeps by handing the
author everything a lesson may be built from. Hand an author an empty `slo`
list and nothing else and the guarantee inverts: the one part of the lesson
that is NOT on the page -- what today is actually for -- is the part left
blank, and an author with a blank there fills it. `cbrief`'s own rule for
the spiral says how to avoid that: "an absent key reads as an oversight, a
`None` with a reason reads as a fact."

So the row's own objective, the chapter objectives it feeds, and the reason
it claims none of them have to reach the brief. Law 18: mirror every engine
refusal in the free lint AND write the shape into the authoring brief.
"""
import unittest

import cbrief


def page(printed=7, pdf=10, chapter=4):
    return {"printed_page_number": printed, "pdf_page_index": pdf,
            "page_type": "content", "headings": ["Counting on"],
            "chapter": {"number": chapter, "title": "Numberland"}}


def book(grade=2, subject="Maths"):
    return {"grade": grade, "subject": subject, "stem": "grade_2_math",
            "chapter_title": "Numberland"}


def basics_row(skill="number_fluency", **kw):
    d = {"segment_index": 801, "chapter_number": 4, "skill_type": skill,
         "topic": "Number Fluency, anchored in Numberland",
         "day_label": "Number Fluency 1", "duration_min": 30,
         "slo_codes": [], "slo_descriptions": [],
         "supports_slo_codes": ["M-02-NS-01", "M-02-NS-03"],
         "objective": "Children work quickly and confidently with this "
                      "chapter's own numbers, out loud and in pairs.",
         "is_basics": True, "basics_id": "grade_2_math_ch4_nf1",
         "basics_kind": "fill"}
    d.update(kw)
    return d


def normal_row(**kw):
    d = {"segment_index": 2, "chapter_number": 4, "skill_type": "pictorial",
         "topic": "Ordering numbers", "duration_min": 30,
         "slo_codes": ["M-02-NS-03"],
         "slo_descriptions": ["Order numbers up to 99"]}
    d.update(kw)
    return d


def brief(segment, prev=None):
    return cbrief.context(segment, [page()], book(), prev=prev)


class TheBriefSaysWhatTodayIsFor(unittest.TestCase):

    def test_a_basics_day_carries_its_own_objective(self):
        b = brief(basics_row())
        self.assertIn("basics", b)
        self.assertEqual(b["basics"]["objective"], basics_row()["objective"])

    def test_it_names_the_skill_being_taught(self):
        self.assertEqual(brief(basics_row())["basics"]["skill"],
                         "number_fluency")

    def test_it_names_the_chapter_objectives_this_day_feeds(self):
        b = brief(basics_row())
        self.assertEqual(b["basics"]["supports_slo"],
                         ["M-02-NS-01", "M-02-NS-03"])

    def test_the_empty_slo_list_is_explained_rather_than_left_blank(self):
        # The defect this test exists to prevent: an author handed `slo: []`
        # with no reason reads it as a field somebody forgot to fill, and
        # writes a lesson against the chapter's SLOs instead of the skill.
        why = brief(basics_row())["basics"]["no_slo_reason"]
        self.assertTrue(why)
        self.assertIn("syllabus", why.lower())

    def test_the_envelope_still_claims_no_code(self):
        # Coverage arithmetic reads `slo_codes`. Nothing here may put a code
        # back into it by a side door.
        b = brief(basics_row())
        self.assertEqual(b["envelope"]["slo"], [])
        self.assertEqual(b["envelope"]["slo_refs"], [])

    def test_the_supports_list_is_not_offered_as_todays_objective(self):
        b = brief(basics_row())
        self.assertNotIn("M-02-NS-01", b["envelope"]["slo_refs"])


class ANormalLessonIsUntouched(unittest.TestCase):

    def test_it_gets_no_basics_section(self):
        self.assertNotIn("basics", brief(normal_row()))

    def test_its_slo_still_arrives_whole(self):
        b = brief(normal_row())
        self.assertEqual(b["envelope"]["slo"],
                         [("M-02-NS-03", "Order numbers up to 99")])


class TheWarmUpKnowsWhatItMayRehearse(unittest.TestCase):

    def test_a_basics_day_forbids_nothing_but_says_why(self):
        # `forbidden` is empty because the day claims no SLO -- not because
        # anything goes. Same rule as the first-lesson spiral: say which and
        # why rather than going quiet.
        s = brief(basics_row(), prev=normal_row())["spiral"]
        self.assertEqual(s["forbidden"], [])
        self.assertTrue(s["reason"])

    def test_the_reason_points_the_warm_up_at_the_skill(self):
        s = brief(basics_row(), prev=normal_row())["spiral"]
        self.assertIn("fluency", s["reason"].lower())

    def test_the_previous_lesson_still_arrives(self):
        s = brief(basics_row(), prev=normal_row())["spiral"]
        self.assertEqual(s["previous"]["topic"], "Ordering numbers")

    def test_a_normal_lesson_keeps_its_silent_reason(self):
        self.assertIsNone(brief(normal_row(), prev=normal_row())["spiral"]["reason"])


class TheAnchorRuleReachesTheAuthor(unittest.TestCase):

    def test_the_brief_says_the_class_never_leaves_the_book(self):
        # Every one of the five templates in docs/05-basics-build.md turns on
        # this: the drill uses the chapter's own numbers, the phonics lesson
        # the chapter's own words. It is the reason a basics period is
        # anchored to a chapter at all, and teachers reject out-of-textbook
        # work, so it cannot live only in a spec file.
        self.assertIn("chapter", brief(basics_row())["basics"]["anchor"].lower())

    def test_every_minted_skill_has_a_readable_name_for_the_author(self):
        import basicseg
        for skill in basicseg.SLOT:
            b = brief(basics_row(skill=skill))
            self.assertTrue(b["basics"]["skill_name"], skill)


class ItIsStillALesson(unittest.TestCase):

    def test_a_basics_day_is_built_as_a_lesson_not_a_worksheet(self):
        self.assertEqual(brief(basics_row())["shape"], "lesson")

    def test_it_keeps_the_budget_and_the_lesson_rules(self):
        b = brief(basics_row())
        self.assertIn("budget", b)
        self.assertIn("rules", b)

    def test_an_ungrounded_basics_day_is_still_refused(self):
        with self.assertRaises(cbrief.Ungrounded):
            cbrief.context(basics_row(), [], book())


if __name__ == "__main__":
    unittest.main()
