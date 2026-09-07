#!/usr/bin/env node
'use strict';
/**
 * bd-oak77.13 — publish the conversational-components manifest to one WhatsApp
 * number, from the one config the bot itself reads.
 *
 * The manifest is prompts (ice breakers) + slash commands + the welcome switch.
 * `POST /{phone_number_id}/conversational_automation` REPLACES the whole thing —
 * there is no partial update — which is how
 * `scripts/deployment/configure-menu-command.js` can silently wipe four ice
 * breakers and `enable_welcome_message` while looking like it only touches
 * commands. This script always sends the COMPLETE manifest from
 * `shared/config/conversational-components.js`, the same module
 * `text-message.handler.js` matches taps against, so the two cannot drift.
 *
 * Read-only by default. Nothing is written without `--apply`.
 *
 *   node bot/scripts/set-conversational-components.js --phone-id=<id>
 *   node bot/scripts/set-conversational-components.js --phone-id=<id> --apply
 *
 * Token: `WHATSAPP_TOKEN` in the environment (a Railway service variable). It is
 * never printed, logged or echoed — only its presence and length.
 *
 * Idempotent: a GET runs first, and when the live manifest already equals the
 * desired one the POST is skipped and the script exits 0. A second `--apply` in
 * a row is a no-op, and re-running after a partial failure is safe.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  PROMPTS, COMMANDS, ENABLE_WELCOME_MESSAGE, MAX_PROMPTS, MAX_PROMPT_CHARS,
} = require('../shared/config/conversational-components');

const API_VERSION = process.env.GRAPH_API_VERSION || 'v21.0';
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const APPLY = argv.includes('--apply');
const PHONE_NUMBER_ID = arg('phone-id', process.env.PHONE_NUMBER_ID);
const TOKEN = process.env.WHATSAPP_TOKEN;

const cp = (s) => [...String(s)].length;

function desired() {
  return {
    enable_welcome_message: ENABLE_WELCOME_MESSAGE,
    commands: COMMANDS.map((c) => ({
      command_name: c.command_name,
      command_description: c.command_description,
    })),
    prompts: [...PROMPTS],
  };
}

/** Compare only the three fields we own; Meta echoes an `id` we must ignore. */
function sameManifest(live, want) {
  if (!live) return false;
  if (Boolean(live.enable_welcome_message) !== Boolean(want.enable_welcome_message)) return false;
  const lp = live.prompts || [];
  if (lp.length !== want.prompts.length) return false;
  if (lp.some((p, i) => p !== want.prompts[i])) return false;
  const lc = (live.commands || []).map((c) => `${c.command_name} ${c.command_description}`).sort();
  const wc = want.commands.map((c) => `${c.command_name} ${c.command_description}`).sort();
  return lc.length === wc.length && lc.every((c, i) => c === wc[i]);
}

async function graph(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text || '{}'); } catch (e) { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Graph ${method} ${res.status}: ${JSON.stringify(json).slice(0, 600)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const readback = () =>
  graph('GET', `${GRAPH}/${PHONE_NUMBER_ID}?fields=conversational_automation`)
    .then((r) => r.conversational_automation || null);

async function main() {
  if (!PHONE_NUMBER_ID) {
    console.error('[x] no phone number id - pass --phone-id=<id> or set PHONE_NUMBER_ID');
    process.exit(2);
  }
  if (!TOKEN) {
    console.error('[x] WHATSAPP_TOKEN is not set in this environment');
    process.exit(2);
  }

  const want = desired();

  // Pre-flight the API's own limits in code, so a bad edit fails here with a
  // readable message instead of as a 400 halfway through a rollout.
  if (want.prompts.length > MAX_PROMPTS) {
    console.error(`[x] ${want.prompts.length} prompts, Meta allows ${MAX_PROMPTS}`);
    process.exit(2);
  }
  for (const p of want.prompts) {
    if (cp(p) > MAX_PROMPT_CHARS) {
      console.error(`[x] prompt over the ${MAX_PROMPT_CHARS}-char cap (${cp(p)}): ${p}`);
      process.exit(2);
    }
  }

  console.log(`phone_number_id : ${PHONE_NUMBER_ID}`);
  console.log(`graph version   : ${API_VERSION}`);
  console.log(`token           : present (${TOKEN.length} chars)`); // never the value
  console.log(`mode            : ${APPLY ? 'APPLY' : 'dry run (no write)'}\n`);

  console.log('DESIRED');
  console.log(`  enable_welcome_message: ${want.enable_welcome_message}`);
  want.prompts.forEach((p, i) => console.log(`  prompt ${i + 1}: "${p}"  (${cp(p)} chars)`));
  want.commands.forEach((c) => console.log(`  /${c.command_name} - ${c.command_description}`));

  console.log('\nLIVE (before)');
  const before = await readback();
  console.log(JSON.stringify(before, null, 2));

  if (sameManifest(before, want)) {
    console.log('\n[=] already in sync - nothing to write.');
    return;
  }

  if (!APPLY) {
    console.log('\n[!] live manifest differs from desired. Re-run with --apply to publish.');
    process.exitCode = 1;
    return;
  }

  console.log('\n[>] POST conversational_automation ...');
  await graph('POST', `${GRAPH}/${PHONE_NUMBER_ID}/conversational_automation`, want);

  console.log('\nLIVE (after)');
  const after = await readback();
  console.log(JSON.stringify(after, null, 2));

  if (!sameManifest(after, want)) {
    // Meta accepts the POST and propagates asynchronously; a mismatch here is
    // worth a non-zero exit so a deploy script does not call it done.
    console.error('\n[x] readback does not match desired yet (propagation can lag) - re-run to confirm.');
    process.exitCode = 1;
    return;
  }
  console.log('\n[ok] published and verified by readback.');
}

main().catch((e) => {
  console.error(`[x] ${e.message}`);
  process.exit(1);
});
