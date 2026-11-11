"""Pure decision logic for scripts/merge-duplicate-accounts.py (bd-4jlu31.8.1).

Merges an RM-confirmed teacher's duplicate accounts into one, the way the app's own number move does
(bot/shared/services/observe/teacher-edit-commit.service.js: moveNumber, reparentShellRows, moveDetail), with the
operator's decisions of 11 Nov 2026 (work folder versions/v6_duplicates-cleanup-plan):
  D6  a retired duplicate carries deleted_reason 'duplicate_merge' and deleted_by 'rm_duplicate_review';
  D7  everything the retired account owns moves to the survivor, by row id, in every table that references users;
  D8  a clash in the training tables (the same module or level on both accounts) is refused and left for later.

The survivor is the account with the most irreplaceable history (the app's IDENTITY_BEARING tables: certificates,
assessment attempts, training progress, coaching), so the fewest of those rows move; a tie goes to the account on the
number in use. The survivor takes the number in use with what is bound to that number (the portal signs in by phone,
and the WhatsApp session is the number's), and fills any fact it lacks from the retired account(s). It never
overwrites a value it already has.

A row stays behind (a 'skip') only where the database itself would refuse the move: a unique index already holding
the survivor's row for the same key (the runner reads every such index from the catalog, partial and expression
ones included), or a sealed observation form, whose observer the seal trigger keeps.

Everything here is pure except apply_plan(), which runs SQL steps in the caller's open transaction and is tested with
a fake connection, as set_organization.apply_changes is.
"""

REASON = "duplicate_merge"
VIA = "rm_duplicate_review"
IDENTITY_TABLES = ("training_certificates", "training_assessment_attempts", "teacher_training_progress",
                   "coaching_sessions")
FORM_ROLES = ("teacher", "principal")
MERGEABLE_ROLES = ("teacher", "principal", "unregistered")
NOT_LIVE_PREFIXES = ("merged:", "retired:", "analytics:")
# Audit logs stay as they happened: who did what is never re-attributed (coachip_audit_log's append-only trigger
# would refuse it anyway; it exists on sandbox ahead of prod).
NEVER_MOVE = frozenset({("leader_roster_audit", "actor_user_id"), ("leader_roster_audit", "affected_leader_user_id"),
                        ("grade_audit_log", "user_id"), ("coachip_audit_log", "actor_user_id")})
# Rows a trigger refuses to re-own: {(table, owner column): SQL that is true for such a row}. The runner selects it as
# the row's "frozen" flag. observation_field_forms_keep_seal raises on any change to a sealed form's observer.
FROZEN = {("observation_field_forms", "observer_user_id"): "sealed_at IS NOT NULL"}
PORTAL = ("portal_password_hash", "portal_activated", "portal_last_login")
LANGUAGE = ("preferred_language", "language_locked")
SESSION = ("conversation_state", "conversation_state_expires_at", "session_id")
FILL_IF_EMPTY = ("name", "school_id", "organization", "grades_taught", "subjects_taught", "subject")
# A commit is bound to the reviewed dry run's decisions; what the accounts own is activity (see check_plan_matches).
DECISIONS = ("retire", "survivor", "audit")
ACTIVITY = ("move", "skip", "visits")


def _empty(v):
    return v is None or (isinstance(v, str) and not v.strip())


def choose_survivor(accounts, in_use_id):
    """The id of the account with the most identity-bearing rows; a tie goes to the account on the number in use."""
    return max(accounts, key=lambda a: (int(a.get("identity_rows") or 0), a["id"] == in_use_id))["id"]


