"""Red-first tests for scripts/lib/merge_duplicates.py (bd-4jlu31.8.1): merging an RM-confirmed teacher's duplicate
accounts into one, the way the app's own number move does (teacher-edit-commit.service.js moveNumber), with the
operator's decisions of 11 Nov: move everything (D7), the reason duplicate_merge (D6), a training clash is refused
and left for later (D8)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
import merge_duplicates as md  # noqa: E402

NOW = "2026-11-12T10:00:00+00:00"


def u(uid, phone, **kw):
    row = {"id": uid, "phone_number": phone, "name": None, "role": "teacher", "school_id": None, "organization": None,
           "is_test_user": False, "deleted_at": None, "deleted_reason": None, "registration_completed": False,
           "registration_state": "unregistered", "registration_completed_at": None, "registered_at": None,
           "teacher_level": None, "teacher_level_updated_at": None, "preferred_language": None,
           "language_locked": False, "portal_password_hash": None, "portal_activated": False,
           "portal_last_login": None, "conversation_state": None, "conversation_state_expires_at": None,
           "session_id": None, "last_message_at": None, "first_message_at": None, "grades_taught": None,
           "subjects_taught": None, "subject": None}
    row.update(kw)
    return row


def ix(name, *cols, flag=None, nulls_distinct=True):
    """A unique index as the runner reads it from the catalog: the key columns besides the owner, the alias of its
    partial-index flag, and whether NULLs are distinct (the Postgres default)."""
    return {"name": name, "cols": cols, "in": flag, "nulls_distinct": nulls_distinct}


class ChooseSurvivor(unittest.TestCase):
    """The survivor keeps the most irreplaceable history (certificates, attempts, training progress, coaching), so
    the fewest of those rows move; a tie goes to the account on the number in use."""

    def test_most_identity_rows_wins(self):
        accts = [{"id": "a", "identity_rows": 0}, {"id": "b", "identity_rows": 184}]
        self.assertEqual(md.choose_survivor(accts, in_use_id="a"), "b")

    def test_a_tie_goes_to_the_number_in_use(self):
        accts = [{"id": "a", "identity_rows": 0}, {"id": "b", "identity_rows": 0}]
        self.assertEqual(md.choose_survivor(accts, in_use_id="b"), "b")
        self.assertEqual(md.choose_survivor(accts, in_use_id="a"), "a")


class SurvivorPatch(unittest.TestCase):
    """What the survivor takes: the number in use with what is bound to that number, and any fact it lacks. It never
    overwrites a value it already has."""

    def test_takes_the_number_in_use_from_the_account_that_holds_it(self):
        s, r = u("s", "923001111111"), u("r", "923002222222")
        self.assertEqual(md.survivor_patch(s, [r], in_use_id="r")["phone_number"], "923002222222")

    def test_keeps_its_own_number_when_it_holds_the_number_in_use(self):
        s, r = u("s", "923001111111"), u("r", "923002222222")
        self.assertNotIn("phone_number", md.survivor_patch(s, [r], in_use_id="s"))

    def test_the_portal_login_follows_the_number(self):
        s = u("s", "923001111111", portal_password_hash="hash-s", portal_activated=True)
        r = u("r", "923002222222", portal_password_hash="hash-r", portal_activated=True,
              portal_last_login="2026-11-01T08:00:00+00:00")
        p = md.survivor_patch(s, [r], in_use_id="r")
        self.assertEqual(p["portal_password_hash"], "hash-r")
        self.assertIs(p["portal_activated"], True)
        self.assertEqual(p["portal_last_login"], "2026-11-01T08:00:00+00:00")

    def test_no_portal_login_on_the_number_leaves_the_survivors_own(self):
        s = u("s", "923001111111", portal_password_hash="hash-s", portal_activated=True)
        r = u("r", "923002222222")
        p = md.survivor_patch(s, [r], in_use_id="r")
        self.assertNotIn("portal_password_hash", p)
        self.assertNotIn("portal_activated", p)

    def test_the_whatsapp_session_follows_the_number(self):
        s = u("s", "923001111111", preferred_language="en")
        r = u("r", "923002222222", preferred_language="ur", conversation_state={"step": "lp"}, session_id="x1")
        p = md.survivor_patch(s, [r], in_use_id="r")
        self.assertEqual(p["preferred_language"], "ur")
        self.assertEqual(p["conversation_state"], {"step": "lp"})
        self.assertEqual(p["session_id"], "x1")

    def test_an_empty_session_on_the_number_clears_the_survivors_stale_one(self):
        # The session is the number's, as it is: planned whenever the number moves, so a dry run and the commit a
        # day later plan the same columns however the chat moved in between.
        s = u("s", "923001111111", conversation_state={"step": "old"}, session_id="old",
              conversation_state_expires_at="2026-09-01T00:00:00+00:00")
        p = md.survivor_patch(s, [u("r", "923002222222")], in_use_id="r")
        for c in ("conversation_state", "conversation_state_expires_at", "session_id"):
            self.assertIn(c, p)
            self.assertIsNone(p[c])

    def test_no_session_moves_when_the_survivor_holds_the_number(self):
        s = u("s", "923001111111")
        p = md.survivor_patch(s, [u("r", "923002222222", conversation_state={"step": "lp"})], in_use_id="s")
        self.assertNotIn("conversation_state", p)
        self.assertNotIn("session_id", p)

    def test_fills_what_it_lacks_and_never_overwrites(self):
        s = u("s", "923001111111", name="Kept Name", school_id=None, teacher_level=None, organization="niete")
        r = u("r", "923002222222", name="Other Name", school_id="school-1", teacher_level='["primary"]',
              teacher_level_updated_at="2026-10-01T00:00:00+00:00", organization="taleemabad")
        p = md.survivor_patch(s, [r], in_use_id="s")
        self.assertNotIn("name", p)
        self.assertNotIn("organization", p)
        self.assertEqual(p["school_id"], "school-1")
        self.assertEqual(p["teacher_level"], '["primary"]')
        self.assertEqual(p["teacher_level_updated_at"], "2026-10-01T00:00:00+00:00")

    def test_registration_is_the_union(self):
        s = u("s", "923001111111")
        r = u("r", "923002222222", registration_completed=True, registration_state="completed",
              registration_completed_at="2026-09-02T00:00:00+00:00", registered_at="2026-09-02T00:00:00+00:00")
        p = md.survivor_patch(s, [r], in_use_id="s")
        self.assertIs(p["registration_completed"], True)
        self.assertEqual(p["registration_state"], "completed")
        self.assertEqual(p["registration_completed_at"], "2026-09-02T00:00:00+00:00")

    def test_a_registered_survivor_stays_as_it_is(self):
        s = u("s", "923001111111", registration_completed=True, registration_state="completed")
        r = u("r", "923002222222", registration_completed=True, registration_state="completed",
              registration_completed_at="2026-09-02T00:00:00+00:00")
        p = md.survivor_patch(s, [r], in_use_id="s")
        self.assertNotIn("registration_completed", p)
        self.assertNotIn("registration_completed_at", p)

    def test_a_form_role_replaces_unregistered_but_never_a_form_role(self):
        self.assertEqual(md.survivor_patch(u("s", "1", role="unregistered"), [u("r", "2", role="teacher")],
                                           in_use_id="s")["role"], "teacher")
        self.assertNotIn("role", md.survivor_patch(u("s", "1", role="teacher"), [u("r", "2", role="principal")],
                                                   in_use_id="s"))

    def test_message_times_span_both_accounts(self):
        s = u("s", "1", first_message_at="2026-09-10T00:00:00+00:00", last_message_at="2026-10-01T00:00:00+00:00")
        r = u("r", "2", first_message_at="2026-08-01T00:00:00+00:00", last_message_at="2026-11-10T00:00:00+00:00")
        p = md.survivor_patch(s, [r], in_use_id="s")
        self.assertEqual(p["first_message_at"], "2026-08-01T00:00:00+00:00")
        self.assertEqual(p["last_message_at"], "2026-11-10T00:00:00+00:00")


class RetirePatch(unittest.TestCase):
    def test_soft_delete_with_the_reason_and_the_number_freed(self):
        self.assertEqual(md.retire_patch("r", NOW), {"deleted_at": NOW, "deleted_reason": "duplicate_merge",
                                                     "deleted_by": "rm_duplicate_review",
                                                     "phone_number": "merged:r"})


class PlanMoves(unittest.TestCase):
    """Everything the retired account owns moves to the survivor (D7), table by table, by row id. Where a unique key
    holds one row per account (read from the database's own unique indexes), the survivor's row wins and the retired
    one stays behind, listed."""

    def test_a_plain_table_moves_every_row(self):
        owned = {("lesson_plans", "user_id"): [{"id": 1, "owner": "r"}, {"id": 2, "owner": "r"},
                                               {"id": 3, "owner": "s"}]}
        moves = md.plan_moves(owned, "s", ["r"], keys={})
        self.assertEqual(sorted((m[2], m[4]) for m in moves), [(1, "move"), (2, "move")])

    def test_a_keyed_row_the_survivor_already_has_stays_behind(self):
        owned = {("teacher_training_progress", "user_id"): [{"id": 1, "owner": "r", "module_id": "m1"},
                                                            {"id": 2, "owner": "r", "module_id": "m2"},
                                                            {"id": 3, "owner": "s", "module_id": "m1"}]}
        keys = {("teacher_training_progress", "user_id"): [ix("ttp", "module_id")]}
        got = {(m[2], m[4]) for m in md.plan_moves(owned, "s", ["r"], keys)}
        self.assertEqual(got, {(1, "skip"), (2, "move")})

    def test_a_row_outside_a_partial_index_never_collides(self):
        owned = {("class_teachers", "teacher_user_id"): [
            {"id": 1, "owner": "r", "class_id": "c1", "act": False},
            {"id": 2, "owner": "r", "class_id": "c2", "act": True},
            {"id": 3, "owner": "s", "class_id": "c1", "act": True},
            {"id": 4, "owner": "s", "class_id": "c2", "act": True}]}
        keys = {("class_teachers", "teacher_user_id"): [ix("ct", "class_id", flag="act")]}
        got = {(m[2], m[4]) for m in md.plan_moves(owned, "s", ["r"], keys)}
        self.assertEqual(got, {(1, "move"), (2, "skip")})

    def test_two_retired_accounts_with_the_same_key_move_one(self):
        owned = {("user_feature_first_use", "user_id"): [{"id": 1, "owner": "r1", "feature": "quiz"},
                                                         {"id": 2, "owner": "r2", "feature": "quiz"}]}
        keys = {("user_feature_first_use", "user_id"): [ix("uffu", "feature")]}
        got = {(m[2], m[4]) for m in md.plan_moves(owned, "s", ["r1", "r2"], keys)}
        self.assertEqual(got, {(1, "move"), (2, "skip")})

    def test_a_null_in_the_key_never_collides_unless_the_index_says_so(self):
        owned = {("teacher_facts", "user_id"): [{"id": 1, "owner": "r", "fact": None},
                                                {"id": 2, "owner": "s", "fact": None}]}
        distinct = {("teacher_facts", "user_id"): [ix("tf", "fact")]}
        self.assertEqual({(m[2], m[4]) for m in md.plan_moves(owned, "s", ["r"], distinct)}, {(1, "move")})
        not_distinct = {("teacher_facts", "user_id"): [ix("tf", "fact", nulls_distinct=False)]}
        self.assertEqual({(m[2], m[4]) for m in md.plan_moves(owned, "s", ["r"], not_distinct)}, {(1, "skip")})

    def test_a_row_that_collides_on_any_of_two_keys_stays(self):
        owned = {("training_assessment_attempts", "user_id"): [
            {"id": 1, "owner": "r", "module": "m1", "quiz": None, "in_m": True, "in_q": False},
            {"id": 2, "owner": "r", "module": None, "quiz": "q1", "in_m": False, "in_q": True},
            {"id": 3, "owner": "s", "module": "m9", "quiz": "q1", "in_m": True, "in_q": True}]}
        keys = {("training_assessment_attempts", "user_id"): [ix("per_module", "module", flag="in_m"),
                                                              ix("per_quiz", "quiz", flag="in_q")]}
        got = {(m[2], m[4]) for m in md.plan_moves(owned, "s", ["r"], keys)}
        self.assertEqual(got, {(1, "move"), (2, "skip")})

    def test_a_key_of_the_owner_alone_holds_one_row(self):
        owned = {("coach_directory", "leader_user_id"): [{"id": 1, "owner": "r"}, {"id": 2, "owner": "s"}]}
        keys = {("coach_directory", "leader_user_id"): [ix("cd")]}
        self.assertEqual({(m[2], m[4]) for m in md.plan_moves(owned, "s", ["r"], keys)}, {(1, "skip")})

    def test_a_sealed_observation_keeps_its_observer(self):
        # observation_field_forms_keep_seal refuses any change to a sealed form's observer_user_id.
        owned = {("observation_field_forms", "observer_user_id"): [{"id": 1, "owner": "r", "frozen": True},
                                                                   {"id": 2, "owner": "r", "frozen": False}]}
        got = {(m[2], m[4]) for m in md.plan_moves(owned, "s", ["r"], keys={})}
        self.assertEqual(got, {(1, "skip"), (2, "move")})

    def test_audit_history_is_never_moved(self):
        for table, col in (("leader_roster_audit", "actor_user_id"), ("grade_audit_log", "user_id"),
                           ("coachip_audit_log", "actor_user_id")):
            owned = {(table, col): [{"id": 1, "owner": "r"}]}
            self.assertEqual(md.plan_moves(owned, "s", ["r"], keys={}), [])


class PlanVisits(unittest.TestCase):
    """Booked visits key on the phone string, so they follow the number (as in moveNumber). One upcoming visit per
    coach, school and number (uq_obs_sched_active): a move that would double-book is a clash."""

    def v(self, vid, phone, status="upcoming", leader="L", school="S"):
        return {"id": vid, "teacher_ext_id": phone, "status": status, "leader_user_id": leader,
                "school_ext_id": school}

    def test_every_visit_on_a_number_that_moves_follows_it(self):
        visits = [self.v("v1", "old", status="done"), self.v("v2", "old", school="S2"), self.v("v3", "other")]
        planned, clashes = md.plan_visits(visits, [("old", "new")])
        self.assertEqual(sorted(planned), [("v1", "old", "new"), ("v2", "old", "new")])
        self.assertEqual(clashes, [])

    def test_an_upcoming_visit_already_booked_on_the_new_number_is_a_clash(self):
        visits = [self.v("v1", "old"), self.v("v2", "new")]
        planned, clashes = md.plan_visits(visits, [("old", "new")])
        self.assertEqual((planned, clashes), ([], ["v1"]))

    def test_two_old_numbers_booked_with_the_same_coach_and_school_clash(self):
        visits = [self.v("v1", "old1"), self.v("v2", "old2")]
        planned, clashes = md.plan_visits(visits, [("old1", "new"), ("old2", "new")])
        self.assertEqual((planned, clashes), ([("v1", "old1", "new")], ["v2"]))

    def test_a_visit_that_is_not_upcoming_or_has_no_coach_never_clashes(self):
        visits = [self.v("v1", "old", status="completed"), self.v("v2", "old", leader=None),
                  self.v("v3", "new")]
        planned, clashes = md.plan_visits(visits, [("old", "new")])
        self.assertEqual((sorted(planned), clashes), ([("v1", "old", "new"), ("v2", "old", "new")], []))


class Guards(unittest.TestCase):
    def setUp(self):
        self.rows = {"s": u("s", "923001111111"), "r": u("r", "923002222222")}

    def test_a_clean_pair_passes(self):
        self.assertEqual(md.guards(self.rows, "s", ["r"], "r", reviewed_survivor="s", moves=[]), [])

    def test_a_deleted_test_or_retired_number_account_is_refused(self):
        for patch in ({"deleted_at": NOW}, {"is_test_user": True}, {"phone_number": "merged:x"}):
            rows = dict(self.rows, r=dict(self.rows["r"], **patch))
            self.assertTrue(md.guards(rows, "s", ["r"], "r", reviewed_survivor="s", moves=[]))

    def test_a_coach_account_is_refused(self):
        rows = dict(self.rows, r=dict(self.rows["r"], role="coach"))
        self.assertTrue(md.guards(rows, "s", ["r"], "r", reviewed_survivor="s", moves=[]))

    def test_the_number_in_use_must_be_on_one_of_the_pair(self):
        self.assertTrue(md.guards(self.rows, "s", ["r"], "x", reviewed_survivor="s", moves=[]))

    def test_the_survivor_must_be_the_reviewed_one(self):
        self.assertTrue(md.guards(self.rows, "s", ["r"], "r", reviewed_survivor="r", moves=[]))

    def test_a_training_clash_is_refused_and_left_for_later(self):
        moves = [("teacher_training_progress", "user_id", 7, "r", "skip")]
        self.assertTrue(md.guards(self.rows, "s", ["r"], "r", reviewed_survivor="s", moves=moves))

    def test_a_clash_outside_the_identity_tables_is_allowed(self):
        moves = [("teacher_nudges", "user_id", 7, "r", "skip")]
        self.assertEqual(md.guards(self.rows, "s", ["r"], "r", reviewed_survivor="s", moves=moves), [])

    def test_a_visit_that_would_double_book_is_refused(self):
        self.assertTrue(md.guards(self.rows, "s", ["r"], "r", reviewed_survivor="s", moves=[],
                                  visit_clashes=["v1"]))


class SweepGuards(unittest.TestCase):
    """A sweep moves what reached a retired account after its merge (a message in flight at the commit). It only
    touches pairs this tool merged."""

    def setUp(self):
        self.rows = {"s": u("s", "923002222222"),
                     "r": u("r", "merged:r", deleted_at=NOW, deleted_reason="duplicate_merge")}

    def test_a_pair_this_tool_merged_passes(self):
        self.assertEqual(md.sweep_guards(self.rows, "s", ["r"], moves=[]), [])

    def test_an_account_not_retired_by_this_tool_is_refused(self):
        for patch in ({"deleted_at": None}, {"deleted_reason": "phone_change_merge"}, {"phone_number": "92300"}):
            rows = dict(self.rows, r=dict(self.rows["r"], **patch))
            self.assertTrue(md.sweep_guards(rows, "s", ["r"], moves=[]))

    def test_a_deleted_survivor_is_refused(self):
        rows = dict(self.rows, s=dict(self.rows["s"], deleted_at=NOW))
        self.assertTrue(md.sweep_guards(rows, "s", ["r"], moves=[]))

    def test_a_training_clash_is_refused(self):
        moves = [("training_certificates", "user_id", 7, "r", "skip")]
        self.assertTrue(md.sweep_guards(self.rows, "s", ["r"], moves=moves))


class AuditRows(unittest.TestCase):
    """One edit_phone row per retired account, in the shape of the app's buildEditAuditRow as the WhatsApp number
    change writes it (her own change: actor = the teacher, no leader affected). The governed analytics
    (ict_account_merges) read detail.retired_user_id and detail.to_phone to credit anything left behind."""

    def test_one_row_per_retired_account_in_the_apps_shape(self):
        s = u("s", "923002222222", name="Teacher")
        rows = md.audit_rows(s, survivor_old_phone="923001111111",
                             retired=[u("r1", "923002222222"), u("r2", "923003333333")],
                             moved={"r1": {"lesson_plans": 3}, "r2": {}}, skipped={"r1": {}, "r2": {}},
                             meta={"review": "rm-final-2026-11-10", "sheet_row": "t1 #10"})
        self.assertEqual(len(rows), 2)
        a = rows[0]
        self.assertEqual(a["action"], "edit_phone")
        self.assertEqual(a["actor_user_id"], "s")
        self.assertIsNone(a["affected_leader_user_id"])
        self.assertEqual(a["teacher_ext_id"], "s")
        self.assertEqual(a["teacher_phone_e164"], "923002222222")
        self.assertEqual(a["detail"]["via"], "rm_duplicate_review")
        self.assertEqual(a["detail"]["case"], "duplicate_merge")
        self.assertEqual(a["detail"]["retired_user_id"], "r1")
        self.assertEqual(a["detail"]["to_phone"], "923002222222")
        self.assertEqual(a["detail"]["from_phone"], "923001111111")
        self.assertEqual(a["detail"]["reparented"], {"lesson_plans": 3})
        self.assertEqual(rows[1]["detail"]["retired_user_id"], "r2")


class PhoneMoves(unittest.TestCase):
    """Booked visits key on the phone string (observation_schedules.teacher_ext_id), so they follow the number, as
    in the app."""

    def test_visits_on_the_survivors_old_number_and_a_freed_number_follow_her(self):
        self.assertEqual(md.phone_moves("923001111111", "923002222222", ["923002222222", "923003333333"]),
                         [("923001111111", "923002222222"), ("923003333333", "923002222222")])

    def test_nothing_moves_when_no_number_changes(self):
        self.assertEqual(md.phone_moves("923001111111", "923001111111", ["923001111111"]), [])


class PlanRows(unittest.TestCase):
    def test_the_plan_names_columns_and_ids_never_values(self):
        patch = {"phone_number": "923002222222", "portal_password_hash": "secret-hash"}
        rows = md.plan_rows("t1 #10", "s", patch, ["r"], [("lesson_plans", "user_id", "lp1", "r", "move")],
                            [("v1", "survivor's old number")])
        flat = " ".join(" ".join(r) for r in rows)
        self.assertNotIn("923002222222", flat)
        self.assertNotIn("secret-hash", flat)
        self.assertIn(("t1 #10", "survivor", "users", "phone_number", "s", "", ""), rows)
        self.assertIn(("t1 #10", "visits", "observation_schedules", "teacher_ext_id", "v1",
                       "survivor's old number", "s"), rows)
        self.assertIn(("t1 #10", "audit", "leader_roster_audit", "", "r", "s", ""), rows)


class PlanBinding(unittest.TestCase):
    """A commit is bound to the reviewed dry run's decisions (who retires, which columns the survivor takes, the
    audit rows). What the accounts own is activity: a teacher who keeps chatting makes rows between review and
    commit, and every one of them moves (D7), so that is counted, never refused."""

    DECIDED = {("p", "retire", "users", "", "r", "", ""), ("p", "survivor", "users", "school_id", "s", "", ""),
               ("p", "audit", "leader_roster_audit", "", "r", "s", "")}

    def test_equal_plans_match(self):
        rows = self.DECIDED | {("p", "move", "lesson_plans", "user_id", "1", "r", "s")}
        self.assertEqual(md.check_plan_matches(rows, set(rows)), (True, [], [], {}))

    def test_a_changed_decision_refuses(self):
        live = (self.DECIDED - {("p", "survivor", "users", "school_id", "s", "", "")}) | {
            ("p", "survivor", "users", "role", "s", "", "")}
        ok, missing, extra, _ = md.check_plan_matches(self.DECIDED, live)
        self.assertFalse(ok)
        self.assertEqual((len(missing), len(extra)), (1, 1))

    def test_activity_since_the_review_is_counted_not_refused(self):
        expected = self.DECIDED | {("p", "move", "conversations", "user_id", "1", "r", "s")}
        live = self.DECIDED | {("p", "move", "conversations", "user_id", "1", "r", "s"),
                               ("p", "move", "conversations", "user_id", "2", "r", "s"),
                               ("p", "skip", "teacher_nudges", "user_id", "9", "r", "")}
        ok, missing, extra, drift = md.check_plan_matches(expected, live)
        self.assertTrue(ok)
        self.assertEqual(drift, {("p", "move", "conversations", "user_id"): (1, 2),
                                 ("p", "skip", "teacher_nudges", "user_id"): (0, 1)})

    def test_an_empty_reviewed_plan_is_refused(self):
        with self.assertRaises(ValueError):
            md.check_plan_matches(set(), {("p",)})
        with self.assertRaises(ValueError):
            md.check_plan_matches({("p", "move", "t", "c", "1", "r", "s")}, set())


class FakeCursor:
    def __init__(self, log, counts):
        self.log, self.counts, self.rowcount = log, counts, 0

    def execute(self, sql, params=None):
        self.log.append(sql)
        self.rowcount = self.counts.pop(0) if sql.lstrip().upper().startswith(("UPDATE", "INSERT")) else 0

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, counts):
        self.log, self.counts, self.committed, self.rolled_back = [], list(counts), False, False

    def cursor(self):
        return FakeCursor(self.log, self.counts)

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


class ApplyPlan(unittest.TestCase):
    """The writes run in the caller's one transaction: timeouts first, every statement asserting its rowcount, then a
    re-read that must find nothing wrong; any failure rolls back and stops."""

    STEPS = [("UPDATE users SET a = %s WHERE id = %s", ("x", "r"), 1, "retire r"),
             ("UPDATE lesson_plans SET user_id = %s WHERE id = ANY(%s)", ("s", [1, 2]), 2, "move lesson_plans")]

    def test_success_commits_once(self):
        conn = FakeConn([1, 2])
        self.assertEqual(md.apply_plan(conn, self.STEPS, verify=lambda: []), 2)
        self.assertTrue(conn.committed)
        self.assertIn("lock_timeout", conn.log[0])

    def test_a_rowcount_mismatch_rolls_back_and_names_the_step(self):
        conn = FakeConn([1, 1])
        with self.assertRaises(SystemExit) as e:
            md.apply_plan(conn, self.STEPS, verify=lambda: [])
        self.assertIn("move lesson_plans", str(e.exception))
        self.assertTrue(conn.rolled_back)
        self.assertFalse(conn.committed)

    def test_a_failed_verify_rolls_back(self):
        conn = FakeConn([1, 2])
        with self.assertRaises(SystemExit):
            md.apply_plan(conn, self.STEPS, verify=lambda: ["retired account still live"])
        self.assertTrue(conn.rolled_back)
        self.assertFalse(conn.committed)


if __name__ == "__main__":
    unittest.main()
