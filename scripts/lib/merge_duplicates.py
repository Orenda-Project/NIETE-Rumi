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

A class link or class list left behind that way is folded into the survivor's row for the same key, its twin,
the way the app's class hand-over treats an outgoing teacher (bot/database/migrations/
roster_hand_over_class.sql): the rows depending on it follow the twin, the class-teacher flag moves to the twin when
only the duplicate's row holds it, and the row is retired the app's way, then moves to the survivor like any other.
What cannot follow (attendance or quizzes on the duplicate's list, a subject on both links) is left for a human.

The governed analytics (ict_account_merges) credit a retired account's activity to whoever is live on its LATEST
edit_phone row's to_phone: they follow the number, not the survivor. So a merge that moves or retires the account an
earlier retired account points at (a re-merge: a freed number came back as a new account) also writes a newer row for
that earlier account on the survivor's final number (repoints, repoint_rows), and a restore removes it again
(audit_removal). repair_plan finds the retired accounts the mapping already misses, for the runner's --repoint mode.

Everything here is pure except apply_plan(), which runs SQL steps in the caller's open transaction and is tested with
a fake connection, as set_organization.apply_changes is.
"""
import re

REASON = "duplicate_merge"
REPOINT = "repoint"
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
# users' other unique columns: {column: companion columns that travel with it}. The survivor takes one it lacks and the
# duplicate gives it up; two different values of a column in CONFLICT_REFUSES are refused (two FDE teacher identities:
# training syncs map teacher_uuid to an account, deleted or not). The runner refuses any unique column not listed here.
UNIQUE_TAKE = {"teacher_uuid": (), "portal_invite_token": ("portal_invite_expires_at",)}
CONFLICT_REFUSES = ("teacher_uuid",)
TIMESTAMP_RE = r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}"
# The tables whose rows left behind are folded into their twin: {(table, owner column): {"follow": (the dependent
# table, its foreign key onto this table, the column that with it keys a dependent), "flag": the column that moves to
# the twin when only the duplicate's row holds it, "same": the columns both rows must agree on, "lock": the "same"
# column naming the class whose roster lock the fold takes, as every roster writer does}}.
FOLD = {("class_teachers", "teacher_user_id"): {"follow": ("class_teacher_subjects", "class_teacher_id", "subject_code"),
                                                "flag": "is_class_teacher", "same": ("class_id",), "lock": "class_id"},
        ("student_lists", "user_id"): {"follow": ("students", "list_id", "id"), "flag": None, "same": ("class_id",),
                                       "lock": "class_id"}}
# A commit is bound to the reviewed dry run's decisions; what the accounts own is activity (see check_plan_matches).
DECISIONS = ("retire", "survivor", "audit", "fold", REPOINT)
ACTIVITY = ("move", "skip", "visits", "follow")


def _empty(v):
    return v is None or (isinstance(v, str) and not v.strip()) or (isinstance(v, (list, dict)) and not v)


def choose_survivor(accounts, in_use_id):
    """The id of the account with the most identity-bearing rows; a tie goes to the account on the number in use."""
    return max(accounts, key=lambda a: (int(a.get("identity_rows") or 0), a["id"] == in_use_id))["id"]


def survivor_patch(survivor, others, in_use_id):
    """The columns the survivor takes, as {column: value}.

    Columns that move with the chat are planned whatever their values, so the columns a dry run plans do not change
    while the teacher keeps chatting (the bot stamps last_message_at on every message): when the number moves, the
    WhatsApp session (SESSION) as it is, empty included, and the language the number has; and the first and last
    message times across the accounts, always. Everything else is listed only when it changes."""
    patch = {}
    holder = next((o for o in others if o["id"] == in_use_id), None)
    if holder is not None:
        patch["phone_number"] = holder["phone_number"]
        if holder.get("portal_password_hash"):
            for c in PORTAL:
                patch[c] = holder.get(c)
        for c in LANGUAGE:
            if holder.get(c) is not None:
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
    if firsts:
        patch["first_message_at"] = min(firsts)
    if lasts:
        patch["last_message_at"] = max(lasts)
    return patch


def unique_takeover(survivor, others, take=None):
    """(patch, gives_up, conflicts) for users' other unique columns (UNIQUE_TAKE): the survivor takes a value it lacks
    when exactly one other account has one, with its companion columns, and that account gives them up
    ({account id: [columns]}); conflicts lists the CONFLICT_REFUSES columns where the accounts hold two values."""
    patch, gives_up, conflicts = {}, {}, []
    for col, companions in (take or UNIQUE_TAKE).items():
        holders = [o for o in others if not _empty(o.get(col))]
        if not _empty(survivor.get(col)):
            if holders and col in CONFLICT_REFUSES:
                conflicts.append(col)
            continue
        if len(holders) > 1:
            if col in CONFLICT_REFUSES:
                conflicts.append(col)
            continue
        if holders:
            h = holders[0]
            for c in (col,) + tuple(companions):
                patch[c] = h.get(c)
            gives_up.setdefault(h["id"], []).extend((col,) + tuple(companions))
    return patch, gives_up, conflicts


def retire_patch(user_id, now_iso, gives_up=()):
    """The app's soft delete (bot/shared/utils/soft-delete.js) with D6's reason; the number is freed, as moveNumber
    frees a retired shell's, and so is any unique value the survivor takes (gives_up)."""
    out = {"deleted_at": now_iso, "deleted_reason": REASON, "deleted_by": VIA, "phone_number": f"merged:{user_id}"}
    out.update({c: None for c in gives_up})
    return out


def _hashable(v):
    if isinstance(v, list):
        return tuple(_hashable(x) for x in v)
    if isinstance(v, dict):
        return tuple(sorted((k, _hashable(x)) for k, x in v.items()))
    return v


def _entries(row, indexes):
    """[(index name, key)] for every unique index this row occupies: inside its partial predicate, and with no NULL in
    the key unless the index treats NULLs as equal."""
    out = []
    for ix in indexes:
        if ix.get("in") and row.get(ix["in"]) is not True:
            continue
        key = tuple(_hashable(row.get(c)) for c in ix["cols"])
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


def find_twins(owned, moves, survivor_id, keys, fold=None):
    """[(table, column, row_id, owner, twin_row_id)] for each row left behind in a FOLD table whose unique key the
    survivor's own row holds (its twin). A row left behind for another retired account's row has no twin."""
    fold = FOLD if fold is None else fold
    out = []
    for (t, c, row, owner, action) in moves:
        if action != "skip" or (t, c) not in fold:
            continue
        indexes, rows = keys.get((t, c), ()), owned.get((t, c), [])
        held = {e for r in rows if r["id"] == row for e in _entries(r, indexes)}
        twin = next((r["id"] for r in rows if r["owner"] == survivor_id and held & set(_entries(r, indexes))), None)
        if twin is not None:
            out.append((t, c, row, owner, twin))
    return out


def plan_folds(twins, facts, fold=None):
    """(folds, problems) for find_twins' twins. facts: {(table, row id): {"same": {column: value}, "flag": bool,
    "follow": [keys of the rows that would follow], "held": {"table.column": n}, "key_type": the follow key's SQL
    type}} as the runner reads them for both rows; "held" counts the rows depending on the duplicate's row that
    cannot follow it. A fold: {"table", "column", "row", "owner", "into" (the twin), "follow": FOLD's triple, "keys":
    what follows, "flag": the flag column when the flag moves, else None, "lock": the class whose roster lock it
    takes, or None, "key_type": so each statement matches the keys in their own type, by index}. Every twin gets a
    fold; problems say which cannot be made."""
    fold = FOLD if fold is None else fold
    folds, problems = [], []
    for (t, c, row, owner, into) in twins:
        cfg = fold[(t, c)]
        rt, _rc, kc = cfg["follow"]
        mine, theirs = facts.get((t, row)), facts.get((t, into))
        if mine is None or theirs is None:
            problems.append(f"{t} row {row}: not read for the fold; left for a human")
        mine, theirs = mine or {}, theirs or {}
        keys = sorted(str(k) for k in mine.get("follow") or ())
        if mine and theirs:
            both = sorted(set(keys) & {str(k) for k in theirs.get("follow") or ()})
            if both:
                problems.append(f"{t} row {row}: {rt}.{kc} {', '.join(both)} on the survivor's row too; "
                                "left for a human")
            for col in cfg["same"]:
                if (mine.get("same") or {}).get(col) != (theirs.get("same") or {}).get(col):
                    problems.append(f"{t} row {row}: {col} differs from the survivor's row; left for a human")
            held = {ref: n for ref, n in (mine.get("held") or {}).items() if n}
            if held:
                problems.append(f"{t} row {row}: {', '.join(f'{ref} {n}' for ref, n in sorted(held.items()))} "
                                "depend on it and cannot follow it; left for a human")
        flag = cfg["flag"] if cfg["flag"] and mine.get("flag") is True and theirs.get("flag") is not True else None
        lock = (mine.get("same") or {}).get(cfg["lock"]) if cfg.get("lock") else None
        folds.append({"table": t, "column": c, "row": row, "owner": owner, "into": into, "follow": cfg["follow"],
                      "keys": keys, "flag": flag, "lock": lock, "key_type": mine.get("key_type")})
    return folds, problems


def fold_moves(moves, folds):
    """The moves with each folded row's 'skip' turned into 'fold': once retired it holds no key, so it moves to the
    survivor like any other row, and nothing depending on it is left behind."""
    folded = {(f["table"], f["column"], f["row"]) for f in folds}
    return [m[:4] + ("fold",) if m[4] == "skip" and m[:3] in folded else m for m in moves]


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


def guards(rows, survivor_id, retired_ids, in_use_id, reviewed_survivor, moves, visit_clashes=(), stranded=(),
           identity_conflicts=(), fold_problems=()):
    """Reasons this pair must not be merged; empty when it may. stranded: [(table, row_id, {"ref_table.col": n})] for
    rows that would stay behind (skips) with rows depending on them. fold_problems: plan_folds' problems."""
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
    if identity_conflicts:
        out.append(f"the accounts hold two different values of {', '.join(identity_conflicts)} (two FDE teacher "
                   "identities); left for a human")
    return out + list(fold_problems) + _stranded(stranded)


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


def audit_rows(survivor_final, survivor_old_phone, retired, moved, skipped, meta=None, folded=None):
    """One edit_phone row per retired account, in the shape of the app's buildEditAuditRow as the WhatsApp number
    change writes it: her own change (actor = the teacher), no leader affected. The governed analytics
    (ict_account_merges) read detail.retired_user_id and detail.to_phone.

    retired: the retired accounts as they were BEFORE the merge (their own numbers). folded: {account: {table: n}}."""
    out = []
    for r in retired:
        detail = {"via": VIA, "from_phone": survivor_old_phone, "to_phone": survivor_final["phone_number"],
                  "case": REASON, "retired_user_id": r["id"], "retired_phone": r.get("phone_number"),
                  "reparented": dict(moved.get(r["id"]) or {})}
        if skipped.get(r["id"]):
            detail["reparent_skipped"] = dict(skipped[r["id"]])
        if (folded or {}).get(r["id"]):
            detail["folded"] = dict(folded[r["id"]])
        detail.update(meta or {})
        out.append({"action": "edit_phone", "actor_user_id": survivor_final["id"], "affected_leader_user_id": None,
                    "teacher_ext_id": survivor_final["id"], "teacher_phone_e164": survivor_final["phone_number"],
                    "teacher_name": survivor_final.get("name"), "detail": detail})
    return out


def number_key(phone):
    """The governed join key of a number (ict_account_merges: the last ten digits); None for no number or a freed one
    (merged:/retired:/analytics:, which only a retired account holds)."""
    if not phone or str(phone).startswith(NOT_LIVE_PREFIXES):
        return None
    digits = re.sub(r"\D", "", str(phone))
    return digits[-10:] or None


def current_account(latest, deleted, retired_id):
    """The live account a retired account's history belongs to now: the survivor its latest edit_phone row names
    (teacher_ext_id), followed through every account that was itself retired since, to a live one. None when the
    chain breaks: an id that is no account, a retired account with no row of its own, or a loop.
    latest: {retired id: {"survivor", "to_phone", "row_id"}}; deleted: {account id: True if soft-deleted}."""
    seen, acct = {retired_id}, (latest.get(retired_id) or {}).get("survivor")
    while acct is not None and acct not in seen and acct in deleted:
        if not deleted[acct]:
            return acct
        seen.add(acct)
        acct = (latest.get(acct) or {}).get("survivor")
    return None


def repoints(latest, deleted, accounts, final_phone):
    """The earlier retired accounts a merge must re-point, as [{"retired", "from_phone", "supersedes"}] sorted by id:
    each retired account outside this merge whose history is this teacher's (its chain ends at an account of this
    merge) or whose latest row points at a number an account of this merge holds, unless that row already points at
    the survivor's final number. accounts: {id: phone_number} for this merge's accounts as they are before it."""
    held = {number_key(p) for p in accounts.values()} - {None}
    final = number_key(final_phone)
    out = []
    for rid, row in sorted(latest.items()):
        if rid in accounts:
            continue
        key = number_key(row.get("to_phone"))
        ours = current_account(latest, deleted, rid) in accounts or (key is not None and key in held)
        if ours and key != final:
            out.append({"retired": rid, "from_phone": row.get("to_phone"), "supersedes": row.get("row_id")})
    return out


def repoint_rows(survivor_final, repointed, meta=None):
    """One edit_phone row per re-pointed account, in audit_rows' shape with case 'repoint': newer than the row it
    supersedes and on the survivor's final number, so the governed mapping credits the account to the survivor again.
    Nothing moves with it."""
    out = []
    for r in repointed:
        detail = {"via": VIA, "case": REPOINT, "retired_user_id": r["retired"], "from_phone": r.get("from_phone"),
                  "to_phone": survivor_final["phone_number"], "supersedes": r.get("supersedes")}
        if r.get("why"):
            detail["why"] = r["why"]
        detail.update(meta or {})
        out.append({"action": "edit_phone", "actor_user_id": survivor_final["id"], "affected_leader_user_id": None,
                    "teacher_ext_id": survivor_final["id"], "teacher_phone_e164": survivor_final["phone_number"],
                    "teacher_name": survivor_final.get("name"), "detail": detail})
    return out


def audit_removal(pair, run_id, retired, repointed):
    """A restore's audit steps, [(sql, params, expected rowcount, label)]: this run's row for each retired account,
    then its re-point rows, each delete asserting how many rows it removes. A --repoint run retired nobody."""
    steps = []
    if retired:
        steps.append(("DELETE FROM leader_roster_audit WHERE action = 'edit_phone' AND detail->>'run_id' = %s "
                      "AND detail->>'retired_user_id' = ANY(%s)",
                      [run_id, list(retired)], len(retired), f"{pair}: this run's audit rows removed"))
    if repointed:
        steps.append(("DELETE FROM leader_roster_audit WHERE action = 'edit_phone' AND detail->>'run_id' = %s "
                      "AND detail->>'case' = 'repoint' AND detail->>'retired_user_id' = ANY(%s)",
                      [run_id, list(repointed)], len(repointed), f"{pair}: this run's re-point rows removed"))
    return steps


def repair_plan(latest, deleted, holders, phones, keys, only=None):
    """(plan, left) for --repoint: each retired account the governed mapping does not credit to its teacher's current
    account (current_account) gets a re-point row on that account's number; plan items are {"retired", "account",
    "from_phone", "supersedes", "why"}. left: [(retired id, reason)] for what the rows cannot decide.
    holders: {retired id: [live accounts on its latest to_phone's key]}, the governed join as the database runs it;
    phones: {live account id: phone_number}; keys: {number key: [live accounts with it]}; only: retired ids or None."""
    plan, left = [], []
    for rid, row in sorted(latest.items()):
        if only is not None and rid not in only:
            continue
        if deleted.get(rid) is not True:
            left.append((rid, "not a retired account"))
            continue
        acct, held = current_account(latest, deleted, rid), sorted(holders.get(rid) or [])
        if acct is None:
            left.append((rid, "the chain of merges breaks: no live account to credit"))
            continue
        if held == [acct]:
            continue
        key = number_key(phones.get(acct))
        if key is None or keys.get(key) != [acct]:
            left.append((rid, "its account's number is not held by that account alone"))
            continue
        why = ("no_number" if number_key(row.get("to_phone")) is None else "unheld" if not held
               else "held_by_other" if len(held) == 1 else "held_by_several")
        plan.append({"retired": rid, "account": acct, "from_phone": row.get("to_phone"),
                     "supersedes": row.get("row_id"), "why": why})
    return plan, left


def phone_moves(survivor_old_phone, survivor_final_phone, retired_old_phones):
    """[(from, to), ...] for booked visits, which key on the phone string: the survivor's old number and every freed
    number move to her final number."""
    out = []
    for p in [survivor_old_phone] + list(retired_old_phones):
        if p and p != survivor_final_phone and (p, survivor_final_phone) not in out:
            out.append((p, survivor_final_phone))
    return out


def plan_rows(pair, survivor_id, patch, retired_ids, moves, visits, gives_up=None, folds=(), repoints=()):
    """The ids-only plan a reviewer reads and a commit is bound to: (pair, step, table, column, row, from, to).
    No phone number or password hash appears: a patched column is named, never its value.
    visits: [(row_id, label), ...] for booked visits that follow the number, the label saying which number.
    folds: plan_folds' folds; a fold names its twin in 'to', and each row that follows it is a 'follow' row.
    repoints: repoints(); each re-pointed account is a 'repoint' row naming the survivor in 'from'."""
    rows = {(pair, "retire", "users", "", rid, "", "") for rid in retired_ids}
    rows |= {(pair, "retire", "users", col, rid, "", "") for rid, cols in (gives_up or {}).items() for col in cols}
    rows |= {(pair, "survivor", "users", col, survivor_id, "", "") for col in patch}
    rows |= {(pair, m[4], m[0], m[1], str(m[2]), m[3], survivor_id if m[4] == "move" else "") for m in moves
             if m[4] != "fold"}
    for f in folds:
        rows.add((pair, "fold", f["table"], f["column"], str(f["row"]), f["owner"], str(f["into"])))
        if f["flag"]:
            rows.add((pair, "fold", f["table"], f["flag"], str(f["row"]), "", str(f["into"])))
        rt, rc, _kc = f["follow"]
        rows |= {(pair, "follow", rt, rc, str(k), str(f["row"]), str(f["into"])) for k in f["keys"]}
    rows |= {(pair, "visits", "observation_schedules", "teacher_ext_id", str(vid), label, survivor_id)
             for vid, label in visits}
    rows |= {(pair, "audit", "leader_roster_audit", "", rid, survivor_id, "") for rid in retired_ids}
    rows |= {(pair, REPOINT, "leader_roster_audit", "", r["retired"], survivor_id, "") for r in repoints}
    return rows


def _activity(rows):
    counts = {}
    for r in rows:
        if r[1] in ACTIVITY:
            counts[tuple(r[:4])] = counts.get(tuple(r[:4]), 0) + 1
    return counts


def _instant(v):
    """A timestamp as a comparable instant (aware ones in UTC), from a datetime or an ISO string; else None."""
    from datetime import datetime, timezone
    import re
    if isinstance(v, str) and re.match(TIMESTAMP_RE, v):
        try:
            v = datetime.fromisoformat(v)
        except ValueError:
            return None
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc) if v.tzinfo else v
    return None


def same_value(a, b):
    """Equal as stored: timestamps as instants (a session's time zone changes how they print, not what they are)."""
    ia, ib = _instant(a), _instant(b)
    if ia is not None or ib is not None:
        return ia == ib
    return a == b


def restorable(live, merged):
    """(columns to put back, columns changed since the merge): a restore puts back only what still holds the value
    the merge wrote; a later edit (a password reset, a corrected name) is left and reported."""
    back = sorted(c for c, v in merged.items() if same_value(live.get(c), v))
    return back, sorted(c for c in merged if c not in back)


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
        conn.commit()  # inside the try: a deferred check that fails at commit is a failure like any other
    except Exception as e:  # noqa: BLE001 - every failure ends in an explicit rollback
        conn.rollback()
        raise SystemExit(f"ABORT (rolled back): {e}")
    return len(steps)
