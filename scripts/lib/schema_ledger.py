"""Pure helpers for scripts/schema-ledger-audit.py.

Two questions, answered without a database:

1. Which migration files have no schema_versions row (diff_versions)?
2. What would PROVE each file has been applied (plan)? Every file is read for the objects it
   creates, drops or reshapes, and each becomes a probe the audit runs against the live
   catalog. A probe is only evidence if the file is the one that could have produced it:

     strong      the object is created by this file and by no other, so its presence says
                 this file ran
     weak        another file creates the same object too, or this file only REPLACES or
                 re-creates it — presence proves nothing, absence still says it did not run
     superseded  a LATER file drops the object, so today it is expected to be absent and
                 says nothing about this file either way

   A file whose statements are data-only (UPDATE / INSERT / DELETE) has no probe at all and
   is reported as unverifiable: that is a hand check, never a guess.
"""
import hashlib
import re

_VERSION = re.compile(r"^V(\d+\.\d+\.\d+)__.*\.sql$")
_IDENT = r'(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?'


def parse_version(filename):
    m = _VERSION.match(filename)
    return m.group(1) if m else None


def _key(v):
    return tuple(int(p) for p in v.split("."))


def diff_versions(files, applied):
    file_versions = {v for v in (parse_version(f) for f in files) if v}
    applied = set(applied)
    return {
        "missing_from_ledger": sorted(file_versions - applied, key=_key),
        "unknown_in_ledger": sorted(applied - file_versions, key=_key),
    }


# ── reading a migration ────────────────────────────────────────────────────────────────

def strip_sql(sql):
    """Comments removed, and every FUNCTION body emptied.

    A function body is code that runs later, not DDL that runs now: a `CREATE TABLE`
    inside one is not a table this migration made. `DO $$ … $$` blocks ARE executed by
    the migration, so their contents are kept.
    """
    out = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    out = "\n".join(re.sub(r"--.*$", "", line) for line in out.split("\n"))
    # AS $tag$ … $tag$  (function / procedure bodies); DO $tag$ … $tag$ is left alone.
    out = re.sub(r"\bAS\s+(\$[A-Za-z0-9_]*\$).*?\1", "AS $$ $$", out, flags=re.S | re.I)
    return out


_PLPGSQL_LEAD = re.compile(
    r"^(?:do\s+\$[a-z0-9_]*\$|begin|else|loop|declare\b.*?\bbegin|(?:if|elsif)\b.*?\bthen)\s+",
    re.I | re.S,
)


_EXECUTE_LITERAL = re.compile(r"^execute\s+'((?:[^']|'')*)'\s*$", re.I | re.S)


def _statements(sql):
    """Statements, with the PL/pgSQL scaffolding of a DO block peeled off the front — so
    `DO $$ BEGIN IF NOT EXISTS (…) THEN ALTER TABLE …` is read as the ALTER TABLE it runs."""
    out = []
    for s in strip_sql(sql).split(";"):
        s = s.strip()
        while True:
            peeled = _PLPGSQL_LEAD.sub("", s, count=1)
            if peeled == s:
                break
            s = peeled.strip()
        # EXECUTE 'literal DDL' runs exactly that statement. A format() / %I string does not
        # name its object in the text, so it is left alone (and simply produces no probe).
        m = _EXECUTE_LITERAL.match(s)
        if m:
            s = m.group(1).replace("''", "'").strip()
        if s:
            out.append(s)
    return out


