#!/usr/bin/env bash
# provision-local-keys.sh — build keys/niete-local.env, the ONE per-machine file the mock E2E lane needs
# and cannot ship (it is gitignored: it carries the sandbox DB credential).
#
#   bash bot/scripts/e2e/provision-local-keys.sh [--from-kv <file>] [--force] [--keys-dir <dir>]
#                                                [--project "NIETE-Rumi Staging"] [--service bot] [--environment staging]
#
# What goes in, and from where:
#   · SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY  — copied from keys/niete-sandbox.env (same dir). The project
#     ref MUST be the sandbox one (ENV_REFS in .claude/qa/shared/niete_training_db.py) or nothing is written.
#   · storage + Flow-id + portal lines           — `railway variables --kv` of the staging bot service, filtered
#     to ^(R2_*|*_FLOW_ID|PORTAL_URL)=. Or --from-kv <file>: a teammate's dump, for a machine with no railway login.
#   · everything else                            — placeholders. No WhatsApp token, no vendor key: the Graph API is
#     bot/scripts/e2e/mock-graph-api.js and vendors are cassette replay-strict. That absence is what keeps the lane offline.
#   local-stack.sh appends the per-run values (port, the phone-number id, WHATSAPP_API_BASE, E2E_*) itself.
#
# Exit codes: 2 keys/niete-sandbox.env not found · 3 that file points at a NON-sandbox project · 4 target exists
# (use --force) · 5 railway unavailable / not logged in (or use --from-kv) · 6 nothing usable in the extract.
# Never prints a value — names only.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"

KEYS_DIR=""; FROM_KV=""; FORCE=""; PROJECT="NIETE-Rumi Staging"; SERVICE="bot"; ENVIRONMENT="staging"
while [ $# -gt 0 ]; do case "$1" in
  --keys-dir) KEYS_DIR="$2"; shift 2 ;;
  --from-kv) FROM_KV="$2"; shift 2 ;;
  --force) FORCE=1; shift ;;
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
  KEYS_DIR="$MAIN/keys"; [ -f "$KEYS_DIR/niete-sandbox.env" ] || KEYS_DIR="$(dirname "$MAIN")/keys"
fi
SANDBOX_FILE="$KEYS_DIR/niete-sandbox.env"
TARGET="$KEYS_DIR/niete-local.env"

if [ ! -f "$SANDBOX_FILE" ]; then
  log "keys/niete-sandbox.env not found (looked for $SANDBOX_FILE)."
  log "It holds the two sandbox Supabase lines (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) — see the credentials doc. Create it, then re-run."
  exit 2
fi

# The sandbox project ref is asserted exactly the way the DB tooling asserts it — one source of truth.
REFS_PY="$REPO/.claude/qa/shared/niete_training_db.py"
ENV_REFS_LINE=$(sed -nE 's/^ENV_REFS = \{(.*)\}.*/\1/p' "$REFS_PY" 2>/dev/null)
SANDBOX_REF=$(printf '%s' "$ENV_REFS_LINE" | sed -nE 's/.*"sandbox": "([a-z0-9]+)".*/\1/p')
[ -n "$SANDBOX_REF" ] || SANDBOX_REF="olvritwoqujtjvwfulbh"   # fallback = the value in niete_training_db.py on 2026-09-18
url=$(sed -nE 's/^SUPABASE_URL=(.*)$/\1/p' "$SANDBOX_FILE" | head -1 | tr -d '"'"'"' ')
key=$(sed -nE 's/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/\1/p' "$SANDBOX_FILE" | head -1 | tr -d '"'"'"' ')
if [ -z "$url" ] || [ -z "$key" ]; then log "$SANDBOX_FILE lacks SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY."; exit 2; fi
ref=$(printf '%s' "$url" | sed -nE 's#^https?://([a-z0-9]+)\.supabase\.co.*#\1#p')
if [ "$ref" != "$SANDBOX_REF" ]; then
  other=$(printf '%s' "$ENV_REFS_LINE" | tr ',' '\n' | sed -nE "s/.*\"([a-z]+)\": \"$ref\".*/\1/p" | head -1)
  log "REFUSED: $SANDBOX_FILE points at project ref '${ref:-?}' which is ${other:+the '$other' environment, }not the sandbox ($SANDBOX_REF)."
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
  command -v railway >/dev/null 2>&1 || { log "railway CLI not on PATH. Install it and \`railway login\`, or pass --from-kv <file> (a teammate's \`railway variables -p \"$PROJECT\" -s $SERVICE --environment $ENVIRONMENT --kv\` dump)."; exit 5; }
  if ! RAW=$(railway variables -p "$PROJECT" -s "$SERVICE" --environment "$ENVIRONMENT" --kv 2>"${TMPDIR:-/tmp}/provision-railway.err"); then
    log "railway variables failed: $(head -c 200 "${TMPDIR:-/tmp}/provision-railway.err" | tr '\n' ' ')"
    log "Run \`railway login\` (an account with access to the \"$PROJECT\" project), or pass --from-kv <file>."
    exit 5
  fi
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
echo "wrote $TARGET (0600): SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY + 4 placeholders + LOG_LEVEL + $N from $SOURCE:"
printf '%s\n' "$EXTRACT" | cut -d= -f1 | tr '\n' ' '; echo
echo "next: bash .claude/qa/shared/commit-e2e.sh HEAD   (docs/e2e-mock-lane.md)"
