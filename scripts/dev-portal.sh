#!/usr/bin/env bash
# dev-portal.sh — the teacher + coach portal on your laptop, on a local database full of made-up data (bd-hnhlgn.1).
#
#   bash scripts/dev-portal.sh up   [run_dir]   # start everything, print the URL and the logins
#   bash scripts/dev-portal.sh down [run_dir]   # stop everything and drop the run's database
#   bash scripts/dev-portal.sh status [run_dir]
#
# run_dir defaults to ~/.cache/niete-dev-portal/run. What `up` does, in order:
#   1. checks the machine (local-db.sh doctor) and pulls the reference seed if it is missing (needs `gh` access
#      to the private fixtures repo — once per machine);
#   2. starts the mock-lane stack at this checkout's HEAD: local Postgres + PostgREST, the bot, its worker, a
#      mock WhatsApp API and a local file store (bot/scripts/e2e/local-stack.sh). Nothing talks to Meta, the
#      sandbox or production;
#   3. gives the bot and the portal one shared INTERNAL_API_KEY (the portal asks the bot for classes, LP
#      catalogue, assessment, training rules, certificates);
#   4. loads the SANDBOX's data (local-db.sh sandbox-copy — your own railway access; cached after the first pull,
#      SANDBOX_REFRESH=1 pulls again), then the demo school network on top so there are logins with a known password
#      (local-db.sh demo-seed), and populates the dashboard's materialized views. DATA=demo skips the sandbox;
#   5. writes the portal API's env into <run_dir>/portal/.env and starts dashboard/index.js FROM THAT FOLDER, so
#      your own dashboard/.env (and any real key in it) is never read;
#   6. builds the portal SPA into dashboard/portal-frontend/dist when it is missing (PORTAL_REBUILD=1 to force).
# The API runs YOUR working tree's dashboard/ — edit, then `down` + `up` (or kill <run_dir>/portal.pid and
# re-run `up`). The bot runs the committed HEAD, like every mock-lane run.
#
# Ports (override to run beside another stack): PORTAL_PORT (4000), and local-stack.sh's own MOCK_PORT,
# E2E_BOT_PORT, E2E_REDIS_PORT, E2E_WORKER_HEALTH_PORT, LOCAL_R2_PORT, E2E_SUPABASE_PORT, LOCAL_DB_REST_PORT.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
E2E="$REPO/bot/scripts/e2e"
CMD="${1:-}"; RUN="${2:-$HOME/.cache/niete-dev-portal/run}"
PORTAL_PORT="${PORTAL_PORT:-4000}"
PG_PORT="${LOCAL_DB_PG_PORT:-54329}"
log() { echo "[dev-portal] $*" >&2; }