def file_effects(sql):
    """What one migration creates, drops and reshapes.

    Returns {"creates": [obj], "drops": [obj], "probes": [probe]} where an obj is a tuple
    naming a catalog object — ("table", t), ("column", t, c), ("index", i),
    ("function", f), ("trigger", name), ("view", v), ("constraint", name),
    ("policy", t, name) — and a probe is an obj, or a shape check on a column:
    ("column_absent", t, c), ("nullable", t, c), ("not_null", t, c).
    Each probe is returned as (probe, replaces) where `replaces` is True when this file
    only re-creates something that may already exist (CREATE OR REPLACE, or a DROP of the
    same object earlier in the same file).
    """
    creates, drops, probes = [], [], []
    dropped_here = set()

    def create(obj, replaces=False):
        creates.append(obj)
        probes.append((obj, replaces or obj in dropped_here))

    for st in _statements(sql):
        s = " ".join(st.split())
        low = s.lower()

        m = re.match(r"create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?" + _IDENT, s, re.I)
        if m:
            create(("table", m.group(1).lower()))
            continue
        m = re.match(r"create\s+(or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?" + _IDENT, s, re.I)
        if m:
            create(("view", m.group(2).lower()), replaces=bool(m.group(1)))
            continue
        m = re.match(r"create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?" + _IDENT, s, re.I)
        if m:
            create(("index", m.group(1).lower()))
            continue
        m = re.match(r"create\s+(or\s+replace\s+)?function\s+" + _IDENT, s, re.I)
        if m:
            create(("function", m.group(2).lower()), replaces=bool(m.group(1)))
            continue
        m = re.match(r"create\s+(or\s+replace\s+)?(?:constraint\s+)?trigger\s+" + _IDENT, s, re.I)
        if m:
            create(("trigger", m.group(2).lower()), replaces=bool(m.group(1)))
            continue
        m = re.match(r"create\s+policy\s+" + _IDENT + r"\s+on\s+" + _IDENT, s, re.I)
        if m:
            create(("policy", m.group(2).lower(), m.group(1).lower()))
            continue

        m = re.match(r"drop\s+(table|view|materialized\s+view|index|function|trigger)\s+(?:concurrently\s+)?(?:if\s+exists\s+)?" + _IDENT, s, re.I)
        if m:
            kind = "view" if "view" in m.group(1).lower() else m.group(1).lower()
            obj = (kind, m.group(2).lower())
            drops.append(obj)
            dropped_here.add(obj)
            continue
        m = re.match(r"drop\s+policy\s+(?:if\s+exists\s+)?" + _IDENT + r"\s+on\s+" + _IDENT, s, re.I)
        if m:
            obj = ("policy", m.group(2).lower(), m.group(1).lower())
            drops.append(obj)
            dropped_here.add(obj)
            continue

        m = re.match(r"alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?" + _IDENT + r"\s+(.*)$", s, re.I)
        if m:
            table, rest = m.group(1).lower(), m.group(2)
            for clause in _split_clauses(rest):
                c = clause.strip()
                mm = re.match(r"add\s+column\s+(?:if\s+not\s+exists\s+)?" + _IDENT, c, re.I)
                if mm:
                    create(("column", table, mm.group(1).lower()))
                    continue
                mm = re.match(r"add\s+constraint\s+" + _IDENT, c, re.I)
                if mm:
                    create(("constraint", mm.group(1).lower()))
                    continue
                mm = re.match(r"drop\s+column\s+(?:if\s+exists\s+)?" + _IDENT, c, re.I)
                if mm:
                    obj = ("column", table, mm.group(1).lower())
                    drops.append(obj)
                    dropped_here.add(obj)
                    probes.append((("column_absent", table, mm.group(1).lower()), False))
                    continue
                mm = re.match(r"drop\s+constraint\s+(?:if\s+exists\s+)?" + _IDENT, c, re.I)
                if mm:
                    obj = ("constraint", mm.group(1).lower())
                    drops.append(obj)
                    dropped_here.add(obj)
                    continue
                mm = re.match(r"alter\s+(?:column\s+)?" + _IDENT + r"\s+(drop|set)\s+not\s+null", c, re.I)
                if mm:
                    kind = "nullable" if mm.group(2).lower() == "drop" else "not_null"
                    probes.append(((kind, table, mm.group(1).lower()), False))
                    continue
            continue

        # The repo's own soft-delete helper adds three columns and a partial index.
        for t in re.findall(r"add_soft_delete\(\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\)", low):
            if re.match(r"(create|comment)\b", low):
                break
            for col in ("deleted_at", "deleted_reason", "deleted_by"):
                create(("column", t, col))
            create(("index", "idx_%s_deleted_at" % t))

    return {"creates": creates, "drops": drops, "probes": probes}


def _split_clauses(rest):
    """Top-level comma split of an ALTER TABLE action list (parentheses respected)."""
    out, depth, cur = [], 0, []
    for ch in rest:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur))
    return out


def _shape_target(probe):
    """The object a shape probe (column_absent / nullable / not_null) is about."""
    return ("column", probe[1], probe[2])


