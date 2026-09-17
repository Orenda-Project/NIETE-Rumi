#!/usr/bin/env node
/**
 * Create and publish ONE WhatsApp Flow on an account that already has others.
 *
 * WHY THIS EXISTS
 *
 * The two scripts either side of it cannot do this job.
 *
 * register-all-flows.js is built for a BLANK account. It walks every entry in
 * flow-configs.js and creates each one it cannot find by name — and it matches
 * names with `===`. On an account whose flows have been renamed since setup
 * ("Registration" is live as "Registration v4", "Pakistan LP v3" as
 * "Pakistan LP v3.2 (6-12 menu)"), that exact comparison misses, and the script
 * happily creates a second copy of a flow that is carrying live traffic. Aimed
 * at an established account it would create not one flow but eleven.
 *
 * republish-flow.js is the other half of the pair and takes a flow id that
 * already exists, so it cannot add anything.
 *
 * WHAT THIS DOES DIFFERENTLY
 *
 *   - ONE flow. The name is an argument, looked up in flow-configs.js. The
 *     list is never iterated.
 *   - Name comparison ignores case and punctuation, and a name that merely
 *     LOOKS like an existing one stops the run. A near-miss is the single
 *     thing that turns "add a flow" into "duplicate a live one", so it needs a
 *     human to look at it, not a heuristic to resolve it.
 *   - Dry run by default. --yes to write.
 *   - Every flow on the account is listed before and after, and the two are
 *     diffed on id, name AND status. "Nothing else changed" is then something
 *     the run proves rather than something the operator hopes. Status is in
 *     the diff because an asset upload reverts a PUBLISHED flow to DRAFT, and
 *     a diff that only counted rows would have missed exactly that.
 *   - The endpoint is set BEFORE publish, never after: writing endpoint_uri to
 *     a published flow silently unpublishes it.
 *
 * USAGE
 *
 *   node bot/scripts/setup/register-one-flow.js --flow "Status" --env-file .env.sandbox
 *   node bot/scripts/setup/register-one-flow.js --flow "Status" --env-file .env.sandbox --yes
 *
 * Run from the repo root.
 *
 * @module register-one-flow
 */

const fs = require('fs');
const path = require('path');

const { MetaAPI } = require('./meta-api');
const { FLOW_CONFIGS } = require('./flow-configs');

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Flatten a flow name to its comparable form: lowercase, letters and digits
 * only. "Student join — name and class" and "Student Join Name And Class"
 * collapse to the same string; "Status" and "Settings" do not.
 */
function normalizeFlowName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Pick the single config to act on.
 *
 * @returns {{ ok: true, config: object } | { ok: false, error: string, available: string[] }}
 */
function selectFlowConfig(name, configs = FLOW_CONFIGS) {
  const available = configs.map((c) => c.name);

  if (!name) {
    return { ok: false, error: 'No flow name given. Pass --flow "<name>".', available };
  }

  const wanted = normalizeFlowName(name);
  const config = configs.find((c) => normalizeFlowName(c.name) === wanted);

  if (!config) {
    return { ok: false, error: `No flow config named "${name}".`, available };
  }

  return { ok: true, config };
}

/**
 * Compare the config's name against every flow already on the account.
 *
 * 'exact'   — the same flow, normalised. Nothing to create.
 * 'similar' — one name is a prefix of the other, so this is probably the same
 *             flow under a drifted name. Stop and let a human decide.
 * 'clear'   — nothing on the account resembles it.
 */
function assessWabaForFlow({ configName, existingFlows = [] }) {
  const wanted = normalizeFlowName(configName);

  const exact = existingFlows.find((f) => normalizeFlowName(f.name) === wanted) || null;
  if (exact) return { verdict: 'exact', exact, similar: [] };

  // Containment either way, not just a shared prefix: the drift runs in both
  // directions — a live flow can be "Registration v4" (suffix) or
  // "sandbox-status" (prefix). A false positive costs one question to a human;
  // a false negative costs a duplicate of a flow that is carrying traffic.
  const similar = existingFlows.filter((f) => {
    const live = normalizeFlowName(f.name);
    return live.includes(wanted) || wanted.includes(live);
  });

  if (similar.length) return { verdict: 'similar', exact: null, similar };

  return { verdict: 'clear', exact: null, similar: [] };
}

/**
 * Diff two listings of the account's flows.
 *
 * `changed` covers a bystander being renamed or moved between PUBLISHED and
 * DRAFT — the two ways a run can damage a flow it never meant to touch.
 */
