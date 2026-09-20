#!/usr/bin/env bash
# mock-autorun.sh — the mock lane RUNS ITSELF after a commit. Nobody types commit-e2e.sh (operator, 2026-09-20).
#
#   bash .claude/qa/engine/bin/mock-autorun.sh <sha> --features <csv> [--tenants <csv>]   # enqueue + start the drainer
#   bash .claude/qa/engine/bin/mock-autorun.sh --drain                                    # the detached runner (internal)
#   bash .claude/qa/engine/bin/mock-autorun.sh --status [<sha>]                           # one line per known sha
#
# Called by githooks/post-commit (any terminal) and hooks/e2e-autorun.sh (a Claude session) once the diff has been
# mapped to mock-lane features and the machine is ready. It returns in well under a second: the request is appended
# to a queue and a DETACHED drainer runs commit-e2e.sh for it in the background, so the commit itself never waits.
#
# What the drainer guarantees:
#   · one run at a time per clone (a pid file; commit-e2e.sh's driver lock is the second belt)
#   · commits that pile up are COALESCED: the newest sha is what gets tested (it contains the older ones), with the
#     UNION of every queued feature list and tenant list, so nothing an earlier commit touched is dropped
#   · the same sha is never queued twice (a Claude session fires BOTH hooks on one `git commit`)
#   · every request ends in <repo>/.claude/.e2e-pending/mock-<sha7>.result (JSON): running → done / not-ready / off,
#     with the ledger rows commit-e2e printed and whether the known-findings gate called a REGRESSION
#   · the full output of each run is in <repo>/.claude/.e2e-pending/mock-<sha7>[-<tenant>].log
#   · a desktop notification when the machine can show one (macOS osascript / notify-send), best effort
#
# Who reads the result: hooks/e2e-autorun-stop.sh (the agent's turn), hooks/e2e-pending-banner.sh (next session),
# and `--status` for a human. The ledger row itself lands in .claude/qa/ledgers/runs.jsonl exactly as a hand run's.
#
# Off switch: E2E_MOCK_AUTORUN=off (export it). Tests point E2E_COMMIT_E2E_BIN at a stand-in for commit-e2e.sh.
set -uo pipefail
QA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../hooks/lib/mock-lane.sh
. "$QA/../hooks/lib/mock-lane.sh" 2>/dev/null || { echo "mock-autorun: cannot load $QA/../hooks/lib/mock-lane.sh" >&2; exit 2; }
ROOT=$(e2e_root 2>/dev/null) || { echo "mock-autorun: no tenants.yaml above $PWD — not a guarded repo" >&2; exit 2; }
PEND="$ROOT/.claude/.e2e-pending"; mkdir -p "$PEND"
QUEUE="$PEND/mock-queue.jsonl"; LOCKDIR="$PEND/mock-autorun.lock"; PIDFILE="$LOCKDIR/pid"; LOG="$PEND/mock-autorun.log"
COMMIT_E2E="${E2E_COMMIT_E2E_BIN:-$QA/commit-e2e.sh}"
# Called from a git hook, we inherit git's hook environment (GIT_DIR=.git, GIT_INDEX_FILE, GIT_WORK_TREE, GIT_PREFIX …),
# which is RELATIVE to the committing directory. Every git command the run makes elsewhere (the throwaway worktree
# in the results dir) would then resolve against the wrong repo and fail — `git worktree add failed` (exit 11) on a
# plain clone, invisible from a git worktree where those paths happen to be absolute (rehearsal, 2026-09-20).
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_QUARANTINE_PATH

short() { printf '%s' "$1" | cut -c1-7; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
# The lock DIRECTORY is the "a drainer exists" token: mkdir is atomic, so two enqueues 0.3s apart cannot both start one.
# The drainer writes its pid inside; a lock whose pid is dead (crash, kill) or that never got a pid within 60s is stale.
lock_stale() {
  [ -d "$LOCKDIR" ] || return 1
  if [ -f "$PIDFILE" ]; then kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null && return 1; return 0; fi
  [ "$(( $(date +%s) - $(stat -f %m "$LOCKDIR" 2>/dev/null || stat -c %Y "$LOCKDIR" 2>/dev/null || echo 0) ))" -gt 60 ]
}
drainer_alive() { [ -d "$LOCKDIR" ] && ! lock_stale; }
notify() {   # $1 title · $2 body — never fatal, never blocking
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"$(printf '%s' "$2" | sed 's/"/\\"/g')\" with title \"$(printf '%s' "$1" | sed 's/"/\\"/g')\"" >/dev/null 2>&1 &
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send "$1" "$2" >/dev/null 2>&1 &
  fi
}
write_result() {   # $1 sha · $2 status · $3 features · $4 tenants · $5 exit · $6 rows(file) · $7 regression(true/false) · $8 note
  python3 - "$PEND/mock-$(short "$1").result" "$@" <<'PY'
import json, sys, datetime, os
out, sha, status, feats, tenants, code, rows_file, regression, note = sys.argv[1:10]
rows = []
if rows_file and os.path.isfile(rows_file):
    rows = [l.rstrip("\n") for l in open(rows_file, encoding="utf-8") if l.strip()]
prev = {}
if os.path.isfile(out):
    try: prev = json.load(open(out, encoding="utf-8"))
    except Exception: prev = {}
rec = {"sha": sha, "status": status, "features": [f for f in feats.split(",") if f], "tenants": [t for t in tenants.split(",") if t],
       "exit": int(code) if code not in ("", "null") else None, "rows": rows, "regression": regression == "true",
       "started_at": prev.get("started_at"), "finished_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ") if status not in ("queued", "running") else None,
       "note": note}
if status == "running": rec["started_at"] = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
if status == "queued": rec["queued_at"] = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
tmp = out + ".tmp"; json.dump(rec, open(tmp, "w", encoding="utf-8"), indent=1); os.replace(tmp, out)
PY
}

