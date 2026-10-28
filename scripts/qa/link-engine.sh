#!/bin/bash
# link-engine.sh — make the SHARED E2E engine visible to this clone, and point git at the hooks.
#
# The harness is authored ONCE, in rumi-agent-home at .claude/qa/engine. This repo carries no copy
# of it. It owns its own test content — the Gherkin specs, the mock-lane drivers, the cassette
# fixtures and the tenant config — and borrows the engine that runs them.
#
# The bridge is one symlink at .claude/qa/engine, gitignored and created here. Every path in this
# repo's scripts, hooks, docs and specs keeps working unchanged, and nothing about the engine is
# committed here, so it can never drift from the source.
#
#   bash scripts/qa/link-engine.sh            # link + install hooks (one line of output)
#   bash scripts/qa/link-engine.sh --quiet    # what `npm install` runs, via the `prepare` script
#   bash scripts/qa/link-engine.sh --unlink   # remove the link, leave the repo untouched
#
# Where it looks for the engine, in order:
#   $E2E_ENGINE                          an explicit path, for an unusual layout or a CI job
#   <ancestor>/.claude/qa/engine         the workspace that holds this clone — the normal case
#   <ancestor>/rumi-agent-home/.claude/qa/engine   a sibling clone of the harness repo
#
# NEVER exits non-zero for something the developer did not cause: no workspace above the clone, a
# CI checkout, a core.hooksPath that belongs to someone else. `npm install` must not fail over a QA
# nicety, and a machine without the harness must still be able to commit.
QUIET=0; UNLINK=0
for a in "$@"; do
  case "$a" in
    --quiet) QUIET=1 ;; --unlink) UNLINK=1 ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  esac
done
say() { [ "$QUIET" = 1 ] || echo "$@"; }
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
LINK="$ROOT/.claude/qa/engine"

# the skill and command links this script makes all point through .claude/qa/engine; anything else is the repo's own
ours() { [ -L "$1" ] && case "$(readlink "$1")" in *qa/engine/*) return 0;; esac; return 1; }
if [ "$UNLINK" = 1 ]; then
  for l in "$ROOT"/.claude/skills/* "$ROOT"/.claude/commands/*.md; do ours "$l" && rm -f "$l"; done
  [ -L "$LINK" ] && { rm -f "$LINK"; say "qa: engine link removed"; }
  exit 0
fi

# ── find the shared engine ───────────────────────────────────────────────────
is_engine() { [ -f "$1/ENGINE_VERSION" ] && [ -d "$1/githooks" ] && [ -d "$1/bin" ]; }
TARGET=""
if [ -n "${E2E_ENGINE:-}" ] && is_engine "$E2E_ENGINE"; then
  TARGET=$(cd "$E2E_ENGINE" && pwd)
else
  d=$(dirname "$ROOT")
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    for c in "$d/.claude/qa/engine" "$d/rumi-agent-home/.claude/qa/engine"; do
      if is_engine "$c"; then TARGET=$(cd "$c" && pwd); break; fi
    done
    [ -n "$TARGET" ] && break
    d=$(dirname "$d")
  done
fi

if [ -z "$TARGET" ]; then
  # Not an error: this machine simply does not have the harness checked out next to the repo.
  say "qa: the shared E2E engine is not on this machine, so the mock lane is off here."
  say "    It lives in rumi-agent-home at .claude/qa/engine. Clone that repo so this one sits"
  say "    inside it (or beside it), then re-run: bash scripts/qa/link-engine.sh"
  exit 0
fi

# ── link it in, relatively where possible so the link survives a moved workspace ─────
mkdir -p "$(dirname "$LINK")" 2>/dev/null || exit 0
REL=$(python3 -c 'import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "$TARGET" "$(dirname "$LINK")" 2>/dev/null) || REL="$TARGET"
CUR=""; [ -L "$LINK" ] && CUR=$(readlink "$LINK")
if [ -d "$LINK" ] && [ ! -L "$LINK" ]; then
  say "qa: .claude/qa/engine is a real directory here (a vendored copy), left alone."
else
  [ "$CUR" = "$REL" ] || { ln -sfn "$REL" "$LINK" || exit 0; }
fi

# ── the engine's skills and slash commands, loadable in a session opened INSIDE this repo (bd-9157r.3) ──────────
# One link per skill dir / command file, through .claude/qa/engine (so a moved workspace still resolves), and only
# where this repo has nothing of its own by that name. Never committed: each linked path goes in this clone's own
# .git/info/exclude — local, never pushed — beside the engine link itself.
EXCL=$(git -C "$ROOT" rev-parse --git-path info/exclude 2>/dev/null)
case "$EXCL" in /*|"") ;; *) EXCL="$ROOT/$EXCL";; esac
exclude() { [ -n "$EXCL" ] || return 0; mkdir -p "$(dirname "$EXCL")" 2>/dev/null
            grep -qxF "$1" "$EXCL" 2>/dev/null || printf '%s\n' "$1" >> "$EXCL" 2>/dev/null; }
exclude "/.claude/qa/engine"
link_item() {   # $1 kind (skills|commands) · $2 name — links .claude/<kind>/<name> → ../qa/engine/<kind>/<name>
  local dest="$ROOT/.claude/$1/$2" want="../qa/engine/$1/$2"
  if [ -e "$dest" ] || [ -L "$dest" ]; then ours "$dest" || return 0; fi   # the repo's own: never shadowed
  mkdir -p "$ROOT/.claude/$1" 2>/dev/null || return 0
  [ "$(readlink "$dest" 2>/dev/null)" = "$want" ] || ln -sfn "$want" "$dest" 2>/dev/null
  exclude "/.claude/$1/$2"
}
for d in "$TARGET"/skills/*/;      do [ -d "$d" ] && link_item skills "$(basename "$d")"; done
for f in "$TARGET"/commands/*.md;  do [ -f "$f" ] && link_item commands "$(basename "$f")"; done

# ── point git at this repo's own hooks dir ───────────────────────────────────
# .githooks stays INSIDE the repo on purpose: a core.hooksPath pointing into another tree breaks as
# soon as that tree moves, and has already cost us a wedged push once.
if [ -d "$ROOT/.githooks" ]; then
  H=$(git -C "$ROOT" config --get core.hooksPath 2>/dev/null)
  if [ -z "$H" ]; then
    git -C "$ROOT" config core.hooksPath .githooks 2>/dev/null
  elif [ "$H" != ".githooks" ]; then
    say "qa: core.hooksPath is '$H', not ours — left alone. Commits will not arm the E2E here."
    say "    To use ours: git config core.hooksPath .githooks"
  fi
  chmod +x "$ROOT/.githooks/"* 2>/dev/null
fi
say "qa: engine linked ($REL) · its skills + commands too · commits in this clone now arm the targeted E2E and run the mock lane"
exit 0
