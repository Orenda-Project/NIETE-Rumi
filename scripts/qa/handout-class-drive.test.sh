#!/usr/bin/env bash
# handout-class-drive.test.sh — the hand-out class drive loads the bot from the mock lane's stack, not from
# whatever checkout the suite happens to run in (bd-q8wt5e.1).
#
#   bash scripts/qa/handout-class-drive.test.sh      (npm run qa:test runs it)
#
# .claude/qa/shared/handout-class-drive.cjs requires the bot's real modules. On the mock lane the suite runs from a
# per-bead worktree, which has no node_modules: only the stack's own detached worktree (stack.json "worktree", under
# $RUN_DIR) has bot/node_modules and node_modules linked in. Run 20261126-2322-par-training resolved from the bare
# worktree, so T405's sendHandoff → transcript-quiz-llm → llm-client threw "Cannot find module 'openai'".
# This builds the same shape — a bare checkout for the drive, a stack worktree with both module trees linked, a
# RUN_DIR whose stack.json names it — and asserts every hand-out scenario runs (T405 included) with no missing module.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; cd "$ROOT" || exit 1
F=0; ok(){ printf '  ok    %s\n' "$1"; }; bad(){ printf '  FAIL  %s\n' "$1"; F=$((F+1)); }
T=$(mktemp -d "${TMPDIR:-/tmp}/handout-drive.XXXXXX") || exit 1
cleanup() { git -C "$ROOT" worktree remove --force "$T/bare" >/dev/null 2>&1; git -C "$ROOT" worktree remove --force "$T/src" >/dev/null 2>&1; rm -rf "$T"; }
trap cleanup EXIT

# The installed module trees, as local-stack.sh borrows them: the main checkout's (this checkout's, in CI).
common=$(git rev-parse --git-common-dir); case "$common" in /*) ;; *) common="$ROOT/$common";; esac
MAIN=$(dirname "$common")
NM_BOT="${E2E_BOT_NODE_MODULES_ROOT:-$MAIN}/bot/node_modules"; NM_ROOT="${E2E_NODE_MODULES_ROOT:-$MAIN}/node_modules"
if [ ! -d "$NM_BOT/openai" ] && [ ! -d "$NM_ROOT/openai" ]; then
  bad "no installed bot modules to link (looked in $NM_BOT and $NM_ROOT) — run npm ci in the main checkout"; exit 1
fi

echo "handout-class drive — loads the bot from the lane's stack worktree"
# The drive under test is THIS checkout's file, copied into a bare worktree (no node_modules), as on the lane.
git worktree add --detach "$T/bare" HEAD >/dev/null 2>&1 || { bad "git worktree add (bare)"; exit 1; }
cp .claude/qa/shared/handout-class-drive.cjs "$T/bare/.claude/qa/shared/handout-class-drive.cjs"
git worktree add --detach "$T/src" HEAD >/dev/null 2>&1 || { bad "git worktree add (stack)"; exit 1; }
ln -s "$NM_BOT" "$T/src/bot/node_modules"; ln -s "$NM_ROOT" "$T/src/node_modules"
mkdir -p "$T/run"
python3 -c 'import json,sys; json.dump({"worktree": sys.argv[1]}, open(sys.argv[2], "w"))' "$T/src" "$T/run/stack.json"

out=$(cd "$T/bare" && RUN_DIR="$T/run" node .claude/qa/shared/handout-class-drive.cjs 2>/dev/null)
verdict=$(printf '%s' "$out" | python3 -c '
import json, sys
try: d = json.loads(sys.stdin.read())
except Exception as e: print("unparseable drive output: %s" % e); sys.exit()
if "_error" in d: print("drive died: " + d["_error"][:200]); sys.exit()
missing = [k for k, v in d.items() if "Cannot find module" in json.dumps(v)]
failed = [k for k, v in d.items() if not v.get("pass")]
ids = sorted(d)
if missing: print("missing module in " + ",".join(missing) + ": " + json.dumps(d[missing[0]]["ev"])[:200])
elif ids != ["T400","T401","T402","T403","T404","T405","T406"]: print("drive reported " + ",".join(ids))
elif failed: print("failed: " + ",".join(failed) + " " + json.dumps(d[failed[0]]["ev"])[:200])
else: print("OK")')
[ "$verdict" = OK ] && ok "T400–T406 all pass, T405 loads openai through the stack's modules" || bad "$verdict"

[ "$F" -eq 0 ] && echo "handout-class-drive.test: all passed" || { echo "handout-class-drive.test: $F failed"; exit 1; }
