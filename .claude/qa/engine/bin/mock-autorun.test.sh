#!/bin/bash
# mock-autorun.sh — the mock lane runs itself after a commit (operator, 2026-09-20: nothing to type).
# Runs inside a fixture repo (tests/mkfixture.sh) with a STAND-IN for commit-e2e.sh: no bot, no redis, no vendor.
#
# Run:  cd <fixture> && bash $ENGINE/bin/mock-autorun.test.sh
set -u
# The guarded repo is wherever the manifest says (repo mode: the engine's grandparent; workspace mode: the nested
# clone this test was started in). ENGINE is this file's own engine, whichever layout.
ENGINE="$(cd "$(dirname "$0")/.." && pwd)"
. "$ENGINE/hooks/lib/tenants.sh"
ROOT=$(e2e_root "$PWD" 2>/dev/null) || ROOT=$(cd "$ENGINE/../../.." && pwd)
cd "$ROOT" || exit 1
FAILED=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
say() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }
has() { case "$2" in *"$3"*) got=yes ;; *) got=no ;; esac; say "$1" "$got" "$4"; }
MA=$ENGINE/bin/mock-autorun.sh
PEND="$ROOT/.claude/.e2e-pending"
rm -rf "$PEND"; mkdir -p "$PEND"
TEN=$(e2e_tenants | head -1); NT=$(e2e_tenants | wc -l | tr -d ' ')
status() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("status",""))' "$PEND/mock-$(printf '%s' "$1" | cut -c1-7).result" 2>/dev/null; }
wait_done() { local i; for i in $(seq 1 100); do [ "$(status "$1")" = "$2" ] && return 0; sleep 0.2; done; return 1; }

