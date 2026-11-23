'use strict';
/**
 * "Make a quiz" on the coaching report template arrives as a template button (messageType 'button') whose payload is
 * tqr_<coachingSessionId>. It must reach TranscriptQuizOffer.handleReportQuizTap, and never fall through to the text
 * path, where "Make a quiz" would read as an ordinary chat message. Drives the real /webhook route; only the network
 * boundary (WhatsApp, Supabase, redis) and the handler itself are stubbed.
 */
const http = require('http');
const { makeDb } = require('../quiz/helpers/memory-db');

const PHONE = '923330000011';
const SID = '0c0ac0ac-1111-4111-8111-000000000001';
const TEACHER = { id: 'teacher-1', role: 'teacher', phone_number: PHONE, preferred_language: 'en' };
const later = (ms) => new Promise((r) => setTimeout(r, ms));

describe('a "Make a quiz" template tap through the real /webhook', () => {
  let mockDb;
  let mockWa;
  let mockTap;

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
      sendMessage: jest.fn().mockResolvedValue(true),
      sendInteractiveButtons: jest.fn().mockResolvedValue(true),
      sendVideoByLink: jest.fn().mockResolvedValue(true),
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
    // The handler is tested for real in closed-window-offer.test.js; here only the route to it.
    mockTap = jest.fn().mockResolvedValue(true);
    jest.doMock('../../bot/shared/services/quiz/transcript-quiz-offer.service', () => ({
      ...jest.requireActual('../../bot/shared/services/quiz/transcript-quiz-offer.service'),
      handleReportQuizTap: (...a) => mockTap(...a),
    }));
  }

  async function tap(text, payload) {
    const { app } = require('../../bot/whatsapp-bot');
    const drain = require('../../bot/shared/utils/web-drain');
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body({ id: 'wamid.tap', type: 'button', button: { text, payload } })),
      });
      expect(res.status).toBe(200);
      await later(20);
      const deadline = Date.now() + 5000;
      while (drain.inFlightCount() !== 0 && Date.now() < deadline) await later(10);
    } finally {
      server.close();
    }
  }

  beforeEach(() => {
    jest.resetModules();
    mockDb = makeDb({ users: [TEACHER] });
    mockBoundaries();
  });

  test('payload tqr_<session> → handleReportQuizTap(payload, from)', async () => {
    await tap('Make a quiz', `tqr_${SID}`);
    expect(mockTap).toHaveBeenCalledTimes(1);
    expect(mockTap).toHaveBeenCalledWith(`tqr_${SID}`, PHONE);
  });

  test('another template button never reaches it', async () => {
    await tap('Lesson Plans & Assessment', 'Lesson Plans & Assessment');
    expect(mockTap).not.toHaveBeenCalled();
  });
});
