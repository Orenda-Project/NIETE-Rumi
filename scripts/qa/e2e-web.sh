#!/usr/bin/env bash
# e2e-web.sh — the web lane: the teacher + coach portal driven in a real (headless) browser, on a local
# stack started at THIS checkout's HEAD (bd-hnhlgn.5). The portal's counterpart to e2e-mock.sh.
#
#   npm run e2e:web -- portal-login                    # every scenario of one feature
#   npm run e2e:web -- portal-login --only PL03,PL06   # some of them
#   npm run e2e:web -- portal-login --keep             # leave the stack up afterwards (URL + logins printed)
#   npm run e2e:web -- portal-login --headed           # watch it: a visible Chrome, each action slowed (WEB_SLOWMO, default 600ms)
#   npm run e2e:web -- portal-login --slot 6           # pick the port slot (default: the first free of 5-9)
#   bash scripts/qa/e2e-web.sh portal-login --print-plan   # what it would do; starts nothing
#
# What a run is, in order:
#   1. a port SLOT, by run-suite.sh's rule (MOCK_PORT=4010+n …) plus PORTAL_PORT=4100+n — never the :4000 your
#      own `dev-portal.sh up` uses, so a test run cannot take down (or wipe the database of) the portal you are
#      looking at;
#   2. scripts/dev-portal.sh up into a run dir of its OWN (~/.cache/niete-e2e-web/<run_id>), DATA=demo by default:
#      made-up schools and logins, no Railway access needed. DATA=sandbox copies the sandbox instead;
#   3. the portal SPA rebuilt whenever portal/ differs from the build in dashboard/portal-frontend/dist (a stamp
#      of portal/'s tree) — a run never tests yesterday's bundle;
#   4. .claude/qa/web/web-runner.cjs drives the feature in headless Chromium (playwright-core, already a portal
#      dependency; the browser is installed on first use) — screenshot per failed scenario;
#   5. one row in .claude/qa/ledgers/runs.jsonl (surface web, method browser), evidence in
#      .claude/qa/results/web/niete/<run_id>/ (gitignored);
#   6. the stack is taken down unless --keep.
# Exit: 0 all passed · 1 a scenario failed · 2 usage · 3+ the stack could not start (dev-portal.sh's code + 10).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
FEATURES_DIR="$REPO/.claude/qa/web/features"
log() { echo "[e2e-web] $*" >&2; }

known_features() { ls "$FEATURES_DIR" 2>/dev/null | sed -n 's/\.cjs$//p' | tr '\n' ' '; }

# The same slot rule as .claude/qa/shared/run-suite.sh slot_ports(), plus the portal's own port.
slot_ports() { local n=$1
  printf '%s\n' "MOCK_PORT=$((4010+n))" "E2E_BOT_PORT=$((3100+n))" "E2E_REDIS_PORT=$((6390+n))" "E2E_WORKER_HEALTH_PORT=$((3201+n))" \
                 "E2E_SUPABASE_PORT=$((54400+n))" "LOCAL_DB_REST_PORT=$((54500+n))" "LOCAL_R2_PORT=$((54600+n))" \
                 "PORTAL_PORT=$((4100+n))"; }
