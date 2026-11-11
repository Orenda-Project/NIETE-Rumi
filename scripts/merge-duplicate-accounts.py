#!/usr/bin/env python3
"""
Merge an RM-confirmed teacher's duplicate accounts into one (bd-4jlu31.8.1), the way the app's own number move does
(bot/shared/services/observe/teacher-edit-commit.service.js moveNumber). The rules live in
scripts/lib/merge_duplicates.py and are unit-tested in scripts/tests/test_merge_duplicates.py.

  DRY RUN (default; read-only):
    python3 scripts/merge-duplicate-accounts.py --target prod --env-file .env.prod --scope <scope CSV> --go 3a \\
        --out <ids-only output dir> [--private-dir ~/rumi-private/niete-dupes] [--only "t1 #12,t2 #3"]
  COMMIT (after review; prod also needs MERGE_DUPES_PROD_GO=yes, --confirm-ref and the reviewed --expect-csv):
    ... --expect-csv <the reviewed dry run's plan CSV> --commit --confirm-ref ihzciabopbttygxxgrkm
  SWEEP (move what reached a retired account after its merge: a message the bot was still answering at the commit):
    ... --sweep <the commit's before-image> --out <dir> [--commit --confirm-ref ...]
  RESTORE (undo, teacher by teacher, from a before-image; undo a sweep before the merge it followed):
    ... --restore <before-image> --out <dir> [--commit --confirm-ref ...]

Per teacher, in a transaction of its own (so a teacher's chat waits seconds at most): re-read both accounts and all
they own in one REPEATABLE READ snapshot; choose the survivor; re-check every guard and the reviewed decisions; move
every row the retired account owns, by primary key (a row stays only where a unique index already holds the
survivor's row for its key, or a sealed form keeps its observer); move booked visits with the number; retire the
duplicate (soft delete, number freed); give the survivor the number in use with its portal login and WhatsApp
session, and any fact it lacks; write one edit_phone audit row per retired account. Every write asserts its rowcount,
then the result is re-read and checked, else ROLLBACK. A serialization failure or lock timeout (the teacher chatting
at that instant) retries that teacher on a fresh snapshot, up to 3 attempts. The first teacher that cannot be merged
stops the run; teachers already committed stay committed and are listed.

Owner columns, primary keys and unique keys are read from the database's own catalog, never assumed.
--out gets the ids-only plan CSV and summary JSON (no phone number, hash or name). --private-dir gets the
before-image (phone numbers, portal hashes, booked-visit ids), mode 0600, written before the first write and updated
as each teacher commits; restore and sweep read it. No phone number is printed: database errors are masked first.
"""
import argparse
import csv
import json
import os
import re
import sys
import time
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import psycopg2
import psycopg2.extras
from psycopg2 import sql

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import merge_duplicates as md  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
TARGETS = {
    "sandbox": {"ref": "olvritwoqujtjvwfulbh", "host": "aws-0-ap-southeast-1.pooler.supabase.com"},
    "staging": {"ref": "rpqkekcfvumypldbejhp", "host": "aws-1-ap-south-1.pooler.supabase.com"},
    "prod":    {"ref": "ihzciabopbttygxxgrkm", "host": "aws-1-ap-south-1.pooler.supabase.com"},
}
USER_COLS = ("id", "phone_number", "name", "role", "school_id", "organization", "is_test_user", "deleted_at",
             "deleted_reason", "deleted_by", "registration_completed", "registration_state",
             "registration_completed_at", "registered_at", "teacher_level", "teacher_level_updated_at",
             "preferred_language", "language_locked", "portal_password_hash", "portal_activated", "portal_last_login",
             "conversation_state", "conversation_state_expires_at", "session_id", "last_message_at",
             "first_message_at", "grades_taught", "subjects_taught", "subject")
JSONB = ("conversation_state", "subjects_taught")
REVIEW = "NIETE ICT - Duplicate Teacher Accounts, RM-finalized 10 Nov 2026"
RETRYABLE = ("could not serialize access", "lock timeout", "deadlock detected")
ATTEMPTS = 3
CHUNK = 1000
AUDIT_COUNT = ("SELECT count(*) AS n FROM leader_roster_audit WHERE action = 'edit_phone' "
               "AND detail->>'run_id' = %s AND detail->>'retired_user_id' = ANY(%s)")


def read_env(path):
    env = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        env[k.strip()] = v
    return env


def ref_of(env):
    m = re.search(r"postgres\.([a-z0-9]{20})[:@]", env.get("DATABASE_URL", ""))
    if m:
        return m.group(1)
    m = re.match(r"https://([a-z0-9]+)\.supabase\.co", env.get("SUPABASE_URL", ""))
    return m.group(1) if m else None


def connect(env, target, writable):
    want, have = TARGETS[target]["ref"], ref_of(env)
    if have != want:
        raise SystemExit(f"ABORT: env points at '{have}' but --target {target} expects '{want}'.")
    if env.get("DATABASE_URL"):
        conn = psycopg2.connect(env["DATABASE_URL"], cursor_factory=psycopg2.extras.RealDictCursor)
    else:
        conn = psycopg2.connect(host=TARGETS[target]["host"], port=5432, user=f"postgres.{want}",
                                password=env["SUPABASE_DB_PASSWORD"], dbname="postgres",
                                cursor_factory=psycopg2.extras.RealDictCursor)
    conn.set_session(isolation_level="REPEATABLE READ", readonly=not writable, autocommit=False)
    return conn


