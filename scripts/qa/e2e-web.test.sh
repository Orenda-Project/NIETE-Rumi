#!/usr/bin/env bash
# e2e-web.test.sh — the web lane's wiring, without a browser or a stack (bd-hnhlgn.5).
# The browser run itself is proved by `npm run e2e:web -- portal-login`; these pin what must hold
# on every laptop before that run can be trusted: it never touches the developer's own :4000 portal,
# it runs on made-up data with a per-run database, its row is one the ledger accepts, and every
# scenario in a web .feature has code (and no code drives a scenario the spec does not have).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SH="$ROOT/scripts/qa/e2e-web.sh"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf "  ok   %s\n" "$1"; }
no(){ FAIL=$((FAIL+1)); printf "  FAIL %s\n     %s\n" "$1" "${2:-}"; }
chk(){ if [ "$2" = "$3" ]; then ok "$1"; else no "$1" "expected [$3] got [$2]"; fi; }
echo "e2e-web"

[ -f "$SH" ] && ok "W0 scripts/qa/e2e-web.sh exists" || no "W0 scripts/qa/e2e-web.sh exists"

# W1 — a feature with no driver is refused by name, before anything starts.
out=$(bash "$SH" no-such-feature --print-plan 2>&1); rc=$?
chk "W1 unknown feature exits 2" "$rc" "2"
case "$out" in *portal-login*) ok "W1b the refusal lists the features that exist";; *) no "W1b lists known features" "$out";; esac

# W2 — the plan: own ports (never the developer's :4000), demo data, a run dir per run.
plan=$(bash "$SH" portal-login --slot 3 --print-plan 2>&1)
port=$(printf '%s\n' "$plan" | sed -nE 's/^PORTAL_PORT=//p')
chk "W2 slot 3 portal port" "$port" "4103"
[ -n "$port" ] && [ "$port" != 4000 ] && ok "W2b never :4000" || no "W2b never :4000" "$port"
chk "W2c slot 3 mock port follows run-suite's slot rule" "$(printf '%s\n' "$plan" | sed -nE 's/^MOCK_PORT=//p')" "4013"
chk "W2d demo data by default" "$(printf '%s\n' "$plan" | sed -nE 's/^DATA=//p')" "demo"
run_dir=$(printf '%s\n' "$plan" | sed -nE 's/^RUN_DIR=//p')
case "$run_dir" in "$HOME/.cache/niete-e2e-web/"*-portal-login) ok "W2e per-run dir under ~/.cache/niete-e2e-web";;
  *) no "W2e per-run dir" "$run_dir";; esac
chk "W2f DATA=sandbox is honoured when asked" \
    "$(DATA=sandbox bash "$SH" portal-login --print-plan 2>&1 | sed -nE 's/^DATA=//p')" "sandbox"

# W3 — the row the run appends is one ledger.validate_run accepts, with the web lane's identity.
res=$(mktemp); cat >"$res" <<'JSON'
{"feature":"portal-login","duration_ms":4200,"results":[
 {"id":"PL01","status":"PASS"},{"id":"PL02","status":"FAIL","error":"x"},{"id":"PL03","status":"BLOCKED","reason":"y"}]}
