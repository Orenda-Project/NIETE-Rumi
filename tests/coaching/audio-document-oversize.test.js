'use strict';
/**
 * An audio DOCUMENT over the 100 MB cap, sent through the real webhook into handleDocumentMessage.
 *
 * The cap read `message.document.file_size`, a field Meta does not send on an inbound document
 * (none of the production webhooks carry it). So the cap never fired: every
 * audio document, of any size, was downloaded whole into memory. The real size is in Meta's media
 * info (GET /{media-id} → file_size), which downloadMedia fetched and never read.
 *
 * And the message that cap would have sent named a 25 MB limit that has not existed since the cap
 * became 100 MB, in English only, with a "roadmap" instead of something to do.
 *
 * Mocked at the network boundary only: Meta's Graph API (getMediaInfo / downloadMedia / send),
 * Redis, the database. The webhook route, the document handler and the router run for real.
 */
const http = require('http');

const PHONE = '923001234567';
const MB = 1024 * 1024;
const later = (ms) => new Promise((r) => setTimeout(r, ms));

function documentWebhook({ fileSize } = {}) {
  const document = { id: 'MEDIA-1', mime_type: 'audio/mp4', filename: 'lesson.m4a', sha256: 'x' };
  if (fileSize !== undefined) document.file_size = fileSize;
  return {
    entry: [{
      id: 'waba',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'pnid' },
          messages: [{ id: 'wamid.DOC1', from: PHONE, timestamp: String(Math.floor(Date.now() / 1000)), type: 'document', document }],
        },
      }],
    }],
  };
}

function mockBoundaries({ user, mediaSize }) {
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
    // Meta's media info: what GET /{media-id} answers for an inbound document.
    getMediaInfo: jest.fn().mockResolvedValue({ id: 'MEDIA-1', mime_type: 'audio/mp4', file_size: mediaSize, url: 'https://lookaside.example/m' }),
    downloadMedia: jest.fn().mockResolvedValue(Buffer.from('audio')),
  }));
  jest.doMock('../../bot/shared/database/bot-helpers', () => ({
    getOrCreateUser: jest.fn().mockResolvedValue(user),
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
  // Under the cap the file goes on as today: a 30-minute probe, then the coach's observation.
  jest.doMock('../../bot/shared/services/audio.service', () => ({ getAudioDuration: jest.fn().mockResolvedValue(1800) }));
  jest.doMock('../../bot/shared/services/observe/observe-audio-router', () => ({ routeLeaderAudio: jest.fn().mockResolvedValue(true) }));
}

async function postAndSettle(app, body) {
  const drain = require('../../bot/shared/utils/web-drain');
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    await later(20);
    const deadline = Date.now() + 5000;
    while (drain.inFlightCount() !== 0 && Date.now() < deadline) await later(10);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const COACH = (lang) => ({ id: 'u-1', phone_number: PHONE, preferred_language: lang, role: 'coach' });

describe('an audio document over 100 MB, as Meta really sends it (no file_size on the webhook)', () => {
  beforeEach(() => jest.resetModules());

  test('is refused from Meta\'s media info before anything is downloaded, in words that name the real state (en)', async () => {
    mockBoundaries({ user: COACH('en'), mediaSize: 150 * MB });
    const { app } = require('../../bot/whatsapp-bot');
    const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

    await postAndSettle(app, documentWebhook());

    expect(WhatsAppService.getMediaInfo).toHaveBeenCalledWith('MEDIA-1');
    expect(WhatsAppService.downloadMedia).not.toHaveBeenCalled();
    const texts = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
    const refusal = texts.find((t) => /150\.0 MB/.test(t));
    expect(refusal).toBeTruthy();
    expect(refusal).toMatch(/100 MB/);
    expect(refusal).not.toMatch(/25 ?MB|roadmap|transcription engine/i);
    // What to do: the sound only, from the voice recorder app, as a document.
    expect(refusal).toMatch(/voice recorder app/i);
    expect(refusal).toMatch(/\*Document\*/);
  }, 15000);

  test('the refusal is in the coach\'s language (ur)', async () => {
    mockBoundaries({ user: COACH('ur'), mediaSize: 150 * MB });
    const { app } = require('../../bot/whatsapp-bot');
    const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

    await postAndSettle(app, documentWebhook());

    expect(WhatsAppService.downloadMedia).not.toHaveBeenCalled();
    const refusal = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).find((t) => /150\.0 MB/.test(t));
    expect(refusal).toBeTruthy();
    expect(refusal).toMatch(/[؀-ۿ]/);
    expect(refusal).toMatch(/100 MB/);
  }, 15000);

  test('a 30 MB lesson still goes through: downloaded and handed to the observation', async () => {
    mockBoundaries({ user: COACH('en'), mediaSize: 30 * MB });
    const { app } = require('../../bot/whatsapp-bot');
    const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
    const { routeLeaderAudio } = require('../../bot/shared/services/observe/observe-audio-router');

    await postAndSettle(app, documentWebhook());

    expect(WhatsAppService.downloadMedia).toHaveBeenCalledWith('MEDIA-1');
    expect(routeLeaderAudio).toHaveBeenCalledWith(expect.objectContaining({ audioId: 'MEDIA-1', isLongAudio: true }));
    expect(WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n')).not.toMatch(/100 MB/);
  }, 15000);

  test('when Meta\'s media info cannot be read, the file still goes on as today (no false refusal)', async () => {
    mockBoundaries({ user: COACH('en'), mediaSize: 30 * MB });
    const WhatsAppServicePre = require('../../bot/shared/services/whatsapp.service');
    WhatsAppServicePre.getMediaInfo.mockRejectedValueOnce(new Error('Graph 500'));
    const { app } = require('../../bot/whatsapp-bot');
    const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

    await postAndSettle(app, documentWebhook());

    expect(WhatsAppService.downloadMedia).toHaveBeenCalledWith('MEDIA-1');
    expect(WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n')).not.toMatch(/100 MB/);
  }, 15000);
});
