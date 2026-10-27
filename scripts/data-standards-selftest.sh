#!/usr/bin/env bash
# The warn shim this exercised was retired (bd-lw1r7.8.1): the vendored gate is
# registered directly through .claude/hooks/data-standards-schema-change-gate.sh,
# and its tests live beside it. Kept as a pointer so old habits still run them.
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.claude/hooks/data-gates.test.sh" "$@"
