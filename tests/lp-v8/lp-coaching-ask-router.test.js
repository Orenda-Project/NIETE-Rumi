'use strict';
/**
 * the lpask_ router branch, EXECUTED through the real webhook route
 * (the transcript-quiz router pattern): a source grep cannot see a
 * ReferenceError in the branch it matches.
 */
const http = require('http');

const NUDGE = '22222222-2222-4222-8222-222222222222';
const PHONE = '923001234567';

function webhookBody(buttonId) {
  return {
    entry: [{
      id: 'waba',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'pnid' },
          messages: [{
            id: `wamid.${buttonId}`,
            from: PHONE,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: buttonId, title: 'English' } },
          }],
        },
      }],
    }],
  };
}

async function postWebhook(app, body) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try {
    await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } finally {
    await new Promise((r) => server.close(r));
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


describe('webhook → lpask_ buttons (Class A)', () => {
  beforeEach(() => jest.resetModules());

  test.each(['yes', 'no'])('lpask_%s_<id> reaches LpCoachingAsk.handleButton with the tapping user', async (choice) => {
    mockEverythingBefore();
    const handleButton = jest.fn().mockResolvedValue(true);
    jest.doMock('../../bot/shared/services/nudges/lp-coaching-ask.service', () => ({ handleButton }));
    const { app } = require('../../bot/whatsapp-bot');

    await postWebhook(app, webhookBody(`lpask_${choice}_${NUDGE}`));

    expect(handleButton).toHaveBeenCalledWith(`lpask_${choice}_${NUDGE}`, PHONE, expect.objectContaining({ id: 'u-1' }));
  });

  test('a tq_yes_ tap never reaches the coaching ask', async () => {
    mockEverythingBefore();
    const handleButton = jest.fn().mockResolvedValue(false);
    jest.doMock('../../bot/shared/services/nudges/lp-coaching-ask.service', () => ({ handleButton }));
    jest.doMock('../../bot/shared/services/quiz/transcript-quiz-offer.service', () => ({
      handleOfferButton: jest.fn().mockResolvedValue(true), handleLanguageButton: jest.fn().mockResolvedValue(false),
      MIN_TRANSCRIPT_CHARS: 1500, SESSION_SELECT: 'id',
    }));
    const { app } = require('../../bot/whatsapp-bot');

    await postWebhook(app, webhookBody(`tq_yes_${NUDGE}`));

    expect(handleButton).not.toHaveBeenCalled();
  });
});
