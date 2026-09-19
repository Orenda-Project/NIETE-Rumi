#!/usr/bin/env bash
# no-tenant-literals.test.sh — engine CODE names no tenant (bd-9157r).
#
# The whole point of the engine is that a region appears in exactly one file, .claude/qa/config/tenants.yaml.
# This scans every executable line under bin/ hooks/ githooks/ scripts/ for the tenant names we know and for
# the retired hardcoded paths, ignoring comments, docstrings and the tests themselves. History citations
# (bead ids, PR numbers) in comments are fine — they explain WHY, they do not route anything.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
F=0
# tenant names and the paths that used to encode them
PAT='niete|NIETE|rumi-e2e|tests/features/whatsapp/niete|\.claude/qa/shared/(select_e2e|spec_sync|validate_specs|commit-e2e|run-suite|impact|scaffold-driver)|scripts/qa/(impact|install-hooks)|\.githooks|develop\|main\|staging'
scan() {  # $1 = file → prints offending "file:line: text" lines
  local f="$1"
  case "$f" in *test_*|*.test.*|*/tests/*) return 0;; esac
  # strip: bash/py comment lines, JS // and /* * lines, python docstring lines (heuristic: lines that are
  # inside a """ block — approximated by dropping lines that contain no code token before the match)
  awk -v pat="$PAT" '
    /^[[:space:]]*#/ {next}
    /^[[:space:]]*\/\// {next}
    /^[[:space:]]*\*/ {next}
    /^[[:space:]]*\/\*/ {next}
    /^"""/ {indoc=!indoc; next}
    /^[[:space:]]*"""/ && !/"""[^"]*"""/ {indoc=!indoc; next}
    indoc {next}
    $0 ~ pat { print FILENAME ":" NR ": " $0 }
  ' "$f"
}
while IFS= read -r f; do
  out=$(scan "$f" | grep -vE 'bd-[a-z0-9]+|PR #[0-9]+' || true)
  # strip trailing comments on code lines and re-test, so `foo() # see niete` is not a hit
  out=$(printf '%s\n' "$out" | awk -F'[[:space:]]#' '{print $1}' | grep -E "$PAT" || true)
  [ -n "$out" ] && { printf '  FAIL  tenant literal in engine code:\n%s\n' "$out"; F=$((F+1)); }
done <<EOF
$(find bin hooks githooks scripts -type f \( -name '*.py' -o -name '*.sh' -o -name '*.cjs' -o -name '*.js' -o -name '*.mjs' -o -name 'post-commit' -o -name 'pre-push' \) | LC_ALL=C sort)
EOF
[ "$F" = 0 ] && echo "no-tenant-literals: all ok" || { echo "no-tenant-literals: $F file(s) with literals"; exit 1; }
