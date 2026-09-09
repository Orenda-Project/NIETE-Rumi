#!/bin/bash
# Shared `git push` detection for the pre-push gate and the E2E auto-run hooks.
#
# EXTRACTED, not copied, and that is the whole point. This matcher took three
# defects and two rounds of fixture archaeology to get right (see the comments
# below and `pre-push-qa-check.test.sh`). A second hook carrying its own copy
# would drift from this one within a month, and the drift would be silent —
# one hook arming while the other blocks, or neither firing on a real push.
#
# Sourced, not executed. Provides:
#   strip_heredocs           <stdin  → stdout, heredoc BODIES removed
#   is_git_push        SCAN         → 0 when SCAN contains a real push
#   push_targets_deploy_branch SCAN → 0 when that push targets develop/main/staging

# Strip heredoc BODIES before matching.
#
# grep matches per line, so `^` anchors at every newline — which means a heredoc
# that WRITES documentation about pushing is indistinguishable from a push whenever
# the prose happens to start a line with the command. Anchoring alone does not fix
# that; the body has to be removed from consideration entirely.
#
# Found 2026-08-10, twice over: the gate blocked its own test matrix, and the
# earlier fixture that "proved" the anchoring worked had a `run ` prefix on the
# heredoc line, so it dodged the exact case it claimed to cover. A test that passes
# because of an accident in its fixture is not a test.
#
# awk tracks the delimiter from `<<WORD`, `<<'WORD'`, `<<"WORD"` and `<<-WORD`, and
# drops every line until the terminator. If awk is unavailable the original string
# is used, which fails CLOSED (still matches) rather than waving a real push through.
strip_heredocs() {
  awk '
    { line = $0 }
    inbody {
      t = line; sub(/^[ \t]+/, "", t)
      if (t == delim) { inbody = 0 }
      next
    }
    {
      if (match(line, /<<-?[ \t]*"[^"]+"/) || match(line, /<<-?[ \t]*'"'"'[^'"'"']+'"'"'/) \
          || match(line, /<<-?[ \t]*[A-Za-z_][A-Za-z0-9_]*/)) {
        d = substr(line, RSTART, RLENGTH)
        gsub(/^<<-?[ \t]*/, "", d); gsub(/["'"'"']/, "", d)
        if (d != "") { delim = d; inbody = 1 }
      }
      print line
    }
  ' 2>/dev/null
}

# The `git <options>` prefix every matcher below accepts between `git` and the
# subcommand — `-C <dir>`, `-c key=value`, `--no-pager`, and so on.
#
# THE OPTION VALUE MAY BE QUOTED. It used to be `[^[:space:]]+`, so
# `git -c user.name="Mah Noor" commit` and `git -C "/My Projects/NIETE-Rumi" commit`
# matched nothing and the auto-run stayed silent with no warning (2026-09-06).
# Most developer checkouts of this repo sit under a path with spaces, so the -C
# form is the ordinary case, not an edge. A double-quoted string, a single-quoted
# string — with or without a bare prefix such as `user.name=` — or a bare token
# each count as one value.
_GIT_OPTVAL='([^[:space:]"'"'"']*("[^"]*"|'"'"'[^'"'"']*'"'"')|[^[:space:]]+)'
_GIT_OPTS="([[:space:]]+(-[A-Za-z-]+|--[A-Za-z-]+)([[:space:]]+$_GIT_OPTVAL)?)*"

# A REAL `git push` invocation targeting staging / main / origin.
#
# Anchored to a command boundary so a commit message or a grep pattern that merely
# MENTIONS pushing is not matched.
#
# `([A-Za-z_]\w*=\S* )*` — inline env assignments count as part of the boundary.
# Without this, `SKIP_QA=1 git push origin develop` did NOT match: the leading
# assignment is not `^`, `;`, `&&` or `|`. That is the form this repo's own
# pre-push block message instructs people to type, so it is the MOST common real
# push here — and the auto-run hook, which has no earlier SKIP_QA short-circuit to
# hide behind, armed on approximately nothing. The pre-push gate never exposed the
# gap because it handles SKIP_QA before the matcher ever runs.
#
# Side effect, and it is the correct one: a non-SKIP_QA env-prefixed push (e.g.
# `GIT_TRACE=1 git push origin main`) is now gated too. It always should have been.
is_git_push() {
  printf '%s' "$1" | grep -qE '(^|[;&|]|&&|\|\||[[:space:]]-[[:space:]])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git'"$_GIT_OPTS"'[[:space:]]+push([[:space:]]|$)' \
    && printf '%s' "$1" | grep -qE 'git'"$_GIT_OPTS"'[[:space:]]+push[^|;&]*\b(staging|main|origin)\b'
}