JSON
row=$(bash "$SH" --row-from "$res" --run-id 20261013-0000-portal-login --commit abc123 2>&1)
probs=$(printf '%s' "$row" | python3 -c "
import json,sys; sys.path.insert(0,'$ROOT/.claude/qa/shared'); import ledger
r=json.load(sys.stdin); print(';'.join(ledger.validate_run(r)) or 'valid')" 2>&1)
chk "W3 row passes ledger.validate_run" "$probs" "valid"
fields=$(printf '%s' "$row" | python3 -c "
import json,sys; r=json.load(sys.stdin); s=r['summary']
print(r['surface'],r['method'],r['env'],r['status'],s['total'],s['passed'],s['failed'],s['blocked'],r['commit_sha'])" 2>&1)
chk "W3b surface/method/env/status/counts/commit" "$fields" "web browser local CRITICAL 3 1 1 1 abc123"
rm -f "$res"

# W4 — spec ↔ code parity: every scenario ID in the .feature has code, and no code drives an ID the spec lacks.
ids_spec=$(grep -oE '@PL[0-9]+' "$ROOT/tests/features/web/portal-login.feature" 2>/dev/null | tr -d @ | sort -u | tr '\n' ' ')
ids_code=$(node -e "console.log(require('$ROOT/.claude/qa/web/features/portal-login.cjs').scenarios.map(s=>s.id).sort().join(' ')+' ')" 2>/dev/null)
[ -n "$ids_spec" ] && ok "W4 portal-login.feature has tagged scenarios" || no "W4 portal-login.feature has tagged scenarios"
chk "W4b every spec scenario has code and vice versa" "$ids_code" "$ids_spec"

# W6 — the browser opens the portal the way a person does: localhost, not 127.0.0.1 (a different site to the
#      browser — separate cookies — and not the address dev-portal.sh prints).
chk "W6 base URL is localhost on the slot's portal port" \
    "$(printf '%s\n' "$plan" | sed -nE 's/^BASE_URL=//p')" "http://localhost:4103"

# W7 — --headed is for a person watching. A run started by a commit or in CI is ALWAYS headless.
chk "W7 manual --headed opens a window" \
    "$(bash "$SH" portal-login --headed --print-plan 2>&1 | sed -nE 's/^HEADED=//p')" "1"
chk "W7b plain run is headless" \
    "$(bash "$SH" portal-login --print-plan 2>&1 | sed -nE 's/^HEADED=//p')" "0"
chk "W7c a commit-triggered run ignores --headed" \
    "$(E2E_TRIGGER=commit bash "$SH" portal-login --headed --print-plan 2>&1 | sed -nE 's/^HEADED=//p')" "0"
chk "W7d CI ignores --headed" \
    "$(CI=true bash "$SH" portal-login --headed --print-plan 2>&1 | sed -nE 's/^HEADED=//p')" "0"
chk "W7e WEB_HEADED=1 in the environment cannot sneak a window into a commit run" \
    "$(E2E_TRIGGER=commit WEB_HEADED=1 bash "$SH" portal-login --print-plan 2>&1 | sed -nE 's/^HEADED=//p')" "0"

# W8 — the WhatsApp half of a round-trip scenario talks to THIS run's mock WhatsApp, on the slot's mock port.
chk "W8 mock WhatsApp URL is the slot's mock port" \
    "$(printf '%s\n' "$plan" | sed -nE 's/^MOCK_URL=//p')" "http://127.0.0.1:4013"
# W9 — the local bot's links point at THIS stack's portal (dev-portal.sh), not the Vite dev port in local-lane.env.
grep -q 'PORTAL_URL=http://localhost:\$PORTAL_PORT' "$ROOT/scripts/dev-portal.sh" \
  && ok "W9 dev-portal.sh gives the bot PORTAL_URL=http://localhost:\$PORTAL_PORT" \
  || no "W9 dev-portal.sh gives the bot PORTAL_URL=http://localhost:\$PORTAL_PORT"

# W10 — EVERY web driver has its spec, and the two name the same scenarios (bd-hnhlgn.8).
for drv in "$ROOT"/.claude/qa/web/features/*.cjs; do
  f=$(basename "$drv" .cjs); spec="$ROOT/tests/features/web/$f.feature"
  if [ ! -f "$spec" ]; then no "W10 $f has tests/features/web/$f.feature"; continue; fi
  s_ids=$(grep -oE '^\s*@[A-Z]{2}[0-9]+' "$spec" | tr -d ' @' | sort -u | tr '\n' ' ')
  c_ids=$(node -e "console.log(require('$drv').scenarios.map(s=>s.id).sort().join(' ')+' ')" 2>/dev/null)
  [ -n "$s_ids" ] && [ "$s_ids" = "$c_ids" ] && ok "W10 $f: spec and driver name the same scenarios" \
    || no "W10 $f: spec and driver name the same scenarios" "spec [$s_ids] code [$c_ids]"
done
# W11 — the portal is covered area by area: at least these drivers exist.
for f in portal-login portal-smoke teacher-home teacher-lessons teacher-coaching teacher-training teacher-classes teacher-assessment coach-portal leader-portal portal-account; do
  [ -f "$ROOT/.claude/qa/web/features/$f.cjs" ] && ok "W11 driver $f" || no "W11 driver $f"
done

# W12 — PARALLEL (bd-hnhlgn.13): several features at once, each in its own slot (own ports, own run dir).
pp=$(bash "$SH" portal-login,teacher-lessons,coach-portal --parallel --print-plan 2>&1)
chk "W12 one plan per feature" "$(printf '%s\n' "$pp" | grep -c '^FEATURE=')" "3"
chk "W12b three different portal ports" "$(printf '%s\n' "$pp" | sed -nE 's/^PORTAL_PORT=//p' | sort -u | wc -l | tr -d ' ')" "3"
chk "W12c three different run dirs" "$(printf '%s\n' "$pp" | sed -nE 's/^RUN_DIR=//p' | sort -u | wc -l | tr -d ' ')" "3"
printf '%s\n' "$pp" | sed -nE 's/^PORTAL_PORT=//p' | grep -qx 4000 && no "W12d never :4000" || ok "W12d never :4000"
chk "W12e at most E2E_WEB_PARALLEL at once" "$(E2E_WEB_PARALLEL=2 bash "$SH" portal-login,teacher-lessons,coach-portal --parallel --print-plan 2>&1 | sed -nE 's/^PARALLEL=//p' | head -1)" "2"
# W13 — per-feature scenarios in one call, the run-suite form: feature=ID,ID;feature=ID
po=$(bash "$SH" portal-login,teacher-lessons --parallel --only "portal-login=PL03,PL06;teacher-lessons=TL02" --print-plan 2>&1)
chk "W13 portal-login gets its own ids" "$(printf '%s\n' "$po" | awk '/^FEATURE=portal-login/{f=1} f&&/^ONLY=/{print;exit}')" "ONLY=PL03,PL06"
chk "W13b teacher-lessons gets its own ids" "$(printf '%s\n' "$po" | awk '/^FEATURE=teacher-lessons/{f=1} f&&/^ONLY=/{print;exit}')" "ONLY=TL02"
# W14 — an unknown feature anywhere in the list is refused before anything starts
bash "$SH" portal-login,nope --parallel --print-plan >/dev/null 2>&1; chk "W14 unknown feature in a list exits 2" "$?" "2"

# W15 — a test stack keeps its portal DB pool small: four parallel stacks at the default 20 exhausted the local
#       Postgres (max_connections 100: "sorry, too many clients already") and failed a scenario's set-up SQL.
chk "W15 test runs cap the portal's DB pool" "$(bash "$SH" portal-login --print-plan 2>&1 | sed -nE 's/^DB_POOL_SIZE=//p')" "5"
grep -q "too many clients" "$ROOT/.claude/qa/web/web-runner.cjs" && ok "W15b set-up SQL retries a full connection table" \
  || no "W15b set-up SQL retries a full connection table"

# W13 — /e2e-web, the portal's /e2e-mock: no feature runs the fallback, `all` runs every web feature at once.
chk "W13 no feature → portal-smoke (the fallback)" \
    "$(bash "$SH" --print-plan 2>&1 | sed -nE 's/^FEATURE=//p')" "portal-smoke"
nfeat=$(ls "$ROOT/.claude/qa/web/features/"*.cjs | wc -l | tr -d ' ')
pa=$(bash "$SH" all --print-plan 2>&1)
chk "W13b all → one plan per web feature" "$(printf '%s\n' "$pa" | grep -c '^FEATURE=')" "$nfeat"
chk "W13c all runs in parallel" "$(printf '%s\n' "$pa" | grep -c '^PARALLEL=')" "1"
chk "W13d all keeps --only per feature" \
    "$(bash "$SH" all --only 'portal-login=PL01' --print-plan 2>&1 | sed -nE 's/^ONLY=(.+)$/\1/p')" "PL01"
CMD="$ROOT/.claude/commands/e2e-web.md"
grep -q 'bash scripts/qa/e2e-web.sh \$ARGUMENTS' "$CMD" 2>/dev/null && ok "W13e /e2e-web command runs e2e-web.sh with its arguments" \
  || no "W13e /e2e-web command" "missing or not wired: $CMD"

# W5 — wired into npm, like e2e:mock.
chk "W5 npm run e2e:web" "$(node -p "require('$ROOT/package.json').scripts['e2e:web']" 2>/dev/null)" "bash scripts/qa/e2e-web.sh"

echo; echo "  $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