def survivor_patch(survivor, others, in_use_id):
    """The columns the survivor takes, as {column: value}.

    When the number moves, the WhatsApp session (SESSION) moves with it as it is, empty included, so the columns
    planned do not depend on where the chat happens to be; everything else is listed only when it changes."""
    patch = {}
    holder = next((o for o in others if o["id"] == in_use_id), None)
    if holder is not None:
        patch["phone_number"] = holder["phone_number"]
        if holder.get("portal_password_hash"):
            for c in PORTAL:
                patch[c] = holder.get(c)
        for c in LANGUAGE:
            if holder.get(c) is not None and holder.get(c) != survivor.get(c):
                patch[c] = holder.get(c)
        for c in SESSION:
            patch[c] = holder.get(c)
    order = ([holder] if holder is not None else []) + [o for o in others if o is not holder]
    for c in FILL_IF_EMPTY:
        if _empty(survivor.get(c)):
            v = next((o.get(c) for o in order if not _empty(o.get(c))), None)
            if v is not None:
                patch[c] = v
    if _empty(survivor.get("teacher_level")):
        src = next((o for o in order if not _empty(o.get("teacher_level"))), None)
        if src is not None:
            patch["teacher_level"] = src["teacher_level"]
            patch["teacher_level_updated_at"] = src.get("teacher_level_updated_at")
    if survivor.get("registration_completed") is not True:
        src = next((o for o in order if o.get("registration_completed") is True), None)
        if src is not None:
            patch["registration_completed"] = True
            patch["registration_completed_at"] = src.get("registration_completed_at")
            if src.get("registration_state") == "completed":
                patch["registration_state"] = "completed"
            if _empty(survivor.get("registered_at")) and src.get("registered_at"):
                patch["registered_at"] = src.get("registered_at")
    if survivor.get("role") not in FORM_ROLES:
        role = next((o.get("role") for o in order if o.get("role") in FORM_ROLES), None)
        if role:
            patch["role"] = role
    everyone = [survivor] + list(others)
    firsts = [x.get("first_message_at") for x in everyone if x.get("first_message_at")]
    lasts = [x.get("last_message_at") for x in everyone if x.get("last_message_at")]
    if firsts and min(firsts) != survivor.get("first_message_at"):
        patch["first_message_at"] = min(firsts)
    if lasts and max(lasts) != survivor.get("last_message_at"):
        patch["last_message_at"] = max(lasts)
    return patch


def retire_patch(user_id, now_iso):
    """The app's soft delete (bot/shared/utils/soft-delete.js) with D6's reason; the number is freed, as moveNumber
    frees a retired shell's."""
    return {"deleted_at": now_iso, "deleted_reason": REASON, "deleted_by": VIA, "phone_number": f"merged:{user_id}"}


def _entries(row, indexes):
    """[(index name, key)] for every unique index this row occupies: inside its partial predicate, and with no NULL in
    the key unless the index treats NULLs as equal."""
    out = []
    for ix in indexes:
        if ix.get("in") and row.get(ix["in"]) is not True:
            continue
        key = tuple(row.get(c) for c in ix["cols"])
        if ix.get("nulls_distinct", True) and any(v is None for v in key):
            continue
        out.append((ix["name"], key))
    return out


def plan_moves(owned, survivor_id, retired_ids, keys):
    """[(table, column, row_id, from_id, 'move'|'skip'), ...] for every row a retired account owns.

    owned: {(table, column): [{"id", "owner", "frozen"?, <key aliases>...}, ...]} for the survivor and the retired
    accounts. keys: {(table, column): [{"name", "cols": (alias, ...), "in": alias or None, "nulls_distinct"}, ...]},
    the unique indexes that include that owner column. A row stays ('skip') when it is frozen, or when a key it holds
    is already the survivor's (or is taken by an earlier retired account's row that moves)."""
    order = {rid: i for i, rid in enumerate(retired_ids)}
    out = []
    for (table, col), rows in sorted(owned.items()):
        if (table, col) in NEVER_MOVE:
            continue
        indexes = keys.get((table, col), ())
        taken = set()
        for r in rows:
            if r["owner"] == survivor_id:
                taken.update(_entries(r, indexes))
        mine = sorted((r for r in rows if r["owner"] in order), key=lambda r: (order[r["owner"]], str(r["id"])))
        for r in mine:
            held = _entries(r, indexes)
            if r.get("frozen") is True or any(e in taken for e in held):
                out.append((table, col, r["id"], r["owner"], "skip"))
            else:
                taken.update(held)
                out.append((table, col, r["id"], r["owner"], "move"))
    return out


