"""What an author is told about a day that rehearses the lesson beside it.

`basicseg` mints a row for a period the book never claimed, and that row
states the SLOs of the book day it is grounded on -- Amena, 20 Sep 2026:
*"slo codes should cover the SLOs that the lesson states."* Those codes
reach the author on their own through `cbrief._slo`, and on their own they
are misleading in two ways an author cannot detect.

They read as today's NEW objectives, so the lesson gets written as first
teaching rather than as practice. And `_spiral` puts them in `forbidden`,
which for an ordinary lesson means "the warm-up may not reach here" -- the
opposite of what a drill wants, since reaching back to the lesson it
rehearses is the whole point. Both are cases of `cbrief`'s own rule: "an
absent key reads as an oversight, a `None` with a reason reads as a fact."

The period length is the third. The teacher's slot is 40 minutes and the
plan says 40, but the steps are budgeted shorter on purpose, and an author
told only "40" writes the plan teachers say they cannot finish. Law 18:
mirror every engine refusal in the free lint AND write the shape into the
authoring brief.
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
         "day_label": "Number Fluency 1",
         "duration_min": 40, "content_min": 30,
         "slo_codes": ["M-02-NS-03"],
         "slo_descriptions": ["Order numbers up to 99"],
         "supports_slo_codes": ["M-02-NS-01", "M-02-NS-03"],
         "objective": "I can order numbers up to 99. Today I work on it fast "
                      "and out loud, with a partner, using this chapter's "
                      "own numbers.",
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

    def test_the_stated_slo_is_named_as_already_taught(self):
        # The defect this test exists to prevent: an author handed a code
        # with no reason writes the day as first teaching of it, and the
        # drill becomes the lesson the class already had.
        why = brief(basics_row())["basics"]["slo_reason"]
        self.assertTrue(why)
        self.assertIn("rehears", why.lower())

    def test_the_envelope_carries_the_slos_of_the_lesson_it_rehearses(self):
        b = brief(basics_row())
        self.assertEqual(b["envelope"]["slo_refs"], ["M-02-NS-03"])
        self.assertEqual(b["envelope"]["slo"],
                         [("M-02-NS-03", "Order numbers up to 99")])

    def test_the_wider_supports_set_is_not_offered_as_todays_objective(self):
        # M-02-NS-01 belongs to another day of the chapter. The skill feeds
        # it over the weeks; this period does not teach it.
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

    def test_a_basics_day_may_reach_back_to_the_lesson_it_rehearses(self):
        # `forbidden` now holds the day's own codes, and for an ordinary
        # lesson that means "the warm-up may not go here". For a drill it is
        # exactly where the warm-up belongs, so the reason has to say so --
        # otherwise the list silently forbids the one thing that works.
        s = brief(basics_row(), prev=normal_row())["spiral"]
        self.assertEqual(s["forbidden"], ["M-02-NS-03"])
        self.assertIn("reach", s["reason"].lower())

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


class ThePeriodShownIsNotTheContentBudget(unittest.TestCase):
    """Amena, 20 Sep 2026: "what we assume as perfect 40 is too long for
    teachers, so we make it shorter and show the teacher 40, something she
    can practically implement. The opening and explanation take [the rest]."
    """

    def test_the_author_is_given_both_numbers(self):
        b = brief(basics_row())["basics"]
        self.assertEqual(b["period_min"], 40)
        self.assertEqual(b["content_min"], 30)

    def test_the_author_is_told_which_one_the_steps_sum_to(self):
        # The defect: an author given 40 and 30 with no rule picks whichever
        # reads as the period, and that is the plan teachers cannot finish.
        why = brief(basics_row())["basics"]["timing"]
        self.assertIn("30", why)
        self.assertIn("40", why)

    def test_a_row_that_does_not_say_still_gets_a_content_budget(self):
        # Every minted row carries both. A hand-written one may not, and a
        # missing budget must not read as "spend the whole period".
        b = brief(basics_row(content_min=None))["basics"]
        self.assertEqual(b["content_min"], 30)


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
