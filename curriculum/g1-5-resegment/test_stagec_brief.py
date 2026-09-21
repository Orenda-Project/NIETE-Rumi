# -*- coding: utf-8 -*-
"""The brief is what 17 workers read; the gate is what rejects them.

It was generated from stagec.VOCAB once, in a scratch script that no longer
exists, so nothing stops the two drifting apart. A worker told to use a value
the gate refuses -- or never told about one the gate accepts -- fails for a
reason it cannot see. These tests are the only thing holding them together.
"""
import io
import os
import re
import unittest

import stagec
import stagec_verify

BRIEF = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                     "stagec_agent_brief.md")


def brief_text():
    with io.open(BRIEF, encoding="utf-8") as fh:
        return fh.read()


def bulleted(text):
    """Every value the brief offers as a choice, i.e. `- \\`value\\`` lines."""
    return set(re.findall(r"^\s*-\s+`([^`]+)`\s*$", text, re.M))


class TheBriefMatchesTheGate(unittest.TestCase):

    def setUp(self):
        self.text = brief_text()
        self.offered = bulleted(self.text)

    def test_every_value_the_gate_accepts_is_offered(self):
        for column, values in stagec.VOCAB.items():
            for value in values:
                self.assertIn(value, self.offered,
                              "%s: %r is legal but the brief never offers it"
                              % (column, value))

    def test_nothing_is_offered_that_the_gate_would_reject(self):
        legal = set()
        for values in stagec.VOCAB.values():
            legal.update(values)
        stray = sorted(v for v in self.offered if v not in legal)
        self.assertEqual(stray, [],
                         "the brief offers values the gate rejects: %s" % stray)

    def test_the_guard_against_spawning_is_still_at_the_top(self):
        head = self.text[:1200].lower()
        self.assertIn("do not spawn", head.replace("\n", " "))


class TheBriefStatesTheRulesItIsJudgedBy(unittest.TestCase):

    def setUp(self):
        self.text = brief_text()

    def test_the_flatness_thresholds_it_quotes_are_the_real_ones(self):
        """A brief quoting a threshold the gate does not use teaches a worker
        to aim at the wrong target."""
        self.assertIn("more than %d%% of your" % int(stagec_verify.MAX_SHARE * 100),
                      self.text)
        self.assertIn("fewer than %d days" % stagec_verify.MIN_ROWS_PER_SKILL,
                      self.text)

    def test_it_publishes_no_count_a_worker_can_aim_at(self):
        """Nine of ten slices in the first wave landed on exactly seven
        identical days inside some skill type, because the brief named eight.
        A threshold a worker can count toward is a threshold it will stop one
        short of, and the column is then shaped by the number, not the days."""
        self.assertNotIn("8 or more days", self.text)
        low = self.text.lower()
        self.assertIn("the gate does the counting", low)

    def test_it_warns_that_the_spine_is_not_evidence(self):
        """The maths_G1 pilot failed exactly here: it read peer_review off a
        derived spine and wrote peer-check on 112 of 116 days."""
        low = self.text.lower()
        self.assertIn("spine is not evidence", low)
        self.assertIn("peer_review", self.text)

    def test_it_forbids_sprinkling_variety_to_beat_the_check(self):
        self.assertIn("sprinkling variety", self.text.lower())




class TheBriefCarriesTheCrossColumnRule(unittest.TestCase):
    """Interaction and Gap are judged together, so the brief must say so --
    a worker told only the per-column rules cannot see that check coming."""

    def test_it_quotes_the_choral_threshold_the_gate_uses(self):
        self.assertIn("more than %d%% of your"
                      % int(stagec_verify.CHORAL_MAX * 100), brief_text())

    def test_it_names_the_failure(self):
        self.assertIn("choral practice in pairs", brief_text())

    def test_it_forbids_relabelling_gaps_to_pass(self):
        self.assertIn("not to relabel gaps upward", brief_text())


