import os, sys, unittest
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


if __name__ == "__main__":
    unittest.main()
