#!/bin/bash
# run-suite.sh on the mock lane resolves a PER-MACHINE driver (mock_driver.py), not the fixed yaml number.
# --print-driver resolves exactly as a run would and exits before touching anything — the seam this test uses.
set -u
cd "$(dirname "$0")/../../.." || exit 1
FAILED=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
say() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }
RS=.claude/qa/shared/run-suite.sh
out=$(E2E_MOCK_DRIVER_MACHINE="alpha.local|mac" bash "$RS" menu --method mock --print-driver 2>&1); rc=$?
say "--print-driver exits 0" "$rc" "0"
want=$(E2E_MOCK_DRIVER_MACHINE="alpha.local|mac" python3 .claude/qa/shared/mock_driver.py)
say "mock lane driver == mock_driver.py for the same machine" "$out" "$want"
[ "$out" != "923000000001" ] && ok "not the legacy shared number" || bad "still the legacy shared number"
out=$(E2E_MOCK_DRIVER=923000000555 bash "$RS" menu --method mock --print-driver 2>&1)
say "E2E_MOCK_DRIVER pins it" "$out" "923000000555"
out=$(bash "$RS" menu --method mock --driver 923000000444 --print-driver 2>&1)
say "an explicit --driver still wins" "$out" "923000000444"
[ -d .claude/qa/results/whatsapp/niete ] && before=$(ls .claude/qa/results/whatsapp/niete | wc -l | tr -d ' ') || before=0
E2E_MOCK_DRIVER_MACHINE="x|y" bash "$RS" menu --method mock --print-driver >/dev/null 2>&1
[ -d .claude/qa/results/whatsapp/niete ] && after=$(ls .claude/qa/results/whatsapp/niete | wc -l | tr -d ' ') || after=0
say "--print-driver creates no run dir" "$after" "$before"
echo; [ "$FAILED" -eq 0 ] && { echo "run-suite-mock-driver: all passed"; exit 0; } || { echo "run-suite-mock-driver: $FAILED failed"; exit 1; }
