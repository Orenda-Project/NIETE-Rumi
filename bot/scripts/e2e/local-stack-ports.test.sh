#!/usr/bin/env bash
# Two runs on one machine must never kill each other's stack (bd-d2zge).
# Incident 2026-10-06: run A (slot 1, bot :3101) was up; run B was started with --slot 1. B's local-stack up
# could not bind :3101, /health answered with A's commit -> exit 13 -> B's down killed every listener on the
# slot's ports -> A's bot and worker got SIGTERM mid-run.
# A stand-in listener plays "the other run". Both entry points must refuse BEFORE touching anything, and the
# listener must survive.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
fails=0
t() { if [ "$2" = "$3" ]; then echo "  ok  $1"; else echo "  FAIL $1: want [$3] got [$2]"; fails=$((fails+1)); fi; }
has() { case "$2" in *"$3"*) t "$1" yes yes;; *) t "$1" "no: $(printf '%s' "$2" | tail -2 | tr '\n' ' ')" yes;; esac; }

# stdout/stderr to /dev/null: inside $( ) a child holding the pipe would block the substitution forever.
listen() { node -e "require('http').createServer((q,s)=>s.end('other run')).listen($1,'127.0.0.1')" >/dev/null 2>&1 & echo $!; }
# bounded() SECS CMD… — run CMD with a deadline (macOS has no `timeout`). A refusal takes a second or two; a run
# that does NOT refuse would bring a whole stack up, so past the deadline it is killed and reported as rc 124.
bounded() { local secs=$1; shift; "$@" > "$tmp/bounded.out" 2>&1 & local p=$! i
  for i in $(seq 1 $((secs * 5))); do kill -0 $p 2>/dev/null || break; sleep 0.2; done
  if kill -0 $p 2>/dev/null; then pkill -TERM -P $p 2>/dev/null; kill $p 2>/dev/null; wait $p 2>/dev/null; cat "$tmp/bounded.out"; return 124; fi
  wait $p; local rc=$?; cat "$tmp/bounded.out"; return $rc; }
alive() { curl -sf -m 2 "http://127.0.0.1:$1/" >/dev/null 2>&1 && echo alive || echo dead; }
tmp="$(mktemp -d)"
trap 'jobs -p | xargs kill 2>/dev/null; rm -rf "$tmp"' EXIT

# ---- local-stack.sh up: the bot port another run holds
BUSY=55193
pid=$(listen $BUSY); for i in $(seq 1 20); do [ "$(alive $BUSY)" = alive ] && break; sleep 0.2; done
out=$(MOCK_PORT=55093 E2E_BOT_PORT=$BUSY E2E_REDIS_PORT=55293 E2E_WORKER_HEALTH_PORT=55393 \
      bounded 30 bash "$HERE/local-stack.sh" up HEAD "$tmp/run-b"); rc=$?
survived=$(alive $BUSY); had_ports=$([ -e "$tmp/run-b/ports" ] && echo written || echo none); had_src=$([ -d "$tmp/run-b/src" ] && echo created || echo none)
# without the guard the stack really comes up (or half-up): tear down whatever it started so the test leaves nothing
[ -e "$tmp/run-b/ports" ] && bash "$HERE/local-stack.sh" down "$tmp/run-b" >/dev/null 2>&1
t "AC2 local-stack up refuses when its bot port is already taken (exit 19)" "$rc" "19"
has "AC2 …and names the busy port" "$out" "$BUSY"
t "AC2 …before writing run_dir/ports (so down can never port-kill)" "$had_ports" "none"
t "AC2 …and before checking out a worktree" "$had_src" "none"
t "AC3 the other run's listener is still alive" "$survived" "alive"
kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null

# ---- run-suite.sh --slot N: a slot another run is using
SLOT=37; BUSY=$((3100+SLOT))
pid=$(listen $BUSY); for i in $(seq 1 20); do [ "$(alive $BUSY)" = alive ] && break; sleep 0.2; done
out=$(cd "$ROOT" && E2E_LEDGER_COMMIT_OFF=1 bounded 30 bash .claude/qa/shared/run-suite.sh menu --method mock --slot $SLOT --commit HEAD --run-id "slot-busy-test-$$"); rc=$?
R="$ROOT/.claude/qa/results/whatsapp/niete/slot-busy-test-$$"
survived=$(alive $BUSY); had_dir=$([ -d "$R" ] && echo created || echo none)
[ -e "$R/ports" ] && bash "$HERE/local-stack.sh" down "$R" >/dev/null 2>&1
t "AC1 run-suite --slot $SLOT refuses when one of its ports is listening (exit 3)" "$rc" "3"
has "AC1 …and names the slot and the busy port" "$out" "slot $SLOT"
has "AC1 …the port" "$out" "$BUSY"
t "AC1 …before creating a results dir" "$had_dir" "none"
rm -rf "$R"
t "AC3 the other run's listener is still alive" "$survived" "alive"
kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null

echo; if [ "$fails" -eq 0 ]; then echo "local-stack-ports: all passed"; else echo "local-stack-ports: $fails failed"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
