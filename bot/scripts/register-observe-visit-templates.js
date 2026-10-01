/**
 * bd-xorfy — register the three teacher visit-notice UTILITY templates
 * (observation_visit_{scheduled,rescheduled,cancelled}) in en_US and ur.
 *
 * The bodies come from shared/templates/observe-visit-notice.template.js — the
 * same module the sender reads — so what Meta approves is what we fill.
 *
 * Usage (templates are per-WABA: run once for EACH of sandbox, staging, prod):
 *   WABA_ID=<waba> WHATSAPP_TOKEN=<token> node scripts/register-observe-visit-templates.js           # submit
 *   WABA_ID=<waba> WHATSAPP_TOKEN=<token> node scripts/register-observe-visit-templates.js --status  # check
 *
 * Then set OBSERVE_TEACHER_NOTIFY_ENABLED on that environment's bot service —
 * never before every template reads APPROVED.
 *
 * NEVER delete-and-recreate a name — deletion locks the name+language for
 * ~4 weeks (Meta error 2388023). To change a body, bump the name (_v2).
 */

/* eslint-disable no-console */
const { TEMPLATES, EXAMPLES } = require('../shared/templates/observe-visit-notice.template');

const WABA_ID = process.env.WABA_ID;
const TOKEN = process.env.WHATSAPP_TOKEN;
const GRAPH = 'https://graph.facebook.com/v21.0';

function payloads() {
  const out = [];
  for (const t of Object.values(TEMPLATES)) {
    for (const [language, text] of Object.entries(t.bodies)) {
      out.push({
        name: t.name,
        language,
        category: 'UTILITY',
        components: [{ type: 'BODY', text, example: { body_text: [EXAMPLES[language]] } }],
      });
    }
  }
  return out;
}

async function status() {
  for (const t of Object.values(TEMPLATES)) {
    const r = await fetch(`${GRAPH}/${WABA_ID}/message_templates?name=${t.name}&access_token=${TOKEN}`);
    const d = await r.json();
    const rows = (d.data || []).filter((x) => x.name === t.name);
    if (!rows.length) console.log(`${t.name} → not found on this WABA`);
    for (const x of rows) {
      console.log(`${x.name} [${x.language}] → ${x.status}${x.rejected_reason ? ` (${x.rejected_reason})` : ''}`);
    }
  }
}

async function submit() {
  for (const body of payloads()) {
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
