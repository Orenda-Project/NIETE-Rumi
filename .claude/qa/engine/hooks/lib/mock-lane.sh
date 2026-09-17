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
# Drivers dir and slash command come from tenants.yaml via lib/tenants.sh (bd-9157r).
# shellcheck source=tenants.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tenants.sh"

E2E_MOCK_FEATURES_DEFAULT="menu,language,status,lesson-plan,coaching,training,registration"

e2e_mock_features() {
  if [ -n "${E2E_MOCK_FEATURES:-}" ]; then printf '%s' "$E2E_MOCK_FEATURES"; return; fi
  local dir; dir="$(e2e_root 2>/dev/null)/$(e2e_get drivers_dir 2>/dev/null)"
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
  local dir; dir="$(e2e_root 2>/dev/null)/$(e2e_get drivers_dir 2>/dev/null)"
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
  # `<command> <feature>` (single tenant) or `<command> <tenant> <feature>` (multi-tenant); the command is the
  # manifest's. The bare `<command>` (SAFE fallback) and `<command> all` never match and are kept.
  local cmds="$1" mock="$2" line f keep cmd; cmd=$(e2e_cmd)
  printf '%s\n' "$cmds" | while IFS= read -r line; do
    [ -n "$line" ] || continue
    keep=1
    f=$(printf '%s' "$line" | sed -nE "s#^[[:space:]]*${cmd}[[:space:]]+([a-z0-9_-]+[[:space:]]+)?([a-z-]+)[[:space:]]*\$#\2#p")
    if [ -n "$f" ]; then case ",$mock," in *",$f,"*) keep=0 ;; esac; fi
    [ "$keep" = 1 ] && printf '%s\n' "$line"
  done
}

# e2e_mock_block "<sha>" "<mock csv>"  → the order text for the mock lane
e2e_mock_block() {   # $1 sha · $2 mock features csv · $3 tenants csv ("" = single tenant, today's text exactly)
  local sha="$1" mock="$2" tenants="${3:-}" t lines
  if [ -z "$tenants" ]; then
    lines="  bash .claude/qa/engine/bin/commit-e2e.sh $sha --features $mock"
  else
    lines=""
    for t in $(printf '%s' "$tenants" | tr ',' ' '); do
      lines="${lines:+$lines
}  bash .claude/qa/engine/bin/commit-e2e.sh $sha --tenant $t --features $mock"
    done
  fi
  cat <<EOF
━━ MOCK LANE — tests THIS commit, no browser, no WhatsApp number ━━━━━━━━━━━━━━

$lines

It starts the bot from a detached worktree at exactly that sha behind a local mock
Graph API, drives the same feature scripts, and appends runs.jsonl rows carrying
commit_sha, dirty, cassette and spec_sync. Vendors are cassette replay-strict: a
miss fails loudly and names the scenarios; it never goes live. Flows are never
rendered here — Flow scenarios record BLOCKED, not PASS. Read the rows it prints.
EOF
}
