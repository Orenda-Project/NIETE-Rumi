#!/usr/bin/env bash
# engine-bridge.test.sh — NIETE-Rumi BORROWS the shared E2E engine and keeps only its own tenant layer (bd-9157r.1).
#
#   bash scripts/qa/engine-bridge.test.sh      (npm run qa:test runs it)
#
# The harness used to live here, in .claude/qa/shared, .claude/hooks, .githooks and scripts/qa. Since bd-9157r.1 it is
# the shared engine in rumi-agent-home, linked in at .claude/qa/engine by scripts/qa/link-engine.sh (npm install runs
# it). What stays is NIETE's own: specs, drivers, niete_* tools, config, agents, ledgers, the web runner, the scheduler.
# This test holds that line both ways: no engine file creeps back in as a copy, and every entry point git, npm and
# Claude Code call still works, with the engine linked and on a machine without it.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; cd "$ROOT" || exit 1
F=0; ok(){ printf '  ok    %s\n' "$1"; }; bad(){ printf '  FAIL  %s\n' "$1"; F=$((F+1)); }
T=$(mktemp -d "${TMPDIR:-/tmp}/engine-bridge.XXXXXX") || exit 1
trap 'rm -rf "$T"' EXIT

echo "engine bridge — no copy of the engine is committed here"
extra=$(git ls-files .claude/qa/shared | sed 's#^\.claude/qa/shared/##' | grep -vE '^(features/|niete_|test_niete_)' \
  | grep -vxE 'make-textbook-fixture\.py|make-pdf-fixtures\.js|app-redirect-case\.cjs|test_app_redirect_case\.js|coaching-ext\.cjs|handout-class-drive\.cjs|training-quiz-gen\.cjs|test_language_feature\.js|test_registration_feature_name_gate\.js|test_harness_users_columns\.py')
[ -z "$extra" ] && ok ".claude/qa/shared holds only NIETE's drivers, tools and helpers" \
  || bad "engine files committed in .claude/qa/shared: $(printf '%s ' $extra | cut -c1-220)"
leaked=""
for f in scripts/qa/impact.py scripts/qa/test_impact.py scripts/qa/install-hooks.sh scripts/qa/e2e-mock.sh \
         scripts/qa/e2e-mock.test.sh scripts/qa/commit-ledger-row.sh .githooks/README.md .githooks/githooks.test.sh \
         .claude/hooks/lib .claude/skills/gherkin-spec-sync .claude/skills/gherkin-test-cases .claude/skills/apply-discoveries \
         .claude/skills/chrome-mcp-whatsapp-e2e .claude/commands/sync-specs.md .claude/commands/testcases.md \
         .claude/commands/apply-discoveries.md .claude/commands/e2e-mock.md; do
  [ -z "$(git ls-files -- "$f")" ] || leaked="$leaked $f"
done
[ -z "$leaked" ] && ok "scripts/qa, .githooks, hooks/lib, skills and commands carry no engine file" || bad "engine files committed:$leaked"
own_hooks=$(git ls-files .claude/hooks | sed 's#^\.claude/hooks/##' \
  | grep -vxE 'block-railway-up\.sh|block-railway-up\.test\.sh|data-standards-warn\.sh|e2e-autorun\.walkthrough\.sh|e2e-autorun\.sh|e2e-autorun-stop\.sh|e2e-pending-banner\.sh')
[ -z "$own_hooks" ] && ok ".claude/hooks holds NIETE's own hooks and the three E2E shims" \
  || bad "unexpected files in .claude/hooks: $(printf '%s ' $own_hooks | cut -c1-220)"

echo "engine bridge — the shims and the bridge are in place"
n=$F
for h in e2e-autorun.sh e2e-autorun-stop.sh e2e-pending-banner.sh; do
  f=".claude/hooks/$h"
  if [ -f "$f" ] && [ "$(wc -l < "$f")" -le 12 ] && grep -q '\.claude/qa/engine/hooks/' "$f"; then :; else bad "$f is not a shim into the engine's hooks"; fi
done
[ "$F" = "$n" ] && ok "the session hooks .claude/settings.json names are shims into the engine"
n=$F
for h in post-commit pre-push; do
  grep -q "\.claude/qa/engine/githooks/$h" ".githooks/$h" 2>/dev/null || bad ".githooks/$h is not a shim into the engine's $h"
done
[ "$F" = "$n" ] && ok "the two git hooks are shims into the engine's"
[ "$(git ls-files .githooks | sort | tr '\n' ' ')" = ".githooks/post-commit .githooks/pre-push " ] \
  && ok ".githooks is exactly the two shims" || bad ".githooks holds: $(git ls-files .githooks | tr '\n' ' ')"
