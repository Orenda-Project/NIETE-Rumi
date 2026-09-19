#!/usr/bin/env bash
# provision-local-keys.sh — build keys/niete-local.env, the ONE per-machine file the mock E2E lane needs
# and cannot ship (it is gitignored: it carries the sandbox DB credential).
#
#   bash bot/scripts/e2e/provision-local-keys.sh [--from-kv <file>] [--force] [--quiet] [--keys-dir <dir>]
#                                                [--project "NIETE-Rumi Staging"] [--service bot] [--environment staging]
#
# NO MANUAL STEP (operator, 2026-09-18): the hooks run this automatically when the file is missing. The only
# per-machine fact it cannot create is `railway login` with access to the staging project.
#
# What goes in, and from where:
#   · SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY  — from keys/niete-sandbox.env if a hand-made one exists, else from
#     `railway variables --environment sandbox` (and then niete-sandbox.env is written too, so the DB tooling works).
#     Either way the project ref MUST be the sandbox one (ENV_REFS in .claude/qa/shared/niete_training_db.py) or
#     nothing is written.
#   · storage + Flow-id + portal lines           — `railway variables --kv` of the staging bot service, filtered
#     to ^(R2_*|*_FLOW_ID|PORTAL_URL)=. Or --from-kv <file>: a teammate's dump, for a machine with no railway login.
#   · everything else                            — placeholders. No WhatsApp token, no vendor key: the Graph API is
#     bot/scripts/e2e/mock-graph-api.js and vendors are cassette replay-strict. That absence is what keeps the lane offline.
#   local-stack.sh appends the per-run values (port, the phone-number id, WHATSAPP_API_BASE, E2E_*) itself.
#
# Exit codes: 2 a hand-made niete-sandbox.env exists but lacks the two lines · 3 the sandbox lines point at a
# NON-sandbox project · 4 target exists (use --force) · 5 railway unavailable / not logged in (the one manual fact;
# --from-kv covers the staging half only) · 6 nothing usable in the extract.
# Never prints a value — names only.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"

KEYS_DIR=""; FROM_KV=""; FORCE=""; QUIET=""; PROJECT="NIETE-Rumi Staging"; SERVICE="bot"; ENVIRONMENT="staging"; SANDBOX_ENVIRONMENT="sandbox"
while [ $# -gt 0 ]; do case "$1" in
  --keys-dir) KEYS_DIR="$2"; shift 2 ;;
  --from-kv) FROM_KV="$2"; shift 2 ;;
  --force) FORCE=1; shift ;;
  --quiet) QUIET=1; shift ;;
  --sandbox-environment) SANDBOX_ENVIRONMENT="$2"; shift 2 ;;
  --project) PROJECT="$2"; shift 2 ;;
  --service) SERVICE="$2"; shift 2 ;;
  --environment) ENVIRONMENT="$2"; shift 2 ;;
  -h|--help) sed -n 2,20p "$0"; exit 0 ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac; done

log() { echo "[provision-local-keys] $*" >&2; }

