#!/usr/bin/env bash
#
# Take the rendered K-5 corpus to servable, in one guarded command.
#
#   bash bot/scripts/run_upload.sh                       # DRY RUN over v8 + v8u
#   bash bot/scripts/run_upload.sh --r2-only             # objects up, rows prepared as SQL
#   bash bot/scripts/run_upload.sh --commit              # the real upload (needs migration 018)
#   bash bot/scripts/run_upload.sh --commit --limit 3    # a small first bite
#   bash bot/scripts/run_upload.sh --verify-only         # fetch uploaded PDFs back
#
# Why a wrapper and not just the node script: the uploader needs SUPABASE_* and
# R2_* in its environment, and the only copies of those live under NIETE_*
# names in the workspace .env. Mapping them by hand is how you end up pointing a
# writing script at the WRONG production database — NIETE and the main
# Rumi bot share one Cloudflare account AND one R2 bucket (digital-coach-audio;
# identical access key, verified 2026-08-16), so a stray key would land on top of
# PK's live assets. Every assertion below exists because of that.
#
# Resumable by construction: content-addressed keys plus a unique
# (lesson_id, asset_kind, content_hash) index mean an interrupted run is
# re-run, not repaired. Already-uploaded shas are skipped without an R2 call.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_DIR="$(cd "$HERE/.." && pwd)"
REPO_DIR="$(cd "$BOT_DIR/.." && pwd)"

# ── the two things that must never be guessed ───────────────────────────────
EXPECT_REF="ihzciabopbttygxxgrkm"          # NIETE Supabase project
EXPECT_BUCKET="digital-coach-audio"        # shared with the main Rumi bot
KEY_PREFIX="lp-cache/v8/"                  # nothing outside this is ever written

# Default corpus location: the FEAT-059 ingestion tree in the workspace.
DEFAULT_CORPUS="${LP_V8_CORPUS:-}"
ENV_FILE="${NIETE_ENV_FILE:-}"

COMMIT=""
R2_ONLY=""
VERIFY_ONLY=""
SKIP_PREFLIGHT=""
SAMPLE="5"
PASSTHRU=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit)          COMMIT="--commit"; shift ;;
    --r2-only)         R2_ONLY="--r2-only"; shift ;;
    --verify-only)     VERIFY_ONLY="1"; shift ;;
    --skip-preflight)  SKIP_PREFLIGHT="1"; shift ;;
    --sample)          SAMPLE="$2"; shift 2 ;;
    --corpus)          DEFAULT_CORPUS="$2"; shift 2 ;;
    --env-file)        ENV_FILE="$2"; shift 2 ;;
    --limit|--only|--kind) PASSTHRU+=("$1" "$2"); shift 2 ;;
    --reconcile-disk)  PASSTHRU+=("$1"); shift ;;
    -h|--help)         sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

# ── env ─────────────────────────────────────────────────────────────────────
# Search order for the workspace .env, which is where the NIETE_* names live.
if [[ -z "$ENV_FILE" ]]; then
  for cand in "$REPO_DIR/.env" "$REPO_DIR/../.env"; do
    [[ -f "$cand" ]] && { ENV_FILE="$cand"; break; }
  done
fi
[[ -f "${ENV_FILE:-}" ]] || { echo "✗ no env file found — pass --env-file <path> or set NIETE_ENV_FILE" >&2; exit 2; }

