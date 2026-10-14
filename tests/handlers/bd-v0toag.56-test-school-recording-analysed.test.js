/**
 * v10 coaching test (bd-v0toag.56): a classroom recording sent on WhatsApp by a teacher whose school is in
 * the test is always analysed. Recordings decide the test, so app_redirect_ai_coaching (which sends a
 * coaching request to the app instead) must not swallow one. Outside the test (switch off, school not
 * drawn, a lookup error) nothing changes: a flagged teacher is still sent to the app.
 *
 * Drives the REAL handleVoiceMessage with the network boundary mocked (the same harness as
 * short-recording-guidance.test.js); the redirect switch and the group lookup are the two dials.
 */
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

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

// The voice itself (not under test here): the gateway answers with a voice note.
jest.mock('../../bot/shared/services/tts', () => ({
  synthesize: jest.fn(() => Promise.resolve({ audio: Buffer.from('OggS'), mimeType: 'audio/ogg', extension: 'ogg', durationSec: 1 })),
}));

// ── everything else the handler touches, stubbed so the branch can run ───────
jest.mock('fs', () => ({
  writeFileSync: jest.fn(), unlinkSync: jest.fn(), existsSync: jest.fn(() => false),
  // bd-x74wv: each voice note is staged in a private temp directory (bot/shared/utils/private-temp.js).
  mkdirSync: jest.fn(), mkdtempSync: jest.fn((prefix) => `${prefix}test`), rmSync: jest.fn(),
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
jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {};
  for (const m of ['select', 'eq', 'neq', 'or', 'order', 'limit', 'update', 'insert', 'single', 'gte', 'lte', 'gt', 'lt', 'in', 'is', 'not', 'upsert', 'delete']) {
    chain[m] = jest.fn(() => chain);
  }
  chain.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
  chain.then = (resolve) => resolve({ data: null, error: null });
  return { from: jest.fn(() => chain) };
});

const mockRedirect = jest.fn(() => Promise.resolve(true));
jest.mock('../../bot/shared/services/app-redirect.service', () => ({
  redirectIfFlagged: (...a) => mockRedirect(...a),
}));
const mockGroupFor = jest.fn(() => Promise.resolve(null));
jest.mock('../../bot/shared/services/coaching/ab-v10-arms', () => ({
  groupFor: (...a) => mockGroupFor(...a),
}));

const { handleVoiceMessage } = require('../../bot/shared/handlers/voice-message.handler');
const CoachingService = require('../../bot/shared/services/coaching-orchestrator.service');
const { logToFile } = require('../../bot/shared/utils/logger');

const FROM = '923001234567';
const TEACHER = { id: 'u1', role: 'teacher', preferred_language: 'ur' };
const lesson = () => ({ id: 'wamid.1', audio: { id: 'media-1', mime_type: 'audio/ogg' } });

beforeEach(() => {
  jest.clearAllMocks();
  mockRedirect.mockImplementation(() => Promise.resolve(true));
  mockGroupFor.mockImplementation(() => Promise.resolve(null));
  global.__SR_MEDIA = { mime_type: 'audio/ogg', file_size: 9_000_000, audio: { duration: 1800 } };
  global.__SR_PROBED_SECONDS = 1800;
  global.__SR_TRANSCRIPT = 'السلام علیکم بچو۔';
});

describe('a teacher in the test', () => {
  test.each(['A', 'B', 'C', 'D'])('group %s: her 30-minute recording is analysed, never sent to the app', async (g) => {
    mockGroupFor.mockImplementation(() => Promise.resolve({ group: g, plan: 'v9', report: 'today' }));
    await handleVoiceMessage(lesson(), FROM, TEACHER);
    expect(CoachingService.initiateCoachingSession).toHaveBeenCalledWith('u1', 'sess-1', 'media-1', FROM, 1800);
    expect(mockRedirect).not.toHaveBeenCalledWith('ai_coaching', expect.anything());
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/v10 test/), expect.objectContaining({ userId: 'u1', group: g }));
  });
});

describe('outside the test, nothing changes', () => {
  test('switch off or school not drawn: a flagged teacher is still sent to the app, nothing analysed', async () => {
    await handleVoiceMessage(lesson(), FROM, TEACHER);
    expect(mockRedirect).toHaveBeenCalledWith('ai_coaching', expect.objectContaining({ userId: 'u1', reason: 'classroom_audio' }));
    expect(CoachingService.initiateCoachingSession).not.toHaveBeenCalled();
  });

  test('a group lookup that throws counts as outside the test', async () => {
    mockGroupFor.mockImplementation(() => Promise.reject(new Error('down')));
    await handleVoiceMessage(lesson(), FROM, TEACHER);
    expect(mockRedirect).toHaveBeenCalledWith('ai_coaching', expect.anything());
    expect(CoachingService.initiateCoachingSession).not.toHaveBeenCalled();
  });

  test('not flagged and not in the test: analysed, as today', async () => {
    mockRedirect.mockImplementation(() => Promise.resolve(false));
    await handleVoiceMessage(lesson(), FROM, TEACHER);
    expect(CoachingService.initiateCoachingSession).toHaveBeenCalledTimes(1);
  });
});
