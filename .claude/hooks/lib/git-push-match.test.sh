#!/bin/bash
# Unit matrix for lib/git-push-match.sh — the matcher every QA trigger shares
# (Claude PostToolUse hook, git post-commit/pre-push hooks, CI impact script).
#
# Run:  bash .claude/hooks/lib/git-push-match.test.sh
#
# The two QUOTED-ARGUMENT cases exist because of a real miss (2026-09-06): the
# option-value token was `[^[:space:]]+`, so `git -c user.name="Mah Noor" commit`
# and `git -C "/path with spaces" commit` both matched NOTHING and the hook stayed
# silent with no warning. This repo's own checkout path has spaces on most
# developer machines, so the `-C` form is not exotic.
set -u
cd "$(dirname "$0")/../../.." || exit 1
. .claude/hooks/lib/git-push-match.sh

FAILED=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
expect() {  # $1 label  $2 cmd  $3 commit(Y/n)  $4 push(Y/n)  $5 deploy(Y/n)
  local c p d
  is_git_commit "$2" && c=Y || c=n
  is_git_push "$2" && p=Y || p=n
  push_targets_deploy_branch "$2" && d=Y || d=n
  if [ "$c$p$d" = "$3$4$5" ]; then ok "$1"; else bad "$1  (got commit=$c push=$p deploy=$d, want $3/$4/$5)"; fi
}

echo "git-push-match — trigger matrix"
expect "plain commit"                        'git commit -m x'                                              Y n n
expect "cd && add && commit"                 'cd x && git add f && git commit -q -m t'                      Y n n
expect "inline env prefix"                   'SKIP_QA=1 git commit -m t'                                    Y n n
expect "-c unquoted value"                   'git -c user.name=MahNoor commit -m t'                          Y n n
expect "-c DOUBLE-QUOTED value with space"   'git -c user.name="Mah Noor" commit -m t'                       Y n n
expect "-C double-quoted path with spaces"   'git -C "/Users/x/Rumi 10 April 2026/NIETE-Rumi" commit -m t'   Y n n
expect "-C single-quoted path with spaces"   "git -C '/p a t h' add -A && git -C '/p a t h' commit -m t"     Y n n
expect "merge counts as commit"              'git merge -q --ff-only origin/develop'                         Y n n
expect "commit-tree is not a commit"         'git commit-tree HEAD^{tree}'                                   n n n
expect "mergetool is not a merge"            'git mergetool'                                                 n n n
expect "quoted mention is not a commit"      'echo "git commit"'                                             n n n
expect "push to develop"                     'git push origin develop'                                        n Y Y
expect "push HEAD:develop refspec"           'git push origin HEAD:develop'                                   n Y Y
expect "push to main with env prefix"        'SKIP_QA=1 git push origin main'                                n Y Y
expect "push -C quoted path to develop"      'git -C "/a b/NIETE-Rumi" push origin develop'                  n Y Y
expect "push to feature branch"              'git push origin bd-1234-feature'                                n Y n
expect "push -u feature branch"              'git push -u origin qa/self-contained'                          n Y n
expect "gh pr merge is nothing"              'gh pr merge 730 --squash'                                       n n n

# ── resolver: an explicit -C with a SPACED path names the repo ───────────────
TMP=$(mktemp -d "${TMPDIR:-/tmp}/gpm.XXXXXX"); trap 'rm -rf "$TMP"' EXIT
A="$TMP/repo a"; B="$TMP/other"
mkdir -p "$A" "$B"; git -C "$A" init -q; git -C "$B" init -q
got=$(e2e_resolve_repo "git -C \"$A\" commit -m t" "$B")
[ "$got" = "$(cd "$A" && pwd -P)" ] || [ "$got" = "$A" ] && ok "resolver: -C \"<spaced path>\" wins over payload cwd" \
  || bad "resolver: -C spaced path (got '$got', want '$A')"
got=$(e2e_resolve_repo "cd \"$A\" && git commit -m t" "$B")
[ "$got" = "$(cd "$A" && pwd -P)" ] || [ "$got" = "$A" ] && ok "resolver: cd \"<spaced path>\" wins over payload cwd" \
  || bad "resolver: cd spaced path (got '$got', want '$A')"

echo "  ---"
if [ "$FAILED" -eq 0 ]; then echo "  all cases pass"; else echo "  $FAILED case(s) failing"; exit 1; fi
