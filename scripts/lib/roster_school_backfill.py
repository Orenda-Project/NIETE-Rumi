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
  no_roster_school        the roster rows carry no resolvable school
"""
from collections import Counter, OrderedDict

DECISIONS = (
    "backfill", "already_linked", "conflict", "ambiguous",
    "skipped_probable_test", "skipped_inactive_school", "skipped_role_coach", "no_roster_school",
)
WRITE_DECISIONS = ("backfill",)


def _usable(flags):
    return flags["is_active"] and not flags["is_probable_test"]


def classify_user(rows):
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


def classify_all(rows):
    by_user = OrderedDict()
    for r in rows:
        by_user.setdefault(r["user_id"], []).append(r)
    return [classify_user(v) for v in by_user.values()]


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
