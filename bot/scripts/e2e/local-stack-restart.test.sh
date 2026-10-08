#!/usr/bin/env bash
# local-stack.sh restart <bot|worker> <run_dir> — must keep working whatever ELSE the run's `ports` file lists.
# Regression (bd-z3ze4.1): a local run appends its file-store port, so `ports` holds 5 numbers; restart read it
# with `read -r mock bot redis worker`, the last variable swallowed the rest ("3203 54603"), the health check on
# that "port" could never pass, and every worker restart (coaching COA28/COA29) failed.
# A fake worker stands in for sqs-worker.js: it serves /health on SQS_WORKER_HEALTH_PORT from the run's .env.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fails=0
t() { if [ "$2" = "$3" ]; then echo "  ok  $1"; else echo "  FAIL $1: want [$3] got [$2]"; fails=$((fails+1)); fi; }

tmp="$(mktemp -d)/run dir"; src="$tmp/src"
mkdir -p "$src/bot/workers" "$src/bot/scripts/e2e"
: > "$src/bot/scripts/e2e/dns-pin.js"   # restart preloads it via NODE_OPTIONS
cat > "$src/bot/workers/sqs-worker.js" <<'JS'
const fs = require('fs');
const port = Number((fs.readFileSync('.env', 'utf8').match(/^SQS_WORKER_HEALTH_PORT=(\d+)/m) || [])[1]);
require('http').createServer((q, s) => { s.writeHead(200); s.end('ok'); }).listen(port, '127.0.0.1');
JS
WP=55491
echo "SQS_WORKER_HEALTH_PORT=$WP" > "$src/.env"

for ports in "4091 3091 6491 $WP" "4091 3091 6491 $WP 54691"; do
  echo "$ports" > "$tmp/ports"
  rm -f "$tmp/worker.pid"
  out=$(bash "$HERE/local-stack.sh" restart worker "$tmp" 2>&1); rc=$?
  n=$(echo "$ports" | wc -w | tr -d ' ')
  t "restart worker with a $n-entry ports file exits 0" "$rc" "0"
  [ "$rc" = 0 ] || echo "      $(printf '%s' "$out" | tail -1)"
  [ -f "$tmp/worker.pid" ] && kill "$(cat "$tmp/worker.pid")" 2>/dev/null
  for i in $(seq 1 20); do lsof -ti tcp:$WP -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.2; done
done
rm -rf "$(dirname "$tmp")"
echo; if [ "$fails" -eq 0 ]; then echo "local-stack-restart: all passed"; else echo "local-stack-restart: $fails failed"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
