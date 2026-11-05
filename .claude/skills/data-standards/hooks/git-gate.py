#!/usr/bin/env python3
"""Git hooks for BOTH data gates — data-standards and data-quality-gate — on
every commit and every push, whatever made it: a terminal, an IDE, GitHub
Desktop, or a Claude Code session.

Why git hooks as well as the Claude Code hooks: a Claude PreToolUse hook only
sees commits Claude makes, and it runs BEFORE the command — so in
`git add x && git commit` nothing is staged yet when it looks, and the commit
goes through unchecked. A real pre-commit hook runs after staging, on exactly
what is being committed.

    git-gate.py pre-commit    check the staged schema/migration files; exit 1 blocks the commit
    git-gate.py post-commit   report the pre-commit verdict with the NEW commit's hash
    git-gate.py pre-push      check every schema/migration file the pushed commits change

Installed by scripts/install_git_hooks.py as thin .githooks/ wrappers. Every
run prints one result line, so a commit that shows no line was not checked.

Reporting: Slack (each gate's own notify.py) and the data-gate board (the
shared governance sender), both fire-and-forget — a notification can never
slow a commit down or change whether it is blocked. A blocked commit is
reported at once (it never gets a hash); a passing one after it lands, by
post-commit.

Bypass: the same validated-reason mechanism as every other gate in this pack —
export TALEEMABAD_DATA_STANDARDS_BYPASS="<ticket, incident, or named approver>"
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HOOK_DIR = Path(__file__).resolve().parent
DS_DIR = HOOK_DIR.parent
DS_SCRIPTS = DS_DIR / "scripts"
VALIDATOR = DS_SCRIPTS / "validate_schema.py"
DETECTOR = DS_SCRIPTS / "detect_schema_changes.py"
BYPASS_AUDIT = DS_SCRIPTS / "bypass_audit.py"
DS_NOTIFY = DS_SCRIPTS / "notify.py"
# data-quality-gate is always a sibling skill folder, however deep skills/ sits.
DQG_DIR = DS_DIR.parent / "data-quality-gate"
SHAPE_GATE = DQG_DIR / "hooks" / "live-schema-shape-gate.py"
DQG_NOTIFY = DQG_DIR / "scripts" / "notify.py"

MARKER_NAME = "data-gates-pending-commit.json"
BYPASS_VAR = "TALEEMABAD_DATA_STANDARDS_BYPASS"


# ── git and output helpers ─────────────────────────────────────────────────

def git(*args: str) -> str:
    try:
        return subprocess.run(["git", *args], capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=30).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def say(line: str = "") -> None:
    """Hook output goes to stderr, which git shows in every terminal and IDE."""
    try:
        print(line, file=sys.stderr, flush=True)
    except UnicodeEncodeError:
        print(line.encode("ascii", "replace").decode("ascii"), file=sys.stderr, flush=True)


def actor() -> str:
    return (os.environ.get("TALEEMABAD_USER_EMAIL") or git("config", "user.email")
            or os.environ.get("USER") or os.environ.get("USERNAME") or "unknown")


def repo_name() -> str:
    top = git("rev-parse", "--show-toplevel")
    return Path(top).name if top else Path.cwd().name


def marker_path() -> Path | None:
    git_dir = git("rev-parse", "--git-dir")
    return Path(git_dir) / MARKER_NAME if git_dir else None


def schema_files(detector_args: list[str]) -> list[str]:
    """Paths the shared detector classes as schema/migration files. Deleted
    files are left out: there is no content left to check."""
    try:
        proc = subprocess.run([sys.executable, str(DETECTOR), *detector_args],
                              capture_output=True, text=True, timeout=60)
        result = json.loads(proc.stdout or "{}")
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return []
    return [f["path"] for f in result.get("relevant", []) if f.get("status") != "deleted"]


# ── the two gates ──────────────────────────────────────────────────────────

def bypass_reason_if_valid() -> str:
    reason = os.environ.get(BYPASS_VAR, "")
    if not reason:
        return ""
    check = subprocess.run([sys.executable, str(BYPASS_AUDIT), "--check", reason],
                           capture_output=True, text=True)
    if check.returncode == 0:
        return reason
    say(f"  {BYPASS_VAR} was set but its reason was rejected — {check.stdout.strip()}")
    return ""


def run_data_standards(validator_args: list[str]) -> dict:
    """{"result": PASS|WARN|FAIL|BYPASSED|ERROR|NONE, "findings": [...], "warnings": [...],
    "files": [...], "summary": ..., "reason": ...} — WARN is a pass with warnings: it never blocks."""
    proc = subprocess.run([sys.executable, str(VALIDATOR), *validator_args],
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode == 3:
        return {"result": "NONE", "findings": [], "files": []}
    try:
        report = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        report = {}
    verdict = {"findings": report.get("findings", []), "warnings": report.get("warnings", []),
               "existing": len(report.get("existing", [])), "summary": report.get("summary", ""),
               "files": report.get("files_checked", [])}
    if proc.returncode == 0:
        return {**verdict, "result": "WARN" if verdict["warnings"] else "PASS"}
    reason = bypass_reason_if_valid()
    if reason:
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            tmp.write(proc.stdout or "{}")
        subprocess.run([sys.executable, str(BYPASS_AUDIT), "--record", "--repo", ".",
                        "--reason", reason, "--actor", actor(), "--findings-json", tmp.name],
                       capture_output=True, text=True)
        Path(tmp.name).unlink(missing_ok=True)
        return {**verdict, "result": "BYPASSED", "reason": reason}
    if proc.returncode == 2:
        return {**verdict, "result": "ERROR", "error": (proc.stdout + proc.stderr).strip()[-2000:]}
    return {**verdict, "result": "FAIL"}


def run_data_quality_gate(files: list[str], content_of) -> dict:
    """Run data-quality-gate's schema-shape check on each file's content as it
    will be committed/pushed, with that gate's own reporting switched off."""
    if not SHAPE_GATE.is_file():
        return {"result": "NONE", "findings": [], "files": [], "missing": True}
    top = git("rev-parse", "--show-toplevel") or str(Path.cwd())
    env = {**os.environ, "TALEEMABAD_GATE_REPORT": "0"}
    blocked, bypassed, problems = [], "", []
    for path in files:
        event = {"tool_name": "Write",
                 "tool_input": {"file_path": str(Path(top) / path), "content": content_of(path)}}
        proc = subprocess.run([sys.executable, str(SHAPE_GATE)], input=json.dumps(event),
                              capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
        if proc.returncode == 2:
            blocked.append(path)
            problems += [line.strip() for line in proc.stderr.splitlines()
                         if line.startswith("  ") and "(" in line and ":" in line]
        elif "BYPASSED" in proc.stdout:
            bypassed = os.environ.get(BYPASS_VAR, "")
    if blocked:
        return {"result": "FAIL", "files": files, "blocked": blocked, "problems": problems}
    if bypassed:
        return {"result": "BYPASSED", "files": files, "reason": bypassed}
    return {"result": "PASS", "files": files}


# ── reporting ──────────────────────────────────────────────────────────────

def _spawn(cmd: list[str]) -> None:
    try:
        kwargs = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL, "stdin": subprocess.DEVNULL}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        else:
            kwargs["start_new_session"] = True
        subprocess.Popen(cmd, **kwargs)
    except OSError:
        pass


