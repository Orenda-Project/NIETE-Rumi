#!/bin/bash
# qa-engine-guard.sh — PreToolUse (Edit|Write|MultiEdit): the VENDORED E2E engine is READ-ONLY downstream (bd-9157r).
#
# The engine is authored in rumi-agent-home/.claude/qa/engine and pushed here by port_qa.py. A local edit is
# overwritten by the next port and, until then, is the two-copies drift that took the pipeline down on 2026-09-09
# (bd-dbp1v, PR #801). So: refuse, and say where the edit belongs. The tenant layer (config/, fixtures/, agents/,
# shared/features/, tests/features/) is NOT guarded — that is exactly what a bot repo owns.
#
# Wire in the bot repo's .claude/settings.json under PreToolUse for Edit|Write|MultiEdit.
# Bypass: QA_ENGINE_GUARD_OFF=1 (export it; say why in the commit — the port will still overwrite the file).
[ "${QA_ENGINE_GUARD_OFF:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)
[ -n "$FILE" ] || exit 0
case "$FILE" in
  */.claude/qa/engine/*|\
  */.claude/commands/sync-specs.md|*/.claude/commands/testcases.md|*/.claude/commands/apply-discoveries.md|*/.claude/commands/e2e.md|\
  */.claude/skills/gherkin-spec-sync/*|*/.claude/skills/gherkin-test-cases/*|*/.claude/skills/apply-discoveries/*|*/.claude/skills/chrome-mcp-whatsapp-e2e/*|\
  */.github/workflows/qa-impact.yml)
    jq -n --arg f "$FILE" '{decision: "block",
      reason: ("\($f) is part of the VENDORED E2E engine and is read-only in this repo. Edit it in rumi-agent-home/.claude/qa/engine/ (the same relative path) and run `python3 .claude/scripts/port_qa.py --target <this repo>`; the next port would overwrite a local edit anyway. The tenant layer — .claude/qa/config/, fixtures/, agents/, shared/features/, tests/features/ — is yours to edit. Bypass (say why in the commit): export QA_ENGINE_GUARD_OFF=1")}'
    exit 0 ;;
esac
exit 0