def masked(msg):
    """A database error fit to print: its DETAIL and CONTEXT lines (they quote row values) dropped, digits masked."""
    lines = [ln for ln in str(msg).splitlines() if not ln.strip().startswith(("DETAIL:", "CONTEXT:"))]
    return re.sub(r"\d{7,}", "<number>", " ".join(lines))


def ident(name):
    """A table name from the catalog (regclass text: bare in public, schema-qualified elsewhere)."""
    return sql.Identifier(*name.split("."))


def raw(text):
    """Catalog SQL (an index expression or predicate) placed into a query that also takes %s parameters."""
    return sql.SQL(text.replace("%", "%%"))


def jsonable(v):
    return v.isoformat() if isinstance(v, (datetime, date)) else v


def db_value(col, v):
    return psycopg2.extras.Json(v) if col in JSONB and v is not None else v


# ── reads ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def read_catalog(cur):
    """(fks, keys, refs). fks: {(table, owner column): (pk column, pk type) or None} for every foreign key onto
    users.id. keys: {(table, owner column): [unique index, ...]} for every unique index (not the primary key) that
    includes an owner column, with the SQL the owned-rows read selects for its other key columns and its partial
    predicate. refs: {table: [(referencing table, column)]}, the single-column foreign keys onto each owner table's
    primary key: what would be left hanging from a row that stays behind."""
    cur.execute("""
        SELECT con.conrelid::regclass::text AS tbl, cardinality(con.conkey) AS n,
               (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attnum = con.conkey[1]) AS col,
               (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = con.confrelid AND a.attnum = con.confkey[1]) AS ref,
               (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod))
                  FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                 WHERE i.indrelid = con.conrelid AND i.indisprimary) AS pk
        FROM pg_constraint con WHERE con.contype = 'f' AND con.confrelid = 'public.users'::regclass ORDER BY 1, 3""")
    fks = {}
    for r in cur.fetchall():
        if r["n"] != 1 or r["ref"] != "id":
            raise SystemExit(f"ABORT: {r['tbl']} references users.{r['ref']} through {r['n']} column(s); this tool "
                             "moves single-column references to users.id only.")
        pk = r["pk"] or []
        fks[(r["tbl"], r["col"])] = tuple(pk[0].split(":", 1)) if len(pk) == 1 else None
    cur.execute("""
        SELECT i.indexrelid::regclass::text AS idx, i.indrelid::regclass::text AS tbl,
               pg_get_expr(i.indpred, i.indrelid) AS pred, NOT i.indnullsnotdistinct AS nulls_distinct,
               array_agg(coalesce(a.attname, '') ORDER BY k.ord) AS cols,
               array_agg(pg_get_indexdef(i.indexrelid, k.ord::int, true) ORDER BY k.ord) AS defs
        FROM pg_index i
        CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
        LEFT JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum AND k.attnum > 0
        WHERE i.indisunique AND NOT i.indisprimary AND i.indrelid::regclass::text = ANY(%s)
          AND k.ord <= i.indnkeyatts
        GROUP BY 1, 2, 3, 4 ORDER BY 1""", (sorted({t for t, _ in fks}),))
    owners = {}
    for t, c in fks:
        owners.setdefault(t, []).append(c)
    keys, n = {}, 0
    for r in cur.fetchall():
        for c in owners.get(r["tbl"], ()):
            if c not in r["cols"]:
                if any(not col and re.search(rf"\b{re.escape(c)}\b", d) for col, d in zip(r["cols"], r["defs"])):
                    raise SystemExit(f"ABORT: unique index {r['idx']} uses {r['tbl']}.{c} inside an expression; "
                                     "this tool cannot plan that key.")
                continue
            n += 1
            others = [d for col, d in zip(r["cols"], r["defs"]) if col != c]
            keys.setdefault((r["tbl"], c), []).append(
                {"name": r["idx"], "cols": tuple(f"_k{n}_{j}" for j in range(len(others))), "exprs": tuple(others),
                 "in": f"_in{n}" if r["pred"] else None, "pred": r["pred"], "nulls_distinct": r["nulls_distinct"]})
    pk_of = {t: pk[0] for (t, _c), pk in fks.items() if pk}
    cur.execute("""
        SELECT con.confrelid::regclass::text AS t, con.conrelid::regclass::text AS rt,
               (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attnum = con.conkey[1]) AS rc,
               (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = con.confrelid AND a.attnum = con.confkey[1]) AS col
        FROM pg_constraint con WHERE con.contype = 'f' AND cardinality(con.conkey) = 1
          AND con.confrelid::regclass::text = ANY(%s) ORDER BY 1, 2, 3""", (sorted(pk_of),))
    refs = {}
    for r in cur.fetchall():
        if r["col"] == pk_of[r["t"]]:
            refs.setdefault(r["t"], []).append((r["rt"], r["rc"]))
    return fks, keys, refs


def load_users(cur, ids):
    cols = sql.SQL(", ").join(
        sql.SQL("{}::text AS {}").format(sql.Identifier(c), sql.Identifier(c)) if c in ("id", "school_id")
        else sql.Identifier(c) for c in USER_COLS)
    cur.execute(sql.SQL("SELECT {} FROM users WHERE id = ANY(%s::uuid[])").format(cols), (list(ids),))
    return {r["id"]: dict(r) for r in cur.fetchall()}


