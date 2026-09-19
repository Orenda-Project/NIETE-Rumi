#!/usr/bin/env bash
# commit-e2e.sh — ONE command from a commit to a runs.jsonl row, on this machine, with no browser:
#
#   commit → affected features (select_e2e) → Gherkin sync brief (spec_sync) → validate_specs gate
#          → bot from a detached worktree at THAT sha → mock Graph API → mock driver → runs.jsonl
#
#   bash .claude/qa/shared/commit-e2e.sh [<sha>|HEAD] [--features menu,language] [--all-mock] [--record]
#   --record un-seals the lane ONCE to capture the vendor answers as a committed cassette fixture
#   (needs keys/niete-record.env with real vendor keys). Normal runs stay sealed: replay-strict, no keys.
#
# The mock lane drives menu · language · status · lesson-plan · coaching · training (phase 2 added the pipelines:
# media through the mock, a private redis + the queue worker in the stack); anything else the
# commit touched is reported as "chrome lane only" and left to the post-deploy WhatsApp Web run.
# Exit 0 = ran (look at the ledger rows for the verdicts) · 1 = validate_specs errors, nothing driven ·
# 2 = usage · 3 = the stack/run was blocked (see the run log). Nothing selected is exit 0 and says so.
set -uo pipefail
QA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"            # …/.claude/qa/engine/bin
# The mock lane's features are DERIVED from the `@mock-lane` marker each mock-capable driver carries
# (lib/mock-lane.sh). Source the same resolver the hooks use instead of a second hardcoded list, so
# adding a marked driver enrols the feature everywhere at once. E2E_MOCK_FEATURES still overrides.
# mock-lane.sh sources lib/tenants.sh, which gives us the repo root (the one carrying tenants.yaml).
. "$QA/../hooks/lib/mock-lane.sh" 2>/dev/null || { echo "ERROR: cannot load $QA/../hooks/lib/mock-lane.sh"; exit 2; }
ROOT=$(e2e_root) || { echo "ERROR: no .claude/qa/config/tenants.yaml above $PWD (or CLAUDE_PROJECT_DIR) — not a guarded repo"; exit 2; }
KEYS_LOCAL_NAME=$(basename "$(e2e_get keys.local 2>/dev/null || echo local.env)")
KEYS_RECORD_NAME=$(basename "$(e2e_get keys.record 2>/dev/null || echo record.env)")
MOCK_FEATURES="$(type e2e_mock_features >/dev/null 2>&1 && e2e_mock_features || echo "menu,language,status,lesson-plan,coaching,training,registration")"

REF="HEAD"; FORCE=""; RECORD="" RECORD_MODE="" TENANT=""
while [ $# -gt 0 ]; do case "$1" in
  --features) FORCE="$2"; shift 2;;
  --tenant) TENANT="$2"; shift 2;;   # one tenant; default = every tenant the selection fans out to (in order)
  --all-mock) FORCE="$MOCK_FEATURES"; shift;;
  --record) RECORD=1; shift;;   # un-seal for ONE run: live vendor calls → committed cassette fixture
  --record-missing) RECORD=1; RECORD_MODE=replay; shift;;   # top up: replay hits, record only the misses
  -h|--help) sed -n 2,13p "$0"; exit 0;;
  *) REF="$1"; shift;; esac; done

