#!/usr/bin/env bash
# Shim for a repo that commits its .claude/settings.json (bd-9157r.1): copy this file to .claude/hooks/ once per hook
# the settings name (e2e-autorun.sh, e2e-autorun-stop.sh, e2e-pending-banner.sh). It runs the SHARED engine's hook of
# the same name, linked in at .claude/qa/engine by scripts/qa/link-engine.sh (which `npm install` runs). Without the
# engine on this machine it drains the hook payload and exits 0, so a session never sees a hook error.
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
H="$ROOT/.claude/qa/engine/hooks/$(basename "$0")"
[ -f "$H" ] || { [ -t 0 ] || cat >/dev/null 2>&1; exit 0; }
exec bash "$H" "$@"
