#!/usr/bin/env bash
# local-stack.sh retarget <sha> <run_dir> — move a RUNNING stack's code to another commit, keeping its database
# (bd-i56c2u: the developer's own portal on :4000 follows the commits of the checkout that started it).
# What must hold: the detached worktree is at the new commit, the bot's .env and stack.json name it (so /health
# and `verify` agree), the old bot and worker are stopped (their code just moved under them), the module links
# survive, and an unknown commit changes nothing.
# Runs in a throwaway repo with a COPY of the lane scripts; no node process, no database.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fails=0
t() { if [ "$2" = "$3" ]; then echo "  ok  $1"; else echo "  FAIL $1: want [$3] got [$2]"; fails=$((fails+1)); fi; }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/retarget.XXXXXX"); trap 'kill $BOT $WORKER 2>/dev/null; rm -rf "$TMP"' EXIT
R="$TMP/repo with space"; mkdir -p "$R/bot/scripts/e2e"
cp "$HERE/local-stack.sh" "$HERE/portable.sh" "$HERE/provision-local-modules.sh" "$R/bot/scripts/e2e/"
printf 'node_modules/\n.env\n' > "$R/.gitignore"
printf 'v1\n' > "$R/bot/app.js"
git -C "$R" init -q -b sandbox; git -C "$R" config user.email t@l; git -C "$R" config user.name t
git -C "$R" add -A; git -C "$R" commit -qm A; A=$(git -C "$R" rev-parse HEAD)
printf 'v2\n' > "$R/bot/app.js"; git -C "$R" commit -qam B; B=$(git -C "$R" rev-parse HEAD)

RUN="$TMP/run"; mkdir -p "$RUN"
git -C "$R" worktree add -q --detach "$RUN/src" "$A"
ln -s "$TMP/nm-bot" "$RUN/src/bot/node_modules"; ln -s "$TMP/nm-root" "$RUN/src/node_modules"
printf 'PORT=3999\nE2E_COMMIT_SHA=%s\nOTHER=x\n' "$A" > "$RUN/src/.env"
printf '{"commit_sha": "%s", "worktree": "%s"}\n' "$A" "$RUN/src" > "$RUN/stack.json"
sleep 300 & BOT=$!; echo $BOT > "$RUN/bot.pid"
sleep 300 & WORKER=$!; echo $WORKER > "$RUN/worker.pid"

echo "local-stack retarget"
out=$(bash "$R/bot/scripts/e2e/local-stack.sh" retarget "$B" "$RUN" 2>&1); rc=$?
t "RT1 retarget to the next commit exits 0" "$rc" "0"; [ "$rc" = 0 ] || echo "      $out"
t "RT2 the run's worktree is at the new commit" "$(git -C "$RUN/src" rev-parse HEAD 2>/dev/null)" "$B"
t "RT3 the new commit's code is what is on disk" "$(cat "$RUN/src/bot/app.js" 2>/dev/null)" "v2"
t "RT4 the bot's .env names the new commit (once)" "$(grep -c "^E2E_COMMIT_SHA=$B$" "$RUN/src/.env" 2>/dev/null)" "1"
t "RT5 …and keeps every other setting" "$(grep -c '^OTHER=x$' "$RUN/src/.env" 2>/dev/null)" "1"
t "RT6 stack.json names the new commit" "$(python3 -c "import json;print(json.load(open('$RUN/stack.json'))['commit_sha'])" 2>/dev/null)" "$B"
sleep 0.3
t "RT7 the old bot is stopped" "$(kill -0 $BOT 2>/dev/null && echo alive || echo stopped)" "stopped"
t "RT8 the old worker is stopped" "$(kill -0 $WORKER 2>/dev/null && echo alive || echo stopped)" "stopped"
t "RT9 the module links survive" "$([ -L "$RUN/src/bot/node_modules" ] && [ -L "$RUN/src/node_modules" ] && echo yes)" "yes"

out=$(bash "$R/bot/scripts/e2e/local-stack.sh" retarget deadbeefdeadbeef "$RUN" 2>&1); rc=$?
t "RT10 an unknown commit exits 11" "$rc" "11"
t "RT11 …and leaves the worktree where it was" "$(git -C "$RUN/src" rev-parse HEAD)" "$B"

out=$(bash "$R/bot/scripts/e2e/local-stack.sh" retarget "$A" "$TMP/no-such-run" 2>&1); rc=$?
t "RT12 a run dir with no stack exits 2" "$rc" "2"

# RT13 — the refresh runs from a post-commit hook, which exports GIT_INDEX_FILE (and, in a worktree, GIT_DIR). The
# first real run inherited them: `git -C <run>/src checkout` acted on the COMMITTING checkout instead, detached its
# branch, and left the stack's own worktree where it was (bd-i56c2u, 2026-10-23). Hook env, from the committer's tree.
git -C "$R" checkout -q -b work; mainhead=$(git -C "$R" rev-parse HEAD)
(cd "$R" && GIT_INDEX_FILE=.git/index GIT_DIR="$R/.git" GIT_WORK_TREE="$R" bash "$R/bot/scripts/e2e/local-stack.sh" retarget "$A" "$RUN" >/dev/null 2>&1)
t "RT13 under a hook's GIT_* env, the run's worktree moves" "$(git -C "$RUN/src" rev-parse HEAD)" "$A"
t "RT13b …and the committing checkout stays on its branch" "$(git -C "$R" symbolic-ref -q --short HEAD)@$(git -C "$R" rev-parse HEAD)" "work@$mainhead"

# RT14 — a commit the worktree cannot move to stops nothing: the bot and worker keep running the old code.
sleep 300 & BOT=$!; echo $BOT > "$RUN/bot.pid"; sleep 300 & WORKER=$!; echo $WORKER > "$RUN/worker.pid"
printf 'local edit\n' >> "$RUN/src/bot/app.js"
out=$(bash "$R/bot/scripts/e2e/local-stack.sh" retarget "$B" "$RUN" 2>&1); rc=$?
t "RT14 a dirty run worktree refuses (exit 11)" "$rc" "11"
t "RT14b …before stopping the bot" "$(kill -0 $BOT 2>/dev/null && echo alive || echo stopped)" "alive"
git -C "$RUN/src" checkout -q -- bot/app.js

git -C "$R" worktree remove --force "$RUN/src" >/dev/null 2>&1
echo; if [ "$fails" -eq 0 ]; then echo "local-stack-retarget: all passed"; else echo "local-stack-retarget: $fails failed"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
