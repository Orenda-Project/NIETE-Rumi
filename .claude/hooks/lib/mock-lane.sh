#!/bin/bash
# mock-lane.sh — the lane split every QA hook applies to a COMMIT (phase 3 of the mock lane).
#
# Sourced by e2e-autorun.sh (PostToolUse), e2e-autorun-stop.sh (Stop), e2e-pending-banner.sh
# (SessionStart) and .githooks/post-commit, so the four places that tell a developer what to run
# cannot disagree about WHICH features go to which lane.
#
#   mock lane   bash .claude/qa/shared/commit-e2e.sh <sha> --features <a,b>
#               the bot starts from a detached worktree at <sha> behind the mock Graph API — this
#               is the run that tests THE COMMIT. Features: E2E_MOCK_FEATURES (default below).
#               Flow-only scenarios inside these features record BLOCKED there, never PASS.
#   chrome lane /niete-e2e <feature> — WhatsApp Web against the deployed staging build. For a
#               commit it can only regression-check the PREVIOUS build; it tests the change after
#               the develop deploy. Everything not in the mock list stays here.
#
# A PUSH keeps the chrome lane for everything (the code is deployed; that is what chrome tests).

# The mock lane's features are DERIVED, not hardcoded: a feature is covered iff its driver
# (.claude/qa/shared/features/<feature>.cjs) carries a `@mock-lane` marker — meaning it drives via the
# mock API, not the browser DOM. Add a mock-capable driver with the marker and the feature runs on the
# mock lane automatically; there is no list to maintain. E2E_MOCK_FEATURES overrides for a one-off.
# The fallback below is used only if the drivers dir can't be resolved (e.g. the inline copy in
# .githooks/post-commit, which cannot read the tree).
E2E_MOCK_FEATURES_DEFAULT="menu,language,status,lesson-plan,coaching,training,registration"

e2e_mock_features() {
  if [ -n "${E2E_MOCK_FEATURES:-}" ]; then printf '%s' "$E2E_MOCK_FEATURES"; return; fi
  local dir; dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../qa/shared/features" 2>/dev/null && pwd)"
  [ -n "$dir" ] || { printf '%s' "$E2E_MOCK_FEATURES_DEFAULT"; return; }
  local out="" f
  for f in "$dir"/*.cjs; do
    [ -e "$f" ] || continue
    head -5 "$f" | grep -qE '^//[[:space:]]*@mock-lane' || continue
    out="${out:+$out,}$(basename "$f" .cjs)"
  done
  [ -n "$out" ] && printf '%s' "$out" || printf '%s' "$E2E_MOCK_FEATURES_DEFAULT"
}

# Chrome lane PAUSED by default (operator, 2026-09-15): the mock lane is LAYER 1 and the sole
# auto-run for a commit. When paused, a commit drives ONLY the mock lane and the chrome-only features
# (registration / observe / attendance) are NOT auto-nudged. Chrome is layer 2, to be wired later.
# Re-enable the chrome lane with E2E_CHROME_ON=1. Returns 0 (paused) unless explicitly enabled.
e2e_chrome_paused() { [ "${E2E_CHROME_ON:-0}" != "1" ]; }

# Does <feature> have ANY driver at all? A touched feature with no driver (e.g. a brand-new feature,
# or observe/attendance today) cannot run on the mock lane — its Gherkin spec is auto-authored by
# Phase 1, but a mock driver must be written. e2e_needs_driver names those so the gap is visible
# rather than silently skipped.
e2e_needs_driver() {
  local dir; dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../qa/shared/features" 2>/dev/null && pwd)"
  [ -n "$dir" ] && [ ! -f "$dir/$1.cjs" ]
}

# e2e_split_lanes "<csv of features>"  → sets E2E_LANE_MOCK and E2E_LANE_CHROME (csv, may be empty)
e2e_split_lanes() {
  local feats="$1" f mock="" chrome="" allow=",$(e2e_mock_features),"
  local IFS=','
  for f in $feats; do
    [ -n "$f" ] || continue
    case "$allow" in *",$f,"*) mock="${mock:+$mock,}$f" ;; *) chrome="${chrome:+$chrome,}$f" ;; esac
  done
  E2E_LANE_MOCK="$mock"; E2E_LANE_CHROME="$chrome"
}

# e2e_filter_chrome_cmds "<commands, one per line>" "<mock csv>"
#   drops the `/niete-e2e <feature>` lines whose feature went to the mock lane; keeps the rest
#   (including the bare `/niete-e2e` SAFE fallback and `/niete-e2e all`).
e2e_filter_chrome_cmds() {
  local cmds="$1" mock="$2" line f keep
  printf '%s\n' "$cmds" | while IFS= read -r line; do
    [ -n "$line" ] || continue
    keep=1
    f=$(printf '%s' "$line" | sed -nE 's#^[[:space:]]*/niete-e2e[[:space:]]+([a-z-]+)[[:space:]]*$#\1#p')
    if [ -n "$f" ]; then case ",$mock," in *",$f,"*) keep=0 ;; esac; fi
    [ "$keep" = 1 ] && printf '%s\n' "$line"
  done
}

