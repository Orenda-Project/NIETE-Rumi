#!/bin/bash
# Install / inspect / remove the 2-hourly NIETE E2E LaunchAgent.
#
#   niete-e2e-schedule.sh install     stage and load the agent (does NOT fire immediately)
#   niete-e2e-schedule.sh status      is it loaded, when did it last fire, what happened
#   niete-e2e-schedule.sh uninstall   unload and remove
#   niete-e2e-schedule.sh run-now     fire once, in the foreground, for a real test
#
# A LaunchAgent is used rather than /loop or an in-session cron because those
# die with the session that created them — which is why the previous schedule
# silently stopped on 2026-08-18.
set -uo pipefail

LABEL="com.rumi.niete-e2e"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
# This repo is the runner's home: default to the checkout this script lives in.
REPO="${NIETE_E2E_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
RUNNER="$REPO/scripts/qa/niete-e2e-scheduled.sh"
LOGDIR="$REPO/.claude/qa/results/whatsapp/niete/_scheduler"

case "${1:-status}" in
install)
  [ -x "$RUNNER" ] || { echo "runner not found or not executable: $RUNNER" >&2; exit 1; }
  # The driver is the WhatsApp number LINKED in the Chrome the run attaches to — nothing else.
  # It is deliberately not defaulted: a wrong default drove a whole evening of runs against the
  # wrong account (2026-09-08), and the repo is public, so no number lives in source.
  [ -n "${NIETE_E2E_DRIVER:-}" ] || { echo "set NIETE_E2E_DRIVER=<digits of the linked WhatsApp number> before install" >&2; exit 1; }
  mkdir -p "$LOGDIR" "$HOME/Library/LaunchAgents"
  # Even hours, on the hour. Chosen over StartInterval so the times are
  # predictable and readable rather than drifting from whenever it was loaded.
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0"><dict>'
    echo "  <key>Label</key><string>$LABEL</string>"
    echo '  <key>ProgramArguments</key><array>'
    echo '    <string>/bin/bash</string>'
    echo "    <string>$RUNNER</string>"
    echo '  </array>'
    echo '  <key>StartCalendarInterval</key><array>'
    for h in 0 2 4 6 8 10 12 14 16 18 20 22; do
      echo "    <dict><key>Hour</key><integer>$h</integer><key>Minute</key><integer>0</integer></dict>"
    done
    echo '  </array>'
    echo '  <key>RunAtLoad</key><false/>'
    echo "  <key>StandardOutPath</key><string>$LOGDIR/launchd.out.log</string>"
    echo "  <key>StandardErrorPath</key><string>$LOGDIR/launchd.err.log</string>"
    echo '  <key>EnvironmentVariables</key><dict>'
    echo '    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>'
    echo "    <key>NIETE_E2E_REPO</key><string>$REPO</string>"
    echo "    <key>NIETE_E2E_SCOPE</key><string>${NIETE_E2E_SCOPE:-all}</string>"
    echo "    <key>NIETE_E2E_DRIVER</key><string>${NIETE_E2E_DRIVER}</string>"
    echo '  </dict>'
    echo '</dict></plist>'
  } > "$PLIST"
  launchctl unload "$PLIST" 2>/dev/null
  launchctl load "$PLIST" && echo "loaded $LABEL — fires at 00:00, 02:00 … 22:00 local"
  echo "plist: $PLIST"
  echo
  echo "RunAtLoad is false, so nothing starts now. Verify preconditions with:"
  echo "  bash $RUNNER --check-only"
  ;;
uninstall)
  launchctl unload "$PLIST" 2>/dev/null && echo "unloaded $LABEL"
  rm -f "$PLIST" && echo "removed $PLIST"
  ;;
run-now)
  echo "firing once in the foreground (Ctrl-C to abort) …"
  exec /bin/bash "$RUNNER"
  ;;
status|*)
  echo "label:   $LABEL"
  echo "plist:   $([ -f "$PLIST" ] && echo "$PLIST" || echo "NOT INSTALLED")"
  printf 'loaded:  '; launchctl list 2>/dev/null | grep -q "$LABEL" && launchctl list | grep "$LABEL" || echo "no"
  echo "runner:  $([ -x "$RUNNER" ] && echo ok || echo MISSING) $RUNNER"
  echo
  echo "recent fires:"
  ls -1t "$LOGDIR"/*.log 2>/dev/null | head -5 | while read -r f; do
    printf '  %-26s %s\n' "$(basename "$f")" "$(tail -1 "$f" 2>/dev/null | cut -c1-70)"
  done || echo "  (none yet)"
  ;;
esac
