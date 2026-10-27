#!/usr/bin/env bash
# PreToolUse(Write|Edit): blocks an Edit/Write the instant it would introduce a confirmed NON-NEGOTIABLE data-standards violation into a schema/migration file.
#
# Thin entry point so the gate is visible in .claude/hooks. The real hook lives
# in the vendored skill (owned upstream — never edit it here); exec keeps stdin
# and the exit code (0 = allow, 2 = block) intact.
H="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$H/../skills/data-standards/hooks/live-schema-edit-gate.py" "$@"
