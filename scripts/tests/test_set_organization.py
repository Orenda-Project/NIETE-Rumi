import importlib.util, os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
import set_organization as so  # noqa: E402

SIX = ["Urban-I", "Urban-II", "Nilore", "Sihala", "B.K", "Tarnol"]
SCHOOLS = {
    "s-urban": {"id": "s-urban", "name": "IMS (I-V) G-7/4", "region": "Urban-I", "is_probable_test": False},
    "s-test": {"id": "s-test", "name": "Testing School", "region": "B.K", "is_probable_test": True},
    "s-hq": {"id": "s-hq", "name": "NIETE, H-9", "region": "Urban-I", "is_probable_test": False},
    "s-durbeen": {"id": "s-durbeen", "name": "Durbeen", "region": "Durbeen", "is_probable_test": False},
    "s-nosector": {"id": "s-nosector", "name": "GHS Wana", "region": None, "is_probable_test": False},
}


def user(org=None, school=None, role="teacher", test=False, deleted=None, uid="u"):
    return {"id": uid, "organization": org, "school_id": school, "role": role, "is_test_user": test, "deleted_at": deleted}


class Classify(unittest.TestCase):
    """classify(user, schools) -> (new_value, reason) or None. The scope and rewrite rules of the doc
    'NIETE data fixes', D3 and D4 (2026-10-27): rewrite every NIETE spelling wherever it sits, fill blanks only at
    a six-sector teaching school, clear Durbeen."""

    def test_taleemabad_niete_is_rewritten_wherever_it_sits(self):
        self.assertEqual(so.classify(user("Taleemabad/niete", None), SCHOOLS), ("niete", "rewrite:Taleemabad/niete"))
        self.assertEqual(so.classify(user("Taleemabad/niete", "s-urban"), SCHOOLS), ("niete", "rewrite:Taleemabad/niete"))
        self.assertEqual(so.classify(user("Taleemabad/niete", "s-nosector"), SCHOOLS), ("niete", "rewrite:Taleemabad/niete"))

    def test_fde_and_niete_ict_are_rewritten(self):
        self.assertEqual(so.classify(user("fde", "s-urban"), SCHOOLS), ("niete", "rewrite:fde"))
        self.assertEqual(so.classify(user("fde", None), SCHOOLS), ("niete", "rewrite:fde"))
        self.assertEqual(so.classify(user("NIETE/ICT", None), SCHOOLS), ("niete", "rewrite:NIETE/ICT"))

    def test_niete_spellings_are_respelled_at_hq_and_test_school_rows_too(self):
        self.assertEqual(so.classify(user("Taleemabad/niete", "s-hq", role="coach"), SCHOOLS),
                         ("niete", "rewrite:Taleemabad/niete"))
        self.assertEqual(so.classify(user("fde", "s-test"), SCHOOLS), ("niete", "rewrite:fde"))

    def test_niete_is_left_alone(self):
        self.assertIsNone(so.classify(user("niete", "s-urban"), SCHOOLS))
        self.assertIsNone(so.classify(user("niete", None), SCHOOLS))

    def test_blank_is_filled_only_at_a_six_sector_school_that_is_not_test_or_hq(self):
        self.assertEqual(so.classify(user(None, "s-urban"), SCHOOLS), ("niete", "fill:six-sector school"))
        self.assertIsNone(so.classify(user(None, None), SCHOOLS))
        self.assertIsNone(so.classify(user(None, "s-test"), SCHOOLS))
        self.assertIsNone(so.classify(user(None, "s-hq"), SCHOOLS))
        self.assertIsNone(so.classify(user(None, "s-nosector"), SCHOOLS))

    def test_a_one_off_string_follows_the_school(self):
        self.assertEqual(so.classify(user("Principal", "s-urban"), SCHOOLS), ("niete", "rewrite:one-off"))
        self.assertIsNone(so.classify(user("SMC", None), SCHOOLS))
        self.assertIsNone(so.classify(user("SMC", "s-hq"), SCHOOLS))
        self.assertIsNone(so.classify(user("SMC", "s-test"), SCHOOLS))

    def test_durbeen_is_cleared_never_filled(self):
        self.assertEqual(so.classify(user("Taleemabad/niete", "s-durbeen"), SCHOOLS), (None, "durbeen:clear"))
        self.assertIsNone(so.classify(user(None, "s-durbeen"), SCHOOLS))

    def test_test_and_deleted_rows_are_never_touched(self):
        self.assertIsNone(so.classify(user("Taleemabad/niete", "s-urban", test=True), SCHOOLS))
        self.assertIsNone(so.classify(user("Taleemabad/niete", "s-urban", deleted="2026-10-01"), SCHOOLS))
        self.assertIsNone(so.classify(user(None, "s-urban", test=True), SCHOOLS))

    def test_coaches_and_principals_are_in_scope_like_teachers(self):
        self.assertEqual(so.classify(user("fde", "s-urban", role="coach"), SCHOOLS)[0], "niete")
        self.assertEqual(so.classify(user(None, "s-urban", role="principal"), SCHOOLS)[0], "niete")


