#!/usr/bin/env bash
# e2e-autorun.walkthrough.sh — experience the commit -> E2E flow BEFORE merging it.
#
# The hook pair is registered in THIS WORKTREE's .claude/settings.json and nowhere
# else, so a Claude Code session started here has it live while every other agent
# on the machine is untouched. That is the whole point: you get to feel the flow
# without putting it on `main` first.
#
#   bash .claude/hooks/e2e-autorun.walkthrough.sh          # set up + print the steps
#   bash .claude/hooks/e2e-autorun.walkthrough.sh --clean   # remove the fixture
#
# WHY A FIXTURE REPO. The targeted selection maps NIETE-Rumi source paths
# (`bot/shared/services/menu.service.js` -> `menu`). This workspace repo has no
# such paths, so a commit here selects nothing and the hook correctly stays quiet.
# To see a REAL feature name you need a repo shaped like NIETE-Rumi — either a
# fresh clone of Orenda-Project/NIETE-Rumi, or this throwaway, which is enough to
# exercise the map, the marker and the Stop block.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIXTURE="$ROOT/.claude/.e2e-walkthrough/NIETE-Rumi"

if [ "${1:-}" = "--clean" ]; then
  rm -rf "$ROOT/.claude/.e2e-walkthrough" "$ROOT/.claude/.e2e-pending"
  echo "walkthrough: fixture + markers removed."
  exit 0
fi

rm -rf "$FIXTURE"; mkdir -p "$FIXTURE"
cd "$FIXTURE" || exit 1
git init -q .
git config user.email walkthrough@local
git config user.name walkthrough
mkdir -p bot/shared/services
printf 'module.exports = { renderMenu: () => "menu v1" };\n' > bot/shared/services/menu.service.js
git add -A
git commit -qm "baseline"
# The change the walkthrough will commit — staged, so the only thing left to do
# inside the session is the `git commit` that trips the hook.
printf 'module.exports = { renderMenu: () => "menu v2" };\n' > bot/shared/services/menu.service.js
git add -A

echo
echo "  Fixture ready: a NIETE-shaped repo with one staged change to"
echo "  bot/shared/services/menu.service.js  ->  the map selects: menu"
echo
echo "  ── Now experience it ──────────────────────────────────────────────"
echo
echo "  1. Open an interactive session IN THIS WORKTREE (the hook is live here,"
echo "     and only here):"
echo
echo "       cd \"$ROOT\" && claude"
echo
echo "  2. Inside that session, ask it to commit the staged change — note the"
echo "     \`cd\` form, it matters (see the caveat at the bottom):"
echo
echo "       run: cd \".claude/.e2e-walkthrough/NIETE-Rumi\" && git commit -m \"fix(menu): tweak the menu renderer\""
echo
echo "  3. Watch for three things, in order:"
echo "       a. the commit runs"
echo "       b. an ORDER appears naming  /niete-e2e menu  — plus the line saying"
echo "          this cannot test what was just committed (nothing is deployed)"
echo "       c. if the session tries to end without driving it, the Stop hook"
echo "          refuses ONCE and repeats the order"
echo
echo "  4. From there it is the normal /niete-e2e flow: it needs a linked"
echo "     web.whatsapp.com session in Chrome and will ask you for the driver"
echo "     number. On a QR screen it stops rather than faking a pass."
echo
echo "  ── Variants worth trying ─────────────────────────────────────────"
echo "     export E2E_AUTORUN_ALL=1   arms /niete-e2e all instead (99 scenarios,"
echo "                                hours) — set it BEFORE starting claude"
echo "     export E2E_AUTORUN_OFF=1   arms nothing at all"
echo "     a commit with no mapped files -> stays silent, no block"
echo
echo "  ── NOTE: \`git -C \"<path with spaces>\" commit\` and \`cd <repo> && git commit\` both arm ──"
echo "     The shared matcher in lib/git-push-match.sh accepts quoted option values"
echo "     since 2026-09-07 (it used to miss any quoted argument containing a space,"
echo "     which is most checkouts of this repo). lib/git-push-match.test.sh pins it."
echo
echo "  Clean up:  bash .claude/hooks/e2e-autorun.walkthrough.sh --clean"
echo