def identity_counts(cur, fks, ids):
    """Identity-bearing rows per account, in one round trip."""
    out = {i: 0 for i in ids}
    tables = [t for t in md.IDENTITY_TABLES if (t, "user_id") in fks]
    if tables:
        cur.execute(sql.SQL(" UNION ALL ").join(
            sql.SQL("SELECT user_id::text AS u FROM {} WHERE user_id = ANY(%(ids)s::uuid[])").format(ident(t))
            for t in tables), {"ids": list(ids)})
        for r in cur.fetchall():
            out[r["u"]] += 1
    return out


def owned_rows(cur, fks, keys, ids):
    """{(table, owner column): [{"id", "owner", "frozen"?, <key aliases>...}, ...]} for every row the accounts own,
    read in ONE round trip (a query per table costs ~0.2 s each over the pooler, and the snapshot this read opens is
    the one the writes must land in). Key values come back through jsonb: compared only with each other."""
    branches = []
    for (t, c), pk in sorted(fks.items()):
        k = []
        for ix in keys.get((t, c), ()):
            for e, alias in zip(ix["exprs"], ix["cols"]):
                k += [sql.Literal(alias), sql.SQL("({})").format(raw(e))]
            if ix["in"]:
                k += [sql.Literal(ix["in"]), sql.SQL("coalesce(({}), false)").format(raw(ix["pred"]))]
        if (t, c) in md.FROZEN:
            k += [sql.Literal("frozen"), sql.SQL("coalesce(({}), false)").format(raw(md.FROZEN[(t, c)]))]
        branches.append(sql.SQL(
            "SELECT {tl}::text AS t, {cl}::text AS c, {pk} AS id, {c}::text AS owner, jsonb_build_object({k}) AS k "
            "FROM {t} WHERE {c} = ANY(%(ids)s::uuid[])").format(
                tl=sql.Literal(t), cl=sql.Literal(c), c=sql.Identifier(c), t=ident(t), k=sql.SQL(", ").join(k),
                pk=sql.SQL("{}::text").format(sql.Identifier(pk[0])) if pk else sql.SQL("NULL::text")))
    cur.execute(sql.SQL(" UNION ALL ").join(branches), {"ids": list(ids)})
    owned = {}
    for r in cur.fetchall():
        owned.setdefault((r["t"], r["c"]), []).append({"id": r["id"], "owner": r["owner"], **r["k"]})
    for (t, c), rows in owned.items():
        if fks[(t, c)] is None and (t, c) not in md.NEVER_MOVE:
            raise SystemExit(f"ABORT: {t} has no single-column primary key and the accounts own {len(rows)} of its "
                             "rows; this tool moves rows by primary key.")
    return owned


def load_visits(cur, ids):
    """The booked visits on the accounts' own numbers, matched on the server so no phone number goes into a query."""
    cur.execute("SELECT id::text AS id, teacher_ext_id, status, leader_user_id::text AS leader_user_id, school_ext_id "
                "FROM observation_schedules WHERE teacher_ext_id IN "
                "(SELECT phone_number FROM users WHERE id = ANY(%s::uuid[]))", (list(ids),))
    return [dict(r) for r in cur.fetchall()]


def read_state(cur, ids, fks, keys):
    return {"users": load_users(cur, ids), "ident": identity_counts(cur, fks, ids),
            "owned": owned_rows(cur, fks, keys, ids), "visits": load_visits(cur, ids)}


def stranded_rows(conn, moves, fks, refs):
    """[(table, row_id, {"ref_table.col": n})] for rows that would stay behind (a frozen form excepted) while other
    rows depend on them, counted in the caller's open snapshot, in one round trip."""
    skipped = {}
    for (t, c, row, _owner, action) in moves:
        if action == "skip" and (t, c) not in md.FROZEN:
            skipped.setdefault(t, (fks[(t, c)], set()))[1].add(row)
    branches, params = [], {}
    for i, (t, (pk, rows)) in enumerate(sorted(skipped.items())):
        params[f"p{i}"] = sorted(rows)
        for rt, rc in refs.get(t, ()):
            branches.append(sql.SQL(
                "SELECT {t}::text AS t, {ref}::text AS ref, {rc}::text AS id, count(*) AS n FROM {rt} "
                "WHERE {rc} = ANY(%({p})s::{ty}[]) GROUP BY 3").format(
                    t=sql.Literal(t), ref=sql.Literal(f"{rt}.{rc}"), rc=sql.Identifier(rc), rt=ident(rt),
                    p=sql.SQL(f"p{i}"), ty=sql.SQL(pk[1])))
    if not branches:
        return []
    with conn.cursor() as cur:
        cur.execute(sql.SQL(" UNION ALL ").join(branches), params)
        found = {}
        for r in cur.fetchall():
            found.setdefault((r["t"], r["id"]), {})[r["ref"]] = r["n"]
    return [(t, rid, counts) for (t, rid), counts in sorted(found.items())]


