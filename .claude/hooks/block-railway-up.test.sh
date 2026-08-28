#!/bin/bash
# Tests for block-railway-up.sh
#
# Written 2026-08-27 after the hook was found SILENTLY DEAD: it read `command`
# from the top level of the payload while Claude Code sends it under
# `tool_input.command`, so it exited 0 for every `railway up` ever attempted.
# There were no tests, which is why nobody knew. The first case below is the one
# that was failing in production for months.

set -uo pipefail
HOOK="$(dirname "$0")/block-railway-up.sh"
PASS=0; FAIL=0

# run <expected_exit> <label> <json_payload>
run() {
  local want="$1" label="$2" payload="$3" rc
  printf '%s' "$payload" | bash "$HOOK" >/dev/null 2>&1
  rc=$?
  if [ "$rc" -eq "$want" ]; then PASS=$((PASS+1)); echo "  ok   $label"
  else FAIL=$((FAIL+1)); echo "  FAIL $label (want exit $want, got $rc)"; fi
}

nested() { printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"; }

echo "block-railway-up:"

# --- THE REGRESSION: the real payload shape must block ----------------------
run 2 "railway up (nested tool_input — the shape Claude Code actually sends)" "$(nested 'railway up')"
run 2 "railway up with flags" "$(nested 'railway up --detach')"
run 2 "railway up --service bot" "$(nested 'railway up --service bot')"
run 2 "chained after a cd" "$(nested 'cd /repo && railway up')"
run 2 "chained before something else" "$(nested 'railway up; echo done')"
run 2 "extra whitespace" "$(nested 'railway   up')"

# --- THE SECOND HOLE (2026-08-28): env-var prefixes ------------------------
# `RAILWAY_TOKEN=<tok> railway up` is the DOCUMENTED way to deploy with a project
# token, and it walked straight past the command-position anchor because an
# assignment sits between the anchor and the binary. Three CLI deploys reached
# the NIETE prod bot service this way while the guard reported itself healthy.
run 2 "env-var assignment before it" "$(nested 'RAILWAY_TOKEN=tok railway up')"
run 2 "two env-var assignments before it" "$(nested 'NIETE=1 RAILWAY_TOKEN=tok railway up')"
run 2 "env(1) prefix" "$(nested 'env RAILWAY_TOKEN=tok railway up --service bot')"
run 2 "chained AND env-prefixed" "$(nested 'cd /repo && RAILWAY_TOKEN=tok railway up')"
run 2 "env-prefixed after a semicolon" "$(nested 'echo hi; FOO=bar railway up')"

# an assignment-looking prefix must not make unrelated commands block
run 0 "env-prefixed sanctioned deploy" "$(nested 'SKIP_QA=1 git push origin main')"
run 0 "env-prefixed read-only railway call" "$(nested 'RAILWAY_TOKEN=tok railway status')"

# --- legacy top-level shape still blocks (no regression) --------------------
run 2 "railway up (legacy top-level command key)" '{"command":"railway up"}'

# --- must NOT block the read-only commands this session depends on ----------
run 0 "railway status" "$(nested 'railway status')"
run 0 "railway status --json" "$(nested 'railway status --json')"
run 0 "railway logs" "$(nested 'railway logs --deployment abc123')"
run 0 "railway link" "$(nested 'railway link --project X --environment staging --service bot')"
run 0 "railway list" "$(nested 'railway list')"
run 0 "railway deployment list" "$(nested 'railway deployment list')"
run 0 "railway variables" "$(nested 'railway variables')"

# --- must not false-positive on unrelated text ------------------------------
run 0 "the words railway and up apart" "$(nested 'echo \"the railway is up\"')"
run 0 "a path containing railway" "$(nested 'cat .railway-token')"
run 0 "git push (the SANCTIONED deploy route)" "$(nested 'git push origin main')"
run 0 "empty command" "$(nested '')"
run 0 "malformed payload never crashes" '{"nonsense":true}'

# --- prose that MENTIONS the command must pass ------------------------------
# The moment this hook started working it blocked a bead note describing the
# incident. Writing about `railway up` is not running it; if documenting a rule
# trips the rule, the rule gets switched off.
run 0 "a bead note quoting the command" "$(nested "bd update bd-x --notes \"someone ran 'railway up', which is forbidden\"")"
run 0 "a commit message mentioning it" "$(nested 'git commit -m "fix: stop railway up reaching prod"')"
run 0 "grepping for it" "$(nested 'grep -rn "railway up" .claude/hooks/')"
run 0 "a heredoc documenting it" "$(nested 'cat <<EOF
never use railway up
EOF')"
run 0 "an echo about it" "$(nested 'echo "railway up is banned"')"

echo ""
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
