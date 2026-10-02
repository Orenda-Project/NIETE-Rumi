'use strict';
/**
 * bd-0wrn4 — the inbound "typing…" scope, driven through the REAL WhatsApp service: every send goes
 * through the service's own transports, and only the Graph API (global fetch + the axios stub) and
 * Redis are faked. The webhook-level behaviour is pinned in inbound-typing.test.js; these pin the
 * rules a handler author relies on:
 *   - only a reply to THIS person answers the inbound — a coach's report going to the teacher
 *     does not cancel the coach's "typing…";
 *   - a handler's own continuous typing (text / voice / image handlers start one at once) waits for
 *     the same deadline, so a handler that ends in a reaction never flashes "typing…";
 *   - hold()/release(): a handler that cannot yet tell whether it will answer silently keeps
 *     "typing…" back until it knows;
 *   - explicit showTypingIndicator() is never deferred (the "📝 reaction + typing" pattern).
 */
const { createMemoryRedis } = require('../fixtures/memory-supabase');

const DEFER_MS = 120;
const COACH = '923330000001';
const TEACHER_PHONE = '923330000002';
const later = (ms) => new Promise((r) => setTimeout(r, ms));

let graph;
let realFetch;
let InboundTyping;
let WhatsApp;

const typings = () => graph.filter((b) => b && b.typing_indicator);
const reads = () => graph.filter((b) => b && b.status === 'read' && !b.typing_indicator);

beforeEach(() => {
  jest.resetModules();
  process.env.INBOUND_TYPING_DEFER_MS = String(DEFER_MS);
  graph = [];
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => createMemoryRedis());
  jest.doMock('../../bot/shared/utils/logger', () => ({
    logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn(),
  }));
  realFetch = global.fetch;
  global.fetch = jest.fn(async (url, init) => {
    if (String(url).includes('graph.facebook.com')) {
      graph.push(JSON.parse((init && init.body) || 'null'));
      return { ok: true, status: 200, json: async () => ({ success: true, messages: [{ id: 'wamid.OUT' }] }) };
    }
    return realFetch(url, init);
  });
  InboundTyping = require('../../bot/shared/services/inbound-typing');
  WhatsApp = require('../../bot/shared/services/whatsapp.service');
});

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.INBOUND_TYPING_DEFER_MS;
});

/** Run `fn` as the webhook does: one request, one inbound message from `from`. */
function inbound(from, messageId, fn) {
  return InboundTyping.withRequest(async () => {
    InboundTyping.open(from, messageId, WhatsApp);
    try {
      await fn();
    } finally {
      InboundTyping.endDispatch();
    }
  });
}

test('a message to SOMEONE ELSE does not answer the inbound: the coach still sees typing', async () => {
  await inbound(COACH, 'wamid.C1', async () => {
    await WhatsApp.sendMessage(TEACHER_PHONE, 'Your lesson report is here');
    await later(DEFER_MS + 60);
  });

  expect(typings()).toHaveLength(1);
  expect(typings()[0].message_id).toBe('wamid.C1');
});

test('a reply to the same person — written with a + prefix — answers it: no typing', async () => {
  await inbound(COACH, 'wamid.C2', async () => {
    await WhatsApp.sendMessage(`+${COACH}`, 'Done');
    await later(DEFER_MS + 60);
  });

  expect(typings()).toEqual([]);
  expect(reads()).toHaveLength(1);
});

test('a reaction is a reply: once the handler has reacted, typing never appears', async () => {
  await inbound(COACH, 'wamid.C3', async () => {
    await WhatsApp.sendReaction(COACH, 'wamid.C3', '📨');
    await later(DEFER_MS + 60);           // the handler keeps working (e.g. sends the report)
  });

  expect(typings()).toEqual([]);
});

test('a handler\'s continuous typing waits for the deadline — and never fires when the handler only reacts', async () => {
  await inbound(COACH, 'wamid.C4', async () => {
    const typing = WhatsApp.startContinuousTypingIndicator(COACH, 'wamid.C4');
    await later(10);
    expect(typings()).toEqual([]);          // not at once any more
    await WhatsApp.sendReaction(COACH, 'wamid.C4', '📸');
    await later(DEFER_MS + 60);
    typing.stop();
  });

  expect(typings()).toEqual([]);
});

test('a slow handler with continuous typing shows it once, at the deadline', async () => {
  await inbound(COACH, 'wamid.C5', async () => {
    const typing = WhatsApp.startContinuousTypingIndicator(COACH, 'wamid.C5');
    await later(DEFER_MS + 60);
    typing.stop();
    await WhatsApp.sendMessage(COACH, 'Here is your answer');
  });

  expect(typings()).toHaveLength(1);
});

test('hold(): past the deadline nothing shows while held; release shows it at once', async () => {
  await inbound(COACH, 'wamid.C6', async () => {
    const release = InboundTyping.hold();
    await later(DEFER_MS + 60);
    expect(typings()).toEqual([]);
    release();
    await later(10);
    expect(typings()).toHaveLength(1);
    await WhatsApp.sendMessage(COACH, 'Answer');
  });
});

test('hold(): a silent receipt while held ends the request with no typing at all', async () => {
  await inbound(COACH, 'wamid.C7', async () => {
    InboundTyping.hold();
    await later(DEFER_MS + 60);
  });
  await later(DEFER_MS);

  expect(typings()).toEqual([]);
  expect(reads()).toHaveLength(1);
});

test('explicit showTypingIndicator is never deferred (the "📝 reaction + typing" pattern)', async () => {
  await inbound(COACH, 'wamid.C8', async () => {
    await WhatsApp.sendReaction(COACH, 'wamid.C8', '📝');
    await WhatsApp.showTypingIndicator(COACH, 'wamid.C8');
    expect(typings()).toHaveLength(1);
  });
});

test('outside a webhook request nothing changes: continuous typing starts at once', async () => {
  const typing = WhatsApp.startContinuousTypingIndicator(COACH, 'wamid.WORKER');
  await later(10);
  typing.stop();

  expect(typings()).toHaveLength(1);
});
