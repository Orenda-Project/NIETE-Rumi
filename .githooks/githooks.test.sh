#!/bin/bash
# Tests for the distributed git hooks (.githooks/) and their installer.
#
# These hooks are what make the QA pipeline reach a developer who commits from a
# plain terminal, with no Claude Code session at all. Everything runs in a
# throwaway repo that carries COPIES of .claude/qa, .githooks and scripts/qa —
# the real repo is never committed to.
#
# Run:  bash .githooks/githooks.test.sh
set -u
cd "$(dirname "$0")/.." || exit 1
# The installer exits early under CI=… on purpose (CI clones never commit), so
# the suite must not inherit a CI=true environment. These cases test the
# installer's behaviour on a developer machine; give them that environment.
unset CI QA_HOOKS_OFF QA_HOOKS_QUIET QA_HOOKS_STRICT
ROOT="$PWD"
FAILED=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
say() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }
has() { case "$2" in *"$3"*) got=yes ;; *) got=no ;; esac; say "$1" "$got" "$4"; }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/githooks.XXXXXX"); trap 'rm -rf "$TMP"' EXIT
R="$TMP/clone with space"      # a path with spaces, like most real checkouts
mkdir -p "$R/bot/shared/services" "$R/tests/features/whatsapp" "$R/.claude" "$R/scripts"
cp -R "$ROOT/.claude/qa"   "$R/.claude/qa"
cp -R "$ROOT/.githooks"    "$R/.githooks"
mkdir -p "$R/.claude/hooks"; cp -R "$ROOT/.claude/hooks/lib" "$R/.claude/hooks/lib"
cp -R "$ROOT/scripts/qa"   "$R/scripts/qa"
cp -R "$ROOT/tests/features/whatsapp/niete" "$R/tests/features/whatsapp/niete"
rm -rf "$R/.claude/qa/results" "$R/.claude/.e2e-pending"
printf 'module.exports = { ROWS: ["Teacher Training"] };\n' > "$R/bot/shared/services/menu.service.js"
printf 'module.exports = { send: () => {} };\n' > "$R/bot/shared/services/whatsapp.service.js"
printf '# readme\n' > "$R/README.md"
git -C "$R" init -q -b develop
git -C "$R" config user.email t@l; git -C "$R" config user.name t
git -C "$R" add -A >/dev/null; git -C "$R" commit -qm baseline
PEND="$R/.claude/.e2e-pending"

echo "githooks — install"
out=$(cd "$R" && bash scripts/qa/install-hooks.sh 2>&1); rc=$?
say "installer exits 0" "$rc" "0"
say "core.hooksPath points at .githooks" "$(git -C "$R" config core.hooksPath)" ".githooks"
out=$(cd "$R" && bash scripts/qa/install-hooks.sh --quiet 2>&1); rc=$?
say "installer is idempotent and quiet" "$rc:$out" "0:"
git -C "$R" config core.hooksPath .somewhere-else
out=$(cd "$R" && bash scripts/qa/install-hooks.sh 2>&1); rc=$?
say "does not clobber a foreign hooksPath without --force" "$(git -C "$R" config core.hooksPath)" ".somewhere-else"
has "…and says so" "$out" "core.hooksPath" yes
(cd "$R" && bash scripts/qa/install-hooks.sh --force >/dev/null 2>&1)
say "--force takes it over" "$(git -C "$R" config core.hooksPath)" ".githooks"
[ -x "$R/.githooks/post-commit" ] && ok "post-commit is executable" || bad "post-commit is not executable"
[ -x "$R/.githooks/pre-push" ]   && ok "pre-push is executable"   || bad "pre-push is not executable"

echo "githooks — post-commit"
printf '// change\n' >> "$R/bot/shared/services/menu.service.js"
git -C "$R" add -A >/dev/null
err=$(git -C "$R" commit -qm "feat(menu): a mapped change" 2>&1); rc=$?
say "commit succeeds" "$rc" "0"
sha=$(git -C "$R" rev-parse --short=12 HEAD)
[ -f "$PEND/git-$sha.json" ] && ok "marker git-<sha>.json written" || bad "marker missing ($PEND)"
say "marker trigger is git-commit" "$(python3 -c "import json;print(json.load(open('$PEND/git-$sha.json'))['trigger'])" 2>/dev/null)" "git-commit"
has "marker selects menu" "$(cat "$PEND/git-$sha.json" 2>/dev/null)" '"/niete-e2e menu"' yes
say "marker is un-nudged" "$(python3 -c "import json;print(json.load(open('$PEND/git-$sha.json'))['nudged'])" 2>/dev/null)" "False"
[ -f "$PEND/git-$sha.sync.json" ] && ok "spec-sync brief written beside it" || bad "brief missing"
has "terminal output names the feature" "$err" "menu" yes
has "terminal output names the next command" "$err" "/sync-specs" yes
# PHASE 3: the marker pins the FULL sha (the mock lane starts the bot from it) and the terminal
# tells the developer the one command that tests this commit without a browser.
say "marker carries the full commit_sha" "$(python3 -c "import json;print(len(json.load(open('$PEND/git-$sha.json'))['commit_sha']))" 2>/dev/null)" "40"
has "terminal output names the mock lane" "$err" "commit-e2e.sh" yes

