#!/usr/bin/env bash
# sim-stack.sh — the local mock-lane stack set up for the CHILD TEST simulation (bd-s1oo0.13).
#
#   bash bot/scripts/e2e/child-test-sim/sim-stack.sh up   <sha> <run_dir> [--live-vendors] [--teacher 3A|5A | --no-visit]
#   bash bot/scripts/e2e/child-test-sim/sim-stack.sh down <run_dir>
#   bash bot/scripts/e2e/child-test-sim/sim-stack.sh env-names [--live-vendors]   → names (no values) of the bot's env
#
# `up`, in order:
#   1. Sandbox only. The source env (SIM_SANDBOX_ENV, default ~/.childtest-golive/sandbox.env) must point at
#      the NIETE sandbox Supabase (olvritwoqujtjvwfulbh); NIETE prod / Rumi prod refs are refused.
#   2. keys/niete-local.env (the mock lane's keys file) is provisioned from it if missing — through the
#      repo's own provision-local-keys.sh (--from-kv), so the same ref assertion and credential filter apply —
#      and is then checked: sandbox ref, R2 bucket `rumi-sandbox`.
#   3. Today's SIM observe2 visit is seeded (seed-visit.js), as after a real observe2 visit: it fixes the
#      observed grade (Grade 3 teacher → Grade 3 list). --no-visit skips it: /egra then draws on the day key
#      (CONTRACT §12 CR-1, merged c6bad4cb) and the grade alternates.
#   4. local-stack.sh up <sha> <run_dir> runs in a CLEAN environment (env -i: nothing sourced in this
#      shell reaches the bot) plus the child-test flags. The bot's dotenv never overrides the process
#      env, so these win over the keys file:
#        CHILD_TEST_ENABLED=true  CHILD_TEST_R2_ENV=local-sim  CHILD_TEST_COACH_IDS=<SIM coach>
#        CHILD_TEST_DRAW_SECRET=<fresh random, never written or printed>
#        CHILD_TEST_CHECK_FLOW_ID=sim-child-test-check (L14: the bot sends the check card; the driver plays it)
#      Audio and photos go to R2 `rumi-sandbox` under child-test/local-sim/….
#   --live-vendors: real model calls for the scoring path (L5) — the sandbox's own OPENROUTER_API_KEY /
#      SONIOX_API_KEY / SPEECHACE_API_KEY (whichever exist) and E2E_CASSETTE=off, so no child speech is
#      recorded into any cassette. Without it the lane stays sealed (replay-strict: a vendor call FAILS).
#   5. <run_dir>/sim.json: stack, driver phone, visit id, mode. No secret is in it.
#
# Then:  node bot/scripts/e2e/child-test-sim/driver.js --mode mock --driver 923009990301 --mock-url <mock_url> …
# Exit codes: 2 usage · 3 not the sandbox · 4 keys file wrong · 5 seed failed · local-stack.sh's own (10–17).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
E2E="$REPO/bot/scripts/e2e"
SANDBOX_REF="olvritwoqujtjvwfulbh"
PROD_REFS="ihzciabopbttygxxgrkm jlpenspfdcwxkopaidys"
SIM_COACH_ID="5ee3518a-bc10-4cde-b276-31374e5c59d0"
SIM_COACH_PHONE="923009990301"
SRC="${SIM_SANDBOX_ENV:-$HOME/.childtest-golive/sandbox.env}"
log() { echo "[sim-stack] $*" >&2; }

ref_of() { printf '%s' "$1" | sed -nE 's#^https?://([a-z0-9]+)\.supabase\.co.*#\1#p'; }
val() { sed -nE "s/^$1=(.*)\$/\\1/p" "$2" | head -1 | tr -d '"'"'"; }   # value of KEY in an env file (never echoed)