class Plan(unittest.TestCase):
    def test_plan_lists_only_rows_that_change(self):
        users = {"a": user("fde", "s-urban", uid="a"), "b": user("niete", "s-urban", uid="b"),
                 "c": user(None, "s-urban", uid="c"), "d": user(None, None, uid="d")}
        self.assertEqual(so.plan(users, SCHOOLS), [("a", "fde", "niete", "rewrite:fde"),
                                                   ("c", None, "niete", "fill:six-sector school")])


class Batches(unittest.TestCase):
    def test_groups_by_old_and_new_value_in_chunks(self):
        changes = [("u1", "fde", "niete"), ("u2", "fde", "niete"), ("u3", None, "niete"), ("u4", "Taleemabad/niete", None)]
        groups = so.group_changes(changes, chunk=2)
        self.assertEqual(groups, [(("fde", "niete"), ["u1", "u2"]), ((None, "niete"), ["u3"]), (("Taleemabad/niete", None), ["u4"])])

    def test_chunking_splits_large_groups(self):
        changes = [(f"u{i}", "fde", "niete") for i in range(5)]
        self.assertEqual([len(ids) for _, ids in so.group_changes(changes, chunk=2)], [2, 2, 1])


class Guards(unittest.TestCase):
    """Every class must be zero before a write. Each one is shown firing on the row it exists to stop."""

    def test_each_guard_class_counts_its_own_rows(self):
        users = {"u1": user(None, None, uid="u1"), "u2": user(None, "s-durbeen", uid="u2"),
                 "u3": user(None, "s-hq", uid="u3"), "u4": user("Taleemabad/niete", "s-hq", uid="u4"),
                 "u5": user("Taleemabad/niete", "s-urban", test=True, uid="u5")}
        changes = [("u1", None, "niete", "fill"), ("u2", None, "niete", "fill"), ("u3", None, "niete", "fill"),
                   ("u4", "Taleemabad/niete", "niete", "rewrite"), ("u5", "Taleemabad/niete", "niete", "rewrite")]
        self.assertEqual(so.guard_counts(changes, users, SCHOOLS),
                         {"fill with no school": 1, "fill on a Durbeen row": 1,
                          "fill at a probable-test or NIETE-named school": 1, "row that is test or deleted": 1})

    def test_the_classifier_never_trips_a_guard(self):
        users = {f"u{i}": dict(u, id=f"u{i}") for i, u in enumerate(
            [user(o, s, test=t, deleted=d) for o in (None, "fde", "Taleemabad/niete", "NIETE/ICT", "niete", "SMC")
             for s in (None, *SCHOOLS) for t in (False, True) for d in (None, "2026-10-01")])}
        changes = so.plan(users, SCHOOLS)
        self.assertTrue(changes)
        self.assertEqual(set(so.guard_counts(changes, users, SCHOOLS).values()), {0})


class PlanMatch(unittest.TestCase):
    """--expect-csv binds a commit to the dry run that was reviewed: the live plan must equal it row for row."""
    CSV = "id,old,new,reason\na,fde,niete,rewrite:fde\nc,,niete,fill:six-sector school\n"

    def test_the_reviewed_csv_parses_to_id_old_new(self):
        self.assertEqual(so.parse_plan_csv(self.CSV), {("a", "fde", "niete"), ("c", "", "niete")})

    def test_identical_plans_match(self):
        live = [("a", "fde", "niete", "rewrite:fde"), ("c", None, "niete", "fill:six-sector school")]
        self.assertEqual(so.check_plan_matches(so.parse_plan_csv(self.CSV), live), (True, [], []))

    def test_any_drift_refuses_and_is_named(self):
        live = [("a", "fde", "niete", "rewrite:fde"), ("e", None, "niete", "fill:six-sector school")]
        ok, missing, extra = so.check_plan_matches(so.parse_plan_csv(self.CSV), live)
        self.assertFalse(ok)
        self.assertEqual((missing, extra), (["c"], ["e"]))

    def test_an_empty_reviewed_plan_refuses(self):
        with self.assertRaises(ValueError):
            so.check_plan_matches(set(), [("a", "fde", "niete", "rewrite:fde")])


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn
        self.rowcount = -1

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.conn.executed.append((sql, params))
        if sql.startswith("UPDATE"):
            if self.conn.raise_on_update:
                raise RuntimeError("could not serialize access due to concurrent update")
            self.rowcount = self.conn.rowcounts.pop(0) if self.conn.rowcounts else len(params[1])


