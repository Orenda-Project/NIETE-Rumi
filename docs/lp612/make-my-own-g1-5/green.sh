#!/usr/bin/env bash
# bd-snkn32.4 GREEN proof: the same tests on this branch, plus the existing Make my own and Lesson Plans suites.
set -e
W="$1"; cd "$W"
node tests/run.js tests/lp612/own-k5.test.js tests/lp612/own-k5-service.test.js tests/lp612/own-k5-source.test.js tests/lp612/own-k5-author.test.js tests/lp612/own-k5-fonts.test.js tests/lp612/own-internal-route.test.js tests/portal/lp612-own-route.test.js tests/database/v1-9-7-own-plans-k5.test.js tests/lp612/own-service.test.js tests/lp612/own-worker.test.js tests/lp612/own-status-fallback.test.js tests/lp612/own-instruction.test.js tests/database/v1-9-6-lp612-own-plans.test.js --maxWorkers=2
cd portal && npx vitest run src/portal/teacher/lessons
