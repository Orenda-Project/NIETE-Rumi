#!/usr/bin/env bash
# bd-snkn32.4 load check: gzipped size of the portal's entry chunk and LessonsPage chunk,
# this branch vs origin/sandbox. Usage: load-check.sh <worktree>
set -e
W="$(cd "$1" && pwd)"; BASE="$W/../_q36-sandbox-build"
sizes() { # $1 = dist/assets dir
  for f in "$1"/index-*.js "$1"/LessonsPage-*.js; do
    [ -f "$f" ] && printf '%-28s %s\n' "$(basename "$f" | sed 's/-[A-Za-z0-9_]*\.js$//')" "$(gzip -9c "$f" | wc -c | tr -d ' ')"
  done
}
(cd "$W/portal" && npm run -s build >/dev/null 2>&1)
git -C "$W" worktree add -f --detach "$BASE" origin/sandbox >/dev/null 2>&1
ln -sfn "$W/portal/node_modules" "$BASE/portal/node_modules"
(cd "$BASE/portal" && npm run -s build >/dev/null 2>&1)
echo "== origin/sandbox"; sizes "$BASE/portal/dist/assets"
echo "== this branch";    sizes "$W/portal/dist/assets"
git -C "$W" worktree remove --force "$BASE"
