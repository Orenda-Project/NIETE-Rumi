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
        return {"standard": "D1", "confirmed": True, "confidence": "MEDIUM",
                "finding": f"table `{table}` has no column named `id` and no explicit "
                            "PRIMARY KEY clause found — confirm it truly has no primary key",
                "evidence": body.strip()[:200]}
    if not re.search(r"\buuid\b", pk_col, re.IGNORECASE):
        return {"standard": "D1", "confirmed": True, "confidence": "HIGH",
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
        return {"standard": "D3", "confirmed": True, "confidence": "MEDIUM",
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
            findings.append({"standard": "D5", "confirmed": True, "confidence": "HIGH",
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
        findings.append({"standard": "D4", "confirmed": True, "confidence": "MEDIUM",
                          "finding": f"table `{table}` column `{col_name}` looks like PII "
                                      f"(matched `{m.group(1)}`) with no classification marker "
                                      "comment (`-- PII` / `-- Restricted-PII` / `-- Confidential`)",
                          "evidence": col.strip()})
    return findings


def check_d8_migration_tool(text: str) -> dict | None:
    low = text.lower()
    if not any(marker in low for marker in MIGRATION_TOOL_MARKERS):
        return {"standard": "D8", "confirmed": True, "confidence": "MEDIUM",
                "finding": "raw CREATE/ALTER TABLE with no migration-tool marker in the same text",
                "evidence": None}
    return None


def check_d8_destructive_without_safety(text: str) -> list[dict]:
    findings = []
    for m in re.finditer(r"(DROP\s+(TABLE|COLUMN)\s+[\w.\"]+|TRUNCATE\s+[\w.\"]+)", text, re.IGNORECASE):
        window = text[max(0, m.start() - 200):m.start()]
        if re.search(r"--\s*destructive:\s*reviewed", window, re.IGNORECASE) or "rollback" in window.lower():
            continue
        findings.append({"standard": "D8", "confirmed": True, "confidence": "HIGH",
                          "finding": f"destructive statement `{m.group(1)}` with no rollback script "
                                      "or `-- destructive: reviewed` marker nearby",
                          "evidence": m.group(1)})
    return findings


def validate_text(path: str, text: str) -> list[dict]:
    """Run every structural check against one file's text, return a flat list
    of finding dicts, each tagged with the source path."""
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

    return findings


# --------------------------------------------------------------- modes

def run_detector(mode_args: list[str]) -> dict:
    result = subprocess.run([sys.executable, str(DETECTOR), *mode_args],
                             capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Detector failed: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(2)
    return json.loads(result.stdout)


def read_files(paths: list[str]) -> dict[str, str]:
    out = {}
    for p in paths:
        fp = Path(p)
        try:
            out[p] = fp.read_text(encoding="utf-8", errors="replace") if fp.exists() else ""
        except OSError:
            out[p] = ""
    return out


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

    files = read_files([e["path"] for e in relevant if e["status"] != "deleted"])
    all_findings = []
    for path, text in files.items():
        all_findings.extend(validate_text(path, text))

    output = {
        "result": "fail" if all_findings else "pass",
        "files_checked": list(files.keys()),
        "findings": all_findings,
    }

    if args.markdown:
        lines = [f"# Schema validation — {output['result'].upper()}", ""]
        for f in all_findings:
            lines.append(f"- **{f['standard']}** ({f['confidence']}) `{f['path']}`"
                          + (f" table `{f['table']}`" if f.get("table") else "")
                          + f": {f['finding']}")
        print("\n".join(lines) if all_findings else "No blocking findings.")
    else:
        print(json.dumps(output, indent=2))

    return 1 if all_findings else 0


if __name__ == "__main__":
    sys.exit(main())