[ -f scripts/qa/link-engine.sh ] && ok "scripts/qa/link-engine.sh borrows the engine" || bad "no scripts/qa/link-engine.sh"
[ -f .claude/qa/config/tenants.yaml ] && grep -q '^repo: NIETE-Rumi' .claude/qa/config/tenants.yaml \
  && ok "the tenant manifest names NIETE-Rumi" || bad "no .claude/qa/config/tenants.yaml for NIETE-Rumi"
grep -qx '/\.claude/qa/engine' .gitignore && ok ".gitignore keeps the engine link out of git" || bad ".gitignore lacks /.claude/qa/engine"
prep=$(node -e 'process.stdout.write((require("./package.json").scripts||{}).prepare||"")')
case "$prep" in *'[ -f scripts/qa/link-engine.sh ]'*'command -v bash'*'|| true'*) ok "npm's prepare runs the link guarded";;
                *) bad "package.json prepare is not the guarded link line: '$prep'";; esac
node -e 'const s=require("./package.json").scripts; for (const k of ["qa:impact","e2e:mock"]) if (!/\.claude\/qa\/engine\/bin\//.test(s[k]||"")) { console.error(k+" = "+s[k]); process.exit(1) }' \
  && ok "qa:impact and e2e:mock run the engine's scripts" || bad "qa:impact / e2e:mock do not point at .claude/qa/engine/bin"

# A driver written the in-repo way — require('../stack-control.cjs') — reaches an engine module by the path it had
# before the switch, which is now nothing, and throws only when that scenario runs. Sandbox's observe.cjs did exactly
# that after the branch point (bd-9157r.1.6). Every relative require under the tenant layer must resolve here; an
# engine module is reached through the link: require(path.join(__dirname, '..', '..', 'engine', 'bin', '<file>')).
broken=$(node -e '
const fs = require("fs"), path = require("path"), out = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name);
  if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); continue; }
  if (!/\.(c?js)$/.test(e.name)) continue;
  for (const m of fs.readFileSync(p, "utf8").matchAll(/require\(\s*["\x27](\.\.?\/[^"\x27]+)["\x27]\s*\)/g)) {
    const t = path.resolve(path.dirname(p), m[1]);
    if (!["", ".js", ".cjs", ".json"].some((x) => fs.existsSync(t + x)) && !fs.existsSync(path.join(t, "index.js"))) out.push(p + ":" + m[1]);
  } } };
for (const r of [".claude/qa/shared", ".claude/qa/web"]) if (fs.existsSync(r)) walk(r);
process.stdout.write(out.join(" "));' 2>&1)
[ -z "$broken" ] && ok "every relative require in .claude/qa/shared and .claude/qa/web resolves" \
  || bad "relative requires to nothing (an engine module by its old path? reach it through .claude/qa/engine/bin): $broken"

# GitHub's machine has only this repo and cannot read the private rumi-agent-home, so the PR check runs from a copy of
# the engine files it needs, committed at .github/qa-impact/: the one engine piece committed here (bd-9157r.7).
echo "engine bridge — GitHub's PR check runs from this repo's own copy, with no token"
[ -f .github/qa-impact/impact.py ] && [ -f .github/qa-impact/SOURCE ] && ok ".github/qa-impact/ holds the PR check's files" \
  || bad "no .github/qa-impact/ copy for the PR check (bash .claude/qa/engine/bin/ci-copy.sh)"
