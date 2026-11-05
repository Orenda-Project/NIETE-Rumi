"""Tests for scripts/validate_schema.py: the original D1-D8 evals still hold,
the added checks (D8 duplicate version, D9, D12, D14-D17) fire as intended,
warn checks never block, and problems already in a file before a change are
reported but never block. Run: python -m pytest skills/data-standards/tests"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SKILL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL / "scripts"))
import validate_schema as vs  # noqa: E402

FIXTURES = SKILL / "evals" / "fixtures"
VALIDATOR = SKILL / "scripts" / "validate_schema.py"
RULES = vs.load_enforcement()


def checks(items):
    return sorted(f["check"] for f in items)


def judge(sql, old="", path="db/migrations/0001_x.sql", siblings=None):
    return vs.judge_change(path, old, sql, siblings, RULES)


def run(args, cwd):
    proc = subprocess.run([sys.executable, str(VALIDATOR), *args], cwd=cwd, capture_output=True, text=True)
    return proc.returncode, json.loads(proc.stdout or "{}")


# ── the existing evals (evals/evals.json C1-C5) still hold ─────────────────

@pytest.mark.parametrize("fixture, exit_code, standards", [
    ("clean_migration.sql", 0, []),
    ("violating_migration.sql", 1, ["D1", "D3", "D4", "D5", "D8"]),
    ("classified_pii_migration.sql", 0, []),
    ("destructive_migration.sql", 1, ["D8", "D8"]),
    ("destructive_migration_reviewed.sql", 0, []),
])
def test_eval_fixtures_unchanged(tmp_path, fixture, exit_code, standards):
    shutil.copy(FIXTURES / fixture, tmp_path)
    code, out = run(["--mode", "full", "--path", str(tmp_path)], tmp_path)
    assert code == exit_code
    assert out["result"] == ("fail" if exit_code else "pass")
    assert sorted(f["standard"] for f in out["findings"]) == standards


# ── the added checks ───────────────────────────────────────────────────────

GOOD_TABLE = """-- migration
CREATE TABLE lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ
);"""


def test_good_table_is_clean():
    out = judge(GOOD_TABLE, siblings=["0001_x.sql", "0001_x.rollback.sql"])
    assert out == {"findings": [], "warnings": [], "existing": []}


def test_d12_rename_blocks():
    out = judge("-- migration\nALTER TABLE teachers RENAME COLUMN phone TO mobile;")
    assert checks(out["findings"]) == ["D12-rename"]
    out = judge("-- migration\nALTER TABLE teachers RENAME TO staff_members;")
    assert checks(out["findings"]) == ["D12-rename"]


def test_d12_not_null_without_default_blocks():
    out = judge("-- migration\nALTER TABLE teachers ADD COLUMN grade TEXT NOT NULL;")
    assert checks(out["findings"]) == ["D12-not-null-without-default"]
    for ok in ("ALTER TABLE teachers ADD COLUMN grade TEXT NOT NULL DEFAULT 'g1';",
               "ALTER TABLE teachers ADD COLUMN n BIGSERIAL NOT NULL;",
               "ALTER TABLE teachers ADD CONSTRAINT c CHECK (x > 0);"):
        assert "D12-not-null-without-default" not in checks(judge("-- migration\n" + ok)["findings"])


def test_d12_reviewed_marker_lets_it_through():
    sql = "-- migration\n-- breaking: reviewed, app deploy 4.2 reads both names\nALTER TABLE t RENAME COLUMN a TO b;"
    assert judge(sql)["findings"] == []


def test_d8_duplicate_numbered_version_warns_but_dates_do_not():
    out = judge(GOOD_TABLE, path="db/migrations/0042_add.sql", siblings=["0042_add.sql", "0042_other.sql"])
    assert "D8-duplicate-version" in checks(out["warnings"])
    for a, b in (("20261029_a.sql", "20261029_b.sql"), ("2026-09-25-a.sql", "2026-10-05-b.sql")):
        out = judge(GOOD_TABLE, path=f"db/migrations/{a}", siblings=[a, b])
        assert "D8-duplicate-version" not in checks(out["findings"] + out["warnings"])
    out = judge(GOOD_TABLE, path="db/migrations/0042_add.sql", siblings=["0042_add.sql", "0042_add.rollback.sql"])
    assert "D8-duplicate-version" not in checks(out["findings"] + out["warnings"])


def test_warn_checks_never_block():
    sql = """-- migration
