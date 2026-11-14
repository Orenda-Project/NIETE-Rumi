"""hooks/git-gate.py with warnings: a staged migration that only warns is a
WARN verdict (never blocks), printed with the reason, and its board summary
carries the reason too. Nothing is reported: report() is not called here."""

import importlib.util
import subprocess
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "git-gate.py"


def load_gate():
    spec = importlib.util.spec_from_file_location("git_gate", HOOK)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def staged_repo(tmp_path, monkeypatch, sql):
    git = lambda *a: subprocess.run(["git", *a], cwd=tmp_path, check=True, capture_output=True)  # noqa: E731
    git("init", "-q")
    (tmp_path / "db" / "migrations").mkdir(parents=True)
    (tmp_path / "db" / "migrations" / "0001_lessons.sql").write_text(sql, encoding="utf-8")
    git("add", ".")
    monkeypatch.chdir(tmp_path)


def test_staged_warning_is_warn_not_block(tmp_path, monkeypatch, capsys):
    staged_repo(tmp_path, monkeypatch, """-- migration
CREATE TABLE lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_published BOOLEAN NOT NULL DEFAULT false,
  kind TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ
);""")
    gate = load_gate()
    verdict = gate.run_data_standards(["--mode", "staged"])
    assert verdict["result"] == "WARN"
    assert not gate.blocked(verdict)
    assert "Why D15-free-text-category only warns" in verdict["summary"]
    gate.print_verdict("data-standards", verdict, "staged for this commit")
    printed = capsys.readouterr().err + capsys.readouterr().out
    assert "PASS with warnings" in printed and "why D15-free-text-category only warns" in printed


def test_staged_block_is_fail(tmp_path, monkeypatch):
    staged_repo(tmp_path, monkeypatch, "-- migration\nALTER TABLE lessons RENAME COLUMN a TO b;")
    gate = load_gate()
    verdict = gate.run_data_standards(["--mode", "staged"])
    assert verdict["result"] == "FAIL" and gate.blocked(verdict)
