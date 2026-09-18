#!/usr/bin/env bash
# provision-local-keys.sh assembles keys/niete-local.env — the one file the mock lane cannot ship
# (gitignored: sandbox DB creds) and the one every other machine was missing (PR #1084's
# `e2e: missing`). It must: read the sandbox DB lines from niete-sandbox.env, take ONLY storage +
# Flow-id + portal lines from the staging Railway env, write placeholders for the WhatsApp/vendor
# keys, refuse a non-sandbox project ref, refuse to overwrite, and never print a value.
#
# Run:  bash bot/scripts/e2e/provision-local-keys.test.sh
set -u
cd "$(dirname "$0")/../../.." || exit 1
ROOT="$PWD"; S="$ROOT/bot/scripts/e2e/provision-local-keys.sh"
FAILED=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
say() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }
has() { case "$2" in *"$3"*) got=yes ;; *) got=no ;; esac; say "$1" "$got" "$4"; }
TMP=$(mktemp -d "${TMPDIR:-/tmp}/provkeys.XXXXXX"); trap 'rm -rf "$TMP"' EXIT
SANDBOX_REF=$(sed -nE 's/^ENV_REFS = .*"sandbox": "([a-z0-9]+)".*/\1/p' "$ROOT/.claude/qa/shared/niete_training_db.py")
PROD_REF=$(sed -nE 's/^ENV_REFS = .*"prod": "([a-z0-9]+)".*/\1/p' "$ROOT/.claude/qa/shared/niete_training_db.py")
[ -n "$SANDBOX_REF" ] && [ -n "$PROD_REF" ] || { echo "cannot read ENV_REFS from niete_training_db.py"; exit 1; }

# a fake `railway` on PATH: a staging --kv dump that ALSO carries the vendor + WhatsApp secrets the
# real env has, so the test proves they are left behind.
mkdir -p "$TMP/bin"; cat > "$TMP/bin/railway" <<'RW'
#!/bin/sh
[ -n "${FAKE_RAILWAY_FAIL:-}" ] && { echo "Unauthorized. Please login with 'railway login'" >&2; exit 1; }
case "$1" in
  variables) printf '%s\n' \
    "PAKISTAN_LP_FLOW_ID=1565529551677911" "TEACHER_TRAINING_FLOW_ID=1271813674911683" "STATUS_FLOW_ID=111" \
    "PORTAL_URL=https://portal.example.test" \
    "R2_ACCOUNT_ID=acct" "R2_ACCESS_KEY_ID=rk" "R2_SECRET_ACCESS_KEY=RSECRET-XYZ" "R2_BUCKET_NAME=b" "R2_ENDPOINT=https://x.r2.dev" \
    "OPENROUTER_API_KEY=sk-or-REALVENDOR" "SONIOX_API_KEY=SONIOX-REAL" "ELEVENLABS_API_KEY=EL-REAL" \
    "WHATSAPP_TOKEN=EAAB-REALWA" "WEBHOOK_VERIFY_TOKEN=verifyme" "WABA_ID=999" "PHONE_NUMBER_ID=888" \
    "SUPABASE_URL=https://STAGINGREF.supabase.co" "SUPABASE_SERVICE_ROLE_KEY=STAGING-SRK" "AWS_SECRET_ACCESS_KEY=AWSSECRET" \
    "RAILWAY_ENVIRONMENT=staging";;
  *) echo ok;;
esac
RW
chmod +x "$TMP/bin/railway"
export PATH="$TMP/bin:$PATH"

echo "provision — refusals"
K1="$TMP/k1"; mkdir -p "$K1"
out=$(bash "$S" --keys-dir "$K1" 2>&1); rc=$?
say "no niete-sandbox.env → exit 2" "$rc" "2"
has "…names the file it needs" "$out" "niete-sandbox.env" yes
[ -e "$K1/niete-local.env" ] && bad "wrote a file despite refusing" || ok "nothing written"

K2="$TMP/k2"; mkdir -p "$K2"
printf 'SUPABASE_URL=https://%s.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=PRODSRK-SECRET\n' "$PROD_REF" > "$K2/niete-sandbox.env"
out=$(bash "$S" --keys-dir "$K2" 2>&1); rc=$?
say "a sandbox file that points at the PROD ref → exit 3" "$rc" "3"
has "…says which env that ref belongs to" "$out" "prod" yes
has "…without printing the key" "$out" "PRODSRK-SECRET" no
[ -e "$K2/niete-local.env" ] && bad "wrote a file for a prod ref" || ok "nothing written for a prod ref"

