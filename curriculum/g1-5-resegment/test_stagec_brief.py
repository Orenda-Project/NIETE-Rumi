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
