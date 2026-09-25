"""Red-first tests for scripts/gate_telemetry.py — the one place every gate
firing is recorded.

Why this exists: on 2026-09-25 all three gate hooks were triggered by hand and
a real block was produced — and no log anywhere recorded that it happened. The
only trace was the session transcript. A gate that cannot be counted cannot be
evaluated, promoted, or retired on evidence.

Run:  python3 <path>/tests/test_gate_telemetry.py -v
Stdlib only. Nothing here touches the network: urlopen is replaced in every
test that would reach it, and a test that reaches it anyway fails loudly.
"""
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SKILL = Path(__file__).resolve().parents[1]
MODULE = SKILL / "scripts" / "gate_telemetry.py"


def load():
    spec = importlib.util.spec_from_file_location("gate_telemetry", MODULE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


REQUIRED = {"schema_version", "id", "at", "gate", "skill", "result", "repo", "branch",
            "actor", "device", "standards", "findings", "files", "cwd_is_repo", "via"}

ABS_PATH = re.compile(r"(^|[\s\"'=:])(/(?:home|Users|tmp|var)/|[A-Za-z]:\\)")


def explode(*a, **k):
    raise AssertionError("network reached — urlopen must not be called in this test")


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name) / "claude"
        self.home.mkdir()
        self.repo = Path(self.tmp.name) / "repo"
        self.repo.mkdir()
        self.env = mock.patch.dict(os.environ, {
            "CLAUDE_CONFIG_DIR": str(self.home),
            "TELEMETRY_URL": "", "TELEMETRY_KEY": "",
            "TALEEMABAD_TELEMETRY_OFF": "",
        })
        self.env.start()
        self.gt = load()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def log_lines(self):
        p = self.home / "gate-events.jsonl"
        return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []

    def queue_lines(self):
        p = self.home / ".gate-events-queue.jsonl"
        return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []


class LocalRecord(Base):
    def test_emit_appends_one_complete_record(self):
        with mock.patch("urllib.request.urlopen", explode):
            rec = self.gt.emit("commit", "data-standards", "block",
                               standards=["D5", "D1"], findings=3, files=1,
                               repo_root=self.repo, detach=False)
        lines = self.log_lines()
        self.assertEqual(len(lines), 1)
        self.assertTrue(REQUIRED <= set(lines[0]), msg=f"missing: {REQUIRED - set(lines[0])}")
        self.assertEqual(lines[0]["id"], rec["id"])
        self.assertEqual(lines[0]["standards"], ["D1", "D5"])   # sorted, deduped
        self.assertEqual(lines[0]["findings"], 3)
        self.assertEqual(lines[0]["result"], "block")
        self.assertEqual(lines[0]["repo"], "repo")               # basename only

    def test_record_carries_no_absolute_path_or_finding_text(self):
        with mock.patch("urllib.request.urlopen", explode):
            self.gt.emit("live-edit", "data-standards", "block", standards=["D4"],
                         findings=1, files=1, repo_root=self.repo, detach=False,
                         extra={"note": f"{self.repo}/migrations/V1.sql has phone TEXT"})
        raw = json.dumps(self.log_lines()[0])
        self.assertIsNone(ABS_PATH.search(raw), msg=raw)
        self.assertNotIn("phone TEXT", raw)

    def test_no_endpoint_means_no_post_but_still_logged(self):
        with mock.patch("urllib.request.urlopen", explode):
            self.gt.emit("commit", "data-standards", "pass", repo_root=self.repo, detach=False)
        self.assertEqual(len(self.log_lines()), 1)
        self.assertEqual(self.queue_lines(), [])

    def test_off_switch_records_nothing(self):
        with mock.patch.dict(os.environ, {"TALEEMABAD_TELEMETRY_OFF": "1"}), \
             mock.patch("urllib.request.urlopen", explode):
            self.gt.emit("commit", "data-standards", "pass", repo_root=self.repo, detach=False)
        self.assertEqual(self.log_lines(), [])