# A command that PRODUCES A COMMIT — `git commit` or `git merge`.
#
# Same boundary rules as is_git_push, including the inline-env-assignment prefix.
# This is the PRIMARY auto-run trigger (bd-43513, operator: "commit any change
# then hook should trigger").
#
# `git merge` IS included, and that is not a detail. The develop -> main
# promotion is a merge, and it is the one event that earns the full 99-scenario
# suite (bd-43559). Matching only `git commit` made the promotion invisible —
# and worse, made the "develop merge stays silent" test pass for the wrong
# reason: the matcher never fired, so nothing exercised the merge-has-no-work
# rule it claimed to cover. Merges still produce no targeted run (empty diff);
# they arm only where `full_suite_on` says so.
#
# Deliberately NOT branch-filtered: a commit deploys nothing on any branch, so
# filtering here would only make the trigger fire less than was asked for.
#
# `git commit-tree` / `git mergetool` must not match, hence the `([[:space:]]|$)`.
is_git_commit() {
  printf '%s' "$1" | grep -qE '(^|[;&|]|&&|\|\||[[:space:]]-[[:space:]])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git'"$_GIT_OPTS"'[[:space:]]+(commit|merge)([[:space:]]|$)'
}

# Narrower: does this push land on a branch that actually DEPLOYS?
#
# The auto-run needs this and the blocking gate does not. `git push origin
# bd-1234-my-branch` matches `is_git_push` (it says "origin"), but nothing deploys,
# so there is no new code on staging to drive an E2E against — arming a run there
# would burn ~10 minutes of WhatsApp drive to test the build that was already live.
#
# NIETE-Rumi's work branch is `sandbox` since 2026-09-08 (root CLAUDE.md Rule 7:
# sandbox -> staging -> main); `develop` is frozen and deploys nowhere but stays in the
# pattern so a push to it is surfaced rather than silently ignored. `main` and
# `staging` are covered for the other repos worked from this workspace.
push_targets_deploy_branch() {
  # `(\b|:)` is NOT portable. GNU and BSD grep accept it; ugrep rejects it as an
  # "empty (sub)expression" and the whole match returns false — so on a machine
  # where ugrep is first on PATH the push trigger silently never fires. Same class
  # as the BSD-sed bug earlier here: a regex that happens to work on one box.
  # (Not currently active on the author's machine — `grep` there is a zsh function
  # the hook's bash never sees — which is exactly why it would have gone unnoticed.)
  #
  # An explicit character class says the same thing everywhere: the branch name is
  # preceded by a space or the `:` of a `HEAD:develop` refspec, and followed by a
  # separator or end of string.
  printf '%s' "$1" \
    | grep -qE 'git'"$_GIT_OPTS"'[[:space:]]+push[^|;&]*[[:space:]:](develop|main|staging|sandbox)([[:space:]:]|$)'
}

# ── the E2E selector, invoked identically by both hooks ──────────────────────
#
# Same reasoning as the matcher above: one copy. The pre-push gate prints the
# selection as text; the auto-run hook needs the same decision as JSON. If those
# two ever disagreed about which features a diff earns, the advisory and the
# enforcement would contradict each other, which is worse than either alone.

