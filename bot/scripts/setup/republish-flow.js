#!/usr/bin/env node
/**
 * Re-publish ONE existing WhatsApp Flow from its JSON on disk.
 *
 * WHY THIS EXISTS
 *
 * register-all-flows.js cannot do this. It is deliberately idempotent and SKIPS
 * any flow that already exists in Meta (findFlowByName → record EXISTS → move
 * on), which is correct for first-time setup and useless for a change to a live
 * Flow. The skill doc's advice — "re-run the Flow registration script" — is
 * therefore misleading for an existing Flow: re-running it does nothing.
 *
 * Editing the JSON on disk changes nothing on Meta's side either. Meta keeps
 * serving the previously-published asset until a new one is uploaded AND
 * published. This script is that step.
 *
 * ORDER MATTERS. Meta probes the Flow's endpoint before allowing publish and
 * fails with error_subcode 4233014 ("Endpoint not available") if it cannot reach
 * it. So: merge → wait for the deploy → THEN republish. Publishing first just
 * burns a failed attempt.
 *
 * SAFETY
 *   - Dry run by default. Nothing is written without --yes.
 *   - Prints the WABA and the phone number attached to it BEFORE writing, because
 *     "which environment am I pointed at" is the only question that really
 *     matters here and the answer lives in an env var you cannot see.
 *   - Backs the currently-published JSON up to a file first, so a bad publish is
 *     recoverable by re-running this script against the backup.
 *   - Verifies by RE-FETCHING the published asset afterwards rather than trusting
 *     the API's success response.
 *
 *   node bot/scripts/setup/republish-flow.js --flow-id $REGISTRATION_FLOW_ID --json docs/flows/registration-flow-v3.json
 *   node bot/scripts/setup/republish-flow.js --flow-id ... --json ... --yes
 *
 * Run from the repo root — dotenv resolves relative to the working directory.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { MetaAPI } = require('./meta-api');

const GRAPH = 'https://graph.facebook.com/v21.0';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function get(url, token) {
  const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  const body = await res.json();
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

/** The currently-published FLOW_JSON, or null if the flow has no asset yet. */
async function fetchPublishedJson(flowId, token) {
  const assets = await get(`${GRAPH}/${flowId}/assets`, token);
  const asset = (assets.data || []).find((a) => a.asset_type === 'FLOW_JSON');
  if (!asset?.download_url) return null;
  // The download URL is pre-signed; sending the bearer token to it is unnecessary
  // and Meta rejects some signed URLs that carry one.
  const res = await fetch(asset.download_url);
  if (!res.ok) throw new Error(`asset download → ${res.status}`);
  return res.json();
}

async function main() {
  const flowId = arg('flow-id') || process.env.REGISTRATION_FLOW_ID;
  const jsonPath = arg('json');
  const write = process.argv.includes('--yes');

  if (!flowId || !jsonPath) {
    console.error('Usage: --flow-id <id> --json <path/to/flow.json> [--yes]');
    process.exit(1);
  }

  const token = process.env.WHATSAPP_TOKEN;
  const wabaId = process.env.WABA_ID;
  if (!token || !wabaId) {
    console.error('WHATSAPP_TOKEN and WABA_ID must be set. Run from the repo root.');
    process.exit(1);
  }

  const nextJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  // --- name the target out loud, before touching it -----------------------
  const flow = await get(
    `${GRAPH}/${flowId}?fields=id,name,status,validation_errors,whatsapp_business_account`,
    token
  );
  const numbers = await get(
    `${GRAPH}/${wabaId}/phone_numbers?fields=display_phone_number,verified_name`,
    token
  );

  console.log(`Flow      ${flow.name} (${flow.id})`);
  console.log(`Status    ${flow.status}`);
  console.log(`WABA      ${wabaId}`);
  console.log(`Numbers   ${(numbers.data || []).map((n) => n.display_phone_number).join(', ') || '(none)'}`);
  console.log(`JSON      ${jsonPath}`);
  console.log(`Mode      ${write ? 'PUBLISH' : 'DRY RUN — nothing will be written'}\n`);

  if (flow.whatsapp_business_account && flow.whatsapp_business_account.id !== wabaId) {
    console.error(
      `Refusing: flow belongs to WABA ${flow.whatsapp_business_account.id}, but WABA_ID is ${wabaId}. ` +
      'The environment is not what this .env thinks it is.'
    );
    process.exit(1);
  }

  // --- back the current asset up before replacing it ----------------------
  const current = await fetchPublishedJson(flowId, token);
  if (current) {
    const backupDir = path.join('bot', 'scripts', 'setup', 'assets', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    // Deliberately no timestamp in the name: this script must be runnable in a
    // resumable/deterministic context, and one backup per flow per run is enough
    // to roll the previous publish back.
    const backup = path.join(backupDir, `${flow.name.replace(/\W+/g, '-').toLowerCase()}-${flowId}.published.json`);
    fs.writeFileSync(backup, JSON.stringify(current, null, 2) + '\n');
    console.log(`Backed up the live asset → ${backup}`);
    console.log('  (to roll back: re-run this script with --json <that file> --yes)\n');
  } else {
    console.log('No existing FLOW_JSON asset to back up.\n');
  }

  if (!write) {
    console.log('Dry run complete. Re-run with --yes to upload and publish.');
    return;
  }

  const api = new MetaAPI({ wabaId, accessToken: token, phoneNumberId: process.env.PHONE_NUMBER_ID });

  console.log('Uploading FLOW_JSON…');
  await api.uploadFlowJson(flowId, nextJson);

  console.log('Publishing…');
  await api.publishFlow(flowId);

  // --- verify by re-fetching, not by trusting the response ---------------
  const after = await fetchPublishedJson(flowId, token);
  const detail = await get(`${GRAPH}/${flowId}?fields=status,validation_errors`, token);
  const same = JSON.stringify(after) === JSON.stringify(nextJson);

  console.log(`\nStatus now        ${detail.status}`);
  console.log(`Validation errors ${JSON.stringify(detail.validation_errors || [])}`);
  console.log(`Published JSON matches disk: ${same ? 'YES' : 'NO'}`);
  if (!same) {
    console.log('  Meta normalises some fields on ingest, so a mismatch is not automatically a failure —');
    console.log('  compare the screens you changed before concluding anything.');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Republish failed:', err.message);
    process.exit(1);
  });
}

module.exports = { fetchPublishedJson };
