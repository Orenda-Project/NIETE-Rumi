#!/usr/bin/env python3
"""test_feature_map_portal_saves.py — a portal flow that saves through the bot selects its portal scenarios
(bd-5b3u70.18, data E2E).

Run: python3 .claude/qa/shared/test_feature_map_portal_saves.py

The teacher app's class screens save through the bot: the portal route calls the bot's internal API, and the bot's
ClassService writes students and class_enrollments. When a commit changes that service, the commit-time sync must be
told which portal scenarios cover the save (spec_sync's data_writes[] names the features whose changed files hold
it), or the data step lands nowhere. So the service is mapped to the teacher-classes web feature, pinned to the
scenarios that save through it.

Red-first: fails while class.service.js is unmapped.
"""
import os
import sys
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BIN = os.path.join(ROOT, ".claude", "qa", "engine", "bin")
sys.path.insert(0, BIN)
import select_e2e  # noqa: E402
import select_scenarios  # noqa: E402

MAP = os.path.join(ROOT, ".claude", "qa", "config", "feature-map.yaml")
AGENTS = os.path.join(ROOT, ".claude", "qa", "agents")
SERVICE = "bot/shared/services/classes/class.service.js"


class PortalSavesThroughTheBot(unittest.TestCase):
    def test_the_class_service_selects_teacher_classes(self):
        fmap = select_e2e.load_map(MAP, AGENTS)
        self.assertIn("teacher-classes", fmap.web_match(SERVICE))

    def test_it_pins_the_scenarios_that_save_through_it(self):
        pins = select_scenarios.load_web_scenario_pins(MAP).get("teacher-classes", [])
        ids = sorted({i for glob, got in pins if select_e2e.glob_match(glob, SERVICE) for i in got})
        self.assertEqual(ids, ["TK03", "TK04", "TK05", "TK06"])

    def test_it_is_no_longer_unmapped(self):
        fmap = select_e2e.load_map(MAP, AGENTS)
        sel = select_e2e.select([SERVICE], fmap, select_e2e.load_feature_order(AGENTS))
        self.assertNotIn(SERVICE, getattr(sel, "unmapped", []))


if __name__ == "__main__":
    unittest.main(verbosity=2)