function diffFlowSnapshots(before = [], after = []) {
  const byId = (list) => new Map(list.map((f) => [String(f.id), f]));
  const b = byId(before);
  const a = byId(after);

  const added = after.filter((f) => !b.has(String(f.id)));
  const removed = before.filter((f) => !a.has(String(f.id)));

  const changed = [];
  for (const [id, prev] of b) {
    const next = a.get(id);
    if (!next) continue;
    if (prev.status !== next.status || prev.name !== next.name) {
      changed.push({
        id,
        fromName: prev.name,
        toName: next.name,
        from: prev.status,
        to: next.status,
      });
    }
  }

  return { added, removed, changed };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * @param {MetaAPI} api
 * @param {object}  opts
 * @param {object}  opts.config        One entry from FLOW_CONFIGS
 * @param {object}  opts.flowJson      Parsed contents of config.jsonPath
 * @param {string}  opts.endpointBase  Base URL for endpoint-type flows
 * @param {boolean} opts.write         false = dry run
 * @param {object}  opts.env           Environment the ids are read from
 * @param {boolean} [opts.ignoreSimilar] Proceed past a near-miss name
 * @returns {Promise<object>} { status: 'dry-run'|'refused'|'registered'|'error', ... }
 */
async function registerOneFlow(api, opts) {
  const { config, flowJson, endpointBase, write, env = {}, ignoreSimilar = false } = opts;
  const needsEndpoint = config.type === 'endpoint' && Boolean(config.endpointPath);
  const endpointUri = needsEndpoint ? `${endpointBase}${config.endpointPath}` : null;

  const plan = {
    name: config.name,
    envVar: config.envVar,
    type: config.type,
    jsonPath: config.jsonPath,
    endpointUri,
    categories: config.categories,
  };

  // --- refusals that need no network -------------------------------------
  const claimed = String(env[config.envVar] || '').trim();
  if (claimed) {
    return {
      status: 'refused',
      plan,
      existingId: claimed,
      reason:
        `${config.envVar} already holds ${claimed}. That id is this environment's ` +
        `"${config.name}" flow; creating another would orphan it. To change the ` +
        'flow itself, use republish-flow.js.',
    };
  }

  if (needsEndpoint && !endpointBase) {
    return {
      status: 'refused',
      plan,
      reason:
        `"${config.name}" is an endpoint flow and no endpoint base was resolved. ` +
        'Meta probes the endpoint when publishing; without one the publish fails ' +
        'and leaves a DRAFT behind.',
    };
  }

  // --- read the account before deciding anything -------------------------
  const beforeResult = await api.listFlows();
  if (!beforeResult.success) {
    return {
      status: 'refused',
      plan,
      reason: `Could not list the account's flows: ${beforeResult.error.message}`,
    };
  }
  const before = beforeResult.data || [];

  const assessment = assessWabaForFlow({ configName: config.name, existingFlows: before });

  if (assessment.verdict === 'exact') {
    return {
      status: 'refused',
      plan,
      existingId: assessment.exact.id,
      assessment,
      reason:
        `"${assessment.exact.name}" (${assessment.exact.id}) is already on this account. ` +
        `Set ${config.envVar} to that id rather than creating a second copy.`,
    };
  }

  if (assessment.verdict === 'similar' && !ignoreSimilar) {
    const names = assessment.similar.map((f) => `${f.name} (${f.id})`).join(', ');
    return {
      status: 'refused',
      plan,
      assessment,
      reason:
        `The account already has ${names}, which reads like the same flow under a ` +
        `different name. Creating "${config.name}" alongside it would leave two. ` +
        'If they really are different flows, re-run with --ignore-similar.',
    };
  }

  if (!write) {
    return { status: 'dry-run', plan, assessment, before };
  }

  // --- write -------------------------------------------------------------
  const created = await api.createFlow(config.name, config.categories);
  if (!created.success) {
    return { status: 'error', plan, error: `createFlow: ${created.error.message}` };
  }
  const flowId = created.data.id;

  const uploaded = await api.uploadFlowJson(flowId, flowJson);
  if (!uploaded.success) {
    return {
      status: 'error',
      plan,
      flowId,
      error:
        `uploadFlowJson: ${uploaded.error.message}. The flow exists as a DRAFT and ` +
        'was not published.',
    };
  }

  // Before publish, always. A published flow that is handed an endpoint_uri
  // drops back to DRAFT without saying so.
  if (needsEndpoint) {
    const endpointSet = await api.setFlowEndpoint(flowId, endpointUri);
    if (!endpointSet.success) {
      return {
        status: 'error',
        plan,
        flowId,
        error: `setFlowEndpoint: ${endpointSet.error.message}. Left as a DRAFT.`,
      };
    }
  }

  const published = await api.publishFlow(flowId);
  if (!published.success) {
    return {
      status: 'error',
      plan,
      flowId,
      error: `publishFlow: ${published.error.message}. Left as a DRAFT.`,
    };
  }

  // --- verify against the account, not against the API's own answers -----
  const details = await api.getFlowDetails(flowId);
  const afterResult = await api.listFlows();
  const after = afterResult.success ? afterResult.data || [] : [];
  const diff = diffFlowSnapshots(before, after);
  const collateral = diff.changed.length > 0 || diff.removed.length > 0 || diff.added.length > 1;

  return {
    status: 'registered',
    plan,
    flowId,
    details: details.success ? details.data : null,
    diff,
    collateral,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/**
 * Parse an env file without touching process.env — the point of naming the
 * file on the command line is that the environment being written to is
 * visible, not inherited from whatever happens to be exported.
 */
function readEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function describe(result) {
  if (result.plan) {
    console.log(`Flow          ${result.plan.name}`);
    console.log(`Env var       ${result.plan.envVar}`);
    console.log(`JSON          ${result.plan.jsonPath}`);
    console.log(`Endpoint      ${result.plan.endpointUri || '(navigate flow — none)'}`);
  }
}

async function main() {
  const flowName = arg('flow');
  const envFile = arg('env-file');
  const write = process.argv.includes('--yes');
  const ignoreSimilar = process.argv.includes('--ignore-similar');

  if (!flowName || !envFile) {
    console.error('Usage: --flow "<name>" --env-file <path> [--yes] [--ignore-similar]');
    console.error(`Flows: ${FLOW_CONFIGS.map((c) => c.name).join(', ')}`);
    process.exit(1);
  }

  const selection = selectFlowConfig(flowName);
  if (!selection.ok) {
    console.error(selection.error);
    console.error(`Available: ${selection.available.join(', ')}`);
    process.exit(1);
  }
  const config = selection.config;

  if (!fs.existsSync(envFile)) {
    console.error(`No such env file: ${envFile}`);
    process.exit(1);
  }
  const env = readEnvFile(envFile);

  const wabaId = env.WABA_ID;
  const accessToken = env.WHATSAPP_TOKEN;
  const endpointBase = (env.APP_URL || '').replace(/\/+$/, '');
  if (!wabaId || !accessToken) {
    console.error(`${envFile} must define WABA_ID and WHATSAPP_TOKEN.`);
    process.exit(1);
  }

  const api = new MetaAPI({ wabaId, accessToken, phoneNumberId: env.PHONE_NUMBER_ID });

  // Say which account this is, in its own words, before anything else. An env
  // file's name is not evidence of which environment it points at.
  const numbers = await api._request(
    `${api.baseUrl}/${wabaId}/phone_numbers?fields=display_phone_number,verified_name`,
    { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const listed = numbers.success ? numbers.data?.data || [] : [];

  console.log(`Env file      ${envFile}`);
  console.log(`WABA          ${wabaId}`);
  console.log(
    `Numbers       ${listed.map((n) => `${n.display_phone_number} (${n.verified_name})`).join(', ') || '(none)'}`
  );
  console.log(`App URL       ${endpointBase || '(unset)'}`);
  console.log(`Mode          ${write ? 'WRITE' : 'DRY RUN — nothing will be created'}\n`);

  const jsonPath = config.jsonPath;
  if (!fs.existsSync(jsonPath)) {
    console.error(`Flow JSON missing: ${jsonPath}`);
    process.exit(1);
  }
  const flowJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  const result = await registerOneFlow(api, {
    config,
    flowJson,
    endpointBase,
    write,
    env,
    ignoreSimilar,
  });

  describe(result);
  console.log('');

  if (result.status === 'refused') {
    console.log(`REFUSED — ${result.reason}`);
    process.exit(2);
  }

  if (result.status === 'error') {
    console.error(`FAILED — ${result.error}`);
    process.exit(1);
  }

  if (result.status === 'dry-run') {
    console.log(`Account holds ${result.before.length} flows; none of them is "${config.name}".`);
    console.log('Would create it, upload its JSON, set the endpoint, then publish.');
    console.log(`Nothing was written. Re-run with --yes to do it.`);
    return;
  }

  console.log(`CREATED       ${result.flowId}`);
  console.log(`Status        ${result.details?.status || '(re-fetch failed)'}`);
  console.log(`Added         ${result.diff.added.map((f) => `${f.name} (${f.id})`).join(', ')}`);
  console.log(`Other flows   ${result.collateral ? 'CHANGED — see below' : 'unchanged'}`);

  if (result.collateral) {
    console.error('\nCollateral change detected:');
    for (const c of result.diff.changed) {
      console.error(`  ${c.id} ${c.fromName} → ${c.toName} | ${c.from} → ${c.to}`);
    }
    for (const r of result.diff.removed) console.error(`  removed: ${r.name} (${r.id})`);
    process.exit(1);
  }

  console.log(`\nSet ${config.envVar}=${result.flowId} on the deployment, then redeploy.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = {
  normalizeFlowName,
  selectFlowConfig,
  assessWabaForFlow,
  diffFlowSnapshots,
  registerOneFlow,
  readEnvFile,
};