grep -l QA_ENGINE_TOKEN .github/workflows/*.yml >/dev/null 2>&1 && bad "a workflow still asks for QA_ENGINE_TOKEN: $(grep -l QA_ENGINE_TOKEN .github/workflows/*.yml | tr '\n' ' ')" \
  || ok "no workflow asks for a token"
grep -q '\.github/qa-impact' .github/workflows/qa-impact.yml && ok "qa-impact.yml runs the copy" || bad "qa-impact.yml does not run .github/qa-impact/"
python3 .github/qa-impact/impact.py --repo . --base HEAD --head HEAD --format json 2>"$T/impact.err" \
  | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null \
  && ok "the copy runs on this repo's tenant layer by itself" || bad "the copy does not run here: $(tail -1 "$T/impact.err")"
if [ -f .claude/qa/engine/bin/ci-copy.sh ]; then
  bash .claude/qa/engine/bin/ci-copy.sh --check >/dev/null 2>&1 && ok "the copy matches the linked engine" \
    || bad "the copy is behind the linked engine: bash .claude/qa/engine/bin/ci-copy.sh, then commit .github/qa-impact/"
else ok "(no engine with ci-copy.sh linked here: the copy is not compared)"; fi

echo "engine bridge — a machine without the engine is never broken by it"
mkdir -p "$T/bare/.claude/hooks" "$T/bare/.githooks" "$T/bare/scripts/qa"
cp .claude/hooks/e2e-autorun.sh .claude/hooks/e2e-autorun-stop.sh .claude/hooks/e2e-pending-banner.sh "$T/bare/.claude/hooks/" 2>/dev/null
cp .githooks/post-commit .githooks/pre-push "$T/bare/.githooks/" 2>/dev/null; cp package.json "$T/bare/"
cp scripts/qa/link-engine.sh "$T/bare/scripts/qa/" 2>/dev/null
git -C "$T/bare" init -q
n2=$F
for h in e2e-autorun.sh e2e-autorun-stop.sh e2e-pending-banner.sh; do
  out=$(printf '{"hook_event_name":"x"}' | CLAUDE_PROJECT_DIR="$T/bare" bash "$T/bare/.claude/hooks/$h" 2>&1); rc=$?
  [ "$rc" = 0 ] && [ -z "$out" ] || bad "$h without the engine: exit $rc, output '$(printf '%s' "$out" | head -1 | cut -c1-120)'"
done
[ "$F" = "$n2" ] && ok "each session-hook shim exits 0, silent, with no engine"
( cd "$T/bare" && bash .githooks/post-commit </dev/null && printf 'x\n' | bash .githooks/pre-push origin url ) >/dev/null 2>&1 \
  && ok "the git-hook shims exit 0 with no engine" || bad "a git-hook shim failed with no engine"
( cd "$T/bare" && env -u E2E_ENGINE npm run --silent prepare ) >/dev/null 2>&1 && ok "npm's prepare exits 0 with no engine" \
  || bad "npm run prepare failed with no engine"

echo "engine bridge — with the engine linked, NIETE runs on it"
if [ -f .claude/qa/engine/ENGINE_VERSION ]; then
  E=.claude/qa/engine
  [ "$(python3 $E/bin/tenants_lite.py --root . --list-tenants 2>&1)" = niete ] && ok "the engine reads NIETE's manifest: one tenant, niete" \
    || bad "tenants_lite: $(python3 $E/bin/tenants_lite.py --root . --list-tenants 2>&1 | head -2 | tr '\n' ' ')"
  sel=$(python3 $E/bin/select_e2e.py --json bot/shared/services/menu.service.js 2>&1)
  printf '%s' "$sel" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["features"]==["menu"] and list(d["tenant_features"])==["niete"], d' 2>/dev/null \
    && ok "a menu-service change selects menu for niete" || bad "selection: $(printf '%s' "$sel" | head -c 200)"
  # The validator must READ every spec (a crash or a missing module is the bridge's fault). Its verdict on the specs
  # is NIETE's own business: at the switch it reported the same errors before and after (bd-9157r.1).
  vout=$(python3 $E/bin/validate_specs.py 2>&1); vrc=$?
  case "$vrc:$vout" in [01]:*"error(s)"*) ok "the engine's validator reads every NIETE spec (exit $vrc)";;
                       *) bad "validate_specs did not run cleanly (exit $vrc): $(printf '%s' "$vout" | tail -2 | tr '\n' ' ' | cut -c1-200)";; esac
  bad_load=""
  for d in .claude/qa/shared/features/*.cjs .claude/qa/shared/coaching-ext.cjs .claude/qa/shared/training-quiz-gen.cjs; do
    node -e 'require(require("path").resolve(process.argv[1]))' "$d" >/dev/null 2>"$T/load.err" || bad_load="$bad_load $(basename "$d"): $(grep -m1 -oE "Cannot find module '[^']+'" "$T/load.err")"
  done
  [ -z "$bad_load" ] && ok "every driver and helper loads, engine modules included" || bad "load failures:$bad_load"
  drv=$(bash $E/bin/run-suite.sh menu --method mock --print-driver 2>&1 | tail -1)
  case "$drv" in 92*) ok "the mock driver resolves per machine ($drv)";; *) bad "run-suite --print-driver: $drv";; esac
else
  echo "  SKIP  no engine linked here (bash scripts/qa/link-engine.sh) — the engine half did not run"
fi

[ "$F" = 0 ] && echo "engine-bridge: all ok" || { echo "engine-bridge: $F failure(s)"; exit 1; }
