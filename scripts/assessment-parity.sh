#!/usr/bin/env bash
# The assessment feature's files must be IDENTICAL on main and develop.
#
# Why: main and develop diverged by 554 files in Aug–Sep 2026, so assessment fixes
# were hand-merged across them — and four of them landed on one side only
# (content-type on develop not main; the KEEP fix, client-error logging and the
# jszip devDependency on main not develop). Each was found by a teacher or by
# inspection days later. A fix is not done until this passes.
#
#   bash scripts/assessment-parity.sh            # compares origin/main..origin/develop
#   bash scripts/assessment-parity.sh HEAD develop
set -euo pipefail
A="${1:-origin/main}"; B="${2:-origin/develop}"
PATHS=(
  bot/shared/services/assessment
  bot/shared/routes/assessment-gen-endpoint.js
  bot/shared/utils/html-to-docx.js
  docs/flows/assessment-gen-flow.json
  docs/flows/assessment-review-flow.json
  scripts/assessment
  scripts/lib/textbook_import.py
  tests/assessment
)
git fetch origin --quiet 2>/dev/null || true
if git diff --quiet "$A" "$B" -- "${PATHS[@]}"; then
  echo "assessment-parity: $A == $B on all assessment paths"
  exit 0
fi
echo "assessment-parity: DIFFERS between $A and $B:"
git diff --stat "$A" "$B" -- "${PATHS[@]}" | sed 's/^/  /'
echo
echo "A fix on one branch is half a fix. Port it, then re-run."
exit 1
