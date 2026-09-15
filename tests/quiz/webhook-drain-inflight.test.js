'use strict';
/**
 * The real /webhook route must register its work with the drain, and keep it
 * registered until the work — not the ack — is done.
 *
 * Drives the real Express route with the same seams as webhook-ack.test.js: a
 * picture-Flow quiz answer whose handler takes a while, the shape of the sends
 * that were cut off mid rate-limit on 15 Sep 2026.
 */
const http = require('http');

const PHONE = '923001234567';
const QUESTION_ID = '22222222-2222-4222-8222-222222222222';

const later = (ms) => new Promise((r) => setTimeout(r, ms));

function nfmBody(flowToken, payload) {
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
            interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', body: 'Sent', response_json: JSON.stringify({ flow_token: flowToken, ...payload }) } },
          }],
        },
      }],
    }],
  };
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
    const { fromMock } = require('./helpers/supabase-chain');
    return { from: fromMock({}), rpc: jest.fn().mockResolvedValue({ error: null }) };
  });
}

describe('webhook work is visible to the deploy drain', () => {
  beforeEach(() => jest.resetModules());

  test('a quiz answer stays in flight after the ack until its handler finishes', async () => {
    mockEverythingBefore();
    let finish;
    jest.doMock('../../bot/shared/services/quiz/video-quiz.service', () => ({
      handleAnswer: jest.fn(() => new Promise((r) => { finish = r; })),
      handleOfferButton: jest.fn().mockResolvedValue(false),
      getActiveState: jest.fn().mockResolvedValue(null),
    }));
    const { app } = require('../../bot/whatsapp-bot');
    const drain = require('../../bot/shared/utils/web-drain');
    const VideoQuiz = require('../../bot/shared/services/quiz/video-quiz.service');

    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/webhook`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(nfmBody(`vq:sess-1:${QUESTION_ID}`, { screen_0_Choose_0: '2' })),
      });
      expect(res.status).toBe(200);

      const deadline = Date.now() + 5000;
      while (!VideoQuiz.handleAnswer.mock.calls.length && Date.now() < deadline) await later(10);
      expect(VideoQuiz.handleAnswer).toHaveBeenCalled();

      // Acked, handler still working: the drain must see it.
      expect(drain.inFlightCount()).toBe(1);

      finish(true);
      const done = Date.now() + 5000;
      while (drain.inFlightCount() !== 0 && Date.now() < done) await later(10);
      expect(drain.inFlightCount()).toBe(0);
    } finally {
      server.close();
    }
  }, 15000);
});
