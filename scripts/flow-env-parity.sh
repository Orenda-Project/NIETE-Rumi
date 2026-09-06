#!/usr/bin/env bash
# Every *_FLOW_ID a Flow config declares must be set on EVERY Railway service
# that reads it — the bot AND the sqs-worker — for the environment given.
#
# Why: on 5 Sep 2026 ASSESSMENT_GEN_FLOW_ID was set on the bot and unset on the
# worker, which is the service that SENDS the review offer. The guard skipped,
# nothing failed, nothing logged, and no teacher was ever offered the review.
#
#   bash scripts/flow-env-parity.sh                 # uses the linked Railway project
#   RAILWAY_PROJECT_ID=... RAILWAY_ENVIRONMENT_ID=... bash scripts/flow-env-parity.sh
set -uo pipefail
cd "$(dirname "$0")/.."
SERVICES=(bot sqs-worker)
VARS=$(node -e "
  const c=require('./bot/scripts/setup/flow-configs.js');
  const list=Array.isArray(c)?c:(c.FLOW_CONFIGS||c.default||[]);
  console.log([...new Set(list.map(f=>f.envVar).filter(Boolean))].join('\n'));
")
# Flow ids the bot READS but that live outside FLOW_CONFIGS (a consumer without
# its own asset). Keep in step with tests/setup/flow-config-conformance.test.js.
EXTRA_VARS="ASSESSMENT_REVIEW_FLOW_ID"
fail=0
for svc in "${SERVICES[@]}"; do
  json=$(railway variables --service "$svc" --json 2>/dev/null) || { echo "  $svc: could not read variables (linked to a project?)"; fail=1; continue; }
  for v in $VARS $EXTRA_VARS; do
    val=$(printf '%s' "$json" | python3 -c "import json,sys;print(json.load(sys.stdin).get('$v',''))")
    if [ -z "$val" ]; then echo "  MISSING  $svc  $v"; fail=1; else echo "  ok       $svc  $v=$val"; fi
  done
done
# The same id on both services, or the two halves of one feature disagree.
for v in $VARS $EXTRA_VARS; do
  b=$(railway variables --service bot --json 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin).get('$v',''))")
  w=$(railway variables --service sqs-worker --json 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin).get('$v',''))")
  [ -n "$b" ] && [ -n "$w" ] && [ "$b" != "$w" ] && { echo "  MISMATCH $v  bot=$b  sqs-worker=$w"; fail=1; }
done
[ $fail -eq 0 ] && echo "flow-env-parity: every Flow id present and equal on ${SERVICES[*]}"
exit $fail
