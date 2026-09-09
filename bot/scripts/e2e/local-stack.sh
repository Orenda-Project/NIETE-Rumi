#!/usr/bin/env bash
# local-stack.sh — start the bot FROM ONE COMMIT behind the mock Graph API, for the E2E mock lane.
#
#   bash bot/scripts/e2e/local-stack.sh up   <sha> <run_dir>     # writes <run_dir>/stack.json
#   bash bot/scripts/e2e/local-stack.sh down <run_dir>
#
# What `up` guarantees, in order:
#   1. The code under test is a DETACHED GIT WORKTREE at exactly <sha> (<run_dir>/src). The developer's
#      working tree — dirty or not — is never executed. `git status --porcelain` there is asserted empty.
#   2. bot/node_modules is the main checkout's, symlinked, and ONLY if bot/package-lock.json at <sha> is
#      byte-identical to the one those modules were installed from. Otherwise exit 10 — no silent skew.
#   3. The bot's .env is composed from keys/niete-local.env (sandbox DB + placeholders, never a real
#      WhatsApp token) plus the run's own values: WHATSAPP_API_BASE → the mock, E2E_COMMIT_SHA=<sha>,
#      E2E_CASSETTE=replay-strict (a vendor miss FAILS, never goes live).
#   4. Four processes: a private redis-server (no persistence), mock-graph-api, the bot, and the
#      queue worker on QUEUE_DRIVER=bullmq — coaching and lesson-plan jobs run through it exactly as
#      on Railway, minus AWS. Readiness is polled; then /health must report commit == <sha> or exit 13.
#
# Exit codes: 10 lockfile mismatch · 11 worktree failed · 12 bot not healthy in time · 13 /health sha
# mismatch · 14 keys/niete-local.env missing · 15 mock not healthy · 16 redis-server missing/unhealthy ·
# 17 worker not healthy.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
CMD="${1:-}"; shift || true

