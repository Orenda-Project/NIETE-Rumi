#!/usr/bin/env python3
"""SessionStart: switch on the data gates' git hooks in this clone if the repo
ships them but this clone hasn't enabled them yet.

The hook files (.githooks/pre-commit, post-commit, pre-push) are tracked, so
every clone has them — but `core.hooksPath`, the setting that makes git run
them, is per-clone config git never shares. Without this, a teammate's fresh
clone carries the hooks and silently never runs them.

Only acts when .githooks/pre-commit is the data-gates hook and core.hooksPath
is unset; never replaces a hooksPath someone chose. Never blocks, never fails.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def git(*args: str) -> tuple[int, str]:
    try:
        proc = subprocess.run(["git", *args], capture_output=True, text=True, timeout=10)
        return proc.returncode, proc.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return 1, ""


def main() -> int:
    rc, top = git("rev-parse", "--show-toplevel")
    if rc or not top:
        return 0
    hook = Path(top) / ".githooks" / "pre-commit"
    try:
        if "git-gate.py" not in hook.read_text(encoding="utf-8", errors="replace"):
            return 0
    except OSError:
        return 0
    _, current = git("config", "--get", "core.hooksPath")
    if current:
        return 0
    rc, _ = git("config", "core.hooksPath", ".githooks")
    if rc == 0:
        print(json.dumps({"systemMessage":
            f"data gates: git hooks switched on for this clone of {Path(top).name} — "
            "every commit and push here is now checked, from any tool."}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
