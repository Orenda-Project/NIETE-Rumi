#!/usr/bin/env bash
# The local lane on a Linux operator's machine (bd-z3ze4.8): no Homebrew, maybe no lsof, maybe no shasum.
#
# Hermetic: uname, apt-get, sudo, curl and the PGDG setup script are shims that record what they were asked to
# do; nothing is installed and nothing needs root. Proves:
#   AC1  install-tools on Linux with passwordless sudo: Postgres 17 + pgvector from the PGDG apt repo, gh from
#        apt, PostgREST as a static binary into $LOCAL_DB_HOME/bin (no root for that one).
#   AC2  without passwordless sudo it never calls apt-get or prompts, still installs PostgREST, and prints the
#        exact commands that need root.
#   AC3  doctor finds a PostgREST that lives only in $LOCAL_DB_HOME/bin.
#   AC4  port checks work with no lsof on PATH (ss, else a TCP connect).
#   AC5  checksums work with sha256sum when shasum is absent.
#   AC6  autofix with no brew hands the install to local-db.sh install-tools and relays what it installed.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
LDB="$HERE/local-db.sh"
fails=0
t() { if [ "$2" = "$3" ]; then echo "  ok  $1"; else echo "  FAIL $1: want [$3] got [$2]"; fails=$((fails+1)); fi; }
has() { case "$2" in *"$3"*) echo "  ok  $1";; *) echo "  FAIL $1: [$3] not in output:"; printf '%s\n' "$2" | sed 's/^/        /'; fails=$((fails+1));; esac; }
hasnt() { case "$2" in *"$3"*) echo "  FAIL $1: [$3] should not be in output:"; printf '%s\n' "$2" | sed 's/^/        /'; fails=$((fails+1));; *) echo "  ok  $1";; esac; }

tmp="$(mktemp -d)/linux box"; mkdir -p "$tmp"
trap 'rm -rf "$(dirname "$tmp")"' EXIT

# A PATH holding every tool this machine has EXCEPT the named ones (and never a Postgres 17), one symlink each.
mkpath() {
  local out="$1"; shift; mkdir -p "$out"
  local d f n skip
  local IFS=:
  for d in $PATH; do
    [ -d "$d" ] || continue
    for f in "$d"/*; do
      n="${f##*/}"; [ -x "$f" ] && [ ! -d "$f" ] || continue
      [ -e "$out/$n" ] && continue
      skip=""; for x in "$@" postgres pg_config initdb pg_ctl; do [ "$n" = "$x" ] && skip=1; done
      [ -z "$skip" ] && ln -s "$f" "$out/$n"
    done
  done
  printf '%s' "$out"
}

