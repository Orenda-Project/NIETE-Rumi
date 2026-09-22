'use strict';
/**
 * The lpquiz_ ids, EXECUTED through the real webhook — not grepped (the
 * route-contract for PLAN_R8 §2.3). Every id the 15:00 offer emits must reach
 * its handler from the branch WhatsApp actually delivers it on: the Make/No
 * buttons arrive as button_reply, the class rows and Not today as list_reply.
 * An id with a consumer in only one branch is a tap that silently does nothing.
 */
const http = require('http');

const NID = '33333333-3333-4333-8333-333333333333';
const PHONE = '923001234567';

function webhookBody(buttonId, kind = 'button_reply') {
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
            interactive: kind === 'button_reply'
              ? { type: 'button_reply', button_reply: { id: buttonId, title: 'Make the quiz' } }
              : { type: 'list_reply', list_reply: { id: buttonId, title: 'Grade 4 · Mathematics' } },
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
    const { fromMock } = require('./helpers/supabase-chain');
    return { from: fromMock({}), rpc: jest.fn().mockResolvedValue({ error: null }) };
  });
}

function mockOffer() {
  const handleButton = jest.fn().mockResolvedValue(true);
  const handleListPick = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/services/nudges/lp-quiz-offer.service', () => ({ handleButton, handleListPick }));
  return { handleButton, handleListPick };
}

describe('webhook → lpquiz_ ids', () => {
  beforeEach(() => jest.resetModules());

  test.each([`lpquiz_yes_${NID}`, `lpquiz_no_${NID}`])('button %s reaches handleButton', async (id) => {
    mockEverythingBefore();
    const offer = mockOffer();
    const { app } = require('../../bot/whatsapp-bot');
    await postWebhook(app, webhookBody(id, 'button_reply'));
    expect(offer.handleButton).toHaveBeenCalledWith(id, PHONE, expect.objectContaining({ id: 'u-1' }));
  });

  test.each([`lpquiz_pick_${NID}_g4_math`, `lpquiz_pick_${NID}_g5_general_science`, `lpquiz_none_${NID}`])(
    'list row %s reaches handleListPick', async (id) => {
      mockEverythingBefore();
      const offer = mockOffer();
      const { app } = require('../../bot/whatsapp-bot');
      await postWebhook(app, webhookBody(id, 'list_reply'));
      expect(offer.handleListPick).toHaveBeenCalledWith(id, PHONE, expect.objectContaining({ id: 'u-1' }));
    },
  );
});
