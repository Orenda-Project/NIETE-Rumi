#!/bin/bash
# PreToolUse hook: BLOCK `railway up` commands
# `railway up` bypasses the branch→service auto-deploy mapping and can
# deploy staging code to production. All deploys must go through git push.
#
# Incident: 2026-03 — onboarding feature leaked to production via `railway up`

# The tool input is passed via stdin as JSON
INPUT=$(cat)

# Extract the command from the Bash tool call.
#
# 2026-08-27 — THIS HOOK WAS SILENTLY DEAD. It read `command` from the TOP LEVEL
# of the payload, but Claude Code sends it nested under `tool_input.command`. So
# the extraction always produced an empty string, the grep never matched, and the
# hook exited 0 for every `railway up` ever attempted. A guard that everyone
# believes is protecting production, and isn't, is worse than no guard: it is why
# nobody noticed `railway up` still reaching the NIETE prod bot service (three
# failed CLI deploys on 27 Aug alone, sitting in the deploy history next to the
# real GitHub ones and making "what is prod running?" unanswerable).
#
# Read BOTH shapes: the nested one every current caller sends, and the legacy
# top-level one, so the hook cannot regress if the payload shape changes again.
COMMAND=$(printf '%s' "$INPUT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('command', '') or d.get('command', ''))
except Exception:
    print('')
" 2>/dev/null)

# Block `railway up` only where it is actually being INVOKED — i.e. at a command
# position: the start of the line, or after ; && || | ( or a newline.
#
# A bare substring match is wrong, and the moment the hook started working it
# proved it: the first thing it blocked was a `bd update --notes "...ran
# 'railway up'..."` writing up this very incident. Prose that mentions the
# command, a grep for it, a comment about it, and this file's own documentation
# must all pass; only running it is forbidden. Anchoring at a command position
# still catches every real invocation, including `cd x && railway up`.
#
# 2026-08-28 — SECOND HOLE, same guard. The command position was right but the
# prefix was not: `RAILWAY_TOKEN=<tok> railway up` is the DOCUMENTED way to
# deploy with a project token, and it walked straight past this hook, because an
# env-var assignment sits between the command position and the word `railway`.
# So did `env RAILWAY_TOKEN=<tok> railway up`. Allow any run of NAME=value
# assignments (and an optional env(1)) before the binary.
if printf '%s' "$COMMAND" | grep -qE '(^|[;&|(]|&&|\|\|)[[:space:]]*(env[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*railway[[:space:]]+up\b'; then
    echo "BLOCKED: 'railway up' is forbidden."
    echo ""
    echo "railway up bypasses branch→service mapping and can deploy staging code to production."
    echo "Use 'git push origin <branch>' instead — Railway auto-deploys from branch pushes."
    echo ""
    echo "  Staging:    git push origin staging"
    echo "  Production: git push origin main"
    echo ""
    echo "See: CLAUDE.md rule #4, feedback_railway_deploy.md"
    exit 2
fi
