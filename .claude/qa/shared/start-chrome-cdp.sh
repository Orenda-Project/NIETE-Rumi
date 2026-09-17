#!/usr/bin/env bash
# start-chrome-cdp.sh — launch the E2E Chrome with a TCP CDP endpoint.
# chrome-devtools-mcp launches Chrome with --remote-debugging-pipe (no TCP port), so
# flow-drive.js and inject-wa-drive.js cannot attach and the 23-53x Flow fast path is
# silently off. Run this BEFORE starting Claude Code; the WhatsApp link survives.
set -uo pipefail
PORT="${CDP_PORT:-9223}"
PROFILE="${CHROME_PROFILE:-$HOME/.cache/chrome-devtools-mcp/chrome-profile}"
CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if curl -s -m 2 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
  echo "CDP already serving on ${PORT}."
else
  [ -x "$CHROME" ] || { echo "ERROR: Chrome not at $CHROME (set CHROME_BIN)"; exit 1; }
  pkill -f "$PROFILE" 2>/dev/null; sleep 3
  rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonSocket" "$PROFILE/SingletonCookie" 2>/dev/null
  nohup "$CHROME" --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" \
    --no-first-run --no-default-browser-check "https://web.whatsapp.com" \
    >"/tmp/chrome-cdp-${PORT}.log" 2>&1 &
  for _ in $(seq 1 20); do curl -s -m 1 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1 && break; sleep 1; done
fi
curl -s -m 2 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1 || { echo "ERROR: no CDP on ${PORT}"; exit 1; }
echo "CDP up on ${PORT}. Check the fast path:  node flow-drive.js probe --port ${PORT}"
