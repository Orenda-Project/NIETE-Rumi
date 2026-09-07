#!/usr/bin/env bash
# run-suite.sh — the ONE command behind /niete-e2e. Runs the NIETE WhatsApp E2E suite through
# feature-runner.cjs, one process per feature, in feature-order.py order, and writes the run dir.
#
#   bash .claude/qa/shared/run-suite.sh all   --driver 923…            # EVERYTHING: safe + @slow + @destructive + @wip (DEEP coaching, training seeds)
#   bash .claude/qa/shared/run-suite.sh safe  --driver 923…            # the default /niete-e2e subset
#   bash .claude/qa/shared/run-suite.sh lesson-plan,status --driver 923…   # named features (every scenario in them)
#   options: --env staging|prod  --target <digits>  --port 9223  --run-id <id>  --no-seed  --reflect slash
#
# Preconditions it CHECKS (and stops on): Chrome CDP on the port, a live web.whatsapp.com target, the
# target chat open in #main, the driver lock free. It does NOT scan a QR code or open the chat for you.
# What `all` does to the driver account (target env only, all reversible, all reported):
#   coaching DEEP=1 (real 16-min upload + ~20 min pipeline) · training revert-level 1 → run → seed-level-complete 1 ·
#   stuck coaching sessions cancelled via DB before the run · registration completes then un-registers · language toggles then restores.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# Keep the Mac awake for the whole run. On 2026-09-02 the laptop went into Maintenance Sleep /
# DarkWake cycles mid-suite (pmset log 20:36 PKT): a /status reply "waited" 946s, the CDP socket to
# the frozen tab died, and coaching recorded 225 minutes for one scenario. caffeinate -dims needs
# no sudo; -w ties it to this shell so it ends when the run does.
if command -v caffeinate >/dev/null 2>&1; then caffeinate -dims -w $$ & fi
QA="$ROOT/.claude/qa/shared"
MODE="${1:-safe}"; shift || true
# REFLECT: default to the inherited env value (REFLECT=slash drives COA10 instead of COA06);
# an empty local default here USED to shadow the inherited env, so named `coaching` mode could
# never take the slash branch. The --reflect flag still overrides. FIRSTUSE passes through untouched.
DRIVER="" ENV="staging" TARGET="" PORT="${CDP_PORT:-9223}" RUN_ID="" SEED=1 REFLECT="${REFLECT:-}"
# --method chrome|mock. mock = the commit-time lane: the bot runs LOCALLY from a detached worktree at
# --commit <sha> behind bot/scripts/e2e/mock-graph-api.js, on the sandbox DB, vendors replay-strict. No
# Chrome, no WhatsApp number. Default chrome — every existing invocation is unchanged.
# --spec-sync <brief.json|none> and --validator-exit <n> are provenance for the ledger row (phase 1).
METHOD="" COMMIT="" SPEC_SYNC="" VALIDATOR_EXIT="" TRIGGER="${E2E_TRIGGER:-manual}"
while [ $# -gt 0 ]; do case "$1" in
  --driver) DRIVER="$2"; shift 2;; --env) ENV="$2"; shift 2;; --target) TARGET="$2"; shift 2;;
  --port) PORT="$2"; shift 2;; --run-id) RUN_ID="$2"; shift 2;; --no-seed) SEED=0; shift;; --reflect) REFLECT="$2"; shift 2;;
  --method) METHOD="$2"; shift 2;; --commit) COMMIT="$2"; shift 2;;
  --spec-sync) SPEC_SYNC="$2"; shift 2;; --validator-exit) VALIDATOR_EXIT="$2"; shift 2;;
  *) echo "unknown option $1"; exit 2;; esac; done
