#!/usr/bin/env bash
# commit-ledger-row.sh — commit the row an E2E run just appended to .claude/qa/ledgers/runs.jsonl, on the branch
# being tested, so the PR's "E2E run recorded" check sees it (operator, 15 Oct: a passing run left uncommitted showed
# as "missing" on the PR).
#
#   bash scripts/qa/commit-ledger-row.sh <repo> "<feature> <STATUS> <passed>/<total> (<run_id>)"
#
# Commits ONLY runs.jsonl (anything else staged or changed is left as it was), never pushes, and does nothing — saying
# why — on main / staging / sandbox / develop (shared branches: commit there by hand, through a PR) or a detached HEAD.
# Nothing new in runs.jsonl: no commit. E2E_NO_COMMIT=1 turns it off. Always exits 0: recording never fails a run.
set -uo pipefail
REPO="${1:?repo}"; WHAT="${2:-run}"
LEDGER=".claude/qa/ledgers/runs.jsonl"
say(){ printf '[commit-ledger-row] %s\n' "$*"; }

[ -n "${E2E_NO_COMMIT:-}" ] && { say "E2E_NO_COMMIT set: $LEDGER left uncommitted"; exit 0; }
branch="$(git -C "$REPO" symbolic-ref --quiet --short HEAD 2>/dev/null)" || { say "detached HEAD: commit $LEDGER yourself"; exit 0; }
case "$branch" in
  main|staging|sandbox|develop) say "on $branch (a shared branch): not committing $LEDGER here — commit it on your PR branch"; exit 0;;
esac
git -C "$REPO" diff --quiet -- "$LEDGER" 2>/dev/null && git -C "$REPO" diff --cached --quiet -- "$LEDGER" 2>/dev/null \
  && { say "no new row in $LEDGER: nothing to commit"; exit 0; }

# A pathspec commit takes only this file, whatever else is staged.
if git -C "$REPO" commit -q -m "test(e2e/web): record $WHAT" -- "$LEDGER" >/dev/null 2>&1; then
  say "committed $LEDGER on $branch ($(git -C "$REPO" rev-parse --short HEAD)) — push with the branch"
else
  say "could not commit $LEDGER on $branch: commit it yourself"
fi
exit 0
