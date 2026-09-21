#!/usr/bin/env bash
# Shim for the SHARED E2E engine's e2e-autorun-stop.sh. The engine is authored in rumi-agent-home and linked in at
# .claude/qa/engine (scripts/qa/link-engine.sh). A clone on a machine without it stays silent rather
# than reporting a broken hook path, so settings.json can name this file unconditionally.
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
H="$ROOT/.claude/qa/engine/hooks/e2e-autorun-stop.sh"
[ -f "$H" ] || exit 0
exec bash "$H" "$@"