def plan(files):
    """For each migration, the probes that would show it applied, and how much each proves.

    `files` is [(filename, sql_text)] for V*.sql files; ROLLBACK_* and other names are
    ignored. Returned in version order:
      [{"version", "filename", "sha256", "probes": [{"probe", "strength"}], "statements"}]
    """
    entries = []
    for name, sql in files:
        v = parse_version(name)
        if v:
            entries.append((v, name, sql, file_effects(sql)))
    entries.sort(key=lambda e: _key(e[0]))

    out = []
    for i, (v, name, sql, eff) in enumerate(entries):
        others_create = set()
        later_drop = set()
        for j, (_, _, _, other) in enumerate(entries):
            if j == i:
                continue
            others_create.update(other["creates"])
            if j > i:
                later_drop.update(other["drops"])
        probes = []
        for probe, replaces in eff["probes"]:
            target = _shape_target(probe) if probe[0] in ("column_absent", "nullable", "not_null") else probe
            if probe[0] == "column_absent":
                # A later file re-adding the column makes "absent" the wrong expectation.
                strength = "superseded" if target in others_create and _created_later(entries, i, target) else "strong"
            elif target in later_drop:
                strength = "superseded"
            elif replaces or target in others_create:
                strength = "weak"
            else:
                strength = "strong"
            probes.append({"probe": probe, "strength": strength})
        out.append({
            "version": v,
            "filename": name,
            "sha256": hashlib.sha256(sql.encode("utf-8")).hexdigest(),
            "probes": probes,
            "statements": len(_statements(sql)),
        })
    return out


def _created_later(entries, i, obj):
    return any(obj in e[3]["creates"] for e in entries[i + 1:])


def verdict(results):
    """Classify one file from [(strength, present)] for its probes.

    applied       every probe that counts is present, and at least one of them is strong
    not_applied   nothing strong is present and something is missing
    partial       some strong evidence present, something missing
    unverifiable  no probe counts (data-only file, or only re-creates existing objects)
    """
    counted = [(s, p) for s, p in results if s in ("strong", "weak")]
    if not counted:
        return "unverifiable"
    missing = [s for s, p in counted if not p]
    strong_present = [s for s, p in counted if p and s == "strong"]
    if not missing:
        return "applied" if strong_present else "unverifiable"
    if not strong_present:
        return "not_applied"
    return "partial"


def probe_query(probe):
    """(sql, params) that returns one boolean row for this probe. Parameterised — no
    identifier is ever interpolated into the SQL text."""
    kind = probe[0]
    cols = ("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' "
            "AND table_name = %s AND column_name = %s)")
    if kind == "table" or kind == "view":
        return ("SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'public' AND c.relname = %s AND c.relkind IN ('r','p','v','m'))",
                (probe[1],))
    if kind == "column":
        return (cols, (probe[1], probe[2]))
    if kind == "column_absent":
        return ("SELECT NOT " + cols[len("SELECT "):], (probe[1], probe[2]))
    if kind == "index":
        return ("SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = %s)",
                (probe[1],))
    if kind == "function":
        return ("SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                "WHERE n.nspname = 'public' AND p.proname = %s)", (probe[1],))
    if kind == "trigger":
        return ("SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = %s AND NOT tgisinternal)",
                (probe[1],))
    if kind == "constraint":
        return ("SELECT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace "
                "WHERE n.nspname = 'public' AND c.conname = %s)", (probe[1],))
    if kind == "policy":
        return ("SELECT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' "
                "AND tablename = %s AND policyname = %s)", (probe[1], probe[2]))
    if kind in ("nullable", "not_null"):
        want = "YES" if kind == "nullable" else "NO"
        return ("SELECT coalesce((SELECT is_nullable = %s FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = %s AND column_name = %s), false)",
                (want, probe[1], probe[2]))
    raise ValueError("unknown probe kind: %r" % (kind,))


def describe(probe):
    kind = probe[0]
    if kind in ("column", "column_absent", "nullable", "not_null"):
        label = {"column": "", "column_absent": " absent", "nullable": " nullable",
                 "not_null": " NOT NULL"}[kind]
        return "%s.%s%s" % (probe[1], probe[2], label)
    if kind == "policy":
        return "policy %s on %s" % (probe[2], probe[1])
    return "%s %s" % (kind, probe[1])


def backfill_sql(entry):
    """The ledger row the runner itself would have written for this file — printed for a
    human to review and run, never executed by the audit."""
    desc = ("%s sha256:%s" % (entry["filename"], entry["sha256"])).replace("'", "''")
    return ("INSERT INTO schema_versions (version, description) VALUES ('%s', '%s') "
            "ON CONFLICT (version) DO NOTHING;" % (entry["version"], desc))
