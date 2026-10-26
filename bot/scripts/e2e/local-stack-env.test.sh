#!/usr/bin/env bash
# local-stack-env.test.sh — record mode on the LOCAL database gives the bot the real AI vendor keys and nothing
# else from the record keys file (bd-hnhlgn.18).
#
# local-stack.sh wrote the whole record keys file and THEN the lane's settings, on the belief that dotenv keeps
# the first value. For a key repeated inside one file dotenv keeps the LAST, so the lane's placeholder
# OPENROUTER_API_KEY replaced the real one and every AI call failed `401 Missing Authentication header`. And the
# keys file's non-vendor lines (production PORTAL_URL, WhatsApp token…) must never reach a local run either way.
#   AC1  record-env.sh <keys> <lane>: each vendor key once, at the keys file's value; every other setting from
#        the lane; no keys-file line that is not a vendor key (PORTAL_URL, WHATSAPP_TOKEN, SUPABASE_*, R2_*)
#   AC1b dotenv reads the real vendor key from the result (when dotenv is installed here)
#   AC2  local-stack.sh composes its record-mode local .env through record-env.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F="$HERE/record-env.sh"
fails=0
t() { if [ "$2" = "$3" ]; then echo "  ok  $1"; else echo "  FAIL $1: want [$3] got [$2]"; fails=$((fails+1)); fi; }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

cat >"$tmp/record.env" <<'EOF'
SUPABASE_URL=https://sandbox.example
R2_ACCESS_KEY_ID=real-r2
WHATSAPP_TOKEN=real-wa
PORTAL_URL=https://portal.production.example
RESEND_API_KEY=real-resend
OPENROUTER_API_KEY=sk-or-real
SONIOX_API_KEY="real-soniox"
OPENAI_API_KEY=sk-openai-real
EOF
cat >"$tmp/lane.env" <<'EOF'
# lane settings
OPENROUTER_API_KEY=cassette-only-placeholder
PORTAL_URL=http://127.0.0.1:5173
WHATSAPP_TOKEN=placeholder
LOG_LEVEL=info
EOF

echo "AC1 vendor keys from the keys file, everything else from the lane"
bash "$F" "$tmp/record.env" "$tmp/lane.env" >"$tmp/out.env" 2>/dev/null; t "exit" "$?" "0"
t "OPENROUTER once" "$(grep -c '^OPENROUTER_API_KEY=' "$tmp/out.env")" "1"
t "OPENROUTER is the real one" "$(sed -n 's/^OPENROUTER_API_KEY=//p' "$tmp/out.env")" "sk-or-real"
t "SONIOX carried (quoted as written)" "$(sed -n 's/^SONIOX_API_KEY=//p' "$tmp/out.env")" '"real-soniox"'
t "OPENAI carried" "$(sed -n 's/^OPENAI_API_KEY=//p' "$tmp/out.env")" "sk-openai-real"
t "PORTAL_URL stays local" "$(sed -n 's/^PORTAL_URL=//p' "$tmp/out.env")" "http://127.0.0.1:5173"
t "WHATSAPP_TOKEN stays the placeholder" "$(sed -n 's/^WHATSAPP_TOKEN=//p' "$tmp/out.env")" "placeholder"
t "no database/storage/email credential" "$(grep -cE '^(SUPABASE_|R2_|RESEND_)' "$tmp/out.env")" "0"
t "lane-only setting kept" "$(sed -n 's/^LOG_LEVEL=//p' "$tmp/out.env")" "info"

DOTENV=""; for d in "$HERE/../../node_modules" "$HOME/.cache/niete-dev-portal/run/src/bot/node_modules"; do [ -f "$d/dotenv/package.json" ] && { DOTENV="$d/dotenv"; break; }; done
if [ -n "$DOTENV" ]; then
  t "AC1b dotenv reads the real key" "$(node -e 'const d=require(process.argv[1]);console.log(d.parse(require("fs").readFileSync(process.argv[2])).OPENROUTER_API_KEY)' "$DOTENV" "$tmp/out.env")" "sk-or-real"
else echo "  skip AC1b: dotenv not installed here"; fi

echo "AC2 local-stack.sh uses it in record mode"
grep -qF 'bash "$HERE/record-env.sh" "$keys" "$lane_cfg"' "$HERE/local-stack.sh"; t "record mode composes through record-env.sh" "$?" "0"

echo "AC3 --record-missing (mode replay + the record keys file) composes through record-env.sh too (bd-xeup1d)"
# The first --record-missing run on the local lane: mode is replay, keys_name is niete-record.env, but the env was
# composed from the lane config alone — placeholder OPENROUTER_API_KEY, every live call "401 Missing Authentication
# header", nothing recorded. The condition must follow the keys FILE in use, not the mode.
grep -qF 'if [ "$keys_name" = niete-record.env ] && [ -n "$keys" ]; then bash "$HERE/record-env.sh" "$keys" "$lane_cfg"' "$HERE/local-stack.sh"; t "record keys file in use → record-env.sh, in replay mode as well" "$?" "0"

[ $fails = 0 ] && echo "PASS" || { echo "$fails failed"; exit 1; }
