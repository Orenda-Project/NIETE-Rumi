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
        self.assertIn("skill type with %d or more days"
                      % stagec_verify.MIN_ROWS_PER_SKILL, self.text)

    def test_it_warns_that_the_spine_is_not_evidence(self):
        """The maths_G1 pilot failed exactly here: it read peer_review off a
        derived spine and wrote peer-check on 112 of 116 days."""
        low = self.text.lower()
        self.assertIn("spine is not evidence", low)
        self.assertIn("peer_review", self.text)

    def test_it_forbids_sprinkling_variety_to_beat_the_check(self):
        self.assertIn("sprinkling variety", self.text.lower())


if __name__ == "__main__":
    unittest.main()


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
