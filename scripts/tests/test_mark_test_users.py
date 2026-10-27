import importlib.util, os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
import mark_test_users as m  # noqa: E402


class Selection(unittest.TestCase):
    def test_merges_predicate_and_allowlist_ids_without_duplicates(self):
        sel = m.build_selection(predicate_rows=[{"id": "a", "rule": "probable_test_school"},
                                                {"id": "b", "rule": "name_pattern"}],
                                allowlist_ids=["b", "c"])
        self.assertEqual(sorted(sel.keys()), ["a", "b", "c"])
        self.assertEqual(sel["b"], ["name_pattern", "allowlist"])
        self.assertEqual(sel["c"], ["allowlist"])

    def test_a_user_matching_two_predicate_rules_keeps_both(self):
        sel = m.build_selection(predicate_rows=[{"id": "a", "rule": "probable_test_school"},
                                                {"id": "a", "rule": "name_pattern"}], allowlist_ids=[])
        self.assertEqual(sel["a"], ["probable_test_school", "name_pattern"])

    def test_refuses_an_empty_selection(self):
        with self.assertRaises(ValueError):
            m.build_selection(predicate_rows=[], allowlist_ids=[])

    def test_counts_per_rule(self):
        sel = {"a": ["probable_test_school"], "b": ["name_pattern", "allowlist"]}
        self.assertEqual(m.rule_counts(sel), {"probable_test_school": 1, "name_pattern": 1, "allowlist": 1})


class Allowlist(unittest.TestCase):
    def test_parses_ids_one_per_line_ignoring_blanks_and_comments(self):
        text = "# staff\n a \n\nb\n# c\n"
        self.assertEqual(m.parse_allowlist(text), ["a", "b"])




class SignedOffList(unittest.TestCase):
    """--ids-file: the commit path runs from a signed-off id list, and refuses when the live predicate
    no longer selects exactly that list (bd data-team ask 1, 2026-10-27)."""

    def test_identical_sets_are_ok(self):
        ok, missing, extra = m.check_signed_off(predicate_ids=["a", "b"], signed_ids=["b", "a"])
        self.assertTrue(ok); self.assertEqual(missing, []); self.assertEqual(extra, [])

    def test_a_signed_row_the_predicate_no_longer_selects_refuses(self):
        ok, missing, extra = m.check_signed_off(predicate_ids=["a"], signed_ids=["a", "b"])
        self.assertFalse(ok); self.assertEqual(missing, ["b"]); self.assertEqual(extra, [])

    def test_a_new_row_the_predicate_now_selects_refuses(self):
        ok, missing, extra = m.check_signed_off(predicate_ids=["a", "c"], signed_ids=["a"])
        self.assertFalse(ok); self.assertEqual(missing, []); self.assertEqual(extra, ["c"])

    def test_an_empty_signed_list_refuses(self):
        with self.assertRaises(ValueError):
            m.check_signed_off(predicate_ids=["a"], signed_ids=[])


class Drift(unittest.TestCase):
    """drift_lines names the ids that moved since sign-off (ids only, never names), a bounded number of each."""

    def test_both_directions_are_named_and_bounded(self):
        lines = m.drift_lines(["a", "b", "c"], ["x"], limit=2)
        self.assertEqual(lines, ["signed but no longer selected (3): a, b, and 1 more",
                                 "selected but never signed (1): x"])

    def test_no_drift_no_lines(self):
        self.assertEqual(m.drift_lines([], []), [])


class ProdGate(unittest.TestCase):
    """A prod commit runs only from a signed-off list. The gate fires before any connection: the env file below does
    not exist, so even a broken gate could not reach a database."""

    @unittest.skipUnless(importlib.util.find_spec("psycopg2"), "psycopg2 not installed")
    def test_prod_commit_without_ids_file_is_refused(self):
        import subprocess, tempfile
        script = os.path.join(os.path.dirname(__file__), "..", "mark-test-users.py")
        with tempfile.TemporaryDirectory() as d:
            r = subprocess.run([sys.executable, script, "--target", "prod", "--commit",
                                "--confirm-ref", "ihzciabopbttygxxgrkm", "--env-file", os.path.join(d, "missing.env"),
                                "--out", d], capture_output=True, text=True,
                               env={**os.environ, "MARK_PROD_GO": "yes"})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--ids-file", r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
