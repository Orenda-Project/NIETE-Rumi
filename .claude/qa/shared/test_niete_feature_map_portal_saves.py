#!/usr/bin/env python3
"""test_niete_feature_map_portal_saves.py — a portal flow that saves through the bot selects its portal scenarios
(bd-5b3u70.18, data E2E).

Run: python3 .claude/qa/shared/test_niete_feature_map_portal_saves.py

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


# Every bot service the portal saves through (bd-5b3u70.19): found by following each /api/internal call the portal
# makes to the bot code serving it and keeping the files with a supabase write (the engine's data_writes detector) —
# workbench/portal_saves_through_bot.py in the data E2E work folder. Owner = the portal feature whose scenarios do it.
THROUGH_THE_BOT = {
    "bot/shared/services/assessment/assessment-request.service.js": ["fde-board-pattern", "teacher-assessment"],
    "bot/shared/services/coaching/live-moves/live-moves.service.js": ["teacher-coaching"],
    "bot/shared/services/coaching/portal-class-check.js": ["teacher-coaching"],
    "bot/shared/services/coaching/portal-coaching.service.js": ["coach-portal", "teacher-coaching"],
    "bot/shared/services/observe/portal-observe.service.js": ["coach-portal", "teacher-coaching"],
    "bot/shared/services/quiz/report-page-quiz.js": ["teacher-coaching"],
    "bot/shared/services/lp-in-app-feedback.service.js": ["teacher-lessons"],
    "bot/shared/services/nudges/lp-coaching-ask.service.js": ["teacher-lessons"],
    "bot/shared/services/observe/observe-schedule.service.js": ["coach-portal", "leader-portal"],
    "bot/shared/services/observe/observe-school-admin.service.js": ["coach-portal", "leader-portal"],
    "bot/shared/services/observe/observe-teacher-admin.service.js": ["coach-portal", "leader-portal"],
    "bot/shared/services/observe/teacher-edit-commit.service.js": ["coach-portal", "leader-portal"],
    "bot/shared/services/quiz/web-quiz.service.js": ["web-quiz-child-page"],
    "bot/shared/services/quiz/web-quiz-evening-round.js": ["web-quiz-child-page"],
    "bot/shared/services/quiz/web-quiz-class-link.js": ["web-quiz-child-page"],
    "bot/shared/services/quiz/story-teacher.service.js": ["web-quiz-child-page"],
    "bot/shared/services/training/band-selection.service.js": ["teacher-training"],
    "bot/shared/services/training/capstone-delivery.service.js": ["teacher-training"],
    "bot/shared/services/training/certificate.service.js": ["teacher-training"],
    "bot/shared/services/training/certificate-pdf.service.js": ["teacher-training"],
    "bot/shared/services/training/quiz-delivery.service.js": ["teacher-training"],
}


class EveryServiceThePortalSavesThrough(unittest.TestCase):
    def test_each_names_its_portal_features(self):
        fmap = select_e2e.load_map(MAP, AGENTS)
        wrong = {f: sorted(fmap.web_match(f)) for f, want in THROUGH_THE_BOT.items() if sorted(fmap.web_match(f)) != want}
        self.assertEqual(wrong, {}, "service -> what the map names now (expected: THROUGH_THE_BOT)")

    def test_each_service_exists(self):
        missing = [f for f in THROUGH_THE_BOT if not os.path.isfile(os.path.join(ROOT, f))]
        self.assertEqual(missing, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
