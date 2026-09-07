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
#   4. Three processes: mock-graph-api, the bot. (The worker is Phase 2 — menu/language/status never
#      enqueue.) Readiness is polled; then /health must report commit == <sha> or exit 13.
#
# Exit codes: 10 lockfile mismatch · 11 worktree failed · 12 bot not healthy in time · 13 /health sha
# mismatch · 14 keys/niete-local.env missing · 15 mock not healthy.
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
KEYS_DIR="$MAIN/keys"; [ -d "$KEYS_DIR" ] || KEYS_DIR="$(dirname "$MAIN")/keys"   # workspace-level keys/ as a fallback

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
  local keys="$KEYS_DIR/niete-local.env"
  [ -f "$keys" ] || { log "missing $keys (sandbox creds + placeholders — see docs/e2e-mock-lane.md)"; exit 14; }
  local mock_port="${MOCK_PORT:-4010}" bot_port="${E2E_BOT_PORT:-3100}" phone_id="${E2E_PHONE_NUMBER_ID:-e2e-local}"
  local cassette_dir="${E2E_CASSETTE_DIR:-$MAIN/bot/temp/e2e-cassettes}"
  {
    cat "$keys"
    echo
    echo "# --- set by local-stack.sh for run $(basename "$run_dir") ---"
    echo "PORT=$bot_port"
    echo "PHONE_NUMBER_ID=$phone_id"
    echo "WHATSAPP_API_BASE=http://127.0.0.1:$mock_port"
    echo "E2E_COMMIT_SHA=$full"
    echo "E2E_CASSETTE=replay-strict"
    echo "E2E_CASSETTE_DIR=$cassette_dir"
    echo "E2E_CASSETTE_MISS_LOG=$run_dir/cassette-misses.jsonl"
    echo "NODE_ENV=test"
  } > "$src/.env"
  rm -f "$run_dir/cassette-misses.jsonl"

  # 4. processes
  # `exec` so the recorded pid IS node's, not a wrapper subshell's — killing a wrapper left the
  # real process alive on the port (first live run, 2026-09-07).
  ( cd "$src" && PHONE_NUMBER_ID="$phone_id" MOCK_PORT="$mock_port" MOCK_BOT_URL="http://127.0.0.1:$bot_port" \
      exec node bot/scripts/e2e/mock-graph-api.js ) >"$run_dir/mock.log" 2>&1 &
  echo $! >"$run_dir/mock.pid"
  ( cd "$src" && exec node bot/whatsapp-bot.js ) >"$run_dir/bot.log" 2>&1 &
  echo $! >"$run_dir/bot.pid"
  echo "$mock_port $bot_port" >"$run_dir/ports"

  local i health
  for i in $(seq 1 30); do curl -sf -m 2 "http://127.0.0.1:$mock_port/health" >/dev/null 2>&1 && break; sleep 0.5; done
  curl -sf -m 2 "http://127.0.0.1:$mock_port/health" >/dev/null 2>&1 || { log "mock-graph-api not healthy on $mock_port (see $run_dir/mock.log)"; down "$run_dir"; exit 15; }
  for i in $(seq 1 120); do health=$(curl -sf -m 2 "http://127.0.0.1:$bot_port/health" 2>/dev/null) && break; sleep 0.5; done
  [ -n "${health:-}" ] || { log "bot not healthy on $bot_port after 60s (see $run_dir/bot.log)"; down "$run_dir"; exit 12; }
  local running; running=$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("commit") or "")')
  if [ "$running" != "$full" ]; then log "/health reports commit '${running:-null}', wanted $full — refusing to drive"; down "$run_dir"; exit 13; fi

  python3 - "$run_dir/stack.json" "$full" "$src" "$bot_port" "$mock_port" "$phone_id" "$want" "$NM_BOT/bot/node_modules" "$cassette_dir" <<'PY'
import json, sys, datetime
p, sha, src, bot, mock, phone, lock, nm, cas = sys.argv[1:]
json.dump({"commit_sha": sha, "worktree": src, "bot_url": "http://127.0.0.1:%s" % bot, "mock_url": "http://127.0.0.1:%s" % mock,
           "phone_number_id": phone, "lock_blob": lock, "node_modules": nm, "cassette_dir": cas, "cassette_mode": "replay-strict",
           "started_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")}, open(p, "w"), indent=1)
PY
  log "up: bot $full on :$bot_port ← mock :$mock_port (worktree $src)"
  cat "$run_dir/stack.json"
}

down() {
  local run_dir="$1"
  for f in bot mock; do
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