slot_free() { local p; for p in $(slot_ports "$1" | sed 's/^[A-Z0-9_]*=//'); do
  (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null && return 1; done; return 0; }

pg_bin() { local d
  for d in "${LOCAL_DB_PG_BIN:-}" /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin; do
    [ -n "$d" ] && [ -x "$d/psql" ] && { echo "$d"; return 0; }; done
  d="$(dirname "$(command -v psql 2>/dev/null || echo /nonexistent/x)")"; [ -x "$d/psql" ] && echo "$d"; }

# --- the run-log row, from the runner's results.json --------------------------------------------------------
row_from() {   # $1 results.json  $2 run_id  $3 commit  [$4 evidence_dir]
  python3 - "$1" "$2" "$3" "${4:-}" "$REPO" <<'PY'
import json, os, subprocess, sys, datetime
res_path, run_id, commit, evidence, repo = sys.argv[1:6]
sys.path.insert(0, os.path.join(repo, ".claude/qa/shared"))
import ledger
res = json.load(open(res_path))
rs = res.get("results") or []
n = lambda st: sum(1 for r in rs if r.get("status") == st)
passed, failed, blocked = n("PASS"), n("FAIL"), n("BLOCKED")
feature = res["feature"]
spec_ids = []
try:
    sys.path.insert(0, os.path.join(repo, ".claude/qa/web"))
    out = subprocess.run(["node", "-e", "console.log(JSON.stringify(require(process.argv[1]).scenarios.map(s=>s.id)))",
                          os.path.join(repo, ".claude/qa/web/features", feature + ".cjs")], capture_output=True, text=True)
    spec_ids = json.loads(out.stdout or "[]")
except Exception:
    spec_ids = []
total_spec = max(len(spec_ids), len(rs))
def git(*a):
    p = subprocess.run(["git", "-C", repo] + list(a), capture_output=True, text=True)
    return p.stdout.strip() if p.returncode == 0 else ""
dirty = [l for l in git("status", "--porcelain").splitlines() if l.strip()]
row = {
    "run_id": run_id,
    "ts": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "surface": "web", "tenant": "niete", "env": "local", "method": "browser", "feature": feature,
    "status": ledger.verdict(passed, failed, blocked),
    "summary": {"total": len(rs), "passed": passed, "failed": failed, "blocked": blocked, "skipped": 0},
    "duration_ms": int(res.get("duration_ms") or 0), "drift_count": 0, "discovery_count": 0,
    "coverage": {"scenarios": total_spec, "surface_observed": len(rs), "uncovered": total_spec - len(rs)},
    "evidence_dir": evidence or (".claude/qa/results/web/niete/%s/" % run_id),
    "trigger": os.environ.get("E2E_TRIGGER", "manual"),
    "commit_sha": commit, "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
    "dirty": bool(dirty), "dirty_files": len(dirty),
    "scenarios": [{k: r[k] for k in ("id", "status", "error", "screenshot") if k in r} for r in rs],
}
print(json.dumps(row))
PY
}

# --- args ------------------------------------------------------------------------------------------------------
FEATURE="" SLOT="" ONLY="" KEEP="" PLAN="" ROW_FROM="" RUN_ID="" COMMIT=""
while [ $# -gt 0 ]; do case "$1" in
  --slot) SLOT="$2"; shift 2;; --only) ONLY="$2"; shift 2;; --keep) KEEP=1; shift;;
  --headed) export WEB_HEADED=1 WEB_SLOWMO="${WEB_SLOWMO:-600}"; shift;;
  --print-plan) PLAN=1; shift;;
  --row-from) ROW_FROM="$2"; shift 2;; --run-id) RUN_ID="$2"; shift 2;; --commit) COMMIT="$2"; shift 2;;
  -h|--help) sed -n '2,24p' "$0"; exit 0;;
  -*) log "unknown option $1"; exit 2;;
  *) FEATURE="$1"; shift;;
esac; done

if [ -n "$ROW_FROM" ]; then row_from "$ROW_FROM" "${RUN_ID:-manual}" "${COMMIT:-$(git -C "$REPO" rev-parse HEAD)}"; exit $?; fi

if [ -z "$FEATURE" ] || [ ! -f "$FEATURES_DIR/$FEATURE.cjs" ]; then
  log "no web feature '${FEATURE}'. Known: $(known_features)"; exit 2; fi

if [ -z "$SLOT" ]; then
  SLOT=5; for n in 5 6 7 8 9; do slot_free "$n" && { SLOT=$n; break; }; done
fi
case "$SLOT" in ''|*[!0-9]*) log "--slot must be a number"; exit 2;; esac
DATA="${DATA:-demo}"
RUN_ID="$(date +%Y%m%d-%H%M%S)-$FEATURE"
RUN_DIR="$HOME/.cache/niete-e2e-web/$RUN_ID"
EVIDENCE_REL=".claude/qa/results/web/niete/$RUN_ID"

if [ -n "$PLAN" ]; then
  slot_ports "$SLOT"; echo "DATA=$DATA"; echo "RUN_DIR=$RUN_DIR"; echo "EVIDENCE=$EVIDENCE_REL"; echo "FEATURE=$FEATURE"
  exit 0
fi

