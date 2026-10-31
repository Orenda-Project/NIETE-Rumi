#!/usr/bin/env bash
# dev-portal.test.sh — the developer's own portal (slot 0, :4000) follows the commits of the checkout that
# started it (bd-i56c2u). Before this, `up` served one commit until someone ran down + up: on 2026-10-23 the
# operator's portal was 8 days and a branch behind, and nothing said so.
# What must hold:
#   - `follows` is true only in the checkout that started the run (another worktree's commits never move it);
#   - `refresh` moves the bot + worker to HEAD with the same internal key, verifies the commit, restarts the portal,
#     rebuilds the SPA only when portal/ changed, keeps the database, and warns when the schema baseline changed;
#   - two commits in quick succession never run two refreshes at once — the second is picked up by the first;
#   - the post-commit hook starts a refresh in the background in the owning checkout, and stays silent elsewhere.
# Throwaway repos with a COPY of dev-portal.sh and the hook; local-stack.sh is a stub that logs its calls; the
# portal is a stub node server answering /health. Nothing real starts.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf "  ok   %s\n" "$1"; }
no(){ FAIL=$((FAIL+1)); printf "  FAIL %s\n     %s\n" "$1" "${2:-}"; }
chk(){ if [ "$2" = "$3" ]; then ok "$1"; else no "$1" "expected [$3] got [$2]"; fi; }
has(){ case "$2" in *"$3"*) ok "$1";; *) no "$1" "no [$3] in: $(printf '%s' "$2" | tail -5)";; esac; }
hasnt(){ case "$2" in *"$3"*) no "$1" "unexpected [$3] in: $(printf '%s' "$2" | tail -5)";; *) ok "$1";; esac; }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/devportal.XXXXXX")
cleanup(){ [ -f "$RUN/portal.pid" ] && kill "$(cat "$RUN/portal.pid")" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT
CALLS="$TMP/calls.log"; BUILDS="$TMP/builds.log"; : > "$CALLS"; : > "$BUILDS"
PP=$((47000 + RANDOM % 900))

# The engine the post-commit shim runs: this checkout's link (scripts/qa/link-engine.sh), resolved to its real path.
ENGINE_DIR=$(cd "$ROOT/.claude/qa/engine" 2>/dev/null && pwd -P) || ENGINE_DIR=""
mkrepo() {   # a checkout with this branch's dev-portal.sh + post-commit hook, a stub stack and a stub portal
  local r="$1"
  mkdir -p "$r/scripts" "$r/bot/scripts/e2e" "$r/dashboard/node_modules" "$r/dashboard/portal-frontend/dist" "$r/portal/src" "$r/supabase/baseline" "$r/.githooks"
  cp "$ROOT/scripts/dev-portal.sh" "$r/scripts/"
  cp "$ROOT/.githooks/post-commit" "$r/.githooks/"
  # .githooks/post-commit is a shim into the SHARED engine (bd-9157r.1): the refresh lives in the engine's post-commit,
  # which acts only in a guarded repo. Link the same engine and give the repo NIETE's manifest.
  if [ -n "$ENGINE_DIR" ]; then
    mkdir -p "$r/.claude/qa/config"; ln -s "$ENGINE_DIR" "$r/.claude/qa/engine"
    cp "$ROOT/.claude/qa/config/tenants.yaml" "$r/.claude/qa/config/"
  fi
  cat > "$r/bot/scripts/e2e/local-stack.sh" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$CALLS"
[ "\$1" = retarget ] && echo "gitenv[\${GIT_INDEX_FILE:-}\${GIT_DIR:-}\${GIT_WORK_TREE:-}]" >> "$CALLS"
# a test arms one failure: the first \`restart bot\` after it exits 12 (the new commit's bot does not come up)
if [ "\$1 \$2" = "restart bot" ] && [ -f "$TMP/fail-bot" ]; then rm -f "$TMP/fail-bot"; exit 12; fi
if [ "\$1" = retarget ]; then python3 -c "import json,sys; p=sys.argv[2]+'/stack.json'; d=json.load(open(p)); d['commit_sha']=sys.argv[1]; json.dump(d,open(p,'w'))" "\$2" "\$3"; fi
exit 0
EOF
  cat > "$r/dashboard/index.js" <<'JS'
const port = Number((require('fs').readFileSync('.env', 'utf8').match(/^PORT=(\d+)/m) || [])[1]);
require('http').createServer((q, s) => { s.writeHead(200); s.end('ok'); }).listen(port, '127.0.0.1');
JS
  : > "$r/dashboard/portal-frontend/dist/index.html"
  printf 'one\n' > "$r/portal/src/a.tsx"; printf 'create table t();\n' > "$r/supabase/baseline/schema.sql"
  printf 'v1\n' > "$r/bot/app.js"; printf 'node_modules/\ndist/\n/.claude/qa/engine\n' > "$r/.gitignore"
  git -C "$r" init -q -b sandbox; git -C "$r" config user.email t@l; git -C "$r" config user.name t
  git -C "$r" add -A; git -C "$r" commit -qm base
}
R="$TMP/owner checkout"; O="$TMP/other checkout"
mkrepo "$R"; mkrepo "$O"
RUN="$TMP/run"; mkdir -p "$RUN/portal"
A=$(git -C "$R" rev-parse HEAD)
printf '{"commit_sha": "%s"}\n' "$A" > "$RUN/stack.json"
(cd "$R" && pwd -P) > "$RUN/owner"
printf 'k3y\n' > "$RUN/internal-key"
echo "4011 3111 6411 3211" > "$RUN/ports"
printf 'PORT=%s\n' "$PP" > "$RUN/portal/.env"
( cd "$RUN/portal" && exec node "$R/dashboard/index.js" ) >/dev/null 2>&1 & echo $! > "$RUN/portal.pid"
for i in $(seq 1 20); do curl -sf -m 1 "http://127.0.0.1:$PP/health" >/dev/null 2>&1 && break; sleep 0.2; done

dp(){ local repo="$1"; shift; DEV_PORTAL_BUILD_CMD="echo built >> '$BUILDS'" bash "$repo/scripts/dev-portal.sh" "$1" "$RUN" 2>&1; }
commit(){ local repo="$1" file="$2"; printf '%s\n' "$RANDOM" >> "$repo/$file"; git -C "$repo" add -A; QA_HOOKS_OFF=1 git -C "$repo" commit -qm "touch $file"; git -C "$repo" rev-parse HEAD; }

echo "dev-portal — who it follows"
dp "$R" follows >/dev/null; chk "F1 follows: the checkout that started it" "$?" "0"
dp "$O" follows >/dev/null; chk "F2 follows: not another checkout" "$?" "1"
mv "$RUN/owner" "$RUN/owner.bak"; dp "$R" follows >/dev/null; rc=$?; mv "$RUN/owner.bak" "$RUN/owner"
chk "F3 follows: not a run started before following existed (no owner recorded)" "$rc" "1"
grep -q 'owner' "$ROOT/scripts/dev-portal.sh" && grep -qE 'this_checkout[^|]*> *"\$RUN/owner"' "$ROOT/scripts/dev-portal.sh" \
  && ok "F4 up records the checkout that started it" || no "F4 up records the checkout that started it" "no write of \$RUN/owner in up"

echo "dev-portal — refresh"
out=$(dp "$R" refresh); rc=$?
chk "R1 refresh at the running commit exits 0" "$rc" "0"
has "R1b …and says it is already there" "$out" "already at"
hasnt "R1c …and moves nothing" "$(cat "$CALLS")" "retarget"

oldpid=$(cat "$RUN/portal.pid")
B=$(commit "$R" bot/app.js)
out=$(dp "$R" refresh); rc=$?
chk "R2 refresh to a new commit exits 0" "$rc" "0"; [ "$rc" = 0 ] || echo "     $out"
calls=$(cat "$CALLS")
has "R3 the stack's code moves to HEAD" "$calls" "retarget $B $RUN"
has "R4 the bot restarts with the run's internal key" "$calls" "restart bot $RUN INTERNAL_API_KEY=k3y"
has "R4b …and with this portal as its PORTAL_URL" "$calls" "PORTAL_URL=http://localhost:$PP"
has "R5 the worker restarts" "$calls" "restart worker $RUN"
has "R6 the running commit is verified" "$calls" "verify $RUN"
newpid=$(cat "$RUN/portal.pid" 2>/dev/null)
[ -n "$newpid" ] && [ "$newpid" != "$oldpid" ] && ok "R7 the portal API was restarted" || no "R7 the portal API was restarted" "pid $oldpid → $newpid"
curl -sf -m 2 "http://127.0.0.1:$PP/health" >/dev/null 2>&1 && ok "R7b …and answers" || no "R7b …and answers" "no /health on $PP"
chk "R8 a commit outside portal/ does not rebuild the SPA" "$(wc -l < "$BUILDS" | tr -d ' ')" "0"
hasnt "R8b …and the database is kept (no down)" "$calls" "down"

: > "$CALLS"; C=$(commit "$R" portal/src/a.tsx)
out=$(dp "$R" refresh)
chk "R9 a commit that touches portal/ rebuilds the SPA" "$(wc -l < "$BUILDS" | tr -d ' ')" "1"

: > "$CALLS"; D=$(commit "$R" supabase/baseline/schema.sql)
out=$(dp "$R" refresh)
has "R10 a schema-baseline change is called out (the database was kept)" "$out" "supabase/baseline changed"

: > "$CALLS"; E=$(commit "$O" bot/app.js)
out=$(dp "$O" refresh); rc=$?
chk "R11 refresh from another checkout exits 0" "$rc" "0"
has "R11b …says the run follows a different checkout" "$out" "not started from this checkout"
hasnt "R11c …and moves nothing" "$(cat "$CALLS")" "retarget"

: > "$CALLS"; F=$(commit "$R" bot/app.js)
mkdir "$RUN/refresh.lock"
out=$(dp "$R" refresh); rc=$?
chk "R12 a refresh while one is running exits 0" "$rc" "0"
[ -f "$RUN/refresh.again" ] && ok "R12b …and leaves word for the running one" || no "R12b …and leaves word for the running one" "no $RUN/refresh.again"
hasnt "R12c …and does not move the stack itself" "$(cat "$CALLS")" "retarget"
rmdir "$RUN/refresh.lock"; rm -f "$RUN/refresh.again"

: > "$CALLS"; prev=$(python3 -c "import json;print(json.load(open('$RUN/stack.json'))['commit_sha'])")
H=$(commit "$R" bot/app.js); : > "$TMP/fail-bot"
out=$(dp "$R" refresh); rc=$?
[ "$rc" != 0 ] && ok "R13 a bot that does not come up at the new commit fails the refresh" || no "R13 a bot that does not come up at the new commit fails the refresh" "rc=$rc"
has "R13b …and the stack is moved back to the commit it was running" "$(cat "$CALLS")" "retarget $prev $RUN"
chk "R13c …and stack.json names that commit again" "$(python3 -c "import json;print(json.load(open('$RUN/stack.json'))['commit_sha'])")" "$prev"
has "R13d …and says so" "$out" "back at ${prev:0:9}"
curl -sf -m 2 "http://127.0.0.1:$PP/health" >/dev/null 2>&1 && ok "R13e …and the portal still answers" || no "R13e …and the portal still answers" "no /health on $PP"
rm -f "$TMP/fail-bot"

echo "dev-portal — the post-commit hook"
if [ -z "$ENGINE_DIR" ]; then
  echo "  SKIP  no shared engine linked here (bash scripts/qa/link-engine.sh): the post-commit refresh lives in it"
  echo; echo "dev-portal: $PASS passed, $FAIL failed"; exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
fi
: > "$CALLS"
git -C "$R" config core.hooksPath .githooks
printf '%s\n' "$RANDOM" >> "$R/bot/app.js"; git -C "$R" add -A
err=$(cd "$R" && DEV_PORTAL_RUN="$RUN" DEV_PORTAL_BUILD_CMD="echo built >> '$BUILDS'" git commit -qm "hook commit" 2>&1); rc=$?
G=$(git -C "$R" rev-parse HEAD)
chk "H1 the commit succeeds" "$rc" "0"
has "H2 the hook says the portal is being refreshed" "$err" "refreshing"
for i in $(seq 1 50); do grep -q "verify $RUN" "$CALLS" 2>/dev/null && break; sleep 0.2; done
has "H3 …and the background refresh moves the stack to the new commit" "$(cat "$CALLS")" "retarget $G $RUN"
has "H3b …with none of the hook's GIT_* variables (they point git at the committing checkout)" "$(cat "$CALLS")" "gitenv[]"
[ -f "$RUN/refresh.log" ] && ok "H4 the background refresh logs to the run dir" || no "H4 the background refresh logs to the run dir" "no $RUN/refresh.log"
for i in $(seq 1 25); do [ -d "$RUN/refresh.lock" ] || break; sleep 0.2; done

: > "$CALLS"
git -C "$O" config core.hooksPath .githooks
printf '%s\n' "$RANDOM" >> "$O/bot/app.js"; git -C "$O" add -A
err=$(cd "$O" && DEV_PORTAL_RUN="$RUN" git commit -qm "other commit" 2>&1); rc=$?
chk "H5 a commit in another checkout succeeds" "$rc" "0"
hasnt "H6 …and says nothing about the portal" "$err" "refreshing"
sleep 1; hasnt "H7 …and moves nothing" "$(cat "$CALLS")" "retarget"

: > "$CALLS"
printf '%s\n' "$RANDOM" >> "$R/bot/app.js"; git -C "$R" add -A
err=$(cd "$R" && DEV_PORTAL_RUN="$RUN" DEV_PORTAL_FOLLOW=0 git commit -qm "follow off" 2>&1)
sleep 1; hasnt "H8 DEV_PORTAL_FOLLOW=0 switches the following off" "$(cat "$CALLS")" "retarget"

echo; echo "dev-portal: $PASS passed, $FAIL failed"
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
