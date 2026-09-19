#!/usr/bin/env bash
# no-manifest.test.sh — in a repo WITHOUT .claude/qa/config/tenants.yaml every hook is SILENT: exit 0, no
# output, no marker, no context. A guarded repo is defined by its manifest; anything else is not our business
# and must never be wedged or nagged (bd-9157r).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
F=0; ok(){ printf '  ok    %s\n' "$1"; }; bad(){ printf '  FAIL  %s\n' "$1"; F=$((F+1)); }
D=$(mktemp -d); git -C "$D" init -q; printf 'x\n' > "$D/a"; git -C "$D" add -A
git -C "$D" -c user.email=a@b -c user.name=n commit -qm x
unset CLAUDE_PROJECT_DIR
PAY_POST=$(printf '{"session_id":"nm","cwd":"%s","tool_name":"Bash","tool_input":{"command":"cd %s && git commit -m x"},"tool_response":{}}' "$D" "$D")
PAY_STOP=$(printf '{"session_id":"nm","cwd":"%s","hook_event_name":"Stop"}' "$D")
PAY_START=$(printf '{"session_id":"nm","cwd":"%s","hook_event_name":"SessionStart"}' "$D")
for pair in "e2e-autorun.sh|$PAY_POST" "e2e-autorun-stop.sh|$PAY_STOP" "e2e-pending-banner.sh|$PAY_START"; do
  h="${pair%%|*}"; pay="${pair#*|}"
  OUT=$(printf '%s' "$pay" | CLAUDE_PROJECT_DIR="$D" bash "hooks/$h" 2>&1); RC=$?
  [ "$RC" = 0 ] && [ -z "$OUT" ] && ok "$h: silent, exit 0 (CLAUDE_PROJECT_DIR = unguarded repo)" || bad "$h: rc=$RC out=$(printf '%s' "$OUT" | head -c 160)"
  # The cwd variant only holds while the engine's OWN parent is unguarded (the authoring workspace). Vendored into a
  # bot repo, the engine's parent IS that repo and the hooks rightly fall back to it — skip the variant there.
  if [ -f "$(cd .. && cd .. && cd .. && pwd)/.claude/qa/config/tenants.yaml" ]; then
    ok "$h: cwd variant skipped — the engine is vendored inside a guarded repo"
  else
    OUT=$(cd "$D" && printf '%s' "$pay" | env -u CLAUDE_PROJECT_DIR bash "$OLDPWD/hooks/$h" 2>&1); RC=$?
    [ "$RC" = 0 ] && [ -z "$OUT" ] && ok "$h: silent, exit 0 (cwd = unguarded repo, no CLAUDE_PROJECT_DIR)" || bad "$h (cwd): rc=$RC out=$(printf '%s' "$OUT" | head -c 160)"
  fi
done
[ ! -d "$D/.claude/.e2e-pending" ] && ok "no marker directory created" || bad "a marker dir was created in an unguarded repo"
# git hooks
OUT=$(cd "$D" && bash "$OLDPWD/githooks/post-commit" 2>&1); RC=$?
[ "$RC" = 0 ] && [ -z "$OUT" ] && ok "post-commit: silent, exit 0" || bad "post-commit: rc=$RC out=$(printf '%s' "$OUT" | head -c 160)"
OUT=$(cd "$D" && printf 'refs/heads/main %s refs/heads/main %s\n' "$(git -C "$D" rev-parse HEAD)" "0000000000000000000000000000000000000000" | bash "$OLDPWD/githooks/pre-push" origin x 2>&1); RC=$?
[ "$RC" = 0 ] && [ -z "$OUT" ] && ok "pre-push: silent, exit 0" || bad "pre-push: rc=$RC out=$(printf '%s' "$OUT" | head -c 160)"
# the python entry points say so on stderr and exit non-zero, never traceback
for s in select_e2e.py spec_sync.py; do
  OUT=$(cd "$D" && env -u CLAUDE_PROJECT_DIR python3 "$OLDPWD/bin/$s" --repo "$D" --json --committed 2>&1); RC=$?
  printf '%s' "$OUT" | grep -q "Traceback" && bad "$s: traceback without a manifest" || ok "$s: no traceback without a manifest (rc=$RC)"
done
rm -rf "$D"
[ "$F" = 0 ] && echo "no-manifest: all ok" || { echo "no-manifest: $F failure(s)"; exit 1; }
