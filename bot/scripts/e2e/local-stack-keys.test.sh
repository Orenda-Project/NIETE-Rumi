#!/usr/bin/env bash
# Regression: the keys dir + the record-vs-default keys file must resolve to whichever level actually holds niete-local.env.
# A stray `<main>/keys/` (e.g. one carrying only niete-staging.env) must NOT shadow the
# workspace-level keys/ — the old `[ -d "$KEYS_DIR" ]` check stopped at the empty shadow (exit 14).
set -u
resolve_keys_dir() {   # mirrors local-stack.sh's resolution; $1 = MAIN
  local MAIN="$1"
  local KEYS_DIR="$MAIN/keys"
  [ -f "$KEYS_DIR/niete-local.env" ] || KEYS_DIR="$(dirname "$MAIN")/keys"
  printf '%s' "$KEYS_DIR"
}
fails=0
t() { if [ "$2" = "$3" ]; then echo "  ok  $1"; else echo "  FAIL $1: want [$3] got [$2]"; fails=$((fails+1)); fi; }

tmp="$(mktemp -d)"
mkdir -p "$tmp/ws/main/keys" "$tmp/ws/keys"
# stray shadow: main/keys has only staging; the real file is at the workspace level
: > "$tmp/ws/main/keys/niete-staging.env"
: > "$tmp/ws/keys/niete-local.env"
t "stray main/keys without niete-local.env falls back to workspace keys" "$(resolve_keys_dir "$tmp/ws/main")" "$tmp/ws/keys"

# when main/keys DOES hold niete-local.env, use it
: > "$tmp/ws/main/keys/niete-local.env"
t "main/keys wins when it holds niete-local.env" "$(resolve_keys_dir "$tmp/ws/main")" "$tmp/ws/main/keys"
rm -rf "$tmp"

# cassette mode → which keys file the stack composes from. record MUST use a separate real-keys file so
# the sealed default (replay-strict, no vendor keys) can never call a vendor.
keys_name_for_mode() { local m="$1"; local n="niete-local.env"; [ "$m" = record ] && n="niete-record.env"; printf '%s' "$n"; }
t "default (replay-strict) uses the placeholder keys file" "$(keys_name_for_mode replay-strict)" "niete-local.env"
t "replay uses the placeholder keys file too" "$(keys_name_for_mode replay)" "niete-local.env"
t "record uses the REAL-keys file, never the default" "$(keys_name_for_mode record)" "niete-record.env"

echo; if [ "$fails" -eq 0 ]; then echo "local-stack-keys: all passed"; else echo "local-stack-keys: $fails failed"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
