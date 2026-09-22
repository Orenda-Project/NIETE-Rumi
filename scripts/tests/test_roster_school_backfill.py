"""
Red-first tests for scripts/lib/roster_school_backfill.py — the decision logic of
scripts/backfill-school-id-from-roster.py.

Why a pure module: the runner owns I/O (one read query, one transaction); this module
owns every judgement call, so the judgement can be tested without a database, the
same split scripts/migrate-schools.py uses with school-migration.transform.js.

Run:  python3 -m unittest scripts/tests/test_roster_school_backfill.py -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

import roster_school_backfill as m  # noqa: E402


def row(**over):
    base = dict(
        user_id="u1", phone_e164="923001234567", role="teacher", current_school_id=None,
        roster_school_id="s1", school_ext_id="niete:216", leader_user_id="coach1",
        teacher_name="T One", school_name="IMS(I-V) G-7/1", emis="216", region="Urban-I",
        is_probable_test=False, is_active=True,
    )
    base.update(over)
    return base


class ClassifyUser(unittest.TestCase):
    def test_backfill_when_unlinked_and_roster_names_one_usable_school(self):
        d = m.classify_user([row()])
        self.assertEqual(d["decision"], "backfill")
        self.assertEqual(d["target_school_id"], "s1")
        self.assertEqual(d["leader_user_id"], "coach1")
        self.assertEqual(d["school_ext_id"], "niete:216")

    def test_two_coaches_same_school_is_still_one_school(self):
        d = m.classify_user([row(leader_user_id="coach1"), row(leader_user_id="coach2")])
        self.assertEqual(d["decision"], "backfill")
        self.assertEqual(d["target_school_id"], "s1")

    def test_ambiguous_when_two_usable_schools_disagree(self):
        d = m.classify_user([row(roster_school_id="s1"), row(roster_school_id="s2", school_ext_id="niete:233")])
        self.assertEqual(d["decision"], "ambiguous")
        self.assertIsNone(d["target_school_id"])
        self.assertEqual(sorted(d["schools"]), ["s1", "s2"])

    def test_probable_test_school_is_skipped_not_written(self):
        d = m.classify_user([row(is_probable_test=True)])
        self.assertEqual(d["decision"], "skipped_probable_test")
        self.assertIsNone(d["target_school_id"])

    def test_inactive_school_is_skipped(self):
        d = m.classify_user([row(is_active=False)])
        self.assertEqual(d["decision"], "skipped_inactive_school")

    def test_probable_test_row_does_not_block_a_usable_one(self):
        d = m.classify_user([row(roster_school_id="junk", is_probable_test=True), row()])
        self.assertEqual(d["decision"], "backfill")
        self.assertEqual(d["target_school_id"], "s1")

    def test_no_roster_school_when_roster_rows_carry_no_school(self):
        d = m.classify_user([row(roster_school_id=None, school_name=None, emis=None)])
        self.assertEqual(d["decision"], "no_roster_school")

    def test_already_linked_when_fk_agrees_with_roster(self):
        d = m.classify_user([row(current_school_id="s1")])
        self.assertEqual(d["decision"], "already_linked")

    def test_conflict_when_fk_points_elsewhere_is_report_only(self):
        d = m.classify_user([row(current_school_id="s9")])
        self.assertEqual(d["decision"], "conflict")
        self.assertIsNone(d["target_school_id"])
        self.assertEqual(d["current_school_id"], "s9")

    def test_linked_user_with_no_roster_school_is_left_alone(self):
        d = m.classify_user([row(current_school_id="s9", roster_school_id=None)])
        self.assertEqual(d["decision"], "already_linked")

    def test_coach_account_on_a_roster_is_skipped_not_linked(self):
        d = m.classify_user([row(role="coach")])
        self.assertEqual(d["decision"], "skipped_role_coach")
        self.assertIsNone(d["target_school_id"])

    def test_principal_is_linked_like_a_teacher(self):
        d = m.classify_user([row(role="principal")])
        self.assertEqual(d["decision"], "backfill")
        self.assertFalse(d["promote_to_teacher"])

    def test_unregistered_is_linked_and_flagged_for_optional_promotion(self):
        d = m.classify_user([row(role="unregistered")])
        self.assertEqual(d["decision"], "backfill")
        self.assertTrue(d["promote_to_teacher"])


class GroupAndSummarize(unittest.TestCase):
    def test_groups_rows_by_user_and_counts_decisions(self):
        rows = [row(user_id="a"), row(user_id="a", leader_user_id="coach2"),
                row(user_id="b", current_school_id="s9"), row(user_id="c", is_probable_test=True)]
        decisions = m.classify_all(rows)
        self.assertEqual({d["user_id"] for d in decisions}, {"a", "b", "c"})
        counts = m.summarize(decisions)
        self.assertEqual(counts["backfill"], 1)
        self.assertEqual(counts["conflict"], 1)
        self.assertEqual(counts["skipped_probable_test"], 1)


class AuditRow(unittest.TestCase):
    def test_audit_row_is_an_add_by_the_holding_coach_marked_as_backfill(self):
        d = m.classify_user([row()])
        a = m.audit_row(d, run_id="run-1")
        self.assertEqual(a["action"], "add")
        self.assertEqual(a["actor_user_id"], "coach1")
        self.assertEqual(a["affected_leader_user_id"], "coach1")
        self.assertEqual(a["teacher_phone_e164"], "923001234567")
        self.assertEqual(a["teacher_ext_id"], "923001234567")
        self.assertIsNone(a["from_school_ext_id"])
        self.assertEqual(a["to_school_ext_id"], "niete:216")
        self.assertEqual(a["detail"]["backfill"], "roster_school_id")
        self.assertEqual(a["detail"]["run_id"], "run-1")
        self.assertEqual(a["detail"]["target_school_id"], "s1")

    def test_audit_row_refuses_a_non_backfill_decision(self):
        d = m.classify_user([row(current_school_id="s9")])
        with self.assertRaises(ValueError):
            m.audit_row(d, run_id="run-1")


if __name__ == "__main__":
    unittest.main()