# e2e_mock_block "<sha>" "<mock csv>"  → the order text for the mock lane
e2e_mock_block() {
  local sha="$1" mock="$2"
  cat <<EOF
━━ MOCK LANE — tests THIS commit, no browser, no WhatsApp number ━━━━━━━━━━━━━━

  bash .claude/qa/shared/commit-e2e.sh $sha --features $mock

It starts the bot from a detached worktree at exactly that sha behind a local mock
Graph API, drives the same feature scripts, and appends runs.jsonl rows carrying
commit_sha, dirty, cassette and spec_sync. Vendors are cassette replay-strict: a
miss fails loudly and names the scenarios; it never goes live. Flows are never
rendered here — Flow scenarios record BLOCKED, not PASS. Read the rows it prints.
EOF
}

# ── Machine readiness (2026-09-18) ────────────────────────────────────────────────────────────
# The lane is "part of the hook" only if the hook can SAY, before an agent's turn, whether this
# machine can run it. Until now the first signal was exit 14 deep inside local-stack.sh — after the
# commit, after the worktree and results dir existed — so a developer without keys/niete-local.env
# was handed a command that could never run, and the ledger read `e2e: missing` (PR #1084).
# These three helpers give post-commit, the SessionStart banner and commit-e2e.sh one shared answer.

