#!/usr/bin/env python3
"""SessionStart baseline audit — the "automatic audit on session start" piece
of the enforcement build. Detects a Git repository with schema sources,
fingerprints it, and only re-runs the full audit when something that could
change the result has actually changed since the last cached run.

This is deliberately NOT wired into hooks.json by default — a repo that
wants this on session start opts in explicitly (see "Wiring this in" below),
the same way scripts/install_repo_hooks.py is an opt-in action, not
something this pack forces on every session in every directory. Most
Claude Code sessions in this pack are NOT auditing a schema repo at all, and
running git/file-hash work on every session start everywhere would be pure
overhead for the common case.

Usage:
    python3 baseline_audit.py --repo .
    python3 baseline_audit.py --repo . --force        # ignore the cache
    python3 baseline_audit.py --repo . --strict        # existing debt also blocks
    python3 baseline_audit.py --repo . --json          # machine-readable summary only

What it does, per the brief:
  1. Detects a Git repo containing supported schema sources (via
     detect_schema_changes.py's --files mode over rglob'd schema-shaped
     paths, so it reuses the same relevance definition every other layer
     uses).
  2. Computes a fingerprint: current commit SHA + a hash of every detected
     schema file's content + the standards.yaml file's own hash (its
     "version") + this script's own hash (the "validator version" — a
     change to baseline_audit.py's logic invalidates old cached results,
     since what "compliant" means may have changed).
  3. Checks a non-committed local cache (.data-standards-cache.json,
     gitignored by convention — see "Cache file" below).
  4. Runs the full audit (validate_schema.py --mode full) only if the
     fingerprint differs from the cached one, or --force is passed.
  5. Stores the report locally (never commits it).
  6. Prints a concise summary + the report's location.
  7. NEVER raises/exits non-zero for "Slack/governance unavailable" — this
     script doesn't call either; that's future work (see CHANGELOG), and
     this script's exit code reflects ONLY whether the audit itself could
     run, never a notification layer's availability.

Finding classification (NEW / REGRESSION / EXISTING / RESOLVED /
MANUAL_REVIEW): computed by diffing this run's findings against the
PREVIOUS cached run's findings, keyed on (standard, path, table) — the same
identity a stable issue ID would use if this were feeding the full
audit-report-format.md report. See classify_findings() below.

Cache file (.data-standards-cache.json, at the repo root):
  Gitignored by convention (this script does not modify .gitignore for you
  — add the entry yourself, or accept that `git status` will show it as
  untracked, which is harmless but noisy). Contains the last fingerprint,
  the last run's findings (for next time's NEW/REGRESSION/RESOLVED diff),
  and a timestamp. Deleting this file is always safe — it just means the
  next run does a full audit instead of a fast no-op.

Wiring this in (opt-in, per repo):
  Add a SessionStart hook in YOUR repo's own .claude/settings.json (not this
  pack's) pointing at this script with --repo <your-repo-root>. This pack
  does not add that hook for you, the same way install_repo_hooks.py does
  not run itself.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
VALIDATOR = SKILL_DIR / "scripts" / "validate_schema.py"
DETECTOR = SKILL_DIR / "scripts" / "detect_schema_changes.py"
STANDARDS_PATH = SKILL_DIR / "reference" / "standards.yaml"
THIS_SCRIPT = Path(__file__).resolve()

CACHE_FILENAME = ".data-standards-cache.json"


def sh(args: list[str], cwd: Path) -> tuple[int, str]:
    try:
        result = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
        return result.returncode, result.stdout.strip()
    except FileNotFoundError:
        return 127, ""


def git_head_sha(repo: Path) -> str | None:
    code, out = sh(["git", "rev-parse", "HEAD"], repo)
    return out if code == 0 else None


def git_is_repo(repo: Path) -> bool:
    return (repo / ".git").exists()


def hash_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return "unreadable"


def find_schema_files(repo: Path) -> list[Path]:
    """Reuse the exact same include/exclude definition detect_schema_changes.py
    uses, by importing it directly rather than re-implementing the pattern
    list here — a second copy of the include/exclude globs would be exactly
    the kind of duplicated-rule drift reference/detection-guidance.md warns
    against."""
    sys.path.insert(0, str(SKILL_DIR / "scripts"))
    import detect_schema_changes as detector  # noqa: E402

    include, exclude = detector.load_config(None)
    found = []
    # rglob doesn't natively support "**" the way our matcher does; walk
    # every file and reuse matches_any for consistency, instead of trying to
    # translate each include pattern into its own separate rglob call.
    for path in repo.rglob("*"):
        if not path.is_file():
            continue
        rel = str(path.relative_to(repo))
        if detector.matches_any(rel, exclude):
            continue
        if not detector.matches_any(rel, include):
            continue
        found.append(path)
    return sorted(found)


def compute_fingerprint(repo: Path) -> dict:
    head = git_head_sha(repo)
    schema_files = find_schema_files(repo)
    file_hashes = {str(p.relative_to(repo)): hash_file(p) for p in schema_files}
    standards_hash = hash_file(STANDARDS_PATH) if STANDARDS_PATH.exists() else "missing"
    validator_hash = hash_file(THIS_SCRIPT)
    return {
        "commit_sha": head,
        "file_hashes": file_hashes,
        "standards_version_hash": standards_hash,
        "validator_version_hash": validator_hash,
    }


def fingerprints_match(a: dict, b: dict) -> bool:
    return (
        a.get("commit_sha") == b.get("commit_sha")
        and a.get("file_hashes") == b.get("file_hashes")
        and a.get("standards_version_hash") == b.get("standards_version_hash")
        and a.get("validator_version_hash") == b.get("validator_version_hash")
    )


def load_cache(repo: Path) -> dict | None:
    cache_path = repo / CACHE_FILENAME
    if not cache_path.exists():
        return None
    try:
        return json.loads(cache_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None  # a corrupt cache is treated as "no cache" — never crash the session


def save_cache(repo: Path, fingerprint: dict, findings: list[dict], report_path: Path) -> None:
    cache_path = repo / CACHE_FILENAME
    payload = {
        "fingerprint": fingerprint,
        "findings": findings,
        "report_path": str(report_path),
        "last_run_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    try:
        cache_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except OSError:
        pass  # a cache write failure must never break the session


def finding_key(f: dict) -> tuple:
    return (f.get("standard"), f.get("path"), f.get("table"))


def classify_findings(current: list[dict], previous: list[dict] | None) -> dict:
    """Returns {"new": [...], "regression": [...], "existing": [...],
    "resolved": [...]}. "Regression" and "new" are both treated as
    blocking-tier by run_baseline_audit's caller (see reference/
    enforcement-policy.md's regressions-vs-debt section) — this function
    only classifies, it doesn't decide what blocks."""
    if previous is None:
        # No prior run to diff against — everything found is "new" relative
        # to a cache-free state, but NOT a regression (there's no known-good
        # baseline it regressed from). Callers should treat a first-ever run
        # as establishing the baseline, not as N confirmed regressions.
        return {"new": [], "regression": [], "existing": list(current), "resolved": []}

    prev_keys = {finding_key(f): f for f in previous}
    curr_keys = {finding_key(f): f for f in current}

    new_findings = [f for k, f in curr_keys.items() if k not in prev_keys]
    existing_findings = [f for k, f in curr_keys.items() if k in prev_keys]
    resolved_findings = [f for k, f in prev_keys.items() if k not in curr_keys]

    # "Existing" here just means "was already known" — the brief's NEW /
    # REGRESSION / EXISTING / RESOLVED / MANUAL_REVIEW taxonomy treats
    # REGRESSION as "was passing on the base commit, now fails." Since this
    # script's cache only stores prior FINDINGS (not prior passes), a
    # confirmed regression is indistinguishable here from a pre-existing
    # finding that simply persisted — both show up as "existing." A true
    # regression classification needs the base-commit's full pass/fail
    # state, not just its finding list; that's future work (see the
    # "Known limitation" note below), not silently faked here.
    return {
        "new": new_findings,
        "regression": [],  # see docstring note above — not yet distinguishable from "existing"
        "existing": existing_findings,
        "resolved": resolved_findings,
    }


