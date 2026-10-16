/**
 * bd-v0toag.45 — register the coach visit-request UTILITY template in en_US and ur. Since bd-v0toag.38.9 it
 * submits coach_visit_request_v2 (score, reasons, card link); pass --v1 for the original.
 *
 * The bodies come from shared/templates/coach-visit-request.template.js — the same module the sender reads —
 * so what Meta approves is what we fill.
 *
 * Usage (templates are per-WABA: run once for each environment that sends it):
 *   WABA_ID=<waba> WHATSAPP_TOKEN=<token> node scripts/register-coach-visit-request-template.js           # submit
 *   WABA_ID=<waba> WHATSAPP_TOKEN=<token> node scripts/register-coach-visit-request-template.js --status  # check
 *
 * Nothing is sent with it until ab_v10_enabled is on and a C/D teacher asks; a send before approval fails
 * and the request is recorded as failed.
 *
 * NEVER delete-and-recreate a name — deletion locks the name+language for ~4 weeks (Meta error 2388023).
 * To change a body, bump the name (_v2).
 */

/* eslint-disable no-console */
const V = require('../shared/templates/coach-visit-request.template');

const PICK = process.argv.includes('--v1') ? { t: V.TEMPLATE, ex: V.EXAMPLES } : { t: V.TEMPLATE_V2, ex: V.EXAMPLES_V2 };
const TEMPLATE = PICK.t;

const WABA_ID = process.env.WABA_ID;
const TOKEN = process.env.WHATSAPP_TOKEN;
const GRAPH = 'https://graph.facebook.com/v21.0';

function payloads(t = V.TEMPLATE_V2, ex = t === V.TEMPLATE ? V.EXAMPLES : V.EXAMPLES_V2) {
  return Object.entries(t.bodies).map(([language, text]) => ({
    name: t.name,
    language,
    category: 'UTILITY',
    components: [{ type: 'BODY', text, example: { body_text: [ex[language]] } }],
  }));
}

async function status() {
  const r = await fetch(`${GRAPH}/${WABA_ID}/message_templates?name=${TEMPLATE.name}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const d = await r.json();
  const rows = (d.data || []).filter((x) => x.name === TEMPLATE.name);
  if (!rows.length) console.log(`${TEMPLATE.name} → not found on this WABA`);
  for (const x of rows) {
    console.log(`${x.name} [${x.language}] → ${x.status}${x.rejected_reason ? ` (${x.rejected_reason})` : ''}`);
  }
}

async function submit() {
  for (const body of payloads(PICK.t, PICK.ex)) {
    const r = await fetch(`${GRAPH}/${WABA_ID}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.id) console.log(`${body.name} [${body.language}] submitted ✅ id=${d.id} status=${d.status || 'PENDING'}`);
    else console.error(`${body.name} [${body.language}] submit failed:`, JSON.stringify(d));
  }
}

async function main() {
  if (!WABA_ID || !TOKEN) {
    console.error('Set WABA_ID and WHATSAPP_TOKEN'); process.exit(1);
  }
  if (process.argv.includes('--status')) return status();
  return submit();
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { payloads };
