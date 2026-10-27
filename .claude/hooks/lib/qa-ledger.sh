#!/bin/bash
# qa-ledger.sh — one JSON line each time the QA pipeline is switched off, gives
# up on a stale spec, or has a marker cleared (bd-61jjzd).
#
# From 2026-10-17 most sandbox PRs landed with stale Gherkin specs and no machine
# could say why: the off switches exited silently, the Stop hook's give-up was one
# stderr line, and `--clear --force` left nothing. Each of those now writes here.
#
# Where: <git common dir>/qa-events.jsonl — one file per clone, shared by all its
# worktrees, outside the tree (never committed, survives `git worktree remove`).
# QA_LEDGER=<path> overrides it.
#
# Line: {"ts","hook","event","switch","detail","sha","branch","user","cwd"}
#   event: switch-off | gave-up | cleared | force-cleared
#
# Never fails its caller: every path returns 0 and writes nothing to stdout.

qa_ledger_path() {   # $1 a directory inside the clone
  if [ -n "${QA_LEDGER:-}" ]; then printf '%s' "$QA_LEDGER"; return 0; fi
  local d
  d=$(git -C "${1:-.}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  [ -n "$d" ] || return 1
  printf '%s/qa-events.jsonl' "$d"
}

_qa_ledger_esc() {   # JSON string body: backslash, quote, control characters → space
  local s="${1//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s" | tr '\000-\037' ' '
}

qa_ledger_log() {    # $1 dir · $2 hook · $3 event · $4 switch (may be "") · $5 detail (may be "")
  local dir="${1:-.}" f sha branch user ts
  f=$(qa_ledger_path "$dir") || return 0
  sha=$(git -C "$dir" rev-parse --short=12 HEAD 2>/dev/null)
  branch=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null)
  user=$(git -C "$dir" config user.name 2>/dev/null)
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '{"ts":"%s","hook":"%s","event":"%s","switch":"%s","detail":"%s","sha":"%s","branch":"%s","user":"%s","cwd":"%s"}\n' \
    "$ts" "$(_qa_ledger_esc "$2")" "$(_qa_ledger_esc "$3")" "$(_qa_ledger_esc "${4:-}")" "$(_qa_ledger_esc "${5:-}")" \
    "$sha" "$(_qa_ledger_esc "$branch")" "$(_qa_ledger_esc "$user")" "$(_qa_ledger_esc "$(cd "$dir" 2>/dev/null && pwd)")" \
    >> "$f" 2>/dev/null
  return 0
}