read_env() {  # read_env KEY — value only, no export, no sourcing arbitrary shell
  sed -n "s/^$1=//p" "$ENV_FILE" | head -1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

# NIETE_-prefixed names win; the unprefixed ones are the fallback for a repo
# checkout that has its own .env.
export SUPABASE_URL="$(read_env NIETE_SUPABASE_URL)";                          [[ -n "$SUPABASE_URL" ]] || export SUPABASE_URL="$(read_env SUPABASE_URL)"
export SUPABASE_SERVICE_ROLE_KEY="$(read_env NIETE_SUPABASE_SERVICE_ROLE_KEY)"; [[ -n "$SUPABASE_SERVICE_ROLE_KEY" ]] || export SUPABASE_SERVICE_ROLE_KEY="$(read_env SUPABASE_SERVICE_ROLE_KEY)"
export R2_ENDPOINT="$(read_env NIETE_R2_ENDPOINT)";                            [[ -n "$R2_ENDPOINT" ]] || export R2_ENDPOINT="$(read_env R2_ENDPOINT)"
export R2_ACCESS_KEY_ID="$(read_env NIETE_R2_ACCESS_KEY_ID)";                  [[ -n "$R2_ACCESS_KEY_ID" ]] || export R2_ACCESS_KEY_ID="$(read_env R2_ACCESS_KEY_ID)"
export R2_SECRET_ACCESS_KEY="$(read_env NIETE_R2_SECRET_ACCESS_KEY)";          [[ -n "$R2_SECRET_ACCESS_KEY" ]] || export R2_SECRET_ACCESS_KEY="$(read_env R2_SECRET_ACCESS_KEY)"
export R2_BUCKET_NAME="$(read_env NIETE_R2_BUCKET_NAME)";                      [[ -n "$R2_BUCKET_NAME" ]] || export R2_BUCKET_NAME="$(read_env R2_BUCKET_NAME)"

for v in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY R2_ENDPOINT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME; do
  [[ -n "${!v}" ]] || { echo "✗ $v is empty — expected NIETE_$v (or $v) in $ENV_FILE" >&2; exit 2; }
done

# ── assertions, BEFORE anything opens a connection ──────────────────────────
REF="$(printf '%s' "$SUPABASE_URL" | sed -n 's#https://\([a-z0-9]*\)\.supabase\.co.*#\1#p')"
[[ "$REF" == "$EXPECT_REF" ]] || {
  echo "✗ ABORT: Supabase ref '$REF' is not the NIETE project ('$EXPECT_REF')." >&2
  echo "         $ENV_FILE is pointing at a different deployment." >&2; exit 3; }
[[ "$R2_BUCKET_NAME" == "$EXPECT_BUCKET" ]] || {
  echo "✗ ABORT: R2 bucket '$R2_BUCKET_NAME' is not '$EXPECT_BUCKET'." >&2; exit 3; }

if   [[ -n "$VERIFY_ONLY" ]]; then MODE="VERIFY-ONLY (read-only)"
elif [[ -n "$COMMIT" ]];      then MODE="COMMIT — writes to R2 and the DB"
elif [[ -n "$R2_ONLY" ]];     then MODE="R2-ONLY — uploads objects, prepares rows as SQL"
else                               MODE="DRY RUN — nothing is written"
fi

[[ -n "$COMMIT" && -n "$R2_ONLY" ]] && { echo "✗ --commit and --r2-only are alternatives, not a pair" >&2; exit 2; }

echo "env      : $ENV_FILE"
echo "supabase : $REF   (NIETE)"
echo "r2       : $R2_BUCKET_NAME  prefix $KEY_PREFIX"
echo "mode     : $MODE"
echo

# ── verify-only stops here ──────────────────────────────────────────────────
if [[ -n "$VERIFY_ONLY" ]]; then
  exec node "$BOT_DIR/scripts/verify-lp-v8-r2.js" --sample "$SAMPLE"
fi

# ── corpus ──────────────────────────────────────────────────────────────────
if [[ -z "$DEFAULT_CORPUS" ]]; then
  echo "✗ no corpus dir — pass --corpus <…/niete-nbpro> or set LP_V8_CORPUS" >&2; exit 2
fi
[[ -d "$DEFAULT_CORPUS/out" ]] || { echo "✗ $DEFAULT_CORPUS/out does not exist" >&2; exit 2; }

# v8 = English/Math/Science renders, v8u = the Urdu renders. Disjoint lesson_id
# sets (verified 2026-08-16: 0 overlap), so both write into the same prefix
# without any chance of one superseding the other.
MANIFESTS=()
for stem in v8 v8u; do
  [[ -f "$DEFAULT_CORPUS/out/$stem/MANIFEST.jsonl" ]] && MANIFESTS+=("$stem")
done
[[ ${#MANIFESTS[@]} -gt 0 ]] || { echo "✗ no MANIFEST.jsonl under $DEFAULT_CORPUS/out/{v8,v8u}" >&2; exit 2; }

# ── preflight: the DB must be in the shape the uploader writes into ─────────
if [[ -z "$SKIP_PREFLIGHT" ]]; then
  echo "── preflight (read-only) ───────────────────────────────────────────────"
  if ! NIETE_ENV_PATH="$ENV_FILE" python3 "$BOT_DIR/scripts/migration/verify-018-preflight.py"; then
    echo "✗ preflight says the live schema is not ready. Fix that first — do NOT --commit through it." >&2
    exit 4
  fi
  if [[ -n "$COMMIT" ]]; then
    # The preflight passes happily when 018 has not been applied yet (that is
    # its normal pre-go state). A commit run needs the tables to actually exist.
    node -e '
      const s = require("'"$BOT_DIR"'/shared/config/supabase");
      (async () => {
        for (const t of ["niete_lp_assets", "niete_lp_downloads"]) {
          const { error } = await s.from(t).select("id").limit(1);
          if (error) { console.error(`✗ ${t} is not queryable: ${error.message}`); process.exit(5); }
        }
        console.log("  ✓ niete_lp_assets + niete_lp_downloads are present and queryable");
      })();
    ' || { echo "✗ migration 018 has not been applied — run apply-018-lp-v8-assets.js first." >&2; exit 5; }
  fi
  echo
fi

# ── upload ──────────────────────────────────────────────────────────────────
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="${LP_V8_LOG_DIR:-$DEFAULT_CORPUS/out/_upload_runs}"
mkdir -p "$LOG_DIR"

for stem in "${MANIFESTS[@]}"; do
  LOG="$LOG_DIR/${STAMP}_${stem}${COMMIT:+_commit}${R2_ONLY:+_r2only}.log"
  echo "── $stem ───────────────────────────────────────────────────────────────"
  echo "   log → $LOG"
  node "$BOT_DIR/scripts/upload-lp-v8-to-r2.js" \
    --manifest "$DEFAULT_CORPUS/out/$stem/MANIFEST.jsonl" \
    --root "$DEFAULT_CORPUS" \
    ${COMMIT:+$COMMIT} ${R2_ONLY:+$R2_ONLY} "${PASSTHRU[@]+"${PASSTHRU[@]}"}" 2>&1 | tee "$LOG"
  echo
done

# ── prove it, don't assume it ───────────────────────────────────────────────
if [[ -n "$COMMIT" ]]; then
  echo "── fetch-back verification ─────────────────────────────────────────────"
  node "$BOT_DIR/scripts/verify-lp-v8-r2.js" --sample "$SAMPLE"
elif [[ -n "$R2_ONLY" ]]; then
  echo "── fetch-back verification (from the run report — there are no DB rows yet) ──"
  node "$BOT_DIR/scripts/verify-lp-v8-r2.js" --from-report "$LOG_DIR" --sample "$SAMPLE"
fi
