#!/usr/bin/env bash
# sandbox-env.test.sh — the sandbox lane (E2E_LOCAL_DB=0) gets the SANDBOX bucket, never staging's (bd-53dnra).
#
# keys/niete-local.env carries staging's R2_* lines, and staging's bucket/key are production's (bd-g9p6e). On the
# sandbox database a teacher's own plan lives only in rumi-sandbox, so the extraction read NoSuchKey, and every
# sandbox-lane upload landed in the production bucket.
#   AC1  sandbox-env.sh <keys> <sandbox_keys>: every keys-file line except R2_*, then the R2_* lines of the sandbox
#        keys file — each R2 name once (dotenv keeps the FIRST of a repeated key ACROSS files and the LAST within one;
#        removing, not appending, is the only order-proof way)
#   AC2  no R2 lines in the sandbox keys file, or a bucket other than rumi-sandbox → exit 14, a how-to message, no output
#   AC3  local-stack.sh composes its sandbox-lane .env through sandbox-env.sh, before anything starts
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F="$HERE/sandbox-env.sh"
fails=0
t() { if [ "$2" = "$3" ]; then echo "  ok  $1"; else echo "  FAIL $1: want [$3] got [$2]"; fails=$((fails+1)); fi; }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

cat >"$tmp/local.env" <<'EOF'
SUPABASE_URL=https://sandbox.example
SUPABASE_SERVICE_ROLE_KEY=sbx-srk
WHATSAPP_TOKEN=placeholder
R2_ACCOUNT_ID=staging-acct
R2_ACCESS_KEY_ID=staging-key
R2_SECRET_ACCESS_KEY=staging-secret
R2_BUCKET_NAME=digital-coach-audio
R2_ENDPOINT=https://staging.r2.example
PAKISTAN_LP_FLOW_ID=123
EOF
cat >"$tmp/sandbox.env" <<'EOF'
SUPABASE_URL=https://sandbox.example
SUPABASE_SERVICE_ROLE_KEY=sbx-srk
R2_ACCESS_KEY_ID=sbx-key
R2_SECRET_ACCESS_KEY=sbx-secret
R2_BUCKET_NAME="rumi-sandbox"
R2_ENDPOINT=https://sandbox.r2.example
EOF

echo "AC1 the sandbox bucket and creds, staging's gone"
bash "$F" "$tmp/local.env" "$tmp/sandbox.env" >"$tmp/out.env" 2>/dev/null; t "exit" "$?" "0"
v() { sed -nE "s/^$1=(.*)$/\1/p" "$tmp/out.env" | tr -d "\"'"; }
t "bucket is rumi-sandbox" "$(v R2_BUCKET_NAME)" "rumi-sandbox"
t "sandbox key id" "$(v R2_ACCESS_KEY_ID)" "sbx-key"
t "sandbox secret" "$(v R2_SECRET_ACCESS_KEY)" "sbx-secret"
t "sandbox endpoint" "$(v R2_ENDPOINT)" "https://sandbox.r2.example"
t "each R2 name once" "$(grep -E '^R2_' "$tmp/out.env" | cut -d= -f1 | sort | uniq -d | wc -l | tr -d ' ')" "0"
t "no staging R2 value left" "$(grep -c 'staging' "$tmp/out.env")" "0"
t "no staging-only R2 name left (R2_ACCOUNT_ID)" "$(grep -c '^R2_ACCOUNT_ID=' "$tmp/out.env")" "0"
t "database lines kept" "$(v SUPABASE_SERVICE_ROLE_KEY)" "sbx-srk"
t "non-storage lines kept" "$(v PAKISTAN_LP_FLOW_ID)" "123"
t "sandbox file's DB lines not duplicated" "$(grep -c '^SUPABASE_URL=' "$tmp/out.env")" "1"

echo "AC2 refuses without the sandbox bucket"
grep -v '^R2_' "$tmp/sandbox.env" >"$tmp/nor2.env"
out=$(bash "$F" "$tmp/local.env" "$tmp/nor2.env" 2>"$tmp/err"); t "no R2 lines → exit 14" "$?" "14"
t "…prints no env" "$out" ""
grep -q 'provision-local-keys.sh' "$tmp/err"; t "…says how to add them" "$?" "0"
sed 's/rumi-sandbox/digital-coach-audio/' "$tmp/sandbox.env" >"$tmp/prod.env"
out=$(bash "$F" "$tmp/local.env" "$tmp/prod.env" 2>"$tmp/err"); t "another bucket → exit 14" "$?" "14"
t "…prints no env" "$out" ""
grep -q 'rumi-sandbox' "$tmp/err"; t "…names the bucket it wants" "$?" "0"
out=$(bash "$F" "$tmp/local.env" "$tmp/missing.env" 2>/dev/null); t "no sandbox keys file → exit 14" "$?" "14"

echo "AC3 local-stack.sh uses it on the sandbox lane"
grep -qF 'bash "$HERE/sandbox-env.sh" "$keys" "$KEYS_DIR/niete-sandbox.env"' "$HERE/local-stack.sh"; t "sandbox lane composes through sandbox-env.sh" "$?" "0"
grep -qE '^ *else cat "\$keys"; fi' "$HERE/local-stack.sh"; t "the raw keys file is no longer the sandbox lane's env" "$?" "1"

[ $fails = 0 ] && echo "PASS" || { echo "$fails failed"; exit 1; }