def plan_visits(visits, moves):
    """(planned, clashes) for booked visits, which key on the phone string and follow the number, as in moveNumber.

    visits: every observation_schedules row as {"id", "teacher_ext_id", "status", "leader_user_id", "school_ext_id"};
    moves: [(from_phone, to_phone)]. planned: [(row_id, from, to)]. clashes: row ids of upcoming visits the move would
    double-book (uq_obs_sched_active: one upcoming visit per coach, school and number)."""
    target = dict(moves)
    rank = {p: i for i, p in enumerate(target)}

    def key(v, phone):
        if v.get("status") != "upcoming" or v.get("leader_user_id") is None or v.get("school_ext_id") is None:
            return None
        return (v["leader_user_id"], v["school_ext_id"], phone)

    finals = set(target.values())
    taken = {key(v, v["teacher_ext_id"]) for v in visits if v["teacher_ext_id"] in finals} - {None}
    planned, clashes = [], []
    for v in sorted((v for v in visits if v["teacher_ext_id"] in target),
                    key=lambda v: (rank[v["teacher_ext_id"]], str(v["id"]))):
        to = target[v["teacher_ext_id"]]
        k = key(v, to)
        if k is not None and k in taken:
            clashes.append(v["id"])
            continue
        if k is not None:
            taken.add(k)
        planned.append((v["id"], v["teacher_ext_id"], to))
    return planned, clashes


def _training_clash(moves):
    clash = [m for m in moves if m[4] == "skip" and m[0] in IDENTITY_TABLES]
    return [f"training clash: {len(clash)} rows on both accounts (left for later, D8)"] if clash else []


def _stranded(stranded):
    """A row that stays behind while other rows depend on it would split the teacher's data between the accounts
    (prod, 11 Nov: a class list with 29 students next to the survivor's empty list for the same class)."""
    if not stranded:
        return []
    deps = {}
    for _table, _row, counts in stranded:
        for ref, n in counts.items():
            deps[ref] = deps.get(ref, 0) + n
    return [f"{len(stranded)} row(s) that would stay behind hold rows depending on them "
            f"({', '.join(f'{ref} {n}' for ref, n in sorted(deps.items()))}); left for a human"]


def guards(rows, survivor_id, retired_ids, in_use_id, reviewed_survivor, moves, visit_clashes=(), stranded=()):
    """Reasons this pair must not be merged; empty when it may. stranded: [(table, row_id, {"ref_table.col": n})] for
    rows that would stay behind (skips) with rows depending on them."""
    out = []
    ids = [survivor_id] + list(retired_ids)
    if len(set(ids)) != len(ids):
        out.append("an account appears twice")
    for i in ids:
        r = rows.get(i)
        if r is None:
            out.append(f"{i}: account not found")
            continue
        if r.get("deleted_at"):
            out.append(f"{i}: already deleted")
        if r.get("is_test_user") is True:
            out.append(f"{i}: a test account")
        if str(r.get("phone_number") or "").startswith(NOT_LIVE_PREFIXES):
            out.append(f"{i}: not on a live number")
        if r.get("role") not in MERGEABLE_ROLES:
            out.append(f"{i}: role {r.get('role')!r} is not merged by this tool")
    if in_use_id not in ids:
        out.append("the number in use is on neither account")
    if survivor_id != reviewed_survivor:
        out.append("the survivor differs from the reviewed one")
    out += _training_clash(moves)
    if visit_clashes:
        out.append(f"booked visits: {len(visit_clashes)} upcoming visit(s) would double-book the same coach and "
                   "school on the number in use")
    return out + _stranded(stranded)


def sweep_guards(rows, survivor_id, retired_ids, moves, stranded=()):
    """Reasons a sweep (moving what reached a retired account after its merge) must not run; empty when it may. It only
    touches pairs this tool merged: a live survivor, and retired accounts soft-deleted by it on a merged: number."""
    out = []
    s = rows.get(survivor_id)
    if s is None or s.get("deleted_at"):
        out.append(f"{survivor_id}: the survivor is not live")
    for r in retired_ids:
        x = rows.get(r)
        if (x is None or not x.get("deleted_at") or x.get("deleted_reason") != REASON
                or x.get("phone_number") != f"merged:{r}"):
            out.append(f"{r}: not retired by this tool")
    return out + _training_clash(moves) + _stranded(stranded)