up() {
  mkdir -p "$RUN"; RUN="$(cd "$RUN" && pwd)"
  if [ -f "$RUN/stack.json" ]; then log "already up in $RUN — run: bash scripts/dev-portal.sh down \"$RUN\""; exit 2; fi
  local missing; missing=$(bash "$E2E/local-db.sh" doctor 2>&1) || { log "this machine is missing:"; echo "$missing" >&2; exit 3; }
  if [ "$(bash "$E2E/local-db.sh" seed-status)" != ok ]; then
    log "pulling the reference seed (once per machine)…"
    bash "$E2E/local-db.sh" seed-pull >&2 || { log "seed-pull failed — you need read access to the private fixtures repo (gh auth status)"; exit 3; }
  fi

  local sha; sha=$(git -C "$REPO" rev-parse HEAD)
  log "starting the local stack at ${sha:0:9}…"
  bash "$E2E/local-stack.sh" up "$sha" "$RUN" >/dev/null || { log "local stack failed — see $RUN/*.log"; exit 4; }

  local key; key=$(openssl rand -hex 24)
  printf '%s' "$key" > "$RUN/internal-key"; chmod 600 "$RUN/internal-key"
  bash "$E2E/local-stack.sh" restart bot "$RUN" "INTERNAL_API_KEY=$key" >/dev/null 2>&1 || { log "bot did not restart with the internal key — $RUN/bot.log"; down; exit 4; }

  if [ "${DATA:-sandbox}" = sandbox ]; then
    log "copying the sandbox's data (first time ~15 min; then from the cache — SANDBOX_REFRESH=1 pulls again)…"
    bash "$E2E/local-db.sh" sandbox-copy "$RUN/db" $([ "${SANDBOX_REFRESH:-}" = 1 ] && echo --refresh) || {
      log "sandbox copy failed — it needs \`railway login\` with access to the NIETE-Rumi Staging project."
      log "  no sandbox access? run with DATA=demo for made-up data only."; down; exit 5; }
  fi
  bash "$E2E/local-db.sh" demo-seed "$RUN/db" >"$RUN/logins.txt" || { log "demo seed failed — $RUN/db/demo-seed.log"; down; exit 5; }
  local db; db=$(cat "$RUN/db/db.name")
  local psql; psql=$(dirname "$(command -v pg_ctl 2>/dev/null || echo /opt/homebrew/opt/postgresql@17/bin/pg_ctl)")/psql
  [ -x "$psql" ] || psql=/opt/homebrew/opt/postgresql@17/bin/psql
  "$psql" -X -q -h 127.0.0.1 -p "$PG_PORT" -U postgres -d "$db" -At \
    -c "select format('refresh materialized view %I.%I;', schemaname, matviewname) from pg_matviews where schemaname='public'" \
    | "$psql" -X -q -h 127.0.0.1 -p "$PG_PORT" -U postgres -d "$db" >"$RUN/mv-refresh.log" 2>&1 || log "warning: a materialized view did not refresh — $RUN/mv-refresh.log"

  local bot_port mock_port redis_port _rest; read -r mock_port bot_port redis_port _rest <"$RUN/ports"
  mkdir -p "$RUN/portal"
  {
    echo "# written by scripts/dev-portal.sh — local run only; gone after down"
    grep -E '^SUPABASE_(URL|SERVICE_ROLE_KEY)=' "$RUN/db/db.env"
    echo "SUPABASE_ANON_KEY=$(sed -nE 's/^SUPABASE_SERVICE_ROLE_KEY=//p' "$RUN/db/db.env")"
    echo "SUPABASE_DB_HOST=127.0.0.1"
    echo "SUPABASE_DB_PORT=$PG_PORT"
    echo "SUPABASE_DB_USER=postgres"
    echo "SUPABASE_DB_PASSWORD="
    echo "SUPABASE_DB_NAME=$db"
    echo "DATABASE_URL=postgres://postgres@127.0.0.1:$PG_PORT/$db"
    echo "PORTAL_LOCAL_DEV=1"
    echo "PORT=$PORTAL_PORT"
    echo "CLUSTER_ENABLED=false"
    echo "SESSION_SECRET=$(openssl rand -hex 24)"
    echo "REDIS_URL=redis://127.0.0.1:$redis_port"
    echo "MAIN_BOT_URL=http://127.0.0.1:$bot_port"
    echo "INTERNAL_API_KEY=$key"
    echo "RESEND_API_KEY=re_local_placeholder"
    grep -E '^R2_' "$RUN/src/.env"
    # No AXIOM_*: telemetry stays off, nothing leaves the laptop.
  } > "$RUN/portal/.env"
  chmod 600 "$RUN/portal/.env"

  [ -d "$REPO/dashboard/node_modules" ] || { log "installing dashboard dependencies…"; (cd "$REPO/dashboard" && npm ci --no-audit --no-fund >&2) || exit 6; }
  if [ ! -f "$REPO/dashboard/portal-frontend/dist/index.html" ] || [ "${PORTAL_REBUILD:-}" = 1 ]; then
    log "building the portal SPA (a few minutes the first time)…"
    (cd "$REPO" && npm ci --prefix portal --no-audit --no-fund >&2 && npm run build --prefix portal >&2 \
      && rm -rf dashboard/portal-frontend/dist && cp -r portal/dist dashboard/portal-frontend/dist) || { log "portal build failed"; down; exit 6; }
  fi

  ( cd "$RUN/portal" && exec node "$REPO/dashboard/index.js" ) >"$RUN/portal.log" 2>&1 &
  echo $! > "$RUN/portal.pid"
  local i; for i in $(seq 1 60); do curl -sf -m 2 "http://127.0.0.1:$PORTAL_PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done
  curl -sf -m 2 "http://127.0.0.1:$PORTAL_PORT/health" >/dev/null 2>&1 || { log "portal API did not come up — $RUN/portal.log"; tail -5 "$RUN/portal.log" >&2; exit 7; }

  echo
  echo "Portal: http://localhost:$PORTAL_PORT/portal/login"
  cat "$RUN/logins.txt"
  [ "${DATA:-sandbox}" = sandbox ] && echo "  + every sandbox account, with its sandbox password"
  echo "Logs: $RUN/portal.log (API) · $RUN/bot.log (bot) · stop with: bash scripts/dev-portal.sh down \"$RUN\""
}

down() {
  [ -d "$RUN" ] || { log "nothing at $RUN"; return 0; }
  if [ -f "$RUN/portal.pid" ]; then
    local pid i; pid=$(cat "$RUN/portal.pid")
    kill "$pid" 2>/dev/null || true
    # its SIGTERM handler waits on open sessions/pools; give it 10s, then make sure the port is free
    for i in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -9 "$pid" 2>/dev/null || true
    rm -f "$RUN/portal.pid"
  fi
  bash "$E2E/local-stack.sh" down "$RUN" >/dev/null 2>&1 || true
  rm -rf "$RUN/portal" "$RUN/internal-key" "$RUN/logins.txt" "$RUN/stack.json"
  log "down: $RUN"
}

status() {
  [ -f "$RUN/stack.json" ] || { echo "down"; return 0; }
  local p="$PORTAL_PORT"; [ -f "$RUN/portal/.env" ] && p=$(sed -nE 's/^PORT=//p' "$RUN/portal/.env")
  if curl -sf -m 2 "http://127.0.0.1:$p/health" >/dev/null 2>&1; then echo "up: http://localhost:$p/portal/login"; else echo "stack up, portal API not responding (port $p)"; fi
}

case "$CMD" in
  up) up;; down) down;; status) status;;
  *) sed -n '2,6p' "$0" >&2; exit 2;;
esac
