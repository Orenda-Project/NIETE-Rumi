#!/usr/bin/env bash
# PreToolUse (Bash) — WARN-MODE wrapper around the Data Team's schema gate.
#
# Why a wrapper of ours instead of registering their hook directly:
#
#   .claude/skills/data-standards/hooks/schema-change-gate.sh exits 2 on a
#   confirmed finding, which BLOCKS the tool call. We are not ready to block.
#   27% of this repo's current findings (23 of 85) are one upstream bug — the D8
#   destructive check does not strip SQL comments, so a commented-out
#   `-- DROP TABLE IF EXISTS x;` rollback line reads as live destructive SQL.
#   Blocking a commit on a false positive is how a gate gets deleted, so this
#   runs the same validator and PRINTS, never blocks. Always exits 0.
#
#   Their hook is not modified — .claude/skills/data-standards/ is vendored
#   verbatim and scripts/data-standards-verify.sh fails CI if anyone edits it.
#   This file is ours, and it calls their validator directly.
#
# Promote to hard blocking by setting DATA_STANDARDS_BLOCK=1 (per-shell), or
# permanently by replacing this script's registration in .claude/settings.json
# with their gate once the two upstream detection gaps documented in
# docs/data-standards.md are fixed. Same warn -> block progression the
# workspace's own block-cross-agent-git.sh hook uses.
#
# Cost on an unrelated Bash call: one grep against the command string, then
# exit 0. The validator only runs for git commit / git push / gh pr create /
# gh pr merge, and only when the staged set contains a schema-relevant file.

set -uo pipefail

INPUT_JSON=$(cat)
export INPUT_JSON

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
VALIDATOR="$REPO_ROOT/.claude/skills/data-standards/scripts/validate_schema.py"

COMMAND=$(python3 - <<'PY'
import json, os, sys
raw = os.environ.get('INPUT_JSON', '') or ''
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    sys.exit(0)
if data.get('tool_name') != 'Bash':
    sys.exit(0)
print((data.get('tool_input') or {}).get('command', '') or '')
PY
)

[ -z "$COMMAND" ] && exit 0

# Word-boundary match, same four operations their gate watches. Prose that
# merely mentions committing must not trip this.
if ! echo "$COMMAND" | grep -qE '(^|[;&|]|\s)(git\s+commit|git\s+push|gh\s+pr\s+create|gh\s+pr\s+merge)(\s|$)'; then
    exit 0
fi

# Missing validator or missing pyyaml must never block a commit in warn mode.
# (Their gate treats "validator could not run" as blocking; we deliberately do
# not, because a Node-only contributor without pyyaml would otherwise have every
# commit rejected over a Python package.)
if [ ! -f "$VALIDATOR" ]; then
    exit 0
fi

OUTPUT=$(python3 "$VALIDATOR" --mode staged --markdown 2>&1)
CODE=$?

# 3 = nothing schema-relevant staged, 0 = clean. Both silent.
if [ "$CODE" -eq 3 ] || [ "$CODE" -eq 0 ]; then
    exit 0
fi

if [ "$CODE" -eq 2 ]; then
    echo "DATA STANDARDS (warn): the validator could not run — not blocking." >&2
    echo "  If this is a missing dependency: pip install pyyaml" >&2
    echo "  See docs/data-standards.md" >&2
    exit 0
fi

echo "DATA STANDARDS (warn, not blocking): findings in the staged schema change." >&2
echo "" >&2
echo "$OUTPUT" >&2
echo "" >&2
echo "Roughly a quarter of D8 findings are known false positives (commented-out SQL" >&2
echo "read as live destructive statements) — see docs/data-standards.md." >&2

if [ -n "${DATA_STANDARDS_BLOCK:-}" ]; then
    echo "" >&2
    echo "DATA_STANDARDS_BLOCK is set — treating the above as blocking." >&2
    exit 2
fi

exit 0