printf 'docs only\n' >> "$R/README.md"; git -C "$R" add -A >/dev/null
before=$(ls "$PEND" | wc -l | tr -d ' ')
err=$(git -C "$R" commit -qm "docs: readme" 2>&1)
say "docs-only commit writes no marker" "$(ls "$PEND" | wc -l | tr -d ' ')" "$before"
say "…and prints nothing" "$err" ""

printf '// again\n' >> "$R/bot/shared/services/menu.service.js"; git -C "$R" add -A >/dev/null
before=$(ls "$PEND" | wc -l | tr -d ' ')
QA_HOOKS_OFF=1 git -C "$R" commit -qm "feat(menu): switched off" 2>/dev/null
say "QA_HOOKS_OFF=1 silences the hook" "$(ls "$PEND" | wc -l | tr -d ' ')" "$before"

printf '// nopython\n' >> "$R/bot/shared/services/menu.service.js"; git -C "$R" add -A >/dev/null
err=$(cd "$R" && PATH=/usr/bin:/bin git commit -qm "feat(menu): no python3 on PATH" 2>&1); rc=$?
say "commit still succeeds with no python3 on PATH" "$rc" "0"
if command -v /usr/bin/python3 >/dev/null 2>&1; then ok "(python3 lives in /usr/bin here; the no-python message case is covered by the broken-selector case below)"; else has "…but says the hook was skipped instead of staying silent" "$err" "python3" yes; fi

cp "$R/.claude/qa/config/feature-map.yaml" "$TMP/feature-map.bak"
printf 'this: [is: not yaml\n' > "$R/.claude/qa/config/feature-map.yaml"
printf '// broken selector\n' >> "$R/bot/shared/services/menu.service.js"; git -C "$R" add -A >/dev/null
err=$(git -C "$R" commit -qm "feat(menu): selector cannot read the map" 2>&1); rc=$?
say "commit still succeeds when the selector fails" "$rc" "0"
has "a selector failure is REPORTED, not swallowed" "$err" "last-error.log" yes
[ -s "$PEND/last-error.log" ] && ok "selector stderr kept in .e2e-pending/last-error.log" || bad "last-error.log missing or empty"
cp "$TMP/feature-map.bak" "$R/.claude/qa/config/feature-map.yaml"; git -C "$R" add -A >/dev/null; git -C "$R" commit -qm "restore map" >/dev/null 2>&1

echo "githooks — pre-push"
base=$(git -C "$R" rev-list --max-parents=0 HEAD); head=$(git -C "$R" rev-parse HEAD)
out=$(cd "$R" && printf 'refs/heads/develop %s refs/heads/develop %s\n' "$head" "$base" | bash .githooks/pre-push origin https://example/x.git 2>&1); rc=$?
say "advisory pre-push exits 0" "$rc" "0"
has "names the affected feature" "$out" "menu" yes
has "flags the spec that was not touched" "$out" "menu.feature" yes
rc=$(cd "$R" && printf 'refs/heads/develop %s refs/heads/develop %s\n' "$head" "$base" | QA_HOOKS_STRICT=1 bash .githooks/pre-push origin x >/dev/null 2>&1; echo $?)
say "QA_HOOKS_STRICT=1 blocks a push whose specs are stale" "$rc" "1"
out=$(cd "$R" && printf 'refs/heads/sandbox %s refs/heads/sandbox %s\n' "$head" "$base" | bash .githooks/pre-push origin x 2>&1); rc=$?
say "push to sandbox (the landing branch since 2026-09-08) reports" "$rc" "0"
has "…and names the affected feature" "$out" "menu" yes
out=$(cd "$R" && printf 'refs/heads/feat %s refs/heads/feat-x %s\n' "$head" "$base" | bash .githooks/pre-push origin x 2>&1); rc=$?
say "feature-branch push reports too (PRs are opened from them and merged in the UI)" "$rc" "0"
has "…and names the affected feature" "$out" "menu" yes
zero=0000000000000000000000000000000000000000
out=$(cd "$R" && printf 'refs/heads/develop %s refs/heads/develop %s\n' "$head" "$zero" | bash .githooks/pre-push origin x 2>&1); rc=$?
say "first push of a branch (zero remote sha) does not crash" "$rc" "0"
git -C "$R" update-ref refs/remotes/origin/sandbox "$base"
out=$(cd "$R" && printf 'refs/heads/feat %s refs/heads/feat %s\n' "$head" "$zero" | bash .githooks/pre-push origin x 2>&1); rc=$?
say "first push of a feature branch measures against origin/sandbox" "$rc" "0"
has "…and names the affected feature" "$out" "menu" yes

echo "  ---"
if [ "$FAILED" -eq 0 ]; then echo "  all cases pass"; else echo "  $FAILED case(s) failing"; exit 1; fi
