#!/usr/bin/env bash
# e2e-mock.sh — the one command for the NIETE E2E suite on the mock lane + this run's own local database.
# Hermetic: run-suite.sh is replaced by a stub (E2E_MOCK_RUN_SUITE) that records its args and E2E_LOCAL_DB.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMD="$HERE/e2e-mock.sh"
fails=0
t() { if [ "$2" = "$3" ]; then echo "  ok  $1"; else echo "  FAIL $1: want [$3] got [$2]"; fails=$((fails+1)); fi; }
has() { case "$2" in *"$3"*) echo "  ok  $1";; *) echo "  FAIL $1: [$3] not in output:"; printf '%s\n' "$2" | sed 's/^/        /'; fails=$((fails+1));; esac; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
STUB="$tmp/run-suite.sh"
cat >"$STUB" <<SH
#!/usr/bin/env bash
echo "LOCAL_DB=\${E2E_LOCAL_DB:-unset} ARGS=\$*" >"$tmp/called"
SH
chmod +x "$STUB"
run() { rm -f "$tmp/called"; out=$(E2E_MOCK_RUN_SUITE="$STUB" bash "$CMD" "$@" 2>&1); rc=$?; called=$(cat "$tmp/called" 2>/dev/null); }

echo "AC1 no args → safe subset, mock lane, local DB"
run
t   "exit 0"                     "$rc" "0"
t   "run-suite args"             "$called" "LOCAL_DB=1 ARGS=safe --method mock"

echo "AC2 several features / all → parallel; one feature → not"
run training,menu
t   "two features in parallel"   "$called" "LOCAL_DB=1 ARGS=training,menu --method mock --parallel"
run all
t   "all in parallel"            "$called" "LOCAL_DB=1 ARGS=all --method mock --parallel"
run training
t   "one feature, no parallel"   "$called" "LOCAL_DB=1 ARGS=training --method mock"

echo "AC3 E2E_LOCAL_DB=0 is overridden"
rm -f "$tmp/called"; out=$(E2E_LOCAL_DB=0 E2E_MOCK_RUN_SUITE="$STUB" bash "$CMD" menu 2>&1); called=$(cat "$tmp/called")
t   "local DB forced on"         "$called" "LOCAL_DB=1 ARGS=menu --method mock"
has "says so"                    "$out" "E2E_LOCAL_DB=0 ignored"

echo "AC4 options pass through; --slot means one run, no parallel"
run coaching --only 'coaching=COA09,COA20'
t   "--only passes"              "$called" "LOCAL_DB=1 ARGS=coaching --method mock --only coaching=COA09,COA20"
run training,menu --commit abc123
t   "--commit passes"            "$called" "LOCAL_DB=1 ARGS=training,menu --method mock --parallel --commit abc123"
run training,menu --slot 3
t   "--slot drops parallel"      "$called" "LOCAL_DB=1 ARGS=training,menu --method mock --slot 3"

echo "AC5 --help and bad names"
run --help
t   "help exit 0"                "$rc" "0"
has "help shows usage"           "$out" "npm run e2e:mock"
t   "help runs nothing"          "$called" ""
run trainig
t   "unknown feature exit 2"     "$rc" "2"
has "names the bad feature"      "$out" "unknown feature: trainig"
t   "bad name runs nothing"      "$called" ""

echo "AC6 npm script + slash command call it"
ROOT="$(cd "$HERE/../.." && pwd)"
t   "npm e2e:mock"               "$(node -p "require('$ROOT/package.json').scripts['e2e:mock']")" "bash scripts/qa/e2e-mock.sh"
has "/e2e-mock command"          "$(cat "$ROOT/.claude/commands/e2e-mock.md" 2>/dev/null)" "bash scripts/qa/e2e-mock.sh \$ARGUMENTS"

echo
[ "$fails" = 0 ] && echo "e2e-mock: all passed" || { echo "e2e-mock: $fails failed"; exit 1; }
