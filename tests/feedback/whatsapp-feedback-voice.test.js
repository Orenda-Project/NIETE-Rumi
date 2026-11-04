'use strict';
/**
 * A voice note sent while /feedback or /bug is waiting is the report — through the REAL voice handler, before any
 * coaching or observe audio routing. A coach can be in observe's "awaiting the lesson recording" state AND have just
 * typed /bug: her next short voice note is the bug report, not a lesson recording to analyse.
 *
 * The handler, the intake service and the R2 helper are real; the boundaries are faked: Supabase and Redis in
 * memory, the WhatsApp service (download + sends), the speech-to-text service and the S3 client.
 */
process.env.R2_ENDPOINT = 'https://r2.example';
process.env.R2_ACCESS_KEY_ID = 'r2-key';
process.env.R2_SECRET_ACCESS_KEY = 'r2-secret';
process.env.R2_BUCKET_NAME = 'voice-bucket';

const UID = '22222222-2222-4222-8222-222222222222';
const PHONE = '923004445566';

jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn(), LOGS_DIR: '/tmp',
}));

const mockR2Puts = [];
jest.mock('@aws-sdk/client-s3', () => {
  const command = (name) => class { constructor(input) { this.input = input; this.name = name; } };
  return {
    S3Client: class { async send(cmd) { if (cmd.name === 'PutObjectCommand') mockR2Puts.push({ key: cmd.input.Key, type: cmd.input.ContentType }); return {}; } },
    PutObjectCommand: command('PutObjectCommand'),
    GetObjectCommand: command('GetObjectCommand'),
    DeleteObjectCommand: command('DeleteObjectCommand'),
    HeadObjectCommand: command('HeadObjectCommand'),
    ListObjectsV2Command: command('ListObjectsV2Command'),
  };
});

const mockSends = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  downloadMedia: jest.fn(async () => Buffer.from('OggS-voice-note')),
  sendMessage: jest.fn(async (to, t) => { mockSends.push(t); return true; }),
  sendInteractiveButtons: jest.fn(async () => true),
  sendAudio: jest.fn(async () => true),
  sendTypingIndicator: jest.fn(),
  markAsRead: jest.fn(),
  startContinuousTypingIndicator: () => ({ stop: jest.fn() }),
}));

jest.mock('../../bot/shared/services/audio.service', () => ({
  convertToWav: jest.fn(async (buf, p) => { require('fs').writeFileSync(p, Buffer.concat([Buffer.from('RIFF'), buf])); }),
  transcribeWithLanguagePreference: jest.fn(async () => ({ text: 'Mera visit form band ho gaya', language: 'ur', engine: 'soniox' })),
  getASREngine: () => 'soniox',
}));

const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');

let mockDb;
const mockRedis = createMemoryRedis();
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (t) => mockDb.from(t),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(async () => 'ur'), setUserLanguage: jest.fn(), DEFAULT_LANGUAGE: 'en',
}));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(), getOrCreateSession: jest.fn(async () => 'sess-1'),
  updateSessionType: jest.fn(), storeConversation: jest.fn(), storeAudioSession: jest.fn(), storeLessonPlan: jest.fn(),
}));
// observe's own router: a coach in its awaiting_audio would have this voice note taken as the lesson recording.
jest.mock('../../bot/shared/services/observe/observe-audio-router', () => ({
  routeLeaderAudio: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/handlers/child-test.handler', () => ({ handleVoice: jest.fn(async () => false) }));
jest.mock('../../bot/shared/services/tts', () => ({ synthesize: jest.fn(() => Promise.reject(new Error('no voice'))) }));
jest.mock('../../bot/shared/services/openai.service', () => ({
  detectIntent: jest.fn(async () => ({ type: 'general' })), getResponseWithFormat: jest.fn(async () => 'ok'),
}));
jest.mock('../../bot/shared/services/coaching-orchestrator.service', () => ({
  handleReflectiveResponse: jest.fn(), initiateCoachingSession: jest.fn(),
}));
jest.mock('../../bot/shared/services/feature-registration.service', () => ({ isPendingName: jest.fn(async () => false) }));
jest.mock('../../bot/shared/services/lp-context.service', () => ({ injectLpContext: jest.fn(async () => null) }));

const COACH = { id: UID, name: 'Saima Bibi', role: 'coach', preferred_language: 'ur', registration_completed: true };
const voice = (id, duration = 25) => ({ id, type: 'voice', voice: { id: `media-${id}`, mime_type: 'audio/ogg; codecs=opus', duration } });

beforeEach(() => {
  mockDb = createMemorySupabase({ whatsapp_feedback: [] }, { unique: { whatsapp_feedback: ['wa_message_id'] } });
  mockRedis.reset();
  mockR2Puts.length = 0;
  mockSends.length = 0;
  jest.clearAllMocks();
});

// The wait /bug opens (the key is the contract between the text and voice handlers).
const AWAITING = `niete_feedback:awaiting:${UID}`;
async function waitForBug() {
  await mockRedis.set(AWAITING, { stage: 'message', command: 'bug', topic: 'broken' }, 1800);
}

describe('a voice note while /bug waits', () => {
  test('is the report: saved with its R2 key and transcript, and observe never sees it', async () => {
    await waitForBug();
    const { handleVoiceMessage } = require('../../bot/shared/handlers/voice-message.handler');
    await handleVoiceMessage(voice('wamid.VN1'), PHONE, COACH);

    const rows = mockDb.rows('whatsapp_feedback');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: UID, role: 'coach', command: 'bug', topic: 'broken', message: null,
      transcript: 'Mera visit form band ho gaya', wa_message_id: 'wamid.VN1', language: 'ur',
    });
    expect(rows[0].audio_key).toMatch(new RegExp(`^feedback_audio/${UID}/\\d{4}-\\d{2}/wa_wamid\\.VN1\\.ogg$`));
    expect(mockR2Puts).toEqual([{ key: rows[0].audio_key, type: 'audio/ogg' }]);
    expect(require('../../bot/shared/services/observe/observe-audio-router').routeLeaderAudio).not.toHaveBeenCalled();
    expect(mockSends.join('\n')).toContain(rows[0].ref);
  });

  test('with nothing waiting, the voice note goes to observe as before', async () => {
    const { handleVoiceMessage } = require('../../bot/shared/handlers/voice-message.handler');
    await handleVoiceMessage(voice('wamid.VN2'), PHONE, COACH);
    expect(mockDb.rows('whatsapp_feedback')).toEqual([]);
    expect(require('../../bot/shared/services/observe/observe-audio-router').routeLeaderAudio).toHaveBeenCalledTimes(1);
  });

  test('a full lesson recording is not a bug report: it goes to observe and the wait ends', async () => {
    await waitForBug();
    const { handleVoiceMessage } = require('../../bot/shared/handlers/voice-message.handler');
    await handleVoiceMessage(voice('wamid.VN3', 1800), PHONE, COACH);
    expect(mockDb.rows('whatsapp_feedback')).toEqual([]);
    expect(require('../../bot/shared/services/observe/observe-audio-router').routeLeaderAudio).toHaveBeenCalledTimes(1);
    expect(await mockRedis.get(AWAITING)).toBeNull();
  });
});
