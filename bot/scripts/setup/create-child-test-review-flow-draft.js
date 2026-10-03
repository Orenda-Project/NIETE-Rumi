#!/usr/bin/env node
/**
 * Create (or refresh) the child test end-of-visit review Flow as a DRAFT on the NIETE **sandbox** WhatsApp
 * account, and print Meta's validation errors. It never publishes: a published Flow is frozen, and its
 * completions must land on a bot that already has the review code, so L0 publishes after the deploy.
 *
 * Same guard as the check Flow (register-child-test-check-flow.js): the env file AND the live account must
 * both say sandbox. The review Flow is navigate-only (no endpoint), so no endpoint_uri is set.
 *
 * USAGE (from the repo root)
 *   node bot/scripts/generate-child-test-review-flow-json.js
 *   node bot/scripts/setup/create-child-test-review-flow-draft.js --env-file ~/.childtest-golive/sandbox.env
 * Then (L0, after the sandbox deploy):  POST /<flow id>/publish, and set CHILD_TEST_REVIEW_FLOW_ID=<id>.
 */

const fs = require('fs');
const path = require('path');
const { checkSandboxTarget } = require('./register-child-test-check-flow');

const FLOW_NAME = 'Child Test Review';
const JSON_PATH = path.join(__dirname, '../../../docs/flows/child-test-review.json');

/** What to do given the WABA's flows: create, upload to the existing draft, or refuse a published one. */
function planDraft(flows) {
  const mine = (flows || []).filter((f) => f && f.name === FLOW_NAME);
  const draft = mine.find((f) => f.status === 'DRAFT');
  if (draft) return { action: 'upload', flowId: String(draft.id) };
  if (mine.length) return { action: 'refuse', why: `"${FLOW_NAME}" exists and is ${mine[0].status}; a published Flow is changed by L0, not by this script` };
  return { action: 'create' };
}

function validateCommittedJson() {
  const { buildChildTestReviewFlow } = require('../../shared/services/child-test/check-flow/review-flow');
  const committed = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  return JSON.stringify(committed) === JSON.stringify(buildChildTestReviewFlow());
}

async function main() {
  const i = process.argv.indexOf('--env-file');
  const envFile = i > 0 ? process.argv[i + 1] : null;
  if (!envFile || !fs.existsSync(envFile)) {
    console.error('Usage: --env-file <sandbox env>');
    process.exit(1);
  }
  const { readEnvFile } = require('./register-one-flow');
  const { MetaAPI } = require('./meta-api');
  const env = readEnvFile(envFile);
  if (!env.WABA_ID || !env.WHATSAPP_TOKEN) {
    console.error(`${envFile} must define WABA_ID and WHATSAPP_TOKEN.`);
    process.exit(1);
  }
  const api = new MetaAPI({ wabaId: env.WABA_ID, accessToken: env.WHATSAPP_TOKEN, phoneNumberId: env.PHONE_NUMBER_ID });
  const numbers = await api._request(`${api.baseUrl}/${env.WABA_ID}/phone_numbers?fields=display_phone_number`, {
    method: 'GET', headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
  });
  const listed = numbers.success ? (numbers.data && numbers.data.data) || [] : [];
  const target = checkSandboxTarget(env, listed.length === 1 ? listed[0].display_phone_number : '');
  if (!target.ok) {
    console.error(`Refused: ${target.why}. This flow is created on the sandbox account only.`);
    process.exit(2);
  }
  console.log(`Sandbox account confirmed (${listed[0].display_phone_number}).`);
  if (!validateCommittedJson()) {
    console.error('Refused: docs/flows/child-test-review.json is not the generator output. Run node bot/scripts/generate-child-test-review-flow-json.js first.');
    process.exit(3);
  }
  const flows = await api.listFlows();
  if (!flows.success) {
    console.error(`Could not list the account's flows: ${JSON.stringify(flows.error)}`);
    process.exit(4);
  }
  const plan = planDraft(flows.data);
  if (plan.action === 'refuse') {
    console.error(`Refused: ${plan.why}.`);
    process.exit(4);
  }
  let flowId = plan.flowId;
  if (plan.action === 'create') {
    const made = await api.createFlow(FLOW_NAME, ['OTHER']);
    if (!made.success || !made.data || !made.data.id) {
      console.error(`Create failed: ${JSON.stringify(made.error || made.data)}`);
      process.exit(5);
    }
    flowId = String(made.data.id);
    console.log(`Created DRAFT flow ${flowId}.`);
  } else console.log(`Uploading to existing DRAFT flow ${flowId}.`);
  const up = await api.uploadFlowJson(flowId, JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')));
  const errors = (up.data && up.data.validation_errors) || null;
  console.log(`Upload ${up.success ? 'accepted' : 'failed'}; validation_errors: ${JSON.stringify(errors || up.error || [])}`);
  console.log(`Not published. CHILD_TEST_REVIEW_FLOW_ID=${flowId}`);
  process.exit(up.success && (!errors || !errors.length) ? 0 : 6);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { planDraft, validateCommittedJson, checkSandboxTarget, FLOW_NAME };
