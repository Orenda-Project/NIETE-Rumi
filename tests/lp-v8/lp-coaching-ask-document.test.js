'use strict';
/**
 * 4.5 — the short-recording catch on the AUDIO-DOCUMENT path.
 *
 * A recording attached with 📎 arrives as a document; the webhook downloads it,
 * probes it with ffprobe, and hands anything under 15 minutes to the voice
 * handler as if it were a voice note. After a "Record my lesson", a 5–15 minute
 * file must be answered as too short HERE, from the probed length already in
 * hand, before it is handed on to be transcribed as chat.
 *
 * The real webhook route runs (the transcript-quiz router pattern); ffprobe,
 * WhatsApp and Supabase are mocked at the boundary.
 */
const http = require('http');

const NUDGE = '22222222-2222-4222-8222-222222222222';
const PHONE = '923001234567';

function webhookBody(buttonId, doc = null) {
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
            ...(doc
              ? { type: 'document', document: doc }
              : { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: buttonId, title: 'English' } } }),
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
    downloadMedia: jest.fn().mockResolvedValue(Buffer.from('opus-bytes')),
  }));
  jest.doMock('../../bot/shared/database/bot-helpers', () => ({
    getOrCreateUser: jest.fn().mockResolvedValue({ id: 'u-1', phone_number: PHONE, preferred_language: 'en', role: 'teacher' }),
    getOrCreateSession: jest.fn().mockResolvedValue('s-1'),
    trackChatStart: jest.fn().mockResolvedValue(undefined),
  }));
  jest.doMock('../../bot/shared/services/conversation-resume.service', () => ({
    handleResumeButton: jest.fn().mockResolvedValue(false),
    sweep: jest.fn(),
  }));
  jest.doMock('../../bot/shared/config/supabase', () => {
    const { fromMock } = require('../quiz/helpers/supabase-chain');
    return {
      from: fromMock({ teacher_nudges: () => ({ data: global.__YES ? [global.__YES] : [], error: null }) }),
      rpc: jest.fn().mockResolvedValue({ error: null }),
    };
  });
}



const OPUS_DOC = { id: 'media-doc-1', mime_type: 'audio/ogg', filename: 'lesson.ogg', file_size: 1_300_000 };

function mockAudioAndVoice(probedSeconds) {
  jest.doMock('../../bot/shared/services/audio.service', () => ({
    getAudioDuration: jest.fn().mockResolvedValue(probedSeconds),
  }));
  const handleVoiceMessage = jest.fn().mockResolvedValue(undefined);
  jest.doMock('../../bot/shared/handlers/voice-message.handler', () => ({ handleVoiceMessage }));
  return handleVoiceMessage;
}

describe('webhook → audio document after "Record my lesson"', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.LP_COACHING_ASK_ENABLED = 'true';
    global.__YES = null;
  });
  afterAll(() => { delete process.env.LP_COACHING_ASK_ENABLED; delete global.__YES; });

  test('an 11-minute file is answered as too short and never handed to the voice handler', async () => {
    global.__YES = { id: NUDGE, choice: 'yes', answered_at: new Date(Date.now() - 3600e3).toISOString() };
    mockEverythingBefore();
    const handleVoiceMessage = mockAudioAndVoice(660);
    const { app } = require('../../bot/whatsapp-bot');
    const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
    const { resolveUx } = require('../../bot/shared/config/ux-strings');

    await postWebhook(app, webhookBody(null, OPUS_DOC));

    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, resolveUx('lpAskTooShort', { language: 'en', params: { minutes: 11 } }));
    expect(handleVoiceMessage).not.toHaveBeenCalled();
  });

  test('without a yes the file goes to the voice handler as before', async () => {
    mockEverythingBefore();
    const handleVoiceMessage = mockAudioAndVoice(660);
    const { app } = require('../../bot/whatsapp-bot');

    await postWebhook(app, webhookBody(null, OPUS_DOC));

    expect(handleVoiceMessage).toHaveBeenCalledTimes(1);
  });
});
