#!/usr/bin/env bash
# dev-portal.sh — the teacher + coach portal on your laptop, on a local database full of made-up data (bd-hnhlgn.1).
#
#   bash scripts/dev-portal.sh up   [run_dir]   # start everything, print the URL and the logins
#   bash scripts/dev-portal.sh down [run_dir]   # stop everything and drop the run's database
#   bash scripts/dev-portal.sh status [run_dir]
#   bash scripts/dev-portal.sh refresh [run_dir]   # move a running portal to this checkout's HEAD, database kept
#   bash scripts/dev-portal.sh follows [run_dir]   # exit 0 iff this checkout started the run (it follows our commits)
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
# FOLLOWING YOUR COMMITS (bd-i56c2u): `up` records the checkout that started it, and every commit in THAT checkout
# runs `refresh` in the background (.githooks/post-commit): the bot and worker move to the new HEAD, the portal API
# restarts, the SPA is rebuilt when portal/ changed, and the database — with whatever you did in it — is kept.
# Commits in any other worktree never move it. A change under supabase/baseline/ is called out, not applied: run
# down + up for a fresh database. Log: <run_dir>/refresh.log. Off for one commit: DEV_PORTAL_FOLLOW=0 git commit …
#
# Ports (override to run beside another stack): PORTAL_PORT (4000), and local-stack.sh's own MOCK_PORT,
# E2E_BOT_PORT, E2E_REDIS_PORT, E2E_WORKER_HEALTH_PORT, LOCAL_R2_PORT, E2E_SUPABASE_PORT, LOCAL_DB_REST_PORT.
set -uo pipefail
# A git hook exports GIT_INDEX_FILE (and, from a worktree, GIT_DIR/GIT_WORK_TREE). Inherited, they point every
# `git -C <dir>` below at the COMMITTING checkout: the first refresh from .githooks/post-commit detached the
# committer's branch instead of moving the stack (bd-i56c2u). This script always names its repo with -C.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
E2E="$REPO/bot/scripts/e2e"
CMD="${1:-}"; RUN="${2:-${DEV_PORTAL_RUN:-$HOME/.cache/niete-dev-portal/run}}"
PORTAL_PORT="${PORTAL_PORT:-4000}"
PG_PORT="${LOCAL_DB_PG_PORT:-54329}"
log() { echo "[dev-portal] $*" >&2; }

