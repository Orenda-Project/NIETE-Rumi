#!/usr/bin/env python3
"""Frozen-schema validation + append helpers for the E2E ledgers.

Hand-rolled validation (jsonschema is NOT installed). Schemas mirror
docs/superpowers/specs/2026-08-04-e2e-discovery-loop-design.md §5.
runs.jsonl is append-only and never rewritten; a bad row is never appended. Every row is scrubbed
(phones masked, home paths made relative) on the way in; see scrub().
"""
import json
import os
import re
import subprocess

RUN_STATUSES = {"HEALTHY", "DEGRADED", "CRITICAL"}
DRIFT_VERDICTS = {"pending", "intended", "bug"}
ASSERTION_KINDS = {"contract", "copy"}


def verdict(passed, failed=0, blocked=0):
    """The ONE place the run-status rule lives (was hand-copied ~24x across agents/command).
    CRITICAL: any blocked, or 3+ failed. DEGRADED: 1-2 failed. HEALTHY: otherwise.
    Mirrors /niete-e2e §3 and the runs-ledger ternaries in the per-feature agents."""
    if blocked or failed >= 3:
        return "CRITICAL"
    if failed >= 1:
        return "DEGRADED"
    return "HEALTHY"


def status_reason(row):
    """Why a run row got its status, in words, from its own counts. CRITICAL alone reads like a break,
    but most CRITICAL rows have no failure at all: any BLOCKED scenario makes a run CRITICAL, and every
    feature has scenarios this lane cannot drive. '' for a HEALTHY row."""
    s = row.get("summary") or {}
    failed, blocked, total = int(s.get("failed") or 0), int(s.get("blocked") or 0), int(s.get("total") or 0)
    misses = int((row.get("cassette") or {}).get("misses") or 0)
    parts = []
    if failed:
        parts.append("%d failed" % failed)
    if blocked:
        parts.append("%d of %d blocked (not drivable on this lane)" % (blocked, total) if total
                     else "%d blocked (not drivable on this lane)" % blocked)
    if misses:
        parts.append("%d cassette miss%s" % (misses, "" if misses == 1 else "es"))
    return " · ".join(parts)

_RUN_STR = ["run_id", "ts", "surface", "tenant", "env", "method", "feature",
            "status", "evidence_dir"]
_RUN_INT = ["duration_ms", "drift_count", "discovery_count"]
_SUMMARY_INT = ["total", "passed", "failed", "blocked"]
_COVERAGE_INT = ["scenarios", "surface_observed", "uncovered"]


def _require(row, key, typ, probs, prefix=""):
    full = prefix + key
    if key not in row:
        probs.append("missing key: %s" % full)
    elif not isinstance(row[key], typ) or (typ is int and isinstance(row[key], bool)):
        probs.append("%s must be %s" % (full, typ.__name__))


def validate_run(row):
    probs = []
    if not isinstance(row, dict):
        return ["run row must be an object"]
    for k in _RUN_STR:
        _require(row, k, str, probs)
    if "commit" in row and not isinstance(row["commit"], str):
        probs.append("commit must be str")
    for k in _RUN_INT:
        _require(row, k, int, probs)
    if row.get("status") not in RUN_STATUSES:
        probs.append("status must be one of %s" % sorted(RUN_STATUSES))
    for name, keys in (("summary", _SUMMARY_INT), ("coverage", _COVERAGE_INT)):
        sub = row.get(name)
        if not isinstance(sub, dict):
            probs.append("missing object: %s" % name)
            continue
        for k in keys:
            _require(sub, k, int, probs, prefix=name + ".")
    return probs


def validate_drift(row):
    probs = []
    if not isinstance(row, dict):
        return ["drift row must be an object"]
    for k in ["run_id", "ts", "scenario", "step", "evidence"]:
        _require(row, k, str, probs)
    if "expected" not in row:
        probs.append("missing key: expected")
    if "actual" not in row:
        probs.append("missing key: actual")
    if row.get("assertion_kind") not in ASSERTION_KINDS:
        probs.append("assertion_kind must be one of %s" % sorted(ASSERTION_KINDS))
    if row.get("verdict") not in DRIFT_VERDICTS:
        probs.append("verdict must be one of %s" % sorted(DRIFT_VERDICTS))
    return probs


# The repo is public (bd-5gyspy.3): rows carried the live driver's phone and the machine path
# of the worktree a run came from. Every row is scrubbed on the way in, whoever writes it.
# Phone: a 92-prefixed (a + is kept) or 03 local mobile -> 92 + five dots + its last 4 digits.
_PHONE = re.compile(r"(?<!\d)(\+?)(?:92|0)(3\d{5})(\d{4})(?!\d)")
_MASK = "92\u2022\u2022\u2022\u2022\u2022"
# Home directory (/Users/ or /home/ + a user name; folder names may hold spaces):
#   - anything up to a worktree becomes workspace-relative: .claude/worktrees/<wt>/...
#   - a value that IS a home path keeps only its last two segments: ~/.../<a>/<b>
#   - a home directory inside free text loses the user name: ~/...
_TO_WORKTREE = re.compile(r"/(?:Users|home)/[^/\"'\n]+/(?:[^\"'\n]*?/)?(?=\.claude/worktrees/)")
_HOME_VALUE = re.compile(r"/(?:Users|home)/[^/]+(/.*)?", re.S)
_HOME_IN_TEXT = re.compile(r"/(?:Users|home)/[^/\s\"']+")


def _scrub_str(s):
    s = _PHONE.sub(lambda m: m.group(1) + _MASK + m.group(3), s)
    s = _TO_WORKTREE.sub("", s)
    m = _HOME_VALUE.fullmatch(s)
    if m:
        rest = m.group(1) or ""
        tail = [p for p in rest.split("/") if p][-2:]
        return "~/\u2026/" + "/".join(tail) + ("/" if rest.endswith("/") and tail else "")
    return _HOME_IN_TEXT.sub("~", s)


def scrub(value):
    """A copy of a row with every phone masked and every home-directory path made relative. Idempotent."""
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items()}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, str):
        return _scrub_str(value)
    if isinstance(value, int) and not isinstance(value, bool) and _PHONE.fullmatch(str(value)):
        return _scrub_str(str(value))
    return value


def _append(row, path, validator):
    row = scrub(row)
    probs = validator(row)
    if probs:
        raise ValueError("; ".join(probs))
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def _head_of(path):
    """Short sha of the checkout the ledger file lives in; '' outside a repo."""
    d = os.path.dirname(os.path.abspath(path)) or "."
    while d and not os.path.isdir(d):          # the ledger dir may not exist yet
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    try:
        r = subprocess.run(["git", "-C", d, "rev-parse", "--short=12", "HEAD"],
                           capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return ""
    return r.stdout.strip() if r.returncode == 0 else ""


def append_run(row, path):
    """Append one run row. Stamps `commit` (HEAD of the checkout holding the ledger)
    unless the caller set it — added 2026-09-09 so a proof row can be tied to the
    build it drove: impact.py's "row added in the range" check could not tell a run
    against an older build from a run against the change. Additive: readers of the
    frozen schema ignore keys they do not know."""
    if isinstance(row, dict) and "commit" not in row:
        sha = _head_of(path)
        if sha:
            row = dict(row, commit=sha)
    _append(row, path, validate_run)


def append_drift(row, path):
    _append(row, path, validate_drift)
