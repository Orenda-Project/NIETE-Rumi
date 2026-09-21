#!/usr/bin/env bash
# provision-local-modules.test.sh — the mock lane must never need `npm ci` in the shared clone (bd-vaee9).
#
# Every case below EXECUTES provision-local-modules.sh for real. `npm` is a PATH shim that records its
# invocations and fakes an install, so the suite is offline and fast; that the real npm can install the
# tree is the E2E lane's job, not this one's.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUT="$HERE/provision-local-modules.sh"

fails=0
t()  { if [ "$2" = "$3" ]; then echo "  ok  $1"; else echo "  FAIL $1: want [$3] got [$2]"; fails=$((fails+1)); fi; }
tc() { case "$2" in *"$3"*) echo "  ok  $1";; *) echo "  FAIL $1: [$2] does not contain [$3]"; fails=$((fails+1));; esac; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# --- a throwaway repo with two commits whose bot/package-lock.json differ -------------------------
REPO="$TMP/repo"; mkdir -p "$REPO/bot"
git -C "$REPO" init -q 2>/dev/null
git -C "$REPO" config user.email t@t; git -C "$REPO" config user.name t
printf '{"name":"root","version":"1.0.0"}\n'                 > "$REPO/package.json"
printf '{"name":"root","lockfileVersion":3,"gen":1}\n'       > "$REPO/package-lock.json"
printf '{"name":"bot","version":"1.0.0"}\n'                  > "$REPO/bot/package.json"
printf '{"name":"bot","lockfileVersion":3,"gen":1}\n'        > "$REPO/bot/package-lock.json"
git -C "$REPO" add -A >/dev/null; git -C "$REPO" commit -qm one
SHA1=$(git -C "$REPO" rev-parse HEAD)
printf '{"name":"bot","lockfileVersion":3,"gen":2}\n'        > "$REPO/bot/package-lock.json"
git -C "$REPO" add -A >/dev/null; git -C "$REPO" commit -qm two
SHA2=$(git -C "$REPO" rev-parse HEAD)
printf '{"name":"root","lockfileVersion":3,"gen":2}\n'       > "$REPO/package-lock.json"
git -C "$REPO" add -A >/dev/null; git -C "$REPO" commit -qm three
SHA3=$(git -C "$REPO" rev-parse HEAD)

# --- the "shared clone": an installed set built from SHA1, which must never be written to ---------
INST="$TMP/shared"; mkdir -p "$INST/bot/node_modules/left-pad" "$INST/node_modules/left-pad"
git -C "$REPO" show "$SHA1:bot/package-lock.json" > "$INST/bot/package-lock.json"
git -C "$REPO" show "$SHA1:package-lock.json"     > "$INST/package-lock.json"
inst_fingerprint() { find "$INST" -type f | LC_ALL=C sort | xargs shasum 2>/dev/null | shasum | cut -d' ' -f1; }
INST_BEFORE="$(inst_fingerprint)"

# --- npm shim: records each call, then fakes what `npm ci` leaves behind ---------------------------
SHIM="$TMP/shim"; mkdir -p "$SHIM"
cat > "$SHIM/npm" <<'NPM'
#!/usr/bin/env bash
echo "$PWD :: $*" >> "$NPM_CALLS"
[ "${NPM_SHIM_FAIL:-}" = 1 ] && { echo "npm shim: forced failure" >&2; exit 1; }
mkdir -p node_modules/left-pad && echo installed > node_modules/.shim-marker
exit 0
NPM
chmod +x "$SHIM/npm"
CALLS="$TMP/npm-calls.txt"; : > "$CALLS"
run() { NPM_CALLS="$CALLS" PATH="$SHIM:$PATH" bash "$SUT" "$@" 2>"$TMP/err.txt"; }
ncalls() { wc -l < "$CALLS" | tr -d ' '; }

CACHE="$TMP/cache"

echo "provision-local-modules:"

# 1. The fast path survives: when the installed set already matches the commit, use it and install nothing.
out=$(run --repo "$REPO" --sha "$SHA1" --kind bot --cache-root "$CACHE" --installed-root "$INST"); rc=$?
t  "matching installed set is used as-is"            "$out" "$INST"
t  "  … exit 0"                                      "$rc"   "0"
t  "  … npm is never invoked"                        "$(ncalls)" "0"
t  "  … no cache entry is created"                   "$([ -d "$CACHE" ] && echo yes || echo no)" "no"

# 2. THE BUG (bd-vaee9): a commit whose lockfile differs must NOT be refused with "npm ci in the shared clone".
out=$(run --repo "$REPO" --sha "$SHA2" --kind bot --cache-root "$CACHE" --installed-root "$INST"); rc=$?
t  "mismatched lockfile does not exit 10"            "$rc"   "0"
tc "  … resolves into the per-commit cache"          "$out"  "$CACHE"
t  "  … the cache carries bot/node_modules"          "$([ -d "$out/bot/node_modules" ] && echo yes || echo no)" "yes"
t  "  … npm ran exactly once"                        "$(ncalls)" "1"
tc "  … and it ran inside the cache, not the clone"  "$(cat "$CALLS")" "$CACHE"
t  "  … THE SHARED CLONE IS UNTOUCHED"               "$(inst_fingerprint)" "$INST_BEFORE"