# ── plans ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def plan_pair(state, p, keys, run_id, now_iso, dependents=lambda moves: []):
    """Everything one teacher's merge would do, from one snapshot. An empty 'problems' means it may run.
    dependents(moves): the stranded rows of the plan, read in the same snapshot."""
    pids = [p["survivor"]] + p["retired"]
    rows = {i: state["users"].get(i) for i in pids}
    if any(v is None for v in rows.values()):
        return {**p, "problems": ["an account was not found"]}
    surv = md.choose_survivor([{"id": i, "identity_rows": state["ident"].get(i, 0)} for i in pids], p["in_use"])
    retired = [i for i in pids if i != surv]
    owned = {k: [r for r in v if r["owner"] in pids] for k, v in state["owned"].items()}
    moves = md.plan_moves({k: v for k, v in owned.items() if v}, surv, retired, keys)
    patch = md.survivor_patch(rows[surv], [rows[r] for r in retired], p["in_use"])
    final_phone = patch.get("phone_number", rows[surv]["phone_number"])
    numbers = md.phone_moves(rows[surv]["phone_number"], final_phone, [rows[r]["phone_number"] for r in retired])
    visits, clashes = md.plan_visits(state["visits"], numbers)
    problems = md.guards(rows, surv, retired, p["in_use"], p["survivor"], moves, clashes, dependents(moves))
    moved, skipped = {r: {} for r in retired}, {r: {} for r in retired}
    for (t, _c, _row, owner, action) in moves:
        bucket = moved if action == "move" else skipped
        bucket[owner][t] = bucket[owner].get(t, 0) + 1
    audits = md.audit_rows(dict(rows[surv], **patch), rows[surv]["phone_number"], [rows[r] for r in retired],
                           moved, skipped, meta={"run_id": run_id, "review": REVIEW, "sheet_row": p["pair"]})
    label = {f: "survivor's old number" if f == rows[surv]["phone_number"] else "a freed number" for f, _ in numbers}
    return {**p, "survivor": surv, "retired": retired, "problems": problems, "patch": patch,
            "final_phone": final_phone, "moves": moves, "moved": moved, "skipped": skipped,
            "visits": [{"row_id": v, "from_phone": f, "to_phone": t} for v, f, t in visits],
            "retire": {r: md.retire_patch(r, now_iso) for r in retired}, "audits": audits,
            "before": {i: rows[i] for i in pids},
            "plan_rows": md.plan_rows(p["pair"], surv, patch, retired, moves, [(v, label[f]) for v, f, _ in visits])}


def _set_users(cols, extra=""):
    sets = sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(c)) for c in cols)
    return sql.SQL("UPDATE users SET {} WHERE id = %s " + extra).format(sets)


def _move_steps(pair, groups, fks, to_of, guard_of, label):
    """One UPDATE per group and chunk of at most CHUNK rows: by primary key, and only while the row is still owned by
    the expected account. groups: {(table, column, ...): [row ids]}."""
    steps = []
    for key, rows in sorted(groups.items()):
        t, c = key[0], key[1]
        pk_name, pk_type = fks[(t, c)]
        q = sql.SQL("UPDATE {t} SET {c} = %s WHERE {pk} = ANY(%s::{ty}[]) AND {c} = ANY(%s::uuid[])").format(
            t=ident(t), c=sql.Identifier(c), pk=sql.Identifier(pk_name), ty=sql.SQL(pk_type))
        for i in range(0, len(rows), CHUNK):
            chunk = rows[i:i + CHUNK]
            steps.append((q, [to_of(key), chunk, guard_of(key)], len(chunk), f"{pair}: {label} {t}.{c}"))
    return steps


def merge_steps(pp, fks):
    """Rows first (so the users rows are locked last, and briefly), then visits, retire, survivor, audit."""
    pair, surv, retired = pp["pair"], pp["survivor"], pp["retired"]
    groups = {}
    for (t, c, row, _owner, action) in pp["moves"]:
        if action == "move":
            groups.setdefault((t, c), []).append(row)
    steps = _move_steps(pair, groups, fks, lambda k: surv, lambda k: retired, "move")
    by_number = {}
    for v in pp.get("visits", []):
        by_number.setdefault((v["from_phone"], v["to_phone"]), []).append(v["row_id"])
    for (f, to), rows in by_number.items():
        steps.append(("UPDATE observation_schedules SET teacher_ext_id = %s WHERE id = ANY(%s::uuid[]) "
                      "AND teacher_ext_id = %s", [to, rows, f], len(rows), f"{pair}: booked visits follow the number"))
    for r, rp in pp.get("retire", {}).items():
        steps.append((_set_users(rp, "AND deleted_at IS NULL"), list(rp.values()) + [r], 1, f"{pair}: retire {r}"))
    if pp.get("patch"):
        steps.append((_set_users(pp["patch"], "AND deleted_at IS NULL"),
                      [db_value(c, v) for c, v in pp["patch"].items()] + [surv], 1,
                      f"{pair}: the survivor takes {', '.join(sorted(pp['patch']))}"))
    for a in pp.get("audits", []):
        steps.append(("INSERT INTO leader_roster_audit (action, actor_user_id, affected_leader_user_id, "
                      "teacher_ext_id, teacher_phone_e164, teacher_name, detail) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                      [a["action"], a["actor_user_id"], a["affected_leader_user_id"], a["teacher_ext_id"],
                       a["teacher_phone_e164"], a["teacher_name"], psycopg2.extras.Json(a["detail"])], 1,
                      f"{pair}: audit row for {a['detail']['retired_user_id']}"))
    return steps


def residue(cur, pp):
    """Problems where a table the plan touched keeps another number of rows on the retired accounts than planned
    (one round trip: it runs while the users rows are locked)."""
    left = {}
    for (t, c, _row, _owner, action) in pp["moves"]:
        left[(t, c)] = left.get((t, c), 0) + (action == "skip")
    if not left:
        return []
    cur.execute(sql.SQL(" UNION ALL ").join(
        sql.SQL("SELECT {tl}::text AS t, {cl}::text AS c, count(*) AS n FROM {t} WHERE {c} = ANY(%(ids)s::uuid[])")
        .format(tl=sql.Literal(t), cl=sql.Literal(c), t=ident(t), c=sql.Identifier(c)) for (t, c) in sorted(left)),
        {"ids": pp["retired"]})
    return [f"{pp['pair']}: {r['t']}.{r['c']} keeps {r['n']} rows on the retired account(s), "
            f"{left[(r['t'], r['c'])]} planned" for r in cur.fetchall() if r["n"] != left[(r["t"], r["c"])]]