# Resolve the repository a push is operating on.
#   $1 = the (heredoc-stripped) command   $2 = the hook payload's cwd
# An explicit `cd <dir> && …` wins, then the payload cwd, then ours. Without this
# a `cd NIETE-Rumi && git push` is diffed against the wrong repo.
e2e_resolve_repo() {
  local scan="$1" payload_cwd="${2:-}" cand root base line dir
  local candidates="" now age ref

  # Collect EVERY `cd <dir>` in the command, not just one followed by `&&`.
  #
  # The single-line `cd X && git push` assumption produced a confidently wrong
  # answer for an ordinary multi-line script (caught live 2026-08-21): it fell
  # through to the payload cwd and armed a run for a repo nobody had pushed.
  # Relative `cd`s are resolved cumulatively, so `cd /tmp/x` then `cd repo` lands
  # at /tmp/x/repo. Later entries are tried FIRST — the last cd before a push is
  # usually the operative one.
  local cd_tops=""
  base="${payload_cwd:-$PWD}"
  while IFS= read -r line; do
    dir=$(printf '%s' "$line" | sed -nE "s/^[[:space:]]*cd[[:space:]]+['\"]?([^'\";&|]*)['\"]?.*/\1/p")
    [ -n "$dir" ] || continue
    # trim the trailing quote / whitespace the greedy capture drags in
    dir=${dir%\'}; dir=${dir%\"}
    while [ "${dir% }" != "$dir" ] || [ "${dir%	}" != "$dir" ]; do dir=${dir% }; dir=${dir%	}; done
    [ -n "$dir" ] || continue
    case "$dir" in /*) base="$dir" ;; *) base="$base/$dir" ;; esac
    candidates="$base
$candidates"
    cd_tops="$base
$cd_tops"
  done <<EOF
$(printf '%s' "$scan" | tr ';&|' '\n\n\n')
EOF
  # `git -C <dir>` NAMES THE REPO, and it is at least as explicit as a `cd`.
  #
  # Missing this made the PR that "fixed" the -C form a half-fix: the matcher
  # accepted `git -C dir commit`, then the resolver ignored the -C and mapped the
  # payload cwd's diff instead — firing on the WRONG REPO. It looked fine only
  # because the wrong repo's HEAD happened to be a merge (empty diff, so silent).
  # A different HEAD would have armed the wrong features, confidently.
  #
  # Appended AFTER the cd candidates so an explicit `cd` still wins: the shell
  # actually moved there, whereas -C is a per-invocation flag.
  local cdash
  # Quoted first: a path with spaces (this repo's usual checkout) is exactly the
  # case that needs the quotes. The bare form is the fallback.
  cdash=$(printf '%s' "$scan" | sed -nE 's/.*git[[:space:]]+(-[^C ][^ ]*[[:space:]]+)*-C[[:space:]]+"([^"]+)".*/\2/p' | head -1)
  [ -n "$cdash" ] || cdash=$(printf '%s' "$scan" | sed -nE "s/.*git[[:space:]]+(-[^C ][^ ]*[[:space:]]+)*-C[[:space:]]+'([^']+)'.*/\2/p" | head -1)
  [ -n "$cdash" ] || cdash=$(printf '%s' "$scan" \
    | sed -nE "s/.*git[[:space:]]+(-[^C ][^ ]*[[:space:]]+)*-C[[:space:]]+([^'\";&|[:space:]]+).*/\2/p" | head -1)
  if [ -n "$cdash" ]; then
    case "$cdash" in /*) ;; *) cdash="${payload_cwd:-$PWD}/$cdash" ;; esac
    cd_tops="$cd_tops$cdash
"
    candidates="$candidates$cdash
"
  fi

  candidates="$candidates$payload_cwd
$PWD"

  # Reduce to git toplevels, in order, deduped.
  local tops="" t
  while IFS= read -r cand; do
    [ -n "$cand" ] && [ -d "$cand" ] || continue
    t=$(git -C "$cand" rev-parse --show-toplevel 2>/dev/null) || continue
    case "
$tops" in *"
$t
"*) continue ;; esac
    tops="$tops$t
"
  done <<EOF
$candidates
EOF
  [ -n "$tops" ] || return 1

  # AN EXPLICIT `cd` WINS OUTRIGHT.
  #
  # The freshly-pushed check below observes reality rather than parsing syntax,
  # which is why it exists — but it used to run FIRST, so any repo pushed in the
  # last 120s beat the repo the command actually named. Push anything, then
  # `cd other-repo && git commit` within two minutes, and the hook armed features
  # for the repo you PUSHED. It also made the test suite flaky at ~1 run in 5:
  # pushing the working branch made $PWD "fresh", so temp-repo cases resolved to
  # the worktree.
  #
  # Freshness is a TIE-BREAKER for the ambiguous candidates (payload cwd, $PWD),
  # never an override of an explicit instruction.
  local t2
  while IFS= read -r t2; do
    [ -n "$t2" ] && [ -d "$t2" ] || continue
    t2=$(git -C "$t2" rev-parse --show-toplevel 2>/dev/null) || continue
    case "
$tops" in *"
$t2
"*) printf '%s' "$t2"; return 0 ;; esac
  done <<EOF
$cd_tops
EOF

  # No explicit cd: prefer whichever candidate was ACTUALLY just pushed. A push
  # stamps its tracking ref's reflog, so this is an observation of what happened.
  now=$(date +%s)
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    ref=$(git -C "$t" rev-parse --abbrev-ref '@{upstream}' 2>/dev/null) || continue
    [ -n "$ref" ] || continue
    # A PULL IS NOT A PUSH. This read the timestamp and never looked at what the
    # entry SAID — but a pull writes to the same reflog:
    #     origin/main@{...}: pull --ff-only origin main: fast-forward
    # so for 120s after ANY pull or fetch that repo looked freshly pushed and
    # hijacked resolution. Root cause of every flake in this suite, including two
    # I twice reported as unreproducible. git writes the literal "update by push"
    # for a push, and "fetch …" / "pull …" for the others.
    top=$(git -C "$t" reflog show --date=unix "$ref" 2>/dev/null | head -1)
    case "$top" in *"update by push"*) ;; *) continue ;; esac
    age=$(printf '%s' "$top" | sed -nE 's/.*@\{([0-9]+)\}.*/\1/p')
    [ -n "$age" ] || continue
    if [ $((now - age)) -lt 120 ]; then printf '%s' "$t"; return 0; fi
  done <<EOF
$tops
EOF

  # Nothing pushed recently — fall back to first candidate (prior behaviour).
  printf '%s' "$(printf '%s' "$tops" | head -1)"
}

# Run the selector. Echoes its output, or nothing at all on any failure.
#   $1 = project root   $2 = repo dir (may be empty)   $3 = extra flag e.g. --json
#
# FAILS SILENT, ALWAYS. Missing PyYAML, an inconsistent map, a git range that
# won't resolve — none of that is evidence about the push. A checker that speaks
# up for its own reasons gets switched off within a day.
e2e_run_selector() {
  local project_root="$1" repo="${2:-}" extra="${3:-}"
  local bin="$project_root/.claude/qa/shared/select_e2e.py"
  command -v python3 >/dev/null 2>&1 || return 1
  [ -f "$bin" ] || return 1

  if [ -n "${E2E_SELECT_FILES:-}" ]; then
    printf '%s\n' "$E2E_SELECT_FILES" \
      | python3 "$bin" --stdin --repo-name "$(basename "${repo:-$PWD}")" $extra 2>/dev/null
  elif [ -n "$repo" ]; then
    python3 "$bin" --repo "$repo" $extra 2>/dev/null
  else
    return 1
  fi
}

# ── the Gherkin spec sync brief (bd-59809) ───────────────────────────────────
#
# Phase 1 of the auto-run. Turns the selection the caller ALREADY made into the
# brief the agent authors from: per feature, the changed files, a bounded diff,
# and the scenarios the spec already has.
#
# THE SELECTION IS PASSED IN, NOT RECOMPUTED. The caller has it — it is what
# decided which `/niete-e2e` commands to arm. Recomputing here would let the two
# halves disagree about which features a commit touched, arming a run for one set
# while authoring specs for another. Same reasoning as extracting the matcher.
#
#   $1 = project root   $2 = repo dir   $3 = selection JSON   $4 = "committed"|""
# Echoes the brief JSON, or nothing at all on any failure.
#
# FAILS SILENT, like e2e_run_selector. A brief we could not build is not a reason
# to interrupt anyone — the E2E half is armed either way, and a phase that
# complains for its own reasons gets switched off within a day.
e2e_run_spec_sync() {
  local project_root="$1" repo="${2:-}" selection="$3" mode="${4:-}"
  local bin="$project_root/.claude/qa/shared/spec_sync.py"
  command -v python3 >/dev/null 2>&1 || return 1
  [ -f "$bin" ] || return 1
  [ -n "$selection" ] || return 1

  local flag=""
  [ "$mode" = "committed" ] && flag="--committed"

  printf '%s' "$selection" \
    | python3 "$bin" --selection - --repo "${repo:-.}" $flag --json 2>/dev/null
}

# ── PHASE 1 GATE helpers (bd-zqtgs) ──────────────────────────────────────────
# The Stop hook used to ask "was this marker nudged?" and never "did the spec
# change?". These make the second question answerable from the marker alone:
# arming records a hash of each spec the brief says must be authored; Stop
# compares. A feature is STALE when its hash is unchanged and nothing declared
# the change spec-neutral (`--declare`, or a `Spec-Sync:` trailer on HEAD).

e2e_spec_hash() {   # $1 file → sha256 hex, or "" when the file does not exist
  [ -f "$1" ] || { printf ''; return 0; }
  shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1
}

# e2e_spec_hashes_json PROJECT_ROOT BRIEF_JSON → {"feature":{"hash":…,"path":…}}
# Only features the brief says to author (action create/update, not only_shared).
e2e_spec_hashes_json() {
  local root="$1" brief="$2" out="{" first=1 f p h
  [ -n "$brief" ] || { printf '{}'; return 0; }
  while IFS=$'\t' read -r f p; do
    [ -n "$f" ] || continue
    h=$(e2e_spec_hash "$root/$p")
    [ "$first" = 1 ] || out="$out,"
    out="$out$(jq -cn --arg f "$f" --arg h "$h" --arg p "$p" '{($f):{hash:$h,path:$p}}' | sed 's/^{//;s/}$//')"
    first=0
  done <<EOF2
$(printf '%s' "$brief" | jq -r '.features[]? | select(.action != "validate-only" and (.only_shared // false) == false) | "\(.feature)\t\(.spec_path)"' 2>/dev/null)
EOF2
  printf '%s}' "$out"
}

# e2e_phase1_declared MARKER CWD → space-separated features declared none-needed
# ('*' = all). Sources: the marker's spec_declared (written by --declare) and a
# `Spec-Sync:` trailer on HEAD of the repo at CWD — the same trailer impact.py
# and the PR check honour, so one declaration satisfies every layer.
e2e_phase1_declared() {
  local marker="$1" cwd="${2:-}" out="" line
  out=$(jq -r '.spec_declared // {} | keys[]' "$marker" 2>/dev/null | tr '\n' ' ')
  if [ -n "$cwd" ] && git -C "$cwd" rev-parse HEAD >/dev/null 2>&1; then
    line=$(git -C "$cwd" log -1 --format=%B 2>/dev/null | grep -iE '^[[:space:]]*Spec-Sync:' | head -1 \
           | sed -E 's/^[[:space:]]*[Ss][Pp][Ee][Cc]-[Ss][Yy][Nn][Cc]:[[:space:]]*//')
    case "$line" in
      "") ;;
      *=*none-needed*) out="$out $(printf '%s' "$line" | sed -E 's/[[:space:]]*=.*$//' | tr ',' ' ')" ;;
      *none-needed*)   out="$out *" ;;
    esac
  fi
  printf '%s' "$out"
}

