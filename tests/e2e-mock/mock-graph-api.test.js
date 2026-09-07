/**
 * mock-graph-api — the smallest stand-in for Meta's Graph API the local E2E lane needs.
 *
 * Phase 1 scope (menu / language / status): text and interactive sends only. It records
 * every outbound payload as a normalized "outbox" item shaped like the WhatsApp Web reply the
 * CDP runner reads (txt = header+body+footer lines, btns = button titles or the list opener),
 * validates the Meta field caps in CODE POINTS and rejects like Meta would, and forges
 * inbound webhooks to the bot on request. It does not render Flows and never pretends to.
 *
 * Red-first: fails on develop — the module does not exist.
 */
const http = require('http');
const { createMockGraphApi } = require('../../bot/scripts/e2e/mock-graph-api');

const PH = 'ph-1';
let api, base;

const post = (path, body) => fetch(base + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
  body: JSON.stringify(body),
});
const get = async (path) => (await fetch(base + path)).json();
const text = (body, to = '923000000001') => ({ messaging_product: 'whatsapp', to, type: 'text', text: { body } });
const buttons = (body, titles, extra = {}) => ({
  messaging_product: 'whatsapp', to: '923000000001', type: 'interactive',
  interactive: { type: 'button', body: { text: body }, ...extra,
    action: { buttons: titles.map((t, i) => ({ type: 'reply', reply: { id: 'b' + i, title: t } })) } },
});
const list = (header, body, footer, button, rows) => ({
  messaging_product: 'whatsapp', to: '923000000001', type: 'interactive',
  interactive: { type: 'list', header: { type: 'text', text: header }, body: { text: body }, footer: { text: footer },
    action: { button, sections: [{ title: 'Features', rows: rows.map((r, i) => ({ id: 'row' + i, title: r })) }] } },
});

beforeAll(async () => {
  api = createMockGraphApi({ phoneNumberId: PH });
  const port = await api.listen(0);
  base = 'http://127.0.0.1:' + port;
});
afterAll(async () => { await api.close(); });
beforeEach(async () => { await post('/reset', {}); });

describe('mock-graph-api: sends', () => {
  test('a text send answers like Meta and lands in the outbox normalized', async () => {
    const r = await post(`/v21.0/${PH}/messages`, text('hello teacher'));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.messages[0].id).toMatch(/^wamid\.mock\./);
    const out = await get('/outbox');
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ seq: 1, to: '923000000001', type: 'text', txt: 'hello teacher', btns: [] });
  });

  test('an interactive list is read the way WhatsApp Web shows it: header+body+footer text, the opener as the button, the rows', async () => {
    await post(`/v21.0/${PH}/messages`, list("Here's what I can do!", 'Pick one', 'Managed by NIETE', 'View Features',
      ['Teacher Training', 'Lesson Plans', 'Classroom Coaching', 'Ask Anything']));
    const { items } = await get('/outbox');
    expect(items[0].type).toBe('interactive.list');
    expect(items[0].txt.split('\n')[0]).toBe("Here's what I can do!");
    expect(items[0].txt).toContain('Managed by NIETE');
    expect(items[0].btns).toEqual(['View Features']);
    expect(items[0].list.rows.map((r) => r.title)).toEqual(['Teacher Training', 'Lesson Plans', 'Classroom Coaching', 'Ask Anything']);
    expect(items[0].list.rows[3].id).toBe('row3');
  });

  test('reply buttons become btns in order', async () => {
    await post(`/v21.0/${PH}/messages`, buttons('Analyze this?', ['Yes, analyze', 'No']));
    const { items } = await get('/outbox');
    expect(items[0].type).toBe('interactive.button');
    expect(items[0].btns).toEqual(['Yes, analyze', 'No']);
    expect(items[0].raw.interactive.type).toBe('button');
  });

  test('the outbox pages by seq and filters by recipient', async () => {
    await post(`/v21.0/${PH}/messages`, text('one', '923000000001'));
    await post(`/v21.0/${PH}/messages`, text('two', '923000000002'));
    await post(`/v21.0/${PH}/messages`, text('three', '923000000001'));
    const all = await get('/outbox');
    expect(all.items.map((i) => i.txt)).toEqual(['one', 'two', 'three']);
    expect(all.last).toBe(3);
    const after = await get('/outbox?after=1&to=923000000001');
    expect(after.items.map((i) => i.txt)).toEqual(['three']);
  });

  test('reactions and read/typing signals are acknowledged but never become outbox replies', async () => {
    // WhatsApp Web shows neither as a message row; the CDP reader never sees them. The first live
    // mock run picked a reaction up as "the reply" and M01 read an empty header (2026-09-07).
    let r = await post(`/v21.0/${PH}/messages`, { messaging_product: 'whatsapp', to: '923000000001', type: 'reaction', reaction: { message_id: 'sim_1', emoji: '👍' } });
    expect(r.status).toBe(200);
    r = await post(`/v21.0/${PH}/messages`, { messaging_product: 'whatsapp', status: 'read', message_id: 'sim_1', typing_indicator: { type: 'text' } });
    expect(r.status).toBe(200);
    await post(`/v21.0/${PH}/messages`, text('the actual reply'));
    const { items } = await get('/outbox');
    expect(items.map((i) => i.txt)).toEqual(['the actual reply']);
    expect(items[0].seq).toBe(1);
    const h = await get('/health');
    expect(h.signals).toBe(2);
  });

  test('a send to a phone_number_id that is not the bot\'s is refused', async () => {
    const r = await post('/v21.0/other/messages', text('x'));
    expect(r.status).toBe(400);
  });
});