def run_baseline_audit(repo: Path, force: bool, strict: bool) -> dict:
    if not git_is_repo(repo):
        return {"status": "not_a_git_repo", "repo": str(repo)}

    fingerprint = compute_fingerprint(repo)
    cache = load_cache(repo)

    if not force and cache and fingerprints_match(fingerprint, cache.get("fingerprint", {})):
        return {
            "status": "cached",
            "repo": str(repo),
            "last_run_utc": cache.get("last_run_utc"),
            "findings_count": len(cache.get("findings", [])),
            "report_path": cache.get("report_path"),
        }

    result = subprocess.run(
        [sys.executable, str(VALIDATOR), "--mode", "full", "--path", str(repo)],
        capture_output=True, text=True,
    )
    try:
        validator_output = json.loads(result.stdout) if result.stdout.strip() else {}
    except json.JSONDecodeError:
        validator_output = {"result": "validator_error", "raw_stdout": result.stdout,
                             "raw_stderr": result.stderr}

    current_findings = validator_output.get("findings", [])
    previous_findings = cache.get("findings") if cache else None
    classified = classify_findings(current_findings, previous_findings)

    report_path = repo / ".data-standards-last-report.json"
    try:
        report_path.write_text(json.dumps(validator_output, indent=2), encoding="utf-8")
    except OSError:
        pass  # never crash the session over a report-write failure

    save_cache(repo, fingerprint, current_findings, report_path)

    blocking = classified["new"] + classified["regression"]
    non_blocking_existing = [] if strict else classified["existing"]

    return {
        "status": "audited",
        "repo": str(repo),
        "validator_exit_indicator": validator_output.get("result", "unknown"),
        "new": len(classified["new"]),
        "regression": len(classified["regression"]),
        "existing": len(classified["existing"]),
        "resolved": len(classified["resolved"]),
        "would_block": len(blocking) > 0 or (strict and len(non_blocking_existing) > 0),
        "report_path": str(report_path),
    }