# e2e_spec_repo PROJECT_ROOT CWD → the git checkout the specs live in ("" if none).
# Normally PROJECT_ROOT == the clone. Test fixtures sometimes keep specs outside any
# repo; then the HEAD comparison below falls back to the working tree.
e2e_spec_repo() {
  local root="$1" cwd="${2:-}" d
  for d in "$root" "$cwd"; do
    [ -n "$d" ] || continue
    [ -d "$d/tests/features/whatsapp/niete" ] || continue
    git -C "$d" rev-parse --show-toplevel >/dev/null 2>&1 && { printf '%s' "$d"; return 0; }
  done
  printf ''
}

# e2e_spec_head_hash REPO PATH → sha256 of the spec AS COMMITTED at HEAD ("" if absent)
e2e_spec_head_hash() {
  git -C "$1" cat-file -e "HEAD:$2" 2>/dev/null || { printf ''; return 0; }
  git -C "$1" show "HEAD:$2" 2>/dev/null | shasum -a 256 | cut -d' ' -f1
}

# e2e_spec_disk_hash PROJECT_ROOT CWD PATH → sha256 of the spec in the working tree
e2e_spec_disk_hash() {
  local root="$1" cwd="${2:-}" p="$3"
  if [ -f "$root/$p" ]; then e2e_spec_hash "$root/$p"
  elif [ -n "$cwd" ] && [ -f "$cwd/$p" ]; then e2e_spec_hash "$cwd/$p"
  else printf ''; fi
}