def finding_text(gate: str, verdict: dict) -> list[str]:
    """One "- ..." line per finding, as printed and as sent to the board."""
    if gate == "data-standards":
        line = lambda f: (f"{f.get('standard')} {f.get('path')}"  # noqa: E731
                          + (f" table {f['table']}" if f.get("table") else "") + f": {f.get('finding')}")
        return ([f"- {line(f)}" for f in verdict.get("findings", [])]
                + [f"- WARNING (did not block): {line(f)}" for f in verdict.get("warnings", [])])
    return [f"- {line}" for line in verdict.get("problems", [])]


# The board counts a result starting "PASS" as a pass, so a pass with warnings
# is sent as one (as data-quality-gate's "PASS WITH VERIFIED EVIDENCE" is).
BOARD_RESULT = {"WARN": "PASS WITH WARNINGS"}


def report(gate: str, verdict: dict, commit: str, branch: str, stage: str) -> None:
    """Slack + data-gate board for one gate's verdict. Fire-and-forget.

    NOT APPLICABLE (the gate ran, but nothing in the commit/push was a schema
    file) goes to the board only: it proves the gate ran, but most commits
    touch no schema, and posting each one would bury the real results."""
    result, who, repo = verdict["result"], actor(), repo_name()
    files = verdict.get("files", [])
    reason = verdict.get("reason", "")
    issue_ids: list[str] = []
    if result == "NOT APPLICABLE":
        gov_repo = repo if gate == "data-standards" else f"data-quality-gate:{repo}"
    elif gate == "data-standards":
        issue_ids = sorted({f.get("standard", "") for f in verdict.get("findings", []) if f.get("standard")})
        event = {"PASS": "pass", "WARN": "warn", "BYPASSED": "bypass"}.get(result, "validation_failure")
        text = f"{result} ({stage})" + (f": {reason}" if reason else "")
        _spawn([sys.executable, str(DS_NOTIFY), "slack", "--event", event, "--repo", repo,
                "--branch", branch, "--commit", commit, "--actor", who, "--result", text,
                *(["--changed-objects", ",".join(files)] if files else []),
                *(["--summary", verdict["summary"]] if verdict.get("summary") and result != "PASS" else [])])
        gov_repo = repo
    else:
        if result == "PASS":
            _spawn([sys.executable, str(DQG_NOTIFY), "--event", "pass", "--repo", repo, "--branch", branch,
                    "--commit", commit, "--actor", who, "--affected-object", ", ".join(files),
                    "--rationale", f"Checked at {stage} — no blocking schema-shape findings."])
        else:
            rationale = f"Caught at {stage}." + (f" BYPASSED — {reason}" if reason else "")
            _spawn([sys.executable, str(DQG_NOTIFY), "--event", "block", "--repo", repo, "--branch", branch,
                    "--commit", commit, "--actor", who,
                    "--affected-object", ", ".join(verdict.get("blocked", files)),
                    "--detected-change", "; ".join(verdict.get("problems", []))[:1500] or result,
                    "--rationale", rationale])
        gov_repo = f"data-quality-gate:{repo}"
    gov = [sys.executable, str(DS_NOTIFY), "governance", "--repo", gov_repo, "--branch", branch,
           "--head-sha", commit, "--actor", who, "--result", BOARD_RESULT.get(result, result),
           "--report-ref", stage]
    if files:
        gov += ["--changed-files", ",".join(files)]
    if issue_ids:
        gov += ["--issue-ids", ",".join(issue_ids)]
    if result != "PASS" and result != "NOT APPLICABLE":
        summary = verdict.get("summary") or "; ".join(line[2:] for line in finding_text(gate, verdict))
        if summary:
            gov += ["--summary", summary]
    if reason:
        gov += ["--bypass-reason", reason]
    _spawn(gov)


