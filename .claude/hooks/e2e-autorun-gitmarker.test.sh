#!/bin/bash
# The bridge between the git hooks and the Claude Code hooks.
#
# A terminal commit arms a `git-<sha>.json` marker (see .githooks/post-commit).
# Nobody is in a Claude session at that moment, so nothing can nudge. The next
# Claude session in this clone must (a) be TOLD about the pending work at start,
# and (b) be held ONCE at end of turn until it drives or clears it — exactly as
# if its own commit had armed it. Otherwise the terminal path is a strictly
# weaker pipeline than the agent path, which is the gap this port exists to close.
#
# Run:  bash .claude/hooks/e2e-autorun-gitmarker.test.sh
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT="$PWD"
FAILED=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
say() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }
has() { case "$2" in *"$3"*) got=yes ;; *) got=no ;; esac; say "$1" "$got" "$4"; }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/gitmarker.XXXXXX"); trap 'rm -rf "$TMP"' EXIT
PROJ="$TMP/proj"; mkdir -p "$PROJ/.claude/.e2e-pending"
cp -R "$ROOT/.claude/hooks" "$PROJ/.claude/hooks"
PEND="$PROJ/.claude/.e2e-pending"
STOP="$PROJ/.claude/hooks/e2e-autorun-stop.sh"
BANNER="$PROJ/.claude/hooks/e2e-pending-banner.sh"
S="sess-$$"

marker() {  # $1 name  $2 nudged  $3 spec_sync
  cat > "$PEND/$1.json" <<J
{"session":"git","repo":"NIETE-Rumi","branch":"develop","trigger":"git-commit","mode":"execute",
 "armed_at":"2026-09-07T00:00:00Z","nudged":$2,"spec_sync":$3,"sha":"$1",
 "commands":["/niete-e2e menu"],"features":["menu"],"fallback":false,"unmapped":[]}
J
  [ "$3" = "true" ] && printf '{"sync_needed":true,"features":{"menu":{}}}' > "$PEND/$1.sync.json"
}
stop() { printf '{"session_id":"%s","cwd":"%s","hook_event_name":"Stop"}' "$S" "$PROJ" | CLAUDE_PROJECT_DIR="$PROJ" bash "$STOP" 2>/dev/null; }
banner() { printf '{"session_id":"%s","cwd":"%s","hook_event_name":"SessionStart"}' "$S" "$PROJ" | CLAUDE_PROJECT_DIR="$PROJ" bash "$BANNER" 2>/dev/null; }
field() { python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get(sys.argv[2]))" "$1" "$2" 2>/dev/null; }

echo "gitmarker — session start"
[ -f "$BANNER" ] && ok "banner hook exists" || bad "banner hook missing"
out=$(banner); say "no markers → banner is silent" "$out" ""
marker git-aaa111 false true
out=$(banner)
has "pending git marker is announced" "$out" "git-aaa111" yes
has "…with the commands" "$out" "/niete-e2e menu" yes
has "…and the phase-1 brief" "$out" "git-aaa111.sync.json" yes
has "…as additionalContext" "$out" "additionalContext" yes

echo "gitmarker — stop hook adopts a git-armed marker"
out=$(stop)
has "blocks the turn once for the git marker" "$out" '"decision": "block"' yes
has "reason names the terminal commit" "$out" "git-aaa111" yes
has "reason carries the run" "$out" "commit-e2e.sh" yes   # menu → the mock lane, pinned to the marker's sha
has "reason pins the marker sha" "$out" "commit-e2e.sh git-aaa111 --features menu" yes
has "reason carries phase 1" "$out" "/sync-specs --brief" yes
say "git marker flipped to nudged" "$(field "$PEND/git-aaa111.json" nudged)" "True"
out=$(stop); say "second stop is silent (nudged once)" "$out" ""

echo "gitmarker — the session's own marker wins"
marker git-bbb222 false false
cat > "$PEND/$S.json" <<J
{"session":"$S","repo":"NIETE-Rumi","branch":"x","trigger":"commit","mode":"execute","armed_at":"t",
 "nudged":false,"spec_sync":false,"commands":["/niete-e2e status"],"features":["status"],"fallback":false,"unmapped":[]}
J
out=$(stop)
has "session marker is the one nudged" "$out" "/niete-e2e status" yes
has "git marker not mixed into it" "$out" "git-bbb222" no
say "session marker nudged" "$(field "$PEND/$S.json" nudged)" "True"
say "git marker still pending for a later turn" "$(field "$PEND/git-bbb222.json" nudged)" "False"
out=$(stop)
has "next stop picks up the git marker" "$out" "git-bbb222" yes

echo "gitmarker — clear"
bash "$PROJ/.claude/hooks/e2e-autorun.sh" --clear --session git-bbb222 2>/dev/null
[ -f "$PEND/git-bbb222.json" ] && bad "--clear --session removes a git marker" || ok "--clear --session removes a git marker"

echo "  ---"
if [ "$FAILED" -eq 0 ]; then echo "  all cases pass"; else echo "  $FAILED case(s) failing"; exit 1; fi
