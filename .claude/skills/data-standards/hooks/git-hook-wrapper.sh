#!/bin/sh
# data gates (data-standards + data-quality-gate) — installed by
# agent-skills-taleemabad/skills/data-standards/scripts/install_git_hooks.py.
# Runs for every commit and push, from any tool. The real logic is
# git-gate.py; this file only finds it and a working Python.
#
# Never silent: if the gates or Python can't be found, it says this commit was
# NOT checked, so a broken setup is visible instead of looking like a pass.
# Off switch (prints that it is off): TALEEMABAD_DATA_GATES_GIT_HOOKS_OFF=1

MODE=$(basename "$0")
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

GATE=""
for c in "$ROOT/.claude/skills/data-standards/hooks/git-gate.py" \
         "$ROOT/skills/data-standards/hooks/git-gate.py" \
         "$HOME/.claude/skills/data-standards/hooks/git-gate.py"; do
    if [ -f "$c" ]; then GATE="$c"; break; fi
done
if [ -z "$GATE" ]; then
    echo "⚠ data gates: not installed on this machine — this $MODE was NOT checked." >&2
    echo "  Install agent-skills-taleemabad (python3 install.py) to switch them on." >&2
    exit 0
fi

PY=""
for p in python3 python; do
    if "$p" -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >/dev/null 2>&1; then
        PY="$p"; break
    fi
done
if [ -z "$PY" ]; then
    echo "⚠ data gates: no working Python 3.9+ found — this $MODE was NOT checked." >&2
    exit 0
fi

exec "$PY" "$GATE" "$MODE" "$@"