class FakeConn:
    def __init__(self, rowcounts=None, raise_on_update=False):
        self.executed, self.commits, self.rollbacks = [], 0, 0
        self.rowcounts, self.raise_on_update = list(rowcounts or []), raise_on_update

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class Apply(unittest.TestCase):
    """apply_changes: timeouts first, one guarded UPDATE per group, a re-plan that must be empty, one commit;
    every failure rolls back and stops."""
    CHANGES = [("a", "fde", "niete", "rewrite:fde"), ("b", "fde", "niete", "rewrite:fde"),
               ("c", None, "niete", "fill:six-sector school")]

    def done(self):
        return {}, SCHOOLS                     # after the write nothing classifies as a change

    def test_success_commits_once_after_guarded_updates(self):
        conn = FakeConn()
        self.assertEqual(so.apply_changes(conn, self.CHANGES, self.done), 3)
        sqls = [s for s, _ in conn.executed]
        self.assertTrue(sqls[0].startswith("SET LOCAL lock_timeout"))
        self.assertTrue(sqls[1].startswith("SET LOCAL statement_timeout"))
        updates = [(s, p) for s, p in conn.executed if s.startswith("UPDATE")]
        self.assertEqual([p for _, p in updates], [("niete", ["a", "b"], "fde"), ("niete", ["c"], None)])
        self.assertTrue(all("IS NOT DISTINCT FROM" in s for s, _ in updates))
        self.assertEqual((conn.commits, conn.rollbacks), (1, 0))

    def test_a_rowcount_mismatch_rolls_back(self):
        conn = FakeConn(rowcounts=[2, 0])
        with self.assertRaises(SystemExit):
            so.apply_changes(conn, self.CHANGES, self.done)
        self.assertEqual((conn.commits, conn.rollbacks), (0, 1))

    def test_rows_still_planned_after_the_write_roll_back(self):
        conn = FakeConn()
        left = lambda: ({"x": user("fde", "s-urban", uid="x")}, SCHOOLS)
        with self.assertRaises(SystemExit):
            so.apply_changes(conn, self.CHANGES, left)
        self.assertEqual((conn.commits, conn.rollbacks), (0, 1))

    def test_a_database_error_rolls_back(self):
        conn = FakeConn(raise_on_update=True)
        with self.assertRaises(SystemExit):
            so.apply_changes(conn, self.CHANGES, self.done)
        self.assertEqual((conn.commits, conn.rollbacks), (0, 1))


class WritePath(unittest.TestCase):
    """The CLI reads and writes in one REPEATABLE READ snapshot, so a row that changes under it fails the write
    instead of being rewritten from a stale read; and a prod commit needs the reviewed dry run as --expect-csv. The
    env file below does not exist, so even a broken gate could not reach a database."""
    SCRIPT = os.path.join(os.path.dirname(__file__), "..", "set-organization.py")

    def test_the_cli_uses_one_repeatable_read_snapshot(self):
        self.assertIn("REPEATABLE READ", open(self.SCRIPT).read())

    @unittest.skipUnless(importlib.util.find_spec("psycopg2"), "psycopg2 not installed")
    def test_prod_commit_without_expect_csv_is_refused(self):
        import subprocess, tempfile
        with tempfile.TemporaryDirectory() as d:
            r = subprocess.run([sys.executable, self.SCRIPT, "--target", "prod", "--commit",
                                "--confirm-ref", "ihzciabopbttygxxgrkm", "--env-file", os.path.join(d, "missing.env"),
                                "--out", d], capture_output=True, text=True,
                               env={**os.environ, "SET_ORG_PROD_GO": "yes"})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--expect-csv", r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
