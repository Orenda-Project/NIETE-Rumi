#!/usr/bin/env python3
"""Put the data gates' git hooks into a repository, so both gates check every
commit and push made in it — from a terminal, an IDE, or Claude Code.

    python3 install_git_hooks.py --repo /path/to/repo          install
    python3 install_git_hooks.py --repo . --check              report, change nothing

What it writes: .githooks/pre-commit, post-commit and pre-push (a copy of
hooks/git-hook-wrapper.sh — commit them, so every clone carries them), then
sets this clone's `core.hooksPath` to .githooks. core.hooksPath is per-clone
config that git never shares, so every other clone needs it set once too —
the pack's SessionStart hook (git-hooks-autoswitch.py) does that automatically
for anyone who opens Claude Code in the repo; anyone else runs this script.

Unlike install_repo_hooks.py (one machine, absolute paths into the pack,
.git/hooks), these files are tracked and machine-independent: the wrapper
finds git-gate.py in the repo's own vendored .claude/skills/ or in the
installed pack, and says so on every commit if it finds neither.

A hook file that already exists and isn't ours is never overwritten: the
script names it and stops, so a repo's own hooks (lint, beads, …) are never
silently lost. Chain the gate from that hook instead.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

WRAPPER = Path(__file__).resolve().parent.parent / "hooks" / "git-hook-wrapper.sh"
HOOKS = ("pre-commit", "post-commit", "pre-push")
OURS = "git-gate.py"


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True).stdout.strip()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", type=Path, default=Path("."))
    ap.add_argument("--check", action="store_true", help="report only, change nothing")
    args = ap.parse_args()

    top = git(args.repo, "rev-parse", "--show-toplevel")
    if not top:
        print(f"{args.repo} is not inside a git repository", file=sys.stderr)
        return 2
    repo = Path(top)
    current = git(repo, "config", "--get", "core.hooksPath")
    hooks_dir = repo / (current or ".githooks")
    if current and current != ".githooks":
        print(f"core.hooksPath is already {current!r} — installing into that directory instead")

    wrapper = WRAPPER.read_text(encoding="utf-8")
    conflicts, todo = [], []
    for name in HOOKS:
        target = hooks_dir / name
        if target.exists() and OURS not in target.read_text(encoding="utf-8", errors="replace"):
            conflicts.append(target)
        elif not target.exists() or target.read_text(encoding="utf-8", errors="replace") != wrapper:
            todo.append(target)
    if conflicts:
        for c in conflicts:
            print(f"NOT installed: {c} already exists and is not the data-gates hook — "
                  f"add a call to {OURS} in it by hand", file=sys.stderr)
        return 1

    if args.check:
        state = "set" if current else "NOT set"
        print(f"hooks to write: {[t.name for t in todo] or 'none'}; core.hooksPath {state}")
        return 0 if not todo and current else 1

    hooks_dir.mkdir(parents=True, exist_ok=True)
    for target in todo:
        target.write_text(wrapper, encoding="utf-8", newline="\n")
        target.chmod(0o755)
        print(f"wrote {target.relative_to(repo)}")
    if not current:
        git(repo, "config", "core.hooksPath", hooks_dir.relative_to(repo).as_posix())
        print(f"set core.hooksPath = {hooks_dir.relative_to(repo).as_posix()}")
    # git on Windows needs the executable bit in the index, or Linux/macOS clones get non-executable hooks.
    for name in HOOKS:
        git(repo, "update-index", "--add", "--chmod=+x", str((hooks_dir / name).relative_to(repo)))
    print("Done. Commit the .githooks/ files so every clone carries them.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
