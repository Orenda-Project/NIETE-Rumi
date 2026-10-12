#!/usr/bin/env bash
# run-suite.sh --slot N: every port a slot's stack listens on is derived from N, in ONE place (bd-z3ze4).
# The per-run local database (E2E_LOCAL_DB=1) added two listeners — the supabase-js proxy and PostgREST —
# that used fixed ports, so `--parallel` slots collided on them. slot_ports is now the single list:
# the exports a child run uses AND the free-slot check the parent uses read it, so they cannot drift.
#
# Run: bash .claude/qa/shared/run-suite-slots.test.sh
set -u
cd "$(dirname "$0")/../../.." || exit 1
fails=0
t() { if [ "$2" = "$3" ]; then echo "  ok  $1"; else echo "  FAIL $1: want [$3] got [$2]"; fails=$((fails+1)); fi; }

out=$(bash .claude/qa/shared/run-suite.sh menu --method mock --slot 3 --print-ports 2>&1)
t "slot 3: mock port"            "$(printf '%s\n' "$out" | sed -nE 's/^MOCK_PORT=//p')"          "4013"
t "slot 3: bot port"             "$(printf '%s\n' "$out" | sed -nE 's/^E2E_BOT_PORT=//p')"       "3103"
t "slot 3: redis port"           "$(printf '%s\n' "$out" | sed -nE 's/^E2E_REDIS_PORT=//p')"     "6393"
t "slot 3: local DB API port"    "$(printf '%s\n' "$out" | sed -nE 's/^E2E_SUPABASE_PORT=//p')"  "54403"
t "slot 3: local DB REST port"   "$(printf '%s\n' "$out" | sed -nE 's/^LOCAL_DB_REST_PORT=//p')" "54503"
t "slot 3: local file store (R2) port" "$(printf '%s\n' "$out" | sed -nE 's/^LOCAL_R2_PORT=//p')" "54603"

out=$(bash .claude/qa/shared/run-suite.sh menu --method mock --slot 0 --print-ports 2>&1)
t "slot 0 (no --parallel) keeps the lane's defaults: nothing exported" "$out" ""

# Two slots never share a port, and no slot reuses the unslotted defaults (54321 API / 54330 REST / 54329 PG).
all=""
for n in 1 2 3 4 5 6 7 8 9 10 40; do
  all="$all $(bash .claude/qa/shared/run-suite.sh menu --method mock --slot $n --print-port-numbers 2>/dev/null | tr '\n' ' ')"
done
notnum=$(printf '%s\n' $all | grep -vxE '[0-9]+' | tr '\n' ' ')
t "every slot port strips to a bare number (the free-slot probe passes these to lsof)" "$notnum" ""
dupes=$(printf '%s\n' $all | sort | uniq -d | tr '\n' ' ')
t "slots 1–10 and 40: no port is shared" "$dupes" ""
clash=$(printf '%s\n' $all | grep -xE '54321|54329|54330|54600' | tr '\n' ' ')
t "no slot lands on the unslotted local-DB ports" "$clash" ""

echo; if [ "$fails" -eq 0 ]; then echo "run-suite-slots: all passed"; else echo "run-suite-slots: $fails failed"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
