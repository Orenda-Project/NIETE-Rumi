#!/usr/bin/env bash
# run-all.sh — every engine test, against both fixture shapes where a test takes a fixture (bd-9157r).
#
#   bash .claude/qa/engine/tests/run-all.sh
#
# Runs under bash on purpose (the hooks are bash; lib/tenants.sh relies on BASH_SOURCE).
set -uo pipefail
# Resolve E2E_VENDORED_ROOT (a bot checkout to run the vendored suites against, see below) BEFORE the cd: `.` means
# the caller's repo root, not the engine dir.
if [ -n "${E2E_VENDORED_ROOT:-}" ]; then E2E_VENDORED_ROOT=$(cd "$E2E_VENDORED_ROOT" 2>/dev/null && pwd) || E2E_VENDORED_ROOT=""; fi
# E2E_NIETE_CHECKOUT=<dir> (+ E2E_NIETE_SHA, default de93aee5): the checkout whose REAL tenant layer the --real fixture
# overlays. A bot repo tests itself with `E2E_NIETE_CHECKOUT=. E2E_NIETE_SHA=HEAD` — a throwaway copy with a synthetic,
# non-merge baseline commit, so the suites are deterministic even when the live HEAD is a merge (whose committed diff
# is empty, which makes every phase-1 brief validate-only). Preferred over E2E_VENDORED_ROOT for that reason.
if [ -n "${E2E_NIETE_CHECKOUT:-}" ]; then E2E_NIETE_CHECKOUT=$(cd "$E2E_NIETE_CHECKOUT" 2>/dev/null && pwd) && export E2E_NIETE_CHECKOUT || unset E2E_NIETE_CHECKOUT; fi
cd "$(dirname "$0")/.." || exit 1
RC=0
run() { printf '\n\033[1m== %s\033[0m\n' "$*"; "$@" || { RC=1; printf '\033[31m   ^^ FAILED\033[0m\n'; }; }
# The fixtures symlink THIS engine in. A test that writes "through" that symlink (a deliberately broken
# spec_sync.py, say) edits the real engine — it happened twice on 2026-09-17. Fingerprint the tree first
# and refuse to report green if anything under it changed.
engine_fp() { find . -type f ! -path './tests/*' -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256 | cut -c1-16; }
FP_BEFORE=$(engine_fp)

run python3 bin/test_tenants_lite.py
run bash tests/mkfixture.test.sh
run bash tests/no-tenant-literals.test.sh     # Task 7 — engine code names no tenant
run bash tests/no-manifest.test.sh            # Task 7 — every hook is silent in an unguarded repo
run bash hooks/qa-engine-guard.test.sh        # Task 8 — the downstream read-only guard
[ -f ../../scripts/port_qa.test.py ] && run python3 ../../scripts/port_qa.test.py   # Task 8 — the porter (parent workspace only)

for shape in niete rumi; do
  D=$(mktemp -d)
  bash tests/mkfixture.sh "$shape" "$D" >/dev/null || { echo "cannot build $shape fixture"; RC=1; continue; }
  export E2E_FIXTURE="$D" E2E_FIXTURE_SHAPE="$shape"
  # Task 4 — the Python engine reads tenants.yaml (both shapes)
  run env E2E_FIXTURE="$D" E2E_FIXTURE_SHAPE="$shape" python3 bin/test_engine_tenancy.py
  # Task 5 — the bash engine (hooks, lib, git hooks) reads tenants.yaml (both shapes)
  run env E2E_FIXTURE="$D" E2E_FIXTURE_SHAPE="$shape" bash hooks/e2e-tenancy.test.sh
  # Task 6 — the Node runner/driver read tenants.yaml through tenant.cjs (both shapes; no bot seams needed)
  run env E2E_FIXTURE="$D" E2E_FIXTURE_SHAPE="$shape" node bin/test_tenant_cjs.js
  # Task 7 appends its fixture-driven tests below this line.
  unset E2E_FIXTURE E2E_FIXTURE_SHAPE
  rm -rf "$D"
done

# The vendored NIETE unit suites assert against NIETE's REAL feature map, agents and specs, so they run on a
# fixture that overlays that tenant layer at the pinned sha. No NIETE checkout on this machine = skipped,
# said out loud (never silently green).
# E2E_VENDORED_ROOT=<dir>: run the vendored suites against THAT repo instead of building a --real fixture — inside a
# bot checkout the repo itself is the real tenant layer (NIETE's `npm run qa:test` sets it to `.`). Never removed.
if [ -n "${E2E_VENDORED_ROOT:-}" ] && [ -f "$E2E_VENDORED_ROOT/.claude/qa/config/tenants.yaml" ]; then
  R=$(cd "$E2E_VENDORED_ROOT" && pwd); R_IS_REAL_REPO=1
