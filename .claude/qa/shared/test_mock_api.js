#!/usr/bin/env node
/* test_mock_api.js — the mock driver exposes the SAME primitives the CDP driver gives a
 * feature script, so menu.cjs / language.cjs / status.cjs run unchanged against either.
 *
 * Run: node .claude/qa/shared/test_mock_api.js
 *
 * Stand-ins: a real mock-graph-api process (bot/scripts/e2e/mock-graph-api.js) and a tiny
 * scripted "bot" that answers /webhook the way the menu handler would. What is under test is
 * the adapter in mock-api.cjs: inject → wait on the outbox → return {ok, txt, btns, …}.
 *
 * Red-first: fails on develop — mock-api.cjs does not exist.
 */
const assert = require('assert');
const http = require('http');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const { createMockGraphApi } = require(path.join(REPO, 'bot/scripts/e2e/mock-graph-api.js'));
const enc = require(path.join(REPO, 'bot/shared/services/flow-encryption.service.js'));
const fs = require('fs'); const os = require('os');
// A per-test keypair: the scripted bot decrypts with the private half (as the real bot does via
// FLOW_PRIVATE_KEY); the adapter's emulator encrypts with the public half.
const FLOW_KEYS = enc.generateKeyPair(); process.env.FLOW_PRIVATE_KEY = FLOW_KEYS.privateKey;
// A flows dir with ONE stored definition, named by env var as flow-inventory.js stores them.
const FLOWS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flows-'));
const SETTINGS_JSON = JSON.parse(fs.readFileSync(path.join(REPO, '.claude/qa/fixtures/flows/SETTINGS_FLOW_ID.json'), 'utf8'));
fs.writeFileSync(path.join(FLOWS_DIR, 'SETTINGS_FLOW_ID.json'), JSON.stringify(SETTINGS_JSON));
fs.writeFileSync(path.join(FLOWS_DIR, 'manifest.json'), JSON.stringify({ flows: [{ envVar: 'SETTINGS_FLOW_ID', flowId: 'flow-settings-1', kind: 'endpoint' }] }));
const flowInbound = []; const flowExchanges = [];

let passed = 0;
const ita = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + (e && e.stack || e)); process.exitCode = 1; }
};

const PH = 'ph-1', DRIVER = '923000000001';
const ROWS = ['Teacher Training', 'Lesson Plans', 'Classroom Coaching', 'Ask Anything'];

