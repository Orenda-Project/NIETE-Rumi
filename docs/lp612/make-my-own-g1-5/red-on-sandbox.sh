#!/usr/bin/env bash
# bd-snkn32.4 RED proof: this branch's new/changed tests run against UNCHANGED origin/sandbox code (a temp worktree).
# They must fail there: that is the proof they test the change. Usage: bash red-on-sandbox.sh <branch worktree>
set -u
W="$1"; B="${W}-red"
git -C "$W" worktree add -q --detach "$B" origin/sandbox 2>/dev/null || true
ln -sfn "$W/node_modules" "$B/node_modules"; ln -sfn "$W/bot/node_modules" "$B/bot/node_modules"
ln -sfn "$W/dashboard/node_modules" "$B/dashboard/node_modules"; ln -sfn "$W/portal/node_modules" "$B/portal/node_modules"
T="tests/lp612/own-k5.test.js tests/lp612/own-k5-service.test.js tests/lp612/own-k5-source.test.js tests/lp612/own-k5-author.test.js tests/lp612/own-k5-fonts.test.js tests/lp612/own-internal-route.test.js tests/portal/lp612-own-route.test.js tests/database/v1-9-7-own-plans-k5.test.js"
P="portal/src/portal/teacher/lessons/own/OwnPage.test.tsx"
for f in $T $P; do mkdir -p "$B/$(dirname "$f")"; cp "$W/$f" "$B/$f"; done
cd "$B" && node tests/run.js $T --maxWorkers=2; a=$?
cd "$B/portal" && npx vitest run src/portal/teacher/lessons/own/OwnPage.test.tsx; b=$?
git -C "$W" worktree remove --force "$B"
[ $a -eq 0 ] && [ $b -eq 0 ]
