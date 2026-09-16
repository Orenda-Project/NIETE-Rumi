#!/usr/bin/env bash
# mock-console.sh — bring up the mock stack and open a LIVE, interactive mock WhatsApp you can chat with.
#
#   bash bot/scripts/e2e/mock-console.sh [<sha>|HEAD]
#
# It starts the pinned bot + mock + redis + worker (local-stack up), registers the synthetic driver in the
# sandbox, prints the console URL, and holds until Ctrl+C — then tears the stack down. Open the URL in a
# browser: type messages, tap list rows and buttons, watch the local bot reply. No phone, no Meta.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../.." && pwd)"
REF="${1:-HEAD}"; SHA="$(git -C "$REPO" rev-parse --verify "${REF}^{commit}")" || { echo "not a commit: $REF"; exit 2; }
RUN_DIR="$REPO/.claude/qa/results/whatsapp/niete/console-$(date -u +%Y%m%d-%H%M%S)-${SHA:0:7}"
mkdir -p "$RUN_DIR"
cleanup() { echo; echo "→ tearing down…"; bash "$HERE/local-stack.sh" down "$RUN_DIR" >/dev/null 2>&1; exit 0; }
trap cleanup INT TERM
echo "→ starting the mock stack at ${SHA:0:12} (this takes ~30s)…"
bash "$HERE/local-stack.sh" up "$SHA" "$RUN_DIR" || { echo "stack failed — see $RUN_DIR/*.log"; exit 1; }
# register the synthetic teacher so the bot treats it as a known, registered user
K="$REPO/keys"; [ -f "$K/niete-local.env" ] || K="$(dirname "$REPO")/keys"
if [ -f "$K/niete-local.env" ]; then
  eval "$(grep -E '^SUPABASE_(URL|SERVICE_ROLE_KEY)=' "$K/niete-local.env" | sed 's/^SUPABASE_/export NIETE_SANDBOX_SUPABASE_/')"
  python3 "$REPO/.claude/qa/shared/niete_sandbox_driver.py" ensure --phone 923000000001 --yes-write 2>/dev/null | tail -1 || true
fi
PORT="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["mock_url"])' "$RUN_DIR/stack.json")"
echo
echo "┌──────────────────────────────────────────────────────────────┐"
echo "│  LIVE mock WhatsApp is up.  Open in a browser:               │"
echo "│     $PORT/console"
echo "│  Type, tap list rows/buttons, watch the local bot reply.     │"
echo "│  Ctrl+C here to shut it down.                                 │"
echo "└──────────────────────────────────────────────────────────────┘"
while true; do sleep 3600; done
