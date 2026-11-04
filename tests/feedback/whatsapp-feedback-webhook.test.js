'use strict';
/**
 * /feedback and /bug through the REAL /webhook route, the REAL WhatsApp service and the real handlers: what a
 * teacher who types /feedback, taps a topic and writes one line actually gets, and what is kept. Only the network is
 * faked — the Graph API (global fetch + the axios stub), Supabase (a stateful in-memory table set with the
 * table's unique message id) and Redis (in memory). Harness as in tests/whatsapp/inbound-typing.test.js.
 */
const http = require('http');
const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');

const PHONE = '923001112233';
const TEACHER = '11111111-1111-4111-8111-111111111111';
const later = (ms) => new Promise((r) => setTimeout(r, ms));

let mockDb;
let mockRedis;
let graph;
let realFetch;
let seq = 0;

function seedDb({ registered = true } = {}) {
  mockDb = createMemorySupabase({
    users: [{
      id: TEACHER, phone_number: PHONE, name: registered ? 'Ayesha Khan' : null, first_name: registered ? 'Ayesha' : null,
      preferred_language: 'en', registration_completed: registered, role: registered ? 'teacher' : null,
    }],
    whatsapp_feedback: [],
  }, { unique: { whatsapp_feedback: ['wa_message_id'] } });
}

function mockBoundaries() {
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: (table) => mockDb.from(table),
    rpc: (...a) => mockDb.rpc(...a),
  }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
  jest.doMock('../../bot/shared/utils/logger', () => ({
    logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn(),
  }));
}

const record = (body) => graph.push(body);
const isMessage = (b) => Boolean(b && b.to && b.type && b.type !== 'reaction');
const messages = () => graph.filter(isMessage);
const texts = () => messages().filter((b) => b.type === 'text').map((b) => b.text.body);
const buttonMessages = () => messages().filter((b) => b.type === 'interactive' && b.interactive.type === 'button');

function webhookBody(message) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: 'pnid', display_phone_number: '920000000000' },
          contacts: [{ wa_id: PHONE, profile: { name: 'Ayesha' } }],
          messages: [{ from: PHONE, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
        },
      }],
    }],
  };
}

const tap = (id) => ({ id: `wamid.IN_${++seq}`, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'tap' } } });
const text = (body, id = `wamid.IN_${++seq}`) => ({ id, type: 'text', text: { body } });

async function post(message) {
  const { app } = require('../../bot/whatsapp-bot');
  const drain = require('../../bot/shared/utils/web-drain');
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await realFetch(`http://127.0.0.1:${server.address().port}/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(webhookBody(message)),
    });
    expect(res.status).toBe(200);
    await later(20);
    const deadline = Date.now() + 8000;
    while (drain.inFlightCount() !== 0 && Date.now() < deadline) await later(10);
    await later(50);
  } finally {
    server.close();
  }
  return message.id;
}

beforeEach(() => {
  jest.resetModules();
  process.env.INBOUND_TYPING_DEFER_MS = '0';
  graph = [];
  mockRedis = createMemoryRedis();
  seedDb();
  mockBoundaries();
  realFetch = global.fetch;
  global.fetch = jest.fn(async (url, init) => {
    if (String(url).includes('graph.facebook.com')) {
      let body = null;
      try { body = JSON.parse((init && init.body) || 'null'); } catch (_) { body = null; }
      record(body);
      return { ok: true, status: 200, json: async () => ({ success: true, messages: [{ id: `wamid.OUT_${graph.length}` }] }), text: async () => '' };
    }
    return realFetch(url, init);
  });
  const axios = require('axios');
  axios.post.mockImplementation(async (url, body) => {
    if (/\/messages(\?|$)/.test(String(url))) record(body);
    return { status: 200, data: { messages: [{ id: `wamid.OUT_${graph.length}` }], id: 'media-1' } };
  });
});

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.INBOUND_TYPING_DEFER_MS;
});

describe('/feedback on the webhook', () => {
  test('/feedback → three topic buttons; a tap → the ask; one typed line → one row and the reference', async () => {
    await post(text('/feedback'));
    const buttons = buttonMessages();
    expect(buttons).toHaveLength(1);
    expect(buttons[0].interactive.action.buttons.map((b) => b.reply.id)).toEqual(['nfb_topic_broken', 'nfb_topic_idea', 'nfb_topic_other']);

    await post(tap('nfb_topic_idea'));
    expect(texts().join('\n')).toMatch(/voice note/i);

    const id = await post(text('Please add Urdu PDFs'));
    const rows = mockDb.rows('whatsapp_feedback');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: TEACHER, role: 'teacher', command: 'feedback', topic: 'idea', message: 'Please add Urdu PDFs', wa_message_id: id });
    expect(texts().join('\n')).toContain(rows[0].ref);
  }, 30000);

  test('a typo of the command ("feedback/") still opens it', async () => {
    await post(text('feedback/'));
    expect(buttonMessages()).toHaveLength(1);
  }, 30000);

  test('/bug → the ask; the same message delivered twice → one row', async () => {
    await post(text('/bug'));
    expect(buttonMessages()).toHaveLength(0);
    const same = text('The quiz link does not open');
    await post(same);
    await post(same);
    const rows = mockDb.rows('whatsapp_feedback');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ command: 'bug', topic: 'broken', message: 'The quiz link does not open' });
  }, 30000);

  test('/bug then /menu: nothing is kept and the wait is over', async () => {
    await post(text('/bug'));
    await post(text('/menu'));
    await post(text('hello there'));
    expect(mockDb.rows('whatsapp_feedback')).toEqual([]);
  }, 30000);

  test('someone not registered is told to register first', async () => {
    seedDb({ registered: false });
    await post(text('/bug'));
    expect(texts().join('\n')).toMatch(/register/i);
    expect(mockDb.rows('whatsapp_feedback')).toEqual([]);
  }, 30000);
});