# --record un-seals the lane for a single run to CAPTURE the vendor answers (Soniox/LLM) as a committed
# fixture under .claude/qa/fixtures/cassettes/. It makes LIVE, paid calls, so it demands a separate keys
# file with real vendor keys — never the sealed default. Guard it before anything runs.
if [ -n "$RECORD" ]; then
  _main="$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null)"; case "$_main" in /*) ;; *) _main="$ROOT/$_main";; esac
  _main="$(dirname "$_main")"; _kd="$_main/keys"; [ -f "$_kd/$KEYS_LOCAL_NAME" ] || _kd="$(dirname "$_main")/keys"
  if [ ! -f "$_kd/$KEYS_RECORD_NAME" ]; then
    echo "┌ commit-e2e --record"
    echo "│ RECORD needs $_kd/$KEYS_RECORD_NAME with REAL vendor keys (Soniox / OpenRouter / ElevenLabs,"
    echo "│ plus R2_* to mirror). Recording makes LIVE, paid calls — the sealed default lane never has them."
    echo "│ Copy your staging vendor keys into that file (it is gitignored), then re-run with --record."
    echo "└ nothing ran. See docs/e2e-mock-lane.md § Recording the cassette."
    exit 2
  fi
  export E2E_CASSETTE_MODE="${RECORD_MODE:-record}" DEEP=1
  echo "┌ RECORD MODE — live vendor calls; cassettes → .claude/qa/fixtures/cassettes/ (commit them after)"
fi
SHA=$(git -C "$ROOT" rev-parse --verify "${REF}^{commit}" 2>/dev/null) || { echo "ERROR: '$REF' is not a commit"; exit 2; }
SHORT=${SHA:0:12}
PEND="$ROOT/.claude/.e2e-pending"; mkdir -p "$PEND"
echo "┌ commit-e2e · $SHORT · $(git -C "$ROOT" log -1 --format=%s "$SHA" | cut -c1-70)"

# 1. which features did this commit touch?
SEL=$(python3 "$QA/select_e2e.py" --repo "$ROOT" --range "$SHA~1...$SHA" --json 2>/dev/null || echo '{}')
SEL_FEATURES=$(printf '%s' "$SEL" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(",".join(d.get("features") or []))' 2>/dev/null)
echo "│ selection: ${SEL_FEATURES:-(none)}$(printf '%s' "$SEL" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("  [fallback: "+str(d.get("fallback_reason"))+"]" if d.get("fallback") else "")' 2>/dev/null)"

# 2. the Gherkin sync brief (phase 1) — from the SAME selection
BRIEF_FILE="$PEND/mock-$SHORT.sync.json"; rm -f "$BRIEF_FILE"; SYNC_NEEDED=false
if [ -n "$SEL_FEATURES" ] && [ "${E2E_SPEC_SYNC_OFF:-}" != "1" ]; then
  BRIEF=$(printf '%s' "$SEL" | python3 "$QA/spec_sync.py" --selection - --repo "$ROOT" --range "$SHA~1...$SHA" --json 2>/dev/null || true)
  if [ -n "$BRIEF" ]; then
    printf '%s' "$BRIEF" > "$BRIEF_FILE"
    SYNC_NEEDED=$(printf '%s' "$BRIEF" | python3 -c 'import json,sys; print(str(json.load(sys.stdin).get("sync_needed", False)).lower())' 2>/dev/null || echo false)
  fi
fi
if [ "$SYNC_NEEDED" = true ]; then
  echo "│ gherkin:   SYNC NEEDED → /sync-specs --brief ${BRIEF_FILE#$ROOT/}   (authoring is an agent step; recorded on the ledger row)"
else
  echo "│ gherkin:   nothing to author (validate only)"
fi

# 3. what will actually be driven here
FEATURES="${FORCE:-$SEL_FEATURES}"
RUN=""; LATER=""
IFS=',' read -r -a arr <<< "$FEATURES"
for f in "${arr[@]}"; do [ -z "$f" ] && continue
  case ",$MOCK_FEATURES," in *",$f,"*) RUN="${RUN:+$RUN,}$f";; *) LATER="${LATER:+$LATER,}$f";; esac
done
[ -n "$LATER" ] && echo "│ chrome lane only (not in the mock lane yet): $LATER"
if [ -z "$RUN" ]; then echo "└ nothing for the mock lane to drive — done."; exit 0; fi

# 3b. can THIS machine run the lane? FIX it first (keys from Railway, redis via brew) — no manual step. Only if
# it still cannot (railway not logged in) say so NOW, not exit 14 deep inside local-stack.sh (PR #1084).
if type e2e_mock_lane_autofix >/dev/null 2>&1; then
  _MAIN=$(e2e_main_checkout "$ROOT")
  _FIX=$(e2e_mock_lane_autofix "$_MAIN" --with-redis); _FIX_RC=$?
  [ -n "$_FIX" ] && printf '%s\n' "$_FIX" | sed 's/^/│ machine:   /'
  if [ "$_FIX_RC" -ne 0 ]; then
    echo "│ machine:   NOT READY for the mock lane"
    e2e_mock_not_ready_block "$(e2e_mock_lane_ready "$_MAIN"; printf '%s\n' "$_FIX" | grep -E 'failed|unavailable' || true)" | sed 's/^/│ /'
    echo "└ nothing ran (exit 3). Once the provisioner can log in, re-run this exact command — the rest is automatic."
    exit 3
  fi
fi

# 4. the gate
python3 "$QA/validate_specs.py" --only "$RUN" >"$PEND/mock-$SHORT.validate.log" 2>&1; VEXIT=$?
if [ "$VEXIT" -ne 0 ]; then
  echo "│ validate_specs: exit $VEXIT — NOT driving. $(grep -c '^E-' "$PEND/mock-$SHORT.validate.log" 2>/dev/null || echo '?') error(s):"
  grep -E '^\s*E-|error' "$PEND/mock-$SHORT.validate.log" | head -8 | sed 's/^/│   /'
  echo "└ fix the spec, or say plainly that the run is skipped and why."
  exit 1
fi
echo "│ validate_specs: exit 0 for $RUN"

# 5. drive: bot from a detached worktree at $SHA, mock Graph API, mock driver — ONCE PER TENANT.
# Which tenants: --tenant, else every tenant the selection fanned out to (the main bot boots once per
# region with that region's PHONE_NUMBER_ID), else the manifest's first tenant. A single-tenant repo runs
# exactly one iteration and prints what it always printed.
if [ -n "$TENANT" ]; then TENANTS="$TENANT"
else
  TENANTS=$(printf '%s' "$SEL" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(" ".join(d.get("tenant_features") or {}))' 2>/dev/null)
  [ -n "$TENANTS" ] || TENANTS=$(e2e_tenants | head -1)
fi
STAMP="$(date -u +%Y%m%d-%H%M%S)-${SHA:0:7}-mock"
RC=0
for T in $TENANTS; do
  RUN_ID="$STAMP"; [ "$(e2e_tenants | wc -l | tr -d ' ')" -gt 1 ] && RUN_ID="$STAMP-$T"
  echo "│ driving:   $RUN  (tenant $T · run $RUN_ID)"
  echo "└─────────────────────────────────────────────────────────────────────"
  E2E_TRIGGER="${E2E_TRIGGER:-commit}" bash "$QA/run-suite.sh" "$RUN" --method mock --commit "$SHA" --run-id "$RUN_ID" --tenant "$T" \
    --spec-sync "$([ -f "$BRIEF_FILE" ] && echo "${BRIEF_FILE#$ROOT/}" || echo none)" --validator-exit "$VEXIT"
  rc=$?; [ "$rc" -ne 0 ] && RC=$rc
  echo
  echo "┌ runs.jsonl rows for $RUN_ID:"
  grep "\"run_id\": *\"$RUN_ID\"" "$ROOT/.claude/qa/ledgers/runs.jsonl" 2>/dev/null | python3 -c '
import json,sys
for l in sys.stdin:
    r=json.loads(l); print("│  %-6s %-10s %-8s pass=%d fail=%d blocked=%d skipped=%d  commit=%s dirty=%s cassette_misses=%s" % (
        r.get("tenant",""), r["feature"], r["status"], r["summary"]["passed"], r["summary"]["failed"], r["summary"]["blocked"], r["summary"].get("skipped",0),
        (r.get("commit_sha") or "")[:12], r.get("dirty"), (r.get("cassette") or {}).get("misses")))' || echo "│  (no rows — the run did not reach the ledger)"
  echo "└ evidence: .claude/qa/results/whatsapp/$T/$RUN_ID/"
done
exit $RC
