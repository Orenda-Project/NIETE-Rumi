/**
 * bd-pw1ccr.8.3 — register niete_fa_video_ab_v1 (MARKETING, ur, VIDEO header). The body comes from
 * shared/templates/fa-video.template.js, the module the sender reads.
 *
 * A VIDEO header needs a sample: the mp4 goes up through the app's resumable upload API first, and
 * the handle it returns is the example. Handles are per-app, templates per-WABA: run once per
 * environment that sends it.
 *
 *   [APP_ID=<app>] WABA_ID=<waba> WHATSAPP_TOKEN=<token> node scripts/register-fa-video-template.js --video <mp4>
 *   WABA_ID=<waba> WHATSAPP_TOKEN=<token> node scripts/register-fa-video-template.js --status
 *
 * NEVER delete-and-recreate the name (Meta error 2388023 locks it ~4 weeks). Bump to _v2.
 */

/* eslint-disable no-console */
const fs = require('fs');
const { TEMPLATE } = require('../shared/templates/fa-video.template');

const GRAPH = 'https://graph.facebook.com/v21.0';

function payloads(handle) {
  if (!handle) throw new Error('payloads needs the sample video upload handle');
  return [{
    name: TEMPLATE.name,
    language: TEMPLATE.language,
    category: TEMPLATE.category,
    components: [
      { type: 'HEADER', format: 'VIDEO', example: { header_handle: [handle] } },
      { type: 'BODY', text: TEMPLATE.body },
    ],
  }];
}

function arg(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** The app that owns the token: APP_ID if set, else GET /app (the .env files carry no APP_ID). */
async function appIdFor(env, fetchFn = fetch) {
  if (env.APP_ID) return env.APP_ID;
  const d = await fetchFn(`${GRAPH}/app`, { headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` } })
    .then((r) => r.json());
  if (!d.id) throw new Error(`could not read the app id for this token: ${JSON.stringify(d)}`);
  return d.id;
}

async function uploadSample(appId, token, file) {
  const bytes = fs.readFileSync(file);
  const start = await fetch(
    `${GRAPH}/${appId}/uploads?file_length=${bytes.length}&file_type=video/mp4`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
  ).then((r) => r.json());
  if (!start.id) throw new Error(`upload session failed: ${JSON.stringify(start)}`);
  const done = await fetch(`${GRAPH}/${start.id}`, {
    method: 'POST', headers: { Authorization: `OAuth ${token}`, file_offset: '0' }, body: bytes,
  }).then((r) => r.json());
  if (!done.h) throw new Error(`upload failed: ${JSON.stringify(done)}`);
  return done.h;
}

async function status(waba, token) {
  const d = await fetch(`${GRAPH}/${waba}/message_templates?name=${TEMPLATE.name}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const rows = (d.data || []).filter((x) => x.name === TEMPLATE.name);
  if (!rows.length) console.log(`${TEMPLATE.name} → not found on this WABA`);
  for (const x of rows) {
    console.log(`${x.name} [${x.language}] id=${x.id} → ${x.status}${x.rejected_reason ? ` (${x.rejected_reason})` : ''}`);
  }
}

async function submit(env, file) {
  const handle = await uploadSample(await appIdFor(env), env.WHATSAPP_TOKEN, file);
  for (const body of payloads(handle)) {
    // eslint-disable-next-line no-await-in-loop
    const d = await fetch(`${GRAPH}/${env.WABA_ID}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json());
    if (d.id) console.log(`${body.name} [${body.language}] submitted id=${d.id} status=${d.status || 'PENDING'}`);
    else console.error(`${body.name} [${body.language}] submit failed:`, JSON.stringify(d));
  }
}

async function main(argv = process.argv, env = process.env) {
  if (!env.WABA_ID || !env.WHATSAPP_TOKEN) {
    console.error('Set WABA_ID and WHATSAPP_TOKEN'); process.exit(1);
  }
  if (argv.includes('--status')) return status(env.WABA_ID, env.WHATSAPP_TOKEN);
  const file = arg(argv, '--video');
  if (!file) {
    console.error('Submitting needs --video <mp4> (the sample for the header)'); process.exit(1);
  }
  return submit(env, file);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { payloads, appIdFor };