def audit_rows(survivor_final, survivor_old_phone, retired, moved, skipped, meta=None):
    """One edit_phone row per retired account, in the shape of the app's buildEditAuditRow as the WhatsApp number
    change writes it: her own change (actor = the teacher), no leader affected. The governed analytics
    (ict_account_merges) read detail.retired_user_id and detail.to_phone.

    retired: the retired accounts as they were BEFORE the merge (their own numbers)."""
    out = []
    for r in retired:
        detail = {"via": VIA, "from_phone": survivor_old_phone, "to_phone": survivor_final["phone_number"],
                  "case": REASON, "retired_user_id": r["id"], "retired_phone": r.get("phone_number"),
                  "reparented": dict(moved.get(r["id"]) or {})}
        if skipped.get(r["id"]):
            detail["reparent_skipped"] = dict(skipped[r["id"]])
        detail.update(meta or {})
        out.append({"action": "edit_phone", "actor_user_id": survivor_final["id"], "affected_leader_user_id": None,
                    "teacher_ext_id": survivor_final["id"], "teacher_phone_e164": survivor_final["phone_number"],
                    "teacher_name": survivor_final.get("name"), "detail": detail})
    return out


def phone_moves(survivor_old_phone, survivor_final_phone, retired_old_phones):
    """[(from, to), ...] for booked visits, which key on the phone string: the survivor's old number and every freed
    number move to her final number."""
    out = []
    for p in [survivor_old_phone] + list(retired_old_phones):
        if p and p != survivor_final_phone and (p, survivor_final_phone) not in out:
            out.append((p, survivor_final_phone))
    return out


def plan_rows(pair, survivor_id, patch, retired_ids, moves, visits):
    """The ids-only plan a reviewer reads and a commit is bound to: (pair, step, table, column, row, from, to).
    No phone number or password hash appears: a patched column is named, never its value.
    visits: [(row_id, label), ...] for booked visits that follow the number, the label saying which number."""
    rows = {(pair, "retire", "users", "", rid, "", "") for rid in retired_ids}
    rows |= {(pair, "survivor", "users", col, survivor_id, "", "") for col in patch}
    rows |= {(pair, m[4], m[0], m[1], str(m[2]), m[3], survivor_id if m[4] == "move" else "") for m in moves}
    rows |= {(pair, "visits", "observation_schedules", "teacher_ext_id", str(vid), label, survivor_id)
             for vid, label in visits}
    rows |= {(pair, "audit", "leader_roster_audit", "", rid, survivor_id, "") for rid in retired_ids}
    return rows


def _activity(rows):
    counts = {}
    for r in rows:
        if r[1] in ACTIVITY:
            counts[tuple(r[:4])] = counts.get(tuple(r[:4]), 0) + 1
    return counts


def check_plan_matches(expected, live):
    """(ok, missing, extra, drift). The decisions (who retires, which columns the survivor takes, the audit rows) must
    equal the reviewed ones row for row, else ok is False. What the accounts own is activity: a teacher who keeps
    chatting makes rows between the review and the commit, and every one of them moves (D7), so it is counted per
    (pair, step, table, column) as (reviewed, live) in drift, never refused."""
    decided = {tuple(r) for r in expected if len(r) > 1 and r[1] in DECISIONS}
    if not decided:
        raise ValueError("the reviewed plan has no decisions; refusing to run")
    live_decided = {tuple(r) for r in live if len(r) > 1 and r[1] in DECISIONS}
    missing, extra = sorted(decided - live_decided), sorted(live_decided - decided)
    before, now = _activity(expected), _activity(live)
    drift = {k: (before.get(k, 0), now.get(k, 0)) for k in sorted(set(before) | set(now))
             if before.get(k, 0) != now.get(k, 0)}
    return (not missing and not extra, missing, extra, drift)


def apply_plan(conn, steps, verify):
    """Run [(sql, params, expected_rowcount or None, label), ...] in the caller's open transaction and commit once.
    Lock and statement timeouts first, so it fails fast instead of queueing behind the app; every write asserts its
    rowcount; then verify() must return no problems. Any failure rolls back and stops. Returns the number of steps."""
    try:
        with conn.cursor() as cur:
            cur.execute("SET LOCAL lock_timeout = '5s'")
            cur.execute("SET LOCAL statement_timeout = '120s'")
            for sql, params, expected, label in steps:
                cur.execute(sql, params)
                if expected is not None and cur.rowcount != expected:
                    raise RuntimeError(f"rowcount {cur.rowcount} != {expected} at: {label}")
        problems = verify()
        if problems:
            raise RuntimeError("; ".join(problems[:5]))
    except Exception as e:  # noqa: BLE001 - every failure ends in an explicit rollback
        conn.rollback()
        raise SystemExit(f"ABORT (rolled back): {e}")
    conn.commit()
    return len(steps)
