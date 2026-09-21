#!/usr/bin/env bash
# provision-local-modules.sh — hand the mock E2E lane a node_modules tree built from ONE commit's
# lockfile, without ever running npm in the shared clone (bd-vaee9).
#
#   bash bot/scripts/e2e/provision-local-modules.sh --repo <dir> --sha <full> --kind bot|root \
#        [--cache-root <dir>] [--installed-root <dir>]
#
# Prints ONE line on stdout: the directory to use as the modules root — `<root>/bot/node_modules` for
# kind=bot, `<root>/node_modules` for kind=root, which is exactly what local-stack.sh symlinks.
#
# Why this exists. The lane runs a detached worktree at <sha> but borrowed the SHARED CLONE's installed
# modules, and refused (exit 10) whenever that commit's lockfile disagreed — offering only `npm ci` in
# the shared clone, which mutates the checkout every other worktree and session is mid-flight on. So any
# branch whose bot/package-lock.json differs from whatever the clone last installed was locked out of the
# lane, even branches that never touched a lockfile. Here the mismatch provisions a private tree instead.
#
# The cache is keyed by the LOCKFILE BLOB, not the commit: every commit sharing a dependency tree shares
# one install, so the cost is paid per dependency change, not per run. Entries are published by atomic
# rename, so a half-finished or concurrent install is never adopted as warm. An entry is ~600MB, so the
# cache is bounded: the E2E_MODULE_CACHE_KEEP (default 3) least-recently-USED entries of each kind are
# kept and the rest deleted. Nothing outside the cache root is ever removed.
#
# Exit codes: 2 usage · 10 cannot provision (npm missing, or the install failed — the shared clone is
# still never written to).
set -uo pipefail

REPO=""; SHA=""; KIND=""; CACHE_ROOT=""; INSTALLED_ROOT=""
while [ $# -gt 0 ]; do case "$1" in
  --repo) REPO="$2"; shift 2 ;;
  --sha) SHA="$2"; shift 2 ;;
  --kind) KIND="$2"; shift 2 ;;
  --cache-root) CACHE_ROOT="$2"; shift 2 ;;
  --installed-root) INSTALLED_ROOT="$2"; shift 2 ;;
  -h|--help) sed -n 2,12p "$0"; exit 0 ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac; done
[ -n "$REPO" ] && [ -n "$SHA" ] || { echo "usage: provision-local-modules.sh --repo <dir> --sha <full> --kind bot|root" >&2; exit 2; }
case "$KIND" in bot|root) ;; *) echo "--kind must be bot or root (got '${KIND:-}')" >&2; exit 2 ;; esac

log() { echo "[provision-local-modules] $*" >&2; }

# kind decides which lockfile is authoritative and where the tree has to land.
if [ "$KIND" = bot ]; then SUBDIR="bot"; LOCK="bot/package-lock.json"; MANIFEST="bot/package.json"
else                       SUBDIR="";    LOCK="package-lock.json";     MANIFEST="package.json"; fi

WANT=$(git -C "$REPO" rev-parse "$SHA:$LOCK" 2>/dev/null) || WANT=""
[ -n "$WANT" ] || { log "no $LOCK at $SHA — nothing to install from"; exit 10; }

# 1. The fast path, unchanged: if the shared clone's install already matches this commit, borrow it.
#    Nothing is installed and no cache entry is created, so the common case costs exactly what it did.
if [ -n "$INSTALLED_ROOT" ]; then
  have=$(git -C "$REPO" hash-object "$INSTALLED_ROOT/$LOCK" 2>/dev/null || echo none)
  if [ "$have" = "$WANT" ] && [ -d "$INSTALLED_ROOT/${SUBDIR:+$SUBDIR/}node_modules" ]; then
    printf '%s\n' "$INSTALLED_ROOT"; exit 0
  fi
fi

CACHE_ROOT="${CACHE_ROOT:-${E2E_MODULE_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/niete-e2e/modules}}"
ENTRY="$CACHE_ROOT/$KIND-${WANT:0:12}"
NM="$ENTRY/${SUBDIR:+$SUBDIR/}node_modules"

# 2. A warm entry is one whose stamp records the SAME blob we actually installed from. The stamp is
#    written last, so it is the thing that makes an entry warm — not the presence of node_modules.
if [ -d "$NM" ] && [ "$(cat "$ENTRY/.lockblob" 2>/dev/null)" = "$WANT" ]; then
  touch "$ENTRY" 2>/dev/null || true   # a hit is a use: keeps this entry off the eviction list
  printf '%s\n' "$ENTRY"; exit 0
fi

# 3. Cold: install into a private staging dir from THIS commit's manifest + lockfile (both read out of
#    git, so they cannot disagree with each other or with the worktree under test).
command -v npm >/dev/null 2>&1 || { log "npm is not on PATH — cannot build the $KIND modules for $SHA in $ENTRY"; exit 10; }
mkdir -p "$CACHE_ROOT" 2>/dev/null || { log "cannot create the module cache at $CACHE_ROOT"; exit 10; }
STAGE=$(mktemp -d "$CACHE_ROOT/.staging.XXXXXX") || { log "cannot stage an install under $CACHE_ROOT"; exit 10; }
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/$SUBDIR"
git -C "$REPO" show "$SHA:$MANIFEST" > "$STAGE/${SUBDIR:+$SUBDIR/}package.json" 2>/dev/null \
  && git -C "$REPO" show "$SHA:$LOCK" > "$STAGE/${SUBDIR:+$SUBDIR/}package-lock.json" 2>/dev/null \
  || { log "cannot read $MANIFEST / $LOCK at $SHA"; exit 10; }

log "installing the $KIND modules for lockfile ${WANT:0:12} (from $SHA) — one npm ci per dependency tree, cached at $ENTRY"
if ! ( cd "$STAGE/$SUBDIR" && npm ci --no-audit --no-fund ) >"$STAGE/npm.log" 2>&1; then
  log "npm ci failed for the $KIND set in $ENTRY — last lines:"
  tail -20 "$STAGE/npm.log" >&2 || true
  exit 10
fi
printf '%s' "$WANT" > "$STAGE/.lockblob"

# 4. Publish by rename. If a concurrent run got there first its entry is just as valid — adopt it.
if mv "$STAGE" "$ENTRY" 2>/dev/null; then trap - EXIT
elif [ -d "$NM" ]; then log "another run published $ENTRY first — using it"
else log "cannot publish the install to $ENTRY"; exit 10; fi

# 5. Bound the cache. Newest-first by mtime, keep the first N of THIS kind, delete the rest — only
#    ever inside the cache root, and only entries this script's own naming could have created.
KEEP="${E2E_MODULE_CACHE_KEEP:-3}"
if [ "$KEEP" -gt 0 ] 2>/dev/null; then
  ls -dt "$CACHE_ROOT/$KIND-"* 2>/dev/null | tail -n "+$((KEEP+1))" | while IFS= read -r old; do
    case "$old" in "$CACHE_ROOT/$KIND-"?*) log "evicting $(basename "$old") (cache keeps $KEEP per kind)"; rm -rf "$old" ;; esac
  done
fi

printf '%s\n' "$ENTRY"