# e2e_main_checkout "<repo>" → the MAIN checkout even from a worktree (gitignored keys/ live there).
e2e_main_checkout() {
  local repo="$1" common
  common=$(git -C "$repo" rev-parse --git-common-dir 2>/dev/null) || { printf '%s' "$repo"; return; }
  case "$common" in /*) ;; *) common="$repo/$common" ;; esac
  dirname "$common"
}

# e2e_keys_dir "<main>" → <main>/keys, else the workspace-level ../keys. Mirrors local-stack.sh:39 —
# the FILE is checked, so a stray shadow keys/ (one carrying only niete-staging.env) cannot mask it.
e2e_keys_dir() {
  local d="$1/keys"
  [ -f "$d/niete-local.env" ] || d="$(dirname "$1")/keys"
  printf '%s' "$d"
}

# e2e_mock_lane_ready "<main>" → one missing precondition per line on stdout; returns 0 iff none.
# Exactly the two things local-stack.sh refuses without (exit 14 and exit 16); nothing speculative.
e2e_mock_lane_ready() {
  local main="$1" kd missing=0
  kd=$(e2e_keys_dir "$main")
  if [ ! -f "$kd/niete-local.env" ]; then
    printf 'keys/niete-local.env missing (looked in %s/keys and %s/keys)\n' "$main" "$(dirname "$main")"
    missing=1
  fi
  if ! command -v redis-server >/dev/null 2>&1; then
    printf 'redis-server not on PATH\n'
    missing=1
  fi
  return $missing
}

# e2e_mock_lane_autofix "<main>" [--with-redis]  → FIX the machine instead of asking (operator, 2026-09-18:
# "no manual interventions"). Missing keys file → run provision-local-keys.sh (sandbox DB lines from Railway's
# sandbox env, Flow/storage ids from staging). --with-redis and no redis-server → `brew install redis` when brew
# exists, else `apt-get install redis-server redis-tools` when apt-get exists AND root needs no
# password (bd-vqp9g: an Ubuntu box with no brew could not self-fix). Prints one line per action;
# returns 0 iff the machine is ready afterwards. The ONE thing it cannot
# create is `railway login`. E2E_AUTOFIX_OFF=1 disables it (CI, tests).
e2e_mock_lane_autofix() {
  local main="$1" with_redis="" kd prov rc=0 out
  [ "${2:-}" = "--with-redis" ] && with_redis=1
  if [ "${E2E_AUTOFIX_OFF:-}" = "1" ]; then e2e_mock_lane_ready "$main" >/dev/null; return $?; fi
  kd=$(e2e_keys_dir "$main")
  if [ ! -f "$kd/niete-local.env" ]; then
    prov="$main/bot/scripts/e2e/provision-local-keys.sh"
    [ -f "$prov" ] || prov="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." 2>/dev/null && pwd)/bot/scripts/e2e/provision-local-keys.sh"
    if [ -f "$prov" ]; then
      if out=$(cd "$main" && bash "$prov" --quiet 2>&1); then
        echo "auto-provisioned keys/niete-local.env — $out"
      else
        echo "keys/niete-local.env missing (auto-provision failed: $(printf '%s' "$out" | grep -v '^[[:space:]]*$' | tail -1 | sed 's/^\[provision-local-keys\] //' | cut -c1-220))"
        rc=1
      fi
    else
      echo "keys/niete-local.env missing (auto-provision unavailable: bot/scripts/e2e/provision-local-keys.sh is not in this checkout)"; rc=1
    fi
  fi
  if [ -n "$with_redis" ] && ! command -v redis-server >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      if brew install redis >/dev/null 2>&1 && command -v redis-server >/dev/null 2>&1; then
        echo "auto-installed redis-server via brew"
      else
        echo "redis-server not on PATH (brew install redis failed — see \`brew install redis\` by hand)"; rc=1
      fi
    elif command -v apt-get >/dev/null 2>&1; then
      # Ubuntu/Debian. apt-get needs root, and this runs from HOOKS: it must never prompt, or the
      # agent's turn hangs on a password prompt nobody can see. Install only when we are already
      # root or sudo -n works without one; otherwise name the command and stop (bd-vqp9g).
      local as_root=""
      if [ "$(id -u)" = "0" ]; then as_root="env"
      elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then as_root="sudo -n"
      fi
      if [ -n "$as_root" ] && $as_root apt-get install -y redis-server redis-tools >/dev/null 2>&1 \
         && command -v redis-server >/dev/null 2>&1; then
        echo "auto-installed redis-server via apt-get"
      else
        echo "redis-server not on PATH (needs root: sudo apt-get install -y redis-server redis-tools)"; rc=1
      fi
    else
      echo "redis-server not on PATH (no brew or apt-get to auto-install it)"; rc=1
    fi
  fi
  e2e_mock_lane_ready "$main" >/dev/null || rc=1
  return $rc
}

# e2e_mock_not_ready_block "<lines from e2e_mock_lane_ready / autofix>" → the warning + what is left to do.
# After autofix, a missing keys file means ONE thing: this machine is not logged into Railway.
e2e_mock_not_ready_block() {
  local why="$1"
  echo "⚠ MOCK LANE NOT RUNNABLE ON THIS MACHINE — a commit's commit-e2e.sh run stops before starting anything:"
  printf '%s\n' "$why" | sed 's/^/    · /'
  echo "  what is left (everything else is automatic):"
  case "$why" in *niete-local.env*)
    echo "    railway login        # an account with access to the \"NIETE-Rumi Staging\" project; the keys file is then provisioned automatically on the next commit / session" ;;
  esac
  case "$why" in *redis-server*)
    if command -v brew >/dev/null 2>&1 || ! command -v apt-get >/dev/null 2>&1; then
      echo "    brew install redis   # commit-e2e.sh installs it automatically when brew is present"
    else
      echo "    sudo apt-get install -y redis-server redis-tools   # commit-e2e.sh installs it automatically when it can sudo without a password"
    fi ;;
  esac
}