# ── shims ──────────────────────────────────────────────────────────────────────────────────────────────
SHIM="$tmp/shim"; mkdir -p "$SHIM"; CALLS="$tmp/calls.log"; : >"$CALLS"
cat >"$SHIM/uname" <<'SH'
#!/bin/sh
case "$1" in -m) echo x86_64;; *) echo Linux;; esac
SH
cat >"$SHIM/apt-get" <<SH
#!/bin/sh
echo "apt-get \$*" >>"$CALLS"
SH
# sudo: SUDO_MODE=ok → -n works and runs nothing (records); nopass → -n refuses, like a box that wants a password
cat >"$SHIM/sudo" <<SH
#!/bin/sh
[ "\${SUDO_MODE:-ok}" = ok ] || exit 1
[ "\$1" = -n ] && shift
[ "\$1" = true ] && exit 0
echo "sudo \$*" >>"$CALLS"
SH
cat >"$tmp/pgdg.sh" <<SH
#!/bin/sh
echo "pgdg \$*" >>"$CALLS"
SH
# curl: the PostgREST release tarball, holding a postgrest that answers --version
mkdir -p "$tmp/pkg"; printf '#!/bin/sh\necho "PostgREST 16.4"\n' >"$tmp/pkg/postgrest"; chmod +x "$tmp/pkg/postgrest"
( cd "$tmp/pkg" && tar -cJf "$tmp/postgrest.tar.xz" postgrest )
cat >"$SHIM/curl" <<SH
#!/bin/sh
echo "curl \$*" >>"$CALLS"
out=""; while [ \$# -gt 0 ]; do [ "\$1" = -o ] && { out="\$2"; shift; }; shift; done
cp "$tmp/postgrest.tar.xz" "\$out"
SH
chmod +x "$SHIM"/* "$tmp/pgdg.sh"

BASE=$(mkpath "$tmp/path" lsof brew shasum sha256sum postgrest gh ss)
LPATH="$SHIM:$BASE"
export LOCAL_DB_PG_SEARCH="$tmp/no-postgres-here" LOCAL_DB_PGDG_SCRIPT="$tmp/pgdg.sh"

echo "AC1 install-tools, passwordless sudo"
H1="$tmp/home1"
out=$(PATH="$LPATH" SUDO_MODE=ok LOCAL_DB_HOME="$H1" bash "$LDB" install-tools 2>&1); calls=$(cat "$CALLS")
has   "postgresql-common first"            "$calls" "apt-get install -y postgresql-common"
has   "PGDG repo added"                    "$calls" "pgdg.sh -y"
has   "Postgres 17 + pgvector from apt"    "$calls" "apt-get install -y postgresql-17 postgresql-17-pgvector"
has   "gh from apt"                        "$calls" "apt-get install -y gh"
has   "PostgREST tarball for linux x86-64" "$calls" "postgrest-v16.4-linux-static-x86-64.tar.xz"
t     "postgrest in LOCAL_DB_HOME/bin"     "$([ -x "$H1/bin/postgrest" ] && echo yes)" "yes"
has   "says what it installed"             "$out" "installed postgrest"

echo "AC2 install-tools, sudo wants a password"
: >"$CALLS"; H2="$tmp/home2"
out=$(PATH="$LPATH" SUDO_MODE=nopass LOCAL_DB_HOME="$H2" bash "$LDB" install-tools 2>&1 </dev/null); rc=$?; calls=$(cat "$CALLS")   # no tty: as from a hook
hasnt "no apt-get without root"            "$calls" "apt-get"
t     "postgrest still installed (no root)" "$([ -x "$H2/bin/postgrest" ] && echo yes)" "yes"
t     "non-zero: Postgres still missing"   "$([ "$rc" != 0 ] && echo yes)" "yes"
has   "prints the root command"            "$out" "sudo apt-get install -y postgresql-17 postgresql-17-pgvector"

echo "AC3 doctor finds the LOCAL_DB_HOME/bin postgrest"
out=$(PATH="$LPATH" LOCAL_DB_HOME="$H1" bash "$LDB" doctor 2>&1)
hasnt "postgrest not reported missing"     "$out" "postgrest missing"
has   "postgres reported, with apt advice" "$out" "postgres17 missing"

echo "AC4 port checks without lsof"
. "$HERE/portable.sh"
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
node -e "require('net').createServer().listen($port,'127.0.0.1')" >/dev/null 2>&1 &
LPID=$!
for i in $(seq 1 40); do (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && break; sleep 0.1; done
t "listening port seen (no lsof, no ss)" "$(PATH="$BASE" port_listening "$port" && echo yes || echo no)" "yes"
kill "$LPID" 2>/dev/null; wait "$LPID" 2>/dev/null
t "free port seen as free"               "$(PATH="$BASE" port_listening "$port" && echo yes || echo no)" "no"
mkdir -p "$tmp/ssbin"
cat >"$tmp/ssbin/ss" <<'SH'
#!/bin/sh
echo 'LISTEN 0      511        127.0.0.1:3100      0.0.0.0:*    users:(("node",pid=4242,fd=21),("node",pid=4243,fd=21))'
SH
chmod +x "$tmp/ssbin/ss"
t "pids from ss"                         "$(PATH="$tmp/ssbin:$BASE" port_pids 3100 | tr '\n' ' ')" "4242 4243 "
t "listening from ss"                    "$(PATH="$tmp/ssbin:$BASE" port_listening 3100 && echo yes)" "yes"

echo "AC5 checksum without shasum"
mkdir -p "$tmp/shabin"; printf '#!/bin/sh\nexec /usr/bin/shasum -a 256 "$@"\n' >"$tmp/shabin/sha256sum"; chmod +x "$tmp/shabin/sha256sum"
printf 'abc' >"$tmp/f"
t "sha256 via sha256sum"                 "$(PATH="$tmp/shabin:$BASE" sha256_of "$tmp/f" | cut -c1-16)" "ba7816bf8f01cfea"

echo "AC6 autofix with no brew → install-tools"
MAIN="$tmp/main"; mkdir -p "$MAIN/bot/scripts/e2e"; MARK="$tmp/installed"
cat >"$MAIN/bot/scripts/e2e/local-db.sh" <<SH
#!/bin/sh
case "\$1" in
  doctor) [ -f "$MARK" ] || { echo "postgrest missing (install-tools)"; exit 1; }; exit 0;;
  install-tools) touch "$MARK"; echo "installed postgrest 16.4 → ~/.cache/niete-e2e-db/bin"; exit 0;;
  seed-status) echo ok;;
esac
SH
out=$(PATH="$LPATH" bash -c ". '$REPO/.claude/hooks/lib/mock-lane.sh'; e2e_mock_lane_autofix '$MAIN' --with-redis" 2>&1); rc=$?
has "install-tools relayed"              "$out" "auto-installed postgrest"
t   "ready afterwards"                   "$rc" "0"

echo
[ "$fails" = 0 ] && echo "local-db-linux: all passed" || { echo "local-db-linux: $fails failed"; exit 1; }
