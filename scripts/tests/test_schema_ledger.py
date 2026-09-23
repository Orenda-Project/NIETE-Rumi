import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
import schema_ledger as m  # noqa: E402


class ParseVersion(unittest.TestCase):
    def test_reads_the_semver_out_of_a_migration_filename(self):
        self.assertEqual(m.parse_version("V1.2.3__leader_roster_audit.sql"), "1.2.3")

    def test_ignores_rollback_files_and_non_migrations(self):
        self.assertIsNone(m.parse_version("ROLLBACK_V1.4.0__lp612_render_degraded.sql"))
        self.assertIsNone(m.parse_version("README.md"))


class Diff(unittest.TestCase):
    def test_reports_files_missing_from_the_ledger_and_ledger_rows_without_a_file(self):
        files = ["V1.0.0__baseline.sql", "V1.2.3__a.sql", "V1.2.4__b.sql", "V1.10.0__c.sql"]
        applied = ["1.0.0", "1.2.4", "9.9.9"]
        d = m.diff_versions(files, applied)
        self.assertEqual(d["missing_from_ledger"], ["1.2.3", "1.10.0"])   # semver order, not string order
        self.assertEqual(d["unknown_in_ledger"], ["9.9.9"])


if __name__ == "__main__":
    unittest.main()
