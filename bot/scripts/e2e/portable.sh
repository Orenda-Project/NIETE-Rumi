# portable.sh — the few commands the mock lane needs that differ between macOS and Linux (bd-z3ze4.8).
# Sourced by local-db.sh, local-stack.sh and run-suite.sh. A minimal Ubuntu has no lsof, and may lack shasum.

# port_listening <port> → 0 iff something listens on it: lsof, else ss, else a TCP connect to 127.0.0.1.
port_listening() {
  if command -v lsof >/dev/null 2>&1; then lsof -ti tcp:"$1" -sTCP:LISTEN >/dev/null 2>&1; return; fi
  if command -v ss >/dev/null 2>&1; then [ -n "$(ss -Hltn "sport = :$1" 2>/dev/null)" ]; return; fi
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# port_pids <port> → the pids listening on it, one per line (lsof, else ss; nothing when neither exists).
port_pids() {
  if command -v lsof >/dev/null 2>&1; then lsof -ti tcp:"$1" -sTCP:LISTEN 2>/dev/null; return 0; fi
  if command -v ss >/dev/null 2>&1; then
    ss -Hltnp "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -un
  fi
  return 0
}

# sha256_of [file] → "<hex>  <name>", like shasum -a 256 (reads stdin without a file).
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$@"; else sha256sum "$@"; fi
}
