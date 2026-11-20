'use strict';
/**
 * bd-ra8xu.60 — the Observation Notes Flow's reply reaches the notes handler, and only it.
 *
 * The reply is an nfm_reply whose flow token is obsnotes:<session id> (observation-notes.js offerNotes). It is routed
 * on the token, FIRST and unconditionally, as vqm: is: the generic detectFlowType's attendance rule matches any token
 * with a colon, the misroute that has already eaten other Flows. And the notes Flow JSON declares exactly the screen
 * data offerNotes sends (Meta refuses a navigate payload with undeclared or missing keys).
 * Harness: tests/quiz/webhook-ack.test.js (the real Express app, everything before the router mocked).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PHONE = '923001234567';

function nfmBody(flowToken, payload) {
  const responseJson = JSON.stringify({ flow_token: flowToken, ...payload });
  return {
    entry: [{
      id: 'waba',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'pnid' },
          messages: [{
            id: `wamid.${Math.random().toString(36).slice(2)}`,
            from: PHONE,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'interactive',
            interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', body: 'Sent', response_json: responseJson } },
          }],
        },
      }],
    }],
  };
}

/** Wait until `predicate()` is true, or fail after `timeoutMs`. */
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
 * POST and WAIT FOR THE RESPONSE, with a deadline. The sibling router test
 * fires and forgets, which is exactly why it stayed green through this bug.
 *
 * `keepAlive` leaves the server up: once the ack comes back FIRST (which is
 * the whole point of the fix), the handler is still running, and closing the
 * socket underneath it would race the assertion that it ran at all.
 */
async function postAndAwaitAck(app, body, timeoutMs = 5000) {
  const server = http.createServer(app);
  let closed = false;
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    return { status: res.status, text: await res.text() };
  } catch (err) {
    if (err.name === 'AbortError') return { status: null, text: `NO RESPONSE within ${timeoutMs}ms` };
    throw err;
  } finally {
    clearTimeout(timer);
    if (!closed) { closed = true; setTimeout(() => server.close(), 1000).unref?.(); }
  }
}

function mockEverythingBefore() {
  jest.doMock('../../bot/shared/utils/validators', () => ({
    validateWebhookStatus: () => null,
    validateWebhookMessage: (req) => {
      const value = req.body.entry[0].changes[0].value;
      const message = value.messages[0];
      return {
        entry: req.body.entry[0], message, from: message.from, messageBody: '',
        messageType: message.type, messageTimestamp: message.timestamp,
        phoneNumberId: value.metadata.phone_number_id,
      };
    },
    isOurPhoneNumber: () => true,
    isTestWebhook: () => false,
    isTestPhoneNumber: () => false,
    isWithin24Hours: () => true,
  }));
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


describe('webhook → the notes Flow reply', () => {
  beforeEach(() => jest.resetModules());

  test('an obsnotes: reply goes to the notes handler with the sender, the token, the answers and the message id', async () => {
    mockEverythingBefore();
    jest.doMock('../../bot/shared/services/observe/observation-notes', () => ({
      handleFlowReply: jest.fn().mockResolvedValue(true),
    }));
    const flowHandler = { handleObserveVisitFlow: jest.fn(), handleReadingAssessmentFlow: jest.fn() };
    jest.doMock('../../bot/shared/handlers/flow-response.handler', () => flowHandler);
    const { app } = require('../../bot/whatsapp-bot');
    const Notes = require('../../bot/shared/services/observe/observation-notes');

    const res = await postAndAwaitAck(app, nfmBody('obsnotes:sess-1', { notes: 'Board work\nBack rows silent' }));
    expect(res.status).toBe(200);
    await waitFor(() => Notes.handleFlowReply.mock.calls.length > 0, 'handleFlowReply');
    const [user, from, token, responseJson, opts] = Notes.handleFlowReply.mock.calls[0];
    expect(user).toMatchObject({ id: 'u-1' });
    expect(from).toBe(PHONE);
    expect(token).toBe('obsnotes:sess-1');
    expect(responseJson).toMatchObject({ notes: 'Board work\nBack rows silent' });
    expect(opts).toEqual({ messageId: expect.stringMatching(/^wamid\./) });
    expect(flowHandler.handleObserveVisitFlow).not.toHaveBeenCalled();
  });
});

describe('the notes Flow JSON (bot/docs/flows/observe-notes.json)', () => {
  const flow = JSON.parse(fs.readFileSync(path.join(__dirname, '../../bot/docs/flows/observe-notes.json'), 'utf8'));
  const nodes = (n, acc = []) => {
    if (Array.isArray(n)) { n.forEach((x) => nodes(x, acc)); return acc; }
    if (n && typeof n === 'object') { acc.push(n); Object.values(n).forEach((v) => nodes(v, acc)); }
    return acc;
  };

  test('one static, terminal screen NOTES: no endpoint, every word is screen data', () => {
    expect(flow.data_api_version).toBeUndefined();
    expect(flow.routing_model).toBeUndefined();
    expect(flow.screens.map((s) => s.id)).toEqual(['NOTES']);
    expect(flow.screens[0].terminal).toBe(true);
  });

  test('it declares exactly the data offerNotes sends', async () => {
    jest.resetModules();
    jest.unmock('../../bot/shared/services/observe/observation-notes'); // the webhook test above mocked it
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    const sent = [];
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({ sendFlow: jest.fn((to, f) => { sent.push(f); return Promise.resolve(true); }) }));
    jest.doMock('../../bot/shared/services/observe/observation-notes-switch', () => ({ isOn: jest.fn(async () => true) }));
    process.env.OBSERVE_NOTES_FLOW_ID = 'F-NOTES';
    try {
      const Notes = require('../../bot/shared/services/observe/observation-notes');
      await Notes.offerNotes({ observerId: 'c', to: '1', session: { id: 's', framework: 'fico17_v6' }, lang: 'en', teacherName: 'Maryam' });
    } finally {
      delete process.env.OBSERVE_NOTES_FLOW_ID;
    }
    expect(sent).toHaveLength(1);
    expect(sent[0].screen).toBe('NOTES');
    expect(Object.keys(flow.screens[0].data).sort()).toEqual(Object.keys(sent[0].screenData).sort());
    // Every binding on the screen names declared data.
    const bound = nodes(flow.screens[0].layout).flatMap((n) => Object.values(n)).filter((v) => typeof v === 'string')
      .flatMap((v) => [...v.matchAll(/\$\{data\.(\w+)\}/g)].map((m) => m[1]));
    for (const k of bound) expect(Object.keys(flow.screens[0].data)).toContain(k);
  });

  test('one box of 600, required, and Save completes with exactly what handleFlowReply reads', () => {
    const all = nodes(flow.screens[0].layout);
    const box = all.find((n) => n.type === 'TextArea');
    expect(box).toMatchObject({ name: 'notes', required: true, 'max-length': 600 });
    const footer = all.find((n) => n.type === 'Footer');
    expect(footer['on-click-action']).toEqual({ name: 'complete', payload: { notes: '${form.notes}' } });
  });
});