class Endpoint(Base):
    def test_post_carries_array_and_both_auth_headers(self):
        captured = {}

        class Resp:
            status = 204
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return b""

        def fake_urlopen(req, timeout=None):
            captured["url"] = req.full_url
            captured["headers"] = {k.lower(): v for k, v in req.header_items()}
            captured["body"] = json.loads(req.data.decode())
            return Resp()

        with mock.patch.dict(os.environ, {"TELEMETRY_URL": "https://t.invalid/events",
                                          "TELEMETRY_KEY": "writeonly"}), \
             mock.patch("urllib.request.urlopen", fake_urlopen):
            self.gt.emit("ci", "data-standards", "pass", files=2, repo_root=self.repo, detach=False)
        self.assertEqual(captured["url"], "https://t.invalid/gate-events")
        self.assertEqual(captured["headers"].get("authorization"), "Bearer writeonly")
        self.assertEqual(captured["headers"].get("apikey"), "writeonly")
        self.assertIsInstance(captured["body"], list)
        self.assertEqual(captured["body"][0]["gate"], "ci")

    def test_failed_post_queues_the_record_and_emit_still_returns(self):
        def broken(req, timeout=None):
            raise OSError("connection refused")
        with mock.patch.dict(os.environ, {"TELEMETRY_URL": "https://t.invalid/events",
                                          "TELEMETRY_KEY": "writeonly"}), \
             mock.patch("urllib.request.urlopen", broken):
            rec = self.gt.emit("commit", "data-standards", "block", standards=["D1"],
                               findings=1, files=1, repo_root=self.repo, detach=False)
        self.assertIsNotNone(rec)
        self.assertEqual(len(self.log_lines()), 1)
        self.assertEqual([q["id"] for q in self.queue_lines()], [rec["id"]])

    def test_dotenv_inline_comment_reads_as_blank(self):
        # The exact bug fixed upstream in the pack on 2026-09-22: KEY=  # comment
        # must be blank, not the comment text.
        (self.repo / ".env").write_text(
            "TELEMETRY_URL=            # optional — HTTPS endpoint\nTELEMETRY_KEY=k  # note\n")
        url, key = self.gt.resolve_endpoint(search_from=self.repo)
        self.assertEqual(url, "")
        self.assertEqual(key, "k")


class NeverRaises(Base):
    def test_unwritable_log_dir_does_not_raise(self):
        with mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": str(self.repo / "no" / "such" / "dir")}), \
             mock.patch("urllib.request.urlopen", explode), \
             mock.patch("pathlib.Path.mkdir", side_effect=PermissionError("ro")):
            try:
                self.gt.emit("commit", "data-standards", "pass", repo_root=self.repo, detach=False)
            except Exception as e:  # noqa: BLE001
                self.fail(f"emit() raised {e!r}")


class CLIReport(Base):
    def test_emit_reads_validator_report_from_stdin(self):
        # The bash commit gate holds the validator's JSON in a variable; parsing
        # it in bash is the fragile part, so the CLI takes the report on stdin.
        report = {"result": "fail", "files_checked": ["a.sql", "b.sql"],
                  "findings": [{"standard": "D5"}, {"standard": "D1"}, {"standard": "D5"}]}
        env = {**os.environ, "CLAUDE_CONFIG_DIR": str(self.home),
               "TELEMETRY_URL": "", "TELEMETRY_KEY": "", "TALEEMABAD_TELEMETRY_OFF": ""}
        r = subprocess.run([sys.executable, str(MODULE), "emit", "--gate", "commit",
                            "--skill", "data-standards", "--result", "block",
                            "--from-stdin-report", "--sync"],
                           input=json.dumps(report), capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout, "")
        rec = self.log_lines()[-1]
        self.assertEqual(rec["standards"], ["D1", "D5"])
        self.assertEqual(rec["findings"], 3)
        self.assertEqual(rec["files"], 2)


if __name__ == "__main__":
    unittest.main()