else
  R=$(mktemp -d); R_IS_REAL_REPO=0
fi
if [ "$R_IS_REAL_REPO" = 1 ] || bash tests/mkfixture.sh niete "$R" --real >/dev/null 2>&1; then
  for t in test_select_e2e test_spec_sync test_validate_specs test_impact; do
    run env CLAUDE_PROJECT_DIR="$R" bash -c "cd '$R' && python3 '$R/.claude/qa/engine/bin/$t.py'"
  done
  # The vendored bash suites: each `cd`s to E2E_FIXTURE and drives the real hooks against throwaway repos.
  # 14 of their assertions ALREADY failed at the pinned source sha (tests/vendored-known-failures.txt, measured
  # against the untouched tests) — those are KNOWN; any other FAIL is a regression of the engine and fails this
  # run; a known one that now passes is reported as FIXED so the ledger can shrink.
  KNOWN=tests/vendored-known-failures.txt
  for t in hooks/lib/git-push-match.test.sh githooks/githooks.test.sh hooks/e2e-autorun-gitmarker.test.sh \
           hooks/e2e-phase1-gate.test.sh hooks/e2e-autorun.test.sh hooks/spec-sync-pipeline.test.sh; do
    printf '\n\033[1m== vendored %s\033[0m\n' "$t"
    OUT=$(env E2E_FIXTURE="$R" bash -c "cd '$R' && bash '$R/.claude/qa/engine/$t'" 2>&1)
    FAILS=$(printf '%s\n' "$OUT" | grep -E '^[[:space:]]*FAIL[[:space:]]' | sed -E 's/^[[:space:]]*FAIL[[:space:]]+//; s/ \(got .*$//' || true)
    EXP=$(grep -v '^#' "$KNOWN" | awk -F'\t' -v s="$t" '$1==s {print $2}')
    NEW=$(comm -23 <(printf '%s\n' "$FAILS" | sed '/^$/d' | LC_ALL=C sort) <(printf '%s\n' "$EXP" | sed '/^$/d' | LC_ALL=C sort))
    FIXED=$(comm -13 <(printf '%s\n' "$FAILS" | sed '/^$/d' | LC_ALL=C sort) <(printf '%s\n' "$EXP" | sed '/^$/d' | LC_ALL=C sort))
    nk=$(printf '%s\n' "$FAILS" | sed '/^$/d' | wc -l | tr -d ' '); nn=$(printf '%s\n' "$NEW" | sed '/^$/d' | wc -l | tr -d ' ')
    if [ "$nn" != 0 ]; then printf '\033[31m   REGRESSION — %s new failing assertion(s):\n%s\033[0m\n' "$nn" "$NEW"; RC=1
    else printf '   ok — %s failing, all known (pre-existing at the source sha)\n' "$nk"; fi
    [ -n "$(printf '%s' "$FIXED" | tr -d '[:space:]')" ] && printf '\033[33m   FIXED (remove from %s):\n%s\033[0m\n' "$KNOWN" "$FIXED"
  done
else
  printf '\n\033[33m== SKIPPED vendored NIETE suites: no NIETE-Rumi checkout found (set E2E_NIETE_CHECKOUT or E2E_VENDORED_ROOT)\033[0m\n'
fi
[ "$R_IS_REAL_REPO" = 1 ] || rm -rf "$R"
# test_mock_api.js and the other bin/test_*.js suites need the BOT SEAMS (mock-graph-api.js, flow-encryption,
# stored Flow JSON) — they run inside a real bot checkout (`node .claude/qa/engine/bin/test_mock_api.js` from
# NIETE-Rumi), not here. Said out loud so a green run is never mistaken for coverage of them.
printf '\n\033[33m== NOT RUN HERE: bin/test_mock_api.js, test_flow_drive.js, test_wa_drive.js, test_inject_wa_drive*.js — need the bot seams; run from a bot checkout\033[0m\n'

FP_AFTER=$(engine_fp)
if [ "$FP_BEFORE" != "$FP_AFTER" ]; then
  printf '\n\033[31m== ENGINE TREE CHANGED DURING THE RUN (%s -> %s): a test wrote through the fixture symlink. Run `git status .claude/qa/engine` and restore.\033[0m\n' "$FP_BEFORE" "$FP_AFTER"
  RC=1
fi
[ "$RC" = 0 ] && echo "engine tests: all ok" || { echo "engine tests: FAILURES"; exit 1; }