if [ -z "$METHOD" ]; then METHOD=$(python3 - "$ENV" "$ROOT/.claude/qa/config/whatsapp-targets.yaml" <<'PY'
import re,sys; env,path=sys.argv[1],sys.argv[2]; txt=open(path).read()
for block in re.split(r"\n  (?=[a-z][\w-]*:\s*\n)", txt):
    if re.search(r"env:\s*%s\b" % env, block) and "NIETE" in block:
        m=re.search(r'method:\s*(\w+)', block); print(m.group(1) if m else "chrome"); break
else: print("chrome")
PY
); fi
case "$METHOD" in chrome|mock) ;; *) echo "ERROR: --method must be chrome or mock (got '$METHOD')"; exit 2;; esac
if [ "$METHOD" = mock ]; then
  [ "$ENV" = staging ] && ENV=sandbox      # the mock lane's DB is the sandbox; never staging or prod
  [ -n "$COMMIT" ] || COMMIT=$(git -C "$ROOT" rev-parse HEAD)
  COMMIT=$(git -C "$ROOT" rev-parse --verify "${COMMIT}^{commit}" 2>/dev/null) || { echo "ERROR: --commit $COMMIT is not a commit"; exit 2; }
  [ -n "$DRIVER" ] || DRIVER=$(python3 - "$ROOT/.claude/qa/config/whatsapp-targets.yaml" <<'PY'
import re,sys; txt=open(sys.argv[1]).read()
for block in re.split(r"\n  (?=[a-z][\w-]*:\s*\n)", txt):
    if re.search(r"method:\s*mock\b", block):
        m=re.search(r'test_driver:\s*"?(\d+)"?', block); print(m.group(1) if m else ""); break
PY
)
fi
[ -n "$DRIVER" ] || { echo "ERROR: --driver <digits> is required (the runner's OWN linked WhatsApp number — bd-2748)"; exit 2; }
if [ -z "$TARGET" ]; then TARGET=$(python3 - "$ENV" "$ROOT/.claude/qa/config/whatsapp-targets.yaml" <<'PY'
import re,sys; env,path=sys.argv[1],sys.argv[2]; txt=open(path).read()
# profiles are small YAML maps: find the NIETE profile whose env matches, without needing PyYAML
for block in re.split(r"\n  (?=[a-z][\w-]*:\s*\n)", txt):
    if re.search(r"env:\s*%s\b" % env, block) and "NIETE" in block:
        m=re.search(r'number:\s*"?(\d+)"?', block)
        if m: print(m.group(1)); break
PY
); fi
[ "$METHOD" = mock ] && [ -z "$TARGET" ] && TARGET="local"
[ -n "$TARGET" ] || { echo "ERROR: no target for env=$ENV in whatsapp-targets.yaml"; exit 2; }
RUN_ID="${RUN_ID:-$(date +%Y%m%d-%H%M)-$MODE}"
export RUN_DIR="$ROOT/.claude/qa/results/whatsapp/niete/$RUN_ID" E2E_ENV="$ENV" E2E_DRIVER="$DRIVER" CDP_PORT="$PORT" E2E_METHOD="$METHOD"
mkdir -p "$RUN_DIR"; LOG="$RUN_DIR/runner.log"
say() { echo "$*" | tee -a "$LOG"; }
T0=$(date +%s)
say "=== /niete-e2e $MODE · $(date -u +%FT%TZ) · tenant NIETE env=$ENV target=$TARGET driver=$DRIVER method=$METHOD${COMMIT:+ commit=${COMMIT:0:12}} run=$RUN_ID"

# ── 0. preconditions ─────────────────────────────────────────────────────────────────────────
python3 "$QA/driver_lock.py" acquire --driver "$DRIVER" --run-id "$RUN_ID" >>"$LOG" 2>&1 || { say "BLOCKED: driver lock held (see $LOG) — another run is driving $DRIVER"; exit 3; }
STACK_DOWN=""
cleanup() { python3 "$QA/driver_lock.py" release --driver "$DRIVER" >/dev/null 2>&1; [ -n "$STACK_DOWN" ] && bash "$ROOT/bot/scripts/e2e/local-stack.sh" down "$RUN_DIR" >>"$LOG" 2>&1; }
trap cleanup EXIT
if [ "$METHOD" = mock ]; then
  # The bot under test starts from a DETACHED WORKTREE at $COMMIT — never this working tree — and
  # /health must report that exact sha before a single scenario is driven (local-stack.sh exit 13).
  STACK_DOWN=1
  bash "$ROOT/bot/scripts/e2e/local-stack.sh" up "$COMMIT" "$RUN_DIR" >>"$LOG" 2>&1 || { rc=$?; say "BLOCKED: local stack did not come up (exit $rc) — see $LOG, $RUN_DIR/bot.log"; exit 3; }
  export E2E_MOCK_URL=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["mock_url"])' "$RUN_DIR/stack.json")
  # The DB tooling (driver ensure/reset, api.db lookups) resolves sandbox creds from NIETE_SANDBOX_SUPABASE_*;
  # feed them from the same keys/niete-local.env the stack composed the bot's .env from.
  KEYS_FILE=$(python3 - "$ROOT" <<'PY'
import os, subprocess, sys
root = sys.argv[1]
common = subprocess.run(["git", "-C", root, "rev-parse", "--git-common-dir"], capture_output=True, text=True).stdout.strip()
main = os.path.dirname(common if os.path.isabs(common) else os.path.join(root, common))
for c in (os.path.join(main, "keys", "niete-local.env"), os.path.join(os.path.dirname(main), "keys", "niete-local.env")):
    if os.path.isfile(c): print(c); break
PY
)
  [ -f "$KEYS_FILE" ] && eval "$(grep -E '^SUPABASE_(URL|SERVICE_ROLE_KEY)=' "$KEYS_FILE" | sed 's/^SUPABASE_/export NIETE_SANDBOX_SUPABASE_/')"
  say "stack: $(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("bot", d["bot_url"], "commit", d["commit_sha"][:12], "← mock", d["mock_url"])' "$RUN_DIR/stack.json")"
  python3 "$QA/niete_sandbox_driver.py" ensure --phone "$DRIVER" --yes-write 2>&1 | tee -a "$LOG" | tail -1
