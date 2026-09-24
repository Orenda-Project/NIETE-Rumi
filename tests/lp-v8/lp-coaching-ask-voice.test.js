'use strict';
/**
 * 4.5 + 4.6 — what the REAL voice handler does with a recording
 * after the teacher said "Record my lesson".
 *
 * Same harness as tests/handlers/short-recording-guidance.test.js: media
 * download, ffprobe, transcription, the LLM and Supabase are mocked at the
 * network boundary; the handler and the coaching-ask service run for real.
 *
 *  4.5  a probed 5–15 minute recording within 8 h of a "yes" is answered with
 *       lpAskTooShort and is NOT transcribed as a chat question; without a yes,
 *       or under 5 minutes, the existing path runs unchanged.
 *  4.6  a WhatsApp voice note (audio.voice=true, opus) of classroom length gets
 *       the coaching flow and never the old "send it as a document" text — and
 *       the metadata log line says it was a voice note, which the dead
 *       `format` field (always 'audio') never could.
 */

jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: (...a) => mockEvent(...a) }));

const mockLog = jest.fn();
const mockEvent = jest.fn();

// ── the network boundary ──────────────────────────────────────────────────────
const mockSendMessage = jest.fn(() => Promise.resolve());
const mockSendAudio = jest.fn(() => Promise.resolve());
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  startContinuousTypingIndicator: () => ({ stop: jest.fn() }),
  getMediaInfo: jest.fn(() => Promise.resolve(global.__SR_MEDIA)),
  downloadMedia: jest.fn(() => Promise.resolve(Buffer.from('audio-bytes'))),
  sendMessage: (...a) => mockSendMessage(...a),
  sendAudio: (...a) => mockSendAudio(...a),
  sendSticker: jest.fn(() => Promise.resolve()),
}));

const mockGetResponse = jest.fn(() => Promise.resolve('یہ آپ کے سوال کا جواب ہے۔'));
jest.mock('../../bot/shared/services/openai.service', () => ({
  detectIntent: jest.fn(() => Promise.resolve({ type: 'general' })),
  getResponseWithFormat: (...a) => mockGetResponse(...a),
}));

jest.mock('../../bot/shared/services/audio.service', () => ({
  getAudioDuration: jest.fn(() => Promise.resolve(global.__SR_PROBED_SECONDS)),
  convertToWav: jest.fn(() => Promise.resolve()),
  transcribeWithLanguagePreference: jest.fn(() => Promise.resolve({
    text: global.__SR_TRANSCRIPT, language: 'ur', engine: 'soniox',
  })),
  transcribeAudio: jest.fn(() => Promise.resolve(global.__SR_TRANSCRIPT)),
  generateSpeechForLanguage: jest.fn(() => Promise.resolve(Buffer.from('mp3'))),
  getASREngine: jest.fn(() => 'soniox'),
}));

// ── everything else the handler touches, stubbed so the branch can run ───────
jest.mock('fs', () => ({
  writeFileSync: jest.fn(), unlinkSync: jest.fn(), existsSync: jest.fn(() => false),
  readFileSync: jest.requireActual('fs').readFileSync,
  readdirSync: jest.requireActual('fs').readdirSync,
  statSync: jest.requireActual('fs').statSync,
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadAudio: jest.fn(() => Promise.resolve('https://r2.example/a.ogg')),
}));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(), getOrCreateSession: jest.fn(() => Promise.resolve('sess-1')),
  updateSessionType: jest.fn(), storeConversation: jest.fn(),
  storeAudioSession: jest.fn(), storeLessonPlan: jest.fn(),
}));
jest.mock('../../bot/shared/services/observe/observe-audio-router', () => {
  const actual = jest.requireActual('../../bot/shared/services/observe/observe-audio-router');
  return { ...actual, routeLeaderAudio: jest.fn(() => Promise.resolve(false)) };
});
jest.mock('../../bot/shared/services/feature-registration.service', () => ({
  isPendingName: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('../../bot/shared/services/conversation-state.service', () => ({
  getState: jest.fn(() => Promise.resolve(null)), clearState: jest.fn(),
}));
jest.mock('../../bot/shared/services/language-detector.service', () => ({
  getConfirmedLanguage: jest.fn(() => Promise.resolve('ur')),
}));
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(() => Promise.resolve('ur')),
  setUserLanguage: jest.fn(),
  DEFAULT_LANGUAGE: 'en',
}));
jest.mock('../../bot/shared/services/lp-context.service', () => ({
  injectLpContext: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../../bot/shared/services/coaching-orchestrator.service', () => ({
  handleReflectiveResponse: jest.fn(), initiateCoachingSession: jest.fn(),
}));