K3="$TMP/k3"; mkdir -p "$K3"
printf 'SUPABASE_URL=https://%s.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=SBX-SRK-SECRET\n' "$SANDBOX_REF" > "$K3/niete-sandbox.env"
out=$(FAKE_RAILWAY_FAIL=1 bash "$S" --keys-dir "$K3" 2>&1); rc=$?
say "railway not logged in → exit 5" "$rc" "5"
has "…tells the developer to log in or pass --from-kv" "$out" "--from-kv" yes
[ -e "$K3/niete-local.env" ] && bad "wrote a partial file" || ok "no partial file"

echo "provision — happy path (railway)"
out=$(bash "$S" --keys-dir "$K3" 2>&1); rc=$?
say "exit 0" "$rc" "0"
F="$K3/niete-local.env"
[ -f "$F" ] && ok "niete-local.env written next to niete-sandbox.env" || bad "file not written"
v() { sed -nE "s/^$1=(.*)$/\1/p" "$F" | head -1; }
say "SUPABASE_URL is the sandbox one" "$(v SUPABASE_URL)" "https://$SANDBOX_REF.supabase.co"
say "SUPABASE_SERVICE_ROLE_KEY carried over" "$(v SUPABASE_SERVICE_ROLE_KEY)" "SBX-SRK-SECRET"
say "Flow ids taken from Railway" "$(v PAKISTAN_LP_FLOW_ID)" "1565529551677911"
say "PORTAL_URL taken from Railway" "$(v PORTAL_URL)" "https://portal.example.test"
say "R2 lines taken from Railway" "$(v R2_SECRET_ACCESS_KEY)" "RSECRET-XYZ"
has "OPENROUTER_API_KEY is the cassette-only placeholder, never the real key" "$(v OPENROUTER_API_KEY)" "cassette-only" yes
has "…real vendor value absent" "$(cat "$F")" "sk-or-REALVENDOR" no
has "SONIOX never copied" "$(cat "$F")" "SONIOX" no
has "ELEVENLABS never copied" "$(cat "$F")" "ELEVENLABS" no
has "AWS never copied" "$(cat "$F")" "AWS_" no
has "the STAGING Supabase lines never copied" "$(cat "$F")" "STAGINGREF" no
has "WHATSAPP_TOKEN is a placeholder" "$(v WHATSAPP_TOKEN)" "placeholder" yes
has "…real WhatsApp token absent" "$(cat "$F")" "EAAB-REALWA" no
has "WEBHOOK_VERIFY_TOKEN is a placeholder" "$(v WEBHOOK_VERIFY_TOKEN)" "placeholder" yes
has "WABA_ID is a placeholder" "$(v WABA_ID)" "placeholder" yes
has "PHONE_NUMBER_ID is NOT written (local-stack.sh appends the per-run one)" "$(cat "$F")" "PHONE_NUMBER_ID" no
has "file records its provenance" "$(cat "$F")" "provision-local-keys.sh" yes
say "file is private (0600)" "$(stat -f '%Lp' "$F" 2>/dev/null || stat -c '%a' "$F")" "600"
has "stdout lists the names written" "$out" "PAKISTAN_LP_FLOW_ID" yes
has "stdout never shows a value" "$out" "1565529551677911" no
has "stdout never shows the service key" "$out" "SBX-SRK-SECRET" no

echo "provision — never overwrites without --force"
out=$(bash "$S" --keys-dir "$K3" 2>&1); rc=$?
say "second run → exit 4" "$rc" "4"
has "…says --force" "$out" "--force" yes
say "file untouched" "$(v R2_SECRET_ACCESS_KEY)" "RSECRET-XYZ"
out=$(bash "$S" --keys-dir "$K3" --force 2>&1); rc=$?
say "--force rewrites → exit 0" "$rc" "0"

echo "provision — --from-kv (a teammate's dump, no railway login)"
K4="$TMP/k4"; mkdir -p "$K4"; cp "$K3/niete-sandbox.env" "$K4/"
railway variables > "$TMP/dump.kv"
out=$(FAKE_RAILWAY_FAIL=1 bash "$S" --keys-dir "$K4" --from-kv "$TMP/dump.kv" 2>&1); rc=$?
say "exit 0 without calling railway" "$rc" "0"
say "Flow id from the dump" "$(sed -nE 's/^TEACHER_TRAINING_FLOW_ID=(.*)$/\1/p' "$K4/niete-local.env")" "1271813674911683"
has "vendor keys in the dump still left behind" "$(cat "$K4/niete-local.env")" "SONIOX" no

echo "provision — the result satisfies the lane's own resolver"
. "$ROOT/.claude/hooks/lib/mock-lane.sh"
mkdir -p "$TMP/ws/main"; cp -R "$K3" "$TMP/ws/keys"
say "e2e_keys_dir finds the provisioned workspace-level file" "$(e2e_keys_dir "$TMP/ws/main")" "$TMP/ws/keys"

echo; [ "$FAILED" -eq 0 ] && { echo "provision-local-keys: all passed"; exit 0; } || { echo "provision-local-keys: $FAILED failed"; exit 1; }