# ── printing a verdict ─────────────────────────────────────────────────────

LABEL = {"data-standards": "DATA STANDARDS", "data-quality-gate": "DATA QUALITY GATE"}


def print_verdict(gate: str, verdict: dict, where: str) -> None:
    label, result = LABEL[gate], verdict["result"]
    n = len(verdict.get("files", []))
    if result == "PASS":
        say(f"✓ {label}: {n} schema file(s) {where} — PASS")
    elif result == "WARN":
        say(f"⚠ {label}: {n} schema file(s) {where} — PASS with warnings (these do not block):")
        whys = {}
        for f in verdict.get("warnings", []):
            table = f" table `{f['table']}`" if f.get("table") else ""
            say(f"    {f.get('standard')}  {f.get('path')}{table}: {f.get('finding')}")
            whys.setdefault(f.get("check"), f.get("why"))
        for check, why in whys.items():
            if why:
                say(f"    why {check} only warns: {why}")
    elif result == "BYPASSED":
        say(f"⚠ {label}: violations BYPASSED with a recorded reason — {verdict.get('reason', '')}")
    elif result == "ERROR":
        say(f"✗ {label}: the validator could not run — blocking rather than letting this through unchecked")
        say("    " + verdict.get("error", "").replace("\n", "\n    "))
    elif result == "FAIL":
        say(f"✗ {label}: BLOCKED — violations {where}:")
        for f in verdict.get("findings", []):
            table = f" table `{f['table']}`" if f.get("table") else ""
            say(f"    {f.get('standard')}  {f.get('path')}{table}: {f.get('finding')}")
        for line in verdict.get("problems", []):
            say(f"    {line}")
        for f in verdict.get("warnings", []):
            say(f"    warning (does not block): {f.get('standard')}  {f.get('path')}: {f.get('finding')}")
    elif verdict.get("missing"):
        say(f"– {label}: not installed alongside data-standards — not checked")