def merge_verify(conn, pp, run_id):
    def check():
        pair, problems = pp["pair"], []
        with conn.cursor() as cur:
            now = load_users(cur, [pp["survivor"]] + pp["retired"])
            s = now[pp["survivor"]]
            if s["deleted_at"] or s["phone_number"] != pp["final_phone"]:
                problems.append(f"{pair}: the survivor is not live on the planned number")
            off = sorted(c for c, v in pp["patch"].items() if s.get(c) != v)
            if off:
                problems.append(f"{pair}: survivor columns not as planned: {', '.join(off)}")
            for r in pp["retired"]:
                x = now[r]
                if not x["deleted_at"] or x["phone_number"] != f"merged:{r}" or x["deleted_reason"] != md.REASON:
                    problems.append(f"{pair}: {r} is not retired as planned")
            problems += residue(cur, pp)
            if pp["visits"]:
                cur.execute("SELECT count(*) AS n FROM observation_schedules WHERE id = ANY(%s::uuid[]) "
                            "AND teacher_ext_id = (SELECT phone_number FROM users WHERE id = %s)",
                            ([v["row_id"] for v in pp["visits"]], pp["survivor"]))
                if cur.fetchone()["n"] != len(pp["visits"]):
                    problems.append(f"{pair}: booked visits did not follow the number")
            cur.execute(AUDIT_COUNT, (run_id, pp["retired"]))
            if cur.fetchone()["n"] != len(pp["retired"]):
                problems.append(f"{pair}: the audit rows are not as planned")
        return problems
    return check


def merged_state(cur, e, run_id):
    """'merged' when the live rows show this run's merge of the pair, 'untouched' when they show none of it, else
    'partial' (left for a human)."""
    now = load_users(cur, [e["survivor"]] + e["retired"])
    cur.execute(AUDIT_COUNT, (run_id, e["retired"]))
    audits = cur.fetchone()["n"]
    mine = [r for r in e["retired"] if now.get(r) and now[r]["deleted_reason"] == md.REASON
            and now[r]["phone_number"] == f"merged:{r}"]
    s = now.get(e["survivor"])
    if s and s["phone_number"] == e["final_phone"] and len(mine) == len(e["retired"]) and audits == len(mine):
        return "merged"
    return "untouched" if not mine and not audits else "partial"


def restore_steps(e, run_id, fks):
    """The merge undone in the order that keeps phone_number unique: the survivor gives the number back first."""
    pair, surv, steps = e["pair"], e["survivor"], []
    if e["kind"] == "merge":
        cols = sorted(e["patch"])
        if cols:
            steps.append((_set_users(cols), [db_value(c, e["before"][surv].get(c)) for c in cols] + [surv], 1,
                          f"{pair}: the survivor as it was"))
        for r in e["retired"]:
            b = e["before"][r]
            steps.append(("UPDATE users SET deleted_at = %s, deleted_reason = %s, deleted_by = %s, phone_number = %s "
                          "WHERE id = %s AND deleted_reason = %s",
                          [b.get("deleted_at"), b.get("deleted_reason"), b.get("deleted_by"), b["phone_number"], r,
                           md.REASON], 1, f"{pair}: {r} as it was"))
        by_number = {}
        for v in e["visits"]:
            by_number.setdefault((v["from_phone"], v["to_phone"]), []).append(v["row_id"])
        for (f, to), rows in by_number.items():
            steps.append(("UPDATE observation_schedules SET teacher_ext_id = %s WHERE id = ANY(%s::uuid[]) "
                          "AND teacher_ext_id = %s", [f, rows, to], len(rows), f"{pair}: booked visits back"))
    groups = {}
    for (t, c, row, owner, action) in e["moves"]:
        if action == "move":
            groups.setdefault((t, c, owner), []).append(row)
    steps += _move_steps(pair, groups, fks, lambda k: k[2], lambda k: [surv], "back")
    if e["kind"] == "merge":
        steps.append(("DELETE FROM leader_roster_audit WHERE action = 'edit_phone' AND detail->>'run_id' = %s "
                      "AND detail->>'retired_user_id' = ANY(%s)", [run_id, e["retired"]], len(e["retired"]),
                      f"{pair}: this run's audit rows removed"))
    return steps


def restore_verify(conn, e, run_id):
    def check():
        problems = []
        if e["kind"] != "merge":
            return problems
        with conn.cursor() as cur:
            now = load_users(cur, list(e["before"]))
            for i, b in e["before"].items():
                cols = ["phone_number", "deleted_at"] + (sorted(e["patch"]) if i == e["survivor"] else [])
                off = [c for c in cols if jsonable(now[i].get(c)) != b.get(c)]
                if off:
                    problems.append(f"{e['pair']}: {i} is not as it was: {', '.join(off)}")
            cur.execute(AUDIT_COUNT, (run_id, e["retired"]))
            if cur.fetchone()["n"]:
                problems.append(f"{e['pair']}: this run's audit rows remain")
        return problems
    return check