describe('mock-graph-api: Meta field caps, in code points', () => {
  test('a 61-code-point footer is rejected with the field named, like Meta would', async () => {
    const r = await post(`/v21.0/${PH}/messages`, list('h', 'b', 'x'.repeat(61), 'Open', ['a']));
    expect(r.status).toBe(422);
    const j = await r.json();
    expect(j.error.code).toBe('E2E_CAP');
    expect(j.error.field).toBe('footer');
    expect(j.error.limit).toBe(60);
    expect(j.error.actual).toBe(61);
    expect((await get('/outbox')).items).toHaveLength(0);
  });

  test('a 60-code-point Urdu footer passes even though it is far more than 60 bytes', async () => {
    const footer = 'ک'.repeat(60);
    expect(Buffer.byteLength(footer)).toBeGreaterThan(60);
    const r = await post(`/v21.0/${PH}/messages`, list('h', 'b', footer, 'Open', ['a']));
    expect(r.status).toBe(200);
  });

  test('a 21-code-point button title is rejected', async () => {
    const r = await post(`/v21.0/${PH}/messages`, buttons('b', ['y'.repeat(21)]));
    expect(r.status).toBe(422);
    expect((await r.json()).error.field).toBe('button');
  });

  test('a 25-code-point list row title and an 11th row are rejected', async () => {
    let r = await post(`/v21.0/${PH}/messages`, list('h', 'b', 'f', 'Open', ['r'.repeat(25)]));
    expect(r.status).toBe(422);
    expect((await r.json()).error.field).toBe('row.title');
    r = await post(`/v21.0/${PH}/messages`, list('h', 'b', 'f', 'Open', Array.from({ length: 11 }, (_, i) => 'row ' + i)));
    expect(r.status).toBe(422);
    expect((await r.json()).error.field).toBe('rows');
  });
});

describe('mock-graph-api: inbound injection', () => {
  let bot, received, botUrl;
  beforeAll(async () => {
    received = [];
    bot = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => { received.push({ url: req.url, body: JSON.parse(b) }); res.writeHead(200); res.end('EVENT_RECEIVED'); });
    });
    await new Promise((r) => bot.listen(0, '127.0.0.1', r));
    botUrl = 'http://127.0.0.1:' + bot.address().port;
  });
  afterAll(() => new Promise((r) => bot.close(r)));

  test('POST /inject forwards a text webhook to the bot with the bot\'s phone_number_id', async () => {
    const api2 = createMockGraphApi({ phoneNumberId: PH, botUrl });
    const port = await api2.listen(0);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/inject`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'text', from: '923000000001', text: '/menu' }) });
      expect(r.status).toBe(200);
      const j = await r.json();
      expect(j).toMatchObject({ ok: true, status: 200 });
      expect(j.messageId).toMatch(/^sim_/);
      expect(received).toHaveLength(1);
      expect(received[0].url).toBe('/webhook');
      const msg = received[0].body.entry[0].changes[0].value;
      expect(msg.metadata.phone_number_id).toBe(PH);
      expect(msg.messages[0].text.body).toBe('/menu');
      expect(msg.messages[0].from).toBe('923000000001');
    } finally { await api2.close(); }
  });

  test('POST /inject kind=list forwards a list_reply', async () => {
    received.length = 0;
    const api2 = createMockGraphApi({ phoneNumberId: PH, botUrl });
    const port = await api2.listen(0);
    try {
      await fetch(`http://127.0.0.1:${port}/inject`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'list', from: '923000000001', id: 'row3', title: 'Ask Anything' }) });
      const m = received[0].body.entry[0].changes[0].value.messages[0];
      expect(m.interactive.list_reply).toEqual({ id: 'row3', title: 'Ask Anything' });
    } finally { await api2.close(); }
  });

  test('GET /health reports the outbox position and the bot it forwards to', async () => {
    const h = await get('/health');
    expect(h.ok).toBe(true);
    expect(h.seq).toBe(0);
  });
});
