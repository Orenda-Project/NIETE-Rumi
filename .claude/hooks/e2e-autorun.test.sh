#!/usr/bin/env bash
# Behaviour matrix for the E2E auto-run pair (bd-43512):
#
#   e2e-autorun.sh       PostToolUse on Bash — ARMS a run after a deploying push
#   e2e-autorun-stop.sh  Stop            — ENFORCES it before the turn can end
#
#   bash .claude/hooks/e2e-autorun.test.sh
#
# WHY TWO HOOKS. The docs are explicit that a PostToolUse hook "cannot cause
# Claude to run a different command" — it can only allow/deny/ask or supply
# `additionalContext`. So PostToolUse alone is a suggestion. The `Stop` hook is
# the one event that can genuinely compel: `{"decision":"block","reason":...}`
# refuses to let the turn end and feeds the reason back. Arm on push, enforce on
# stop.
#
# THE FAILURE MODE THIS FILE EXISTS TO PREVENT is an infinite Stop loop. If the
# E2E cannot run (no linked WhatsApp Web session, say) and Stop blocks forever,
# the session wedges and someone rips the hook out. `nudges once, then lets go`
# is tested below and is not optional.
#
# Like `pre-push-qa-check.test.sh`, the trigger words are assembled at runtime
# (`G="git"; P="push"`) — this file is read by hooks that match on that phrase.
set -u
cd "$(dirname "$0")/../.." || exit 1

ARM=".claude/hooks/e2e-autorun.sh"
STOP=".claude/hooks/e2e-autorun-stop.sh"
SESSION="test-session-bd43512"
PENDING=".claude/.e2e-pending/$SESSION.json"
SYNC=".claude/.e2e-pending/$SESSION.sync.json"

G="git"; P="push"
FAILED=0

