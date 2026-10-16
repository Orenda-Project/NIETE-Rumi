/**
 * bd-v0toag.32 — register the weekly usage report UTILITY templates (weekly_usage_v1, weekly_usage_quiet_v1)
 * in en_US and ur: four submissions. Bodies and examples come from shared/templates/weekly-usage.template.js,
 * the same module the sender reads, so what Meta approves is what we fill.
 *
 * Usage (templates are per-WABA: run once for each environment that sends them):
 *   WABA_ID=<waba> WHATSAPP_TOKEN=<token> node scripts/register-weekly-usage-templates.js           # submit
 *   WABA_ID=<waba> WHATSAPP_TOKEN=<token> node scripts/register-weekly-usage-templates.js --status  # check
 *
 * After approval add the names to app_settings.v10_weekly_report_templates. A name not on that list is never sent.
 * NEVER delete-and-recreate a name — deletion locks the name+language for ~4 weeks (Meta error 2388023).
 * To change a body, bump the name (_v2).
 */

/* eslint-disable no-console */
const { TEMPLATE, QUIET_TEMPLATE } = require('../shared/templates/weekly-usage.template');

const TEMPLATES = [TEMPLATE, QUIET_TEMPLATE];
const WABA_ID = process.env.WABA_ID;
const TOKEN = process.env.WHATSAPP_TOKEN;
const GRAPH = 'https://graph.facebook.com/v21.0';

function payloads(templates = TEMPLATES) {
  return templates.flatMap((t) => Object.entries(t.bodies).map(([language, text]) => ({
    name: t.name,
    language,
    category: 'UTILITY',
    components: [{ type: 'BODY', text, example: { body_text: [t.examples[language]] } }],
  })));
}

async function status() {
  for (const t of TEMPLATES) {
    // eslint-disable-next-line no-await-in-loop
    const r = await fetch(`${GRAPH}/${WABA_ID}/message_templates?name=${t.name}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    // eslint-disable-next-line no-await-in-loop
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
    // eslint-disable-next-line no-await-in-loop
    const r = await fetch(`${GRAPH}/${WABA_ID}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // eslint-disable-next-line no-await-in-loop
    const d = await r.json();
    if (d.id) console.log(`${body.name} [${body.language}] submitted id=${d.id} status=${d.status || 'PENDING'}`);
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