main_checkout() {
  local common; common=$(git -C "$REPO" rev-parse --git-common-dir 2>/dev/null) || { echo "$REPO"; return; }
  case "$common" in /*) ;; *) common="$REPO/$common";; esac
  dirname "$common"
}

assert_sandbox_source() {
  [ -f "$SRC" ] || { log "no $SRC (the sandbox env)"; exit 3; }
  local url ref dburl r
  url=$(val SUPABASE_URL "$SRC"); ref=$(ref_of "$url")
  [ "$ref" = "$SANDBOX_REF" ] || { log "REFUSED: $SRC SUPABASE_URL is project '${ref:-?}', not the NIETE sandbox ($SANDBOX_REF)"; exit 3; }
  dburl=$(val DATABASE_URL "$SRC")
  for r in $PROD_REFS; do case "$dburl" in *"$r"*) log "REFUSED: $SRC DATABASE_URL names production ref $r"; exit 3;; esac; done
}

ensure_keys() {
  local keys_dir="${SIM_KEYS_DIR:-$1/keys}" f   # SIM_KEYS_DIR: tests only
  f="$keys_dir/niete-local.env"
  if [ ! -f "$f" ]; then
    mkdir -p "$keys_dir"
    if [ ! -f "$keys_dir/niete-sandbox.env" ]; then
      ( umask 077; grep -E '^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' "$SRC" > "$keys_dir/niete-sandbox.env" )
    fi
    bash "$E2E/provision-local-keys.sh" --keys-dir "$keys_dir" --from-kv "$SRC" --quiet >&2 || { log "provision-local-keys.sh failed"; exit 4; }
  fi
  [ "$(ref_of "$(val SUPABASE_URL "$f")")" = "$SANDBOX_REF" ] || { log "REFUSED: $f is not the sandbox"; exit 4; }
  [ "$(val R2_BUCKET_NAME "$f")" = "rumi-sandbox" ] || { log "REFUSED: $f R2_BUCKET_NAME is not rumi-sandbox (media must never reach another bucket)"; exit 4; }
  [ "$(stat -f %Lp "$f" 2>/dev/null || stat -c %a "$f")" = "600" ] || chmod 600 "$f"
}

# The env the bot is started with (env -i: nothing else reaches it). Fills the arrays `envs` and the
# string `vendors`. CHILD_TEST_CHECK_FLOW_ID is a mock id: the mock Graph API records the check card and
# the driver plays the Flow against the local endpoint (check-play.js) — without it sendCheck refuses.
stack_envs() {
  local live="${1:-}" v
  envs=(HOME="$HOME" PATH="$PATH" USER="${USER:-}" LANG="${LANG:-en_US.UTF-8}" TMPDIR="${TMPDIR:-/tmp}"
    CHILD_TEST_ENABLED=true CHILD_TEST_R2_ENV=local-sim CHILD_TEST_COACH_IDS="$SIM_COACH_ID"
    CHILD_TEST_CHECK_FLOW_ID="${CHILD_TEST_CHECK_FLOW_ID:-sim-child-test-check}"
    CHILD_TEST_DRAW_SECRET="$(openssl rand -hex 24)")
  for v in E2E_NODE_MODULES_ROOT E2E_BOT_NODE_MODULES_ROOT MOCK_PORT E2E_BOT_PORT E2E_REDIS_PORT E2E_WORKER_HEALTH_PORT E2E_DNS_FALLBACK CHILD_TEST_INCHAT_CARDS CHILD_TEST_QUICK_SUMS_SECONDS CHILD_TEST_PREFILL_MODE; do
    [ -n "${!v:-}" ] && envs+=("$v=${!v}")
  done
  vendors="sealed (replay-strict)"
  if [ -n "$live" ]; then
    envs+=(E2E_CASSETTE=off)
    vendors="live:"
    for v in OPENROUTER_API_KEY SONIOX_API_KEY SPEECHACE_API_KEY SPEECHACE_ENDPOINT; do
      local x; x=$(val "$v" "$SRC"); [ -n "$x" ] && { envs+=("$v=$x"); vendors="$vendors $v"; }
    done
  fi
}

# Names only (never values) of the env `up` starts the bot with.
env_names() {
  local live=""; [ "${1:-}" = "--live-vendors" ] && live=1
  assert_sandbox_source
  local -a envs=(); local vendors=""
  stack_envs "$live"
  local e; for e in "${envs[@]}"; do printf '%s\n' "${e%%=*}"; done
}

up() {
  local sha="${1:-}" run_dir="${2:-}"; shift 2 || true
  [ -n "$sha" ] && [ -n "$run_dir" ] || { echo "usage: sim-stack.sh up <sha> <run_dir> [--live-vendors] [--teacher 3A|5A]" >&2; exit 2; }
  local live="" teacher="3A"
  while [ $# -gt 0 ]; do case "$1" in
    --live-vendors) live=1; shift;;
    --teacher) teacher="$2"; shift 2;;
    --no-visit) teacher=""; shift;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac; done
  assert_sandbox_source
  local main; main="$(main_checkout)"
  ensure_keys "$main"
  mkdir -p "$run_dir"

  local visit="none (day key: /egra with no observe2 visit)"
  if [ -n "$teacher" ]; then
  local seed; seed=$(env -i HOME="$HOME" PATH="$PATH" NODE_PATH="$REPO/bot/node_modules" \
      SUPABASE_URL="$(val SUPABASE_URL "$SRC")" SUPABASE_SERVICE_ROLE_KEY="$(val SUPABASE_SERVICE_ROLE_KEY "$SRC")" \
      node "$HERE/seed-visit.js" --yes-write --teacher "$teacher") || { log "seed-visit failed"; exit 5; }
  visit=$(printf '%s' "$seed" | python3 -c 'import json,sys; print(json.load(sys.stdin)["visitId"])')
  log "SIM visit $visit ($teacher)"
  fi

  local -a envs=(); local vendors=""
  stack_envs "$live"
  log "vendors: $vendors"
  env -i "${envs[@]}" bash "$E2E/local-stack.sh" up "$sha" "$run_dir" >/dev/null || exit $?

  python3 - "$run_dir" "$visit" "$teacher" "$SIM_COACH_PHONE" "$vendors" <<'PY'
import json, sys, os
run, visit, teacher, phone, vendors = sys.argv[1:]
stack = json.load(open(os.path.join(run, "stack.json")))
json.dump({"stack": os.path.join(run, "stack.json"), "commit_sha": stack["commit_sha"], "bot_url": stack["bot_url"], "mock_url": stack["mock_url"],
           "driver": phone, "visit_id": visit, "teacher": teacher, "r2_env": "local-sim", "vendors": vendors},
          open(os.path.join(run, "sim.json"), "w"), indent=1)
print(json.dumps({"mock_url": stack["mock_url"], "bot_url": stack["bot_url"], "commit_sha": stack["commit_sha"], "visit_id": visit, "vendors": vendors}))
PY
}

down() {
  local run_dir="${1:?run_dir}"
  bash "$E2E/local-stack.sh" down "$run_dir"
  log "down: the SIM visit is kept; reset the SIM school with sim/tools/reset_sim_school.sh --yes, then seed-visit.js --remove --yes-write"
}

CMD="${1:-}"; shift || true
case "$CMD" in
  up) up "$@";;
  down) down "$@";;
  env-names) env_names "$@";;
  *) echo "usage: sim-stack.sh up <sha> <run_dir> [--live-vendors] [--teacher 3A|5A] | down <run_dir>" >&2; exit 2;;
esac