# ── files ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def write_private(path, payload):
    """A before-image: phone numbers and portal hashes, so mode 0600 in a 0700 folder, replaced atomically."""
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(payload, f, indent=1, default=jsonable)
    os.replace(tmp, path)


def set_entry(image, pp, status, kind="merge"):
    entry = {"pair": pp["pair"], "kind": kind, "status": status, "survivor": pp["survivor"],
             "retired": pp["retired"], "patch": pp.get("patch", {}), "final_phone": pp.get("final_phone"),
             "before": pp.get("before", {}), "visits": pp.get("visits", []), "moves": pp.get("moves", [])}
    image["pairs"] = [e for e in image["pairs"] if e["pair"] != pp["pair"]] + [entry]
    return entry


def load_image(path, target, kind):
    image = json.loads(Path(path).read_text())
    if image.get("target") != target:
        raise SystemExit(f"ABORT: the before-image is for {image.get('target')}, not {target}.")
    if kind and image.get("kind") != kind:
        raise SystemExit(f"ABORT: the before-image is a {image.get('kind')}, not a {kind}.")
    for e in image["pairs"]:
        e.setdefault("kind", image.get("kind", "merge"))
    return image


def table_counts(moves, action):
    out = {}
    for m in moves:
        if m[4] == action:
            out[m[0]] = out.get(m[0], 0) + 1
    return out


def show(counts):
    return ", ".join(f"{t} {n}" for t, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))) or "-"


def apply(conn, steps, verify):
    """md.apply_plan, with any database error masked before it is printed."""
    try:
        return md.apply_plan(conn, steps, verify)
    except SystemExit as e:
        raise SystemExit(masked(e)) from None


# ── modes ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def load_scope(a):
    pairs = []
    with open(a.scope, newline="") as f:
        for r in csv.DictReader(f):
            if r["go"] == a.go:
                pairs.append({"pair": f"t{r['tab']} #{r['sheet_no']}", "class": r.get("class", ""),
                              "survivor": r["survivor_id"], "retired": [x for x in r["retire_ids"].split(";") if x],
                              "in_use": r["number_in_use_account_id"]})
    if a.only:
        wanted = {x.strip() for x in a.only.split(",") if x.strip()}
        unknown = wanted - {p["pair"] for p in pairs}
        if unknown:
            raise SystemExit(f"ABORT: --only names teachers who are not in go {a.go}: {sorted(unknown)}")
        pairs = [p for p in pairs if p["pair"] in wanted]
    if not pairs:
        raise SystemExit(f"ABORT: no teachers for go {a.go!r} in the scope.")
    seen = {}
    for p in pairs:
        for i in [p["survivor"]] + p["retired"]:
            if i in seen:
                raise SystemExit(f"ABORT: account {i} is in both {seen[i]} and {p['pair']}.")
            seen[i] = p["pair"]
    return pairs