# The main checkout (where gitignored keys/ and the installed node_modules live), even from a worktree.
main_checkout() {
  local common; common=$(git -C "$REPO" rev-parse --git-common-dir 2>/dev/null) || { echo "$REPO"; return; }
  case "$common" in /*) ;; *) common="$REPO/$common";; esac
  dirname "$common"
}
MAIN="$(main_checkout)"
# Where the installed dependency sets come from (default: the main checkout). Override when the main
# checkout's install is stale or you want a freshly `npm ci`-ed tree: E2E_NODE_MODULES_ROOT (root set,
# openai/@anthropic-ai/sdk/express/ioredis) and E2E_BOT_NODE_MODULES_ROOT (bot/node_modules).
NM_ROOT="${E2E_NODE_MODULES_ROOT:-$MAIN}"
NM_BOT="${E2E_BOT_NODE_MODULES_ROOT:-$MAIN}"
KEYS_DIR="$MAIN/keys"; [ -f "$KEYS_DIR/niete-local.env" ] || KEYS_DIR="$(dirname "$MAIN")/keys"   # workspace-level keys/ fallback; check the FILE so a stray shadow keys/ dir cannot mask it

log() { echo "[local-stack] $*" >&2; }

up() {
  local sha="$1" run_dir="$2"
  [ -n "$sha" ] && [ -n "$run_dir" ] || { echo "usage: local-stack.sh up <sha> <run_dir>" >&2; exit 2; }
  mkdir -p "$run_dir"
  local src="$run_dir/src"
  local full; full=$(git -C "$REPO" rev-parse --verify "${sha}^{commit}" 2>/dev/null) || { log "unknown commit $sha"; exit 11; }

  # 1. detached worktree at the exact commit
  if [ -d "$src" ]; then git -C "$REPO" worktree remove --force "$src" >/dev/null 2>&1 || rm -rf "$src"; fi
  git -C "$REPO" worktree add --detach "$src" "$full" >/dev/null 2>&1 || { log "git worktree add failed for $full"; exit 11; }
  local got; got=$(git -C "$src" rev-parse HEAD)
  [ "$got" = "$full" ] || { log "worktree is at $got, wanted $full"; exit 11; }
  [ -z "$(git -C "$src" status --porcelain)" ] || { log "worktree at $full is not clean"; exit 11; }

  # 2. node_modules: the installed set must match THIS commit's lockfile
  local want have; want=$(git -C "$REPO" rev-parse "$full:bot/package-lock.json" 2>/dev/null || echo none)
  have=$(git -C "$MAIN" hash-object "$NM_BOT/bot/package-lock.json" 2>/dev/null || echo none)
  if [ "$want" != "$have" ] || [ ! -d "$NM_BOT/bot/node_modules" ]; then
    log "bot/package-lock.json at $full ($want) differs from the installed one in $NM_BOT ($have) — run npm ci in $NM_BOT/bot first"
    exit 10
  fi
  ln -s "$NM_BOT/bot/node_modules" "$src/bot/node_modules"
  # The bot also resolves ROOT deps (openai, @anthropic-ai/sdk, express, ioredis live in the root
  # package.json, as on Railway where both installs exist). Same lockfile rule for the root set.
  local rwant rhave; rwant=$(git -C "$REPO" rev-parse "$full:package-lock.json" 2>/dev/null || echo none)
  rhave=$(git -C "$MAIN" hash-object "$NM_ROOT/package-lock.json" 2>/dev/null || echo none)
  if [ "$rwant" != "$rhave" ] || [ ! -d "$NM_ROOT/node_modules" ]; then
    log "package-lock.json at $full ($rwant) differs from the installed root set in $NM_ROOT ($rhave) — run npm ci in $NM_ROOT first"
    exit 10
  fi
  ln -s "$NM_ROOT/node_modules" "$src/node_modules"

  # 3. env
  # Flow encryption keypair, PER RUN: the bot decrypts data-exchange requests with the private half
  # (FLOW_PRIVATE_KEY_B64), the harness's Flow emulator encrypts with the public half (stack.json).
  # Generated here so no real Meta key is ever needed or stored for the mock lane.
  local flow_keys; flow_keys=$(node -e '
const c=require("crypto"); const {publicKey,privateKey}=c.generateKeyPairSync("rsa",{modulusLength:2048,publicKeyEncoding:{type:"spki",format:"pem"},privateKeyEncoding:{type:"pkcs8",format:"pem"}});
process.stdout.write(Buffer.from(privateKey).toString("base64")+" "+Buffer.from(publicKey).toString("base64"));')
  local flow_priv_b64="${flow_keys% *}" flow_pub_b64="${flow_keys#* }"
  # Cassette mode: replay-strict is the SEALED default — a vendor miss FAILS, never goes live, and the
  # keys file carries no vendor keys. `record` un-seals it for ONE run and needs a SEPARATE keys file
  # WITH real vendor keys (never the default), so a normal run can never call a vendor by accident.
  local cassette_mode="${E2E_CASSETTE_MODE:-replay-strict}"
  case "$cassette_mode" in replay-strict|replay|record) ;; *) log "bad E2E_CASSETTE_MODE '$cassette_mode' (replay-strict|replay|record)"; exit 14;; esac
  local keys_name="niete-local.env"; [ "$cassette_mode" = record ] && keys_name="niete-record.env"
  local keys="$KEYS_DIR/$keys_name"
  if [ ! -f "$keys" ]; then
    if [ "$cassette_mode" = record ]; then
      log "record mode needs $keys with REAL vendor keys (Soniox/OpenRouter/ElevenLabs, + R2_* to mirror). The default lane never has them — see docs/e2e-mock-lane.md"
    else
      log "missing $keys (sandbox creds + placeholders — see docs/e2e-mock-lane.md)"
    fi
    exit 14
  fi
  local mock_port="${MOCK_PORT:-4010}" bot_port="${E2E_BOT_PORT:-3100}" phone_id="${E2E_PHONE_NUMBER_ID:-e2e-local}"
  local redis_port="${E2E_REDIS_PORT:-6390}" worker_port="${E2E_WORKER_HEALTH_PORT:-3201}"
  command -v redis-server >/dev/null 2>&1 || { log "redis-server not found — the queue worker needs it (brew install redis)"; exit 16; }
  local cassette_dir="${E2E_CASSETTE_DIR:-$REPO/.claude/qa/fixtures/cassettes}"; mkdir -p "$cassette_dir"   # committed fixture: recorded once, replayed by every run/clone
  {
    cat "$keys"
    echo
    echo "# --- set by local-stack.sh for run $(basename "$run_dir") ---"
    echo "PORT=$bot_port"
    echo "PHONE_NUMBER_ID=$phone_id"
    echo "WHATSAPP_API_BASE=http://127.0.0.1:$mock_port"
    echo "E2E_COMMIT_SHA=$full"
    echo "E2E_CASSETTE=$cassette_mode"
    echo "E2E_CASSETTE_DIR=$cassette_dir"
    echo "E2E_CASSETTE_MISS_LOG=$run_dir/cassette-misses.jsonl"
    echo "NODE_ENV=test"
    echo "QUEUE_DRIVER=bullmq"
    echo "REDIS_URL=redis://127.0.0.1:$redis_port"
    echo "WORKER_QUEUES=main,quiz"
    echo "SQS_WORKER_HEALTH_PORT=$worker_port"
    echo "FLOW_PRIVATE_KEY_B64=$flow_priv_b64"
    echo "FLOW_PUBLIC_KEY_B64=$flow_pub_b64"
  } > "$src/.env"
  printf '%s' "$flow_pub_b64" > "$run_dir/flow-public-key.b64"
  rm -f "$run_dir/cassette-misses.jsonl"

  # 4. processes
  # `exec` so the recorded pid IS node's, not a wrapper subshell's — killing a wrapper left the
  # real process alive on the port (first live run, 2026-09-07).
  # A PRIVATE redis: its own port, nothing persisted, dies with the run — never the developer's redis.
  ( exec redis-server --port "$redis_port" --save "" --appendonly no --bind 127.0.0.1 --loglevel warning ) >"$run_dir/redis.log" 2>&1 &
  echo $! >"$run_dir/redis.pid"
  ( cd "$src" && PHONE_NUMBER_ID="$phone_id" MOCK_PORT="$mock_port" MOCK_BOT_URL="http://127.0.0.1:$bot_port" \
      MOCK_TRANSCRIPT="$run_dir/transcript.jsonl" \
      exec node bot/scripts/e2e/mock-graph-api.js ) >"$run_dir/mock.log" 2>&1 &
  echo $! >"$run_dir/mock.pid"
  ( cd "$src" && exec node bot/whatsapp-bot.js ) >"$run_dir/bot.log" 2>&1 &
  echo $! >"$run_dir/bot.pid"
  ( cd "$src" && exec node bot/workers/sqs-worker.js ) >"$run_dir/worker.log" 2>&1 &
  echo $! >"$run_dir/worker.pid"
  echo "$mock_port $bot_port $redis_port $worker_port" >"$run_dir/ports"
  for i in $(seq 1 30); do redis-cli -p "$redis_port" ping 2>/dev/null | grep -q PONG && break; sleep 0.3; done
  redis-cli -p "$redis_port" ping 2>/dev/null | grep -q PONG || { log "redis not answering on $redis_port (see $run_dir/redis.log)"; down "$run_dir"; exit 16; }

  local i health
  for i in $(seq 1 30); do curl -sf -m 2 "http://127.0.0.1:$mock_port/health" >/dev/null 2>&1 && break; sleep 0.5; done
  curl -sf -m 2 "http://127.0.0.1:$mock_port/health" >/dev/null 2>&1 || { log "mock-graph-api not healthy on $mock_port (see $run_dir/mock.log)"; down "$run_dir"; exit 15; }
  for i in $(seq 1 120); do health=$(curl -sf -m 2 "http://127.0.0.1:$bot_port/health" 2>/dev/null) && break; sleep 0.5; done
  [ -n "${health:-}" ] || { log "bot not healthy on $bot_port after 60s (see $run_dir/bot.log)"; down "$run_dir"; exit 12; }
  for i in $(seq 1 120); do curl -sf -m 2 "http://127.0.0.1:$worker_port/health" >/dev/null 2>&1 && break; sleep 0.5; done
  curl -sf -m 2 "http://127.0.0.1:$worker_port/health" >/dev/null 2>&1 || { log "queue worker not healthy on $worker_port after 60s (see $run_dir/worker.log)"; down "$run_dir"; exit 17; }
  local running; running=$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("commit") or "")')
  if [ "$running" != "$full" ]; then log "/health reports commit '${running:-null}', wanted $full — refusing to drive"; down "$run_dir"; exit 13; fi

  STACK_CASSETTE_MODE="$cassette_mode" python3 - "$run_dir/stack.json" "$full" "$src" "$bot_port" "$mock_port" "$phone_id" "$want" "$NM_BOT/bot/node_modules" "$cassette_dir" "$run_dir/flow-public-key.b64" "$REPO/.claude/qa/fixtures/flows" <<'PY'
import json, sys, datetime, os
p, sha, src, bot, mock, phone, lock, nm, cas, pubkey_file, flows_dir = sys.argv[1:]
json.dump({"commit_sha": sha, "worktree": src, "bot_url": "http://127.0.0.1:%s" % bot, "mock_url": "http://127.0.0.1:%s" % mock, "worker": True, "queue": "bullmq",
           "flow_public_key_file": pubkey_file, "flows_dir": flows_dir, "flows": "emulated",
           "phone_number_id": phone, "lock_blob": lock, "node_modules": nm, "cassette_dir": cas, "cassette_mode": os.environ.get("STACK_CASSETTE_MODE", "replay-strict"),
           "started_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")}, open(p, "w"), indent=1)
PY
  log "up: bot $full on :$bot_port ← mock :$mock_port · worker :$worker_port · redis :$redis_port (worktree $src)"
  cat "$run_dir/stack.json"
}

down() {
  local run_dir="$1"
  for f in worker bot mock redis; do
    if [ -f "$run_dir/$f.pid" ]; then kill "$(cat "$run_dir/$f.pid")" >/dev/null 2>&1 || true; rm -f "$run_dir/$f.pid"; fi
  done
  # Belt and braces: anything still listening on this run's ports goes too.
  if [ -f "$run_dir/ports" ]; then
    for port in $(cat "$run_dir/ports"); do
      for pid in $(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null); do kill "$pid" >/dev/null 2>&1 || true; done
    done
    rm -f "$run_dir/ports"
  fi
  if [ -d "$run_dir/src" ]; then
    rm -f "$run_dir/src/bot/node_modules" "$run_dir/src/node_modules" "$run_dir/src/.env"
    git -C "$REPO" worktree remove --force "$run_dir/src" >/dev/null 2>&1 || rm -rf "$run_dir/src"
  fi
  git -C "$REPO" worktree prune >/dev/null 2>&1 || true
  log "down: $run_dir"
}

case "$CMD" in
  up)   up "${1:-}" "${2:-}";;
  down) down "${1:?run_dir}";;
  *) echo "usage: local-stack.sh up <sha> <run_dir> | down <run_dir>" >&2; exit 2;;
esac