class TheBriefNamesEveryDayThatMayNotSayNotApplicable(unittest.TestCase):
    """The strategy rule is the one a worker cannot infer from the spine.

    Both directions are pinned. A skill type the gate rejects `n/a` on must be
    named in the brief, or the worker fails for a reason it was never told;
    and a skill type the brief holds up as genuinely text-free must really be
    one the gate accepts, or the brief is teaching the invention it forbids.
    """

    REJECTED = (
        ("English", "Reading comprehension"),
        ("English", "Pre-reading"),
        ("English", "Phonics"),
        ("Urdu", u"تفہیم · Comprehension"),
        ("Urdu", u"ارکان سازی · Syllables"),
        ("Urdu", u"بلند خوانی · Reading aloud"),
    )
    ALLOWED = (
        ("English", "Oral communication"),
        ("Science", "Investigate"),
        ("Maths", "Concrete"),
    )

    def test_every_skill_type_the_gate_rejects_is_named(self):
        text = brief_text()
        for subject, skill_type in self.REJECTED:
            self.assertTrue(
                stagec_verify.needs_strategy(skill_type, subject),
                "%s is in the fixture but the gate allows n/a on it" % skill_type)
            self.assertIn(skill_type, text)

    def test_the_days_it_calls_text_free_really_are(self):
        text = brief_text()
        for subject, skill_type in self.ALLOWED:
            self.assertFalse(
                stagec_verify.needs_strategy(skill_type, subject),
                "the brief calls %s text-free but the gate rejects n/a on it"
                % skill_type)
            self.assertIn(skill_type, text)

    def test_it_warns_that_reading_aloud_looks_oral(self):
        self.assertIn("The skill type is.", brief_text())

    def test_it_still_says_not_applicable_is_a_real_answer(self):
        self.assertIn("legitimate answer and an honest one", brief_text())


class TheBriefCarriesTheTwoRulesTheUrduPilotBroke(unittest.TestCase):
    """The G1 Urdu pilot produced two defects that traced back to this file.

    It wrote a reading strategy on eight days whose topic and SLO are purely
    oral -- an opener where children talk about their family -- because the
    brief said the skill tag decides and never said the tag is silent about
    whether text is present. And it set `Recycles` equal to `Prerequisite
    SLOs` on all 124 rows, because the brief described what Recycles means
    without ever saying it is a different question from the prerequisite.
    """

    def setUp(self):
        self.text = brief_text()

    def test_it_says_a_textless_reading_aloud_day_takes_pending(self):
        low = self.text.lower()
        self.assertIn("the tag does not promise text", low)
        self.assertIn(stagec.PENDING, self.text)

    def test_it_does_not_leave_the_skill_type_as_the_only_word(self):
        """The old wording ended on "The skill type is." with nothing after
        it, and a worker reading only that overrides the day it can see."""
        self.assertNotIn("what decides this. The skill type is.\n\nEverywhere",
                         self.text)

    def test_it_forbids_recycles_restating_the_prerequisite(self):
        low = self.text.lower()
        self.assertIn("never restate the prerequisite", low)

    def test_the_copied_column_rule_is_stated_where_the_gate_enforces_it(self):
        """A gate rule absent from the brief fails a worker invisibly."""
        low = self.text.lower()
        self.assertIn("two columns that hold the same value on every row",
                      low)


class TheBriefWarnsAgainstBalancingACounted(unittest.TestCase):
    """The gate now rejects a column split into exact equal parts, and the
    brief has to say so before a worker meets it as a rejection.

    english_G4 annotated its twelve Pre-reading days `pre-teach-vocabulary` 3,
    `predict` 3, `activate-prior-knowledge` 3, `set-purpose` 3, while its four
    sibling grades all landed lopsided. The brief already tells workers not to
    sprinkle variety until a count drops; it never said that the finished
    column is read for the opposite shape too.
    """

    def setUp(self):
        self.text = brief_text()

    def test_it_says_an_exact_tie_is_rejected(self):
        low = self.text.lower()
        self.assertIn("split into exact equal parts", low)

    def test_it_says_an_honest_column_is_lopsided(self):
        """Without this, a worker reads the rule as a demand for variety and
        balances harder, which is the failure itself."""
        low = self.text.lower()
        self.assertIn("days are uneven", low)


if __name__ == "__main__":
    unittest.main()
