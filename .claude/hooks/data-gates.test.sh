#!/usr/bin/env bash
# Tests for the data-standards gate entry points in .claude/hooks — the wrappers
# that delegate to the vendored skill's hooks (bd-lw1r7.8.1).
#
# What must hold: a wrapper passes stdin through and returns the real hook's
# exit code unchanged (2 = block, 0 = allow); the commit gate validates the
# repo the COMMAND targets, not the directory the hook happens to run in; and
# settings.json registers the gates, not the retired warn shim.
set -uo pipefail
H="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf "  ok   %s\n" "$1"; }
no(){ FAIL=$((FAIL+1)); printf "  FAIL %s\n     %s\n" "$1" "${2:-}"; }
chk(){ if [ "$2" = "$3" ]; then ok "$1"; else no "$1" "expected [$3] got [$2]"; fi; }

ROOT="$(cd "$H/../.." && pwd)"
# Slack delivery off for the test run — a block must never post anywhere.
export TALEEMABAD_DATA_STANDARDS_SLACK_CHANNEL="" TALEEMABAD_DATA_STANDARDS_BYPASS=""
export CLAUDE_PROJECT_DIR="$ROOT"

BAD='CREATE TABLE hooktest_contacts (\n  name TEXT,\n  phone_number TEXT,\n  cnic TEXT\n);\n'
# A path .data-standards.json includes — the edit gate must see it as schema-relevant.
write(){ printf '{"tool_name":"Write","tool_input":{"file_path":"%s/bot/database/migrations/9999_hooktest.sql","content":"%s"}}' "$ROOT" "$1"; }
fire(){ (cd "$ROOT" && bash "$H/$1" >/dev/null 2>&1); echo $?; }

echo "data-gates"

# T1 — every wrapper's target exists (a renamed upstream hook must fail loudly here).
for w in data-standards-schema-change-gate.sh data-standards-live-edit-gate.sh; do
  t=$([ -f "$H/$w" ] && sed -n -e 's#^exec [a-z0-9]* "$H/\(.*\)" "$@"#\1#p' -e 's#^GATE="$H/\(.*\)"#\1#p' "$H/$w")
  if [ -n "$t" ] && [ -f "$H/$t" ]; then ok "$w -> $t"; else no "$w target missing" "${t:-wrapper absent}"; fi
done

# T2 — unclassified PII + no primary key is blocked live by the edit gate.
chk "edit gate blocks bad migration"      "$(write "$BAD" | fire data-standards-live-edit-gate.sh)" 2
# T3 — non-schema files and non-git commands are left alone.
chk "edit gate ignores non-schema file" \
  "$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s/notes.md","content":"hi"}}' "$ROOT" | fire data-standards-live-edit-gate.sh)" 0
chk "commit gate ignores plain command" \
  "$(echo '{"tool_name":"Bash","tool_input":{"command":"ls"}}' | fire data-standards-schema-change-gate.sh)" 0

# T4 — the commit gate validates the repo the COMMAND targets, not the hook's cwd.
# A session launched in the workspace above this clone runs the hook with the
# workspace as cwd, and commits here via `cd NIETE-Rumi && git commit` or `git -C`.
TMP=$(mktemp -d "${TMPDIR:-/tmp}/data-gates-nested.XXXXXX")
mkrepo(){ # $1 = dir  $2 = migration content (empty = clean repo)
  mkdir -p "$1/migrations" && git -C "$1" init -q -b main \
    && git -C "$1" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
  if [ -n "$2" ]; then printf "$2" > "$1/migrations/0001_hooktest.sql"; git -C "$1" add -A; fi
}
mkrepo "$TMP/nested repo" "$BAD"
mkrepo "$TMP/clean" ""
commit(){ printf '{"tool_name":"Bash","tool_input":{"command":"%s"},"cwd":"%s"}' "$1" "$2"; }
chk "commit gate blocks: cd <nested> && git commit (hook cwd elsewhere)" \
  "$(commit "cd \\\"$TMP/nested repo\\\" && git commit -m x" "$ROOT" | fire data-standards-schema-change-gate.sh)" 2
chk "commit gate blocks: git -C <nested> commit (hook cwd elsewhere)" \
  "$(commit "git -C \\\"$TMP/nested repo\\\" commit -m x" "$ROOT" | fire data-standards-schema-change-gate.sh)" 2
chk "commit gate allows: plain git commit in a clean repo (payload cwd)" \
  "$(commit "git commit -m x" "$TMP/clean" | fire data-standards-schema-change-gate.sh)" 0
rm -rf "$TMP"

# T5 — a missing pyyaml must not reject every commit on a Node-only machine, but
# it must not be silent either: one loud stderr line, then allow.
chk "commit gate skips LOUDLY without pyyaml" \
  "$(commit "git commit -m x" "$ROOT" | (cd "$ROOT" && PYTHONPATH="$H/testdata/no-yaml" bash "$H/data-standards-schema-change-gate.sh" 2>&1 >/dev/null | grep -c 'pyyaml'))" 1

# T6 — settings.json registers the gates and no longer the warn shim.
S="$ROOT/.claude/settings.json"
chk "settings registers the commit gate wrapper" "$(grep -c 'data-standards-schema-change-gate.sh' "$S")" 1
chk "settings registers the live edit gate"      "$(grep -c 'data-standards-live-edit-gate.sh' "$S")" 1
chk "settings no longer registers the warn shim" "$(grep -c 'data-standards-warn.sh' "$S")" 0
chk "warn shim file is retired" "$([ -e "$ROOT/.claude/hooks/data-standards-warn.sh" ] && echo present || echo gone)" gone

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
