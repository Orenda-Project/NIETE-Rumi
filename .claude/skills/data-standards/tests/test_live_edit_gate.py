"""The live Edit/Write gate (hooks/live-schema-edit-gate.py): a warning never
blocks but is reported as WARN with its reason, and problems already in the
file before the edit never block. Slack and the board are stubbed out, so
these tests send nothing anywhere."""

import importlib.util
import io
import json
import subprocess
from pathlib import Path

import pytest

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "live-schema-edit-gate.py"


@pytest.fixture
def gate(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location("live_gate", HOOK)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    sent = {"slack": [], "board": []}
    monkeypatch.setattr(mod, "_notify_slack", lambda *a, **k: sent["slack"].append((a, k)))
    monkeypatch.setattr(mod, "_notify_governance", lambda *a, **k: sent["board"].append((a, k)))
    monkeypatch.setattr(mod, "_is_schema_relevant", lambda path: True)
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    (tmp_path / "db" / "migrations").mkdir(parents=True)
    monkeypatch.chdir(tmp_path)

    def write(rel: str, content: str):
        event = {"tool_name": "Write", "tool_input": {"file_path": str(tmp_path / rel), "content": content}}
        monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(event)))
        out = io.StringIO()
        monkeypatch.setattr("sys.stdout", out)
        code = mod.main()
        return code, out.getvalue(), sent

    return write


def test_warning_passes_and_reports_warn_with_reason(gate):
    code, out, sent = gate("db/migrations/0001_lessons.sql", """-- migration
CREATE TABLE lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ
);""")
    assert code == 0
    message = json.loads(out)["systemMessage"]
    assert "PASS with warnings" in message and "why D15-free-text-category only warns" in message
    (args, kwargs), = sent["board"]
    assert args[0] == "PASS WITH WARNINGS" and "Why D15-free-text-category only warns" in kwargs["summary"]
    assert sent["slack"][0][0][0] == "warn"


def test_block_still_blocks(gate):
    code, _out, sent = gate("db/migrations/0002_rename.sql",
                            "-- migration\nALTER TABLE lessons RENAME COLUMN title TO name;")
    assert code == 2
    assert sent["board"][0][0][0] == "FAIL"


def test_existing_problem_in_the_file_does_not_block_an_unrelated_edit(gate, tmp_path):
    old = "-- migration\nCREATE TABLE scores (\n  id SERIAL PRIMARY KEY\n);\n"
    (tmp_path / "db" / "schema.sql").write_text(old, encoding="utf-8")
    code, out, sent = gate("db/schema.sql", old + "-- a comment only\n")
    assert code == 0
    assert sent["board"][0][0][0] == "PASS"
    assert "already in the changed file" in sent["board"][0][1]["summary"]
