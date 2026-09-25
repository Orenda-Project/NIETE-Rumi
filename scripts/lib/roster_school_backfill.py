"""
Decision logic for scripts/backfill-school-id-from-roster.py. Pure: no I/O, no database.

The runner owns the one read query and the one transaction; this module owns every
judgement call, so the judgement is testable without a database (the same split
scripts/migrate-schools.py has with school-migration.transform.js).

Input: one row per (user, roster row), from the runner's candidate query:
  user_id, phone_e164, role, current_school_id, roster_school_id, school_ext_id,
  leader_user_id, teacher_name, school_name, emis, region, is_probable_test, is_active

Output: one decision per user.
  backfill                unlinked; the roster names exactly one usable school -> write it
  already_linked          users.school_id is set and the roster agrees, or names nothing
  conflict                users.school_id is set to a school the roster does not name -> report only
  ambiguous               unlinked; the roster names two or more usable schools -> report only
  skipped_probable_test   unlinked; every roster school is flagged schools.is_probable_test
  skipped_inactive_school unlinked; every roster school is inactive
  skipped_role_coach      a coach account listed as a teacher; linking it would put the coach
                          into that school's derived patch (leader_schools x users.school_id)
  skipped_role_<role>     unlinked, and the caller asked to hold this role back (skip_roles) — e.g.
                          a principal's users.school_id also grants that school's staff-attendance
                          register, so linking one is an access decision, not a data fix
  no_roster_school        the roster rows carry no resolvable school
  skipped_removed_by_coach  the teacher's latest roster membership action (add/remove/move, excluding
                          this script's own rows) is a coach's 'remove'. The coach remove path clears
                          users.school_id but leaves the deprecated leader_teachers row, so the stale
                          roster still lists her; linking her would undo the coach's decision.
  skipped_unlinked_before users.school_id was set once and later cleared (record_history) — someone
                          unlinked her on purpose, through a path that may not write the roster audit.

Input rows may carry `last_membership_action` and `school_id_ever_cleared`; absent means unknown-safe
(no removal recorded).
"""
from collections import Counter, OrderedDict

DECISIONS = (
    "backfill", "already_linked", "conflict", "ambiguous",
    "skipped_probable_test", "skipped_inactive_school", "skipped_role_coach", "no_roster_school",
    "skipped_removed_by_coach", "skipped_unlinked_before",
)
WRITE_DECISIONS = ("backfill",)


def _usable(flags):
    return flags["is_active"] and not flags["is_probable_test"]


def classify_user(rows, skip_roles=None):
    if not rows:
        raise ValueError("classify_user needs at least one row")
    first = rows[0]
    role = first.get("role")
    current = first.get("current_school_id")

    schools = OrderedDict()   # roster_school_id -> flags + the first roster row naming it
    for r in rows:
        sid = r.get("roster_school_id")
        if sid and sid not in schools:
            schools[sid] = {
                "is_probable_test": bool(r.get("is_probable_test")),
                "is_active": r.get("is_active", True) is not False,
                "row": r,
            }

    base = dict(
        user_id=first["user_id"], phone_e164=first.get("phone_e164"), role=role,
        current_school_id=current, target_school_id=None, schools=list(schools),
        leader_user_id=None, school_ext_id=None, teacher_name=first.get("teacher_name"),
        school_name=None, emis=None, region=None, promote_to_teacher=False,
        decision=None, reason="",
    )

    if current:
        if not schools or current in schools:
            agrees = "roster agrees" if current in schools else "roster names no school"
            return {**base, "decision": "already_linked", "reason": f"users.school_id already set; {agrees}"}
        return {**base, "decision": "conflict",
                "reason": "users.school_id is set to a school the roster does not name; needs a human"}

    if first.get("last_membership_action") == "remove":
        return {**base, "decision": "skipped_removed_by_coach",
                "reason": "a coach removed this teacher; the stale roster row must not undo that"}
    if first.get("school_id_ever_cleared"):
        return {**base, "decision": "skipped_unlinked_before",
                "reason": "users.school_id was set and later cleared; someone unlinked her on purpose"}

    if skip_roles and role in skip_roles:
        return {**base, "decision": f"skipped_role_{role}",
                "reason": f"role '{role}' held back by the caller; linking it is not only a data fix"}

    if role == "coach":
        return {**base, "decision": "skipped_role_coach",
                "reason": "coach account on a teacher roster; a coach must not be linked as a school's teacher"}

    if not schools:
        return {**base, "decision": "no_roster_school", "reason": "roster rows carry no resolvable school"}

    usable = [sid for sid, f in schools.items() if _usable(f)]
    if len(usable) == 1:
        sid = usable[0]
        r = schools[sid]["row"]
        return {
            **base, "decision": "backfill", "target_school_id": sid,
            "leader_user_id": r.get("leader_user_id"), "school_ext_id": r.get("school_ext_id"),
            "teacher_name": r.get("teacher_name") or first.get("teacher_name"),
            "school_name": r.get("school_name"), "emis": r.get("emis"), "region": r.get("region"),
            "promote_to_teacher": role == "unregistered",
            "reason": "unlinked; roster names one usable school",
        }
    if len(usable) > 1:
        return {**base, "decision": "ambiguous", "reason": f"roster names {len(usable)} usable schools"}
    if any(f["is_probable_test"] for f in schools.values()):
        return {**base, "decision": "skipped_probable_test", "reason": "every roster school is flagged is_probable_test"}
    return {**base, "decision": "skipped_inactive_school", "reason": "every roster school is inactive"}


