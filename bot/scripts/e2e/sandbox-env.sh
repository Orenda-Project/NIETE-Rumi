#!/usr/bin/env bash
# sandbox-env.sh <keys_file> <sandbox_keys_file> — the settings layer for the SANDBOX lane (E2E_LOCAL_DB=0, bd-53dnra).
# Prints the keys file with its R2_* lines removed, then the R2_* lines of the sandbox keys file: the bot on the
# sandbox database reads and writes the sandbox bucket, where the sandbox's files live. The keys file's R2 lines are
# staging's, and staging's bucket is production's (bd-g9p6e) — a sandbox r2_key missed there, and uploads landed there.
# Each R2 name appears once: dotenv's first-vs-last rule differs within and across files, so remove, never override.
# Exit 14 (local-stack.sh's "keys" code), printing nothing, when the sandbox file has no R2 lines or names another bucket.
set -u
keys="${1:?usage: sandbox-env.sh <keys_file> <sandbox_keys_file>}"; sbx="${2:?usage: sandbox-env.sh <keys_file> <sandbox_keys_file>}"
WANT=rumi-sandbox   # the bucket the sandbox bot and workers use (bd-g9p6e; child-test-sim/sim-stack.sh asserts the same)
fix="add them with: bash bot/scripts/e2e/provision-local-keys.sh --force (it copies the Railway sandbox env's R2_* lines)"
r2=$(grep -E '^R2_[A-Z0-9_]+=' "$sbx" 2>/dev/null)
[ -n "$r2" ] || { echo "[sandbox-env] $sbx has no R2_* lines — the sandbox lane needs the sandbox bucket; $fix" >&2; exit 14; }
bucket=$(printf '%s\n' "$r2" | sed -nE 's/^R2_BUCKET_NAME=(.*)$/\1/p' | head -1 | tr -d "\"' ")
[ "$bucket" = "$WANT" ] || { echo "[sandbox-env] REFUSED: $sbx R2_BUCKET_NAME is '${bucket:-unset}', not $WANT — the sandbox lane must never write to another bucket; $fix" >&2; exit 14; }
grep -vE '^R2_[A-Z0-9_]+=' "$keys"
echo
echo "# --- storage: the sandbox bucket, from $(basename "$sbx") (sandbox-env.sh, bd-53dnra)"
printf '%s\n' "$r2"
