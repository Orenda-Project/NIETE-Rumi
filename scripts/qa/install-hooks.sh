#!/bin/bash
# install-hooks.sh — point git at the repo's distributed hooks (.githooks/).
#
# Git will not run hooks from a tracked directory on its own: .githooks/ travels
# with the clone, but `core.hooksPath` is local config and has to be set on each
# machine. That is the one setup step the QA pipeline needs, and this script is
# it. Idempotent; safe to run from `npm install` (the root package.json `prepare`
# script does), from a fresh clone, or by hand.
#
#   bash scripts/qa/install-hooks.sh            # install (prints one line)
#   bash scripts/qa/install-hooks.sh --quiet    # same, silent — what `prepare` runs
#   bash scripts/qa/install-hooks.sh --force    # take over a foreign core.hooksPath
#   bash scripts/qa/install-hooks.sh --uninstall
#
# Never exits non-zero for a reason the developer did not cause (not a git repo,
# running in CI, hooksPath already set elsewhere): `npm install` must not fail
# because of a QA nicety.
QUIET=0; FORCE=0; UNINSTALL=0
for a in "$@"; do
  case "$a" in
    --quiet) QUIET=1 ;; --force) FORCE=1 ;; --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  esac
done
say() { [ "$QUIET" = "1" ] || echo "$@"; }
[ -n "${CI:-}" ] && exit 0                                   # CI clones never commit
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0  # not a repo (e.g. a tarball install)
[ -d "$ROOT/.githooks" ] || exit 0
cd "$ROOT" || exit 0
CUR=$(git config --get core.hooksPath 2>/dev/null)

if [ "$UNINSTALL" = "1" ]; then
  if [ "$CUR" = ".githooks" ]; then git config --unset core.hooksPath; say "qa hooks: uninstalled (core.hooksPath cleared)"; fi
  exit 0
fi
chmod +x .githooks/post-commit .githooks/pre-push 2>/dev/null
if [ "$CUR" = ".githooks" ]; then
  say "qa hooks: already installed (core.hooksPath = .githooks)"
  exit 0
fi
if [ -n "$CUR" ] && [ "$FORCE" != "1" ]; then
  echo "qa hooks: NOT installed — core.hooksPath is already '$CUR' (not ours)." >&2
  echo "          Re-run with --force to take it over, or call .githooks/post-commit and" >&2
  echo "          .githooks/pre-push from your own hooks. Nothing was changed." >&2
  exit 0
fi
git config core.hooksPath .githooks || exit 0
say "qa hooks: installed (core.hooksPath = .githooks) — commits now arm the targeted E2E + Gherkin sync"
exit 0