else
  curl -s -m 3 "http://127.0.0.1:$PORT/json/version" >/dev/null || { say "BLOCKED: no Chrome DevTools on port $PORT — run: bash $QA/start-chrome-cdp.sh"; exit 3; }
  node "$QA/inject-wa-drive.js" --port "$PORT" --quiet >/dev/null 2>&1 || { say "BLOCKED: no linked web.whatsapp.com tab on port $PORT (open it; scan the QR with the driver phone if shown)"; exit 3; }
  HEADER=$(node "$QA/cdp-eval.cjs" '(document.querySelector("#main header")||{innerText:""}).innerText.split("\n").filter(Boolean).slice(0,2).join(" | ")' --port "$PORT" 2>/dev/null || echo "")
  case "$HEADER" in *Staging*|*NIETE*|*"$TARGET"*) say "chat open: $HEADER";; *) say "BLOCKED: the target chat is not open in WhatsApp Web (header: '${HEADER:-none}'). Open the bot chat ($TARGET) with a real click, confirm the header, re-run."; exit 3;; esac
fi

# ── 1. plan ────────────────────────────────────────────────────────────────────────────────────
PF_MODE="$MODE"; [ "$MODE" = "safe" ] && PF_MODE=""
PF_INJECT=""; [ "$METHOD" = mock ] && PF_INJECT="--no-inject"
python3 "$QA/preflight.py" "$RUN_ID" --mode "$PF_MODE" --driver "$DRIVER" --target "$TARGET" --env "$ENV" $PF_INJECT \
  --method "$METHOD" ${COMMIT:+--commit-sha "$COMMIT"} >>"$LOG" 2>&1 || true
ORDER=$(python3 "$QA/feature-order.py" | awk '{print $2}')
case "$MODE" in
  all)  FEATURES=$(echo "$ORDER" | grep -E '^(registration|menu|training|lesson-plan|coaching|language|status)$');;
  safe) FEATURES=$(echo "$ORDER" | grep -E '^(registration|menu|training|lesson-plan|coaching|language|status)$');;
  *)    FEATURES=$(echo "$MODE" | tr ',' '\n');;
esac
say "features: $(echo $FEATURES | tr '\n' ' ')"

# ── 2. account hygiene (all mode / named coaching): nothing in flight, then the product-side reset ──
if [ "$MODE" = "all" ] || echo "$FEATURES" | grep -qx coaching; then
  python3 "$QA/niete_coaching_db.py" cancel-stuck --env "$ENV" --phone "$DRIVER" --yes-write 2>&1 | tee -a "$LOG" | tail -1
  # Archive prior COMPLETED coaching sessions so the analysis prompt drops its growing
  # "N prior coaching sessions" block — that block changes the LLM request every run and defeats the
  # e2e cassette. With 0 prior the prompt is identical run-to-run, so E2E_CASSETTE=replay HITS the
  # analysis calls (coaching's biggest cost). Reversible; staging test driver only.
  if [ "${E2E_CASSETTE:-off}" != "off" ] || [ "$MODE" = "all" ]; then
    python3 "$QA/niete_coaching_db.py" reset-history --env "$ENV" --phone "$DRIVER" --yes-write 2>&1 | tee -a "$LOG" | tail -1
  fi
  # FIRSTUSE=1: delete the driver's coaching first-use row so COA02's intro offer + "Just tell me"
  # button reappear and the scenario can be driven (coaching.cjs runs COA02 under the same flag).
  if [ "${FIRSTUSE:-}" = "1" ]; then
    python3 "$QA/niete_coaching_db.py" reset-first-use --env "$ENV" --phone "$DRIVER" --yes-write 2>&1 | tee -a "$LOG" | tail -1
  fi