(async () => {
  // A scripted bot: replies through the mock exactly as the real bot would (POST /messages).
  let mockBase = '';
  const send = (payload) => fetch(`${mockBase}/v21.0/${PH}/messages`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' }, body: JSON.stringify(payload) });
  const inbound = [];
  const bot = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', async () => {
      // the REAL data-exchange contract, served by the bot's own encryption service
      if (req.url === '/api/flows/settings') {
        try {
          const out = await enc.processEncryptedRequest(JSON.parse(b), async (d) => {
            flowExchanges.push(d);
            if (d.action === 'INIT') return { screen: 'SETTINGS_MAIN', data: { languages: [{ id: 'en', title: 'English' }, { id: 'ur', title: 'اردو (Urdu)' }],
              frameworks: [{ id: 'oecd', title: 'OECD 5D Framework' }], current_language: 'en', current_framework: 'oecd', info_text: 'Default: OECD.' } };
            return { screen: 'SUCCESS', data: { confirmation_message: 'Saved.', details_message: 'Language: ' + d.data.language,
              extension_message_response: { params: { flow_token: d.flow_token, language: d.data.language } } } };
          });
          res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(out);
        } catch (e) { res.writeHead(500); return res.end(JSON.stringify({ error: e.message })); }
      }
      res.writeHead(200); res.end('EVENT_RECEIVED');
      const m = JSON.parse(b).entry[0].changes[0].value.messages[0];
      inbound.push(m);
      if (m.type === 'interactive' && m.interactive.type === 'nfm_reply') { flowInbound.push(m); await send({ messaging_product: 'whatsapp', to: m.from, type: 'text', text: { body: 'Settings updated ✅' } }); return; }
      const to = m.from;
      if (m.type === 'text' && m.text.body.trim().toLowerCase() === '/settings') {
        await send({ messaging_product: 'whatsapp', to, type: 'interactive', interactive: { type: 'flow',
          header: { type: 'text', text: 'Settings' }, body: { text: 'Update your preferences' },
          action: { name: 'flow', parameters: { flow_message_version: '3', flow_token: 'user-1:settings:42', flow_id: 'flow-settings-1', flow_cta: 'Open Settings', flow_action: 'data_exchange' } } } });
        return;
      }
      if (m.type === 'text' && m.text.body.trim().toLowerCase() === '/menu') {
        await send({ messaging_product: 'whatsapp', to, type: 'interactive', interactive: { type: 'list',
          header: { type: 'text', text: "Here's what I can do!" }, body: { text: 'Choose a feature' },
          footer: { text: 'Powered by NIETE' },
          action: { button: 'View Features', sections: [{ title: 'Features', rows: ROWS.map((r, i) => ({ id: 'menu_' + i, title: r })) }] } } });
      } else if (m.type === 'interactive' && m.interactive.type === 'list_reply' && m.interactive.list_reply.id === 'menu_3') {
        await send({ messaging_product: 'whatsapp', to, type: 'text', text: { body: 'How can I help you today?' } });
      } else if (m.type === 'interactive' && m.interactive.type === 'button_reply' && m.interactive.button_reply.id === 'yes_analyze') {
        await send({ messaging_product: 'whatsapp', to, type: 'text', text: { body: 'Step 1/5: Analyzing your teaching…' } });
        await new Promise((r) => setTimeout(r, 250));
        await send({ messaging_product: 'whatsapp', to, type: 'document', document: { link: 'https://cdn.example/report.pdf', filename: 'report.pdf', caption: 'Step 5/5: your report' } });
      } else if (m.type === 'interactive' && m.interactive.type === 'button_reply') {
        await send({ messaging_product: 'whatsapp', to, type: 'text', text: { body: 'tapped ' + m.interactive.button_reply.id } });
      } else if (m.type === 'text' && m.text.body === 'react-first') {
        // The real bot reacts / marks read BEFORE it answers. Neither is a message row on WhatsApp Web.
        await send({ messaging_product: 'whatsapp', to, type: 'reaction', reaction: { message_id: m.id, emoji: '👍' } });
        await send({ messaging_product: 'whatsapp', status: 'read', message_id: m.id, typing_indicator: { type: 'text' } });
        await new Promise((r) => setTimeout(r, 400));
        await send({ messaging_product: 'whatsapp', to, type: 'text', text: { body: 'answer after the reaction' } });
      } else if (m.type === 'text' && m.text.body === 'two-part') {
        // A two-message answer (the bot often sends a text, then the card). The CDP reader settles and
        // takes the LAST fresh row; the mock driver must do the same, not stop at the first item.
        // Three parts 250ms apart with a 300ms settle: a FIXED settle stops at part two; a settle that
        // waits for the outbox to go quiet (like the CDP runner's stable-count wait) reaches part three.
        await send({ messaging_product: 'whatsapp', to, type: 'text', text: { body: 'part one' } });
        await new Promise((r) => setTimeout(r, 250));
        await send({ messaging_product: 'whatsapp', to, type: 'text', text: { body: 'part two' } });
        await new Promise((r) => setTimeout(r, 250));
        await send({ messaging_product: 'whatsapp', to, type: 'text', text: { body: 'part three' } });
      } else if (m.type === 'document') {
        // like the coaching handler: download the bytes through the Graph API, then answer with a card
        const meta = await (await fetch(`${mockBase}/v21.0/${m.document.id}`)).json();
        const bytes = await (await fetch(meta.url)).arrayBuffer();
        await send({ messaging_product: 'whatsapp', to, type: 'interactive', interactive: { type: 'button',
          body: { text: `Detected a ${Math.round(bytes.byteLength / 1024)} KB recording named ${m.document.filename}. Analyze?` },
          action: { buttons: [{ type: 'reply', reply: { id: 'yes_analyze', title: 'Yes, Analyze' } }, { type: 'reply', reply: { id: 'no', title: 'No' } }] } } });
      } else if (m.type === 'text' && m.text.body === 'silent') {
        /* never replies */
      } else if (m.type === 'text' && m.text.body === 'buttons') {
        await send({ messaging_product: 'whatsapp', to, type: 'interactive', interactive: { type: 'button',
          body: { text: 'Analyze this recording?' },
          action: { buttons: [{ type: 'reply', reply: { id: 'yes_1', title: 'Yes, analyze' } }, { type: 'reply', reply: { id: 'no_1', title: 'No' } }] } } });
      } else {
        await send({ messaging_product: 'whatsapp', to, type: 'text', text: { body: 'echo: ' + (m.text && m.text.body) } });
      }
    });
  });
  await new Promise((r) => bot.listen(0, '127.0.0.1', r));
  const botUrl = 'http://127.0.0.1:' + bot.address().port;
  const mock = createMockGraphApi({ phoneNumberId: PH, botUrl });
  mockBase = 'http://127.0.0.1:' + (await mock.listen(0));

  const { makeMockApi } = require(path.join(__dirname, 'mock-api.cjs'));
  const api = makeMockApi({ baseUrl: mockBase, driver: DRIVER, pollMs: 50, quiesceMs: 200, settleMs: 300,
    flows: { dir: FLOWS_DIR, botUrl, publicKeyPem: FLOW_KEYS.publicKey, endpoints: { SETTINGS_FLOW_ID: '/api/flows/settings' } } });

  await ita('caps: the mock driver EMULATES Flows (never claims to render them)', async () => {
    assert.strictEqual(api.caps.flows, 'emulated');
    assert.strictEqual(api.caps.render, false);
    assert.strictEqual(api.caps.method, 'mock');
  });
  await ita('inject() is a no-op that reports success (no wa-drive to load)', async () => {
    assert.strictEqual(await api.inject(), true);
  });
  await ita('sendWait returns the reply text and the list opener as a button, like the CDP reader', async () => {
    const r = await api.sendWait('/menu', 5000);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.txt.split('\n')[0], "Here's what I can do!");
    assert.ok(r.btns.includes('View Features'), 'btns=' + JSON.stringify(r.btns));
    assert.ok(typeof r.waitedMs === 'number');
    assert.ok(r.txt.includes('Powered by NIETE'), 'footer must be part of txt');
  });
  await ita('openList reads the rows of the LAST list reply without touching the bot', async () => {
    const n = inbound.length;
    const l = await api.openList('View Features');
    assert.strictEqual(l.ok, true);
    assert.deepStrictEqual(l.rows, ROWS);
    assert.ok(typeof l.all === 'string' && l.all.includes('Ask Anything'));
    assert.strictEqual(inbound.length, n, 'openList must not inject anything');
  });
  await ita('openList on a reply that has no list reports NO_DIALOG', async () => {
    await api.sendWait('hello', 5000);
    const l = await api.openList('View Features');
    assert.strictEqual(l.ok, false); assert.strictEqual(l.err, 'NO_DIALOG');
  });
  await ita('closeDialog is true', async () => { assert.strictEqual(await api.closeDialog(), true); });
  await ita('pickRowAndWait injects a list_reply carrying the ROW ID and returns the reply', async () => {
    await api.sendWait('/menu', 5000); await api.openList('View Features');
    const r = await api.pickRowAndWait('Ask Anything', 5000);
    assert.strictEqual(r.ok, true);
    assert.match(r.txt, /How can I help you today/);
    const last = inbound[inbound.length - 1];
    assert.deepStrictEqual(last.interactive.list_reply, { id: 'menu_3', title: 'Ask Anything' });
  });
  await ita('pickRowAndWait on an unknown row is a harness error, not a product FAIL', async () => {
    await api.sendWait('/menu', 5000);
    await assert.rejects(() => api.pickRowAndWait('Not A Row', 1000), /HARNESS/);
  });
  await ita('tapAndWait injects a button_reply by the button ID behind the title', async () => {
    await api.sendWait('buttons', 5000);
    const r = await api.tapAndWait('Yes, analyze', 5000);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.txt, 'tapped yes_1');
    assert.deepStrictEqual(inbound[inbound.length - 1].interactive.button_reply, { id: 'yes_1', title: 'Yes, analyze' });
  });
  await ita('a reaction + read receipt sent before the answer are not mistaken for the reply', async () => {
    const r = await api.sendWait('react-first', 5000);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.txt, 'answer after the reaction');
  });
  await ita('a two-message answer settles and returns the LAST message, like the CDP reader', async () => {
    const r = await api.sendWait('two-part', 5000);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.txt, 'part three');
    assert.strictEqual(r.freshIds, 3);
  });
  await ita('sendWait trims the text like the WhatsApp client does before it reaches the bot', async () => {
    // M05 sends " /menu " and the spec says "(client trims)": the real bot never sees the spaces. The
    // first live mock run delivered them raw and the bot answered with the option nudge.
    await api.sendWait(' /menu ', 5000);
    const last = inbound[inbound.length - 1];
    assert.strictEqual(last.text.body, '/menu');
  });
  await ita('no reply within the timeout is NO REPLY — ok:false, empty txt, never a stale row', async () => {
    const r = await api.sendWait('silent', 800);
    assert.strictEqual(r.ok, false); assert.strictEqual(r.txt, ''); assert.deepStrictEqual(r.btns, []);
    assert.strictEqual(r.mineOnly, true);
  });
  await ita('a late reply to the PREVIOUS send is not attributed to the next one', async () => {
    // "silent" never answers, so the quiesce has nothing to wait for; the next send must
    // still only count items that arrive AFTER its own injection.
    const r = await api.sendWait('second', 5000);
    assert.strictEqual(r.txt, 'echo: second');
  });
  await ita('ev() — a page-side read a CDP-only script still makes — resolves to a JSON failure, never throws', async () => {
    // lesson-plan.cjs reads the transcript via api.ev inside its Flow scenarios; on the mock those
    // scenarios are already BLOCKED (no Flow), and a throw here would abort the WHOLE feature run.
    const v = await api.ev('(()=>1)()');
    assert.strictEqual(typeof v, 'string');
    assert.deepStrictEqual(JSON.parse(v), { ok: false, err: 'MOCK_NO_PAGE' });
  });
  await ita('openFlow with no Flow card on the last reply fails like the browser helper', async () => {
    await api.sendWait('hello', 5000);
    const op = await api.openFlow('Open Settings');
    assert.strictEqual(op.ok, false); assert.match(op.err, /^NO_FRESH_CTA:/);
    assert.deepStrictEqual(await api.flowProbe(), { text: '', items: [] });
    assert.strictEqual((await api.flowClick('x')).ok, false);
    assert.deepStrictEqual(await api.flowState('x'), { found: false });
  });
  await ita('openFlow on a Flow card loads the stored JSON by flow_id, INITs through the encrypted endpoint, and probes the first screen', async () => {
    const card = await api.sendWait('/settings', 5000);
    assert.ok(card.btns.includes('Open Settings'), JSON.stringify(card.btns));
    const op = await api.openFlow('Open Settings|کھولیں');
    assert.strictEqual(op.ok, true, JSON.stringify(op));
    assert.strictEqual(op.screen, 'SETTINGS_MAIN');
    assert.strictEqual(op.via, 'flow-emulator');
    assert.strictEqual(flowExchanges[flowExchanges.length - 1].action, 'INIT');
    const p = await api.flowProbe();
    assert.ok(p.text.includes('Default: OECD.'), p.text);
    assert.ok(p.items.some((i) => i.text === 'اردو (Urdu)'));
  });
  await ita('flowPick + flowClick drive a data_exchange submit; the completion reaches the bot as an nfm_reply and the bot answers', async () => {
    assert.strictEqual((await api.flowPick('اردو (Urdu)')).ok, true);
    const r = await api.flowClick('Save Settings');
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    const sent = flowExchanges[flowExchanges.length - 1];
    assert.strictEqual(sent.action, 'data_exchange'); assert.strictEqual(sent.data.language, 'ur'); assert.strictEqual(sent.flow_token, 'user-1:settings:42');
    assert.strictEqual((await api.flowState('Done')).found, true);
    const fin = await api.flowClick('Done', { complete: true });
    assert.strictEqual(fin.ok, true);
    const reply = await api.flowComplete(5000);          // the bot's answer to the nfm_reply
    assert.strictEqual(reply.ok, true); assert.match(reply.txt, /Settings updated/);
    assert.strictEqual(flowInbound.length, 1);
    assert.strictEqual(flowInbound[0].interactive.nfm_reply.name, 'flow_flow-settings-1');
    assert.deepStrictEqual(JSON.parse(flowInbound[0].interactive.nfm_reply.response_json), { flow_token: 'user-1:settings:42', language: 'ur' });
    api.closeFlow();
    assert.strictEqual((await api.resetFlow()).ok, true);
  });
  await ita('flowStats counts what the emulator drove, for the ledger', async () => {
    const st = await api.flowStats();
    assert.strictEqual(st.opened, 1); assert.strictEqual(st.completed, 1); assert.deepStrictEqual(st.flows, ['SETTINGS_FLOW_ID']);
  });
  await ita('upload registers the file with the mock, injects a document, and returns the reply with its kind', async () => {
    const os = require('os'); const fs = require('fs');
    const p = path.join(os.tmpdir(), 'hameeda_demo.m4a'); fs.writeFileSync(p, Buffer.alloc(2048, 1));
    const r = await api.upload(p, 'Document', 5000);
    assert.strictEqual(r.ok, true);
    assert.match(r.txt, /Detected a 2 KB recording named hameeda_demo\.m4a/);
    assert.ok(r.btns.includes('Yes, Analyze'), JSON.stringify(r.btns));
    assert.strictEqual(inbound[inbound.length - 1].document.mime_type, 'audio/mp4');
  });
  await ita('fresh() returns only inbound items since the last call, with media flags', async () => {
    await api.freshReset();
    assert.deepStrictEqual(await api.fresh(), []);
    const os = require('os'); const fs = require('fs');
    const p = path.join(os.tmpdir(), 'clip.m4a'); fs.writeFileSync(p, Buffer.alloc(1024, 2));
    const up = await api.upload(p, 'Document', 5000);
    assert.strictEqual(up.kind, 'text', 'a button card reads as text, like the CDP side');
    let items = await api.fresh();
    assert.strictEqual(items.length, 1, JSON.stringify(items.map((i) => i.txt)));
    assert.deepStrictEqual(items[0].btns, ['Yes, Analyze', 'No']);
    await api.tapAndWait('Yes, Analyze', 5000);
    items = await api.fresh();
    assert.strictEqual(items.length, 2, JSON.stringify(items.map((i) => i.txt)));
    assert.match(items[0].txt, /Step 1\/5/);
    assert.strictEqual(items[1].doc, true); assert.strictEqual(items[1].pdf, true);
    assert.match(items[1].txt, /Step 5\/5/);
    assert.deepStrictEqual(await api.fresh(), []);
  });
  await ita('upload menu items map to the WhatsApp kinds: Photos & videos → image, Audio → audio', async () => {
    const os = require('os'); const fs = require('fs');
    const img = path.join(os.tmpdir(), 'page.png'); fs.writeFileSync(img, Buffer.alloc(64, 3));
    await api.upload(img, 'Photos & videos', 3000).catch(() => {});
    assert.strictEqual(inbound[inbound.length - 1].type, 'image');
    const voice = path.join(os.tmpdir(), 'ask.ogg'); fs.writeFileSync(voice, Buffer.alloc(64, 4));
    await api.upload(voice, 'Audio', 3000).catch(() => {});
    assert.strictEqual(inbound[inbound.length - 1].type, 'audio');
  });
  await ita('waitStats / waitLog report the adapter\'s own waits', async () => {
    const s = await api.waitStats();
    assert.ok(s.n >= 5, 'n=' + s.n);
    for (const k of ['totalMs', 'meanMs', 'medianMs', 'maxMs', 'timedOut']) assert.ok(k in s, k);
    const log = await api.waitLog();
    assert.ok(log.split('\n').filter(Boolean).length >= 5);
  });

  await mock.close(); await new Promise((r) => bot.close(r));
  console.log(`\n${passed} passed${process.exitCode ? ', with failures' : ''}`);
  setTimeout(() => process.exit(process.exitCode || 0), 50).unref();
})().catch((e) => { console.error(e); process.exit(1); });