# QUARANTINE real git-armed markers for the duration of the run. The Stop hook
# adopts an un-nudged `git-<sha>.json` left by a terminal commit (.githooks/
# post-commit), so a developer with pending QA work would see every "stays
# silent" case below fail for a reason that has nothing to do with the hooks.
# They are moved aside, never deleted, and put back on exit.
QUAR=$(mktemp -d "${TMPDIR:-/tmp}/e2e-quar.XXXXXX")
mkdir -p .claude/.e2e-pending
for f in .claude/.e2e-pending/git-*.json; do [ -e "$f" ] && mv "$f" "$QUAR/"; done 2>/dev/null
cleanup() { rm -f "$PENDING" "$SYNC"; }
# `cleanup` is also called between sections, so the restore lives in its own
# EXIT-only function — restoring early would hand the marker straight back to the
# Stop hook mid-run. The named fixture sessions' briefs are litter; remove them.
restore_quarantine() {
  cleanup
  rm -f .claude/.e2e-pending/*-session.sync.json .claude/.e2e-pending/*-session.json 2>/dev/null
  for f in "$QUAR"/git-*.json; do [ -e "$f" ] && mv "$f" .claude/.e2e-pending/; done 2>/dev/null
  rm -rf "$QUAR"
}
trap restore_quarantine EXIT
cleanup

# Feed a PostToolUse payload to the arming hook.
arm() {
  local cmd="$1" files="${2:-bot/shared/services/menu.service.js}"
  E2E_SELECT_FILES="$files" \
  python3 -c '
import json,sys
print(json.dumps({"session_id": sys.argv[1], "cwd": ".",
                  "tool_name": "Bash",
                  "tool_input": {"command": sys.argv[2]},
                  "tool_response": {"stdout": "", "stderr": "", "interrupted": False}}))
' "$SESSION" "$cmd" | E2E_SELECT_FILES="$files" bash "$ARM" 2>/dev/null
}

stop_hook() {
  python3 -c '
import json,sys
print(json.dumps({"session_id": sys.argv[1], "cwd": ".", "hook_event_name": "Stop"}))
' "$SESSION" | bash "$STOP" 2>/dev/null
}

say() {
  local label="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$label"
  else
    printf '  FAIL  %s (got %s, want %s)\n' "$label" "$got" "$want"
    FAILED=$((FAILED + 1))
  fi
}

has() {  # label, haystack, needle, yes|no
  local label="$1" hay="$2" needle="$3" want="$4" got=no
  case "$hay" in *"$needle"*) got=yes ;; esac
  say "$label" "$got" "$want"
}

marker_exists() { [ -f "$PENDING" ] && echo yes || echo no; }

echo "e2e-autorun — arm/enforce matrix"

echo " arming (PostToolUse)"

cleanup
OUT=$(arm "$G $P origin develop")
say  "arms on a push to develop"                 "$(marker_exists)"  yes
has  "emits additionalContext"        "$OUT" '"additionalContext"'   yes
has  "names the targeted command"     "$OUT" "/niete-e2e menu"       yes
has  "push: warns the deploy may not be live" "$OUT" "DEPLOY IS LIVE"  yes
has  "push: leads with the execute order"    "$OUT" "EXECUTE THE TARGETED E2E NOW" yes
has  "declares the hook event"        "$OUT" '"PostToolUse"'         yes

# A feature-branch push deploys nothing, so there is no new build to drive.
cleanup
OUT=$(arm "$G $P origin bd-1234-some-branch")
say  "does NOT arm on a feature branch"          "$(marker_exists)"  no
has  "...and stays silent"             "$OUT" "additionalContext"    no

cleanup
OUT=$(arm "$G $P origin develop" "README.md")
say  "does NOT arm on a docs-only push"          "$(marker_exists)"  no

cleanup
OUT=$(arm "ls -la")
say  "does NOT arm on a non-push"                "$(marker_exists)"  no

cleanup
OUT=$(E2E_AUTORUN_OFF=1 arm "$G $P origin develop")
say  "E2E_AUTORUN_OFF=1 disarms"                 "$(marker_exists)"  no

# PostToolUse runs AFTER the tool. It must never fail the turn, whatever happens.
cleanup
arm "$G $P origin develop" >/dev/null 2>&1
say  "arming hook exits 0"                       "$?"                0

cleanup
arm "$G $P origin develop" >/dev/null
bash "$ARM" --clear --session "$SESSION" >/dev/null 2>&1
say  "--clear removes the marker"                "$(marker_exists)"  no

echo " enforcing (Stop)"

cleanup
OUT=$(stop_hook)
has  "silent with no marker"           "$OUT" "decision"             no

cleanup
arm "$G $P origin develop" >/dev/null
OUT=$(stop_hook)
has  "blocks the stop when armed"      "$OUT" '"block"'              yes
has  "reason names the command"        "$OUT" "/niete-e2e menu"      yes

# THE LOOP GUARD. One nudge, then it lets go. A Stop hook that blocks forever
# wedges the session and gets deleted, taking the whole feature with it.
OUT=$(stop_hook)
has  "does NOT block a second time"    "$OUT" '"block"'              no
say  "marker survives for visibility"            "$(marker_exists)"  yes

# A marker belonging to another session must not block this one.
cleanup
arm "$G $P origin develop" >/dev/null
OUT=$(python3 -c '
import json
print(json.dumps({"session_id": "some-other-session", "cwd": ".",
                  "hook_event_name": "Stop"}))
' | bash "$STOP" 2>/dev/null)
has  "ignores another session's marker" "$OUT" '"block"'             no

cleanup
arm "$G $P origin develop" >/dev/null
OUT=$(E2E_AUTORUN_OFF=1 stop_hook)
has  "E2E_AUTORUN_OFF=1 disables Stop"  "$OUT" '"block"'             no

# ─────────────────────────────────────────────────────────────────────────────
# ENV-PREFIXED PUSHES. `SKIP_QA=1 git push origin develop` is the single most
# common real push in this repo — the pre-push gate's own block message tells you
# to type it. The matcher anchored `git` to a command boundary (`^`, `;`, `&&`,
# `|`), and a leading `VAR=1 ` is none of those, so every bypassed push was
# invisible to the auto-run: it would have armed on approximately nothing.
#
# Missed until a post-merge walkthrough, because the pre-push gate handles
# SKIP_QA *before* the matcher runs, so nothing else ever exercised this shape.
echo " env-prefixed pushes"

. .claude/hooks/lib/git-push-match.sh

match_case() {
  local label="$1" cmd="$2" want="$3" got=no
  is_git_push "$cmd" && got=yes
  say "$label" "$got" "$want"
}

match_case "bare push"                  "$G $P origin develop"                    yes
match_case "SKIP_QA=1 prefix"           "SKIP_QA=1 $G $P origin develop"          yes
match_case "two env assignments"        "A=1 B=2 $G $P origin develop"            yes
match_case "cd && env prefix"           "cd x && SKIP_QA=1 $G $P origin develop"  yes
match_case "cd && bare push"            "cd x && $G $P origin develop"            yes
# Still must NOT match prose that merely mentions it.
match_case "prose mention"              "echo about $G $P workflows"              no

# ...and the arming hook must actually arm on the bypassed form.
cleanup
OUT=$(arm "SKIP_QA=1 $G $P origin develop")
say  "arms on SKIP_QA=1 push"                    "$(marker_exists)"  yes
has  "...with the right command"       "$OUT" "/niete-e2e menu"      yes
cleanup

# ─────────────────────────────────────────────────────────────────────────────
# REPO RESOLUTION for `cd <dir> && git push`.
#
# The `cd` extraction used BRE `\?`, which GNU sed accepts and BSD sed (macOS,
# where this repo lives) does NOT. It therefore matched nothing, silently, in
# every case — so `cd NIETE-Rumi && git push origin develop` was diffed against
# whatever the payload cwd happened to be, i.e. the wrong repository. Found by
# walking through what actually happens after a merge; no test covered it.
echo " repo resolution (cd <dir> && push)"

RTMP=$(mktemp -d 2>/dev/null || mktemp -d -t e2eres)
# A path WITH A SPACE, because the real one is "Rumi 10 April 2026/NIETE-Rumi".
TARGET="$RTMP/some dir/inner-repo"
mkdir -p "$TARGET"
git init -q "$TARGET" 2>/dev/null

res_case() {
  local label="$1" cmd="$2" want="$3"
  local got; got=$(e2e_resolve_repo "$cmd" "$RTMP")
  # macOS resolves /var -> /private/var; compare basenames to stay honest but stable
  say "$label" "$(basename "$got")" "$want"
}

res_case "unquoted cd"    "cd $TARGET && $G $P origin develop"     inner-repo
res_case "single-quoted"  "cd '$TARGET' && $G $P origin develop"   inner-repo
res_case "double-quoted"  "cd \"$TARGET\" && $G $P origin develop" inner-repo

# With no `cd`, the payload cwd is the answer — and must not be overridden.
mkdir -p "$RTMP/fallback"; git init -q "$RTMP/fallback" 2>/dev/null
say "no cd -> payload cwd" \
    "$(basename "$(e2e_resolve_repo "$G $P origin develop" "$RTMP/fallback")")" fallback

rm -rf "$RTMP"

# MULTI-LINE `cd`, and the freshly-pushed disambiguator.
#
# CAUGHT BY THE LIVE HARNESS, 2026-08-21. The resolver only looked for
# `cd <dir> && git push` on a single line. A perfectly ordinary multi-line script
#
#     cd /tmp/fixture
#     cd repo
#     git push origin develop
#
# resolved to the PROJECT ROOT instead, and the hook armed a SAFE-subset run for
# a repository nobody had pushed. Silent and wrong — the worst combination, and
# the second time this resolver has produced a confidently incorrect answer.
#
# The fix stops guessing from syntax alone: among the candidate directories, the
# one whose remote-tracking ref was ACTUALLY pushed seconds ago wins.
echo " multi-line cd + freshly-pushed disambiguator"

MTMP=$(mktemp -d 2>/dev/null || mktemp -d -t e2eml)
mk_repo() {   # $1 = name -> a repo with an origin and a develop upstream
  git init -q --bare "$MTMP/$1.git"
  git init -q "$MTMP/$1"
  git -C "$MTMP/$1" config user.email t@t.t
  git -C "$MTMP/$1" config user.name T
  echo x > "$MTMP/$1/f"; git -C "$MTMP/$1" add -A; git -C "$MTMP/$1" commit -qm base
  git -C "$MTMP/$1" remote add origin "$MTMP/$1.git"
  git -C "$MTMP/$1" push -q origin HEAD:develop
  git -C "$MTMP/$1" branch -qM develop
  git -C "$MTMP/$1" branch -q --set-upstream-to=origin/develop 2>/dev/null
}
mk_repo pushed >/dev/null 2>&1
mk_repo idle   >/dev/null 2>&1
# only `pushed` gets a second, recent push
echo y > "$MTMP/pushed/f"; git -C "$MTMP/pushed" add -A
git -C "$MTMP/pushed" commit -qm change >/dev/null 2>&1
git -C "$MTMP/pushed" push -q origin develop >/dev/null 2>&1

ml_case() {
  local label="$1" cmd="$2" want="$3"
  say "$label" "$(basename "$(e2e_resolve_repo "$cmd" "$MTMP/idle")")" "$want"
}

ml_case "multi-line cd, then push" "cd $MTMP
cd pushed
$G $P origin develop" pushed

ml_case "cd on its own line"       "cd $MTMP/pushed
$G $P origin develop" pushed

# The freshly-pushed repo wins over the payload cwd, which is a git repo too and
# would otherwise have been returned first.
ml_case "fresh push beats payload cwd" "cd $MTMP/pushed && $G $P origin develop" pushed

# Nothing pushed recently anywhere -> fall back to the payload cwd, as before.
say "no fresh push -> payload cwd" \
    "$(basename "$(e2e_resolve_repo "$G $P origin develop" "$MTMP/idle")")" idle

rm -rf "$MTMP"

# ─────────────────────────────────────────────────────────────────────────────
# COMMIT is now a trigger (bd-43513).
#
# Operator: "commit any change then hook should trigger ... something changed in
# menu related features then it should automatically run /niete-e2e menu".
#
# So `git commit` arms, on ANY branch — the deploy-branch filter applies to
# pushes only. A commit is not a deploy, which is why the injected instruction
# says what the run will actually be driven against; that caveat is content, not
# a reason to withhold the trigger.
echo " commit trigger"

C="commit"
commit_case() {
  local label="$1" cmd="$2" want="$3" got=no
  is_git_commit "$cmd" && got=yes
  say "$label" "$got" "$want"
}

commit_case "bare commit -m"        "$G $C -m 'fix menu'"                     yes
commit_case "commit -am"            "$G $C -am wip"                           yes
commit_case "cd && commit"          "cd NIETE-Rumi && $G $C -m x"             yes
commit_case "env-prefixed commit"   "SKIP_QA=1 $G $C -m x"                    yes
commit_case "commit --amend"        "$G $C --amend --no-edit"                 yes
commit_case "prose mention"         "echo how to $G $C properly"              no
commit_case "a push is not a commit" "$G $P origin develop"                   no
# `git merge` produces a commit, and the develop->main promotion IS a merge —
# matching only `git commit` made that promotion invisible (bd-43559).
commit_case "git merge counts"       "$G merge --no-ff develop"               yes
commit_case "mergetool does not"     "$G mergetool"                           no
commit_case "commit-tree does not"   "$G commit-tree abc123"                  no

# Arms from a REAL commit, with the real git range — no E2E_SELECT_FILES.
CTMP=$(mktemp -d 2>/dev/null || mktemp -d -t e2ecm)
CSESSION="commit-session"
CPENDING=".claude/.e2e-pending/$CSESSION.json"
rm -f "$CPENDING"
(
  set -e
  git init -q "$CTMP/w"; cd "$CTMP/w"
  git config user.email t@t.t; git config user.name T
  mkdir -p bot/shared/services
  echo v1 > bot/shared/services/menu.service.js; echo r1 > README.md
  git add -A; git commit -qm base
  echo v2 > bot/shared/services/menu.service.js; echo r2 > README.md
  git add -A; git commit -qm "fix(menu): tweak"
) >/dev/null 2>&1

PROJ=$(pwd)
COUT=$(python3 -c '
import json,sys
print(json.dumps({"session_id": sys.argv[1], "cwd": sys.argv[2], "tool_name": "Bash",
                  "tool_input": {"command": "git commit -m \"fix(menu): tweak\""}}))
' "$CSESSION" "$CTMP/w" | CLAUDE_PROJECT_DIR="$PROJ" bash "$ARM" 2>/dev/null)

say "arms on a REAL commit"          "$([ -f "$CPENDING" ] && echo yes || echo no)" yes
CCMDS=$(python3 -c '
import json,sys
try:
    d=json.load(open(sys.argv[1])); print("%s|%s"%(",".join(d["commands"]),d["trigger"]))
except Exception: print("ERR")
' "$CPENDING" 2>/dev/null)
say "exact commands + trigger"       "$CCMDS"  "/niete-e2e menu|commit"
# The marker must name the EXACT commit it armed for, so the mock lane can start the bot from a
# detached worktree at that sha and the ledger row can be tied to it (a run against "whatever
# HEAD is now" is not proof about the commit).
CSHA=$(git -C "$CTMP/w" rev-parse HEAD)
CMSHA=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("commit_sha","MISSING"))' "$CPENDING" 2>/dev/null)
say "marker records the commit sha"  "$CMSHA"  "$CSHA"
# A COMMIT SPEAKS AGAIN (operator, 2026-08-25: "when we commit something then
# auto run the e2e test"). It arms an execute order and names the commands, and
# the reason it emits has to say which build the run will actually hit — see the
# stale-build assertions in the mode matrix below.
has "commit: emits context"          "$COUT" "additionalContext"     yes
has "commit: names the command"      "$COUT" "/niete-e2e menu"       yes
has "commit: names the build it hits" "$COUT" "not been deployed"    yes

# A docs-only commit must stay silent — the map, not the trigger, decides.
rm -f "$CPENDING"
( cd "$CTMP/w"; echo r3 > README.md; git add -A; git commit -qm docs ) >/dev/null 2>&1
python3 -c '
import json,sys
print(json.dumps({"session_id": sys.argv[1], "cwd": sys.argv[2], "tool_name": "Bash",
                  "tool_input": {"command": "git commit -m docs"}}))
' "$CSESSION" "$CTMP/w" | CLAUDE_PROJECT_DIR="$PROJ" bash "$ARM" >/dev/null 2>&1
say "docs-only commit stays silent"  "$([ -f "$CPENDING" ] && echo yes || echo no)" no

# A merge commit introduces no new work of its own.
rm -f "$CPENDING"
(
  set -e
  cd "$CTMP/w"
  git checkout -qb side
  echo v3 > bot/shared/services/menu.service.js; git add -A; git commit -qm side
  git checkout -q -; git merge --no-ff -q -m "merge side" side
) >/dev/null 2>&1
python3 -c '
import json,sys
print(json.dumps({"session_id": sys.argv[1], "cwd": sys.argv[2], "tool_name": "Bash",
                  "tool_input": {"command": "git merge --no-ff side"}}))
' "$CSESSION" "$CTMP/w" | CLAUDE_PROJECT_DIR="$PROJ" bash "$ARM" >/dev/null 2>&1
say "merge commit does not arm"      "$([ -f "$CPENDING" ] && echo yes || echo no)" no

rm -rf "$CTMP"; rm -f "$CPENDING"

# ─────────────────────────────────────────────────────────────────────────────
# NIETE-Rumi: develop = targeted, develop->main promotion = the whole suite.
# (bd-43559, operator 2026-08-24)
#
# The interaction that makes this non-obvious: merge commits are skipped
# EVERYWHERE ELSE (a merge introduces no work of its own), but the develop->main
# promotion IS a merge. Skip it and the full suite never fires at all, because
# that is precisely the shape a promotion takes. The full-suite path therefore
# ignores the diff entirely — the question there is "is the whole surface still
# good before prod", not "what did this merge touch".
echo " NIETE develop=targeted / main=all"

NTMP=$(mktemp -d 2>/dev/null || mktemp -d -t e2eniete)
NSESSION="niete-session"
NPENDING=".claude/.e2e-pending/$NSESSION.json"
PROJ=$(pwd)

niete_repo() {   # $1 = remote url to fake
  rm -rf "$NTMP/w"
  git init -q "$NTMP/w"
  git -C "$NTMP/w" config user.email t@t.t
  git -C "$NTMP/w" config user.name T
  git -C "$NTMP/w" remote add origin "$1"
  mkdir -p "$NTMP/w/bot/shared/services"
  echo v1 > "$NTMP/w/bot/shared/services/menu.service.js"
  git -C "$NTMP/w" add -A; git -C "$NTMP/w" commit -qm base
  git -C "$NTMP/w" branch -M develop
}

fire() {   # -> echoes the marker's command list
  rm -f "$NPENDING"
  python3 -c '
import json,sys
print(json.dumps({"session_id": sys.argv[1], "cwd": sys.argv[2], "tool_name": "Bash",
                  "tool_input": {"command": sys.argv[3]}}))
' "$NSESSION" "$NTMP/w" "$1" | CLAUDE_PROJECT_DIR="$PROJ" bash "$ARM" >/dev/null 2>&1
  if [ -f "$NPENDING" ]; then
    python3 -c 'import json,sys;print(",".join(json.load(open(sys.argv[1]))["commands"]))' "$NPENDING"
  else
    echo "SILENT"
  fi
}

NIETE_URL="git@github.com:Orenda-Project/NIETE-Rumi.git"

# develop, real code change -> TARGETED
niete_repo "$NIETE_URL" >/dev/null 2>&1
echo v2 > "$NTMP/w/bot/shared/services/menu.service.js"
git -C "$NTMP/w" add -A; git -C "$NTMP/w" commit -qm "fix(menu): x" >/dev/null 2>&1
say "develop commit -> targeted"        "$(fire "$G $C -m x")"  "/niete-e2e menu"

# develop, merge commit -> SILENT (no work of its own)
git -C "$NTMP/w" checkout -qb side >/dev/null 2>&1
echo v3 > "$NTMP/w/bot/shared/services/menu.service.js"
git -C "$NTMP/w" add -A; git -C "$NTMP/w" commit -qm side >/dev/null 2>&1
git -C "$NTMP/w" checkout -q develop >/dev/null 2>&1
git -C "$NTMP/w" merge --no-ff -q -m "merge side" side >/dev/null 2>&1
say "develop merge -> silent"           "$(fire "$G merge --no-ff side")"  SILENT

# main, ordinary commit -> ALL
git -C "$NTMP/w" checkout -qb main >/dev/null 2>&1
echo v4 > "$NTMP/w/bot/shared/services/menu.service.js"
git -C "$NTMP/w" add -A; git -C "$NTMP/w" commit -qm "promote" >/dev/null 2>&1
say "main commit -> all"                "$(fire "$G $C -m promote")"  "/niete-e2e all"

# main, MERGE commit (the real promotion shape) -> ALL, despite the merge rule
git -C "$NTMP/w" checkout -q develop >/dev/null 2>&1
echo v5 > "$NTMP/w/bot/shared/services/menu.service.js"
git -C "$NTMP/w" add -A; git -C "$NTMP/w" commit -qm "more dev work" >/dev/null 2>&1
git -C "$NTMP/w" checkout -q main >/dev/null 2>&1
git -C "$NTMP/w" merge --no-ff -q -m "Merge develop into main" develop >/dev/null 2>&1
say "main PROMOTION merge -> all"       "$(fire "$G merge --no-ff develop")"  "/niete-e2e all"

# A DIFFERENT repo on main must NOT escalate — rumi-agent-home main takes commits
# from 5+ parallel agents all day.
niete_repo "https://github.com/hyasin270/rumi-agent-home.git" >/dev/null 2>&1
git -C "$NTMP/w" checkout -qb main >/dev/null 2>&1
echo v2 > "$NTMP/w/bot/shared/services/menu.service.js"
git -C "$NTMP/w" add -A; git -C "$NTMP/w" commit -qm x >/dev/null 2>&1
say "other repo on main -> targeted"    "$(fire "$G $C -m x")"  "/niete-e2e menu"

rm -rf "$NTMP"; rm -f "$NPENDING"

# ─────────────────────────────────────────────────────────────────────────────
# An explicit `cd` must WIN over a merely-recent push.
#
# The freshly-pushed preference was added so the resolver observed reality rather
# than parsing syntax. It then over-reached: it ran BEFORE candidate order, so any
# repo pushed in the last 120s beat the repo the command explicitly named.
#
# Real consequence: push anything, then within two minutes
# `cd other-repo && git commit` — the hook arms features for the repo you PUSHED,
# not the one you committed in. Wrong features, silently.
#
# It also made this very suite flaky at roughly 1 run in 5: pushing the working
# branch made $PWD "fresh", so temp-repo cases resolved to the worktree. Two
# unexplained failures earlier in this work were this.
echo " explicit cd beats a recent push"

PTMP=$(mktemp -d 2>/dev/null || mktemp -d -t e2eprec)
# target: an ordinary repo with NO upstream — exactly what you commit into
git init -q "$PTMP/target"
git -C "$PTMP/target" config user.email t@t.t; git -C "$PTMP/target" config user.name T
echo x > "$PTMP/target/f"; git -C "$PTMP/target" add -A; git -C "$PTMP/target" commit -qm base
# elsewhere: pushed seconds ago, so it looks "fresh"
git init -q --bare "$PTMP/e.git"; git init -q "$PTMP/elsewhere"
git -C "$PTMP/elsewhere" config user.email t@t.t; git -C "$PTMP/elsewhere" config user.name T
echo x > "$PTMP/elsewhere/f"; git -C "$PTMP/elsewhere" add -A
git -C "$PTMP/elsewhere" commit -qm base
git -C "$PTMP/elsewhere" remote add origin "$PTMP/e.git"
git -C "$PTMP/elsewhere" push -q origin HEAD:develop
git -C "$PTMP/elsewhere" branch -qM develop
git -C "$PTMP/elsewhere" branch -q --set-upstream-to=origin/develop 2>/dev/null

say "explicit cd wins over a fresh push" \
    "$(basename "$(e2e_resolve_repo "cd $PTMP/target && $G $C -m x" "$PTMP/elsewhere")")" target

# ...and with no cd at all, the payload cwd is still the answer.
say "no cd -> payload cwd (unchanged)" \
    "$(basename "$(e2e_resolve_repo "$G $C -m x" "$PTMP/elsewhere")")" elsewhere

rm -rf "$PTMP"

# ─────────────────────────────────────────────────────────────────────────────
# GREP PORTABILITY + "a pull is not a push". Both silently kill the push trigger.
echo " grep portability + pull-is-not-a-push"

# 1. `grep` is not one program. ugrep rejects `(\b|:)` as an empty sub-expression
#    and the whole match returns false, so the deploy-branch filter never fires.
#    Exercise the matcher under EVERY grep binary on this box, not just the first
#    one on PATH — on the author's machine `grep` is a zsh function the hook's
#    bash never sees, which is precisely why this would have gone unnoticed.
for GREPBIN in /usr/bin/grep /opt/homebrew/bin/grep /usr/local/bin/grep \
               /opt/homebrew/bin/ugrep /usr/local/bin/ugrep; do
  [ -x "$GREPBIN" ] || continue
  GDIR=$(mktemp -d 2>/dev/null || mktemp -d -t e2egrep)
  ln -sf "$GREPBIN" "$GDIR/grep"
  LBL=$("$GREPBIN" --version 2>&1 | head -1 | cut -c1-12)
  # LIB passed through the environment, not interpolated: the repo path contains
  # spaces ("Rumi 10 April 2026") and unquoted interpolation split it, so the
  # source silently failed and the "rejects" case passed because the function did
  # not exist. A third vacuous fixture in this file's history — hence the
  # sanity assertion below that the function is actually callable.
  LIB="$PWD/.claude/hooks/lib/git-push-match.sh"
  probe() { PATH="$GDIR:/usr/bin:/bin" LIB="$LIB" bash -c '
      . "$LIB" || { echo LIBFAIL; exit; }
      push_targets_deploy_branch "$1" && echo yes || echo no' _ "$1"; }
  say "  [$LBL] lib loads at all"            "$(probe 'git push origin develop')" yes
  say "  [$LBL] rejects a feature branch"    "$(probe 'git push origin my-feature')" no
  say "  [$LBL] accepts HEAD:develop refspec" "$(probe 'git push origin HEAD:develop')" yes
  rm -rf "$GDIR"
done

# 1b. A STATIC guard, because the loop above can only exercise the greps that
#     happen to be installed — on the author's machine that is BSD grep alone, so
#     the ugrep regression is not reproducible locally and the runtime loop would
#     stay green while the bug returned. `\b` inside an alternation is the exact
#     construct ugrep rejects; assert it never comes back, whatever grep is here.
#     Comment lines are excluded — the fix's own comment quotes the bad pattern
#     to explain it, and a guard that trips on its own documentation gets deleted.
BADRE=$(grep -v '^[[:space:]]*#' .claude/hooks/lib/git-push-match.sh \
        | grep -c '(\\b|' || true)
say "no \\b-inside-alternation in lib code" "$BADRE" 0

# 2. A pull writes the tracking ref's reflog too, so reading only the TIMESTAMP
#    made any recently-pulled repo look freshly pushed.
#
#    The pulled repo has to BE a candidate to reproduce — a third directory is
#    never considered; in the real failure it was $PWD. Two earlier attempts at
#    this test passed vacuously: one put the repo elsewhere, one used `git clone`
#    against a bare repo whose HEAD pointed at a nonexistent ref, so the fixture
#    had no upstream at all and both branches of the test fell through.
FTMP=$(mktemp -d 2>/dev/null || mktemp -d -t e2efresh)
git init -q --bare "$FTMP/o.git"
git init -q "$FTMP/seed"; git -C "$FTMP/seed" config user.email t@t.t
git -C "$FTMP/seed" config user.name T; echo x > "$FTMP/seed/f"
git -C "$FTMP/seed" add -A; git -C "$FTMP/seed" commit -qm base
git -C "$FTMP/seed" remote add origin "$FTMP/o.git"
git -C "$FTMP/seed" push -q origin HEAD:develop
# puller: built by hand so the upstream genuinely exists
git init -q "$FTMP/puller"; git -C "$FTMP/puller" config user.email t@t.t
git -C "$FTMP/puller" config user.name T
git -C "$FTMP/puller" remote add origin "$FTMP/o.git"
git -C "$FTMP/puller" fetch -q origin develop
git -C "$FTMP/puller" checkout -q -b develop --track origin/develop
# work: an ordinary repo with no upstream — what you actually commit into
git init -q "$FTMP/work"; git -C "$FTMP/work" config user.email t@t.t
git -C "$FTMP/work" config user.name T; echo y > "$FTMP/work/f"
git -C "$FTMP/work" add -A; git -C "$FTMP/work" commit -qm base

# guard the fixture itself — a vacuous fixture is how this got missed twice
say "fixture: puller has an upstream" \
    "$(git -C "$FTMP/puller" rev-parse --abbrev-ref '@{upstream}' 2>/dev/null)" origin/develop

say "a recent FETCH does not hijack \$PWD" \
    "$(cd "$FTMP/puller" && basename "$(e2e_resolve_repo "$G $C -m x" "$FTMP/work")")" work

git -C "$FTMP/puller" commit -q --allow-empty -m more
git -C "$FTMP/puller" push -q origin develop
say "fixture: reflog now records a push" \
    "$(git -C "$FTMP/puller" reflog show origin/develop | head -1 | grep -c 'update by push')" 1
say "a recent PUSH still wins the tie-break" \
    "$(cd "$FTMP/puller" && basename "$(e2e_resolve_repo "$G $C -m x" "$FTMP/work")")" puller
rm -rf "$FTMP"

# ─────────────────────────────────────────────────────────────────────────────
# GIT GLOBAL FLAGS between `git` and the subcommand.
#
# The matcher required `git` immediately followed by `commit`/`merge`/`push`, so
# every one of these fired NOTHING:
#
#     git -C NIETE-Rumi commit -m x      <- the natural form from the workspace root
#     git -c user.email=x commit -m y
#     git --no-pager commit -m z
#
# Found by running the full loop for real: a commit made with
# `git -c commit.gpgsign=false commit` armed nothing, and every fixture in this
# file had happened to use the bare form. `git -C <dir>` is what the fixtures
# themselves use everywhere else, which is how it hid.
echo " git global flags before the subcommand"

gf() { is_git_commit "$1" && echo yes || echo no; }
gp() { is_git_push "$1" && echo yes || echo no; }

say "bare commit"                "$(gf "$G $C -m x")"                       yes
say "git -C <dir> commit"        "$(gf "$G -C NIETE-Rumi $C -m x")"         yes
say "git -c cfg=val commit"      "$(gf "$G -c user.email=t@t.t $C -m x")"   yes
say "git --no-pager commit"      "$(gf "$G --no-pager $C -m x")"            yes
say "two global flags"           "$(gf "$G -c a=b -C dir $C -m x")"         yes
say "git -C <dir> merge"         "$(gf "$G -C dir merge --no-ff develop")"  yes
say "git -C <dir> push develop"  "$(gp "$G -C dir $P origin develop")"      yes

# Must NOT widen into false positives.
say "prose still not matched"    "$(gf "explain how $G $C works")"          no
say "commit-tree still not"      "$(gf "$G -C dir commit-tree abc")"        no
say "mergetool still not"        "$(gf "$G -C dir mergetool")"              no

# ─────────────────────────────────────────────────────────────────────────────
# `git -C <dir>` NAMES THE REPO. The resolver has to read it.
#
# Half-fixing this cost a wasted merge. The matcher was taught to recognise
# `git -C <dir> commit` as a commit — and it does — but `e2e_resolve_repo` still
# only looked for `cd <dir>`, so the command resolved to the payload cwd instead.
# Result: the hook fires and then maps THE WRONG REPO'S diff. It looked "fixed"
# because in the case it was tested on the wrong repo's HEAD happened to be a
# merge (empty diff -> silent). A different HEAD would have armed the wrong
# features, confidently.
#
# `-C` is git's own "run as if in this directory" flag. It is at least as
# explicit as a `cd`, so it gets the same precedence.
echo " git -C names the repo"

CTMP2=$(mktemp -d 2>/dev/null || mktemp -d -t e2edashc)
git init -q "$CTMP2/named"
git -C "$CTMP2/named" config user.email t@t.t; git -C "$CTMP2/named" config user.name T
echo x > "$CTMP2/named/f"; git -C "$CTMP2/named" add -A; git -C "$CTMP2/named" commit -qm base
git init -q "$CTMP2/elsewhere"
git -C "$CTMP2/elsewhere" config user.email t@t.t; git -C "$CTMP2/elsewhere" config user.name T
echo y > "$CTMP2/elsewhere/f"; git -C "$CTMP2/elsewhere" add -A
git -C "$CTMP2/elsewhere" commit -qm base

rc() { basename "$(e2e_resolve_repo "$1" "$CTMP2/elsewhere")"; }

say "git -C <dir> commit"        "$(rc "$G -C $CTMP2/named $C -m x")"           named
say "git -C <dir> push"          "$(rc "$G -C $CTMP2/named $P origin develop")" named
say "quoted -C"                  "$(rc "$G -C '$CTMP2/named' $C -m x")"         named
say "-C beats the payload cwd"   "$(rc "$G -C $CTMP2/named $C -m x")"           named
# an explicit cd still wins when both appear — cd is the shell's own move
say "cd still wins over -C"      "$(rc "cd $CTMP2/elsewhere && $G -C $CTMP2/named $C -m x")" elsewhere
# no -C at all: unchanged
say "no -C -> payload cwd"       "$(rc "$G $C -m x")"                           elsewhere

rm -rf "$CTMP2"

# ─────────────────────────────────────────────────────────────────────────────
# REAL GIT. Not E2E_SELECT_FILES.
#
# Every case above passed while the arming hook was completely broken against an
# actual push: they all inject the changed-file list, so none of them ever went
# near git. The defect they missed — PostToolUse fires AFTER the push, when
# `@{upstream}...HEAD` is already empty, so the hook computed "nothing changed"
# and never armed — was found by hand, not by this file.
#
# This case builds a repo, really pushes, and drives the hook with no override.
# It is the only test here that would have caught it.
echo " real git (no E2E_SELECT_FILES)"

GITTMP=$(mktemp -d 2>/dev/null || mktemp -d -t e2eauto)
RSESSION="realgit-session"
RPENDING=".claude/.e2e-pending/$RSESSION.json"
rm -f "$RPENDING"

(
  set -e
  git init -q --bare "$GITTMP/remote.git"
  git init -q "$GITTMP/work"
  cd "$GITTMP/work"
  git config user.email t@t.t; git config user.name T
  mkdir -p bot/shared/services
  echo "//v1" > bot/shared/services/menu.service.js
  echo "#v1"  > README.md
  git add -A; git commit -qm baseline
  git remote add origin "$GITTMP/remote.git"
  git push -q origin HEAD:develop
  git branch -M develop
  git branch --set-upstream-to=origin/develop -q 2>/dev/null || true
  # the change under test, then a REAL push
  echo "//v2" > bot/shared/services/menu.service.js
  echo "#v2"  > README.md
  git add -A; git commit -qm change
  git push -q origin develop
) >/dev/null 2>&1

PROJ=$(pwd)
ROUT=$(python3 -c '
import json,sys
print(json.dumps({"session_id": sys.argv[1], "cwd": sys.argv[2], "tool_name": "Bash",
                  "tool_input": {"command": "git push origin develop"}}))
' "$RSESSION" "$GITTMP/work" | CLAUDE_PROJECT_DIR="$PROJ" bash "$ARM" 2>/dev/null)

say  "arms after a REAL push"                    "$([ -f "$RPENDING" ] && echo yes || echo no)"  yes
has  "selects from the real diff"      "$ROUT" "/niete-e2e menu"     yes

# Assert the EXACT command set, not just that menu appears. The README changed in
# the same push and must neither add a feature nor drag in the SAFE-subset
# fallback — and `fallback` must be genuinely false, not merely absent.
RCMDS=$(python3 -c '
import json,sys
try:
    d = json.load(open(sys.argv[1]))
    print("%s|%s" % (",".join(d["commands"]), d["fallback"]))
except Exception: print("ERR")
' "$RPENDING" 2>/dev/null)
say  "exact commands from the real diff"         "$RCMDS"   "/niete-e2e menu|False"

rm -rf "$GITTMP"
rm -f "$RPENDING"

# ─────────────────────────────────────────────────────────────────────────────
# The Stop reason must name the ACTUAL trigger.
#
# It hardcoded "push". Caught in live use: a `git commit` armed the run, then the
# Stop hook announced "this session's PUSH to main has not run yet" — for a
# commit, with no push anywhere in sight. The marker has recorded `trigger` since
# bd-43513; the message just never read it.
#
# Small, but this text is an INSTRUCTION the agent acts on, and the whole design
# leans on it being precise about what happened and why it is being stopped.
echo " stop reason names the real trigger"

WTMP=$(mktemp -d 2>/dev/null || mktemp -d -t e2ewd)
WSESSION="wording-session"
WPENDING=".claude/.e2e-pending/$WSESSION.json"
PROJ=$(pwd)

# Build a marker by hand for each trigger, then read back the Stop reason.
stop_reason_for() {   # $1 = trigger value
  mkdir -p .claude/.e2e-pending
  cat > "$WPENDING" <<JSON
{"session":"$WSESSION","repo":"repo","branch":"main","trigger":"$1",
 "armed_at":"2026-08-24T00:00:00Z","nudged":false,
 "commands":["/niete-e2e all"],"features":[],"fallback":false,"unmapped":[]}
JSON
  python3 -c '
import json,sys
print(json.dumps({"session_id": sys.argv[1], "hook_event_name": "Stop"}))
' "$WSESSION" | CLAUDE_PROJECT_DIR="$PROJ" bash "$STOP" 2>/dev/null \
    | python3 -c 'import json,sys
try: print(json.load(sys.stdin)["reason"].splitlines()[0])
except Exception: print("NO-BLOCK")'
}

RC=$(stop_reason_for commit)
case "$RC" in *"commit to"*) say "commit-armed reason says 'commit'" yes yes ;;
              *)             say "commit-armed reason says 'commit'" "no ($RC)" yes ;; esac
case "$RC" in *push*) say "commit-armed reason avoids 'push'" "no ($RC)" yes ;;
              *)      say "commit-armed reason avoids 'push'" yes yes ;; esac

RP=$(stop_reason_for push)
case "$RP" in *"push to"*) say "push-armed reason says 'push'" yes yes ;;
              *)           say "push-armed reason says 'push'" "no ($RP)" yes ;; esac

# A marker written before `trigger` existed must not print an empty word.
mkdir -p .claude/.e2e-pending
cat > "$WPENDING" <<'JSON'
{"session":"wording-session","repo":"repo","branch":"main","nudged":false,
 "commands":["/niete-e2e all"],"features":[],"fallback":false,"unmapped":[]}
JSON
ROLD=$(python3 -c '
import json
print(json.dumps({"session_id": "wording-session", "hook_event_name": "Stop"}))
' | CLAUDE_PROJECT_DIR="$PROJ" bash "$STOP" 2>/dev/null \
  | python3 -c 'import json,sys
try: print(json.load(sys.stdin)["reason"].splitlines()[0])
except Exception: print("NO-BLOCK")')
case "$ROLD" in *"  to "*|*"change to"*) got=ok ;; *) got=ok ;; esac
case "$ROLD" in *"session's  to"*) say "legacy marker has no empty gap" "empty gap" none ;;
                *)                 say "legacy marker has no empty gap" none none ;; esac

rm -rf "$WTMP"; rm -f "$WPENDING"

# ─────────────────────────────────────────────────────────────────────────────
# ADVISORY vs EXECUTE (operator, 2026-08-25).
#
# "just dont print it but we have to run it auto" + "deploy pushes only".
#
# A COMMIT deploys nothing, so an E2E fired from one drives the build that was
# already live — it proves nothing and costs hours (one handler selected
# training + coaching, and coaching's 15 scenarios upload real audio with ~10min
# of analysis each). So a commit now arms SILENTLY: the marker records what would
# run, and nothing interrupts.
#
# A PUSH to develop/main/staging is the moment the code becomes testable. That
# one is an EXECUTE order: the agent drives it via Chrome DevTools MCP rather
# than printing the commands back and waiting to be told to proceed.
#
# The mode lives in the marker, not in the Stop hook's guesswork, so the two
# halves cannot disagree about what a given arming meant.
echo " commit and push both EXECUTE (bd-44103)"

# WHAT CHANGED, and why the three cases here are inverted from what they were.
#
# PR #37 made a commit arm SILENTLY (mode=advisory) and let only a deploying push
# execute, on the reasoning that a commit deploys nothing — so an E2E fired from
# one drives the build that was already live. That reasoning still holds and is
# worth reading before touching this.
#
# The operator asked for commit -> run anyway (2026-08-25). So both triggers now
# arm mode=execute and both speak. The staleness is not fixed by the hook; it is
# disclosed in the reason text, which is asserted below.
#
# A marker written by the advisory-era hook must still not block — see the
# legacy case at the end.

MSESSION="mode-session"
MPENDING=".claude/.e2e-pending/$MSESSION.json"
MPROJ=$(pwd)
rm -f "$MPENDING"

mode_arm() {  # cmd, files
  E2E_SELECT_FILES="${2:-bot/shared/services/menu.service.js}" \
  python3 -c '
import json,sys
print(json.dumps({"session_id": sys.argv[1], "cwd": ".", "tool_name": "Bash",
                  "tool_input": {"command": sys.argv[2]}}))
' "$MSESSION" "$1" | E2E_SELECT_FILES="${2:-bot/shared/services/menu.service.js}" \
    CLAUDE_PROJECT_DIR="$MPROJ" bash "$ARM" 2>/dev/null
}
mode_stop() {
  python3 -c '
import json,sys
print(json.dumps({"session_id": sys.argv[1], "hook_event_name": "Stop"}))
' "$MSESSION" | CLAUDE_PROJECT_DIR="$MPROJ" bash "$STOP" 2>/dev/null
}
marker_field() {  # field name
  python3 -c '
import json,sys
try: print(json.load(open(sys.argv[1])).get(sys.argv[2],"MISSING"))
except Exception: print("NO-MARKER")
' "$MPENDING" "$1" 2>/dev/null
}
marker_mode() { marker_field mode; }
marker_cmds() {
  python3 -c '
import json,sys
try: print("\n".join(json.load(open(sys.argv[1])).get("commands",[])))
except Exception: print("NO-MARKER")
' "$MPENDING" 2>/dev/null
}

rm -f "$MPENDING"
MOUT=$(mode_arm "$G $C -m 'fix menu'")
say  "commit arms in execute mode"           "$(marker_mode)"          execute
has  "commit speaks"                "$MOUT" "additionalContext"        yes
MS=$(mode_stop)
has  "commit marker blocks"            "$MS" '"block"'                 yes
has  "...as an execute order"          "$MS" "EXECUTE NOW"             yes
has  "...naming commit as the trigger" "$MS" "commit"                  yes
# The staleness PR #37 was protecting against is now the agent's problem to
# check, so the reason has to say it out loud on a commit-armed run.
has  "...disclosing the stale-build risk" "$MS" "not been deployed"    yes
# The sign-off used to say "for this push" unconditionally, so a commit-armed
# reason closed by naming an event that never happened. Same class of bug as the
# one bd-43513 fixed in the opening line.
has  "...sign-off names commit, not push" "$MS" "again for this commit" yes

rm -f "$MPENDING"
MOUT=$(mode_arm "$G $P origin develop")
say  "push still arms in execute mode"       "$(marker_mode)"          execute
has  "push speaks"                  "$MOUT" "additionalContext"        yes
MS=$(mode_stop)
has  "execute marker blocks"           "$MS" '"block"'                 yes
has  "...naming the MCP driver"        "$MS" "Chrome DevTools MCP"      yes
has  "...with no co-equal opt-out"     "$MS" "Do one of these"         no

# Re-arming: a second commit over an un-nudged marker refreshes the selection
# rather than being dropped. With nothing advisory left there is no downgrade to
# guard against — but there is still exactly ONE nudge, which is the anti-wedge
# invariant this whole file exists for.
rm -f "$MPENDING"
mode_arm "$G $C -m 'first'"  >/dev/null
mode_arm "$G $C -m 'second'" >/dev/null
say  "a second commit re-arms"               "$(marker_mode)"          execute
MS=$(mode_stop)
has  "...and still blocks once"        "$MS" "EXECUTE NOW"             yes
say  "...then never again"                   "$(mode_stop | grep -c '"block"')" 0

# BACKWARD COMPAT. A marker already on disk from the advisory era carries
# mode=advisory; its commit deployed nothing and nobody was told about it, so it
# must stay silent rather than surprise a session mid-turn with an hours-long run.
rm -f "$MPENDING"
mode_arm "$G $C -m 'legacy'" >/dev/null
python3 - "$MPENDING" <<'PYEOF'
import json,sys
p = sys.argv[1]
d = json.load(open(p)); d["mode"] = "advisory"; d["nudged"] = False
json.dump(d, open(p, "w"))
PYEOF
MS=$(mode_stop)
has  "a legacy advisory marker still does not block" "$MS" '"block"'   no

# E2E_AUTORUN_ALL=1 — drive the WHOLE suite instead of the targeted selection.
# This is the literal `/niete-e2e all` the operator first asked for. It is opt-in
# because `all` is 99 scenarios and coaching alone waits ~10min per scenario on
# real audio analysis, so a commit-triggered `all` is an hours-long block.
rm -f "$MPENDING"
export E2E_AUTORUN_ALL=1
MOUT=$(mode_arm "$G $C -m 'fix menu'")
say  "ALL: arms in execute mode"             "$(marker_mode)"          execute
say  "ALL: exactly one command"              "$(marker_cmds | wc -l | tr -d ' ')" 1
say  "ALL: and it is the full suite"         "$(marker_cmds)"          "/niete-e2e all"
has  "ALL: says so out loud"        "$MOUT" "/niete-e2e all"           yes
MS=$(mode_stop)
has  "ALL: blocks"                     "$MS" '"block"'                 yes
has  "ALL: warns what it costs"        "$MS" "takes HOURS"              yes
has  "ALL: sizes the run"              "$MS" "99 scenarios"             yes
unset E2E_AUTORUN_ALL

# ALL mode must not depend on the selector having matched anything — a docs-only
# commit selects no features, and that is exactly when a full-suite run is still
# wanted. Without this, `E2E_AUTORUN_ALL=1` would silently no-op on the commits
# the targeted path drops.
rm -f "$MPENDING"
export E2E_AUTORUN_ALL=1
mode_arm "$G $C -m 'docs only'" "01_Digital Coach Docs/README.md" >/dev/null
say  "ALL: arms even when nothing is selected" "$(marker_cmds)"        "/niete-e2e all"
unset E2E_AUTORUN_ALL

rm -f "$MPENDING"

# ── the WhatsApp precondition must send you to LOOK, not let you infer ───────
#
# Caught live 2026-08-28: the arming text said "needs a linked web.whatsapp.com
# session (`list_pages`)", an agent read `about:blank` off `list_pages`, and
# reported "no linked session" as a precondition failure. The session was fine —
# it lives in the browser PROFILE, and a blank tab says nothing about it. One
# `navigate_page` would have shown a loaded chat list.
#
# Both halves must therefore name the navigation, and must say what a QR screen
# costs: ask for a scan, and if nobody scans it SAY SO — don't sit waiting, and
# don't quietly skip. Under-running on a false negative is the same damage as
# under-selecting features: silent, and it reads as a pass.
#
# EVERY NEEDLE BELOW MUST BE ABSENT FROM THE PRE-CHANGE TEXT. The first draft
# asserted "CANNOT" against the stop reason, which already carried "THIS CANNOT
# TEST WHAT WAS JUST COMMITTED" — green before the fix, green after, worth
# nothing. Check a new needle against `git show HEAD:<hook>` before trusting it.
NAV=$(mode_arm "$G $C -m 'fix menu'")
has  "arm: sends you to navigate, not to guess" "$NAV" "navigate_page"     yes
has  "arm: names the URL to open"    "$NAV" "https://web.whatsapp.com"     yes
has  "arm: warns list_pages proves nothing"     "$NAV" "DOES NOT TELL YOU" yes
has  "arm: a QR screen means ask for a scan"    "$NAV" "Link a device"     yes
has  "arm: and names the unattended way out"    "$NAV" \
                                    "THAT is the precondition failure"     yes
NS=$(mode_stop)
has  "stop: sends you to navigate too"          "$NS"  "navigate_page"     yes
has  "stop: warns list_pages proves nothing"    "$NS"  "ALONE CANNOT"      yes
has  "stop: a QR screen means ask for a scan"   "$NS"  "Link a device"     yes

# ── a missing Chrome MCP is INSTALLABLE, and the driver number is READABLE ───
#
# Both halves used to treat "Chrome MCP absent" as terminal, while
# `/niete-e2e` had already said "check FIRST, install if missing". An agent
# reading only the hook reported a dead end the runbook would have fixed — the
# same hook-vs-runbook drift as the list_pages bug above.
#
# The driver line had the matching fault: it told the agent to ASK for a number
# the browser already holds in localStorage['last-wid-md'].
has  "arm: a missing MCP is installable"   "$NAV" "claude mcp add"        yes
has  "arm: names the restart that follows" "$NAV" "RESTARTED"             yes
has  "arm: driver read off the session"    "$NAV" "last-wid-md"           yes
has  "stop: MCP is not terminal there"     "$NS"  "is NOT"                yes
has  "stop: gives the install command"     "$NS"  "claude mcp add"        yes

rm -f "$MPENDING"


# ─────────────────────────── PHASE 1: the Gherkin spec sync (bd-59809) ───────
#
# The gap this closes: the arm/enforce pair above decides WHICH features a commit
# touched and orders the suite driven — against whatever scenarios happen to be in
# `tests/features/whatsapp/niete/*.feature`. Nothing kept those current, so a
# commit that changed a flow drove the specs written for the OLD flow and passed.
#
# So a phase goes in FRONT of the run: sync the specs to the diff, validate them,
# and only then drive. The ordering is the whole point — a validated-but-stale
# spec is exactly as useless as an unvalidated one.
#
# The sync must be independently disableable (E2E_SPEC_SYNC_OFF=1). If authoring
# is broken or noisy, the E2E half must keep working exactly as it did before —
# otherwise one bad day for the sync takes the run with it.

echo " phase 1 — spec sync"

sync_exists() { [ -f "$SYNC" ] && echo yes || echo no; }

cleanup
OUT=$(arm "$G commit -m 'change the menu'")
say  "commit writes a sync brief"                "$(sync_exists)"        yes
has  "brief is valid JSON"  "$(python3 -c 'import json,sys;json.load(open(sys.argv[1]));print("ok")' "$SYNC" 2>/dev/null)" "ok" yes
has  "brief names the selected feature" \
     "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["features"][0]["feature"])' "$SYNC" 2>/dev/null)" "menu" yes
has  "brief carries the current scenario inventory" \
     "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["features"][0]["scenario_count"]>0)' "$SYNC" 2>/dev/null)" "True" yes

has  "arm: orders PHASE 1 before PHASE 2"        "$OUT" "PHASE 1"        yes
has  "arm: names the sync command"               "$OUT" "/sync-specs"    yes
has  "arm: names the validator"                  "$OUT" "validate_specs.py" yes
has  "arm: still orders the E2E as phase 2"      "$OUT" "/niete-e2e menu"  yes
has  "arm: says validation gates the run"        "$OUT" "do NOT run the suite" yes
has  "arm: forbids silent deletion"              "$OUT" "@obsolete"      yes
has  "arm: flags the shared-fan-out case"        "$OUT" "only_shared"    yes

# THE AUTHORING SKILL MUST BE NAMED IN THE ORDER, not just in the skill file.
# The point of automating this was to keep what the MANUAL /testcases run gave
# us — the risk model, positive-first ordering, the quality gate. An order that
# says "sync the specs" without naming `gherkin-test-cases` invites a free-handed
# scenario, which is the shallow coverage that skill exists to prevent.
has  "arm: routes authoring to the existing skill" "$OUT" "gherkin-test-cases" yes
has  "arm: ties it to the manual command"          "$OUT" "/testcases"         yes

# ORDERING IS THE LOAD-BEARING PROPERTY. A validated-but-stale spec is exactly as
# useless as an unvalidated one, so phase 1 must be read before phase 2 is driven.
# Compared on the DECODED context: the hook emits one line of JSON, so grep -n
# reports line 1 for everything and would pass this by accident.
say  "arm: phase 1 precedes phase 2" \
     "$(printf '%s' "$OUT" | python3 -c '
import json,sys
c = json.load(sys.stdin)["hookSpecificOutput"]["additionalContext"]
a, b = c.find("PHASE 1"), c.find("PHASE 2")
print("yes" if 0 <= a < b else "no")
' 2>/dev/null)" yes

# The marker records whether a sync was armed, so the Stop half cannot disagree
# with the PostToolUse half about what this arming meant.
has  "marker records the sync phase" \
     "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["spec_sync"])' "$PENDING" 2>/dev/null)" "True" yes

SOUT=$(stop_hook)
has  "stop: enforces phase 1 first"              "$SOUT" "PHASE 1"       yes
has  "stop: names the sync command"              "$SOUT" "/sync-specs"   yes
has  "stop: routes authoring to the same skill"  "$SOUT" "gherkin-test-cases" yes
has  "stop: still enforces the E2E"              "$SOUT" "/niete-e2e menu" yes

# ── the independent off switch ───────────────────────────────────────────────
# E2E_SPEC_SYNC_OFF must leave the pre-bd-59809 behaviour EXACTLY intact.
cleanup
OUT=$(E2E_SPEC_SYNC_OFF=1 arm "$G commit -m 'change the menu'")
say  "SPEC_SYNC_OFF: no brief written"           "$(sync_exists)"        no
say  "SPEC_SYNC_OFF: still arms the E2E"         "$(marker_exists)"      yes
has  "SPEC_SYNC_OFF: no phase 1 in the order"    "$OUT" "PHASE 1"        no
has  "SPEC_SYNC_OFF: E2E order is unchanged"     "$OUT" "/niete-e2e menu"  yes
has  "SPEC_SYNC_OFF: marker says no sync" \
     "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["spec_sync"])' "$PENDING" 2>/dev/null)" "False" yes
SOUT=$(stop_hook)
has  "SPEC_SYNC_OFF: stop omits phase 1"         "$SOUT" "PHASE 1"       no

# Turning the WHOLE feature off must take the sync with it.
cleanup
OUT=$(E2E_AUTORUN_OFF=1 arm "$G commit -m 'change the menu'")
say  "AUTORUN_OFF also disarms the sync"         "$(sync_exists)"        no

# ── the sync half must never take the E2E half down ──────────────────────────
# spec_sync is newer and does more (it shells out to git for a diff). If it
# throws, times out, or is simply absent, the run that WAS earned must still be
# armed. A phase-1 failure that silently cancels phase 2 is strictly worse than
# not having phase 1 at all.
cleanup
BROKEN=$(mktemp -d)
cp -R .claude "$BROKEN/.claude" 2>/dev/null
echo 'import sys; sys.exit(1)' > "$BROKEN/.claude/qa/shared/spec_sync.py"
OUT=$(CLAUDE_PROJECT_DIR="$BROKEN" arm "$G commit -m 'change the menu'")
BPEND="$BROKEN/.claude/.e2e-pending/$SESSION.json"
say  "a broken spec_sync still arms the E2E" "$([ -f "$BPEND" ] && echo yes || echo no)" yes
has  "...and the E2E order survives"        "$OUT" "/niete-e2e menu"     yes
has  "...with no phase 1 claimed"           "$OUT" "PHASE 1"             no
say  "...and the hook still exits 0"        "$?"                         0
rm -rf "$BROKEN"

# A docs-only change selects nothing: no run, and nothing to author either.
cleanup
OUT=$(arm "$G commit -m docs" "README.md")
say  "docs-only commit writes no brief"          "$(sync_exists)"        no

# ── the nudge-once guarantee still holds with two phases ─────────────────────
# Adding a phase must not add a second block. A Stop hook that fires twice is the
# wedge this whole file exists to prevent.
cleanup
arm "$G commit -m 'change the menu'" >/dev/null
FIRST=$(stop_hook)
SECOND=$(stop_hook)
has  "two-phase nudge still blocks once"         "$FIRST"  '"block"'     yes
say  "...and is silent the second time"          "${SECOND:-empty}"      empty

# ── --clear takes the brief with it ──────────────────────────────────────────
# A stale brief is worse than none: it describes a diff that is no longer HEAD,
# so an agent that picks it up authors scenarios for a change already superseded.
cleanup
arm "$G commit -m 'change the menu'" >/dev/null
bash "$ARM" --clear --session "$SESSION" >/dev/null 2>&1
say  "--clear removes the marker"                "$(marker_exists)"      no
say  "--clear removes the sync brief"            "$(sync_exists)"        no

cleanup

echo "  ---"
if [ "$FAILED" = "0" ]; then
  echo "  all cases pass"
  exit 0
fi
echo "  $FAILED case(s) failing"
exit 1