# Where keys/ lives: the MAIN checkout even from a worktree, else the workspace level — the same two
# places local-stack.sh looks, so what we write is what the lane finds.
if [ -z "$KEYS_DIR" ]; then
  common=$(git -C "$REPO" rev-parse --git-common-dir 2>/dev/null) || common="$REPO/.git"
  case "$common" in /*) ;; *) common="$REPO/$common" ;; esac
  MAIN="$(dirname "$common")"
  KEYS_DIR="$MAIN/keys"
  if [ ! -f "$KEYS_DIR/niete-sandbox.env" ] && [ -f "$(dirname "$MAIN")/keys/niete-sandbox.env" ]; then KEYS_DIR="$(dirname "$MAIN")/keys"; fi
fi
mkdir -p "$KEYS_DIR" 2>/dev/null || { log "cannot create $KEYS_DIR"; exit 2; }
SANDBOX_FILE="$KEYS_DIR/niete-sandbox.env"
TARGET="$KEYS_DIR/niete-local.env"

railway_kv() {  # $1 = environment → the --kv dump on stdout, or exit 5 with the ONE manual fact named
  command -v railway >/dev/null 2>&1 || { log "railway CLI not on PATH. Install it and \`railway login\` (access to \"$PROJECT\"), or pass --from-kv <file> for the staging half."; exit 5; }
  local errf="${TMPDIR:-/tmp}/provision-railway.$$.err" out
  if ! out=$(railway variables -p "$PROJECT" -s "$SERVICE" --environment "$1" --kv 2>"$errf"); then
    log "railway variables ($1) failed: $(head -c 200 "$errf" | tr '\n' ' ')"
    log "Run \`railway login\` with an account that has access to the \"$PROJECT\" project — the only per-machine fact this script cannot create (or pass --from-kv <file> for the staging half)."
    rm -f "$errf"; exit 5
  fi
  rm -f "$errf"; printf '%s\n' "$out"
}

SBX_SOURCE="niete-sandbox.env"
if [ -f "$SANDBOX_FILE" ]; then
  url=$(sed -nE 's/^SUPABASE_URL=(.*)$/\1/p' "$SANDBOX_FILE" | head -1 | tr -d '"'"'"' ')
  key=$(sed -nE 's/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/\1/p' "$SANDBOX_FILE" | head -1 | tr -d '"'"'"' ')
  if [ -z "$url" ] || [ -z "$key" ]; then log "$SANDBOX_FILE lacks SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY."; exit 2; fi
else
  # No hand-made file: the sandbox DB lines live in the Railway SANDBOX environment. Nothing else is read from it.
  SBX_KV=$(railway_kv "$SANDBOX_ENVIRONMENT") || exit $?
  url=$(printf '%s\n' "$SBX_KV" | sed -nE 's/^SUPABASE_URL=(.*)$/\1/p' | head -1 | tr -d '"'"'"' ')
  key=$(printf '%s\n' "$SBX_KV" | sed -nE 's/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/\1/p' | head -1 | tr -d '"'"'"' ')
  if [ -z "$url" ] || [ -z "$key" ]; then log "the Railway '$SANDBOX_ENVIRONMENT' environment has no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Nothing written."; exit 6; fi
  SBX_SOURCE="railway:$SANDBOX_ENVIRONMENT"
fi

# The sandbox project ref is asserted exactly the way the DB tooling asserts it — one source of truth.
REFS_PY="$REPO/.claude/qa/shared/niete_training_db.py"
ENV_REFS_LINE=$(sed -nE 's/^ENV_REFS = \{(.*)\}.*/\1/p' "$REFS_PY" 2>/dev/null)
SANDBOX_REF=$(printf '%s' "$ENV_REFS_LINE" | sed -nE 's/.*"sandbox": "([a-z0-9]+)".*/\1/p')
[ -n "$SANDBOX_REF" ] || SANDBOX_REF="olvritwoqujtjvwfulbh"   # fallback = the value in niete_training_db.py on 2026-09-18
ref=$(printf '%s' "$url" | sed -nE 's#^https?://([a-z0-9]+)\.supabase\.co.*#\1#p')
if [ "$ref" != "$SANDBOX_REF" ]; then
  other=$(printf '%s' "$ENV_REFS_LINE" | tr ',' '\n' | sed -nE "s/.*\"([a-z]+)\": \"$ref\".*/\1/p" | head -1)
  log "REFUSED: the sandbox lines ($SBX_SOURCE) point at project ref '${ref:-?}' which is ${other:+the '$other' environment, }not the sandbox ($SANDBOX_REF)."
  log "The mock lane may only ever run on the sandbox DB. Nothing written."
  exit 3
fi

if [ -f "$TARGET" ] && [ -z "$FORCE" ]; then
  log "$TARGET already exists — re-run with --force to rewrite it (its current lines are kept otherwise)."
  exit 4
fi

# The Railway extract: only storage, Flow ids and the portal URL. Nothing else is ever read into the file.
if [ -n "$FROM_KV" ]; then
  [ -f "$FROM_KV" ] || { log "--from-kv $FROM_KV: no such file"; exit 5; }
  RAW=$(cat "$FROM_KV"); SOURCE="--from-kv $(basename "$FROM_KV")"
