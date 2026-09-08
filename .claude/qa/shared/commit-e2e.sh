#!/usr/bin/env bash
# commit-e2e.sh — ONE command from a commit to a runs.jsonl row, on this machine, with no browser:
#
#   commit → affected features (select_e2e) → Gherkin sync brief (spec_sync) → validate_specs gate
#          → bot from a detached worktree at THAT sha → mock Graph API → mock driver → runs.jsonl
#
#   bash .claude/qa/shared/commit-e2e.sh [<sha>|HEAD] [--features menu,language] [--all-mock]
#
# The mock lane drives menu · language · status · lesson-plan · coaching (phase 2 added the last two:
# media through the mock, a private redis + the queue worker in the stack); anything else the
# commit touched is reported as "chrome lane only" and left to the post-deploy WhatsApp Web run.
# Exit 0 = ran (look at the ledger rows for the verdicts) · 1 = validate_specs errors, nothing driven ·
# 2 = usage · 3 = the stack/run was blocked (see the run log). Nothing selected is exit 0 and says so.
set -uo pipefail
QA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$QA/../../.." && pwd)"
MOCK_FEATURES="${E2E_MOCK_FEATURES:-menu,language,status,lesson-plan,coaching}"

REF="HEAD"; FORCE=""
while [ $# -gt 0 ]; do case "$1" in
  --features) FORCE="$2"; shift 2;;
  --all-mock) FORCE="$MOCK_FEATURES"; shift;;
  -h|--help) sed -n 2,13p "$0"; exit 0;;
  *) REF="$1"; shift;; esac; done
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

# 4. the gate
python3 "$QA/validate_specs.py" --only "$RUN" >"$PEND/mock-$SHORT.validate.log" 2>&1; VEXIT=$?
if [ "$VEXIT" -ne 0 ]; then
  echo "│ validate_specs: exit $VEXIT — NOT driving. $(grep -c '^E-' "$PEND/mock-$SHORT.validate.log" 2>/dev/null || echo '?') error(s):"
  grep -E '^\s*E-|error' "$PEND/mock-$SHORT.validate.log" | head -8 | sed 's/^/│   /'
  echo "└ fix the spec, or say plainly that the run is skipped and why."
  exit 1
fi
echo "│ validate_specs: exit 0 for $RUN"

# 5. drive: bot from a detached worktree at $SHA, mock Graph API, mock driver
RUN_ID="$(date -u +%Y%m%d-%H%M%S)-${SHA:0:7}-mock"
echo "│ driving:   $RUN  (run $RUN_ID)"
echo "└─────────────────────────────────────────────────────────────────────"
E2E_TRIGGER="${E2E_TRIGGER:-commit}" bash "$QA/run-suite.sh" "$RUN" --method mock --commit "$SHA" --run-id "$RUN_ID" \
  --spec-sync "$([ -f "$BRIEF_FILE" ] && echo "${BRIEF_FILE#$ROOT/}" || echo none)" --validator-exit "$VEXIT"
RC=$?
echo
echo "┌ runs.jsonl rows for $RUN_ID:"
grep "\"run_id\": *\"$RUN_ID\"" "$ROOT/.claude/qa/ledgers/runs.jsonl" 2>/dev/null | python3 -c '
import json,sys
for l in sys.stdin:
    r=json.loads(l); print("│  %-10s %-8s pass=%d fail=%d blocked=%d skipped=%d  commit=%s dirty=%s cassette_misses=%s" % (
        r["feature"], r["status"], r["summary"]["passed"], r["summary"]["failed"], r["summary"]["blocked"], r["summary"].get("skipped",0),
        (r.get("commit_sha") or "")[:12], r.get("dirty"), (r.get("cassette") or {}).get("misses")))' || echo "│  (no rows — the run did not reach the ledger)"
echo "└ evidence: .claude/qa/results/whatsapp/niete/$RUN_ID/"
exit $RC
