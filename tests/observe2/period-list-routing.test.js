'use strict';
/**
 * /observe2 — the period ids, EXECUTED through the real webhook (not grepped).
 *
 * R18 (FICO pilot sheet, 14 Oct): Friday periods are 25 minutes. Four periods do not fit WhatsApp's
 * three reply buttons, so "How long is this period?" became a list, and a list row arrives as a
 * list_reply, not a button_reply. An id with a consumer in only one branch is a tap that silently
 * does nothing, so both branches are driven here: the new list rows, and the buttons that are still
 * sitting in coaches' chats from before.
 */
const http = require('http');

// The first require of whatsapp-bot.js loads the whole bot; on a loaded machine running the full suite
// in parallel that has taken over a minute, past the 30 s default.
jest.setTimeout(180000);

const PHONE = '923001234567';

function webhookBody(id, kind) {
  return {
    entry: [{
      id: 'waba',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'pnid' },
          messages: [{
            id: `wamid.${id}.${kind}`,
            from: PHONE,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'interactive',
            interactive: kind === 'button_reply'
              ? { type: 'button_reply', button_reply: { id, title: '30 minutes' } }
              : { type: 'list_reply', list_reply: { id, title: '25 minutes' } },
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
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
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
    getOrCreateUser: jest.fn().mockResolvedValue({ id: 'coach-1', phone_number: PHONE, preferred_language: 'en', role: 'coach' }),
    trackChatStart: jest.fn().mockResolvedValue(undefined),
    getOrCreateSession: jest.fn().mockResolvedValue('session-1'),
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

function mockStart() {
  const handlePeriodButton = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/services/observe/observe2/start', () => ({ handlePeriodButton }));
  return { handlePeriodButton };
}

describe('webhook → obs2_period ids', () => {
  beforeEach(() => jest.resetModules());

  test.each(['obs2_period:form-1:25', 'obs2_period:form-1:40'])('a list row %s reaches handlePeriodButton', async (id) => {
    mockEverythingBefore();
    const start = mockStart();
    const { app } = require('../../bot/whatsapp-bot');
    await postWebhook(app, webhookBody(id, 'list_reply'));
    expect(start.handlePeriodButton).toHaveBeenCalledWith(expect.objectContaining({ id: 'coach-1' }), PHONE, id);
  });

  test('a period button sent before the list still reaches handlePeriodButton', async () => {
    mockEverythingBefore();
    const start = mockStart();
    const { app } = require('../../bot/whatsapp-bot');
    await postWebhook(app, webhookBody('obs2_period:form-1:30', 'button_reply'));
    expect(start.handlePeriodButton).toHaveBeenCalledWith(expect.objectContaining({ id: 'coach-1' }), PHONE, 'obs2_period:form-1:30');
  });
});
