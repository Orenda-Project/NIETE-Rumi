"""The judge's repeat findings, turned into something an author reads first.

Every rule in `lessonrules` is a rating of 2 that the v3 rubric handed back on
the grade_1_english chapter-1 batch of 19 Sep 2026 (bd-werii). The batch is the
whole evidence base and the counts are the whole argument: a defect that
appeared once is a lesson, a defect that appeared three times in seven is a
brief that never asked for the thing.

  9G  x3  seg3, seg5, seg6 -- the partner activity gives the CHILDREN's frames
          and not the teacher's verbatim set-up/stop language or a repair line
  9B  x2  seg1, seg5 -- no dictation of the taught pattern with a mark scheme
  5D  x2  seg3, seg6 -- the exit ticket reuses an item already used in I-Do or
          We-Do, and `self_prediction` describes the method instead of asking
          the child to rate themselves
  8A  x2  seg5, seg6 -- two unrelated strands in one period, no primary skill

The re-judge of 19 Sep after the first revise pass added three more, and they
are here for the same reason -- each one is a thing the brief never asked for:

  1E  x2  seg5, seg6 -- a phase, or the exit ticket, measures something other
          than the objective the lesson states
  9F  x1  seg6 -- the partner activity has no information gap AND no line
          saying it has none; the rubric accepts the declaration, not silence
  7A  x1  seg6 -- the We-Do step repeats the You-Do text word for word, so the
          gradual release has no release in it

The tests assert the rules are STATED, not that they are obeyed -- obedience is
the judge's question. What a brief can be held to is whether it asked.
"""
import unittest

import cbrief
import lessonrules


class TheEvidenceIsCarriedWithTheRule(unittest.TestCase):
    """A rule with no finding behind it is someone's taste."""

    def test_every_rule_names_the_check_it_came_from(self):
        for rule in lessonrules.RULES:
            self.assertRegex(
                rule,
                r"\[(0A|0F|1E|1F|4A|5D|6B|7A|7B|8A|8C|9B|9F|9G|9H)\]", rule)

    def test_the_three_recurring_checks_are_all_covered(self):
        flat = " ".join(lessonrules.RULES)
        for code in ("9G", "9B", "5D"):
            self.assertIn("[%s]" % code, flat)


class WhatTheJudgeKeptAskingFor(unittest.TestCase):

    def setUp(self):
        self.flat = " ".join(lessonrules.RULES).lower()

    def test_partner_work_owes_the_teachers_own_words(self):
        # 9G, three times out of seven. Always the same missing thing.
        self.assertIn("verbatim", self.flat)
        self.assertIn("repair", self.flat)

    def test_a_taught_spelling_pattern_owes_a_dictation_with_a_mark_scheme(self):
        self.assertIn("dictation", self.flat)
        self.assertIn("mark scheme", self.flat)

    def test_the_exit_ticket_owes_a_new_context_and_a_real_self_rating(self):
        self.assertIn("new context", self.flat)
        self.assertIn("self_prediction", self.flat)

    def test_one_lesson_names_one_primary_skill(self):
        self.assertIn("primary skill", self.flat)

    def test_an_overloaded_segment_is_surfaced_and_not_compressed(self):
        # 8A and 0F on seg5 are a SEGMENTATION fact: the row carries two
        # unrelated skills. An author who quietly drops one to score better
        # has broken the SLO-to-activity match the operator asked for.
        self.assertIn("segmentation", self.flat)

    def test_differentiation_serves_both_ends(self):
        self.assertIn("stretch", self.flat)

    def test_the_answer_key_is_checked_against_its_own_stimulus(self):
        # 7B on seg5: the key said "every card moves" when THURSDAY was
        # already in place. A key that contradicts a correct child is worse
        # than no key at all.
        self.assertIn("answer key", self.flat)


class WhatTheSecondPassAdded(unittest.TestCase):
    """The findings the first revise pass did not remove, because nothing had
    ever asked for them."""

    def setUp(self):
        self.flat = " ".join(lessonrules.RULES).lower()

    def test_every_phase_answers_the_objective_the_lesson_states(self):
        # 1E on both failing lessons: an activity that measures nothing the
        # stated SLO asked for is an orphan, however good it is.
        self.assertIn("[1e]", self.flat)
        self.assertIn("orphan", self.flat)

    def test_a_partner_activity_declares_its_information_gap_or_its_absence(self):
        # 9F on seg6. The rubric takes an honest one-liner; what it will not
        # take is a pair task that quietly has nothing to find out.
        self.assertIn("[9f]", self.flat)
        self.assertIn("information gap", self.flat)
        self.assertIn("declare", self.flat)

    def test_the_we_do_does_not_repeat_the_you_do(self):
        # 7A on seg6: the same sentence in both, so the release never happens.
        self.assertIn("word for word", self.flat)


