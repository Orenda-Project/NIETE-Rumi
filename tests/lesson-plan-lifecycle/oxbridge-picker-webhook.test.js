'use strict';
/**
 * The Oxbridge picker tap — "Oxbridge LP" under a typed grade 6-12 ask — says whose ask it was, so the
 * delivery leaves a lifecycle row with her id (source niete_oxbridge).
 *
 * deliverOxbridgeLp is called from two places: the Flow (pakistan-lp-endpoint) and this button, in the
 * webhook. A lifecycle row needs the teacher's id; the button handler has her (`user`) and now passes
 * it. Driven through the real /webhook route; only the network boundary is stubbed (WhatsApp, the
 * headless-browser PDF step, the cache, the session store) and Supabase is the in-memory double.
 */
const http = require('http');
const { createMemorySupabase } = require('../quiz/helpers/memory-supabase');

const PHONE = '923001234567';
const TEACHER = {
  id: '11111111-1111-4111-8111-111111111111', role: 'teacher', phone_number: PHONE, preferred_language: 'en',
  registration_completed: true,
};
const OX = {
  id: 7, source: 'oxbridge', is_active: true, grade: 'Grade Seven', subject: 'Physics', chapter_title: 'Waves and Energy',
  description: '<p><strong>Topic: </strong>Dispersion Of Light</p>', content_html: '<h1>Waves</h1><p>Body</p>',
};
const later = (ms) => new Promise((r) => setTimeout(r, ms));

let mockDb;
let mockWa;

function body(message) {
  return {
    entry: [{
      id: 'waba',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'pnid' },
          messages: [{ from: PHONE, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
        },
      }],
    }],
  };
}

function mockBoundaries() {
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
  const store = new Map();
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    isConnected: () => false,
    checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    setexWithCeiling: jest.fn(async (k, _t, v) => { store.set(k, typeof v === 'string' ? JSON.parse(v) : v); return true; }),
    delete: jest.fn(async (k) => { store.delete(k); return true; }),
    setNX: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/services/session.service', () => ({
    isProcessed: jest.fn().mockResolvedValue(false),
    markAsProcessed: jest.fn().mockResolvedValue(undefined),
    getReactionEmoji: jest.fn().mockReturnValue('👍'),
  }));
  mockWa = {
    sendReaction: jest.fn().mockResolvedValue(true),
    showTypingIndicator: jest.fn().mockResolvedValue(true),
    startContinuousTypingIndicator: jest.fn(() => ({ stop() {} })),
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendDocument: jest.fn().mockResolvedValue(true),
  };
  jest.doMock('../../bot/shared/services/whatsapp.service', () => mockWa);
  jest.doMock('../../bot/shared/database/bot-helpers', () => ({
    getOrCreateUser: jest.fn(async () => TEACHER),
    trackChatStart: jest.fn().mockResolvedValue(undefined),
  }));
  jest.doMock('../../bot/shared/services/conversation-resume.service', () => ({
    handleResumeButton: jest.fn().mockResolvedValue(false),
    sweep: jest.fn(),
  }));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: (...a) => mockDb.from(...a),
    rpc: (...a) => mockDb.rpc(...a),
  }));
  jest.doMock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7 fake')) }));
}

async function tapOxbridge() {
  const { app } = require('../../bot/whatsapp-bot');
  const drain = require('../../bot/shared/utils/web-drain');
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body({
        id: 'wamid.tap', type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: `oxbridge_lp_pick_${OX.id}`, title: 'Oxbridge LP' } },
      })),
    });
    expect(res.status).toBe(200);
    await later(20);
    const deadline = Date.now() + 5000;
    while (drain.inFlightCount() !== 0 && Date.now() < deadline) await later(10);
  } finally {
    server.close();
  }
}

const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.LP_LIFECYCLE_PATHS;
  process.env.REGION = 'niete';
  jest.resetModules();
  mockDb = createMemorySupabase({ users: [TEACHER], lesson_plan_catalog: [OX], lesson_plan_requests: [] });
  mockBoundaries();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

describe('the Oxbridge picker tap, through the real /webhook', () => {
  test('switched ON: the delivered plan leaves ONE completed niete_oxbridge row carrying her id', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_oxbridge';
    await tapOxbridge();
    expect(mockWa.sendDocument).toHaveBeenCalledTimes(1);
    const rows = mockDb.table('lesson_plan_requests');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      user_id: TEACHER.id, phone_number: PHONE, status: 'completed', source: 'niete_oxbridge', channel: 'whatsapp',
      artifact_ref: '7', grade: 7, subject: 'Physics',
    }));
  });

  test('switched OFF: the same delivery, and no row', async () => {
    await tapOxbridge();
    expect(mockWa.sendDocument).toHaveBeenCalledTimes(1);
    expect(mockDb.table('lesson_plan_requests')).toHaveLength(0);
  });
});
