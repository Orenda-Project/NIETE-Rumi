#!/usr/bin/env bash
# run-suite.sh --parallel with E2E_SHARDS: a long feature runs as two children on two slots (bd-r09cmx).
#
# The suite wall is the longest single-slot feature: training 22.8 min, coaching 20.0 min (run
# 20261026-1111-par). E2E_SHARDS="training=T25-T84,T696" makes the parent launch training twice —
# child 1 with --skip <ids> (the ladder and the rest), child 2 with --only <ids> (the quiz-generation
# cluster, one want() block, which the drivers gate on any-id-wanted) — each on its own slot, driver and
# database. --print-shards prints the plan and exits without starting anything.
#
# Run: bash .claude/qa/shared/run-suite-shards.test.sh
set -u
cd "$(dirname "$0")/../../.." || exit 1
fails=0
t() { if [ "$2" = "$3" ]; then echo "  ok  $1"; else echo "  FAIL $1: want [$3] got [$2]"; fails=$((fails+1)); fi; }

echo "AC1 the plan: training becomes two children, everything else one"
PLAN=$(E2E_SHARDS="training=T25-T84,T696" bash .claude/qa/shared/run-suite.sh training,menu --method mock --parallel --print-shards 2>&1)
t "exit 0" "$?" "0"
t "menu is one child"      "$(printf '%s\n' "$PLAN" | grep -c '^child menu ')" "1"
t "training is two children" "$(printf '%s\n' "$PLAN" | grep -c '^child training')" "2"
t "child 1 skips the cluster" "$(printf '%s\n' "$PLAN" | grep -E '^child training ' | grep -c 'skip=T25,')" "1"
t "child 2 runs only the cluster" "$(printf '%s\n' "$PLAN" | grep -E '^child training#2 ' | grep -c 'only=T25,')" "1"
ids=$(printf '%s\n' "$PLAN" | grep -E '^child training#2 ' | sed -E 's/.*only=//; s/ .*//')
t "the range is expanded (T25…T84 = 60 ids + T696)" "$(printf '%s\n' "$ids" | tr ',' '\n' | grep -c .)" "61"
t "T24 stays with child 1" "$(printf '%s' "$ids" | tr ',' '\n' | grep -c '^T24$')" "0"
t "T696 is in the cluster" "$(printf '%s' "$ids" | tr ',' '\n' | grep -c '^T696$')" "1"

echo "AC2 the mock lane shards training by default; E2E_SHARDS= (empty) runs every feature whole"
PLAN3=$(bash .claude/qa/shared/run-suite.sh training,menu --method mock --parallel --print-shards 2>&1)
t "default: training is sharded" "$(printf '%s\n' "$PLAN3" | grep -c '^child training')" "2"
PLAN2=$(E2E_SHARDS= bash .claude/qa/shared/run-suite.sh training,menu --method mock --parallel --print-shards 2>&1)
t "two children" "$(printf '%s\n' "$PLAN2" | grep -c '^child ')" "2"

echo "AC3 the child's selection reaches the runner"
grep -qF 'E2E_SKIP_MAP' .claude/qa/shared/run-suite.sh; t "run-suite exports E2E_SKIP_MAP for --skip" "$?" "0"
grep -qF 'E2E_SKIP_MAP' .claude/qa/shared/feature-runner.cjs; t "feature-runner reads E2E_SKIP_MAP" "$?" "0"

[ $fails = 0 ] && echo "PASS" || { echo "$fails failed"; exit 1; }
