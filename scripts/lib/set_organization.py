"""Pure helpers for scripts/set-organization.py: one organization value for the NIETE deployment.

The rules (doc "NIETE data fixes", decisions D3 and D4, 2026-10-27):
  * every NIETE-denoting value (Taleemabad/niete, NIETE/ICT, fde) becomes `niete`, wherever the row sits;
  * a blank becomes `niete` only when the row's school is in one of the six ICT sectors and is neither a
    probable-test school nor a NIETE-named (HQ) row;
  * a one-off string follows the same school rule;
  * a Durbeen row is never filled, and one that carries a value is cleared (Durbeen is not on the programme);
  * test, deleted, probable-test-school and NIETE-named-school rows are never touched (they belong to the
    test-user sweep);
  * `niete` stays as it is.
"""
import re
from collections import Counter, OrderedDict

CANON = "niete"
NIETE_VALUES = ("Taleemabad/niete", "NIETE/ICT", "fde")
SIX = ("Urban-I", "Urban-II", "Nilore", "Sihala", "B.K", "Tarnol")
HQ_NAME = re.compile(r"^\s*NIETE", re.I)


def _school(user, schools):
    sid = user.get("school_id")
    return schools.get(sid) if sid else None


def classify(user, schools):
    """(new_value, reason) for a row that changes, else None."""
    if user.get("is_test_user") is True or user.get("deleted_at"):
        return None
    s = _school(user, schools)
    if s and (s.get("is_probable_test") or HQ_NAME.match(s.get("name") or "")):
        return None                      # test and HQ school rows belong to the test-user sweep, not to this script
    old = user.get("organization")
    if s and s.get("region") == "Durbeen":
        return (None, "durbeen:clear") if old is not None else None
    if old == CANON:
        return None
    if old in NIETE_VALUES:
        return (CANON, f"rewrite:{old}")
    in_scope = bool(s) and s.get("region") in SIX and not s.get("is_probable_test")
    if old is None:
        return (CANON, "fill:six-sector school") if in_scope else None
    return (CANON, "rewrite:one-off") if in_scope else None


def group_changes(changes, chunk=1000):
    """[((old, new), [ids...]), ...] grouped by the (old, new) pair in first-seen order, each list at most `chunk` long."""
    groups = OrderedDict()
    for c in changes:
        uid, old, new = c[0], c[1], c[2]
        groups.setdefault((old, new), []).append(uid)
    out = []
    for key, ids in groups.items():
        for i in range(0, len(ids), chunk):
            out.append((key, ids[i:i + chunk]))
    return out


def guard_counts(changes, users_by_id, schools):
    """Classes that must be empty before any write. Each key is a plain sentence."""
    g = Counter({"fill with no school": 0, "row at a probable-test or NIETE-named school": 0,
                 "fill on a Durbeen row": 0, "row that is test or deleted": 0})
    for c in changes:
        uid, old, new = c[0], c[1], c[2]
        u = users_by_id.get(uid, {})
        s = _school(u, schools)
        if old is None and new is not None and not s:
            g["fill with no school"] += 1
        if s and (s.get("is_probable_test") or HQ_NAME.match(s.get("name") or "")):
            g["row at a probable-test or NIETE-named school"] += 1
        if s and s.get("region") == "Durbeen" and new is not None:
            g["fill on a Durbeen row"] += 1
        if u.get("is_test_user") is True or u.get("deleted_at"):
            g["row that is test or deleted"] += 1
    return dict(g)


def reason_counts(changes):
    return dict(Counter(c[3] for c in changes if len(c) > 3))