class TheLessonBriefCarriesThem(unittest.TestCase):

    def page(self):
        return {"printed_page_number": 2, "pdf_page_index": 5,
                "chapter": {"number": 1, "title": "Hello World!"},
                "headings": [], "text_verbatim": "", "exercises": [],
                "illustrations": []}

    def seg(self, **kw):
        d = {"segment_index": 1, "chapter_number": 1, "lp_type": "content",
             "topic": "Key Words", "skill_type": "vocabulary_grammar",
             "pages_printed": [2], "slo_codes": ["E-01-VO-01"],
             "slo_descriptions": ["Name various objects through pictures"],
             "blooms": "remember", "duration_min": 30}
        d.update(kw)
        return d

    def brief(self, **kw):
        return cbrief.context(self.seg(**kw), [self.page()],
                              book={"stem": "grade_1_english", "grade": 1,
                                    "subject": "English",
                                    "chapter_title": "Hello World!"})

    def test_a_lesson_author_is_handed_them_beside_the_budget(self):
        b = self.brief()
        self.assertEqual(b["rules"], lessonrules.RULES)
        self.assertIn("budget", b)

    def test_a_worksheet_author_is_not(self):
        # The worksheet has its own rules and no partner activity, no exit
        # ticket and no gradual release to carry these.
        b = self.brief(lp_type="assessment", segment_index=995)
        self.assertEqual(b["shape"], "worksheet")
        self.assertNotIn("rules", b)

    def test_a_revision_author_is_not_either(self):
        b = self.brief(lp_type="revision", skill_type="revision",
                       segment_index=990)
        self.assertEqual(b["shape"], "revision")
        self.assertNotIn("rules", b)


if __name__ == "__main__":
    unittest.main()
class WhatTheThirdPassFound(unittest.TestCase):
    """The re-judge of 19 Sep found something different from the two passes
    before it. Every finding left on seg5 -- 5D new context, 5D self-prediction,
    1F Bloom's -- broke a rule the brief ALREADY carried. Nothing was missing
    from the brief; the lesson simply did not follow it.

    So only one line is added, and it is not a new rule: the 5D new-context
    rule gains the concrete shape the defect kept taking, because "an item the
    children have not already met" was abstract enough to be read as satisfied
    by a word that had been on the board for twenty minutes.
    """

    def setUp(self):
        self.flat = " ".join(lessonrules.RULES).lower()

    def test_the_new_context_rule_names_the_board(self):
        self.assertIn("still on the board", self.flat)

    def test_the_rules_the_third_pass_broke_were_already_there(self):
        for phrase in ("new context", "self_prediction", "mostly demands"):
            self.assertIn(phrase, self.flat)


class WhatTheBasicsPilotAdded(unittest.TestCase):
    """The first Number Fluency period, judged 20 Sep 2026 (bd-uh2dt).

    One artefact, and three of its four 2-ratings were one defect wearing
    three hats -- 5C, 6C and 8C all came off for a drill that never said what
    the numbers were FOR and never let a child speak about their own life.
    A basics period is the likeliest place in the build for that to happen,
    because rehearsal has no story in it by default.

    What makes it a rule rather than one lesson's fix is where the remedy came
    from. Printed page 2 of grade_2_math asks 'Can you think of a place where
    you have seen such numbers?' and 'How do numbers help us in our daily
    life?', and the chapter then does nothing with either. The book had
    already written the beat; the lesson had walked past it. That shape --
    an opener the textbook asks and never answers -- is in nearly every
    chapter of all seventeen books, so the rule is to go and use it.
    """

    def rule(self):
        return [r for r in lessonrules.RULES if r.startswith("[8C]")]

    def test_the_real_world_beat_is_asked_for(self):
        self.assertEqual(len(self.rule()), 1)

    def test_it_sends_the_author_to_the_books_own_unused_question(self):
        one = self.rule()[0]
        self.assertIn("already on the page", one)

    def test_the_children_supply_the_context_and_not_the_numbers(self):
        # The whole reason this is safe to add: it buys student voice without
        # spending the anchor rule, which is the one thing a teacher notices.
        one = self.rule()[0]
        self.assertIn("anchor", one)

    def test_it_does_not_weaken_the_anchor_rule(self):
        flat = " ".join(lessonrules.RULES)
        self.assertNotIn("outside the chapter", flat)