CREATE TABLE Teacher (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  active BOOLEAN NOT NULL DEFAULT true,
  synced TIMESTAMPTZ,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
DELETE FROM teachers_old;"""
    out = judge(sql, siblings=["0001_x.sql"])
    assert out["findings"] == []
    assert checks(out["warnings"]) == sorted([
        "D9-hard-delete", "D9-no-deleted-at", "D14-table-name", "D14-boolean-prefix",
        "D14-timestamp-suffix", "D15-free-text-category", "D16-no-is-test", "D17-no-rollback"])
    assert all(f["why"] for f in out["warnings"])


def test_d15_is_quiet_when_values_are_limited():
    for col in ("status TEXT NOT NULL CHECK (status IN ('a','b'))",
                "status_id UUID REFERENCES statuses(id)",
                "status lesson_status NOT NULL"):
        sql = f"-- migration\nCREATE TABLE lessons (\n  id UUID PRIMARY KEY,\n  {col},\n  deleted_at TIMESTAMPTZ\n);"
        assert "D15-free-text-category" not in checks(judge(sql)["warnings"])


def test_d9_skips_log_tables_and_d17_accepts_in_file_down():
    sql = "-- migration\nCREATE TABLE message_logs (\n  id UUID PRIMARY KEY\n);\n-- migrate:down\nDROP TABLE message_logs;"
    out = judge(sql, siblings=["0001_x.sql"])
    assert "D9-no-deleted-at" not in checks(out["warnings"])
    assert "D17-no-rollback" not in checks(out["warnings"])


def test_strict_promotes_warn_to_block():
    rules = vs.load_enforcement(["D15", "D9-hard-delete"])
    out = vs.judge_change("x.sql", "", "-- migration\nDELETE FROM a;\nALTER TABLE t ADD COLUMN kind TEXT;", None, rules)
    assert checks(out["findings"]) == ["D15-free-text-category", "D9-hard-delete"]


# ── problems already there before the change never block ──────────────────

OLD_DEBT = """-- migration
CREATE TABLE scores (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER,
  created_at TIMESTAMP
);"""


def test_existing_problems_are_reported_not_blocking():
    new = OLD_DEBT + "\n" + GOOD_TABLE
    out = judge(new, old=OLD_DEBT, path="database/schema.sql")
    assert out["findings"] == []
    assert {"D1-primary-key", "D3-foreign-key", "D5-timestamptz"} <= set(checks(out["existing"]))


def test_a_new_problem_in_an_old_file_still_blocks():
    new = OLD_DEBT + "\nCREATE TABLE notes (\n  id INTEGER PRIMARY KEY\n);"
    out = judge(new, old=OLD_DEBT, path="database/schema.sql")
    assert [f["table"] for f in out["findings"] if f["check"] == "D1-primary-key"] == ["notes"]


def test_diff_mode_reads_both_commits(tmp_path):
    git = lambda *a: subprocess.run(["git", *a], cwd=tmp_path, check=True, capture_output=True)  # noqa: E731
    git("init", "-q")
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "t")
    (tmp_path / "database").mkdir()
    schema = tmp_path / "database" / "schema.sql"
    schema.write_text(OLD_DEBT, encoding="utf-8")
    git("add", ".")
    git("commit", "-qm", "base")
    schema.write_text(OLD_DEBT + "\nALTER TABLE scores ADD COLUMN level TEXT;\n", encoding="utf-8")
    git("commit", "-qam", "head")
    code, out = run(["--mode", "diff", "--base", "HEAD~1", "--head", "HEAD"], tmp_path)
    assert code == 0, out
    assert out["outcome"] == "warn"
    assert checks(out["warnings"]) == ["D15-free-text-category"]
    assert out["existing"]
    assert "WARNING (did not block)" in out["summary"] and "Why D15-free-text-category only warns" in out["summary"]


def test_summary_text_lists_blocks_warnings_and_why_once():
    report = {"findings": [{"standard": "D12", "path": "m.sql", "table": "t", "finding": "renames"}],
              "warnings": [{"standard": "D9", "check": "D9-no-deleted-at", "path": "m.sql", "table": "a",
                            "finding": "x", "why": "because"},
                           {"standard": "D9", "check": "D9-no-deleted-at", "path": "m.sql", "table": "b",
                            "finding": "y", "why": "because"}],
              "existing": [{}]}
    text = vs.summary_text(report)
    assert text.startswith("BLOCKED: D12 m.sql table t: renames")
    assert text.count("Why D9-no-deleted-at only warns: because") == 1
    assert "1 problem(s) already in the changed file(s)" in text


def test_down_section_is_not_judged_as_forward_code():
    sql = ("-- migration\nALTER TABLE lessons ADD COLUMN body TEXT;\n"
           "-- migrate:down\nALTER TABLE lessons DROP COLUMN body;\nALTER TABLE lessons RENAME COLUMN a TO b;")
    out = judge(sql, siblings=["0001_x.sql"])
    assert out["findings"] == []
    assert "D17-no-rollback" not in checks(out["warnings"])
