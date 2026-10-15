#!/usr/bin/env bash
# record-env.sh <record_keys_file> <lane_cfg> — the settings layer for record mode on the LOCAL database
# (bd-hnhlgn.18). Prints the AI vendor keys from the record keys file, then the lane's committed settings with
# those same keys removed, so each vendor key appears ONCE: dotenv keeps the LAST of a repeated key, and the
# lane's placeholder used to replace the real key (401 on every AI call). Nothing else leaves the keys file —
# its PORTAL_URL, WhatsApp token, database and storage credentials never reach a local run.
set -u
keys="${1:?usage: record-env.sh <record_keys_file> <lane_cfg>}"; lane="${2:?usage: record-env.sh <record_keys_file> <lane_cfg>}"
# The model, speech and OCR vendors the cassette layer records. Never messaging, email, Slack, DB or storage.
VENDOR='^(OPENROUTER|SONIOX|OPENAI|OPENAI_REALTIME|ANTHROPIC|ELEVENLABS|GEMINI|MISTRAL|DATALAB|CHANDRA|SPEECHACE|UPLIFT|MMS|KIE)_API_KEY='
grep -E "$VENDOR" "$keys" || true
echo
grep -vE "$VENDOR" "$lane"