# the stand-in: prints a ledger-shaped row per feature (and per tenant), sleeps a little, exits 0 — or says REGRESSION
FAKE="$PEND/fake-commit-e2e.sh"
cat > "$FAKE" <<'SH'
#!/bin/bash
sha="$1"; shift; feats=""; tenant=""
while [ $# -gt 0 ]; do case "$1" in --features) feats="$2"; shift 2;; --tenant) tenant="$2"; shift 2;; *) shift;; esac; done
echo "┌ commit-e2e · ${sha:0:12} (stand-in)"; sleep 0.4
for f in $(printf '%s' "$feats" | tr ',' ' '); do
  echo "│  ${tenant:-single}  $f  HEALTHY pass=3 fail=0 blocked=0 skipped=0  commit=${sha:0:12}"
done
echo "$sha $feats $tenant" >> "$(dirname "$0")/fake-calls.log"
[ "${FAKE_REGRESSION:-}" = "1" ] && echo "✗ REGRESSION — a scenario broke that was NOT a known finding:"
exit 0
SH
chmod +x "$FAKE"
export E2E_COMMIT_E2E_BIN="$FAKE"

# a ready machine: the keys file the manifest names + a redis-server on PATH; autofix must not touch the real world
N=$(basename "$(e2e_get keys.local 2>/dev/null || echo keys/local.env)")
mkdir -p "$ROOT/keys" "$PEND/bin"; : > "$ROOT/keys/$N"
printf '#!/bin/sh\necho ok\n' > "$PEND/bin/redis-server"; chmod +x "$PEND/bin/redis-server"
export PATH="$PEND/bin:$PATH" E2E_AUTOFIX_OFF=1
SHA1=$(git rev-parse HEAD)

echo "mock-autorun — a commit launches a background run and returns at once"
t0=$(date +%s); out=$(bash "$MA" "$SHA1" --features menu); t1=$(date +%s)
has "says it is running in the background" "$out" "RUNNING in the background" yes
[ $((t1 - t0)) -le 3 ] && ok "returned in ${t1}-${t0}s (did not wait for the run)" || bad "blocked the caller for $((t1 - t0))s"
say "result file starts as queued or running" "$( [ "$(status "$SHA1")" = queued ] || [ "$(status "$SHA1")" = running ] && echo yes || echo no)" "yes"
wait_done "$SHA1" done || bad "run never finished (status $(status "$SHA1"))"
has "the ledger rows are in the result" "$(cat "$PEND/mock-${SHA1:0:7}.result")" "HEALTHY pass=3" yes
say "no regression flagged" "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["regression"])' "$PEND/mock-${SHA1:0:7}.result")" "False"
has "--status prints the row" "$(bash "$MA" --status "$SHA1")" "DONE" yes
[ "$NT" -gt 1 ] && ok "multi-tenant fixture: tenants are passed per run below" || ok "single-tenant fixture"

echo "mock-autorun — launched from a git hook (GIT_DIR=.git in the environment), the run still works"
printf '// hookenv\n' >> "$ROOT/README.md"; git -C "$ROOT" add -A >/dev/null; git -C "$ROOT" commit -qm "hookenv" >/dev/null 2>&1; SHAH=$(git -C "$ROOT" rev-parse HEAD)
HOOKENV_FAKE="$PEND/fake-worktree.sh"
cat > "$HOOKENV_FAKE" <<'SH2'
#!/bin/bash
# a stand-in that does what local-stack does first: a detached worktree of the sha, from a DIFFERENT cwd
sha="$1"; root="$(git rev-parse --show-toplevel)"; out="$(dirname "$0")/wt-$$"
cd /tmp && git -C "$root" worktree add --detach "$out" "$sha" >/dev/null 2>&1 || { echo "│  x menu CRITICAL pass=0 fail=1 worktree-add-failed"; exit 3; }
git -C "$root" worktree remove --force "$out" >/dev/null 2>&1
echo "│  x menu HEALTHY pass=1 fail=0 blocked=0 skipped=0"
SH2
chmod +x "$HOOKENV_FAKE"
out=$(cd "$ROOT" && GIT_DIR=.git GIT_INDEX_FILE=.git/index GIT_PREFIX= E2E_COMMIT_E2E_BIN="$HOOKENV_FAKE" bash "$MA" "$SHAH" --features menu)
has "launches under the hook env" "$out" "RUNNING in the background" yes
wait_done "$SHAH" done || bad "hook-env run never finished (status $(status "$SHAH"))"
has "…and the worktree add inside the run succeeded" "$(cat "$PEND/mock-${SHAH:0:7}.result")" "HEALTHY pass=1" yes

echo "mock-autorun — the same sha is never run twice (both hooks fire on one commit)"
out=$(bash "$MA" "$SHA1" --features menu)
has "second request for a done sha is refused" "$out" "already done" yes
say "the stand-in ran once for it" "$(grep -c "^$SHA1 " "$PEND/fake-calls.log")" "1"

echo "mock-autorun — commits that pile up are coalesced to the newest sha with the union of features"
rm -f "$PEND/fake-calls.log"
printf '// a\n' >> "$ROOT/README.md" 2>/dev/null || : > "$ROOT/README.md"; git -C "$ROOT" add -A >/dev/null; git -C "$ROOT" commit -qm "a" >/dev/null 2>&1; SHA2=$(git -C "$ROOT" rev-parse HEAD)
printf '// b\n' >> "$ROOT/README.md"; git -C "$ROOT" add -A >/dev/null; git -C "$ROOT" commit -qm "b" >/dev/null 2>&1; SHA3=$(git -C "$ROOT" rev-parse HEAD)
# hold the drainer busy with a slow first run so the two requests queue behind it
SLOW="$PEND/slow.sh"; printf '#!/bin/bash\nsleep 2\nexec "%s" "$@"\n' "$FAKE" > "$SLOW"; chmod +x "$SLOW"
E2E_COMMIT_E2E_BIN="$SLOW" bash "$MA" "$SHA2" --features menu >/dev/null
sleep 0.3
if [ "$NT" -gt 1 ]; then out=$(bash "$MA" "$SHA3" --features status --tenants "$TEN"); else out=$(bash "$MA" "$SHA3" --features status); fi
has "second request queues behind the run in progress" "$out" "queued behind" yes
wait_done "$SHA3" done || bad "coalesced run never finished (status $(status "$SHA3"))"
calls=$(cat "$PEND/fake-calls.log" 2>/dev/null)
has "the newest sha was tested" "$calls" "$SHA3" yes
last=$(tail -1 "$PEND/fake-calls.log"); feats=$(printf '%s' "$last" | awk '{print $2}')
has "…with the union of features" "$feats" "status" yes
say "and SHA2 was run first (it was already in flight, not superseded)" "$(status "$SHA2")" "done"

echo "mock-autorun — a regression in the run is carried into the result"
printf '// c\n' >> "$ROOT/README.md"; git -C "$ROOT" add -A >/dev/null; git -C "$ROOT" commit -qm "c" >/dev/null 2>&1; SHA4=$(git -C "$ROOT" rev-parse HEAD)
FAKE_REGRESSION=1 bash "$MA" "$SHA4" --features menu >/dev/null
wait_done "$SHA4" done || bad "regression run never finished"
say "regression=true" "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["regression"])' "$PEND/mock-${SHA4:0:7}.result")" "True"
has "--status says REGRESSION" "$(bash "$MA" --status "$SHA4")" "REGRESSION" yes

echo "mock-autorun — the off switch and an unready machine never start anything"
printf '// d\n' >> "$ROOT/README.md"; git -C "$ROOT" add -A >/dev/null; git -C "$ROOT" commit -qm "d" >/dev/null 2>&1; SHA5=$(git -C "$ROOT" rev-parse HEAD)
out=$(E2E_MOCK_AUTORUN=off bash "$MA" "$SHA5" --features menu)
has "off: says so and names the by-hand command" "$out" "auto-run is OFF" yes
say "off: result status" "$(status "$SHA5")" "off"
printf '// e\n' >> "$ROOT/README.md"; git -C "$ROOT" add -A >/dev/null; git -C "$ROOT" commit -qm "e" >/dev/null 2>&1; SHA6=$(git -C "$ROOT" rev-parse HEAD)
rm -f "$ROOT/keys/$N"
out=$(bash "$MA" "$SHA6" --features menu)
has "not ready: says NOT RUN and why" "$out" "NOT RUN" yes
has "…naming the missing keys file" "$out" "$N" yes
say "not ready: result status" "$(status "$SHA6")" "not-ready"
[ -f "$PEND/fake-calls.log" ] && ! grep -q "$SHA6" "$PEND/fake-calls.log" && ok "not ready: the stand-in was never called for it" || bad "stand-in called on an unready machine"

echo "mock-autorun — the helpers the hooks use"
. "$ENGINE/hooks/lib/mock-lane.sh"
has "e2e_mock_result_block: done → 'RAN AUTOMATICALLY'" "$(e2e_mock_result_block "$SHA1" menu)" "RAN AUTOMATICALLY" yes
say "e2e_mock_result_block: not-ready → empty (the order text stays)" "$(e2e_mock_result_block "$SHA6" menu 2>/dev/null)" ""
say "e2e_mock_result_block: unknown sha → empty" "$(e2e_mock_result_block 0000000000000000000000000000000000000000 menu 2>/dev/null)" ""

rm -rf "$PEND" "$ROOT/keys"
echo; [ "$FAILED" -eq 0 ] && { echo "mock-autorun: all passed"; exit 0; } || { echo "mock-autorun: $FAILED failed"; exit 1; }
