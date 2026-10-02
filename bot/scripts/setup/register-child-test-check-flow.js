#!/usr/bin/env node
/**
 * Register the child test check Flow on the NIETE **sandbox** WhatsApp account, and nowhere else
 *.
 *
 * The child test runs on sandbox only (golive PLAN §8). register-one-flow.js will register any flow on
 * whatever account an env file points at, and an env file's name is not evidence of which account that
 * is. This wrapper refuses to go on unless BOTH the env file and the live account say sandbox:
 *
 *   - WHATSAPP_BOT_NUMBER is the sandbox number (+92 302 5502255), and the WABA's own listed number,
 *     asked of Meta, is the same one;
 *   - SUPABASE_URL is the sandbox project, never NIETE prod or Rumi prod;
 *   - APP_URL (the endpoint base Meta will call) is the sandbox bot.
 *
 * Then, in order:
 *   1. validate: the committed docs/flows/child-test-check.json equals its generator's output (the
 *      contract test's first guard, run here so a stale JSON is never uploaded);
 *   2. hand over to register-one-flow.js --flow "Child Test Check" — a dry run unless --yes.
 *
 * USAGE (from the repo root)
 *   node bot/scripts/setup/register-child-test-check-flow.js --env-file ~/.childtest-golive/sandbox.env
 *   node bot/scripts/setup/register-child-test-check-flow.js --env-file ~/.childtest-golive/sandbox.env --yes
 * Then set CHILD_TEST_CHECK_FLOW_ID=<id> on the sandbox bot service.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SANDBOX_NUMBER = '923025502255';
const SANDBOX_DB_REF = 'olvritwoqujtjvwfulbh';
const PROD_DB_REFS = ['ihzciabopbttygxxgrkm', 'jlpenspfdcwxkopaidys'];
const FLOW_NAME = 'Child Test Check';
const digits = (s) => String(s || '').replace(/\D+/g, '');

/**
 * @param {object} env          the env file's values
 * @param {string} listedNumber the display number Meta lists on env.WABA_ID
 * @returns {{ok: true} | {ok: false, why: string}}
 */
function checkSandboxTarget(env, listedNumber) {
  if (digits(env.WHATSAPP_BOT_NUMBER) !== SANDBOX_NUMBER) return { ok: false, why: 'WHATSAPP_BOT_NUMBER is not the sandbox number' };
  if (digits(listedNumber) !== SANDBOX_NUMBER) return { ok: false, why: 'the WABA in this env file lists a number that is not the sandbox number' };
  const db = String(env.SUPABASE_URL || '');
  if (PROD_DB_REFS.some((r) => db.includes(r))) return { ok: false, why: 'SUPABASE_URL is a production database' };
  if (!db.includes(SANDBOX_DB_REF)) return { ok: false, why: 'SUPABASE_URL is not the sandbox project' };
  if (!/sandbox/i.test(String(env.APP_URL || ''))) return { ok: false, why: 'APP_URL is not the sandbox bot' };
  return { ok: true };
}

function validateCommittedJson() {
  const { buildChildTestCheckFlow } = require('../../shared/services/child-test/check-flow/flow');
  const file = path.join(__dirname, '../../../docs/flows/child-test-check.json');
  const committed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return JSON.stringify(committed) === JSON.stringify(buildChildTestCheckFlow());
}

async function main() {
  const i = process.argv.indexOf('--env-file');
  const envFile = i > 0 ? process.argv[i + 1] : null;
  const write = process.argv.includes('--yes');
  if (!envFile || !fs.existsSync(envFile)) {
    console.error('Usage: --env-file <sandbox env> [--yes]');
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
    console.error(`Refused: ${target.why}. This flow is registered on the sandbox account only.`);
    process.exit(2);
  }
  console.log(`Sandbox account confirmed (${listed[0].display_phone_number}).`);
  if (!validateCommittedJson()) {
    console.error('Refused: docs/flows/child-test-check.json is not the generator output. Run node bot/scripts/generate-child-test-check-flow-json.js first.');
    process.exit(3);
  }
  console.log('Flow JSON matches its generator.');
  const args = [path.join(__dirname, 'register-one-flow.js'), '--flow', FLOW_NAME, '--env-file', envFile, ...(write ? ['--yes'] : [])];
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  process.exit(r.status == null ? 1 : r.status);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { checkSandboxTarget, validateCommittedJson, FLOW_NAME, SANDBOX_NUMBER };