fi
# reset-state: on chrome through the /status Flow; on mock the Flow cannot render, so the driver row's
# conversation_state is cleared in the sandbox DB directly (same effect: nothing left in flight).
reset_state() {
  if [ "$METHOD" = mock ]; then python3 "$QA/niete_sandbox_driver.py" reset-state --phone "$DRIVER" --yes-write >>"$LOG" 2>&1
  else E2E_PROGRESS="$RUN_DIR/progress-reset${1:+-$1}.log" node "$QA/feature-runner.cjs" reset-state >"$RUN_DIR/reset-state${1:+-$1}.json" 2>>"$LOG"; fi
}
reset_state
# A Flow panel left open blocks list dialogs and the Attach menu — every pick/upload then fails silently and
# nothing reaches the bot (coaching verify3, 2026-09-02: 20 min, 0 messages delivered). Refuse to start on one.
if [ "$METHOD" != mock ] && curl -s -m 3 "http://127.0.0.1:$PORT/json/list" | grep -q '"type": *"iframe"'; then
  say "BLOCKED: a WhatsApp Flow panel is still open in the tab after reset-state — close it (Cancel / Yes, stop it) and re-run"; exit 3
fi

run_feature() {   # $1 feature, extra env vars already exported by caller
  local f="$1" t1 t2
  t1=$(date +%s); say "--- $f START $(date -u +%T)"
  python3 "$QA/driver_lock.py" heartbeat --driver "$DRIVER" >/dev/null 2>&1
  E2E_PROGRESS="$RUN_DIR/progress-$f.log" node "$QA/feature-runner.cjs" "$f" >"$RUN_DIR/$f.stdout.json" 2>"$RUN_DIR/$f.stderr.log"
  local rc=$?   # captured on the very next line — `$?` after a `date` call reported date's status, always 0
  t2=$(date +%s); say "--- $f END $(date -u +%T) ($((t2-t1))s) exit=$rc"
  python3 - "$RUN_DIR/$f.json" <<'PY' | tee -a "$LOG"
import json,sys
try:
    d=json.load(open(sys.argv[1]))
    print(f"    {d['feature']}: {d['pass']} PASS / {d['fail']} FAIL / {d['other']} other · {d['wallMin']} min · {d['perScenarioSec']}s/scenario")
    for r in d['results']:
        if r['verdict']!='PASS': print(f"      {r['id']:14} {r['verdict']:8} {(r.get('name') or '')[:58]} — {json.dumps(r.get('evidence'),ensure_ascii=False)[:120]}")
except Exception as e: print('    (no result json)', e)
PY
  # ── the ledger row: one per (run × feature), appended HERE by the runner, not by agent prose ──
  # runs.jsonl went unwritten from 2026-08-24 because the append lived only in the agent markdown.
  # Extras beyond the frozen schema tie the row to the exact commit and to phase 1 (ledger.py allows them).
  python3 "$QA/ledger_row.py" --root "$ROOT" --run-dir "$RUN_DIR" --feature "$f" --run-id "$RUN_ID" --env "$ENV" \
    --method "$METHOD" --seconds "$((t2-t1))" --driver "$DRIVER" --trigger "$TRIGGER" \
    ${COMMIT:+--commit "$COMMIT"} ${SPEC_SYNC:+--spec-sync "$SPEC_SYNC"} ${VALIDATOR_EXIT:+--validator-exit "$VALIDATOR_EXIT"} 2>&1 | tee -a "$LOG"
}

for f in $FEATURES; do
  case "$f" in
    coaching)
      if [ "$MODE" = "all" ]; then DEEP=1 REFLECT="${REFLECT:-answer}" run_feature coaching; else run_feature coaching; fi
      reset_state after-coaching;;
    training)
      if [ "$MODE" = "all" ] && [ "$SEED" = 1 ]; then
        say "seed: revert-level 1 on $DRIVER ($ENV) so the module-check cluster is drivable"
        python3 "$QA/niete_training_db.py" revert-level --env "$ENV" --phone "$DRIVER" --level 1 --yes-write >>"$LOG" 2>&1
        run_feature training
        say "seed: seed-level-complete 1 — restoring the account"
        python3 "$QA/niete_training_db.py" seed-level-complete --env "$ENV" --phone "$DRIVER" --level 1 --yes-write >>"$LOG" 2>&1
      else run_feature training; fi;;
    menu)
      run_feature menu
      # M03 taps Classroom Coaching and leaves AWAITING_CLASSROOM_AUDIO, which swallows every free text after it
      reset_state after-menu;;
    *) run_feature "$f";;
  esac
done

# ── 3. report scaffolding ──────────────────────────────────────────────────────────────────────
python3 "$QA/build-per-scenario.py" "$RUN_DIR" >>"$LOG" 2>&1 || say "(build-per-scenario.py failed — write PER-SCENARIO.md by hand from the JSONs)"
T1=$(date +%s)
say "=== suite end $(date -u +%FT%TZ) · wall $(( (T1-T0)/60 ))m$(( (T1-T0)%60 ))s · results: $RUN_DIR"
say "next: python3 $QA/validate-run.py \"$RUN_DIR\" · python3 $QA/run_efficiency.py \"$RUN_DIR\" · then §3 of /niete-e2e"
