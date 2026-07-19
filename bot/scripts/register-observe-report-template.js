/**
 * FEAT-053 bd-25 — register the observation_report_sw UTILITY template.
 *
 * The teacher's combined report is delivered via the quiz template-unlock
 * architecture: when her 24h window is closed, this template invites her to
 * tap "Pata ripoti"; the tap opens the window and the stored report follows.
 *
 * Usage:
 *   WABA_ID=<waba> node scripts/register-observe-report-template.js          # submit
 *   WABA_ID=<waba> node scripts/register-observe-report-template.js --status # check
 *
 * WABA ids: staging (Shams) 1568780677606684 · TZ prod — see credentials doc.
 * Token: WHATSAPP_TOKEN from the service env.
 *
 * NEVER delete-and-recreate this template name — deletion locks the
 * name+language for ~4 weeks (Meta error 2388023). To change it, bump the
 * name (observation_report_sw_v2).
 */

/* eslint-disable no-console */
const WABA_ID = process.env.WABA_ID;
const TOKEN = process.env.WHATSAPP_TOKEN;
const GRAPH = 'https://graph.facebook.com/v21.0';

const TEMPLATE = {
  name: 'observation_report_sw',
  language: 'sw',
  category: 'UTILITY',
  components: [
    {
      type: 'BODY',
      text: 'Habari {{1}}! {{2}} amekutumia ripoti ya somo lako pamoja na kumbukumbu za mazungumzo yenu. 🌱 Bonyeza hapa chini kuipokea.',
      example: { body_text: [['Bi. Zainabu', 'Elisha Mushi']] },
    },
    {
      type: 'BUTTONS',
      buttons: [{ type: 'QUICK_REPLY', text: 'Pata ripoti' }],
    },
  ],
};

async function main() {
  if (!WABA_ID || !TOKEN) {
    console.error('Set WABA_ID and WHATSAPP_TOKEN'); process.exit(1);
  }
  if (process.argv.includes('--status')) {
    const r = await fetch(`${GRAPH}/${WABA_ID}/message_templates?name=${TEMPLATE.name}&access_token=${TOKEN}`);
    const d = await r.json();
    for (const t of d.data || []) {
      console.log(`${t.name} [${t.language}] → ${t.status}${t.rejected_reason ? ` (${t.rejected_reason})` : ''}`);
    }
    if (!(d.data || []).length) console.log('not found on this WABA');
    return;
  }
  const r = await fetch(`${GRAPH}/${WABA_ID}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(TEMPLATE),
  });
  const d = await r.json();
  if (d.id) console.log(`submitted ✅ id=${d.id} status=${d.status || 'PENDING'}`);
  else console.error('submit failed:', JSON.stringify(d));
}

main().catch((e) => { console.error(e); process.exit(1); });
