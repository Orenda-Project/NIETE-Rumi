#!/usr/bin/env bash
# run-suite.sh — the ONE command behind /niete-e2e. Runs the NIETE WhatsApp E2E suite through
# feature-runner.cjs, one process per feature, in feature-order.py order, and writes the run dir.
#
#   bash .claude/qa/shared/run-suite.sh all   --driver 923…            # EVERYTHING: safe + @slow + @destructive + @wip (DEEP coaching, training seeds)
#   bash .claude/qa/shared/run-suite.sh safe  --driver 923…            # the default /niete-e2e subset
#   bash .claude/qa/shared/run-suite.sh lesson-plan,status --driver 923…   # named features (every scenario in them)
#   options: --env sandbox|staging|prod  (default sandbox — the landing branch's env since 2026-09-09)  --target <digits>  --port 9223  --run-id <id>  --no-seed  --reflect slash
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
DRIVER="" ENV="sandbox" TARGET="" PORT="${CDP_PORT:-9223}" RUN_ID="" SEED=1 REFLECT="${REFLECT:-}"
while [ $# -gt 0 ]; do case "$1" in
  --driver) DRIVER="$2"; shift 2;; --env) ENV="$2"; shift 2;; --target) TARGET="$2"; shift 2;;
  --port) PORT="$2"; shift 2;; --run-id) RUN_ID="$2"; shift 2;; --no-seed) SEED=0; shift;; --reflect) REFLECT="$2"; shift 2;;
  *) echo "unknown option $1"; exit 2;; esac; done
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
[ -n "$TARGET" ] || { echo "ERROR: no target for env=$ENV in whatsapp-targets.yaml"; exit 2; }
RUN_ID="${RUN_ID:-$(date +%Y%m%d-%H%M)-$MODE}"
export RUN_DIR="$ROOT/.claude/qa/results/whatsapp/niete/$RUN_ID" E2E_ENV="$ENV" E2E_DRIVER="$DRIVER" CDP_PORT="$PORT"
mkdir -p "$RUN_DIR"; LOG="$RUN_DIR/runner.log"
say() { echo "$*" | tee -a "$LOG"; }
T0=$(date +%s)
say "=== /niete-e2e $MODE · $(date -u +%FT%TZ) · tenant NIETE env=$ENV target=$TARGET driver=$DRIVER run=$RUN_ID"

# ── 0. preconditions ─────────────────────────────────────────────────────────────────────────
curl -s -m 3 "http://127.0.0.1:$PORT/json/version" >/dev/null || { say "BLOCKED: no Chrome DevTools on port $PORT — run: bash $QA/start-chrome-cdp.sh"; exit 3; }
node "$QA/inject-wa-drive.js" --port "$PORT" --quiet >/dev/null 2>&1 || { say "BLOCKED: no linked web.whatsapp.com tab on port $PORT (open it; scan the QR with the driver phone if shown)"; exit 3; }
HEADER=$(node "$QA/cdp-eval.cjs" '(document.querySelector("#main header")||{innerText:""}).innerText.split("\n").filter(Boolean).slice(0,2).join(" | ")' --port "$PORT" 2>/dev/null || echo "")
case "$HEADER" in *Staging*|*NIETE*|*[Ss]andbox*|*"Digital Coach Updates"*|*"$TARGET"*) say "chat open: $HEADER";; *) say "BLOCKED: the target chat is not open in WhatsApp Web (header: '${HEADER:-none}'). Open the bot chat ($TARGET) with a real click, confirm the header, re-run."; exit 3;; esac
python3 "$QA/driver_lock.py" acquire --driver "$DRIVER" --run-id "$RUN_ID" >>"$LOG" 2>&1 || { say "BLOCKED: driver lock held (see $LOG) — another run is driving $DRIVER"; exit 3; }
trap 'python3 "$QA/driver_lock.py" release --driver "$DRIVER" >/dev/null 2>&1' EXIT

# ── 1. plan ────────────────────────────────────────────────────────────────────────────────────
PF_MODE="$MODE"; [ "$MODE" = "safe" ] && PF_MODE=""
python3 "$QA/preflight.py" "$RUN_ID" --mode "$PF_MODE" --driver "$DRIVER" --target "$TARGET" --env "$ENV" >>"$LOG" 2>&1 || true
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
E2E_PROGRESS="$RUN_DIR/progress-reset.log" node "$QA/feature-runner.cjs" reset-state >"$RUN_DIR/reset-state.json" 2>>"$LOG"
# A Flow panel left open blocks list dialogs and the Attach menu — every pick/upload then fails silently and
# nothing reaches the bot (coaching verify3, 2026-09-02: 20 min, 0 messages delivered). Refuse to start on one.
if curl -s -m 3 "http://127.0.0.1:$PORT/json/list" | grep -q '"type": *"iframe"'; then
  say "BLOCKED: a WhatsApp Flow panel is still open in the tab after reset-state — close it (Cancel / Yes, stop it) and re-run"; exit 3
fi

run_feature() {   # $1 feature, extra env vars already exported by caller
  local f="$1" t1 t2
  t1=$(date +%s); say "--- $f START $(date -u +%T)"
  python3 "$QA/driver_lock.py" heartbeat --driver "$DRIVER" >/dev/null 2>&1
  E2E_PROGRESS="$RUN_DIR/progress-$f.log" node "$QA/feature-runner.cjs" "$f" >"$RUN_DIR/$f.stdout.json" 2>"$RUN_DIR/$f.stderr.log"
  t2=$(date +%s); say "--- $f END $(date -u +%T) ($((t2-t1))s) exit=$?"
  python3 - "$RUN_DIR/$f.json" <<'PY' | tee -a "$LOG"
import json,sys
try:
    d=json.load(open(sys.argv[1]))
    print(f"    {d['feature']}: {d['pass']} PASS / {d['fail']} FAIL / {d['other']} other · {d['wallMin']} min · {d['perScenarioSec']}s/scenario")
    for r in d['results']:
        if r['verdict']!='PASS': print(f"      {r['id']:14} {r['verdict']:8} {(r.get('name') or '')[:58]} — {json.dumps(r.get('evidence'),ensure_ascii=False)[:120]}")
except Exception as e: print('    (no result json)', e)
PY
}

for f in $FEATURES; do
  case "$f" in
    coaching)
      if [ "$MODE" = "all" ]; then DEEP=1 REFLECT="${REFLECT:-answer}" run_feature coaching; else run_feature coaching; fi
      E2E_PROGRESS="$RUN_DIR/progress-reset-after-coaching.log" node "$QA/feature-runner.cjs" reset-state >/dev/null 2>>"$LOG";;
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
      E2E_PROGRESS="$RUN_DIR/progress-reset-after-menu.log" node "$QA/feature-runner.cjs" reset-state >/dev/null 2>>"$LOG";;
    *) run_feature "$f";;
  esac
done

# ── 3. report scaffolding ──────────────────────────────────────────────────────────────────────
python3 "$QA/build-per-scenario.py" "$RUN_DIR" >>"$LOG" 2>&1 || say "(build-per-scenario.py failed — write PER-SCENARIO.md by hand from the JSONs)"
T1=$(date +%s)
say "=== suite end $(date -u +%FT%TZ) · wall $(( (T1-T0)/60 ))m$(( (T1-T0)%60 ))s · results: $RUN_DIR"
say "next: python3 $QA/validate-run.py \"$RUN_DIR\" · python3 $QA/run_efficiency.py \"$RUN_DIR\" · then §3 of /niete-e2e"
