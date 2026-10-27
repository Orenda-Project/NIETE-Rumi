import os, sys, unittest
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


def user(org=None, school=None, role="teacher", test=False, deleted=None):
    return {"id": "u", "organization": org, "school_id": school, "role": role, "is_test_user": test, "deleted_at": deleted}


class Classify(unittest.TestCase):
    """classify(user, schools) -> (new_value, reason) or None. The scope and rewrite rules of the doc
    'NIETE data fixes', D3 and D4 (2026-10-27)."""

    def test_taleemabad_niete_is_rewritten_wherever_it_sits(self):
        self.assertEqual(so.classify(user("Taleemabad/niete", None), SCHOOLS), ("niete", "rewrite:Taleemabad/niete"))
        self.assertEqual(so.classify(user("Taleemabad/niete", "s-urban"), SCHOOLS), ("niete", "rewrite:Taleemabad/niete"))

    def test_fde_and_niete_ict_are_rewritten(self):
        self.assertEqual(so.classify(user("fde", "s-urban"), SCHOOLS)[0], "niete")
        self.assertEqual(so.classify(user("NIETE/ICT", None), SCHOOLS)[0], "niete")

    def test_niete_is_left_alone(self):
        self.assertIsNone(so.classify(user("niete", "s-urban"), SCHOOLS))

    def test_blank_is_filled_only_at_a_six_sector_school_that_is_not_test_or_hq(self):
        self.assertEqual(so.classify(user(None, "s-urban"), SCHOOLS), ("niete", "fill:six-sector school"))
        self.assertIsNone(so.classify(user(None, None), SCHOOLS))
        self.assertIsNone(so.classify(user(None, "s-test"), SCHOOLS))
        self.assertIsNone(so.classify(user(None, "s-hq"), SCHOOLS))
        self.assertIsNone(so.classify(user(None, "s-nosector"), SCHOOLS))

    def test_a_one_off_string_follows_the_school(self):
        self.assertEqual(so.classify(user("Principal", "s-urban"), SCHOOLS), ("niete", "rewrite:one-off"))
        self.assertIsNone(so.classify(user("SMC", None), SCHOOLS))

    def test_durbeen_is_cleared_never_filled(self):
        self.assertEqual(so.classify(user("Taleemabad/niete", "s-durbeen"), SCHOOLS), (None, "durbeen:clear"))
        self.assertIsNone(so.classify(user(None, "s-durbeen"), SCHOOLS))

    def test_test_deleted_and_hq_rows_are_never_touched(self):
        self.assertIsNone(so.classify(user("Taleemabad/niete", "s-urban", test=True), SCHOOLS))
        self.assertIsNone(so.classify(user("Taleemabad/niete", "s-test"), SCHOOLS))   # a probable-test school: the sweep's job
        self.assertIsNone(so.classify(user("Taleemabad/niete", "s-urban", deleted="2026-10-01"), SCHOOLS))
        self.assertIsNone(so.classify(user("Taleemabad/niete", "s-hq"), SCHOOLS))

    def test_coaches_and_principals_are_in_scope_like_teachers(self):
        self.assertEqual(so.classify(user("fde", "s-urban", role="coach"), SCHOOLS)[0], "niete")
        self.assertEqual(so.classify(user(None, "s-urban", role="principal"), SCHOOLS)[0], "niete")


class Batches(unittest.TestCase):
    def test_groups_by_old_and_new_value_in_chunks(self):
        changes = [("u1", "fde", "niete"), ("u2", "fde", "niete"), ("u3", None, "niete"), ("u4", "Taleemabad/niete", None)]
        groups = so.group_changes(changes, chunk=2)
        self.assertEqual(groups, [(("fde", "niete"), ["u1", "u2"]), ((None, "niete"), ["u3"]), (("Taleemabad/niete", None), ["u4"])])

    def test_chunking_splits_large_groups(self):
        changes = [(f"u{i}", "fde", "niete") for i in range(5)]
        self.assertEqual([len(ids) for _, ids in so.group_changes(changes, chunk=2)], [2, 2, 1])


class Guards(unittest.TestCase):
    def test_guard_counts_name_the_classes_that_must_be_zero(self):
        changes = [("u1", None, "niete", "fill:six-sector school")]
        users = {"u1": user(None, None)}            # a fill with no school: the classifier must never produce it
        g = so.guard_counts(changes, users, SCHOOLS)
        self.assertEqual(g["fill with no school"], 1)
        self.assertEqual(g["row at a probable-test or NIETE-named school"], 0)


class WritePath(unittest.TestCase):
    """The commit transaction gives up rather than queue behind the app: lock and statement timeouts are set with
    SET LOCAL, so they end with the transaction, before the first UPDATE runs."""

    def test_timeouts_are_set_before_the_first_update(self):
        src = open(os.path.join(os.path.dirname(__file__), "..", "set-organization.py")).read()
        first_update = src.find("UPDATE users SET organization")
        self.assertGreater(first_update, -1)
        for stmt in ("SET LOCAL lock_timeout", "SET LOCAL statement_timeout"):
            at = src.find(stmt)
            self.assertGreater(at, -1, f"{stmt} missing")
            self.assertLess(at, first_update, f"{stmt} must come before the first UPDATE")
