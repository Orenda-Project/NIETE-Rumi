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

E2E_MOCK_FEATURES_DEFAULT="menu,language,status,lesson-plan,coaching,training"   # phase 2 added lesson-plan + coaching (media, worker); training = its text + certificates surface

e2e_mock_features() { printf '%s' "${E2E_MOCK_FEATURES:-$E2E_MOCK_FEATURES_DEFAULT}"; }

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
