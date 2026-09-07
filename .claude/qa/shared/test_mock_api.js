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
      res.writeHead(200); res.end('EVENT_RECEIVED');
      const m = JSON.parse(b).entry[0].changes[0].value.messages[0];
      inbound.push(m);
      const to = m.from;
      if (m.type === 'text' && m.text.body.trim().toLowerCase() === '/menu') {
        await send({ messaging_product: 'whatsapp', to, type: 'interactive', interactive: { type: 'list',
          header: { type: 'text', text: "Here's what I can do!" }, body: { text: 'Choose a feature' },
          footer: { text: 'Powered by NIETE' },
          action: { button: 'View Features', sections: [{ title: 'Features', rows: ROWS.map((r, i) => ({ id: 'menu_' + i, title: r })) }] } } });
      } else if (m.type === 'interactive' && m.interactive.type === 'list_reply' && m.interactive.list_reply.id === 'menu_3') {
        await send({ messaging_product: 'whatsapp', to, type: 'text', text: { body: 'How can I help you today?' } });
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
  const api = makeMockApi({ baseUrl: mockBase, driver: DRIVER, pollMs: 50, quiesceMs: 200, settleMs: 300 });

  await ita('caps: the mock driver says it cannot render Flows', async () => {
    assert.strictEqual(api.caps.flows, false);
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
  await ita('Flow primitives refuse honestly instead of pretending to render', async () => {
    assert.deepStrictEqual(await api.openFlow('Open status'), { ok: false, err: 'MOCK_NO_FLOW_RENDER' });
    assert.deepStrictEqual(await api.flowProbe(), { text: '', items: [] });
    assert.strictEqual((await api.resetFlow()).ok, true);
    assert.strictEqual((await api.flowClick('x')).ok, false);
    assert.strictEqual((await api.flowPick('x')).ok, false);
    assert.strictEqual((await api.flowType('x')).ok, false);
    assert.strictEqual((await api.flowAria('x')).ok, false);
    assert.deepStrictEqual(await api.flowState('x'), { found: false });
    api.closeFlow();
  });
  await ita('upload is out of Phase 1 scope and says so as a harness error', async () => {
    await assert.rejects(() => api.upload('/tmp/x.m4a', 'Document'), /HARNESS.*mock.*upload/i);
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
