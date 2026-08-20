#!/usr/bin/env python3
"""Install local Git pre-commit/pre-push hooks that call the shared validator
(validate_schema.py) — the same checks the Claude PreToolUse gate uses, now
also enforced for commits/pushes made from an ordinary terminal, outside
Claude Code entirely. See reference/enforcement-policy.md for what these
hooks can and cannot block, and README section below (--help) for what this
script does and does not do.

This is an EXPLICIT, OPT-IN action — nothing in this pack runs this script
for you. A team decides to run it once, in their own repository, when they
want local enforcement in addition to (not instead of) the CI gate in
reference/detection-guidance.md §8's workflow template. Local hooks are
NEVER the authoritative merge gate — they can be bypassed with `--no-verify`
or a `.git/hooks` edit, and this script tells you so every time it installs.

Usage:
    python3 install_repo_hooks.py --repo /path/to/target/repo
    python3 install_repo_hooks.py --repo . --dry-run
    python3 install_repo_hooks.py --repo . --uninstall

What it does:
  - Writes .git/hooks/pre-commit  (fast: --mode staged, only where staged
    changes are schema-relevant)
  - Writes .git/hooks/pre-push    (fuller: --mode staged again at push time,
    since a rebase/amend between commit and push can change what's staged
    relative to the remote — a real pre-push check would diff against the
    remote ref, which this conservative first version does not yet do; see
    "Known limitation" below)
  - Both hooks call THIS pack's validate_schema.py via an absolute path
    resolved at install time, so the hook keeps working regardless of the
    target repo's own working directory.

What it does NOT do:
  - It does NOT require admin/root privileges — .git/hooks is always
    writable by the repo owner.
  - It does NOT overwrite an existing hook. If a pre-commit/pre-push hook
    already exists and wasn't written by this script, it EXITS without
    touching it and tells you exactly what to do (chain manually, or move
    the existing hook aside first). Silently clobbering someone's existing
    hook is exactly the kind of unannounced-side-effect this script must
    never cause.
  - It does NOT make the check authoritative. A developer can always
    `git commit --no-verify` or delete the hook file. The CI workflow
    (reference + template shipped alongside this script) is what actually
    gates a merge — these hooks are a fast, optional, LOCAL first line.

Known limitation (documented, not silently glossed over): the shipped
pre-push hook re-checks staged/working-tree state, not a true `git diff
<remote>..<local>` of everything about to be pushed. A multi-commit push
where an earlier commit (not the most recent staged state) introduced a
schema violation that was later "fixed forward" may not be caught by this
version. The CI gate (which DOES diff against the true merge-base) is the
backstop for that case — this is why local hooks are documented everywhere
in this pack as "fast and optional," never as the authoritative check.
"""

from __future__ import annotations

import argparse
import stat
import sys
from pathlib import Path

MARKER = "# managed-by: agent-skills-taleemabad data-standards install_repo_hooks.py"

SKILL_DIR = Path(__file__).resolve().parent.parent
VALIDATOR = SKILL_DIR / "scripts" / "validate_schema.py"

PRE_COMMIT_TEMPLATE = """#!/bin/bash
{marker}
# Fast check: staged schema changes only. Bypass: git commit --no-verify
# (this is a LOCAL, optional check — see reference/enforcement-policy.md;
# the CI workflow is the authoritative gate, not this hook).
set -uo pipefail
python3 "{validator}" --mode staged
code=$?
if [ "$code" -eq 3 ]; then
    exit 0  # no schema-relevant staged files
fi
if [ "$code" -eq 1 ]; then
    echo "" >&2
    echo "Blocked by the data-standards pre-commit hook (local, optional check)." >&2
    echo "Bypass: git commit --no-verify" >&2
    exit 1
fi
if [ "$code" -eq 2 ]; then
    echo "" >&2
    echo "data-standards validator itself could not run — treating as blocking" >&2
    echo "rather than letting an unverified commit through silently." >&2
    echo "Bypass: git commit --no-verify" >&2
    exit 1
fi
exit 0
"""

