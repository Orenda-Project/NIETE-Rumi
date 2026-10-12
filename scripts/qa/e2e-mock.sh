#!/usr/bin/env bash
# e2e-mock.sh — run the NIETE E2E suite on the mock lane with this run's own local database. No Chrome, no
# WhatsApp number, no sandbox or Railway access: the bot runs locally at the commit under test behind the mock
# Graph API, on a per-run clone of the local database, and the machine sets itself up on the first run.
#
#   npm run e2e:mock                                   # the safe subset, one feature after another
#   npm run e2e:mock -- training                       # every scenario of one feature
#   npm run e2e:mock -- training,menu                  # several features at once, one slot each
#   npm run e2e:mock -- all                            # every feature at once
#   npm run e2e:mock -- coaching --only 'coaching=COA09,COA20'   # just those scenarios
#   npm run e2e:mock -- training --commit <sha>        # another commit (default HEAD)
#   npm run e2e:mock -- training,menu --slot 3         # one run on slot 3's ports, beside another run
#
# Every other option goes to run-suite.sh unchanged. Results land in .claude/qa/results/whatsapp/niete/<run>/.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_SUITE="${E2E_MOCK_RUN_SUITE:-$ROOT/.claude/qa/shared/run-suite.sh}"

usage() { sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

MODE="safe"
case "${1:-}" in
  -h|--help) usage; exit 0;;
  ""|-*) ;;
  *) MODE="$1"; shift;;
esac

# Feature names come from feature-order.py, the suite's own list, so a new feature needs no change here.
if [ "$MODE" != safe ] && [ "$MODE" != all ]; then
  known=$(python3 "$ROOT/.claude/qa/shared/feature-order.py" 2>/dev/null | awk '$1 ~ /^[0-9]+\.$/ {print $2}')
  for f in $(echo "$MODE" | tr ',' ' '); do
    printf '%s\n' "$known" | grep -qx -- "$f" || {
      echo "unknown feature: $f — use safe, all, or any of: $(echo $known | tr ' ' ',')" >&2; exit 2; }
  done
fi

if [ "${E2E_LOCAL_DB:-1}" = 0 ]; then echo "e2e-mock: E2E_LOCAL_DB=0 ignored — this command always runs on the local database" >&2; fi
export E2E_LOCAL_DB=1

# Several features (or all) run side by side, one slot each. A --slot pins one run, so it never goes parallel;
# the safe subset stays sequential because --parallel runs each feature in full, not its safe scenarios.
PARALLEL=""
case "$MODE" in all|*,*) PARALLEL="--parallel";; esac
for a in "$@"; do [ "$a" = --slot ] && PARALLEL=""; done

exec bash "$RUN_SUITE" "$MODE" --method mock $PARALLEL "$@"
