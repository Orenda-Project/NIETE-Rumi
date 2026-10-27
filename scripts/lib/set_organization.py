"""Helpers for scripts/set-organization.py: one organization value for the NIETE deployment.

The rules (doc "NIETE data fixes", decisions D3 and D4, 2026-10-27):
  * every NIETE spelling (Taleemabad/niete, NIETE/ICT, fde) becomes `niete` on every live row, wherever it sits:
    no school, an HQ row, a probable-test school. A respelling changes no one's membership, so it applies anywhere;
  * a blank becomes `niete` only when the row's school is in one of the six ICT sectors and is neither a
    probable-test school nor a NIETE-named (HQ) row; a one-off string follows the same school rule;
  * a Durbeen row is never filled, and one that carries a value is cleared (Durbeen is not on the programme);
  * test and deleted rows are never touched, and `niete` stays as it is.

Everything here is pure except apply_changes(), which writes a plan inside the caller's open transaction. It takes
any DB-API style connection, so it is tested with a fake one.
"""
import csv
import io
import re
from collections import Counter, OrderedDict

CANON = "niete"
NIETE_VALUES = ("Taleemabad/niete", "NIETE/ICT", "fde")
SIX = ("Urban-I", "Urban-II", "Nilore", "Sihala", "B.K", "Tarnol")
HQ_NAME = re.compile(r"^\s*NIETE", re.I)
UPDATE_SQL = ("UPDATE users SET organization = %s WHERE id = ANY(%s::uuid[]) "
              "AND organization IS NOT DISTINCT FROM %s")


def _school(user, schools):
    sid = user.get("school_id")
    return schools.get(sid) if sid else None


def _test_or_hq(school):
    return bool(school) and (bool(school.get("is_probable_test")) or bool(HQ_NAME.match(school.get("name") or "")))


def classify(user, schools):
    """(new_value, reason) for a row that changes, else None."""
    if user.get("is_test_user") is True or user.get("deleted_at"):
        return None
    s = _school(user, schools)
    old = user.get("organization")
    if s and s.get("region") == "Durbeen":
        return (None, "durbeen:clear") if old is not None else None
    if old == CANON:
        return None
    if old in NIETE_VALUES:
        return (CANON, f"rewrite:{old}")
    in_scope = bool(s) and s.get("region") in SIX and not _test_or_hq(s)
    if not in_scope:
        return None
    return (CANON, "fill:six-sector school") if old is None else (CANON, "rewrite:one-off")


def plan(users, schools):
    """[(id, old, new, reason), ...] for every row that changes, in the order of `users`."""
    out = []
    for uid, u in users.items():
        c = classify(u, schools)
        if c:
            out.append((uid, u.get("organization"), c[0], c[1]))
    return out


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
    """Classes that must be empty before any write. Each key is a plain sentence. A "fill" is a value appearing
    where none of the NIETE spellings was; respelling an existing NIETE value is never a fill."""
    g = Counter({"fill with no school": 0, "fill on a Durbeen row": 0,
                 "fill at a probable-test or NIETE-named school": 0, "row that is test or deleted": 0})
    for c in changes:
        uid, old, new = c[0], c[1], c[2]
        u = users_by_id.get(uid, {})
        s = _school(u, schools)
        fill = new is not None and old not in NIETE_VALUES
        if fill and not s:
            g["fill with no school"] += 1
        if s and s.get("region") == "Durbeen" and new is not None:
            g["fill on a Durbeen row"] += 1
        if fill and _test_or_hq(s):
            g["fill at a probable-test or NIETE-named school"] += 1
        if u.get("is_test_user") is True or u.get("deleted_at"):
            g["row that is test or deleted"] += 1
    return dict(g)


def reason_counts(changes):
    return dict(Counter(c[3] for c in changes if len(c) > 3))


def parse_plan_csv(text):
    """The reviewed dry run's change CSV (id, old, new, reason) as a set of (id, old, new); a blank cell is NULL."""
    return {(r["id"], r["old"], r["new"]) for r in csv.DictReader(io.StringIO(text))}


def check_plan_matches(expected, changes):
    """(ok, missing, extra) ids: does the live plan equal the reviewed one, row for row on (id, old, new)?
    missing = reviewed but no longer planned, or planned differently; extra = planned now but never reviewed."""
    if not expected:
        raise ValueError("the reviewed plan is empty; refusing to run")
    live = {(c[0], c[1] or "", c[2] or "") for c in changes}
    missing = sorted({e[0] for e in expected - live})
    extra = sorted({x[0] for x in live - expected})
    return (not missing and not extra, missing, extra)


def apply_changes(conn, changes, reload, chunk=1000):
    """Write `changes` in the caller's open transaction and commit once. The transaction first sets a 5 s lock
    timeout and a 120 s statement timeout, so it fails fast instead of queueing behind the app. One UPDATE per
    (old, new) group of at most `chunk` ids, each guarded on the old value and asserting its rowcount; then
    `reload()` -> (users, schools) must plan nothing. Any failure, ours or the database's, rolls back and stops.
    Returns the number of rows changed."""
    try:
        with conn.cursor() as cur:
            cur.execute("SET LOCAL lock_timeout = '5s'")
            cur.execute("SET LOCAL statement_timeout = '120s'")
            for (old, new), ids in group_changes(changes, chunk):
                cur.execute(UPDATE_SQL, (new, ids, old))
                if cur.rowcount != len(ids):
                    raise RuntimeError(f"group {old!r}->{new!r}: rowcount {cur.rowcount} != {len(ids)}")
        users, schools = reload()
        left = plan(users, schools)
        if left:
            raise RuntimeError(f"{len(left)} rows would still change after the write")
    except Exception as e:  # noqa: BLE001 - every failure ends in an explicit rollback
        conn.rollback()
        raise SystemExit(f"ABORT (rolled back): {e}")
    conn.commit()
    return len(changes)