// Supabase: a table-aware chain; teacher_nudges answers with the "yes" row when a
// test puts one there, everything else is empty (as the guidance harness does).
jest.mock('../../bot/shared/config/supabase', () => {
  const make = (table) => {
    const chain = {};
    for (const m of ['select', 'eq', 'neq', 'or', 'order', 'limit', 'update', 'insert', 'single', 'gte', 'lt', 'lte', 'is', 'in', 'not']) {
      chain[m] = jest.fn(() => chain);
    }
    const result = () => (table === 'teacher_nudges'
      ? { data: global.__YES ? [global.__YES] : [], error: null }
      : { data: null, error: null });
    chain.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
    chain.then = (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
    return chain;
  };
  return { from: jest.fn((t) => make(t)), rpc: jest.fn() };
});

const { handleVoiceMessage } = require('../../bot/shared/handlers/voice-message.handler');
const CoachingService = require('../../bot/shared/services/coaching-orchestrator.service');
const AudioService = require('../../bot/shared/services/audio.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const FROM = '923001234567';
const TEACHER = { id: '11111111-1111-4111-8111-111111111111', role: 'teacher', preferred_language: 'ur' };
const yesRow = (minsAgo = 60) => ({
  id: '22222222-2222-4222-8222-222222222222', choice: 'yes',
  answered_at: new Date(Date.now() - minsAgo * 60000).toISOString(),
});
const voiceNote = () => ({
  id: 'wamid.1', type: 'audio',
  audio: { id: 'media-1', mime_type: 'audio/ogg; codecs=opus', voice: true },
});
const sentBodies = () => mockSendMessage.mock.calls.map((c) => String(c[1]));
const tooShort = (minutes) => resolveUx('lpAskTooShort', { language: 'ur', params: { minutes } });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.LP_COACHING_ASK_ENABLED = 'true';
  global.__YES = null;
  global.__SR_MEDIA = { mime_type: 'audio/ogg; codecs=opus', file_size: 1_300_000 };
  global.__SR_PROBED_SECONDS = 660;                         // 11 minutes
  global.__SR_TRANSCRIPT = 'السلام علیکم بچو۔ آج ہم پڑھیں گے۔';
});
afterAll(() => { delete process.env.LP_COACHING_ASK_ENABLED; });

describe('4.5 — an 11-minute recording after "Record my lesson"', () => {
  test('is answered as too short, and is not transcribed as a question', async () => {
    global.__YES = yesRow(60);
    await handleVoiceMessage(voiceNote(), FROM, TEACHER);

    expect(sentBodies()).toEqual([tooShort(11)]);
    expect(AudioService.transcribeWithLanguagePreference).not.toHaveBeenCalled();
    expect(mockGetResponse).not.toHaveBeenCalled();
    expect(mockEvent).toHaveBeenCalledWith('lp_ask.too_short', expect.objectContaining({ minutes: 11, seconds: 660, path: 'voice' }));
  });

  test('without a yes, the same audio takes the existing path', async () => {
    await handleVoiceMessage(voiceNote(), FROM, TEACHER);

    expect(sentBodies()).not.toContain(tooShort(11));
    expect(AudioService.transcribeWithLanguagePreference).toHaveBeenCalledTimes(1);
    expect(mockGetResponse).toHaveBeenCalledTimes(1);
  });

  test('a yes older than 8 hours does not count', async () => {
    global.__YES = yesRow(9 * 60);
    await handleVoiceMessage(voiceNote(), FROM, TEACHER);
    expect(sentBodies()).not.toContain(tooShort(11));
    expect(mockGetResponse).toHaveBeenCalledTimes(1);
  });

  test('under 5 minutes is a voice message to the bot, even after a yes', async () => {
    global.__YES = yesRow(30);
    global.__SR_PROBED_SECONDS = 240;
    await handleVoiceMessage(voiceNote(), FROM, TEACHER);
    expect(sentBodies().some((b) => b === tooShort(4))).toBe(false);
    expect(mockGetResponse).toHaveBeenCalledTimes(1);
  });

  test('an unprobed small file (WhatsApp duration 0) is never called too short', async () => {
    global.__YES = yesRow(30);
    global.__SR_MEDIA = { mime_type: 'audio/ogg; codecs=opus', file_size: 90_000 };
    await handleVoiceMessage(voiceNote(), FROM, TEACHER);
    expect(mockEvent).not.toHaveBeenCalledWith('lp_ask.too_short', expect.anything());
    expect(mockGetResponse).toHaveBeenCalledTimes(1);
  });
});

describe('4.6 — a 20-minute voice note is a classroom recording, with no "document" warning', () => {
  test('the coaching flow starts and nothing tells the teacher to attach a file', async () => {
    global.__SR_MEDIA = { mime_type: 'audio/ogg; codecs=opus', file_size: 2_400_000 };
    global.__SR_PROBED_SECONDS = 1200;
    await handleVoiceMessage(voiceNote(), FROM, TEACHER);

    expect(CoachingService.initiateCoachingSession).toHaveBeenCalledTimes(1);
    expect(sentBodies().join('\n')).not.toMatch(/document|📎/i);
    const meta = mockLog.mock.calls.find((c) => c[0] === 'Audio metadata retrieved');
    expect(meta).toBeTruthy();
    expect(meta[1]).toMatchObject({ voiceNote: true });
    expect(meta[1]).not.toHaveProperty('format');
  });
});