else
  RAW=$(railway_kv "$ENVIRONMENT") || exit $?
  SOURCE="railway: $PROJECT / $SERVICE / $ENVIRONMENT"
fi
EXTRACT=$(printf '%s\n' "$RAW" | grep -E '^(R2_[A-Z0-9_]+|[A-Z0-9_]+_FLOW_ID|PORTAL_URL)=' | sort -u)
[ -n "$EXTRACT" ] || { log "the extract has no R2_*/…_FLOW_ID/PORTAL_URL lines — wrong project/service/environment? Nothing written."; exit 6; }
# Belt on top of the filter: a credential name must never slip through, whatever the dump contained.
if printf '%s\n' "$EXTRACT" | grep -qE '^(SUPABASE|OPENROUTER|WHATSAPP_TOKEN|WEBHOOK|WABA|PHONE_NUMBER|AWS_|[A-Z]*_API_KEY)'; then
  log "REFUSED: a credential name is in the extract — the filter is broken. Nothing written."; exit 6
fi
N=$(printf '%s\n' "$EXTRACT" | wc -l | tr -d ' ')

umask 077
TMPF="$(mktemp "$KEYS_DIR/.niete-local.env.XXXXXX")"
{
  echo "# ---- niete-local.env: the LOCAL MOCK E2E lane. Generated by bot/scripts/e2e/provision-local-keys.sh on $(date -u +%Y-%m-%d) from"
  echo "# niete-sandbox.env + $SOURCE. Gitignored — never commit. Re-generate with --force."
  echo "# The sandbox DB (the only real credential in this file):"
  echo "SUPABASE_URL=$url"
  echo "SUPABASE_SERVICE_ROLE_KEY=$key"
  echo "# Placeholders: the Graph API is bot/scripts/e2e/mock-graph-api.js and every vendor call is cassette replay-strict"
  echo "# (a miss fails; it never goes live). No real token or vendor key belongs here — that absence keeps the lane offline."
  echo "WHATSAPP_TOKEN=placeholder-mock-lane"
  echo "WEBHOOK_VERIFY_TOKEN=placeholder-mock-lane"
  echo "WABA_ID=placeholder-mock-lane"
  echo "OPENROUTER_API_KEY=cassette-only-no-live-vendor-calls"
  echo "LOG_LEVEL=info"
  echo "# --- storage + Flow ids + portal ($N lines, $SOURCE). local-stack.sh appends the per-run values itself."
  printf '%s\n' "$EXTRACT"
} > "$TMPF"
chmod 600 "$TMPF" && mv -f "$TMPF" "$TARGET"
WROTE_SBX=""
if [ ! -f "$SANDBOX_FILE" ]; then
  # so niete_training_db.py / niete_sandbox_driver.py work on this machine too — still no manual step
  TMPS="$(mktemp "$KEYS_DIR/.niete-sandbox.env.XXXXXX")"
  { echo "# ---- niete-sandbox.env: the sandbox DB. Generated by bot/scripts/e2e/provision-local-keys.sh on $(date -u +%Y-%m-%d) from $SBX_SOURCE. Gitignored — never commit."
    echo "SUPABASE_URL=$url"; echo "SUPABASE_SERVICE_ROLE_KEY=$key"; } > "$TMPS"
  chmod 600 "$TMPS" && mv -f "$TMPS" "$SANDBOX_FILE" && WROTE_SBX=" + niete-sandbox.env"
fi
if [ -n "$QUIET" ]; then
  echo "provisioned $TARGET$WROTE_SBX (sandbox DB from $SBX_SOURCE, $N Flow/storage/portal lines from $SOURCE)"
  exit 0
fi
echo "wrote $TARGET (0600)$WROTE_SBX: SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY (from $SBX_SOURCE) + 4 placeholders + LOG_LEVEL + $N from $SOURCE:"
printf '%s\n' "$EXTRACT" | cut -d= -f1 | tr '\n' ' '; echo
echo "next: bash .claude/qa/shared/commit-e2e.sh HEAD   (docs/e2e-mock-lane.md)"