# ── --status ──────────────────────────────────────────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--status" ]; then
  want="${2:-}"
  # glob, not `ls` — a workspace path with spaces would otherwise be split into words
  for f in "$PEND"/mock-*.result; do
    [ -f "$f" ] || continue
    [ -n "$want" ] && case "$f" in *"mock-$(short "$want").result") ;; *) continue ;; esac
    python3 - "$f" <<'PY'
import json, sys
r = json.load(open(sys.argv[1])); rows = r.get("rows") or []
head = "mock lane %s · %s · %s" % (r["sha"][:7], r["status"].upper(), ",".join(r.get("features") or []) or "-")
if r.get("tenants"): head += " · tenants " + ",".join(r["tenants"])
print(head + (" · REGRESSION" if r.get("regression") else ""))
for row in rows: print("   " + row.strip())
if r.get("note"): print("   " + r["note"])
PY
  done
  drainer_alive && echo "drainer running (pid $(cat "$PIDFILE" 2>/dev/null || echo starting))"
  exit 0
fi

# ── --drain: the detached runner ──────────────────────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--drain" ]; then
  mkdir -p "$LOCKDIR"; echo $$ > "$PIDFILE"
  trap 'rm -rf "$LOCKDIR"' EXIT
  while true; do
    [ -s "$QUEUE" ] || break
    WORK="$QUEUE.work.$$"; mv "$QUEUE" "$WORK" 2>/dev/null || break
    # Coalesce: newest sha (last line), union of features and tenants across every queued line.
    read -r SHA FEATS TENANTS SUPERSEDED <<<"$(python3 - "$WORK" <<'PY'
import json, sys
lines = [json.loads(l) for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
feats, tenants, shas = [], [], []
for l in lines:
    for f in l.get("features") or []:
        if f not in feats: feats.append(f)
    for t in l.get("tenants") or []:
        if t not in tenants: tenants.append(t)
    shas.append(l["sha"])
print(shas[-1], ",".join(feats), ",".join(tenants) or "-", ",".join(s[:7] for s in shas[:-1]) or "-")
PY
)"
    rm -f "$WORK"
    [ "$TENANTS" = "-" ] && TENANTS=""
    S7=$(short "$SHA")
    for old in $(printf '%s' "$SUPERSEDED" | tr ',' ' '); do
      [ "$old" = "-" ] && continue
      write_result "$old" superseded "$FEATS" "$TENANTS" "" "" false "superseded by $S7 (it contains this commit); tested there"
    done
    write_result "$SHA" running "$FEATS" "$TENANTS" "" "" false ""
    echo "[$(now)] run $S7 features=$FEATS tenants=${TENANTS:-<single>}"
    ROWS="$PEND/mock-$S7.rows"; : > "$ROWS"; RC=0; REG=false
    if [ -n "$TENANTS" ]; then
      for T in $(printf '%s' "$TENANTS" | tr ',' ' '); do
        (cd "$ROOT" && E2E_TRIGGER=autorun bash "$COMMIT_E2E" "$SHA" --features "$FEATS" --tenant "$T") > "$PEND/mock-$S7-$T.log" 2>&1; r=$?
        [ "$r" -ne 0 ] && RC=$r
        grep -E '^│  ' "$PEND/mock-$S7-$T.log" >> "$ROWS" || true
        grep -q 'REGRESSION' "$PEND/mock-$S7-$T.log" && REG=true
      done
    else
      (cd "$ROOT" && E2E_TRIGGER=autorun bash "$COMMIT_E2E" "$SHA" --features "$FEATS") > "$PEND/mock-$S7.log" 2>&1; RC=$?
      grep -E '^│  ' "$PEND/mock-$S7.log" >> "$ROWS" || true
      grep -q 'REGRESSION' "$PEND/mock-$S7.log" && REG=true
    fi
    NOTE=""; [ "$RC" -eq 3 ] && NOTE="blocked before driving (exit 3) — see the log"; [ "$RC" -eq 1 ] && NOTE="validate_specs errors — nothing driven"
    write_result "$SHA" done "$FEATS" "$TENANTS" "$RC" "$ROWS" "$REG" "$NOTE"
    rm -f "$ROWS"
    SUMMARY=$(python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); rows=r.get("rows") or []; print(("REGRESSION · " if r.get("regression") else "") + (rows[0].strip()[:90] if rows else (r.get("note") or "no rows")))' "$PEND/mock-$S7.result" 2>/dev/null)
    echo "[$(now)] done $S7 exit=$RC regression=$REG · $SUMMARY"
    notify "E2E mock lane · $S7" "$SUMMARY"
  done
  exit 0
