/**
 * bd-pw1ccr.8.4 / .12 — send the 2 Nov formative-assessment video (template niete_fa_video_ab_v1) to every
 * teacher of the topic-nudge A/B, both arms. Logic and modes: shared/services/fa-video/broadcast.js.
 *
 *   node scripts/broadcast-fa-video.js                                   # dry run: counts only
 *   node scripts/broadcast-fa-video.js --to <n> --video <mp4>            # review copy; <n> must be in FA_VIDEO_TEST_NUMBERS
 *   node scripts/broadcast-fa-video.js --live --video <mp4>              # the send (switch must be on)
 *
 * Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / WHATSAPP_TOKEN / PHONE_NUMBER_ID / WABA_ID
 * from the env, so the environment is whichever .env you load. The WABA id is only read for the template's
 * status and category (the dry run's cost); without it the cost prints "rate unknown". The video goes up to /{PHONE_NUMBER_ID}/media once per run.
 */

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { TEMPLATE } = require('../shared/templates/fa-video.template');
const { run, testNumbersFrom } = require('../shared/services/fa-video/broadcast');

const GRAPH = `https://graph.facebook.com/${process.env.GRAPH_API_VERSION || 'v21.0'}`;

function makeDeps({ token, phoneId, wabaId, fetchFn = fetch, readFile = fs.readFileSync }) {
  const auth = { Authorization: `Bearer ${token}` };
  return {
    async templateStatus() {
      if (!wabaId) return { status: null, category: null };
      const r = await fetchFn(`${GRAPH}/${wabaId}/message_templates?name=${TEMPLATE.name}&fields=name,status,category`, { headers: auth });
      const d = await r.json();
      const t = (d.data || []).find((x) => x.name === TEMPLATE.name);
      return t ? { status: t.status || null, category: t.category || null } : { status: null, category: null };
    },
    async upload(file) {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', 'video/mp4');
      form.append('file', new Blob([readFile(file)], { type: 'video/mp4' }), path.basename(file));
      const r = await fetchFn(`${GRAPH}/${phoneId}/media`, { method: 'POST', headers: auth, body: form });
      const d = await r.json();
      if (!d.id) throw new Error(`video upload failed: ${JSON.stringify(d)}`);
      return d.id;
    },
    async send(to, components) {
      try {
        const r = await fetchFn(`${GRAPH}/${phoneId}/messages`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: { name: TEMPLATE.name, language: { code: TEMPLATE.language }, components },
          }),
        });
        const d = await r.json();
        const id = d.messages && d.messages[0] && d.messages[0].id;
        if (r.ok && id) return { ok: true, id };
        const e = d.error || {};
        return { ok: false, error: `${e.code ?? r.status} ${e.message || 'send failed'}` };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    print: (line) => console.log(line),
    sleep: (ms) => new Promise((res) => { setTimeout(res, ms); }),
  };
}

async function main() {
  const { WHATSAPP_TOKEN, PHONE_NUMBER_ID, WABA_ID } = process.env;
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error('Set WHATSAPP_TOKEN and PHONE_NUMBER_ID'); process.exit(1);
  }
  const db = require('../shared/config/supabase');
  const r = await run(process.argv.slice(2), {
    db, testNumbers: testNumbersFrom(process.env), ...makeDeps({ token: WHATSAPP_TOKEN, phoneId: PHONE_NUMBER_ID, wabaId: WABA_ID }),
  });
  console.log(JSON.stringify(r));
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { makeDeps };