def run_merge(a, conn, out, stamp, fks, keys, refs):
    pairs = load_scope(a)
    expected = None
    if a.expect_csv:
        with open(a.expect_csv, newline="") as f:
            expected = {tuple(r) for r in list(csv.reader(f))[1:]}
    run_id = f"merge-duplicates-{a.target}-{a.go}-{uuid.uuid4().hex[:8]}"
    base = f"{a.target}-{a.go}-{stamp}-{'commit' if a.commit else 'dryrun'}"
    with conn.cursor() as cur:
        state = read_state(cur, sorted({i for p in pairs for i in [p["survivor"]] + p["retired"]}), fks, keys)
    dependents = lambda mv: stranded_rows(conn, mv, fks, refs)  # noqa: E731 - same snapshot as the read
    planned = [plan_pair(state, p, keys, run_id, datetime.now(timezone.utc).isoformat(), dependents) for p in pairs]
    conn.rollback()

    plan_rows = set().union(*(pp.get("plan_rows", set()) for pp in planned))
    with open(out / f"merge-plan-{base}.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["pair", "step", "table", "column", "row", "from", "to"])
        w.writerows(sorted(plan_rows))
    summary = {"run_id": run_id, "target": a.target, "go": a.go, "dry_run": not a.commit, "written_at": stamp,
               "teachers": len(planned), "pairs": [
                   {"pair": pp["pair"], "class": pp.get("class"), "survivor": pp.get("survivor"),
                    "retired": pp.get("retired"), "takes_the_number": "phone_number" in pp.get("patch", {}),
                    "survivor_columns": sorted(pp.get("patch", {})), "moved": pp.get("moved"),
                    "stays_behind": pp.get("skipped"), "visits_follow": len(pp.get("visits", [])),
                    "problems": pp["problems"]} for pp in planned]}
    (out / f"merge-summary-{base}.json").write_text(json.dumps(summary, indent=2))
    image_path = Path(a.private_dir) / a.target / f"merge-before-{base}.json"
    image = {"run_id": run_id, "target": a.target, "go": a.go, "kind": "merge", "pairs": []}
    for pp in planned:
        if "patch" in pp:
            set_entry(image, pp, "planned")
    write_private(image_path, image)

    moves = [m for pp in planned for m in pp.get("moves", [])]
    print(f"[{a.target}] go {a.go}: teachers={len(planned)} "
          f"retire={sum(len(pp.get('retired', [])) for pp in planned)} "
          f"rows_to_move={sum(table_counts(moves, 'move').values())} "
          f"rows_staying={sum(table_counts(moves, 'skip').values())} run_id={run_id}")
    for pp in planned:
        print(f"  {pp['pair']:8s} {pp.get('class', ''):14s} takes the number: "
              f"{'yes' if 'phone_number' in pp.get('patch', {}) else 'no ':3s}  columns: {len(pp.get('patch', {})):2d}  "
              f"visits: {len(pp.get('visits', []))}  moves: {show(table_counts(pp.get('moves', []), 'move'))}  "
              f"stays: {show(table_counts(pp.get('moves', []), 'skip'))}"
              + (f"  REFUSED: {'; '.join(pp['problems'])}" if pp["problems"] else ""))
    print(f"  outputs: {out / f'merge-plan-{base}.csv'} (+ summary JSON); before-image: {image_path} (private)")
    if any(pp["problems"] for pp in planned):
        raise SystemExit("ABORT: a guard refused at least one teacher; nothing written.")
    if expected is not None:
        if {r[0] for r in expected} != {pp["pair"] for pp in planned}:
            raise SystemExit("ABORT: the reviewed plan covers other teachers than this run; nothing written.")
        ok, missing, extra, drift = md.check_plan_matches(expected, plan_rows)
        for k, (was, now) in drift.items():
            print(f"  since the review: {k[0]} {k[1]} {k[2]}.{k[3]}: {was} -> {now}")
        if not ok:
            raise SystemExit(f"ABORT: the decisions differ from the reviewed dry run ({len(missing)} reviewed no "
                             f"longer planned, {len(extra)} planned never reviewed); nothing written. Run a fresh "
                             "dry run, review it, retry with it.")
        print(f"the decisions match the reviewed dry run ({len(expected)} rows reviewed)")
    if not a.commit:
        print("DRY RUN — nothing written.")
        return

    reviewed_rows = expected if expected is not None else plan_rows
    results, stopped = [], None
    for p in pairs:
        reviewed = {r for r in reviewed_rows if r[0] == p["pair"]}
        for attempt in range(1, ATTEMPTS + 1):
            conn.rollback()
            with conn.cursor() as cur:
                state = read_state(cur, [p["survivor"]] + p["retired"], fks, keys)
            pp = plan_pair(state, p, keys, run_id, datetime.now(timezone.utc).isoformat(), dependents)
            if pp["problems"]:
                stopped = {"pair": p["pair"], "status": "refused", "why": pp["problems"]}
                break
            ok, missing, extra, drift = md.check_plan_matches(reviewed, pp["plan_rows"])
            if not ok:
                stopped = {"pair": p["pair"], "status": "refused",
                           "why": [f"decisions changed since the review: {len(missing)} gone, {len(extra)} new"]}
                break
            set_entry(image, pp, "writing")
            write_private(image_path, image)
            try:
                n = apply(conn, merge_steps(pp, fks), merge_verify(conn, pp, run_id))
            except SystemExit as e:
                retry = attempt < ATTEMPTS and any(s in str(e) for s in RETRYABLE)
                set_entry(image, pp, "retrying" if retry else "rolled back")
                write_private(image_path, image)
                print(f"  {p['pair']}: attempt {attempt} rolled back: {e}")
                if retry:
                    time.sleep(2 * attempt)
                    continue
                stopped = {"pair": p["pair"], "status": "rolled back", "why": [str(e)]}
                break
            set_entry(image, pp, "committed")
            write_private(image_path, image)
            results.append({"pair": p["pair"], "status": "committed", "attempts": attempt, "steps": n,
                            "since_review": {" ".join(k[1:]): v for k, v in drift.items()}})
            print(f"  {p['pair']}: COMMITTED ({n} steps, attempt {attempt})")
            break
        if stopped:
            conn.rollback()
            results.append(stopped)
            print(f"  {p['pair']}: STOPPED — {'; '.join(stopped['why'])}")
            break
    done = [r["pair"] for r in results if r["status"] == "committed"]
    (out / f"merge-commit-{base}.json").write_text(json.dumps(
        {"run_id": run_id, "target": a.target, "go": a.go, "committed": done, "results": results,
         "before_image": str(image_path)}, indent=2))
    print(f"committed {len(done)} of {len(pairs)} teachers (run_id {run_id}).")
    print("rows that reached a retired account during the run (each should be '-'):")
    sweep(conn, image, fks, keys, refs, commit=False, out=None, private_dir=None, stamp=stamp)
    print(f"undo: --restore {image_path} · stragglers later: --sweep {image_path}")
    if stopped:
        raise SystemExit("STOPPED before every teacher was merged; the teachers above stay committed.")


def sweep(conn, image, fks, keys, refs, commit, out, private_dir, stamp):
    """Move what reached a retired account after its merge. Its own before-image makes it restorable."""
    sweep_image = {"run_id": f"{image['run_id']}-sweep-{uuid.uuid4().hex[:6]}", "of": image["run_id"],
                   "target": image["target"], "kind": "sweep", "pairs": []}
    path = Path(private_dir) / image["target"] / f"merge-sweep-{stamp}.json" if commit else None
    results = []
    for e in image["pairs"]:
        if e.get("status") not in ("committed", "writing"):
            continue
        conn.rollback()
        with conn.cursor() as cur:
            ids = [e["survivor"]] + e["retired"]
            users = load_users(cur, ids)
            owned = owned_rows(cur, fks, keys, ids)
        moves = md.plan_moves(owned, e["survivor"], e["retired"], keys)
        problems = md.sweep_guards(users, e["survivor"], e["retired"], moves, stranded_rows(conn, moves, fks, refs))
        todo = table_counts(moves, "move")
        results.append({"pair": e["pair"], "to_move": todo, "problems": problems})
        print(f"  {e['pair']:8s} to move: {show(todo)}" + (f"  REFUSED: {'; '.join(problems)}" if problems else ""))
        if problems or not todo or not commit:
            conn.rollback()
            continue
        pp = {"pair": e["pair"], "survivor": e["survivor"], "retired": e["retired"], "moves": moves}
        entry = set_entry(sweep_image, pp, "writing", kind="sweep")
        write_private(path, sweep_image)
        n = apply(conn, merge_steps(pp, fks), lambda: residue_check(conn, pp))
        entry["status"] = "committed"
        write_private(path, sweep_image)
        print(f"  {e['pair']}: swept ({n} steps)")
    if out is not None:
        (out / f"merge-sweep-{image['target']}-{stamp}{'-commit' if commit else '-dryrun'}.json").write_text(
            json.dumps({"of": image["run_id"], "sweep_run_id": sweep_image["run_id"], "results": results,
                        "before_image": str(path) if path else None}, indent=2))
    conn.rollback()
    return results


def residue_check(conn, pp):
    with conn.cursor() as cur:
        return residue(cur, pp)


def run_sweep(a, conn, out, stamp, fks, keys, refs):
    image = load_image(a.sweep, a.target, kind="merge")
    print(f"[{a.target}] sweep of {image['run_id']}{'' if a.commit else ' (dry run)'}:")
    sweep(conn, image, fks, keys, refs, commit=a.commit, out=out, private_dir=a.private_dir, stamp=stamp)
    if not a.commit:
        print("DRY RUN — nothing written.")


def run_restore(a, conn, out, stamp, fks):
    image = load_image(a.restore, a.target, kind=None)
    run_id = image["run_id"] if image["kind"] == "merge" else image["of"]
    print(f"[{a.target}] restore of {image['run_id']} ({image['kind']}){'' if a.commit else ' (dry run)'}:")
    results = []
    for e in reversed(image["pairs"]):
        if e.get("status") not in ("committed", "writing"):
            continue
        conn.rollback()
        if e["kind"] == "merge":
            with conn.cursor() as cur:
                live = merged_state(cur, e, run_id)
            if live != "merged":
                results.append({"pair": e["pair"], "status": live})
                print(f"  {e['pair']}: {live} — {'nothing to undo' if live == 'untouched' else 'left for a human'}")
                continue
        steps = restore_steps(e, run_id, fks)
        if not a.commit:
            results.append({"pair": e["pair"], "status": "would restore", "steps": len(steps)})
            print(f"  {e['pair']}: would restore ({len(steps)} steps)")
            continue
        n = apply(conn, steps, restore_verify(conn, e, run_id))
        results.append({"pair": e["pair"], "status": "restored", "steps": n})
        print(f"  {e['pair']}: RESTORED ({n} steps)")
    conn.rollback()
    (out / f"merge-restore-{a.target}-{stamp}{'-commit' if a.commit else '-dryrun'}.json").write_text(
        json.dumps({"restored": image["run_id"], "kind": image["kind"], "results": results}, indent=2))
    if not a.commit:
        print("DRY RUN — nothing written.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", required=True, choices=sorted(TARGETS))
    ap.add_argument("--env-file", default=str(REPO / ".env"))
    ap.add_argument("--scope", help="the reviewed scope CSV (go, tab, sheet_no, class, survivor_id, retire_ids, "
                    "number_in_use_account_id, ...)")
    ap.add_argument("--go", help="which go of the scope to run, e.g. 3a")
    ap.add_argument("--only", help="comma-separated teachers of that go, as 't1 #12'")
    ap.add_argument("--sweep", help="a merge's before-image: move what reached its retired accounts since")
    ap.add_argument("--restore", help="a merge's or a sweep's before-image: undo it")
    ap.add_argument("--out", required=True, help="directory for the ids-only plan CSV and summary JSON")
    ap.add_argument("--private-dir", default=str(Path.home() / "rumi-private" / "niete-dupes"),
                    help="directory for before-images (phone numbers, portal hashes), mode 0700/0600")
    ap.add_argument("--expect-csv", help="the reviewed dry run's plan CSV; required for a prod merge")
    ap.add_argument("--commit", action="store_true", help="write; default is a read-only dry run")
    ap.add_argument("--confirm-ref", help="with --commit on prod: the prod project ref, typed out")
    a = ap.parse_args()

    modes = [m for m in ("scope", "sweep", "restore") if getattr(a, m)]
    if len(modes) != 1 or (a.scope and not a.go):
        raise SystemExit("ABORT: give exactly one of --scope with --go, --sweep <image> or --restore <image>.")
    if a.commit and a.target == "prod" and (a.confirm_ref != TARGETS["prod"]["ref"]
                                            or os.environ.get("MERGE_DUPES_PROD_GO") != "yes"
                                            or (a.scope and not a.expect_csv)):
        raise SystemExit("ABORT: a prod write needs --confirm-ref <prod ref>, MERGE_DUPES_PROD_GO=yes and, for a "
                         "merge, the reviewed --expect-csv.")
    conn = connect(read_env(a.env_file), a.target, writable=a.commit)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    with conn.cursor() as cur:
        fks, keys, refs = read_catalog(cur)
    conn.rollback()
    if a.restore:
        run_restore(a, conn, out, stamp, fks)
    elif a.sweep:
        run_sweep(a, conn, out, stamp, fks, keys, refs)
    else:
        run_merge(a, conn, out, stamp, fks, keys, refs)


if __name__ == "__main__":
    main()
