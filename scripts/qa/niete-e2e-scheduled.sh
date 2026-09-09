#!/bin/bash
# Scheduled /niete-e2e all — the wrapper a LaunchAgent invokes.
#
# WHY A WRAPPER AND NOT JUST `claude -p` ON A TIMER.
# Three things went wrong with the previous attempt and all three are handled here:
#   1. The schedule lived inside a Claude session, so it died when that session
#      closed. A LaunchAgent does not.
#   2. Fires landed on a WhatsApp QR screen and produced EMPTY run directories —
#      a silent failure that looked like "no problems found". Preconditions are
#      now checked first and a refusal writes a visible BLOCKED report.
#   3. A full `all` run takes ~3h15m but the cadence is 2h, so fires overlap.
#      The driver lock makes an overlapping fire exit cleanly instead of letting
#      two runs drive the same WhatsApp account at once, which would corrupt both.
#
# Exit codes: 0 ran (or cleanly declined), 1 blocked on a precondition.
set -uo pipefail

REPO="${NIETE_E2E_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
DRIVER="${NIETE_E2E_DRIVER:-}"
[ -n "$DRIVER" ] || { echo "NIETE_E2E_DRIVER is not set — it must be the WhatsApp number linked in the Chrome this run attaches to" >&2; exit 1; }
SCOPE="${NIETE_E2E_SCOPE:-all}"
CHECK_ONLY=0
[ "${1:-}" = "--check-only" ] && CHECK_ONLY=1
cd "$REPO" || { echo "repo not found: $REPO" >&2; exit 1; }

RUN="$(date +%Y%m%d-%H%M)"
RUNDIR=".claude/qa/results/whatsapp/niete/$RUN"
LOGDIR=".claude/qa/results/whatsapp/niete/_scheduler"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/$RUN.log"
exec > >(tee -a "$LOG") 2>&1

say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
blocked() {                       # write a VISIBLE report instead of an empty dir
  if [ "${CHECK_ONLY:-0}" = "1" ]; then say "CHECK FAILED: $1"; exit 1; fi
  mkdir -p "$RUNDIR"
  { echo "# Scheduled run $RUN — BLOCKED"; echo;
    echo "**Did not start.** $1"; echo;
    echo "Checked at $(date '+%Y-%m-%d %H:%M:%S %Z') by niete-e2e-scheduled.sh."; echo;
    echo "No scenarios were driven. This file exists so the miss is visible —"
    echo "an empty run directory is how the 2026-08-17/18 fires failed unnoticed."
  } > "$RUNDIR/REPORT.md"
  say "BLOCKED: $1"
  say "wrote $RUNDIR/REPORT.md"
  exit 1
}

say "scheduled fire — scope=$SCOPE driver=$DRIVER run=$RUN"

# ── keep the specs current ──────────────────────────────────────────────────
# The scheduler runs from its OWN clone (one outside ~/Desktop, ~/Documents and
# ~/Downloads: launchd-spawned processes cannot read those — every fire on
# 2026-09-09 died with "Operation not permitted" before the first line ran). A
# dedicated clone nobody edits drifts, so fast-forward it to its upstream first.
# Best effort: a dirty tree or an offline machine still runs, on what is there.
# Off: NIETE_E2E_PULL=0
if [ "${NIETE_E2E_PULL:-1}" != "0" ]; then
  if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
    br="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
    if git pull -q --ff-only origin "$br" 2>>"$LOG"; then
      say "specs at $br @ $(git rev-parse --short=12 HEAD)"
    else
      say "pull --ff-only failed (offline, or diverged) — running on $br @ $(git rev-parse --short=12 HEAD)"
    fi
  else
    say "working tree not clean — skipping pull, running on $(git rev-parse --short=12 HEAD)"
  fi
fi

# ── precondition 1: is a run already in progress? ───────────────────────────
LOCK_STATUS="$(python3 .claude/qa/shared/driver_lock.py status --driver "$DRIVER" 2>&1)"
if ! grep -qi "no active driver lock" <<<"$LOCK_STATUS"; then
  say "DECLINED: a run is already in progress — $LOCK_STATUS"
  say "This is expected: a full 'all' run takes ~3h15m on a 2h cadence, so"
  say "roughly every other fire is skipped. Not an error."
  exit 0
fi

# ── precondition 2: desktop Chrome must be running (headless de-links WA) ───
pgrep -x "Google Chrome" >/dev/null 2>&1 \
  || blocked "Google Chrome is not running. WhatsApp de-links a headless browser within ~1s, so this suite needs a real desktop Chrome with a linked session."

# ── precondition 3: a WhatsApp Web PAGE target must exist in Chrome ─────────
# Asked of Chrome's DevTools endpoint (the same one the MCP drives), not via
# AppleScript — "Allow JavaScript from Apple Events" is off by default and made
# this check fail on a setting rather than on the thing being checked.
WA_PORT=""
for port in ${NIETE_E2E_CDP_PORTS:-9223 9222 9229}; do
  if curl -s -m 3 "http://127.0.0.1:$port/json/version" >/dev/null 2>&1; then WA_PORT="$port"; break; fi
