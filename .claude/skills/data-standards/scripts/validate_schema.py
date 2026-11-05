#!/usr/bin/env python3
"""The shared validator — the ONE place that decides pass/fail for schema
changes, called identically by the Claude PreToolUse gate, a local Git hook,
and CI. See reference/enforcement-policy.md for which findings can block
(deterministic, structural) vs. which are always advisory (inference,
external-registry-dependent, live-data-only).

This does structural checks (parses each CREATE TABLE block, looks at its
actual columns/constraints), not just audit.py's keyword-presence scan — a
blocking decision needs more confidence than "the word REFERENCES appeared
somewhere in the file."

Usage:
    # Full repository audit
    python3 validate_schema.py --mode full --path .

    # Base-to-head diff audit (uses detect_schema_changes.py to scope which
    # files matter, then validates only those)
    python3 validate_schema.py --mode diff --base HEAD~1 --head HEAD

    # Staged-change audit
    python3 validate_schema.py --mode staged

    # Validate an already-produced report (structural sanity, not re-auditing)
    python3 validate_schema.py --mode validate-report path/to/report.json

Exit codes (see reference/enforcement-policy.md):
    0  no blocking violations found (advisory findings may still be present)
    1  confirmed blocking violation(s) found
    2  validator error, or a required blocking check could not run at all
    3  no schema-related change detected (nothing to validate)

Output: JSON to stdout (--json, default) or Markdown (--markdown). The JSON
shape is the "structured JSON" this brief's validator contract requires,
consumed by the Claude gate / Git hook / CI without re-parsing prose.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("Missing dependency: pyyaml. Install with: pip install pyyaml", file=sys.stderr)
    sys.exit(2)

SKILL_DIR = Path(__file__).resolve().parent.parent
STANDARDS_PATH = SKILL_DIR / "reference" / "standards.yaml"
DETECTOR = SKILL_DIR / "scripts" / "detect_schema_changes.py"

PII_NAME_PATTERN = re.compile(
    r"\b(phone|phone_number|cnic|ssn|social_security|dob|date_of_birth|email)\b", re.IGNORECASE
)
MIGRATION_TOOL_MARKERS = ["flyway", "alembic", "django migrations", "makemigrations",
                            "knex migrate", "prisma migrate", "migration"]


def load_standards() -> dict:
    if not STANDARDS_PATH.exists():
        print(f"Can't find {STANDARDS_PATH}", file=sys.stderr)
        sys.exit(2)
    return yaml.safe_load(STANDARDS_PATH.read_text(encoding="utf-8"))


# --------------------------------------------------------------- structural checks

def find_create_table_blocks(text: str) -> list[tuple[str, str]]:
    """Returns [(table_name, body_text), ...] for each CREATE TABLE in the
    text. Body text is the raw content between the outer parens, case
    preserved (unlike audit.py's scanner, which lowercases everything — case
    matters here for reading back an exact column definition to quote as
    evidence)."""
    blocks = []
    for m in re.finditer(
        r"create\s+table\s+(?:if\s+not\s+exists\s+)?([\w.\"]+)\s*\((.*?)\)\s*;",
        text, re.IGNORECASE | re.DOTALL,
    ):
        blocks.append((m.group(1).strip('"'), m.group(2)))
    return blocks


def _extract_line_comments(body: str) -> tuple[str, list[str]]:
    """Pulls every `-- ...` trailing line comment OUT of body (replacing each
    with nothing, so the comma-split below sees only real column-definition
    syntax and can never trip on a comma inside a comment's own prose, e.g.
    `-- PII: Restricted-PII, tokenized at write time`). Returns
    (body_without_comments, [comment_text, ...]) in source order.

    Two designs were tried and rejected before this one:
      1. Masking only the commas INSIDE a comment (leaving the comment text
         itself in place) — this doesn't fix the real problem: a trailing
         comment has no comma of its own before the NEXT column starts (that
         column's comma comes at the end of ITS line), so the comment text
         still ends up glued onto the following column as one fragment.
      2. Treating a comment's closing newline as an extra split point — this
         also splits the comment itself away from the column it was
         commenting on, so a classification marker like `-- PII: ...` no
         longer reads back attached to its own column.
    The fix that actually works: remove comments from the stream entirely
    before splitting (so column boundaries are exactly the real commas), and
    track separately which column-index each comment followed, so it can be
    re-attached by split_columns() after the split is already correct.
    """
    out = []
    comments = []  # (column_index_this_comment_belongs_to, text)
    in_comment = False
    current_comment = []
    current_comment_col = 0
    prev = ""
    col_index = 0
    # True from the instant a top-level comma is seen until the next
    # character confirmed NOT to be whitespace and NOT the start of a "--"
    # comment marker — while true, anything that follows (including a
    # comment) is trailing content for the column BEFORE that comma, not the
    # column being built after it.
    #
    # Getting the clear-condition right took two attempts:
    #   1. Clearing on "any non-whitespace character" cleared the flag on the
    #      FIRST "-" of "--" — one character before the second "-" confirms
    #      it's actually a comment marker (`ch == "-" and prev == "-"` only
    #      fires on that second character) — so a trailing comment right
    #      after a comma was never recognized as "just after a comma."
    #   2. The fix: don't let a bare "-" clear the flag by itself. It's
    #      cleared only when a "-" is confirmed NOT part of "--" (i.e. the
    #      previous char was also "-", so THIS "-" completes the marker and
    #      is handled by the in_comment branch below instead) or any other
    #      non-whitespace character arrives. A single "-" that turns out to
    #      be a stray minus sign (not a comment) rather than the first half
    #      of "--" will incorrectly preserve the flag for one extra
    #      character — accepted as a narrow edge case for this heuristic
    #      parser; SQL DDL essentially never has a bare "-" immediately
    #      after a column-separating comma in practice.
    just_after_comma = False
    depth = 0
    for ch in body:
        if in_comment:
            if ch == "\n":
                in_comment = False
                comments.append((current_comment_col, "".join(current_comment)))
                current_comment = []
                out.append(ch)  # keep the newline itself in the stream
            else:
                current_comment.append(ch)
            prev = ch
            continue
        if ch == "-" and prev == "-":
            in_comment = True
            current_comment_col = col_index - 1 if just_after_comma else col_index
            out.pop()  # drop the first "-" of "--" already appended below
            prev = ch
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            col_index += 1
            just_after_comma = True
        elif ch == "-":
            pass  # might be the first half of "--" — don't clear yet, see above
        elif not ch.isspace():
            just_after_comma = False
        out.append(ch)
        prev = ch
    if in_comment and current_comment:
        comments.append((current_comment_col, "".join(current_comment)))
    return "".join(out), comments


def split_columns(body: str) -> list[str]:
    """Top-level comma split respecting nested parens, with trailing line
    comments re-attached to the column they followed — good enough for
    typical column-definition lists without a full SQL parser. See
    _extract_line_comments for why comments are pulled out before splitting
    rather than handled inline."""
    stripped, comments = _extract_line_comments(body)

    parts, depth, current = [], 0, []
    for ch in stripped:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(ch)
    if current:
        parts.append("".join(current))

    columns = [p.strip() for p in parts if p.strip()]
    for col_index, comment_text in comments:
        if col_index < len(columns):
            columns[col_index] = columns[col_index] + " --" + comment_text
    return columns


def check_d1_uuid_pk(table: str, body: str) -> dict | None:
    """D1: the PK column (named id, or explicitly PRIMARY KEY) must be uuid."""
    columns = split_columns(body)
    pk_col = None
    for col in columns:
        if re.match(r"^id\b", col, re.IGNORECASE) or "primary key" in col.lower():
            pk_col = col
            break
    if pk_col is None:
        return {"standard": "D1", "check": "D1-primary-key", "confirmed": True, "confidence": "MEDIUM",
                "finding": f"table `{table}` has no column named `id` and no explicit "
                            "PRIMARY KEY clause found — confirm it truly has no primary key",
                "evidence": body.strip()[:200]}
    if not re.search(r"\buuid\b", pk_col, re.IGNORECASE):
        return {"standard": "D1", "check": "D1-primary-key", "confirmed": True, "confidence": "HIGH",
                "finding": f"table `{table}`'s primary key column is not typed uuid",
                "evidence": pk_col.strip()}
    return None


def check_d3_referential_integrity(table: str, body: str, full_text: str) -> dict | None:
    """D3: a column named *_id (not the PK itself) should have a REFERENCES/
    FOREIGN KEY somewhere covering it, OR the table overall should have at
    least one FK if it has any *_id-looking foreign-key-shaped column."""
    columns = split_columns(body)
    fk_like = [c for c in columns
               if re.search(r"^\w+_id\b", c, re.IGNORECASE) and not re.match(r"^id\b", c, re.IGNORECASE)]
    if not fk_like:
        return None
    has_fk = "references" in body.lower() or "foreign key" in body.lower()
    if not has_fk:
        col_names = ", ".join(re.match(r"^(\w+)", c).group(1) for c in fk_like)
        return {"standard": "D3", "check": "D3-foreign-key", "confirmed": True, "confidence": "MEDIUM",
                "finding": f"table `{table}` has FK-shaped column(s) ({col_names}) but no "
                            "REFERENCES/FOREIGN KEY clause anywhere in the table body",
                "evidence": body.strip()[:200]}
    return None


def check_d5_timestamptz(table: str, body: str) -> list[dict]:
    """D5: any column named created_at/updated_at must be TIMESTAMPTZ, not bare TIMESTAMP."""
    findings = []
    for col in split_columns(body):
        m = re.match(r"^(created_at|updated_at)\b", col, re.IGNORECASE)
        if not m:
            continue
        if re.search(r"\btimestamptz\b|\btimestamp\s+with\s+time\s*zone\b", col, re.IGNORECASE):
            continue
        if re.search(r"\btimestamp\b", col, re.IGNORECASE):
            findings.append({"standard": "D5", "check": "D5-timestamptz", "confirmed": True, "confidence": "HIGH",
                              "finding": f"table `{table}` column `{m.group(1)}` is bare TIMESTAMP, "
                                          "not TIMESTAMPTZ",
                              "evidence": col.strip()})
    return findings


def check_d4_new_pii_column(table: str, body: str) -> list[dict]:
    """D4/D6: a newly added column matching a PII name pattern needs an
    adjacent classification marker (a comment naming a D6 sensitivity level)
    — this is a heuristic proxy for 'has this been classified', not a
    certifier; see reference/enforcement-policy.md's honesty note on this."""
    findings = []
    for col in split_columns(body):
        m = PII_NAME_PATTERN.search(col)
        if not m:
            continue
        if re.search(r"--\s*(PII|Restricted-PII|Confidential)", col, re.IGNORECASE):
            continue
        col_name = re.match(r"^(\S+)", col).group(1)
        findings.append({"standard": "D4", "check": "D4-pii-classification", "confirmed": True, "confidence": "MEDIUM",
                          "finding": f"table `{table}` column `{col_name}` looks like PII "
                                      f"(matched `{m.group(1)}`) with no classification marker "
                                      "comment (`-- PII` / `-- Restricted-PII` / `-- Confidential`)",
                          "evidence": col.strip()})
    return findings


def check_d8_migration_tool(text: str) -> dict | None:
    low = text.lower()
    if not any(marker in low for marker in MIGRATION_TOOL_MARKERS):
        return {"standard": "D8", "check": "D8-migration-tool", "confirmed": True, "confidence": "MEDIUM",
                "finding": "raw CREATE/ALTER TABLE with no migration-tool marker in the same text",
                "evidence": None}
    return None


def check_d8_destructive_without_safety(text: str) -> list[dict]:
    findings = []
    for m in re.finditer(r"(DROP\s+(TABLE|COLUMN)\s+[\w.\"]+|TRUNCATE\s+[\w.\"]+)", text, re.IGNORECASE):
        window = text[max(0, m.start() - 200):m.start()]
        if re.search(r"--\s*destructive:\s*reviewed", window, re.IGNORECASE) or "rollback" in window.lower():
            continue
        if _in_down_section(text, m.start()):
            continue
        findings.append({"standard": "D8", "check": "D8-destructive", "confirmed": True, "confidence": "HIGH",
                          "finding": f"destructive statement `{m.group(1)}` with no rollback script "
                                      "or `-- destructive: reviewed` marker nearby",
                          "evidence": m.group(1)})
    return findings


# --------------------------------------------------------------- more checks (D8, D9, D12, D14-D17)
# Each of these reads only the SQL text (plus, for D8/D17, the names of the
# other files in the same migrations folder). Whether a finding blocks or only
# warns is not decided here: see `enforcement:` in reference/standards.yaml.

REVIEWED_MARKER = re.compile(r"--\s*(destructive|breaking):\s*reviewed", re.IGNORECASE)
LOG_LIKE_TABLE = re.compile(r"(^|_)(logs?|events?|history|histories|audit|audits|snapshots?|archive)$", re.IGNORECASE)
USER_LIKE_TABLE = re.compile(
    r"(^|_)(users?|teachers?|students?|accounts?|members?|profiles?|parents?|coaches?|learners?)$", re.IGNORECASE)
CATEGORY_COLUMN = re.compile(r"(^|_)(status|type|category|role|kind|level|stage|state|tier|mode)$", re.IGNORECASE)
FREE_TEXT_TYPE = re.compile(r"^(text|varchar|character\s+varying|char|character|citext)\b", re.IGNORECASE)
UNCOUNTABLE = {"data", "metadata", "feedback", "staff", "media", "analytics", "info", "information",
               "progress", "equipment", "personnel", "news", "series", "content", "inventory"}
ROLLBACK_NAME = re.compile(r"rollback|(^|[_.\-])down([_.\-]|$)", re.IGNORECASE)
IN_FILE_DOWN = re.compile(r"^\s*--\s*(\+?\s*migrate:?\s*down|rollback\b|down\b)", re.IGNORECASE | re.MULTILINE)
COLUMN_KEYWORDS = {"constraint", "primary", "unique", "foreign", "check", "exclude", "like"}


def _in_down_section(text: str, pos: int) -> bool:
    """True when pos is after a `-- migrate:down` / `-- rollback` / `-- down`
    marker: that part of the file only runs to undo the migration."""
    return bool(IN_FILE_DOWN.search(text[:pos]))


def _without_comments(text: str) -> str:
    return re.sub(r"--[^\n]*", "", text)


def _reviewed(text: str, pos: int) -> bool:
    """A `-- destructive: reviewed` / `-- breaking: reviewed` marker in the 200
    characters before the statement — the same window D8-destructive uses."""
    return bool(REVIEWED_MARKER.search(text[max(0, pos - 200):pos]))


def _column_name_type(col: str) -> tuple[str, str] | None:
    m = re.match(r'^"?(\w+)"?\s+([\w ]+?)(?:\(|\s+(?:not|null|default|primary|references|unique|check|'
                 r'generated|constraint|collate)\b|\s*$|\s*--|,)', col.strip(), re.IGNORECASE)
    if not m or m.group(1).lower() in COLUMN_KEYWORDS:
        return None
    return m.group(1), m.group(2).strip()


def _new_columns(text: str) -> list[tuple[str, str, str, str]]:
    """(table, column, type, full definition) for every column a CREATE TABLE
    defines or an ALTER TABLE ... ADD COLUMN adds."""
    out = []
    for table, body in find_create_table_blocks(text):
        for col in split_columns(body):
            nt = _column_name_type(col)
            if nt:
                out.append((table.split(".")[-1], nt[0], nt[1], col))
    for m in re.finditer(r"alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w.\"]+)\s+(.*?);",
                         _without_comments(text), re.IGNORECASE | re.DOTALL):
        table = m.group(1).strip('"').split(".")[-1]
        for add in re.finditer(r"add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(.*?)(?=,\s*(?:add|drop|alter)\b|$)",
                               m.group(2), re.IGNORECASE | re.DOTALL):
            nt = _column_name_type(add.group(1))
            if nt:
                out.append((table, nt[0], nt[1], add.group(1).strip()))
    return out


def check_d9_soft_delete(text: str) -> list[dict]:
    findings = []
    clean = _without_comments(text)
    for m in re.finditer(r"\bdelete\s+from\s+([\w.\"]+)", clean, re.IGNORECASE):
        findings.append({"standard": "D9", "check": "D9-hard-delete", "confirmed": True, "confidence": "MEDIUM",
                         "finding": f"hard `DELETE FROM {m.group(1)}` — D9 asks for soft delete (`deleted_at`)",
                         "evidence": m.group(0)})
    for table, body in find_create_table_blocks(text):
        name = table.split(".")[-1]
        if LOG_LIKE_TABLE.search(name) or re.search(r"\bdeleted_at\b", body, re.IGNORECASE):
            continue
        findings.append({"standard": "D9", "check": "D9-no-deleted-at", "confirmed": True, "confidence": "LOW",
                         "table": name,
                         "finding": f"new table `{name}` has no `deleted_at TIMESTAMPTZ` column for soft delete",
                         "evidence": None})
    return findings


def check_d12_backward_compatible(text: str) -> list[dict]:
    findings = []
    for m in re.finditer(r"alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w.\"]+)\s+([^;]*);", text,
                         re.IGNORECASE | re.DOTALL):
        if _reviewed(text, m.start()) or _in_down_section(text, m.start()):
            continue
        table, rest = m.group(1).strip('"').split(".")[-1], _without_comments(m.group(2))
        for r in re.finditer(r"rename\s+(?:column\s+)?(\"?\w+\"?)\s+to\s+(\"?\w+\"?)", rest, re.IGNORECASE):
            findings.append({"standard": "D12", "check": "D12-rename", "confirmed": True, "confidence": "HIGH",
                             "table": table,
                             "finding": f"renames column `{table}.{r.group(1)}` to `{r.group(2)}` — code still "
                                        "using the old name breaks the moment this runs. Add the new column, "
                                        "switch the code, drop the old one later; or mark it `-- breaking: reviewed`",
                             "evidence": r.group(0)})
        t = re.match(r"\s*rename\s+to\s+(\"?\w+\"?)", rest, re.IGNORECASE)
        if t:
            findings.append({"standard": "D12", "check": "D12-rename", "confirmed": True, "confidence": "HIGH",
                             "table": table,
                             "finding": f"renames table `{table}` to `{t.group(1)}` — code still using the old "
                                        "name breaks the moment this runs; or mark it `-- breaking: reviewed`",
                             "evidence": t.group(0).strip()})
        for add in re.finditer(r"add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(\"?\w+\"?)\s+([^,]*)", rest,
                               re.IGNORECASE):
            if add.group(1).lower() in COLUMN_KEYWORDS:
                continue
            spec = add.group(2)
            if (re.search(r"\bnot\s+null\b", spec, re.IGNORECASE)
                    and not re.search(r"\bdefault\b|\bgenerated\b|\b(big|small)?serial\b", spec, re.IGNORECASE)):
                findings.append({"standard": "D12", "check": "D12-not-null-without-default", "confirmed": True,
                                 "confidence": "HIGH", "table": table,
                                 "finding": f"adds NOT NULL column `{table}.{add.group(1)}` with no DEFAULT — it "
                                            "fails on a table that has rows, and old code inserting without it "
                                            "breaks. Add a DEFAULT, or mark it `-- breaking: reviewed`",
                                 "evidence": add.group(0).strip()})
    return findings


def check_d14_naming(text: str) -> list[dict]:
    findings = []
    for table, _body in find_create_table_blocks(text):
        name = table.split(".")[-1]
        last = name.split("_")[-1]
        if not re.fullmatch(r"[a-z][a-z0-9_]*", name):
            problem = "is not snake_case"
        elif not last.endswith("s") and last not in UNCOUNTABLE:
            problem = "is not plural"
        else:
            continue
        findings.append({"standard": "D14", "check": "D14-table-name", "confirmed": True, "confidence": "LOW",
                         "table": name, "finding": f"new table name `{name}` {problem} (naming guide)",
                         "evidence": None})
    for table, col, typ, _defn in _new_columns(text):
        low = typ.lower()
        if low in ("boolean", "bool") and not re.match(r"(is|has|can)_", col, re.IGNORECASE):
            findings.append({"standard": "D14", "check": "D14-boolean-prefix", "confirmed": True,
                             "confidence": "MEDIUM", "table": table,
                             "finding": f"boolean column `{table}.{col}` does not start with is_/has_/can_",
                             "evidence": None})
        if low.startswith("timestamp") and not col.lower().endswith("_at"):
            findings.append({"standard": "D14", "check": "D14-timestamp-suffix", "confirmed": True,
                             "confidence": "MEDIUM", "table": table,
                             "finding": f"timestamp column `{table}.{col}` does not end in _at",
                             "evidence": None})
    return findings


def check_d15_controlled_vocabulary(text: str) -> list[dict]:
    findings = []
    table_checks = {t.split(".")[-1]: " ".join(c for c in split_columns(b) if re.match(r"(constraint\s+\w+\s+)?check\b", c, re.IGNORECASE))
                    for t, b in find_create_table_blocks(text)}
    for table, col, typ, defn in _new_columns(text):
        if not CATEGORY_COLUMN.search(col) or not FREE_TEXT_TYPE.match(typ):
            continue
        if re.search(r"\bcheck\b|\breferences\b", defn, re.IGNORECASE):
            continue
        if re.search(rf"\b{re.escape(col)}\b", table_checks.get(table, ""), re.IGNORECASE):
            continue
        findings.append({"standard": "D15", "check": "D15-free-text-category", "confirmed": True,
                         "confidence": "MEDIUM", "table": table,
                         "finding": f"`{table}.{col}` is free text ({typ}) with no enum type, CHECK or lookup "
                                    "table limiting its values",
                         "evidence": defn.strip()[:200]})
    return findings


def check_d16_test_data(text: str) -> list[dict]:
    findings = []
    for table, body in find_create_table_blocks(text):
        name = table.split(".")[-1]
        if USER_LIKE_TABLE.search(name) and not re.search(r"\bis_test\b", body, re.IGNORECASE):
            findings.append({"standard": "D16", "check": "D16-no-is-test", "confirmed": True, "confidence": "LOW",
                             "table": name,
                             "finding": f"new table `{name}` holds people/accounts but has no `is_test BOOLEAN` "
                                        "flag to keep test and demo rows out of analytics",
                             "evidence": None})
    return findings


def _migration_version(name: str) -> str | None:
    """The leading version number, or None for a name that starts with a
    plain date (YYYYMMDD or YYYY-MM-DD): several migrations on one day
    legitimately share it."""
    if re.match(r"^\d{4}-\d{2}-\d{2}", name):
        return None
    m = re.match(r"^[Vv]?(\d+)(?=[_\-.])", name)
    return m.group(1) if m and len(m.group(1)) != 8 else None


def _is_forward_migration(path: str) -> bool:
    p = Path(path)
    return (p.suffix.lower() == ".sql" and "migrations" in [x.lower() for x in p.parts[:-1]]
            and not ROLLBACK_NAME.search(p.stem))


def check_d8_duplicate_version(path: str, siblings: list[str]) -> list[dict]:
    """Two forward migrations with the same version number."""
    name = Path(path).name
    version = _migration_version(name)
    if not _is_forward_migration(path) or not version:
        return []
    clashes = sorted(s for s in siblings if s != name and _migration_version(s) == version
                     and not ROLLBACK_NAME.search(Path(s).stem) and s.lower().endswith(".sql"))
    if not clashes:
        return []
    return [{"standard": "D8", "check": "D8-duplicate-version", "confirmed": True, "confidence": "HIGH",
             "finding": f"migration version `{version}` is also used by {', '.join(clashes)} — the runner "
                        "can apply them in the wrong order or skip one",
             "evidence": name}]


def check_d17_rollback(path: str, text: str, siblings: list[str]) -> list[dict]:
    if not _is_forward_migration(path):
        return []
    stem = Path(path).stem
    if IN_FILE_DOWN.search(text):
        return []
    if any(stem in s and s != Path(path).name and ROLLBACK_NAME.search(s) for s in siblings):
        return []
    return [{"standard": "D17", "check": "D17-no-rollback", "confirmed": True, "confidence": "MEDIUM",
             "finding": f"no rollback for `{Path(path).name}` — no `*{stem}*rollback*`/`*down*` file next to it "
                        "and no `-- migrate:down` / `-- rollback` section in it",
             "evidence": None}]


# --------------------------------------------------------------- running the checks

def all_findings(path: str, text: str, siblings: list[str] | None = None) -> list[dict]:
    """Every check against one file's text, each finding tagged with its path.
    `siblings` is the list of file names in the same folder (for D8/D17)."""
    findings = []
    for table, body in find_create_table_blocks(text):
        for check in (check_d1_uuid_pk, lambda t, b: check_d3_referential_integrity(t, b, text)):
            f = check(table, body)
            if f:
                findings.append({**f, "path": path, "table": table})
        for f in check_d5_timestamptz(table, body):
            findings.append({**f, "path": path, "table": table})
        for f in check_d4_new_pii_column(table, body):
            findings.append({**f, "path": path, "table": table})

    if re.search(r"\bcreate\s+table\b|\balter\s+table\b", text, re.IGNORECASE):
        f = check_d8_migration_tool(text)
        if f:
            findings.append({**f, "path": path, "table": None})
        for f in check_d8_destructive_without_safety(text):
            findings.append({**f, "path": path, "table": None})

    for check in (check_d9_soft_delete, check_d12_backward_compatible, check_d14_naming,
                  check_d15_controlled_vocabulary, check_d16_test_data):
        for f in check(text):
            findings.append({"table": None, **f, "path": path})
    if siblings is not None:
        for f in check_d8_duplicate_version(path, siblings) + check_d17_rollback(path, text, siblings):
            findings.append({"table": None, **f, "path": path})
    return findings


def load_enforcement(strict: list[str] | None = None) -> dict[str, dict]:
    """check id -> {"mode": "block"|"warn", "why": str}, from standards.yaml,
    with a repo's `strict` list promoting warn checks to block."""
    table = {k: dict(v or {}) for k, v in (load_standards().get("enforcement") or {}).items()}
    for item in strict or []:
        for check, rule in table.items():
            if check == item or check.split("-")[0] == item:
                rule["mode"] = "block"
    return table


def repo_strict_list() -> list[str]:
    """`strict` from the repo's .data-standards.json, if it has one."""
    top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    root = Path(top.stdout.strip()) if top.returncode == 0 and top.stdout.strip() else Path.cwd()
    try:
        config = json.loads((root / ".data-standards.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    strict = config.get("strict") or []
    return [str(s) for s in strict] if isinstance(strict, list) else []


def _key(f: dict) -> tuple:
    return (f.get("check"), f.get("table"), re.sub(r"\s+", " ", f.get("finding") or ""))


def judge_change(path: str, old_text: str, new_text: str, siblings: list[str] | None = None,
                 enforcement: dict[str, dict] | None = None) -> dict:
    """Splits one file's findings into what blocks, what warns, and what was
    already there before the change (never blocks, per enforcement-policy.md
    "Regressions vs. existing debt"). old_text is "" for a new file."""
    rules = enforcement if enforcement is not None else load_enforcement(repo_strict_list())
    before = {_key(f) for f in all_findings(path, old_text, siblings)} if old_text else set()
    out = {"findings": [], "warnings": [], "existing": []}
    for f in all_findings(path, new_text, siblings):
        rule = rules.get(f.get("check"), {"mode": "block"})
        f = {**f, "enforcement": rule.get("mode", "block")}
        if _key(f) in before:
            out["existing"].append(f)
        elif f["enforcement"] == "warn":
            out["warnings"].append({**f, "why": rule.get("why", "")})
        else:
            out["findings"].append(f)
    return out


def validate_text(path: str, text: str) -> list[dict]:
    """The blocking findings for a whole file treated as new — the original
    entry point, kept for callers that check one text on its own."""
    return judge_change(path, "", text)["findings"]


def finding_line(f: dict) -> str:
    return (f"{f.get('standard')} {f.get('path')}" + (f" table {f['table']}" if f.get("table") else "")
            + f": {f.get('finding')}")


def summary_text(report: dict, limit: int = 1900) -> str:
    """One plain-text summary of a report — what blocked, what only warned and
    why — for the gate board and, through it, Slack."""
    parts = [f"BLOCKED: {finding_line(f)}" for f in report.get("findings", [])]
    parts += [f"WARNING (did not block): {finding_line(f)}" for f in report.get("warnings", [])]
    whys = {}
    for f in report.get("warnings", []):
        whys.setdefault(f.get("check"), f.get("why") or "")
    parts += [f"Why {check} only warns: {why}" for check, why in whys.items() if why]
    existing = report.get("existing", [])
    if existing:
        parts.append(f"{len(existing)} problem(s) already in the changed file(s) before this change — "
                     "not caused by it, not blocking")
    text = "; ".join(parts)
    return text if len(text) <= limit else text[:limit - 1] + "…"


# --------------------------------------------------------------- modes

def run_detector(mode_args: list[str]) -> dict:
    result = subprocess.run([sys.executable, str(DETECTOR), *mode_args],
                             capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Detector failed: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(2)
    return json.loads(result.stdout)


def _git_show(spec: str) -> str | None:
    proc = subprocess.run(["git", "show", spec], capture_output=True)
    return proc.stdout.decode("utf-8", errors="replace") if proc.returncode == 0 else None


def _git_dir_names(ref: str, directory: str) -> list[str] | None:
    """File names in `directory` at `ref` (None = the working tree)."""
    if ref is None:
        d = Path(directory or ".")
        return [p.name for p in d.iterdir()] if d.is_dir() else []
    spec = f"{ref}:{directory}" if directory else f"{ref}:"
    proc = subprocess.run(["git", "ls-tree", "--name-only", spec], capture_output=True, text=True)
    return proc.stdout.split() if proc.returncode == 0 else []


def _read(path: str) -> str:
    fp = Path(path)
    try:
        return fp.read_text(encoding="utf-8", errors="replace") if fp.exists() else ""
    except OSError:
        return ""


def judge_files(entries: list[dict], mode: str, base: str | None = None, head: str | None = None) -> dict:
    """Runs judge_change on every relevant file, reading each file's text
    before and after the change from the right place for the mode:
      full   — the working tree, everything treated as new
      diff   — base and head commits
      staged — HEAD and the index"""
    rules = load_enforcement(repo_strict_list())
    report = {"files_checked": [], "findings": [], "warnings": [], "existing": []}
    for e in entries:
        if e.get("status") == "deleted":
            continue
        path, old_path = e["path"], e.get("renamed_from") or e["path"]
        directory = str(Path(path).parent).replace("\\", "/")
        directory = "" if directory == "." else directory
        if mode == "diff":
            new = _git_show(f"{head}:{path}")
            new = _read(path) if new is None else new
            old = _git_show(f"{base}:{old_path}") or ""
            siblings = _git_dir_names(head, directory)
        elif mode == "staged":
            new = _git_show(f":{path}")
            new = _read(path) if new is None else new
            old = _git_show(f"HEAD:{old_path}") or ""
            siblings = _git_dir_names(None, directory)
        else:
            new, old = _read(path), ""
            siblings = _git_dir_names(None, directory)
        judged = judge_change(path, old, new, siblings, rules)
        report["files_checked"].append(path)
        for k in ("findings", "warnings", "existing"):
            report[k].extend(judged[k])
    return report


def validate_report(report_path: Path) -> tuple[int, dict]:
    """Structural sanity check on an already-produced JSON report (per
    audit-report-format.md's optional machine-readable companion), NOT a
    re-audit. Confirms the shape is well-formed enough to trust."""
    try:
        data = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return 2, {"error": f"malformed report JSON: {e}"}
    required = {"issue_id", "standard_id", "verdict", "severity", "confidence"}
    if isinstance(data, list):
        issues = data
    elif isinstance(data, dict) and "issues" in data:
        issues = data["issues"]
    else:
        return 2, {"error": "report JSON must be a list of issues or {\"issues\": [...]}"}
    for i, issue in enumerate(issues):
        missing = required - set(issue.keys())
        if missing:
            return 2, {"error": f"issue #{i} missing required fields: {sorted(missing)}"}
    return 0, {"validated": len(issues), "result": "well-formed"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["full", "diff", "staged", "validate-report"], required=True)
    ap.add_argument("--path", default=".", help="repo root for --mode full")
    ap.add_argument("--base", help="base ref for --mode diff")
    ap.add_argument("--head", help="head ref for --mode diff")
    ap.add_argument("report", nargs="?", help="report JSON path for --mode validate-report")
    ap.add_argument("--markdown", action="store_true", help="emit Markdown instead of JSON")
    args = ap.parse_args()

    if args.mode == "validate-report":
        if not args.report:
            ap.error("--mode validate-report requires a report path")
        code, result = validate_report(Path(args.report))
        print(json.dumps(result, indent=2))
        return code

    if args.mode == "full":
        all_sql = list(Path(args.path).rglob("*.sql"))
        detector_result = {"relevant": [
            {"path": str(p), "status": "modified", "renamed_from": None, "category": "raw_sql"}
            for p in all_sql
        ]}
    elif args.mode == "diff":
        if not (args.base and args.head):
            ap.error("--mode diff requires --base and --head")
        detector_result = run_detector(["--git-diff", args.base, args.head])
    else:  # staged
        detector_result = run_detector(["--git-staged"])

    relevant = detector_result.get("relevant", [])
    if not relevant:
        print(json.dumps({"result": "no_schema_change", "findings": []}, indent=2))
        return 3

    report = judge_files(relevant, args.mode, args.base, args.head)
    blocking, warnings = report["findings"], report["warnings"]
    output = {
        # "result" stays pass/fail (exit 0/1); "outcome" adds "warn" for a pass
        # that still has warnings.
        "result": "fail" if blocking else "pass",
        "outcome": "fail" if blocking else ("warn" if warnings else "pass"),
        **report,
        "summary": summary_text(report),
    }

    if args.markdown:
        print(markdown_report(output))
    else:
        print(json.dumps(output, indent=2))

    return 1 if blocking else 0


def markdown_report(output: dict) -> str:
    def line(f: dict) -> str:
        return (f"- **{f['standard']}** ({f['confidence']}) `{f['path']}`"
                + (f" table `{f['table']}`" if f.get("table") else "") + f": {f['finding']}")

    lines = []
    if output["findings"]:
        lines += ["**Blocking**", ""] + [line(f) for f in output["findings"]] + [""]
    else:
        lines += ["No blocking findings.", ""]
    if output["warnings"]:
        lines += ["**Warnings (did not block)**", ""] + [line(f) for f in output["warnings"]] + [""]
        whys = {}
        for f in output["warnings"]:
            whys.setdefault(f["check"], f.get("why") or "")
        lines += ["_Why these only warn:_", ""] + [f"- `{c}`: {w}" for c, w in whys.items() if w] + [""]
    if output["existing"]:
        lines.append(f"_{len(output['existing'])} problem(s) were already in the changed file(s) before this "
                     "change. They are not caused by it and do not block._")
    return "\n".join(lines).rstrip()


if __name__ == "__main__":
    sys.exit(main())
