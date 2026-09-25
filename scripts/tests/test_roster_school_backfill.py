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


class SkipRoles(unittest.TestCase):
    def test_a_skipped_role_is_reported_not_linked(self):
        d = m.classify_user([row(role="principal")], skip_roles={"principal"})
        self.assertEqual(d["decision"], "skipped_role_principal")
        self.assertIsNone(d["target_school_id"])

    def test_skip_roles_leaves_other_roles_untouched(self):
        d = m.classify_user([row(role="teacher")], skip_roles={"principal"})
        self.assertEqual(d["decision"], "backfill")

    def test_skip_roles_threads_through_classify_all(self):
        ds = m.classify_all([row(user_id="a", role="principal"), row(user_id="b")], skip_roles={"principal"})
        self.assertEqual(sorted(d["decision"] for d in ds), ["backfill", "skipped_role_principal"])

    def test_an_already_linked_principal_is_still_already_linked(self):
        d = m.classify_user([row(role="principal", current_school_id="s1")], skip_roles={"principal"})
        self.assertEqual(d["decision"], "already_linked")


class RespectCoachRemovals(unittest.TestCase):
    """leader_teachers is not cleaned when a coach removes a teacher, so the stale roster still
    lists 824 teachers coaches removed on prod. A removal is a decision; the backfill must not undo it."""

    def test_latest_membership_action_remove_is_skipped(self):
        d = m.classify_user([row(last_membership_action="remove")])
        self.assertEqual(d["decision"], "skipped_removed_by_coach")
        self.assertIsNone(d["target_school_id"])

    def test_a_school_id_that_was_cleared_before_is_skipped(self):
        d = m.classify_user([row(school_id_ever_cleared=True)])
        self.assertEqual(d["decision"], "skipped_unlinked_before")

    def test_re_added_after_a_removal_is_linked(self):
        d = m.classify_user([row(last_membership_action="add")])
        self.assertEqual(d["decision"], "backfill")

    def test_removal_check_runs_before_role_skips(self):
        d = m.classify_user([row(role="principal", last_membership_action="remove")], skip_roles={"principal"})
        self.assertEqual(d["decision"], "skipped_removed_by_coach")

    def test_an_already_linked_user_is_unaffected_by_history(self):
        d = m.classify_user([row(current_school_id="s1", last_membership_action="remove")])
        self.assertEqual(d["decision"], "already_linked")


class UndoRemovedRelinks(unittest.TestCase):
    def u(self, **over):
        base = dict(user_id="u1", phone_e164="923001234567", teacher_name="T", actor_user_id="coach1",
                    school_ext_id="niete:216", target_school_id="s1", current_school_id="s1",
                    prior_action="remove", later_action=None)
        base.update(over)
        return base

    def test_selects_a_relink_of_a_removed_teacher_still_on_the_target(self):
        self.assertEqual([x["user_id"] for x in m.select_undo([self.u()])], ["u1"])

    def test_skips_when_the_teacher_was_not_removed_before_the_run(self):
        self.assertEqual(m.select_undo([self.u(prior_action="add"), self.u(user_id="u2", prior_action=None)]), [])

    def test_skips_when_the_school_changed_since_the_run(self):
        self.assertEqual(m.select_undo([self.u(current_school_id="s9"), self.u(user_id="u2", current_school_id=None)]), [])

    def test_skips_when_a_coach_acted_on_the_teacher_after_the_run(self):
        self.assertEqual(m.select_undo([self.u(later_action="add")]), [])

    def test_undo_audit_row_is_a_remove_that_names_the_run(self):
        a = m.undo_audit_row(self.u(), run_id="run-1")
        self.assertEqual(a["action"], "remove")
        self.assertEqual(a["actor_user_id"], "coach1")
        self.assertEqual(a["from_school_ext_id"], "niete:216")
        self.assertIsNone(a["to_school_ext_id"])
        self.assertEqual(a["detail"]["rollback_of"], "run-1")
        self.assertEqual(a["detail"]["backfill"], "undo_removed_relink")


if __name__ == "__main__":
    unittest.main()
