#!/usr/bin/env python3
"""Deterministic schema-change detector — the one thing every enforcement layer
(Claude PreToolUse gate, a local Git hook, CI) calls to decide "is this diff
schema-relevant at all", so none of them can disagree about what counts. See
reference/detection-guidance.md for the full definition this script implements.

Usage:
    # From a git diff between two refs (base..head, or a staged diff)
    python3 detect_schema_changes.py --git-diff HEAD~1 HEAD
    python3 detect_schema_changes.py --git-staged

    # From an explicit file list (no git required)
    python3 detect_schema_changes.py --files path/a.sql path/b.py

    # Respect a repo-local override
    python3 detect_schema_changes.py --config .data-standards.json --git-staged

Exit code: 0 if it ran successfully (regardless of whether anything was
detected as relevant — "no relevant changes" is reported in the JSON, not via
exit code, since this script's job is detection, not the blocking decision;
that's validate_schema.py's job). Exit 2 on a genuine detector error (bad
config, git not available when --git-* was requested).

Output: JSON to stdout — {"relevant": [...], "excluded": [...], "ambiguous": [...]}
Each entry: {"path": str, "status": "added"|"modified"|"deleted"|"renamed",
             "renamed_from": str|None, "category": str|None}
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_INCLUDE = [
    "**/*.sql",
    "**/migrations/**",
    "**/*migration*.py",
    "**/*_migration.rb",
    "**/db/migrate/**",
    "**/supabase/**/*.sql",
    "**/supabase/migrations/**",
    "**/schema.prisma",
    "**/models.py",
    "**/*.entity.ts",
    "**/knexfile.*",
]

DEFAULT_EXCLUDE = [
    ".git/**",
    ".env",
    ".env.*",
    "node_modules/**",
    "vendor/**",
    ".venv/**",
    "venv/**",
    "dist/**",
    "build/**",
    "target/**",
    "__pycache__/**",
    "*.pyc",
    "*.lock",
    "package-lock.json",
    "yarn.lock",
    "poetry.lock",
    "*.pem",
    "*.key",
    "*_rsa",
    "*_rsa.pub",
    "id_rsa*",
    "credentials.json",
    "service-account*.json",
    "*.dump",
    "*.sql.gz",
]

# A .sql file is a probable data dump (not schema) if, after stripping DDL
# lines, most of what's left is INSERT/COPY value rows rather than structure.
DDL_LINE = re.compile(r"^\s*(CREATE|ALTER|DROP)\s+(TABLE|INDEX|TYPE|VIEW|SCHEMA)\b", re.IGNORECASE)
DATA_LINE = re.compile(r"^\s*(INSERT\s+INTO|COPY\s+\S+\s+FROM)\b", re.IGNORECASE)


def load_config(path: Path | None) -> tuple[list[str], list[str]]:
    include, exclude = list(DEFAULT_INCLUDE), list(DEFAULT_EXCLUDE)
    if path is None:
        default_cfg = Path(".data-standards.json")
        path = default_cfg if default_cfg.exists() else None
    if path is None:
        return include, exclude
    try:
        cfg = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"Couldn't read config {path}: {e}", file=sys.stderr)
        sys.exit(2)
    if "include" in cfg:
        include = cfg["include"]
    if "exclude" in cfg:
        exclude = exclude + cfg.get("exclude", [])
    return include, exclude


def matches_any(path: str, patterns: list[str]) -> bool:
    # fnmatch doesn't natively support "**" the way glob does across path
    # separators, so normalize "**/" prefixes to also match a bare basename
    # at any depth — good enough for our fixed pattern set without pulling in
    # a full glob-matching dependency.
    norm = path.replace("\\", "/")
    for pat in patterns:
        if fnmatch.fnmatch(norm, pat):
            return True
        if pat.startswith("**/") and fnmatch.fnmatch(norm, pat[3:]):
            return True
        if fnmatch.fnmatch("/" + norm, "*/" + pat.lstrip("*/")):
            return True
    return False


def classify_category(path: str) -> str | None:
    # Bracket with "/" on both sides (and a leading "/" prepended to norm) so a
    # repo-root folder like "migrations/001_init.sql" matches the same as a
    # nested "db/migrations/001_init.sql" — a bare substring check for
    # "/migrations/" misses the root-level case, since there's no leading "/"
    # to match against.
    norm = "/" + path.replace("\\", "/")
    if "supabase" in norm and norm.endswith(".sql"):
        return "supabase"
    if "/migrations/" in norm or "/migrate/" in norm or "migration" in Path(norm).name.lower():
        return "migration"
    if norm.endswith(".sql"):
        return "raw_sql"
    if norm.endswith("schema.prisma") or norm.endswith("models.py") or norm.endswith(".entity.ts"):
        return "orm_schema"
    if "knexfile" in Path(norm).name:
        return "orm_schema"
    return None


def looks_like_data_dump(text: str) -> bool | None:
    """True = looks like a data dump. False = looks like schema. None =
    genuinely ambiguous (too little signal either way) — caller reports
    NOT ASSESSED rather than guessing."""
    lines = [l for l in text.splitlines() if l.strip()]
    if not lines:
        return None
    ddl = sum(1 for l in lines if DDL_LINE.match(l))
    data = sum(1 for l in lines if DATA_LINE.match(l))
    if ddl == 0 and data == 0:
        return None
    if data > 5 and data > ddl * 2:
        return True
    return False


def git_changed_files(args: list[str]) -> list[tuple[str, str, str | None]]:
    """Returns (status, path, renamed_from) tuples from git diff --name-status."""
    try:
        result = subprocess.run(
            ["git", "diff", "--name-status", "-M", *args],
            capture_output=True, text=True, check=True,
        )
    except FileNotFoundError:
        print("git not found — use --files for a git-free file list instead", file=sys.stderr)
        sys.exit(2)
    except subprocess.CalledProcessError as e:
        print(f"git diff failed: {e.stderr.strip()}", file=sys.stderr)
        sys.exit(2)

    out = []
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        code = parts[0]
        if code.startswith("R"):
            status = "renamed"
            renamed_from, path = parts[1], parts[2]
        elif code == "A":
            status, renamed_from, path = "added", None, parts[1]
        elif code == "D":
            status, renamed_from, path = "deleted", None, parts[1]
        else:  # M and anything else structural
            status, renamed_from, path = "modified", None, parts[1]
        out.append((status, path, renamed_from))
    return out


def read_file_at_ref(path: str, ref: str | None) -> str:
    """Read a file's content for the dump-heuristic — from the working tree if
    ref is None, else from a git ref via `git show`. Missing/unreadable file
    returns "" (treated as ambiguous, never as a crash)."""
    if ref is None:
        p = Path(path)
        try:
            return p.read_text(encoding="utf-8", errors="replace") if p.exists() else ""
        except OSError:
            return ""
    try:
        result = subprocess.run(["git", "show", f"{ref}:{path}"], capture_output=True, text=True)
        return result.stdout if result.returncode == 0 else ""
    except FileNotFoundError:
        return ""


def detect(changes: list[tuple[str, str, str | None]], include: list[str], exclude: list[str],
           content_ref: str | None) -> dict:
    relevant, excluded, ambiguous = [], [], []
    for status, path, renamed_from in changes:
        entry = {"path": path, "status": status, "renamed_from": renamed_from, "category": None}

        if matches_any(path, exclude):
            excluded.append(entry)
            continue
        if not matches_any(path, include):
            excluded.append(entry)
            continue

        entry["category"] = classify_category(path)

        if entry["category"] == "raw_sql" and status != "deleted":
            text = read_file_at_ref(path, content_ref)
            dump = looks_like_data_dump(text)
            if dump is True:
                excluded.append({**entry, "reason": "looks like a data dump, not schema"})
                continue
            if dump is None and text:
                ambiguous.append({**entry, "reason": "ambiguous schema/dump content"})
                continue

        relevant.append(entry)

    return {"relevant": relevant, "excluded": excluded, "ambiguous": ambiguous}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--git-diff", nargs=2, metavar=("BASE", "HEAD"), help="git diff between two refs")
    src.add_argument("--git-staged", action="store_true", help="git diff of staged changes")
    src.add_argument("--files", nargs="+", metavar="PATH", help="explicit file list, no git")
    ap.add_argument("--config", type=Path, default=None, help="path to .data-standards.json override")
    args = ap.parse_args()

    include, exclude = load_config(args.config)

    if args.files:
        changes = [("modified", f, None) for f in args.files]
        content_ref = None
    elif args.git_staged:
        changes = git_changed_files(["--cached"])
        content_ref = None  # working/staged tree — read from disk
    else:
        base, head = args.git_diff
        changes = git_changed_files([base, head])
        content_ref = head

    result = detect(changes, include, exclude, content_ref)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