# The checkout a run follows: the one whose `up` started it (bd-i56c2u). -P: one spelling per directory.
this_checkout() { (cd "$REPO" && pwd -P); }
follows() { [ -f "$RUN/stack.json" ] && [ -f "$RUN/owner" ] && [ "$(cat "$RUN/owner")" = "$(this_checkout)" ]; }
portal_port() { local p; p=$(sed -nE 's/^PORT=//p' "$RUN/portal/.env" 2>/dev/null); echo "${p:-$PORTAL_PORT}"; }
# What the bot needs on top of its composed .env to talk to THIS portal (same values at `up` and on every refresh).
# PORTAL_URL: the bot's portal links (/menu's one-tap /go link, /portal) must open THIS stack's portal, not the
# Vite dev port local-lane.env names — or a WhatsApp → portal round trip leaves the stack (bd-hnhlgn.7).
# WEB_QUIZ_BASE_URL: the child's links the bot sends on WhatsApp (the hub's Open button, the guest home, the class
# link) go out as WhatsApp cta_url messages, which must be https (whatsapp.service sendCtaUrl refuses anything else).
# This stack serves plain http, so the bot is given the https spelling of THIS portal; a test maps it back to
# http://localhost:<port> before opening it. The page's own share links use its origin and are unaffected.
bot_overrides() {
  local port; port=$(portal_port)
  printf '%s\n' "INTERNAL_API_KEY=$(cat "$RUN/internal-key")" "PORTAL_URL=http://localhost:$port" \
    "WEB_QUIZ_BASE_URL=${WEB_QUIZ_BASE_URL:-https://localhost:$port}"
}
build_spa() {
  log "building the portal SPA (a few minutes the first time)…"
  if [ -n "${DEV_PORTAL_BUILD_CMD:-}" ]; then (cd "$REPO" && eval "$DEV_PORTAL_BUILD_CMD"); return; fi
  (cd "$REPO" && npm ci --prefix portal --no-audit --no-fund >&2 && npm run build --prefix portal >&2 \
    && rm -rf dashboard/portal-frontend/dist && cp -r portal/dist dashboard/portal-frontend/dist)
}
start_portal() {
  local port; port=$(portal_port)
  ( cd "$RUN/portal" && exec node "$REPO/dashboard/index.js" ) >>"$RUN/portal.log" 2>&1 &
  echo $! > "$RUN/portal.pid"
  local i; for i in $(seq 1 60); do curl -sf -m 2 "http://127.0.0.1:$port/health" >/dev/null 2>&1 && break; sleep 0.5; done
  curl -sf -m 2 "http://127.0.0.1:$port/health" >/dev/null 2>&1 || { log "portal API did not come up — $RUN/portal.log"; tail -5 "$RUN/portal.log" >&2; return 7; }
}
stop_portal() {
  [ -f "$RUN/portal.pid" ] || return 0
  local pid i; pid=$(cat "$RUN/portal.pid")
  kill "$pid" 2>/dev/null || true
  # its SIGTERM handler waits on open sessions/pools; give it 10s, then make sure the port is free
  for i in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$RUN/portal.pid"
}

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
  this_checkout > "$RUN/owner"   # commits in this checkout move it (refresh); nowhere else's do

  local key; key=$(openssl rand -hex 24)
  printf '%s' "$key" > "$RUN/internal-key"; chmod 600 "$RUN/internal-key"
  local -a env_over; while IFS= read -r l; do env_over+=("$l"); done < <(bot_overrides)
  bash "$E2E/local-stack.sh" restart bot "$RUN" "${env_over[@]}" >/dev/null 2>&1 || { log "bot did not restart with the internal key — $RUN/bot.log"; down; exit 4; }

  if [ "${DATA:-sandbox}" = sandbox ]; then
    log "copying the sandbox's data (first time ~15 min; then from the cache — SANDBOX_REFRESH=1 pulls again)…"
    bash "$E2E/local-db.sh" sandbox-copy "$RUN/db" $([ "${SANDBOX_REFRESH:-}" = 1 ] && echo --refresh) || {
      log "sandbox copy failed — it needs \`railway login\` with access to the NIETE-Rumi Staging project."
      log "  no sandbox access? run with DATA=demo for made-up data only."; down; exit 5; }
  fi
  bash "$E2E/local-db.sh" demo-seed "$RUN/db" >"$RUN/logins.txt" || { log "demo seed failed — $RUN/db/demo-seed.log"; down; exit 5; }
  local db; db=$(cat "$RUN/db/db.name")
  bash "$E2E/local-db.sh" refresh-views "$RUN/db" >"$RUN/mv-refresh.log" 2>&1 \
    || log "warning: the dashboard's summary views did not refresh — $RUN/mv-refresh.log"

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
    build_spa || { log "portal build failed"; down; exit 6; }
  fi

  : > "$RUN/portal.log"
  start_portal || exit 7

  echo
  echo "Portal: http://localhost:$PORTAL_PORT/portal/login"
  echo "Mock WhatsApp (chat with the local bot): http://127.0.0.1:$mock_port/console"
  cat "$RUN/logins.txt"
  [ "${DATA:-sandbox}" = sandbox ] && echo "  + every sandbox account, with its sandbox password"
  echo "Logs: $RUN/portal.log (API) · $RUN/bot.log (bot) · stop with: bash scripts/dev-portal.sh down \"$RUN\""
}

down() {
  [ -d "$RUN" ] || { log "nothing at $RUN"; return 0; }
  stop_portal
  bash "$E2E/local-stack.sh" down "$RUN" >/dev/null 2>&1 || true
  rm -rf "$RUN/portal" "$RUN/internal-key" "$RUN/logins.txt" "$RUN/stack.json" "$RUN/owner" "$RUN/refresh.lock" "$RUN/refresh.again"
  log "down: $RUN"
}

