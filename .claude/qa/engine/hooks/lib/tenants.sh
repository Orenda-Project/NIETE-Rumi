#!/bin/bash
# lib/tenants.sh — bash face of bin/tenants_lite.py. Sourced by every engine hook and script (bd-9157r).
#
# Provides:
#   e2e_engine            …/.claude/qa/engine   (from this file's location; NO realpath — fixtures symlink the engine)
#   e2e_engine_bin        …/.claude/qa/engine/bin
#   e2e_root [START]      the repo root: a guarded START, else CLAUDE_PROJECT_DIR (a guarded repo, or a nested clone a
#                         workspace above carries a layer for), else walk up from START/$PWD, else the engine's own parent. Returns 1 (prints nothing) when no manifest is found —
#                         callers treat that as "not a guarded repo" and exit 0 silently.
#   e2e_get KEY           one manifest value (dotted keys ok; lists one per line; absent → empty, rc 1)
#   e2e_tenant_get ID KEY one tenant field
#   e2e_tenants           tenant ids, one per line, manifest order
#   e2e_cmd · e2e_spec_dir · e2e_layer (tenant layer dir) · e2e_abs KEY (spec_abs, drivers_abs, config_abs, agents_abs,
#                         fixtures_abs, ledgers_abs, results_abs, pending_abs — absolute, valid in both layouts)
#
# Everything here is best-effort and never fails the caller's `set -e`: python errors go to /dev/null and the
# function returns non-zero.
_E2E_LIB_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)

e2e_engine()     { printf '%s' "$(cd "$_E2E_LIB_DIR/../.." 2>/dev/null && pwd)"; }
e2e_engine_bin() { printf '%s/bin' "$(e2e_engine)"; }

e2e_root() {
  local d
  # an EXPLICIT start that is itself a guarded repo wins (same precedence as tenants_lite.repo_root)
  if [ -n "${1:-}" ] && [ -f "$1/.claude/qa/config/tenants.yaml" ]; then printf '%s' "$1"; return 0; fi
  if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -f "$CLAUDE_PROJECT_DIR/.claude/qa/config/tenants.yaml" ]; then
    printf '%s' "$CLAUDE_PROJECT_DIR"; return 0
  fi
  # CLAUDE_PROJECT_DIR as a NESTED CLONE (workspace mode) — before the cwd walk: a vendored engine's tests run with cwd
  # inside a guarded bot repo, and the session's project dir must still win. Cheap walk first, python only on a hit.
  if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR" ]; then
    d=$(dirname "$CLAUDE_PROJECT_DIR")
    while [ -n "$d" ] && [ "$d" != "/" ]; do
      if [ -d "$d/.claude/qa/tenants" ]; then
        local r; r=$(python3 "$(e2e_engine_bin)/tenants_lite.py" --root "$CLAUDE_PROJECT_DIR" --get root 2>/dev/null) && [ -n "$r" ] && { printf '%s' "$r"; return 0; }
        break
      fi
      d=$(dirname "$d")
    done
  fi
  d="${1:-$PWD}"
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    [ -f "$d/.claude/qa/config/tenants.yaml" ] && { printf '%s' "$d"; return 0; }
    # WORKSPACE mode: a checkout above carries .claude/qa/tenants/<name>/ — the reader matches the nested clone by origin
    if [ -d "$d/.claude/qa/tenants" ]; then
      local r; r=$(python3 "$(e2e_engine_bin)/tenants_lite.py" --root "${1:-$PWD}" --get root 2>/dev/null) && [ -n "$r" ] && { printf '%s' "$r"; return 0; }
    fi
    d=$(dirname "$d")
  done
  d="$(e2e_engine)"; d="${d%/.claude/qa/engine}"
  [ -f "$d/.claude/qa/config/tenants.yaml" ] && { printf '%s' "$d"; return 0; }
  return 1
}
# e2e_layer → the tenant layer dir (<repo>/.claude/qa in repo mode, <ws>/.claude/qa/tenants/<name> in workspace mode)
e2e_layer()      { e2e_get layer_dir; }
_e2e_tl() {
  local root; root=$(e2e_root) || return 1
  python3 "$(e2e_engine_bin)/tenants_lite.py" --root "$root" "$@" 2>/dev/null
}
e2e_get()        { _e2e_tl --get "$1"; }
e2e_tenant_get() { _e2e_tl --tenant "$1" --get "$2"; }
e2e_tenants()    { _e2e_tl --list-tenants; }
e2e_cmd()        { e2e_get command; }
e2e_spec_dir()   { e2e_get spec_dir; }
e2e_abs()        { e2e_get "$1"; }
e2e_tool()       { _e2e_tl --tool "$1"; }
