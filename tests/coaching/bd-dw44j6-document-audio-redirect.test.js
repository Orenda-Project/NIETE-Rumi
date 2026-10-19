'use strict';
/**
 * bd-dw44j6 — a classroom recording sent as a FILE (WhatsApp "Document", the way a phone voice-recorder
 * shares a 40-minute lesson) must obey app_redirect_ai_coaching exactly as a voice note does.
 *
 * The voice-note path asks redirectIfFlagged('ai_coaching') before it starts the WhatsApp coaching flow;
 * the document path never asked, so with the switch on for every teacher a recording sent as a file
 * still started the flow in chat (182 such recordings on prod, 12–19 Oct). A coach's observation file
 * is routed to /observe first and never reaches the switch.
 *
 * Mocked at the network boundary (Meta, Redis, the database) plus the redirect switch and the coaching
 * entry point; the webhook route and handleDocumentMessage run for real.
 */
const http = require('http');

const PHONE = '923001234567';
const MB = 1024 * 1024;
const later = (ms) => new Promise((r) => setTimeout(r, ms));

function documentWebhook() {
  const document = { id: 'MEDIA-1', mime_type: 'audio/mp4', filename: 'lesson.m4a', sha256: 'x' };
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

function mockBoundaries({ user, redirected, leaderHandled = false }) {
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
    getMediaInfo: jest.fn().mockResolvedValue({ id: 'MEDIA-1', mime_type: 'audio/mp4', file_size: 30 * MB, url: 'https://lookaside.example/m' }),
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
  // A 30-minute lesson: over the 15-minute classroom threshold.
  jest.doMock('../../bot/shared/services/audio.service', () => ({ getAudioDuration: jest.fn().mockResolvedValue(1800) }));
  jest.doMock('../../bot/shared/services/observe/observe-audio-router', () => ({ routeLeaderAudio: jest.fn().mockResolvedValue(leaderHandled) }));
  jest.doMock('../../bot/shared/services/app-redirect.service', () => ({ redirectIfFlagged: jest.fn().mockResolvedValue(redirected) }));
  jest.doMock('../../bot/shared/services/coaching-orchestrator.service', () => ({ initiateCoachingSession: jest.fn().mockResolvedValue(undefined) }));
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

const TEACHER = { id: 'u-teacher', phone_number: PHONE, preferred_language: 'en', role: 'teacher' };
const COACH = { id: 'u-coach', phone_number: PHONE, preferred_language: 'en', role: 'coach' };

describe('bd-dw44j6 · a classroom recording sent as a document obeys app_redirect_ai_coaching', () => {
  beforeEach(() => jest.resetModules());

  test('switch covers her: she is sent to the app and the WhatsApp coaching flow does not start', async () => {
    mockBoundaries({ user: TEACHER, redirected: true });
    const { app } = require('../../bot/whatsapp-bot');
    const { redirectIfFlagged } = require('../../bot/shared/services/app-redirect.service');
    const CoachingService = require('../../bot/shared/services/coaching-orchestrator.service');

    await postAndSettle(app, documentWebhook());

    expect(redirectIfFlagged).toHaveBeenCalledWith('ai_coaching', expect.objectContaining({ userId: 'u-teacher', from: PHONE }));
    expect(CoachingService.initiateCoachingSession).not.toHaveBeenCalled();
  }, 15000);

  test('switch does not cover her: the WhatsApp coaching flow starts as today', async () => {
    mockBoundaries({ user: TEACHER, redirected: false });
    const { app } = require('../../bot/whatsapp-bot');
    const CoachingService = require('../../bot/shared/services/coaching-orchestrator.service');

    await postAndSettle(app, documentWebhook());

    expect(CoachingService.initiateCoachingSession).toHaveBeenCalledWith('u-teacher', 'session-1', 'MEDIA-1', PHONE, 1800);
  }, 15000);

  test("a coach's observation file goes to /observe and never reaches the switch", async () => {
    mockBoundaries({ user: COACH, redirected: true, leaderHandled: true });
    const { app } = require('../../bot/whatsapp-bot');
    const { redirectIfFlagged } = require('../../bot/shared/services/app-redirect.service');
    const { routeLeaderAudio } = require('../../bot/shared/services/observe/observe-audio-router');

    await postAndSettle(app, documentWebhook());

    expect(routeLeaderAudio).toHaveBeenCalled();
    expect(redirectIfFlagged).not.toHaveBeenCalledWith('ai_coaching', expect.anything());
  }, 15000);
});
