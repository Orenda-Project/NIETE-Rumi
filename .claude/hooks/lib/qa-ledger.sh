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
#   event: switch-off | gave-up | cleared | force-cleared | declared | armed | pushed-stale
#
# Published (bd-amxdhg). The file never leaves the laptop, so "why did this PR miss its
# spec?" meant asking the author to run jq. Each commit's lines (minus cwd) are now also a
# git note on that commit, in refs/notes/qa-hooks, pushed to origin as
# refs/qa-hooks/<clone-id> — one ref per clone, so a clone only ever overwrites its own.
# Pushed at once for switch-off / gave-up / cleared / declared (they can happen after the
# branch was pushed), and for every pushed commit by .githooks/pre-push. The sandbox QA
# dashboard fetches refs/qa-hooks/* and shows the reason next to each missed PR.
#   Off: QA_NOTES_OFF=1 (also off when CI is set).  Backfill a clone:
#   bash .claude/hooks/lib/qa-ledger.sh --publish [dir]
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

qa_ledger_log() {    # $1 dir · $2 hook · $3 event · $4 switch · $5 detail · $6 commit (default HEAD) — 4-6 may be ""
  local dir="${1:-.}" f sha branch user ts
  f=$(qa_ledger_path "$dir") || return 0
  sha=$(git -C "$dir" rev-parse --short=12 "${6:-HEAD}" 2>/dev/null) || sha=$(git -C "$dir" rev-parse --short=12 HEAD 2>/dev/null)
  branch=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null)
  user=$(git -C "$dir" config user.name 2>/dev/null)
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '{"ts":"%s","hook":"%s","event":"%s","switch":"%s","detail":"%s","sha":"%s","branch":"%s","user":"%s","cwd":"%s"}\n' \
    "$ts" "$(_qa_ledger_esc "$2")" "$(_qa_ledger_esc "$3")" "$(_qa_ledger_esc "${4:-}")" "$(_qa_ledger_esc "${5:-}")" \
    "$sha" "$(_qa_ledger_esc "$branch")" "$(_qa_ledger_esc "$user")" "$(_qa_ledger_esc "$(cd "$dir" 2>/dev/null && pwd)")" \
    >> "$f" 2>/dev/null
  # An arming or a push report is published with the push; anything else may come after it.
  case "$3" in armed|pushed-stale) ;; *) [ -n "$sha" ] && qa_notes_publish "$dir" "$sha" ;; esac
  return 0
}

QA_NOTES_REF=refs/notes/qa-hooks

_qa_notes_enabled() {
  [ "${QA_NOTES_OFF:-}" = "1" ] && return 1
  [ -n "${CI:-}" ] && return 1
  git -C "${1:-.}" remote get-url origin >/dev/null 2>&1
}

qa_notes_remote_ref() {   # refs/qa-hooks/<12 hex>: this clone, nothing personal in the name
  local id
  id=$(printf '%s|%s' "$(git -C "${1:-.}" config user.email 2>/dev/null)" \
         "$(git -C "${1:-.}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" | git hash-object --stdin 2>/dev/null)
  [ -n "$id" ] || return 1
  printf 'refs/qa-hooks/%s' "${id:0:12}"
}

qa_notes_write() {        # $1 dir · $2.. commits — rewrite each commit's note from the ledger
  local dir="${1:-.}" f c full lines; shift
  f=$(qa_ledger_path "$dir") || return 0
  [ -f "$f" ] || return 0
  for c in "$@"; do
    full=$(git -C "$dir" rev-parse --verify -q "$c^{commit}" 2>/dev/null) || continue
    lines=$(grep -F "\"sha\":\"${full:0:12}\"" "$f" 2>/dev/null | sed 's/,"cwd":"[^"]*"}$/}/')
    [ -n "$lines" ] || continue
    printf '%s\n' "$lines" | git -C "$dir" notes --ref="$QA_NOTES_REF" add -f -F - "$full" >/dev/null 2>&1
  done
  return 0
}

qa_notes_push() {         # $1 dir — never waits on the network unless QA_NOTES_SYNC=1
  local dir="${1:-.}" ref
  ref=$(qa_notes_remote_ref "$dir") || return 0
  git -C "$dir" rev-parse --verify -q "$QA_NOTES_REF" >/dev/null 2>&1 || return 0
  if [ "${QA_NOTES_SYNC:-}" = "1" ]; then
    GIT_TERMINAL_PROMPT=0 git -C "$dir" push --no-verify -q origin "+$QA_NOTES_REF:$ref" </dev/null >/dev/null 2>&1
  else
    ( GIT_TERMINAL_PROMPT=0 nohup git -C "$dir" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 \
        push --no-verify -q origin "+$QA_NOTES_REF:$ref" </dev/null >/dev/null 2>&1 & ) >/dev/null 2>&1
  fi
  return 0
}

qa_notes_publish() {      # $1 dir · $2.. commits
  _qa_notes_enabled "${1:-.}" || return 0
  qa_notes_write "$@"
  qa_notes_push "${1:-.}"
  return 0
}

# Run directly: publish every commit the ledger mentions (a clone whose history predates this).
if [ "${BASH_SOURCE[0]}" = "$0" ] && [ "${1:-}" = "--publish" ]; then
  _d="${2:-.}"; _f=$(qa_ledger_path "$_d") || exit 0
  [ -f "$_f" ] || { echo "qa-ledger: no ledger at $_f" >&2; exit 0; }
  # shellcheck disable=SC2046
  QA_NOTES_SYNC=1 qa_notes_publish "$_d" $(grep -oE '"sha":"[0-9a-f]+"' "$_f" | cut -d'"' -f4 | sort -u)
  echo "qa-ledger: published notes for $(git -C "$_d" notes --ref="$QA_NOTES_REF" list 2>/dev/null | wc -l | tr -d ' ') commit(s) to $(qa_notes_remote_ref "$_d")" >&2
  exit 0
fi