# _e2e_phase1_scan PROJECT_ROOT MARKER CWD MODE → features per MODE:
#   stale        the COMMITTED spec (HEAD) is byte-identical to arming — the PR check
#                reads commits, so this is what "not done" means. Includes specs that
#                were edited but never committed.
#   uncommitted  HEAD unchanged but the working tree differs: authored, not committed.
#   disk-same    working tree identical to arming (nothing to validate).
# Declared features are skipped in every mode. Outside any git repo, HEAD == disk.
_e2e_phase1_scan() {
  local root="$1" marker="$2" cwd="${3:-}" mode="$4" declared repo f h p disk head out=""
  [ -f "$marker" ] || return 0
  [ "$(jq -r '.spec_sync // false' "$marker" 2>/dev/null)" = "true" ] || return 0
  jq -e '.spec_hashes | type == "object" and length > 0' "$marker" >/dev/null 2>&1 || return 0
  declared=" $(e2e_phase1_declared "$marker" "$cwd") "
  repo=$(e2e_spec_repo "$root" "$cwd")
  while IFS=$'\t' read -r f h p; do
    [ -n "$f" ] || continue
    case "$declared" in *" $f "*|*" * "*) continue ;; esac
    [ -n "$p" ] || p="tests/features/whatsapp/niete/$f.feature"
    disk=$(e2e_spec_disk_hash "$root" "$cwd" "$p")
    if [ -n "$repo" ]; then head=$(e2e_spec_head_hash "$repo" "$p"); else head="$disk"; fi
    case "$mode" in
      stale)       [ "$head" = "$h" ] && out="$out $f" ;;
      uncommitted) [ "$head" = "$h" ] && [ "$disk" != "$h" ] && out="$out $f" ;;
      disk-same)   [ "$disk" = "$h" ] && out="$out $f" ;;
    esac
  done <<EOF2