def blocked(*verdicts: dict) -> bool:
    return any(v["result"] in ("FAIL", "ERROR") for v in verdicts)


def print_bypass_help() -> None:
    say("  Fix the finding(s) above, or bypass with an approved reason:")
    say(f'  export {BYPASS_VAR}="<a real reason — ticket, incident, or named approver>"')


# ── hook entry points ──────────────────────────────────────────────────────

def pre_commit() -> int:
    marker = marker_path()
    if marker:
        marker.unlink(missing_ok=True)
    files = schema_files(["--git-staged"])
    if not files:
        say("– data gates: no schema/migration files in this commit — nothing to check")
        if marker:  # recorded on the board after the commit lands, with its hash
            nothing = {"result": "NOT APPLICABLE", "files": []}
            marker.write_text(json.dumps({"parent": git("rev-parse", "HEAD") or "none",
                                          "data-standards": nothing, "data-quality-gate": nothing}),
                              encoding="utf-8")
        return 0
    ds = run_data_standards(["--mode", "staged"])
    dqg = run_data_quality_gate(files, lambda p: git("show", f":{p}"))
    where = "staged for this commit"
    print_verdict("data-standards", ds, where)
    print_verdict("data-quality-gate", dqg, where)

    parent = git("rev-parse", "HEAD") or "none"
    branch = git("rev-parse", "--abbrev-ref", "HEAD") or "unknown"
    if blocked(ds, dqg):
        say("  Commit BLOCKED — nothing was committed.")
        print_bypass_help()
        for gate, v in (("data-standards", ds), ("data-quality-gate", dqg)):
            if v["result"] not in ("NONE",):
                report(gate, v, f"blocked — on top of {parent[:7]}", branch, "commit")
        return 1
    if marker:
        marker.write_text(json.dumps({"parent": parent, "data-standards": ds, "data-quality-gate": dqg}),
                          encoding="utf-8")
    say("  Reporting to Slack and the gate board with the commit number once the commit is made.")
    return 0


def post_commit() -> int:
    marker = marker_path()
    if not marker or not marker.is_file():
        return 0
    try:
        pending = json.loads(marker.read_text(encoding="utf-8"))
    finally:
        marker.unlink(missing_ok=True)
    commit = git("rev-parse", "HEAD")
    if not commit or commit == pending.get("parent"):
        return 0
    branch = git("rev-parse", "--abbrev-ref", "HEAD") or "unknown"
    sent = []
    for gate in ("data-standards", "data-quality-gate"):
        verdict = pending.get(gate) or {}
        if verdict.get("result") in ("PASS", "WARN", "BYPASSED"):
            report(gate, verdict, commit, branch, "commit")
            sent.append(f"{gate} {verdict['result']}")
        elif verdict.get("result") == "NOT APPLICABLE":
            report(gate, verdict, commit, branch, "commit")  # board only, no line printed
    if sent:
        say(f"✓ data gates: commit {commit[:7]} on {branch} reported to Slack and the gate board ({', '.join(sent)})")
    return 0


