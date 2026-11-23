#!/usr/bin/env bash
# promotion-invariant.sh: does <downstream> carry anything <upstream> does not already have?
#
#   bash scripts/ci/promotion-invariant.sh <upstream-ref> <downstream-ref>
#   e.g. bash scripts/ci/promotion-invariant.sh origin/staging origin/main
#        bash scripts/ci/promotion-invariant.sh origin/sandbox origin/staging
#
# The post-hoc backstop for the ladder sandbox -> staging -> main. The per-PR gates
# (main-source-branch.yml, staging-source-branch.yml) refuse a bad PR at the door; a bypass
# actor can still merge past them. This runs AFTER the push has landed on a protected branch
# and asks the SAME question over the whole branch, so an ignored red run is a permanent record
# that a toggled permission cannot erase.
#
# It delegates the provenance decision to scripts/ci/needs-upstream.sh — the one tested
# implementation of the ladder rule (tests/setup/needs-upstream.test.js) — by asking it whether
# every commit <downstream> has since it forked from <upstream> is sourced from <upstream>:
#
#     needs-upstream.sh <upstream> <upstream> <downstream>
#
# base == upstream, so the range is the whole of <downstream> back to the fork point. A commit
# counts as sourced if it is an ancestor of <upstream>, carries a `(cherry picked from commit X)`
# trailer naming an <upstream> ancestor, matches an <upstream> patch-id, or touches only files
# that end byte-identical to <upstream>'s copies. That is lane A and lane B alike (agreed
# 2026-11-04, bd-mft11s).
#
# It REPLACES `git merge-tree --write-tree <upstream> <downstream>`, which assumed lane A:
# <downstream> promoted from <upstream> as a whole branch, so the two trees had to match. Under
# lane B they hold different SUBSETS of the same work and their trees legitimately differ, so
# merge-tree went red on every honest cherry-pick (155 of 157 pushes to main, 6-18 Nov). The
# question was never "do the trees match" but "is every commit here sourced from the rung below",
# and only a per-commit provenance check answers that.
#
# Exit 0: clean. Exit 1: <downstream> carries unsourced content, each commit named. Exit 2: a
# ref did not resolve — a CI problem, never a pass. These are needs-upstream.sh's own codes,
# passed straight through.
set -uo pipefail

upstream="${1:-}"
downstream="${2:-}"
if [ -z "$upstream" ] || [ -z "$downstream" ]; then
  echo "usage: promotion-invariant.sh <upstream-ref> <downstream-ref>" >&2
  exit 2
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# needs-upstream.sh exits non-zero on a real finding; capture it in the `if` condition so the
# caller's `-e` (GitHub runs `run:` as `bash -eo pipefail`) does not abort before we can branch.
if out=$(bash "$here/needs-upstream.sh" "$upstream" "$upstream" "$downstream" 2>&1); then
  code=0
else
  code=$?
fi

up_name="${upstream#origin/}"
down_name="${downstream#origin/}"

if [ "$code" = 0 ]; then
  echo "OK — '$down_name' carries nothing that skipped '$up_name'."
  exit 0
fi

# A ref did not resolve: show why and keep the exit code. This is a CI problem, not a bypass,
# and must never read as a clean branch.
if [ "$code" = 2 ]; then
  printf '%s\n' "$out"
  exit 2
fi

# code == 1: real divergence. Show the offending commits (needs-upstream.sh names them), then
# the backstop-specific instruction, which the per-PR message does not carry.
printf '%s\n' "$out"
echo ""
echo "::error::'$down_name' carries content that never passed through '$up_name'."
echo ""
echo "The promotion path is one-way:  sandbox -> staging -> main"
echo ""
echo "Get the commits above onto '$up_name' — cherry-pick them there — so '$up_name' is once"
echo "more a superset of '$down_name' and the next promotion is clean."
echo ""
echo "Do NOT clear this by merging '$down_name' back into '$up_name'. A back-merge reconciles the"
echo "graph and HIDES the bypass, so the next one is just as invisible. This repo's own CLAUDE.md"
echo "says so."
exit 1