done
[ -n "$WA_PORT" ] \
  || blocked "Chrome is running but no DevTools endpoint answered on ${NIETE_E2E_CDP_PORTS:-9223 9222 9229}. Start Chrome with --remote-debugging-port so the suite can drive it."

WA_TABS="$(curl -s -m 3 "http://127.0.0.1:$WA_PORT/json/list" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(sum(1 for t in d if t.get("type")=="page" and "web.whatsapp.com" in (t.get("url") or "")))' 2>/dev/null || echo 0)"
[ "${WA_TABS:-0}" -ge 1 ] \
  || blocked "No web.whatsapp.com page is open in Chrome (DevTools port $WA_PORT). Open one and keep it linked."
say "precondition ok: Chrome DevTools on $WA_PORT, $WA_TABS WhatsApp page target(s)"

# The MCP must attach to THIS Chrome. Left to itself, chrome-devtools-mcp launches
# its OWN Chrome over --remote-debugging-pipe with a blank profile that has no
# linked WhatsApp — so the run would meet a QR screen and stop. That is what
# produced the empty cron dirs on 2026-08-17/18. A run-specific --mcp-config
# pins it to $WA_PORT without touching the shared .mcp.json that interactive
# sessions use.
MCPCFG="$(mktemp -t niete-e2e-mcp).json"
cat > "$MCPCFG" <<JSON
{"mcpServers":{"chrome-devtools":{"command":"npx","args":["-y","chrome-devtools-mcp@latest","--browserUrl","http://127.0.0.1:$WA_PORT"]}}}
JSON
trap 'rm -f "$MCPCFG"' EXIT
say "MCP pinned to http://127.0.0.1:$WA_PORT (config $MCPCFG)"
say "note: LINKED vs QR is settled by the run itself; the post-run guard turns a QR stop into a visible report."

if [ "$CHECK_ONLY" = "1" ]; then
  say "--check-only: all preconditions pass; a real fire would start the suite now"
  exit 0
fi

# ── drive it ────────────────────────────────────────────────────────────────
mkdir -p "$RUNDIR"
say "starting /niete-e2e $SCOPE  (run dir $RUNDIR)"
PROMPT="/niete-e2e $SCOPE

You are running unattended on a schedule. Use run id $RUN and write everything to
$RUNDIR. Drive the suite exactly as .claude/commands/niete-e2e.md specifies:
take the driver lock for driver $DRIVER, load wa-drive.js before the first send,
follow feature-order.py, and log every scenario to PER-SCENARIO.md in the
documented table shape. Finish with findings.json, then validate-run.py,
parse-per-scenario.py, build-run-artifact.py, and republish the artifact to the
URL recorded in .claude/qa/ARTIFACT.md. Release the driver lock when done, even
on failure. Do not ask questions — nobody is watching; if a decision is needed,
record it in the report and continue."

# stdin from /dev/null: a child Claude that inherits a pipe/tty can block
# waiting on input, which is the deadlock CLAUDE.md warns about for nested sessions.
# caffeinate: this Mac idles to sleep after 1 minute, and on 2026-08-24 a run
# died at 02:33 with "Your computer went to sleep mid-response" after completing
# only registration. Hold the machine awake for exactly as long as the run takes.
#   -i no idle sleep · -m no disk sleep · -s no system sleep (AC power only)
# NOTE: -s is ignored on battery, and closing the lid still sleeps regardless.
caffeinate -ims claude -p "$PROMPT" --mcp-config "$MCPCFG" --strict-mcp-config \
  --dangerously-skip-permissions </dev/null >>"$LOG" 2>&1
rc=$?
say "claude exited rc=$rc"

# the run should release its own lock; make sure a crash never wedges the schedule
if ! python3 .claude/qa/shared/driver_lock.py status --driver "$DRIVER" 2>&1 | grep -qi "no active"; then
  say "lock still held after exit — releasing so the next fire is not blocked forever"
  python3 .claude/qa/shared/driver_lock.py release --driver "$DRIVER" >/dev/null 2>&1
fi
# ── post-run guard: never let a fire leave nothing behind ───────────────────
# The 2026-08-17/18 fires produced EMPTY directories and therefore looked like
# "no problems found". Anything that stops early — QR screen, crash, timeout —
# now leaves a report that says so.
PS="$RUNDIR/PER-SCENARIO.md"
if [ ! -s "$PS" ]; then
  { echo "# Scheduled run $RUN — NO OUTPUT"; echo;
    echo "The run started but produced no \`PER-SCENARIO.md\`. \`claude\` exited rc=$rc.";
    echo; echo "Most likely: WhatsApp Web was on the QR screen (the suite stops there by design),";
    echo "or the session ended early. Full stdout: \`$LOG\`."; } > "$RUNDIR/REPORT.md"
  say "NO OUTPUT — wrote $RUNDIR/REPORT.md so the miss is visible"
else
  n="$(grep -cE '^\| [A-Z]{1,2}[0-9]{1,2} ' "$PS" 2>/dev/null || echo 0)"
  say "run produced $n scenario rows"
  python3 .claude/qa/shared/validate-run.py "$RUNDIR" 2>&1 | tail -3
fi

say "done"
exit 0
