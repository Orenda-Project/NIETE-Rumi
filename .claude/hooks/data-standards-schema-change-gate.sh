#!/usr/bin/env bash
# PreToolUse(Bash): blocks git commit/push and gh pr create/merge when the staged schema change breaks a NON-NEGOTIABLE data standard.
#
# Thin entry point so the gate is visible in .claude/hooks. The real hook lives
# in the vendored skill (owned upstream — never edit it here); stdin and the
# exit code (0 = allow, 2 = block) pass through intact. This replaces the
# print-only warn shim (data-standards-warn.sh, retired bd-lw1r7.8.1). The D8
# comment false positive the shim cited no longer reproduces on the vendored
# copy, and the subdirectory fail-open it anchored against is covered by (1).
#
# TWO THINGS THIS WRAPPER ADDS:
#
# 1. It runs the gate INSIDE THE REPO THE COMMAND TARGETS. The vendored gate and
#    the validator under it resolve the repo from their own process cwd, which
#    for a Claude hook is the directory the session was launched from. A session
#    launched in the workspace above this clone commits here via
#    `cd NIETE-Rumi && git commit` or `git -C "…/NIETE-Rumi" commit`, so the gate
#    asked the WORKSPACE what was staged, found nothing, and exited 0 — a silent
#    pass on every migration. The resolver is the push gate's e2e_resolve_repo
#    (payload cwd + every `cd` + `git -C`, explicit cd wins) — shared, not copied.
#    Same fix as the workspace's own wrapper (bd-lw1r7.10).
#
# 2. A missing pyyaml SKIPS LOUDLY instead of blocking. The vendored gate treats
#    "validator could not run" as blocking, which on a Node-only machine would
#    reject every commit over a Python package — the warn shim's original reason
#    for not blocking. One stderr line with the install command, then allow.
set -uo pipefail
H="$(cd "$(dirname "$0")" && pwd)"
GATE="$H/../skills/data-standards/hooks/schema-change-gate.sh"

INPUT=$(cat)
export INPUT

read -r -d '' CMD_AND_CWD < <(python3 - <<'PY'
import json, os, sys
try:
    d = json.loads(os.environ.get("INPUT", "") or "")
    if d.get("tool_name") == "Bash":
        print(json.dumps([(d.get("tool_input") or {}).get("command", "") or "", d.get("cwd") or ""]))
except Exception:
    pass
print("")
PY
) || true

TARGET=""
if [ -n "$CMD_AND_CWD" ]; then
  CMD=$(printf '%s' "$CMD_AND_CWD" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0])')
  PAYLOAD_CWD=$(printf '%s' "$CMD_AND_CWD" | python3 -c 'import json,sys; print(json.load(sys.stdin)[1])')
  # Only resolve for the four gated operations — every other Bash call must cost nothing here.
  if printf '%s' "$CMD" | grep -qE '(^|[;&|]|\s)(git\s+(-C\s+("[^"]*"|'"'"'[^'"'"']*'"'"'|\S+)\s+)?(commit|push)|gh\s+pr\s+(create|merge))(\s|$)'; then
    if ! python3 -c 'import yaml' 2>/dev/null; then
      echo "DATA STANDARDS: gate skipped — pyyaml is not installed for python3, so the schema validator cannot run. Install it: pip install pyyaml" >&2
      exit 0
    fi
    if . "$H/lib/git-push-match.sh" 2>/dev/null; then
      TARGET=$(e2e_resolve_repo "$CMD" "$PAYLOAD_CWD" 2>/dev/null) || TARGET=""
    fi
  fi
fi

if [ -n "$TARGET" ] && [ -d "$TARGET" ]; then
  cd "$TARGET" || true
  # `git -C <dir> commit` names the repo we just moved into. The vendored gate's
  # matcher only recognises `git commit` / `git push` as adjacent words, so hand
  # it the equivalent command with the -C hop removed.
  INPUT=$(printf '%s' "$INPUT" | python3 -c '
import json, re, sys
raw = sys.stdin.read()
try:
    d = json.loads(raw)
    ti = d.get("tool_input") or {}
    ti["command"] = re.sub(r"""git\s+-C\s+("[^"]*"|\x27[^\x27]*\x27|\S+)\s+""", "git ", ti.get("command", "") or "")
    d["tool_input"] = ti
    print(json.dumps(d))
except Exception:
    sys.stdout.write(raw)
')
fi

printf '%s' "$INPUT" | bash "$GATE" "$@"
exit $?
