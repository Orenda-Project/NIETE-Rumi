#!/usr/bin/env bash
# Publish harvested WhatsApp templates to the NIETE WABA.
# Run this ONCE after the NIETE WABA is created and you have its access token.
#
# Usage:
#   NIETE_WHATSAPP_TOKEN='...' NIETE_WABA_ID='...' bash publish-templates.sh
#
# Optional:
#   PREFIX='niete_'   — prefix template names (default: none — same names work on separate WABA)
#   DRY_RUN=1         — print what would be submitted, don't actually submit

set -euo pipefail

if [ -z "${NIETE_WHATSAPP_TOKEN:-}" ] || [ -z "${NIETE_WABA_ID:-}" ]; then
  echo "ERROR: Set NIETE_WHATSAPP_TOKEN and NIETE_WABA_ID environment variables first." >&2
  echo "  export NIETE_WHATSAPP_TOKEN='EAA...'" >&2
  echo "  export NIETE_WABA_ID='1234567890'" >&2
  exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
PREFIX="${PREFIX:-}"
DRY_RUN="${DRY_RUN:-0}"

echo "Publisher config:"
echo "  WABA_ID:      $NIETE_WABA_ID"
echo "  Token prefix: ${NIETE_WHATSAPP_TOKEN:0:8}..."
echo "  Name prefix:  '${PREFIX}' (empty = same names as PK)"
echo "  Dry run:      $([ "$DRY_RUN" = "1" ] && echo yes || echo no)"
echo ""

SUBMITTED=0
FAILED=0

for JSON in "$DIR"/*.json; do
  BASENAME=$(basename "$JSON" .json)

  # Build the submission body: same JSON but prefix name if requested
  BODY=$(jq --arg prefix "$PREFIX" '. + {name: ($prefix + .name)}' "$JSON")
  SUBMIT_NAME=$(echo "$BODY" | jq -r '.name')

  if [ "$DRY_RUN" = "1" ]; then
    echo "  [DRY] Would submit: $SUBMIT_NAME (cat=$(echo "$BODY" | jq -r '.category'), lang=$(echo "$BODY" | jq -r '.language'))"
    SUBMITTED=$((SUBMITTED + 1))
    continue
  fi

  RESPONSE=$(curl -sS -X POST \
    "https://graph.facebook.com/v20.0/$NIETE_WABA_ID/message_templates" \
    -H "Authorization: Bearer $NIETE_WHATSAPP_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$BODY" || echo '{"error":"curl-failed"}')

  ID=$(echo "$RESPONSE" | jq -r '.id // empty')
  STATUS=$(echo "$RESPONSE" | jq -r '.status // empty')
  ERR=$(echo "$RESPONSE" | jq -r '.error.message // empty')

  if [ -n "$ID" ]; then
    echo "  ✓ $SUBMIT_NAME → id=$ID status=$STATUS"
    SUBMITTED=$((SUBMITTED + 1))
  else
    echo "  ✗ $SUBMIT_NAME → ERROR: $ERR"
    echo "    Raw response: $RESPONSE"
    FAILED=$((FAILED + 1))
  fi

  # Modest rate limiting — Meta throttles bulk submissions
  sleep 1
done

echo ""
echo "Summary:"
echo "  Submitted: $SUBMITTED"
echo "  Failed:    $FAILED"
echo ""
echo "Next steps:"
echo "  - Monitor Meta Business Manager for approval status (usually 1–24h for MARKETING carousels)"
echo "  - Any REJECTIONS require reviewing Meta's feedback and re-submitting the corrected template"
echo "  - Once APPROVED, update the fork's env vars if any templates need specific IDs (e.g. Flow IDs)"