fi

# ── enqueue ───────────────────────────────────────────────────────────────────────────────────────────────────────
SHA="${1:-}"; shift || true
[ -n "$SHA" ] || { echo "usage: mock-autorun.sh <sha> --features <csv> [--tenants <csv>] | --drain | --status [sha]" >&2; exit 2; }
FEATS=""; TENANTS=""
while [ $# -gt 0 ]; do case "$1" in
  --features) FEATS="$2"; shift 2 ;; --tenants) TENANTS="$2"; shift 2 ;; *) echo "unknown option $1" >&2; exit 2 ;; esac; done
SHA=$(git -C "$ROOT" rev-parse --verify "${SHA}^{commit}" 2>/dev/null) || { echo "mock-autorun: '$SHA' is not a commit" >&2; exit 2; }
S7=$(short "$SHA")
[ -n "$FEATS" ] || { echo "mock-autorun: nothing for the mock lane ($S7) — not queued"; exit 0; }
if [ "${E2E_MOCK_AUTORUN:-on}" = "off" ]; then
  write_result "$SHA" off "$FEATS" "$TENANTS" "" "" false "E2E_MOCK_AUTORUN=off — run by hand: bash .claude/qa/engine/bin/commit-e2e.sh $SHA --features $FEATS"
  echo "mock lane: auto-run is OFF (E2E_MOCK_AUTORUN=off) — by hand: bash .claude/qa/engine/bin/commit-e2e.sh $S7 --features $FEATS"
  exit 0
fi
# already queued, running or done for this sha? (both hooks fire on one commit in a Claude session)
if grep -q "\"sha\": *\"$SHA\"" "$QUEUE" 2>/dev/null; then echo "mock lane: $S7 already queued"; exit 0; fi
if [ -f "$PEND/mock-$S7.result" ]; then
  st=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("status",""))' "$PEND/mock-$S7.result" 2>/dev/null)
  case "$st" in running|done|queued) echo "mock lane: $S7 already $st — $PEND/mock-$S7.result"; exit 0 ;; esac
fi
# machine readiness: fix what can be fixed (keys via the bot's provisioner, redis via brew); refuse loudly otherwise
if type e2e_mock_lane_autofix >/dev/null 2>&1; then
  MAIN=$(e2e_main_checkout "$ROOT")
  FIX=$(e2e_mock_lane_autofix "$MAIN" --with-redis); FIX_RC=$?
  if [ "$FIX_RC" -ne 0 ]; then
    WHY=$(e2e_mock_lane_ready "$MAIN"; printf '%s\n' "$FIX" | grep -E 'failed|unavailable' || true)
    write_result "$SHA" not-ready "$FEATS" "$TENANTS" "" "" false "machine not ready: $(printf '%s' "$WHY" | tr '\n' ';')"
    echo "mock lane: NOT RUN for $S7 — machine not ready: $(printf '%s' "$WHY" | tr '\n' ';')"
    exit 0
  fi
fi
python3 -c 'import json,sys; print(json.dumps({"sha": sys.argv[1], "features": [f for f in sys.argv[2].split(",") if f], "tenants": [t for t in sys.argv[3].split(",") if t], "ts": sys.argv[4]}))' \
  "$SHA" "$FEATS" "$TENANTS" "$(now)" >> "$QUEUE"
write_result "$SHA" queued "$FEATS" "$TENANTS" "" "" false ""
lock_stale && rm -rf "$LOCKDIR"
if mkdir "$LOCKDIR" 2>/dev/null; then
  # we own starting the drainer; it re-creates/keeps the lock and writes its pid, and removes the lock when the queue is empty
  ( nohup bash "$QA/mock-autorun.sh" --drain </dev/null >> "$LOG" 2>&1 & ) 2>/dev/null
  echo "mock lane: RUNNING in the background for $S7 (features $FEATS${TENANTS:+ · tenants $TENANTS}) — result → .claude/.e2e-pending/mock-$S7.result · log → .claude/.e2e-pending/mock-autorun.log"
else
  echo "mock lane: $S7 queued behind the run in progress${PIDFILE:+ (pid $(cat "$PIDFILE" 2>/dev/null || echo starting))} — result → .claude/.e2e-pending/mock-$S7.result"
fi
exit 0
