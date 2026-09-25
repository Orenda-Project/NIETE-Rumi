"""Red-first tests for scripts/validate_schema.py (2026-09-25).

Each test encodes a defect that was MEASURED on a real repository before it was
fixed, so the docstrings carry the evidence, not just the expectation.

Run from the skill directory:
    python3 -m unittest discover -s tests -v
or from anywhere:
    python3 -m unittest <path>/tests/test_validate_schema.py -v

Stdlib only. The two subprocess tests build a throwaway git repository under a
TemporaryDirectory; they never touch the repository this file lives in.
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
VALIDATOR = SKILL / "scripts" / "validate_schema.py"


def load_validator():
    spec = importlib.util.spec_from_file_location("validate_schema", VALIDATOR)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


V = load_validator()

# A migration that is compliant on every axis the structural checks look at,
# used as the "everything else is fine" carrier for single-defect probes.
CLEAN_TABLE = (
    "-- flyway migration\n"
    "CREATE TABLE probe (\n"
    "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n"
    "  created_at timestamptz NOT NULL DEFAULT now(),\n"
    "  updated_at timestamptz NOT NULL DEFAULT now()\n"
    ");\n"
)


def destructive(text):
    return V.check_d8_destructive_without_safety(text)


def d4(text):
    out = []
    for table, body in V.find_create_table_blocks(text):
        out += V.check_d4_new_pii_column(table, body)
    return out


class D8CommentStripping(unittest.TestCase):
    """The destructive-statement check ran its regex over raw text, comments
    included. Measured on NIETE-Rumi 2026-08-20: 23 of 85 findings (27%) were
    commented-out rollback lines or prose — stripping comments and re-running
    took the destructive count from 24 to 1."""

    def test_commented_out_drop_table_is_not_destructive(self):
        # bot/database/migrations/003_classroom_coaching.sql:409 in NIETE-Rumi
        text = CLEAN_TABLE + "-- DROP TABLE IF EXISTS coaching_quality_metrics;\n"
        self.assertEqual(destructive(text), [])

    def test_commented_out_drop_column_is_not_destructive(self):
        text = CLEAN_TABLE + "-- rollback: ALTER TABLE users DROP COLUMN old_username;\n"
        self.assertEqual(destructive(text), [])

    def test_prose_containing_truncate_is_not_destructive(self):
        # dashboard/database/migrations/009_create_ama_tables.sql:132 — a code
        # comment, read as a TRUNCATE statement.
        text = CLEAN_TABLE + "    -- Truncate content to create title (max 60 chars)\n"
        self.assertEqual(destructive(text), [])

    def test_block_comment_is_not_destructive(self):
        text = CLEAN_TABLE + "/* legacy cleanup, never run:\n   DROP TABLE legacy_scores;\n*/\n"
        self.assertEqual(destructive(text), [])

    def test_live_drop_without_safety_is_still_flagged(self):
        # Guard against over-fixing: real destructive SQL with no rollback note
        # and no `-- destructive: reviewed` marker must still be a finding.
        text = CLEAN_TABLE + "DROP TABLE legacy_scores;\n"
        found = destructive(text)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["standard"], "D8")

    def test_live_drop_with_reviewed_marker_is_not_flagged(self):
        text = CLEAN_TABLE + "-- destructive: reviewed — table is empty on every environment\nDROP TABLE legacy_scores;\n"
        self.assertEqual(destructive(text), [])


class D4UnderscoreBoundary(unittest.TestCase):
    r"""PII_NAME_PATTERN used \b(phone|cnic|email|dob)\b. Underscore is a word
    character, so no boundary exists after it: parent_phone, teacher_phone and
    work_email — 3 of the 6 real PII-shaped column names in NIETE-Rumi — were
    invisible to D4 (measured 2026-08-20). parent_phone is also exactly what
    D22 (identity graph) tells teams to collect."""

    def _cols(self, findings):
        return sorted(f["finding"].split("column `")[1].split("`")[0] for f in findings)

    def test_underscore_prefixed_pii_columns_are_flagged(self):
        text = (
            "-- flyway migration\n"
            "CREATE TABLE guardians (\n"
            "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n"
            "  parent_phone text,\n"
            "  teacher_phone text,\n"
            "  work_email text,\n"
            "  guardian_dob date,\n"
            "  created_at timestamptz NOT NULL DEFAULT now(),\n"
            "  updated_at timestamptz NOT NULL DEFAULT now()\n"
            ");\n"
        )
        self.assertEqual(self._cols(d4(text)),
                         ["guardian_dob", "parent_phone", "teacher_phone", "work_email"])

    def test_bare_pii_names_are_still_flagged(self):
        text = (
            "-- flyway migration\n"
            "CREATE TABLE users_probe (\n"
            "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n"
            "  phone text,\n"
            "  email text,\n"
            "  cnic text,\n"
            "  created_at timestamptz NOT NULL DEFAULT now(),\n"
            "  updated_at timestamptz NOT NULL DEFAULT now()\n"
            ");\n"
        )
        self.assertEqual(self._cols(d4(text)), ["cnic", "email", "phone"])

    def test_words_that_merely_contain_a_pii_token_are_not_flagged(self):
        text = (
            "-- flyway migration\n"
            "CREATE TABLE devices (\n"
            "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n"
            "  telephone_booth text,\n"
            "  microphone_level integer,\n"
            "  emailed_at timestamptz,\n"
            "  created_at timestamptz NOT NULL DEFAULT now(),\n"
            "  updated_at timestamptz NOT NULL DEFAULT now()\n"
            ");\n"
        )
        self.assertEqual(d4(text), [])

    def test_classified_pii_column_is_not_flagged(self):
        text = (
            "-- flyway migration\n"
            "CREATE TABLE guardians (\n"
            "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n"
            "  parent_phone text, -- Restricted-PII\n"
            "  created_at timestamptz NOT NULL DEFAULT now(),\n"
            "  updated_at timestamptz NOT NULL DEFAULT now()\n"
            ");\n"
        )
        self.assertEqual(d4(text), [])


VIOLATING = (
    "CREATE TABLE probe_tbl (\n"
    "  id SERIAL PRIMARY KEY,\n"
    "  teacher_id INTEGER,\n"
    "  created_at TIMESTAMP\n"
    ");\n"
)


class StagedModeFailsClosed(unittest.TestCase):
    """`git diff --cached` emits repo-root-relative paths from anywhere in the
    tree; read_files() resolved them against cwd and returned "" for anything it
    could not open. An empty file has no CREATE TABLE, so it was reported as a
    clean pass. Measured 2026-09-25: the same staged violating migration gave 4
    findings from the repo root and complete silence from bot/."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        self._git("init", "-q")
        self._git("config", "user.email", "probe@example.invalid")
        self._git("config", "user.name", "probe")
        self._git("commit", "-q", "--allow-empty", "-m", "root")
        (self.repo / "migrations").mkdir()
        (self.repo / "bot").mkdir()
        self.mig = self.repo / "migrations" / "V0.0.1__probe.sql"
        self.mig.write_text(VIOLATING, encoding="utf-8")
        self._git("add", "migrations/V0.0.1__probe.sql")

    def tearDown(self):
        self.tmp.cleanup()

    def _git(self, *args):
        subprocess.run(["git", "-C", str(self.repo), *args], check=True,
                       capture_output=True, text=True)

    def _validate(self, cwd):
        env = {k: v for k, v in os.environ.items()
               if not k.startswith(("TALEEMABAD_DATA_STANDARDS", "CLAUDE_DATA_STANDARDS"))}
        r = subprocess.run([sys.executable, str(VALIDATOR), "--mode", "staged"],
                           cwd=cwd, capture_output=True, text=True, env=env)
        try:
            body = json.loads(r.stdout)
        except json.JSONDecodeError:
            body = {}
        return r.returncode, body

    def test_subdirectory_reports_the_same_findings_as_root(self):
        code_root, body_root = self._validate(self.repo)
        code_sub, body_sub = self._validate(self.repo / "bot")
        self.assertEqual(code_root, 1)
        self.assertGreaterEqual(len(body_root.get("findings", [])), 3)
        self.assertEqual(code_sub, code_root)
        self.assertEqual(len(body_sub.get("findings", [])), len(body_root["findings"]))

    def test_staged_but_unreadable_file_is_a_validator_error_not_a_pass(self):
        # In the index, gone from disk: the validator cannot check it, so it must
        # say so (exit 2), never report "pass" (exit 0) on content it never saw.
        self.mig.unlink()
        code, body = self._validate(self.repo)
        self.assertEqual(code, 2, msg=f"got exit {code}, body={body}")
        self.assertNotEqual(body.get("result"), "pass")


if __name__ == "__main__":
    unittest.main()
