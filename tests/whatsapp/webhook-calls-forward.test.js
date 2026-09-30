'use strict';
/**
 * A WhatsApp call webhook must reach the calls service (bd-1hae7.20).
 *
 * Staging, 2026-09-30: calls to the staging number rang and never connected.
 * Meta was healthy — number CONNECTED, calling ENABLED, webhook subscribed — and
 * was delivering the call events. The staging bot had been switched to build
 * from the `staging` branch on 2026-09-09, and that branch had no call forwarder
 * at all: the webhook received `value.calls`, had no code that recognised it,
 * and nothing was ever handed to the calls service. Nobody sent pre_accept or
 * accept, so the phone rang until it gave up. The bot's last
 * "Call events received" line was 2026-09-08 10:11Z; the calls service logged
 * nothing after its 2026-09-09 boot.
 *
 * Every existing calls test exercises the forwarder MODULE in isolation, which
 * is why none of them could notice the webhook no longer calling it. These drive
 * the REAL Express route with a real calls payload and assert on the one thing
 * that has to happen: an authenticated POST to the calls service.
 */
const http = require('http');

const PHONE = '923001234567';
const CALLS_URL = 'http://calls.test.internal:8080';
const SECRET = 'test-forward-secret';

function callsBody(event = 'connect') {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba',
      changes: [{
        field: 'calls',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: 'pnid', display_phone_number: '923222482222' },
          contacts: [{ wa_id: PHONE, profile: { name: 'Test Caller' } }],
          calls: [{
            id: 'wacid.TEST_CALL_1',
            from: PHONE,
            to: '923222482222',
            event,
            timestamp: String(Math.floor(Date.now() / 1000)),
            session: { sdp_type: 'offer', sdp: 'v=0\r\n' },
          }],
        },
      }],
    }],
  };
}

async function waitFor(predicate, what, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * Stand the real app up on an ephemeral port and POST to /webhook. The harness
 * itself needs the real fetch, so the forward to the calls service is
 * intercepted by URL rather than by replacing fetch wholesale.
 */
async function postWebhook(app, body, realFetch) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try {
    const res = await realFetch(`http://127.0.0.1:${port}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return { status: res.status, text: await res.text() };
  } finally {
    setTimeout(() => server.close(), 1000).unref?.();
  }
}

function mockCollaborators() {
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
    get: jest.fn(), set: jest.fn(), delete: jest.fn(), setNX: jest.fn(),
  }));
  jest.doMock('../../bot/shared/services/session.service', () => ({
    isProcessed: jest.fn().mockResolvedValue(false),
    markAsProcessed: jest.fn().mockResolvedValue(undefined),
    getReactionEmoji: jest.fn().mockReturnValue('👍'),
  }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendReaction: jest.fn().mockResolvedValue(true),
    showTypingIndicator: jest.fn().mockResolvedValue(true),
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/database/bot-helpers', () => ({
    getOrCreateUser: jest.fn().mockResolvedValue({ id: 'u-1', phone_number: PHONE, preferred_language: 'en' }),
    trackChatStart: jest.fn().mockResolvedValue(undefined),
  }));
  jest.doMock('../../bot/shared/services/conversation-resume.service', () => ({
    handleResumeButton: jest.fn().mockResolvedValue(false),
    sweep: jest.fn(),
  }));
  jest.doMock('../../bot/shared/config/supabase', () => {
    const { fromMock } = require('../quiz/helpers/supabase-chain');
    return { from: fromMock({}), rpc: jest.fn().mockResolvedValue({ error: null }) };
  });
}

describe('webhook → a WhatsApp call reaches the calls service', () => {
  let realFetch;
  let forwards;

  beforeEach(() => {
    jest.resetModules();
    realFetch = global.fetch;
    forwards = [];
    global.fetch = jest.fn((url, init) => {
      if (String(url).startsWith(CALLS_URL)) {
        forwards.push({ url: String(url), init });
        return Promise.resolve({ ok: true, status: 200 });
      }
      return realFetch(url, init);
    });
    process.env.CALLS_SERVICE_URL = CALLS_URL;
    process.env.CALLS_FORWARD_SECRET = SECRET;
    mockCollaborators();
  });

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.CALLS_SERVICE_URL;
    delete process.env.CALLS_FORWARD_SECRET;
  });

  test('a ringing call is forwarded to the calls service, authenticated', async () => {
    const { app } = require('../../bot/whatsapp-bot');

    const res = await postWebhook(app, callsBody('connect'), realFetch);

    expect(res.status).toBe(200);
    await waitFor(() => forwards.length > 0, 'the forward to the calls service');
    expect(forwards[0].url).toBe(`${CALLS_URL}/internal/call-event`);
    expect(forwards[0].init.method).toBe('POST');
    expect(forwards[0].init.headers['x-calls-secret']).toBe(SECRET);
    expect(JSON.parse(forwards[0].init.body).calls[0].id).toBe('wacid.TEST_CALL_1');
  });

  test('a call event never falls into message handling', async () => {
    // Before the forwarder existed, a calls payload that reached message
    // handling produced "I can only reply to text and voice messages".
    const { app } = require('../../bot/whatsapp-bot');
    const WhatsApp = require('../../bot/shared/services/whatsapp.service');

    const res = await postWebhook(app, callsBody('terminate'), realFetch);

    expect(res.status).toBe(200);
    await waitFor(() => forwards.length > 0, 'the forward to the calls service');
    expect(WhatsApp.sendMessage).not.toHaveBeenCalled();
    expect(WhatsApp.sendReaction).not.toHaveBeenCalled();
  });
});
