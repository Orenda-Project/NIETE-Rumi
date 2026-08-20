#!/usr/bin/env bash
# Self-test for the data-standards wiring in this repo.
#
# Proves the behaviours we actually depend on, so they are repeatable rather than
# something a person verified once by hand:
#
#   1. the warn hook ignores anything that is not a gated git/gh operation
#   2. it word-boundary matches (prose about committing must not trip it)
#   3. a commit with nothing schema-relevant staged is silent
#   4. a violating migration WARNS but does not block (exit 0)
#   5. DATA_STANDARDS_BLOCK=1 promotes that same case to a hard block (exit 2)
#   6. a compliant migration is silent
#   7. .data-standards.json is honoured — the vendored skill's own deliberately
#      violating test fixtures are out of scope
#   8. the ownership receipt passes, and fails if the vendored skill is edited
#
# Usage:  ./scripts/data-standards-selftest.sh
# Exit:   0 all passed, 1 one or more failed
#
# Refuses to run with a dirty index, because cases 3-6 stage and unstage files
# and must never disturb someone's in-progress work.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 2

REPO="$(pwd)"
export CLAUDE_PROJECT_DIR="$REPO"
HOOK="$REPO/.claude/hooks/data-standards-warn.sh"
VALIDATOR="$REPO/.claude/skills/data-standards/scripts/validate_schema.py"
DETECTOR="$REPO/.claude/skills/data-standards/scripts/detect_schema_changes.py"
PROBE="infrastructure/supabase/migrations/V0.0.0__selftest_probe.sql"

if ! git diff --cached --quiet; then
    echo "REFUSING: you have staged changes. This test stages/unstages files and" >&2
    echo "must not disturb them. Commit or unstage first." >&2
    exit 2
fi

pass=0; fail=0
ok()   { printf '  PASS  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  FAIL  %s\n' "$1"; fail=$((fail+1)); }
check(){ [ "$2" = "$3" ] && ok "$1 (exit $3)" || bad "$1 (expected exit $3, got $2)"; }

fire() { echo "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$1\"}}" \
           | bash "$HOOK" >/tmp/ds-selftest.out 2>/tmp/ds-selftest.err; echo $?; }

cleanup() {
    git restore --staged "$PROBE" >/dev/null 2>&1
    rm -f "$PROBE" /tmp/ds-selftest.out /tmp/ds-selftest.err
}
trap cleanup EXIT

echo "data-standards self-test"
echo

# 1 + 2 — the hook must be inert on anything it does not gate.
check "non-git command ignored"            "$(fire 'npm test')" 0
check "prose about committing ignored"     "$(fire 'echo \"about to git commitment\"')" 0

# 3 — gated command, but nothing schema-relevant staged.
check "commit with no schema staged"       "$(fire 'git commit -m x')" 0
[ -s /tmp/ds-selftest.err ] && bad "…and it should have been silent" || ok "…and it was silent"

# 4 + 5 — a violating migration warns, and only blocks when asked to.
cat > "$PROBE" <<'SQL'
CREATE TABLE selftest_probe (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER,
  created_at TIMESTAMP
);
SQL
git add "$PROBE"
code=$(fire 'git commit -m x')
check "violating migration warns, does not block" "$code" 0
grep -q "DATA STANDARDS (warn" /tmp/ds-selftest.err \
    && ok "…and it printed the findings" || bad "…but printed no warning"

code=$(DATA_STANDARDS_BLOCK=1 bash -c "echo '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m x\"}}' | bash '$HOOK' >/dev/null 2>&1"; echo $?)
check "DATA_STANDARDS_BLOCK=1 promotes to a block" "$code" 2

# 4b — committing from a SUBDIRECTORY must report the same findings.
# The validator fails open on a path it cannot read, and `git diff --cached`
# emits repo-root-relative paths from anywhere in the tree — so before the hook
# anchored cwd at the repo root, a commit from bot/ printed nothing at all for a
# migration with four findings. Devs commit from subdirectories constantly, and
# this silently passed rather than erroring, so it is pinned here.
root_n=$(echo "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m x\"}}" \
           | bash "$HOOK" 2>&1 | grep -cE '^- \*\*D')
for sub in bot dashboard infrastructure/supabase/migrations; do
    sub_n=$( (cd "$REPO/$sub" && echo "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m x\"}}" \
               | bash "$HOOK" 2>&1 | grep -cE '^- \*\*D') )
    [ "$sub_n" = "$root_n" ] \
        && ok "same findings from $sub/ as from the root ($root_n)" \
        || bad "findings differ from $sub/ ($sub_n) vs root ($root_n) — validator failing open"
done

# 6 — the compliant shape documented in docs/data-standards.md must be silent.
cat > "$PROBE" <<'SQL'
-- V0.0.0 — selftest probe. Flyway migration.
-- Rollback: DROP TABLE selftest_probe;
CREATE TABLE selftest_probe (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL
git add "$PROBE"
check "compliant migration is silent"      "$(fire 'git commit -m x')" 0
grep -q "DATA STANDARDS" /tmp/ds-selftest.err \
    && bad "…but it warned anyway" || ok "…and produced no warning"
git restore --staged "$PROBE" >/dev/null 2>&1; rm -f "$PROBE"

# 7 — scoping: the vendored skill's own violating fixtures must be out of scope.
n=$(python3 "$DETECTOR" --files \
      .claude/skills/data-standards/evals/fixtures/violating_migration.sql \
    | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["relevant"]))')
[ "$n" = "0" ] && ok "vendored test fixtures excluded by .data-standards.json" \
               || bad "vendored test fixtures are in scope (got $n relevant)"

# 8 — the ownership receipt, in both directions.
if ./scripts/data-standards-verify.sh >/dev/null 2>&1; then
    ok "vendored skill matches its receipt"
else
    bad "vendored skill does not match its receipt"
fi
TARGET=".claude/skills/data-standards/scripts/audit.py"
cp "$TARGET" /tmp/ds-selftest-orig.py
printf '\n# selftest tamper\n' >> "$TARGET"
if ./scripts/data-standards-verify.sh >/dev/null 2>&1; then
    bad "receipt did NOT detect a tampered vendored file"
else
    ok "receipt detects a tampered vendored file"
fi
cp /tmp/ds-selftest-orig.py "$TARGET"; rm -f /tmp/ds-selftest-orig.py

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
