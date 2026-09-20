#!/usr/bin/env bash
# mkfixture.sh — build a throwaway repo shaped like NIETE-Rumi or whatsapp-ai-bot, with the LIVE engine
# symlinked in, so every engine test runs against both shapes (bd-9157r).
#
#   bash .claude/qa/engine/tests/mkfixture.sh niete|rumi|workspace <dir> [--real]      # prints <dir>
#   workspace = the niete shape re-laid as a WORKSPACE: <dir>/.claude/qa/{engine,tenants/niete/…} + nested clone <dir>/NIETE-Rumi/
#               (specs + drivers in the clone, config/agents/fixtures/ledgers in the tenant layer). The printed <dir> is the
#               workspace; the guarded repo is <dir>/NIETE-Rumi.
#
# The fixture carries the whole TENANT LAYER a real repo would: tenants.yaml, feature-map.yaml,
# known-findings.json, one agent per feature, one mock-capable driver, two specs, a runtime tree, the three
# two-line hook shims, and one baseline commit ON THE LANDING BRANCH (a commit on the release branch earns
# the full suite, which would replace every targeted selection the tests assert on). Nothing here is real
# teacher data or a real number.
#
# --real (niete only): overlay NIETE-Rumi's REAL tenant layer at the pinned sha (config, agents, drivers,
# specs, ledgers) so the vendored unit tests — which assert against the real feature map — run unchanged.
# Finds the checkout via E2E_NIETE_CHECKOUT or a `NIETE-Rumi/.git` in an ancestor of the engine; exits 3 if
# neither exists (the caller decides whether that is a skip or a failure).
set -euo pipefail
SHAPE="${1:-}"; D="${2:-}"; REAL=0
shift 2 2>/dev/null || true
for a in "$@"; do case "$a" in --real) REAL=1;; *) echo "unknown flag $a" >&2; exit 2;; esac; done
[ -n "$SHAPE" ] && [ -n "$D" ] || { echo "usage: mkfixture.sh niete|rumi|workspace <dir> [--real]" >&2; exit 2; }
WORKSPACE=0; [ "$SHAPE" = workspace ] && { WORKSPACE=1; SHAPE=niete; }
ENGINE=$(cd "$(dirname "$0")/.." && pwd)
NIETE_SHA="${E2E_NIETE_SHA:-de93aee5}"
find_niete() {
  [ -n "${E2E_NIETE_CHECKOUT:-}" ] && [ -e "$E2E_NIETE_CHECKOUT/.git" ] && { printf '%s' "$E2E_NIETE_CHECKOUT"; return 0; }
  local d="$ENGINE"
  while [ -n "$d" ] && [ "$d" != "/" ]; do [ -e "$d/NIETE-Rumi/.git" ] && { printf '%s/NIETE-Rumi' "$d"; return 0; }; d=$(dirname "$d"); done
  return 1
}
if [ "$REAL" = 1 ]; then
  [ "$SHAPE" = niete ] || { echo "--real is only meaningful for the niete shape" >&2; exit 2; }
  NIETE_SRC=$(find_niete) || { echo "mkfixture --real: no NIETE-Rumi checkout found (set E2E_NIETE_CHECKOUT)" >&2; exit 3; }
fi

mkdir -p "$D/.claude/qa/config" "$D/.claude/qa/agents" "$D/.claude/qa/shared/features" "$D/.claude/qa/ledgers" \
         "$D/.claude/hooks" "$D/.claude/.e2e-pending"
: > "$D/.claude/qa/ledgers/runs.jsonl"          # the append-only run ledger impact.py reads as E2E proof
ln -s "$ENGINE" "$D/.claude/qa/engine"
for h in e2e-autorun.sh e2e-autorun-stop.sh e2e-pending-banner.sh; do
  printf '#!/bin/bash\nexec bash "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}/.claude/qa/engine/hooks/%s" "$@"\n' "$h" > "$D/.claude/hooks/$h"
  chmod +x "$D/.claude/hooks/$h"
done

case "$SHAPE" in
  niete)
    RT="bot/"; SUITE=niete; REMOTE=NIETE-Rumi; LANDING=sandbox
    cat > "$D/.claude/qa/config/tenants.yaml" <<'Y'
