"""Tests for scripts/validate_schema.py: the original D1-D8 evals still hold,
the added checks (D8 duplicate version, D9, D12, D14-D17) fire as intended and
block (since 2026-11), a repo's warn_only list turns only those checks back
into warnings, and problems already in a file before a change are reported
but never block. Run: python -m pytest skills/data-standards/tests"""

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


def fired(out):
    """Every check that fired, blocking or not, for tests about detection."""
    return checks(out["findings"] + out["warnings"])


def judge(sql, old="", path="db/migrations/0001_x.sql", siblings=None):
    return vs.judge_change(path, old, sql, siblings, RULES)


def run(args, cwd):
    proc = subprocess.run([sys.executable, str(VALIDATOR), *args], cwd=cwd, capture_output=True, text=True)
    return proc.returncode, json.loads(proc.stdout or "{}")


# ── the existing evals (evals/evals.json C1-C5) still hold ─────────────────

@pytest.mark.parametrize("fixture, exit_code, standards", [
    ("clean_migration.sql", 0, []),
    ("violating_migration.sql", 1, ["D1", "D16", "D3", "D4", "D5", "D8", "D9"]),
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


def test_d8_duplicate_numbered_version_blocks_but_dates_do_not():
    out = judge(GOOD_TABLE, path="db/migrations/0042_add.sql", siblings=["0042_add.sql", "0042_other.sql"])
    assert "D8-duplicate-version" in checks(out["findings"])
    for a, b in (("20261029_a.sql", "20261029_b.sql"), ("2026-09-25-a.sql", "2026-10-05-b.sql")):
        out = judge(GOOD_TABLE, path=f"db/migrations/{a}", siblings=[a, b])
        assert "D8-duplicate-version" not in checks(out["findings"] + out["warnings"])
    out = judge(GOOD_TABLE, path="db/migrations/0042_add.sql", siblings=["0042_add.sql", "0042_add.rollback.sql"])
    assert "D8-duplicate-version" not in checks(out["findings"] + out["warnings"])


def test_d8_dotted_flyway_versions_are_read_in_full():
    # NIETE-Rumi's real names: V1.8.10 is not "version 1".
    names = ["V1.8.10__g612_subjects.sql", "V1.0.0__baseline.sql", "V1.0.10__observation_schedules.sql",
             "V1.0.1__users_teacher_uuid_idx.sql", "V1.8.1__x.sql"]
    out = judge(GOOD_TABLE, path=f"infrastructure/supabase/migrations/{names[0]}", siblings=names)
    assert "D8-duplicate-version" not in fired(out)
    assert vs._migration_version("V1.8.10__a.sql") == vs._migration_version("V1_8_10__b.sql") == "1.8.10"
    clash = ["V1.8.10__a.sql", "V1.8.10__b.sql"]
    out = judge(GOOD_TABLE, path=f"migrations/{clash[0]}", siblings=clash)
    assert "D8-duplicate-version" in checks(out["findings"])


def test_d8_duplicate_list_is_capped():
    names = ["0042_a.sql"] + [f"0042_{c}.sql" for c in "bcdefg"]
    out = judge(GOOD_TABLE, path="db/migrations/0042_a.sql", siblings=names)
    [w] = [w for w in out["findings"] if w["check"] == "D8-duplicate-version"]
    assert "and 3 more" in w["finding"] and "0042_g.sql" not in w["finding"]


FORMER_WARNINGS = sorted([
    "D9-hard-delete", "D9-no-deleted-at", "D14-table-name", "D14-boolean-prefix",
    "D14-timestamp-suffix", "D15-free-text-category", "D16-no-is-test", "D17-no-rollback"])
SLOPPY = """-- migration
CREATE TABLE Teacher (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  active BOOLEAN NOT NULL DEFAULT true,
  synced TIMESTAMPTZ,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
DELETE FROM teachers_old;"""


def test_former_warn_checks_now_block():
    out = judge(SLOPPY, siblings=["0001_x.sql"])
    assert out["warnings"] == []
    assert checks(out["findings"]) == FORMER_WARNINGS


def test_warn_only_turns_them_back_into_warnings_with_their_reason():
    rules = vs.load_enforcement(warn_only=["D9", "D14", "D15", "D16", "D17-no-rollback"])
    out = vs.judge_change("db/migrations/0001_x.sql", "", SLOPPY, ["0001_x.sql"], rules)
    assert out["findings"] == []
    assert checks(out["warnings"]) == FORMER_WARNINGS
    assert all(f["why"] for f in out["warnings"])


def test_warn_only_cannot_soften_non_negotiable_checks():
    rules = vs.load_enforcement(warn_only=["D1", "D4", "D8", "D12-rename"])
    assert rules["D1-primary-key"]["mode"] == "block"
    assert rules["D4-pii-classification"]["mode"] == "block"
    assert rules["D8-destructive"]["mode"] == "block" and rules["D8-migration-tool"]["mode"] == "block"
    assert rules["D12-rename"]["mode"] == "block"
    assert rules["D8-duplicate-version"]["mode"] == "warn"


def test_rollback_file_in_a_migrations_folder_is_not_raw_ddl():
    # NIETE-Rumi PR #4469: ROLLBACK_V1.9.9__own_plans_review.sql was blocked as
    # "raw CREATE/ALTER TABLE with no migration-tool marker".
    sql = "ALTER TABLE niete_lp612_own_plans DROP COLUMN IF EXISTS is_review_passed;"
    out = judge(sql, path="infrastructure/supabase/migrations/ROLLBACK_V1.9.9__own_plans_review.sql",
                siblings=["ROLLBACK_V1.9.9__own_plans_review.sql", "V1.9.9__own_plans_review.sql"])
    assert "D8-migration-tool" not in fired(out)
    outside = judge("ALTER TABLE t ADD COLUMN a_at TIMESTAMPTZ;", path="database/schema.sql")
    assert "D8-migration-tool" in fired(outside)


def test_d15_is_quiet_when_values_are_limited():
    for col in ("status TEXT NOT NULL CHECK (status IN ('a','b'))",
                "status_id UUID REFERENCES statuses(id)",
                "status lesson_status NOT NULL"):
        sql = f"-- migration\nCREATE TABLE lessons (\n  id UUID PRIMARY KEY,\n  {col},\n  deleted_at TIMESTAMPTZ\n);"
        assert "D15-free-text-category" not in fired(judge(sql))


def test_d9_skips_log_tables_and_d17_accepts_in_file_down():
    sql = "-- migration\nCREATE TABLE message_logs (\n  id UUID PRIMARY KEY\n);\n-- migrate:down\nDROP TABLE message_logs;"
    out = judge(sql, siblings=["0001_x.sql"])
    assert "D9-no-deleted-at" not in fired(out)
    assert "D17-no-rollback" not in fired(out)


def test_strict_still_wins_over_warn_only():
    rules = vs.load_enforcement(["D15", "D9-hard-delete"], warn_only=["D15", "D9"])
    out = vs.judge_change("x.sql", "", "-- migration\nDELETE FROM a;\nALTER TABLE t ADD COLUMN kind TEXT;", None, rules)
    assert checks(out["findings"]) == ["D15-free-text-category", "D9-hard-delete"]
    assert checks(out["warnings"]) == []


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
    assert code == 1, out
    assert out["outcome"] == "fail"
    assert checks(out["findings"]) == ["D15-free-text-category"]
    assert out["existing"]
    assert "BLOCKED: D15" in out["summary"]
    # the same change, in a repo that keeps D15 as a warning
    (tmp_path / ".data-standards.json").write_text(json.dumps({"warn_only": ["D15"]}), encoding="utf-8")
    code, out = run(["--mode", "diff", "--base", "HEAD~1", "--head", "HEAD"], tmp_path)
    assert code == 0, out
    assert out["outcome"] == "warn"
    assert checks(out["warnings"]) == ["D15-free-text-category"]
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


def test_rollback_file_is_undo_code():
    # NIETE-Rumi: 20 of 63 ROLLBACK_ files were blocked for dropping and deleting
    # what their forward migration created (D8-destructive, D9-hard-delete).
    sql = ("DELETE FROM niete_lp612_own_plans WHERE source = 'k5';\n"
           "ALTER TABLE niete_lp612_own_plans DROP COLUMN is_review_passed;\n"
           "ALTER TABLE niete_lp612_own_plans RENAME COLUMN is_library_eligible TO library_eligible;\n"
           "DROP TABLE niete_lp612_changes;\n"
           "CREATE TABLE coach_report (\n  id UUID PRIMARY KEY,\n  status TEXT,\n  sent BOOLEAN\n);")
    names = ["ROLLBACK_V1.9.8__own_plans_changes.sql", "V1.9.8__own_plans_changes.sql"]
    out = judge(sql, path=f"infrastructure/supabase/migrations/{names[0]}", siblings=names)
    assert fired(out) == []
    # the non-negotiable structure checks still apply in a rollback file
    bad = "CREATE TABLE notes (\n  id SERIAL PRIMARY KEY,\n  created_at TIMESTAMP\n);"
    out = judge(bad, path="db/migrations/0007_notes.down.sql", siblings=["0007_notes.sql", "0007_notes.down.sql"])
    assert {"D1-primary-key", "D5-timestamptz"} <= set(checks(out["findings"]))


@pytest.mark.parametrize("name, is_rollback", [
    ("ROLLBACK_V1.9.8__own_plans_changes.sql", True), ("rollback_0003_x.sql", True),
    ("U1.2__x.sql", True), ("0003_x.down.sql", True), ("0003_x_rollback.sql", True),
    ("V1.2__add_rollback_reason.sql", False), ("0009_slowdown_log.sql", False),
    ("V1.10.2__schools_district.sql", False), ("0042_undo_requests.sql", False),
])
def test_only_files_named_as_rollbacks_count_as_undo_code(name, is_rollback):
    assert vs._is_rollback_file(f"db/migrations/{name}") is is_rollback


def test_commented_out_drop_is_not_destructive():
    # NIETE-Rumi's first reason for keeping its CI advisory.
    sql = "-- migration\nALTER TABLE lessons ADD COLUMN body TEXT;\n-- DROP TABLE IF EXISTS lessons_old;\n"
    assert "D8-destructive" not in fired(judge(sql, siblings=["0001_x.sql"]))
    assert "D8-destructive" in fired(judge("-- migration\nDROP TABLE lessons_old;", siblings=["0001_x.sql"]))


@pytest.mark.parametrize("column, flagged", [
    ("parent_phone TEXT", True), ("teacher_phone VARCHAR(20)", True), ("work_email TEXT", True),
    ("guardian_cnic TEXT", True), ("mobile_number TEXT", True), ("date_of_birth DATE", False),
    ("email TEXT", True), ("is_email_verified BOOLEAN", False), ("phone_verified_at TIMESTAMPTZ", False),
    ("phone_count INTEGER", False), ("telephony_mode TEXT", False), ("parent_phone TEXT -- PII: Restricted-PII", False),
])
def test_d4_reads_pii_words_inside_column_names(column, flagged):
    # NIETE-Rumi's second reason: `\b` treated `_` as a word character, so
    # parent_phone / work_email were invisible.
    sql = f"-- migration\nCREATE TABLE contacts (\n  id UUID PRIMARY KEY,\n  {column}\n);"
    assert ("D4-pii-classification" in fired(judge(sql))) is flagged


def test_hard_delete_after_a_down_marker_is_undo_code():
    sql = ("-- migration\nINSERT INTO lessons (id) VALUES ('a');\n"
           "-- migrate:down\nDELETE FROM lessons WHERE id = 'a';")
    assert "D9-hard-delete" not in fired(judge(sql, siblings=["0001_x.sql"]))
    assert "D9-hard-delete" in fired(judge("-- migration\nDELETE FROM lessons;", siblings=["0001_x.sql"]))


def test_down_section_is_not_judged_as_forward_code():
    sql = ("-- migration\nALTER TABLE lessons ADD COLUMN body TEXT;\n"
           "-- migrate:down\nALTER TABLE lessons DROP COLUMN body;\nALTER TABLE lessons RENAME COLUMN a TO b;")
    out = judge(sql, siblings=["0001_x.sql"])
    assert out["findings"] == []
    assert "D17-no-rollback" not in fired(out)
