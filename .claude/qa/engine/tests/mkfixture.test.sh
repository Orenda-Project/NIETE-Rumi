#!/usr/bin/env bash
# mkfixture.test.sh — both fixture shapes build, carry a manifest the reader accepts, and are git repos (bd-9157r).
set -uo pipefail
cd "$(dirname "$0")" || exit 1
F=0; ok(){ printf '  ok    %s\n' "$1"; }; bad(){ printf '  FAIL  %s\n' "$1"; F=$((F+1)); }
for shape in niete rumi; do
  D=$(mktemp -d)
  bash ./mkfixture.sh "$shape" "$D" >/dev/null || bad "mkfixture $shape exited non-zero"
  [ -L "$D/.claude/qa/engine" ] && ok "$shape: engine symlinked" || bad "$shape: no engine symlink"
  [ -f "$D/.claude/qa/config/tenants.yaml" ] && ok "$shape: manifest" || bad "$shape: no manifest"
  suite=$(python3 "$D/.claude/qa/engine/bin/tenants_lite.py" --root "$D" --get spec_suite 2>/dev/null)
  [ -n "$suite" ] && ok "$shape: manifest parses (suite=$suite)" || bad "$shape: tenants_lite cannot read the manifest"
  [ -f "$D/tests/features/whatsapp/$suite/menu.feature" ] && ok "$shape: spec in suite $suite" || bad "$shape: spec missing for suite $suite"
  head -3 "$D/.claude/qa/shared/features/menu.cjs" | grep -q '@mock-lane' && ok "$shape: mock driver marker" || bad "$shape: driver lacks @mock-lane"
  git -C "$D" log --oneline 2>/dev/null | grep -q baseline && ok "$shape: baseline commit" || bad "$shape: no baseline commit"
  n=$(python3 "$D/.claude/qa/engine/bin/tenants_lite.py" --root "$D" --list-tenants 2>/dev/null | wc -l | tr -d ' ')
  case "$shape:$n" in niete:1|rumi:5) ok "$shape: $n tenant(s)";; *) bad "$shape: expected tenants, got '$n'";; esac
  # the fixture's hook shims must reach the engine's hooks
  [ -x "$D/.claude/hooks/e2e-autorun.sh" ] && grep -q 'qa/engine/hooks/e2e-autorun.sh' "$D/.claude/hooks/e2e-autorun.sh" && ok "$shape: hook shim" || bad "$shape: hook shim wrong"
  rm -rf "$D"
done
[ "$F" = 0 ] && echo "mkfixture: all ok" || { echo "mkfixture: $F failure(s)"; exit 1; }