version: 1
repo: NIETE-Rumi
command: /niete-e2e
runtime_scope:
  - bot/**
spec_suite: niete
branches:
  landing: sandbox
  promotion: staging
  release: main
  deploy_triggers:      # develop stays listed: the pinned harness treated it as deploying (the staging
    - sandbox           # Railway env may still build from it until repointed) — zero behaviour change
    - staging
    - main
    - develop
  full_suite_on:
    - main
keys:
  local: keys/niete-local.env
  record: keys/niete-record.env
db:
  env_prefix: NIETE_SANDBOX_SUPABASE
  forbidden_project_refs:
    - ihzciabopbttygxxgrkm
comment_marker: "<!-- niete-qa-impact -->"
tenants:
  niete:
    region_code: default
    notion_region: pk-ict
    driver: "923000000001"
    features:
      - registration
      - menu
      - training
      - lesson-plan
      - coaching
      - language
      - status
      - observe
      - attendance
    chrome: niete-sandbox
Y
    ;;
  rumi)
    RT=""; SUITE=rumi; REMOTE=whatsapp-ai-bot; LANDING=staging
    cat > "$D/.claude/qa/config/tenants.yaml" <<'Y'
version: 1
repo: whatsapp-ai-bot
command: /rumi-e2e
runtime_scope:
  - shared/**
  - workers/**
  - whatsapp-bot.js
  - flows/**
spec_suite: rumi
bot_root: .
e2e_scripts: scripts/e2e
branches:
  landing: staging
  release: main
  deploy_triggers:
    - staging
    - main
  full_suite_on:
    - main
keys:
  local: keys/rumi-e2e.env
  record: keys/rumi-record.env
db:
  env_prefix: RUMI_E2E_SUPABASE
  forbidden_project_refs:
    - jlpenspfdcwxkopaidys
comment_marker: "<!-- rumi-qa-impact -->"
tenants:
  pk:
    region_code: PK
    phone_number_id: "886544661200478"
    driver: "923000000011"
    features:
      - menu
      - status
    chrome: pk-staging
  tz:
    region_code: TZ
    phone_number_id: "1136440339547203"
    driver: "923000000012"
    features:
      - menu
      - status
    chrome: null
  ye:
    region_code: YE
    phone_number_id: "1168562573007743"
    driver: "923000000013"
    features:
      - menu
    chrome: null
  ps:
    region_code: PS
    phone_number_id: "1202050329651771"
    driver: "923000000014"
    features:
      - menu
      - status
    chrome: null
  ke:
    region_code: KE
    phone_number_id: "1222803297585656"
    driver: "923000000015"
    features:
      - menu
      - status
    chrome: ke-staging
Y
    ;;
  *) echo "shape must be niete|rumi (got '$SHAPE')" >&2; exit 2;;
esac

SVC="$D/${RT}shared/services"
mkdir -p "$SVC" "$D/tests/features/whatsapp/$SUITE"

# feature-map: the same shape the real one has (scope / features / shared), plus — rumi only — a tenant-scoped rule
{
  echo "version: 1"
  echo "scope:"
  if [ "$SHAPE" = niete ]; then echo "  - bot/**"; else printf '  - shared/**\n  - workers/**\n  - whatsapp-bot.js\n  - flows/**\n'; fi
  echo "  - tests/features/whatsapp/$SUITE/**"
  echo "features:"
  echo "  menu:"
  echo "    - ${RT}shared/services/menu.service.js"
  echo "  status:"
  echo "    - ${RT}shared/services/status.service.js"
  echo "shared:"
  echo "  ${RT}shared/services/whatsapp.service.js: \"*\""
  if [ "$SHAPE" = rumi ]; then
    echo "rules:"
    echo "  - glob: shared/services/palestine-pregen-lp.service.js"
    echo "    features:"
    echo "      - menu"
    echo "    tenants:"
    echo "      - ps"
  fi
} > "$D/.claude/qa/config/feature-map.yaml"
printf '{}\n' > "$D/.claude/qa/config/known-findings.json"

# load_feature_order() needs BOTH `order:` and `feature:` in the frontmatter — that is what fixes the
# run order and the canonical feature list (the map's keys are checked against it).
i=0
for f in menu status; do
  i=$((i + 1))
  printf -- '---\nfeature: %s\norder: %d\n---\n# %s executor (fixture)\n' "$f" "$i" "$f" > "$D/.claude/qa/agents/$f-agent.md"
done

cat > "$D/tests/features/whatsapp/$SUITE/menu.feature" <<Y
@whatsapp @profile:$SUITE @feature:menu @persona:teacher
Feature: /menu surface

  @e2e @menu @P1
  Scenario: /menu renders the card
    Given a registered teacher
    When she sends "/menu"
    Then the reply header is the menu card

  @e2e @menu @copy @P2
  Scenario: /menu lists the tenant's feature rows
    When she opens the list
    Then the rows match the tenant copy fixture
Y
cat > "$D/tests/features/whatsapp/$SUITE/status.feature" <<Y
@whatsapp @profile:$SUITE @feature:status @persona:teacher
Feature: /status surface

  @e2e @status @P1
  Scenario: /status opens the status Flow
    When she sends "/status"
    Then a Flow card is offered
Y

cat > "$D/.claude/qa/shared/features/menu.cjs" <<'JS'
// @mock-lane — fixture driver
exports.run = async ({ api, rec }) => {
  const r = await api.sendWait('/menu');
  rec('M01', '/menu renders the card', r.ok ? 'PASS' : 'FAIL', {});
};
JS
printf "module.exports = { ROWS: ['Lesson Plans'] };\n" > "$SVC/menu.service.js"
printf "module.exports = { status: () => 'ok' };\n" > "$SVC/status.service.js"
printf "module.exports = { send: () => {} };\n" > "$SVC/whatsapp.service.js"
[ "$SHAPE" = rumi ] && printf "module.exports = {};\n" > "$SVC/palestine-pregen-lp.service.js"
printf '# fixture\n' > "$D/README.md"
printf '.claude/.e2e-pending/\n' > "$D/.gitignore"

# --real: NIETE's actual tenant layer at the pinned sha replaces the minimal one written above.
if [ "$REAL" = 1 ]; then
  rm -rf "$D/.claude/qa/agents" "$D/.claude/qa/shared/features" "$D/tests/features/whatsapp/niete" "$D/.claude/qa/ledgers"
  git -C "$NIETE_SRC" archive "$NIETE_SHA" \
      .claude/qa/config .claude/qa/agents .claude/qa/shared/features tests/features/whatsapp/niete .claude/qa/ledgers \
    | tar -x -C "$D"
  # the archive carries no tenants.yaml (NIETE has none yet) — ours above stays; the real map's keys are
  # the nine agents, and the tenant's `features:` list names all nine.
  [ -f "$D/.claude/qa/ledgers/runs.jsonl" ] || : > "$D/.claude/qa/ledgers/runs.jsonl"
fi

git -C "$D" init -q -b "$LANDING"
git -C "$D" config user.email fixture@local
git -C "$D" config user.name fixture
git -C "$D" remote add origin "https://github.com/fixture/$REMOTE.git"
git -C "$D" add -A >/dev/null
git -C "$D" commit -qm baseline
printf '%s\n' "$D"

# ── workspace re-layout: the tenant layer moves ABOVE the clone, the engine with it ──────────────────────────────
if [ "$WORKSPACE" = 1 ]; then
  WS="$D.ws.$$"; mkdir -p "$WS/.claude/qa/tenants/niete"
  mv "$D/.claude/qa/config" "$D/.claude/qa/agents" "$D/.claude/qa/ledgers" "$WS/.claude/qa/tenants/niete/"
  [ -d "$D/.claude/qa/fixtures" ] && mv "$D/.claude/qa/fixtures" "$WS/.claude/qa/tenants/niete/"
  rm -f "$D/.claude/qa/engine"; ln -s "$ENGINE" "$WS/.claude/qa/engine"
  # the clone must name its repo by origin, like a real developer clone
  git -C "$D" remote add origin https://github.com/Orenda-Project/NIETE-Rumi.git 2>/dev/null || true
  # the shims inside the clone point at the workspace's engine
  for h in e2e-autorun.sh e2e-autorun-stop.sh e2e-pending-banner.sh; do
    printf '#!/bin/bash\nexec bash "$(cd "$(dirname "$0")/../.." && pwd)/../.claude/qa/engine/hooks/%s" "$@"\n' "$h" > "$D/.claude/hooks/$h"
  done
  git -C "$D" add -A >/dev/null 2>&1; git -C "$D" -c user.email=fixture@e2e -c user.name=fixture commit -qm "workspace re-layout" >/dev/null 2>&1 || true
  mv "$D" "$WS/NIETE-Rumi"; mv "$WS" "$D"
fi