status() {
  [ -f "$RUN/stack.json" ] || { echo "down"; return 0; }
  local p="$PORTAL_PORT"; [ -f "$RUN/portal/.env" ] && p=$(sed -nE 's/^PORT=//p' "$RUN/portal/.env")
  if curl -sf -m 2 "http://127.0.0.1:$p/health" >/dev/null 2>&1; then echo "up: http://localhost:$p/portal/login"; else echo "stack up, portal API not responding (port $p)"; fi
}

# refresh — move a running portal to this checkout's HEAD, database kept. Only the checkout that started it may
# (follows); anywhere else it says so and exits 0. One refresh at a time: a commit that lands while one runs
# leaves refresh.again and the running one goes round once more, so the last commit always wins.
refresh() {
  [ -f "$RUN/stack.json" ] || { log "nothing running at $RUN"; return 0; }
  if ! follows; then
    log "$RUN was not started from this checkout ($(this_checkout)); it follows $(cat "$RUN/owner" 2>/dev/null || echo 'no checkout — it predates following: down + up once')"
    return 0
  fi
  if ! mkdir "$RUN/refresh.lock" 2>/dev/null; then : > "$RUN/refresh.again"; log "a refresh is already running — it will pick this commit up"; return 0; fi
  trap 'rmdir "$RUN/refresh.lock" 2>/dev/null' EXIT
  local rc=0
  while :; do
    rm -f "$RUN/refresh.again"
    refresh_once || { rc=$?; break; }
    [ -f "$RUN/refresh.again" ] || break
  done
  return $rc
}
start_bot_worker() {   # at whatever commit the stack's worktree is on; true iff /health reports it
  local -a env_over; local l; while IFS= read -r l; do env_over+=("$l"); done < <(bot_overrides)
  bash "$E2E/local-stack.sh" restart bot "$RUN" "${env_over[@]}" >&2 \
    && bash "$E2E/local-stack.sh" restart worker "$RUN" >&2 \
    && bash "$E2E/local-stack.sh" verify "$RUN" >&2
}
refresh_once() {
  local new old; new=$(git -C "$REPO" rev-parse HEAD)
  old=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("commit_sha",""))' "$RUN/stack.json")
  [ "$new" = "$old" ] && { log "already at ${new:0:9}"; return 0; }
  log "refreshing ${old:0:9} → ${new:0:9}…"
  git -C "$REPO" diff --quiet "$old" "$new" -- supabase/baseline 2>/dev/null \
    || log "warning: supabase/baseline changed between ${old:0:9} and ${new:0:9} — the database was kept as it was; down + up for a fresh one"
  bash "$E2E/local-stack.sh" retarget "$new" "$RUN" >&2 || { log "could not move the stack to ${new:0:9}; it is still at ${old:0:9}"; return 4; }
  if ! start_bot_worker; then
    # The new commit's bot or worker did not come up: go back to the commit that was running rather than leave
    # the stack half down. The commit itself is untouched; fix it and commit again (or run refresh).
    log "the bot or worker did not come up at ${new:0:9} — $RUN/bot.log, $RUN/worker.log; going back"
    if bash "$E2E/local-stack.sh" retarget "$old" "$RUN" >&2 && start_bot_worker; then log "back at ${old:0:9}"
    else log "could not go back to ${old:0:9} either — down + up"; fi
    return 4
  fi
  if ! git -C "$REPO" diff --quiet "$old" "$new" -- dashboard/package-lock.json 2>/dev/null; then
    log "dashboard dependencies changed — installing…"; (cd "$REPO/dashboard" && npm ci --no-audit --no-fund >&2) || return 6
  fi
  if ! git -C "$REPO" diff --quiet "$old" "$new" -- portal 2>/dev/null; then build_spa || { log "portal build failed — the old SPA is still served"; }; fi
  stop_portal; start_portal || return 7
  log "up at ${new:0:9}: http://localhost:$(portal_port)/portal/login"
}

case "$CMD" in
  up) up;; down) down;; status) status;; refresh) refresh;; follows) follows;;
  *) sed -n '2,6p' "$0" >&2; exit 2;;
esac