# 3. Keyed by the lockfile blob, so a second run on that commit reuses the tree instead of reinstalling.
out2=$(run --repo "$REPO" --sha "$SHA2" --kind bot --cache-root "$CACHE" --installed-root "$INST")
t  "a warm cache entry is reused"                    "$out2" "$out"
t  "  … without a second npm ci"                     "$(ncalls)" "1"

# 4. Two commits that share a lockfile share the entry; a different lockfile gets its own.
blob1=$(git -C "$REPO" rev-parse "$SHA1:bot/package-lock.json")
blob2=$(git -C "$REPO" rev-parse "$SHA2:bot/package-lock.json")
tc "the entry is keyed by the lockfile blob"         "$(basename "$out")" "${blob2:0:12}"
t  "  … and the two lockfiles key differently"       "$([ "$blob1" = "$blob2" ] && echo same || echo different)" "different"

# 5. kind=root reads the ROOT lockfile and lands node_modules at the root of the entry.
outr=$(run --repo "$REPO" --sha "$SHA2" --kind root --cache-root "$CACHE" --installed-root "$TMP/absent")
t  "kind=root provisions the root set"               "$([ -d "$outr/node_modules" ] && echo yes || echo no)" "yes"
t  "  … and not a bot/ subtree"                      "$([ -d "$outr/bot/node_modules" ] && echo yes || echo no)" "no"

# 6. A half-finished install must never be published as a warm entry. SHA3 carries a root lockfile no
#    earlier case installed, so this really is a cold install and not a warm-cache hit in disguise.
NPM_SHIM_FAIL=1 NPM_CALLS="$CALLS" PATH="$SHIM:$PATH" \
  bash "$SUT" --repo "$REPO" --sha "$SHA3" --kind root --cache-root "$CACHE" --installed-root "$TMP/absent" >/dev/null 2>"$TMP/err.txt"
t  "a failed install exits 10"                       "$?" "10"
tc "  … and says where it tried to install"          "$(cat "$TMP/err.txt")" "$CACHE"
rblob3=$(git -C "$REPO" rev-parse "$SHA3:package-lock.json")
t  "  … leaving no usable entry behind"              "$([ -d "$CACHE/root-${rblob3:0:12}/node_modules" ] && echo yes || echo no)" "no"
t  "  … and no staging dir is left lying around"     "$(find "$CACHE" -maxdepth 1 -name '.staging.*' | wc -l | tr -d ' ')" "0"
t  "  … and STILL not touching the shared clone"     "$(inst_fingerprint)" "$INST_BEFORE"

# 7. The cache is bounded. Each entry is ~600MB, so without a cap a laptop bleeds disk every time a
#    lockfile changes. Least-recently-USED goes first, and a warm hit counts as a use.
CACHE2="$TMP/cache2"
mk() { run --repo "$REPO" --sha "$1" --kind "$2" --cache-root "$CACHE2" --installed-root "$TMP/absent" >/dev/null; }
entries() { find "$CACHE2" -maxdepth 1 -name "$1-*" 2>/dev/null | wc -l | tr -d ' '; }
E2E_MODULE_CACHE_KEEP=2 mk "$SHA1" bot; sleep 1
E2E_MODULE_CACHE_KEEP=2 mk "$SHA2" bot; sleep 1
b1=$(git -C "$REPO" rev-parse "$SHA1:bot/package-lock.json"); b2=$(git -C "$REPO" rev-parse "$SHA2:bot/package-lock.json")
E2E_MODULE_CACHE_KEEP=2 mk "$SHA1" bot                     # warm hit on the OLDEST — now the newest use
sleep 1
printf '{"name":"bot","lockfileVersion":3,"gen":3}\n' > "$REPO/bot/package-lock.json"
git -C "$REPO" add -A >/dev/null; git -C "$REPO" commit -qm four
SHA4=$(git -C "$REPO" rev-parse HEAD)
E2E_MODULE_CACHE_KEEP=2 mk "$SHA4" bot
t  "the cache keeps only E2E_MODULE_CACHE_KEEP entries" "$(entries bot)" "2"
t  "  … the least recently USED one is evicted"         "$([ -d "$CACHE2/bot-${b2:0:12}" ] && echo kept || echo gone)" "gone"
t  "  … a warm hit counts as a use and saves its entry" "$([ -d "$CACHE2/bot-${b1:0:12}" ] && echo kept || echo gone)" "kept"
t  "  … and the cap is per kind, not global"            "$(entries root)" "0"

echo; if [ "$fails" -eq 0 ]; then echo "provision-local-modules: all passed"; else echo "provision-local-modules: $fails failed"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
