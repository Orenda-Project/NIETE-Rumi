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