def _push_base(local_sha: str, remote_sha: str) -> str:
    if remote_sha and set(remote_sha) != {"0"}:
        return remote_sha
    # First push of a branch: compare against where it left the default branch.
    for ref in ("origin/HEAD", "origin/main", "origin/master", "origin/develop"):
        base = git("merge-base", local_sha, ref)
        if base:
            return base
    return ""


def pre_push() -> int:
    rc = 0
    for line in sys.stdin.read().splitlines():
        parts = line.split()
        if len(parts) != 4:
            continue
        _local_ref, local_sha, remote_ref, remote_sha = parts
        if set(local_sha) == {"0"} or not remote_ref.startswith("refs/heads/"):
            continue  # a branch deletion, or a tag
        branch = remote_ref[len("refs/heads/"):]
        base = _push_base(local_sha, remote_sha)
        if not base:
            files = [p for p in git("ls-tree", "-r", "--name-only", local_sha).splitlines()]
            files = schema_files(["--files", *files]) if files else []
            ds_args = ["--mode", "full", "--path", "."]
        else:
            files = schema_files(["--git-diff", base, local_sha])
            ds_args = ["--mode", "diff", "--base", base, "--head", local_sha]
        if not files:
            say(f"– data gates: push to {branch} — no schema/migration files changed, nothing to check")
            nothing = {"result": "NOT APPLICABLE", "files": []}
            for gate in ("data-standards", "data-quality-gate"):
                report(gate, nothing, local_sha, branch, "push")
            continue
        ds = run_data_standards(ds_args)
        dqg = run_data_quality_gate(files, lambda p: git("show", f"{local_sha}:{p}"))
        where = f"changed in this push to {branch}"
        print_verdict("data-standards", ds, where)
        print_verdict("data-quality-gate", dqg, where)
        for gate, v in (("data-standards", ds), ("data-quality-gate", dqg)):
            if v["result"] != "NONE":
                report(gate, v, local_sha, branch, "push")
        if blocked(ds, dqg):
            say(f"  Push to {branch} BLOCKED.")
            print_bypass_help()
            rc = 1
    return rc


def check_range() -> int:
    """`git-gate.py check-range BASE HEAD`: both gates over everything HEAD
    changes since BASE, as one JSON object on stdout — no output lines, no
    reporting. For a server-side PR check (data-gate-telemetry's gate runner)
    that does its own reporting, so local hooks and the PR check run the very
    same gate code. Exit 0 whatever the verdict; the JSON carries it."""
    if len(sys.argv) != 4:
        say("usage: git-gate.py check-range BASE HEAD")
        return 2
    base, head = sys.argv[2], sys.argv[3]
    files = schema_files(["--git-diff", base, head])
    if not files:
        nothing = {"result": "NOT APPLICABLE", "files": []}
        verdicts = {"data-standards": nothing, "data-quality-gate": nothing}
    else:
        verdicts = {
            "data-standards": run_data_standards(["--mode", "diff", "--base", base, "--head", head]),
            "data-quality-gate": run_data_quality_gate(files, lambda p: git("show", f"{head}:{p}")),
        }
    print(json.dumps({"files": files, **verdicts}))
    return 0


def main() -> int:
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # ✓/✗ on Windows consoles
    except (AttributeError, ValueError):
        pass
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "check-range":
        return check_range()
    if os.environ.get("TALEEMABAD_DATA_GATES_GIT_HOOKS_OFF") == "1":
        say("– data gates: switched off by TALEEMABAD_DATA_GATES_GIT_HOOKS_OFF — NOT checked")
        return 0
    try:
        return {"pre-commit": pre_commit, "post-commit": post_commit, "pre-push": pre_push}[mode]()
    except KeyError:
        say(f"git-gate.py: unknown mode {mode!r} (expected pre-commit, post-commit or pre-push)")
        return 0
    except Exception as e:  # noqa: BLE001 — a crash in the gate must say so, not pass silently
        say(f"⚠ data gates: the git hook crashed ({type(e).__name__}: {e}) — this {mode} was NOT checked")
        return 0


if __name__ == "__main__":
    sys.exit(main())