def classify_all(rows, skip_roles=None):
    by_user = OrderedDict()
    for r in rows:
        by_user.setdefault(r["user_id"], []).append(r)
    return [classify_user(v, skip_roles=skip_roles) for v in by_user.values()]


def summarize(decisions):
    return Counter(d["decision"] for d in decisions)


def audit_row(decision, run_id):
    """One leader_roster_audit row per written link. 'add' by the coach who holds the
    teacher (actor_user_id is NOT NULL and must be a real coach); NULL from_ = an add;
    detail.backfill marks it as a script write, as V1.2.3 intended."""
    if decision["decision"] not in WRITE_DECISIONS:
        raise ValueError(f"no audit row for a '{decision['decision']}' decision")
    return {
        "action": "add",
        "actor_user_id": decision["leader_user_id"],
        "affected_leader_user_id": decision["leader_user_id"],
        "teacher_ext_id": decision["phone_e164"],
        "teacher_phone_e164": decision["phone_e164"],
        "teacher_name": decision["teacher_name"],
        "from_school_ext_id": None,
        "to_school_ext_id": decision["school_ext_id"],
        "detail": {
            "backfill": "roster_school_id", "run_id": run_id,
            "target_school_id": decision["target_school_id"], "previous_school_id": None,
            "user_id": decision["user_id"], "role": decision["role"],
            "promote_to_teacher": decision["promote_to_teacher"],
        },
    }


def select_undo(rows):
    """Relinks this script made that undid a coach's removal and are still exactly as it left them.

    Each row: user_id, current_school_id, target_school_id (what the run set), prior_action (the
    latest non-backfill membership action BEFORE the run), later_action (any non-backfill membership
    action AFTER the run, else None). Only a clean, unambiguous relink of a removed teacher is undone:
    if the school changed since, or a coach acted on her since, a human's later decision stands."""
    return [r for r in rows
            if r.get("prior_action") == "remove"
            and r.get("later_action") is None
            and r.get("current_school_id") is not None
            and r.get("current_school_id") == r.get("target_school_id")]


def undo_audit_row(row, run_id):
    """The 'remove' that reverses one wrong relink, attributed to the coach the run attributed the add to."""
    return {
        "action": "remove",
        "actor_user_id": row["actor_user_id"],
        "affected_leader_user_id": row["actor_user_id"],
        "teacher_ext_id": row["phone_e164"],
        "teacher_phone_e164": row["phone_e164"],
        "teacher_name": row.get("teacher_name"),
        "from_school_ext_id": row.get("school_ext_id"),
        "to_school_ext_id": None,
        "detail": {"backfill": "undo_removed_relink", "rollback_of": run_id,
                   "target_school_id": row["target_school_id"], "user_id": row["user_id"],
                   "reason": "the backfill re-linked a teacher a coach had removed"},
    }
