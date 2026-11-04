#!/usr/bin/env bash
# needs-upstream.sh: every commit a pull request adds must already be on <upstream>.
#
#   bash scripts/ci/needs-upstream.sh <upstream-ref> <base-sha> <head-sha>
#   e.g. bash scripts/ci/needs-upstream.sh origin/staging "$BASE_SHA" "$HEAD_SHA"
#
# The rule behind `main needs staging` (.github/workflows/main-source-branch.yml). Content
# moves down the ladder sandbox -> staging -> main one rung at a time, so a PR into main may
# only carry what staging already has. HOW it arrives does not matter: a PR from `staging`
# itself (lane A) and per-feature `git cherry-pick -x` picks onto a branch off main (lane B)
# both pass. Agreed 2026-11-04 (bd-mft11s).
#
# A commit counts as already upstream if, tried in order:
#   (0) it is an ancestor of <upstream>. One rev-list drops all of those at once;
#   (1) its `(cherry picked from commit X)` trailer, which `cherry-pick -x` writes, names an X
#       that is an ancestor of <upstream>. Exact, and it survives conflict resolution;
#   (2) `git cherry` finds the same patch on <upstream>: a pick done without -x;
#   (3) every file it touches ends up byte-identical to <upstream>'s copy (or absent from both).
#       That is an integration commit copying staging's version of a file, so it carries
#       nothing <upstream> lacks. Each one is listed, so a reviewer sees it.
# (0)-(2) are the three tests `staging needs sandbox` (staging-source-branch.yml) runs, one
# rung up. Merge commits are skipped, as there: a merge's own conflict resolution is not
# judged here. promotion-invariant.yml checks the RESULT on main after every push.
#
# Exit 0: every commit is upstream. Exit 1: at least one is not, and each is named.
# Exit 2: a ref could not be resolved. That is a CI problem, never a pass.
set -euo pipefail

upstream="${1:-}"
base="${2:-}"
head="${3:-}"
if [ -z "$upstream" ] || [ -z "$base" ] || [ -z "$head" ]; then
  echo "usage: needs-upstream.sh <upstream-ref> <base-sha> <head-sha>" >&2
  exit 2
fi
for ref in "$upstream" "$base" "$head"; do
  if ! git rev-parse -q --verify "${ref}^{commit}" >/dev/null; then
    echo "::error::could not resolve '$ref', so this check cannot evaluate the PR. A CI problem, not a pass."
    exit 2
  fi
done
name="${upstream#origin/}"

# Every file the commit touches is byte-identical to the upstream copy, or absent from both.
matches_upstream() {
  local c="$1" p mine theirs
  while IFS= read -r -d '' p; do
    mine=$(git rev-parse -q --verify "${c}:${p}" 2>/dev/null || true)
    theirs=$(git rev-parse -q --verify "${upstream}:${p}" 2>/dev/null || true)
    if [ "$mine" != "$theirs" ]; then
      return 1
    fi
  done < <(git diff-tree --no-commit-id --name-only -r -z "$c")
  return 0
}

if ! mb=$(git merge-base "$base" "$head"); then
  echo "::error::'$base' and '$head' share no history, so this check cannot evaluate the PR. A CI problem, not a pass."
  exit 2
fi
new=$(git rev-list --no-merges --reverse "${mb}..${head}" "^${upstream}")              # (0)
if [ -z "$new" ]; then
  echo "Every commit this PR adds is already on '$name'. OK."
  exit 0
fi

# Matched with bash, not `printf | grep -q`: under pipefail an early grep exit can SIGPIPE the
# printf and turn a match into a failure.
cherry=$'\n'"$(git cherry "$upstream" "$head" "$mb")"$'\n'
missing=""
copied=""
for c in $new; do
  picked=$(git log -1 --format=%B "$c" \
    | grep -oE '\(cherry picked from commit [0-9a-f]{7,40}\)' \
    | grep -oE '[0-9a-f]{7,40}' | tail -1 || true)
  if [ -n "$picked" ] && git merge-base --is-ancestor "$picked" "$upstream" 2>/dev/null; then
    continue                                                                            # (1)
  fi
  if [[ "$cherry" == *$'\n'"- ${c}"$'\n'* ]]; then
    continue                                                                            # (2)
  fi
  if matches_upstream "$c"; then
    copied="${copied}  $(git log -1 --format='%h %s' "$c")"$'\n'                         # (3)
    continue
  fi
  missing="${missing}  $(git log -1 --format='%h %s' "$c")"$'\n'
done

if [ -n "$copied" ]; then
  echo "Accepted because every file they touch matches '$name' exactly (integration commits):"
  printf '%s' "$copied"
  echo ""
fi

if [ -z "$missing" ]; then
  echo "Every commit this PR adds is on '$name' (by -x trailer, patch-id or matching files). OK."
  exit 0
fi

n=$(printf '%s' "$missing" | grep -c .)
echo "::error::$n commit(s) in this PR are not on '$name'. The route is sandbox -> staging -> main."
echo ""
echo "Not on ${upstream}:"
printf '%s' "$missing"
echo ""
echo "Land the change on '$name' first (cherry-picked there from sandbox), then pick it onto"
echo "your branch WITH -x and push again:"
echo "    git cherry-pick -x <sha-as-merged-on-$name>        # add -m 1 to pick a merge commit"
echo "The '(cherry picked from commit ...)' trailer is what this check reads."
echo ""
echo "An outage fix that must skip '$name' is merged past this check by a named release owner"
echo "and back-filled to '$name' and sandbox the same day. Do not make the check quieter."
exit 1
