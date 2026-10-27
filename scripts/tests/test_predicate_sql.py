import os, re, unittest

PRED = os.path.join(os.path.dirname(__file__), "..", "predicates", "test-users.sql")


class TestUsersPredicate(unittest.TestCase):
    """The reviewed predicate keeps its two guards (2026-10-27): the probable-test-school rule never selects a
    coach, and the NIETE H-9 rule exists and never selects a coach either. The guard is null-safe: `role <> 'coach'`
    would also drop every row whose role is NULL, so it must be written IS DISTINCT FROM."""

    def setUp(self):
        self.sql = open(PRED).read()

    def rule(self, name):
        parts = re.split(r"\nUNION ALL\n", self.sql)
        for p in parts:
            if f"'{name}'" in p:
                return p
        self.fail(f"rule {name} not in predicate")

    def test_probable_test_school_rule_never_selects_a_coach(self):
        r = self.rule("probable_test_school")
        self.assertIn("role IS DISTINCT FROM 'coach'", r)
        self.assertNotIn("role <> 'coach'", r)

    def test_niete_h9_rule_exists_and_never_selects_a_coach(self):
        r = self.rule("niete_h9_hq")
        self.assertIn("role IS DISTINCT FROM 'coach'", r)
        self.assertNotIn("role <> 'coach'", r)
        self.assertRegex(r, r"niete1\?")

    def test_rules_1_and_3_skip_deleted_rows(self):
        for name in ("probable_test_school", "niete_h9_hq"):
            self.assertIn("deleted_at IS NULL", self.rule(name), name)

    def test_rule_3_matches_the_h9_spellings_and_nothing_else(self):
        pats = re.findall(r"~\* '([^']+)'", self.rule("niete_h9_hq"))
        self.assertEqual(len(pats), 2)
        self.assertEqual(pats[0], pats[1])      # the school row and the typed name use one pattern
        rx = re.compile(pats[0], re.I)          # ~* is a case-insensitive match
        for name in ("NIETE, H-9", "NIETE1, H-9", "niete,h9", " Niete , H 9 "):
            self.assertTrue(rx.search(name), name)
        for name in ("NIETE Support", "NIETE, H-9 Islamabad", "IMS (I-V) H-9/4", "NIETE, H-8"):
            self.assertFalse(rx.search(name), name)


if __name__ == "__main__":
    unittest.main()