PRE_PUSH_TEMPLATE = """#!/bin/bash
{marker}
# Fuller check at push time. See install_repo_hooks.py's module docstring
# "Known limitation" — this re-checks staged/working-tree state, not a true
# diff against the remote ref; the CI gate is the backstop for that gap.
# Bypass: git push --no-verify
set -uo pipefail
python3 "{validator}" --mode staged
code=$?
if [ "$code" -eq 3 ]; then
    exit 0
fi
if [ "$code" -eq 1 ]; then
    echo "" >&2
    echo "Blocked by the data-standards pre-push hook (local, optional check)." >&2
    echo "Bypass: git push --no-verify" >&2
    exit 1
fi
if [ "$code" -eq 2 ]; then
    echo "" >&2
    echo "data-standards validator itself could not run — treating as blocking" >&2
    echo "rather than letting an unverified push through silently." >&2
    echo "Bypass: git push --no-verify" >&2
    exit 1
fi
exit 0
"""


def is_ours(hook_path: Path) -> bool:
    if not hook_path.exists():
        return True  # nothing there yet — safe to write
    try:
        return MARKER in hook_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False


def make_executable(path: Path) -> None:
    try:
        mode = path.stat().st_mode
        path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    except OSError:
        pass  # Windows: exec bit is meaningless; Git Bash invokes via shebang anyway


def install_hook(git_hooks_dir: Path, name: str, template: str, dry_run: bool) -> str:
    """Returns a short status string: 'installed', 'up-to-date', 'skipped'."""
    hook_path = git_hooks_dir / name
    content = template.format(marker=MARKER, validator=VALIDATOR.as_posix())

    if hook_path.exists() and not is_ours(hook_path):
        return "skipped"  # someone else's hook — never touch it

    if hook_path.exists() and hook_path.read_text(encoding="utf-8", errors="replace") == content:
        return "up-to-date"

    if dry_run:
        return "installed" if not hook_path.exists() else "up-to-date"

    hook_path.write_text(content, encoding="utf-8")
    make_executable(hook_path)
    return "installed"


def uninstall_hook(git_hooks_dir: Path, name: str, dry_run: bool) -> str:
    hook_path = git_hooks_dir / name
    if not hook_path.exists():
        return "not present"
    if not is_ours(hook_path):
        return "skipped (not ours)"
    if not dry_run:
        hook_path.unlink()
    return "removed"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", required=True, type=Path, help="path to the target repository")
    ap.add_argument("--dry-run", action="store_true", help="show what would happen, change nothing")
    ap.add_argument("--uninstall", action="store_true", help="remove hooks this script installed")
    args = ap.parse_args()

    repo = args.repo.resolve()
    git_dir = repo / ".git"
    if not git_dir.is_dir():
        print(f"STOPPED: {repo} isn't a git repository (no .git directory). Nothing changed.",
              file=sys.stderr)
        return 1

    hooks_dir = git_dir / "hooks"
    hooks_dir.mkdir(parents=True, exist_ok=True)

    if not VALIDATOR.exists():
        print(f"STOPPED: can't find the validator at {VALIDATOR}. Nothing changed.", file=sys.stderr)
        return 1

    print(f"Data standards — {'uninstalling' if args.uninstall else 'installing'} local Git hooks"
          + ("  (dry run: nothing will change)" if args.dry_run else ""))
    print(f"  target repo:  {repo}")
    print(f"  validator:    {VALIDATOR}")
    print()

    if args.uninstall:
        for name in ("pre-commit", "pre-push"):
            status = uninstall_hook(hooks_dir, name, args.dry_run)
            print(f"  {name}: {status}")
        return 0

    for name, template in (("pre-commit", PRE_COMMIT_TEMPLATE), ("pre-push", PRE_PUSH_TEMPLATE)):
        status = install_hook(hooks_dir, name, template, args.dry_run)
        if status == "skipped":
            print(f"  {name}: SKIPPED — an existing hook is already there and wasn't installed by "
                  f"this script.")
            print(f"           Chain it manually (call \"{VALIDATOR.as_posix()}\" --mode staged "
                  f"from your existing {name}), or move the existing hook aside first if you want "
                  f"this script to manage it.")
        else:
            print(f"  {name}: {status}")

    print()
    print("Reminder: these are LOCAL, OPTIONAL checks. `git commit --no-verify` / `git push")
    print("--no-verify` bypass them entirely, and anyone can edit or delete a hook file. The")
    print("CI workflow (see reference/detection-guidance.md and the shipped CI template) is the")
    print("authoritative gate — configure it as a required branch-protection status check if you")
    print("want this enforced for real. See reference/enforcement-policy.md for what these hooks")
    print("check and cannot check.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