$(jq -r '.spec_hashes | to_entries[] | "\(.key)\t\(.value.hash // "")\t\(.value.path // "")"' "$marker" 2>/dev/null)
EOF2
  printf '%s' "${out# }"
}

# e2e_phase1_stale PROJECT_ROOT MARKER CWD → features whose COMMITTED spec is still
# what it was at arming and which nobody declared. Empty = phase 1 satisfied (or the
# marker predates the gate). "Committed" is the unit because the PR check
# (qa-impact.yml) judges commits — an edit left in the working tree would pass
# this gate and then fail the PR (bd-1p4m6).
e2e_phase1_stale() { _e2e_phase1_scan "$1" "$2" "${3:-}" stale; }
# e2e_phase1_uncommitted … → the subset that IS edited on disk but not committed.
e2e_phase1_uncommitted() { _e2e_phase1_scan "$1" "$2" "${3:-}" uncommitted; }

# e2e_phase1_invalid PROJECT_ROOT MARKER CWD → validator output for the specs that
# DID change but do not pass validate_specs.py; empty when they all pass.
e2e_phase1_invalid() {
  local root="$1" marker="$2" cwd="${3:-}" declared stale feats="" f out rc
  [ -f "$marker" ] || return 0
  jq -e '.spec_hashes | type == "object" and length > 0' "$marker" >/dev/null 2>&1 || return 0
  command -v python3 >/dev/null 2>&1 || return 0
  [ -f "$root/.claude/qa/shared/validate_specs.py" ] || return 0
  declared=" $(e2e_phase1_declared "$marker" "$cwd") "
  # validate what is on disk: anything that differs from arming (committed or not)
  stale=" $(_e2e_phase1_scan "$root" "$marker" "$cwd" disk-same) "
  for f in $(jq -r '.spec_hashes | keys[]' "$marker" 2>/dev/null); do
    case "$declared" in *" $f "*|*" * "*) continue ;; esac
    case "$stale" in *" $f "*) continue ;; esac
    feats="$feats${feats:+,}$f"
  done
  [ -n "$feats" ] || return 0
  out=$(cd "$root" && python3 .claude/qa/shared/validate_specs.py --only "$feats" 2>&1); rc=$?
  [ "$rc" -eq 0 ] && return 0
  printf '%s' "$out" | tail -15
}