# --- the browser: playwright-core is a portal dependency; Chromium is downloaded once per machine -----------------
[ -d "$REPO/portal/node_modules/playwright-core" ] || { log "installing portal dependencies…"; npm ci --prefix "$REPO/portal" --no-audit --no-fund >&2 || exit 6; }
if ! (cd "$REPO/portal" && node -e "require('fs').accessSync(require('playwright-core').chromium.executablePath())") 2>/dev/null; then
  log "installing headless Chromium (once per machine)…"
  (cd "$REPO/portal" && npx --no-install playwright-core install chromium >&2) || { log "Chromium install failed"; exit 6; }
fi

# --- build freshness: rebuild when portal/ is not what the bundle was built from ---------------------------------
DIST="$REPO/dashboard/portal-frontend/dist"
want="$(git -C "$REPO" rev-parse HEAD:portal 2>/dev/null)"
[ -n "$(git -C "$REPO" status --porcelain -- portal 2>/dev/null)" ] && want="dirty-$(date +%s)"
[ "$(cat "$DIST/.portal-tree" 2>/dev/null)" = "$want" ] || export PORTAL_REBUILD=1

# --- up ----------------------------------------------------------------------------------------------------------
while IFS= read -r kv; do export "${kv?}"; done < <(slot_ports "$SLOT")
export DATA
log "run $RUN_ID · slot $SLOT · portal :$PORTAL_PORT · data $DATA"
mkdir -p "$RUN_DIR"
bash "$REPO/scripts/dev-portal.sh" up "$RUN_DIR" >"$RUN_DIR/up.log" 2>&1
up_rc=$?
if [ "$up_rc" -ne 0 ]; then
  log "stack did not start (dev-portal.sh exit $up_rc) — $RUN_DIR/up.log"; tail -5 "$RUN_DIR/up.log" >&2
  bash "$REPO/scripts/dev-portal.sh" down "$RUN_DIR" >/dev/null 2>&1; exit $((10 + up_rc)); fi
printf '%s' "$want" > "$DIST/.portal-tree" 2>/dev/null || true

# --- drive -------------------------------------------------------------------------------------------------------
EVIDENCE="$REPO/$EVIDENCE_REL"; mkdir -p "$EVIDENCE"
PGB="$(pg_bin)"
WEB_FEATURE="$FEATURE" WEB_BASE_URL="http://127.0.0.1:$PORTAL_PORT" WEB_EVIDENCE="$EVIDENCE" WEB_ONLY="$ONLY" \
WEB_PSQL="${PGB:+$PGB/}psql" WEB_PG_PORT="${LOCAL_DB_PG_PORT:-54329}" WEB_DB_NAME="$(cat "$RUN_DIR/db/db.name" 2>/dev/null)" \
  node "$REPO/.claude/qa/web/web-runner.cjs"
rc=$?

# --- record ------------------------------------------------------------------------------------------------------
if [ -f "$EVIDENCE/results.json" ]; then
  row="$(row_from "$EVIDENCE/results.json" "$RUN_ID" "$(git -C "$REPO" rev-parse HEAD)" "$EVIDENCE_REL/")"
  printf '%s' "$row" | python3 -c "
import json,sys; sys.path.insert(0,'$REPO/.claude/qa/shared'); import ledger
ledger.append_run(json.load(sys.stdin), '$REPO/.claude/qa/ledgers/runs.jsonl')" \
    && log "row appended to .claude/qa/ledgers/runs.jsonl ($(printf '%s' "$row" | python3 -c 'import json,sys;r=json.load(sys.stdin);print(r["status"],r["summary"]["passed"],"/",r["summary"]["total"])'))" \
    || log "could not append the run row"
else
  log "no results.json — the runner did not finish (exit $rc)"
fi

# --- down --------------------------------------------------------------------------------------------------------
if [ -n "$KEEP" ]; then
  log "kept up: http://localhost:$PORTAL_PORT/portal/login · stop with: bash scripts/dev-portal.sh down \"$RUN_DIR\""
else
  bash "$REPO/scripts/dev-portal.sh" down "$RUN_DIR" >/dev/null 2>&1; rm -rf "$RUN_DIR"
fi
log "evidence: $EVIDENCE_REL/"
exit $rc
