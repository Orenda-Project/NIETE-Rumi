#!/usr/bin/env bash
# Red-first (bd-yjyn0): the mock coaching lane must archive prior history so the analysis cassette
# is deterministic. On the buggy predicate the mock/named-coaching/cassette-off case returns SKIP.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$DIR/reset-history-decision.sh"
fail=0
ok() { if "$@"; then echo "ok   should_reset_history $*"; else echo "FAIL (expected reset) should_reset_history $*"; fail=1; fi; }
no() { if "$@"; then echo "FAIL (expected skip)  should_reset_history $*"; fail=1; else echo "ok   should_reset_history $*"; fi; }

# method  mode      cassette
ok should_reset_history mock   coaching off            # THE BUG: mock lane is always cassette-backed
ok should_reset_history mock   safe     off            # any mock run
ok should_reset_history chrome all      off            # full run
ok should_reset_history chrome coaching replay-strict  # cassette explicitly on
ok should_reset_history chrome coaching replay
no should_reset_history chrome coaching off            # chrome named run, no cassette → live, keep history
no should_reset_history chrome safe     off

if [ "$fail" = 0 ]; then echo "PASS reset-history-decision"; else echo "FAILED reset-history-decision"; fi
exit "$fail"