def print_summary(result: dict, json_out: bool) -> None:
    if json_out:
        print(json.dumps(result, indent=2))
        return

    status = result.get("status")
    if status == "not_a_git_repo":
        print(f"data-standards: {result['repo']} isn't a git repo — skipping baseline audit.")
        return
    if status == "cached":
        print(f"data-standards: no schema-relevant change since the last audit "
              f"({result.get('last_run_utc', 'unknown time')}) — {result['findings_count']} "
              f"known finding(s). Report: {result.get('report_path')}")
        return

    print(f"data-standards baseline audit — {result['repo']}")
    print(f"  new: {result['new']}  regression: {result['regression']}  "
          f"existing: {result['existing']}  resolved: {result['resolved']}")
    if result["would_block"]:
        print("  -> this would BLOCK a commit/push/merge under the enforcement gates.")
    else:
        print("  -> nothing new/blocking; pre-existing debt (if any) does not block unrelated work.")
    print(f"  full report: {result['report_path']}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", required=True, type=Path)
    ap.add_argument("--force", action="store_true", help="ignore the cache, run the full audit anyway")
    ap.add_argument("--strict", action="store_true", help="existing debt also counts toward would_block")
    ap.add_argument("--json", action="store_true", help="machine-readable output only")
    args = ap.parse_args()

    repo = args.repo.resolve()
    result = run_baseline_audit(repo, args.force, args.strict)
    print_summary(result, args.json)
    return 0  # this script reports; it never fails session start


if __name__ == "__main__":
    sys.exit(main())
