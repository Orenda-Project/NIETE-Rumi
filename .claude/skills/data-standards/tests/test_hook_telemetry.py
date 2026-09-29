"""Red-first, end-to-end: every gate firing leaves a gate-events record.

Runs the three REAL hook scripts as subprocesses, exactly the way the harness
does — JSON payload on stdin, exit code as the verdict — against a throwaway
git repository. CLAUDE_CONFIG_DIR points at a scratch directory so the records
land where the test can read them and nowhere else; TELEMETRY_URL is blank so
nothing is ever sent.

Before wiring (2026-09-25): a real block was produced by two of these hooks and
no log anywhere recorded that it happened. These tests pin the fix.

Run:  python3 <path>/tests/test_hook_telemetry.py -v
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2]            # .../skills
DS, DQG = SKILLS / "data-standards", SKILLS / "data-quality-gate"
COMMIT_GATE = DS / "hooks" / "schema-change-gate.sh"
LIVE_EDIT = DS / "hooks" / "live-schema-edit-gate.py"
LIVE_SHAPE = DQG / "hooks" / "live-schema-shape-gate.py"

VIOLATING = ("CREATE TABLE probe_tbl (\n  id SERIAL PRIMARY KEY,\n  teacher_id INTEGER,\n"
             "  created_at TIMESTAMP\n);\n")
NO_PK = "CREATE TABLE probe_nopk (\n  teacher_id uuid,\n  created_at timestamptz\n);\n"
CLEAN = ("-- flyway migration\nCREATE TABLE probe_ok (\n"
         "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n"
         "  created_at timestamptz NOT NULL DEFAULT now(),\n"
         "  updated_at timestamptz NOT NULL DEFAULT now()\n);\n")


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.home = root / "claude"
        self.home.mkdir()
        self.repo = root / "repo"
        (self.repo / "migrations").mkdir(parents=True)
        for a in (["init", "-q"], ["config", "user.email", "probe@example.invalid"],
                  ["config", "user.name", "probe"], ["commit", "-q", "--allow-empty", "-m", "root"],
                  ["branch", "-M", "main"]):
            subprocess.run(["git", "-C", str(self.repo), *a], check=True, capture_output=True)
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith(("TALEEMABAD_DATA_STANDARDS", "CLAUDE_DATA_STANDARDS",
                                         "TELEMETRY_", "TALEEMABAD_TELEMETRY"))}
        self.env.update({"CLAUDE_CONFIG_DIR": str(self.home),
                         "TELEMETRY_URL": "", "TELEMETRY_KEY": ""})

    def tearDown(self):
        self.tmp.cleanup()

    def events(self, gate=None):
        p = self.home / "gate-events.jsonl"
        ev = [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []
        return [e for e in ev if gate is None or e["gate"] == gate]

    def run_hook(self, cmd, payload):
        r = subprocess.run(cmd, input=json.dumps(payload), cwd=self.repo, env=self.env,
                           capture_output=True, text=True, timeout=90)
        return r.returncode

    def stage(self, name, text):
        p = self.repo / "migrations" / name
        p.write_text(text, encoding="utf-8")
        subprocess.run(["git", "-C", str(self.repo), "add", f"migrations/{name}"],
                       check=True, capture_output=True)

    def write_payload(self, name, text):
        return {"tool_name": "Write",
                "tool_input": {"file_path": str(self.repo / "migrations" / name), "content": text},
                "cwd": str(self.repo)}


COMMIT = {"tool_name": "Bash", "tool_input": {"command": "git commit -m probe"}}


class CommitGate(Base):
    def test_block_is_recorded(self):
        self.stage("V0.0.1__bad.sql", VIOLATING)
        self.assertEqual(self.run_hook(["bash", str(COMMIT_GATE)], COMMIT), 2)
        ev = self.events("commit")
        self.assertEqual([e["result"] for e in ev], ["block"])
        self.assertGreaterEqual(ev[0]["findings"], 3)
        self.assertIn("D1", ev[0]["standards"])
        self.assertEqual(ev[0]["files"], 1)
        self.assertEqual(ev[0]["repo"], "repo")
        self.assertEqual(ev[0]["skill"], "data-standards")

    def test_pass_is_recorded(self):
        self.stage("V0.0.2__ok.sql", CLEAN)
        self.assertEqual(self.run_hook(["bash", str(COMMIT_GATE)], COMMIT), 0)
        self.assertEqual([e["result"] for e in self.events("commit")], ["pass"])

    def test_nothing_staged_is_recorded_as_no_change(self):
        self.assertEqual(self.run_hook(["bash", str(COMMIT_GATE)], COMMIT), 0)
        self.assertEqual([e["result"] for e in self.events("commit")], ["no_change"])

    def test_unrelated_command_records_nothing(self):
        self.run_hook(["bash", str(COMMIT_GATE)],
                      {"tool_name": "Bash", "tool_input": {"command": "npm test"}})
        self.assertEqual(self.events(), [])


class LiveEditGate(Base):
    def test_block_then_pass_are_both_recorded(self):
        self.assertEqual(self.run_hook([sys.executable, str(LIVE_EDIT)],
                                       self.write_payload("V1.sql", VIOLATING)), 2)
        self.assertEqual(self.run_hook([sys.executable, str(LIVE_EDIT)],
                                       self.write_payload("V2.sql", CLEAN)), 0)
        ev = self.events("live-edit")
        self.assertEqual([e["result"] for e in ev], ["block", "pass"])
        self.assertIn("D5", ev[0]["standards"])
        self.assertEqual(ev[0]["files"], 1)

    def test_irrelevant_file_records_nothing(self):
        self.run_hook([sys.executable, str(LIVE_EDIT)],
                      {"tool_name": "Write",
                       "tool_input": {"file_path": str(self.repo / "README.md"), "content": "hi"}})
        self.assertEqual(self.events(), [])


class LiveShapeGate(Base):
    def test_block_is_recorded_under_the_sibling_skill(self):
        self.assertEqual(self.run_hook([sys.executable, str(LIVE_SHAPE)],
                                       self.write_payload("V3.sql", NO_PK)), 2)
        ev = self.events("live-shape")
        self.assertEqual([e["result"] for e in ev], ["block"])
        self.assertEqual(ev[0]["skill"], "data-quality-gate")
        self.assertIn("new_table_missing_primary_key", ev[0]["standards"])


if __name__ == "__main__":
    unittest.main()
