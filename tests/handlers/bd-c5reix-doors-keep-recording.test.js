'use strict';
/**
 * bd-c5reix — both WhatsApp doors keep a classroom recording for the app (AC1, AC3).
 *
 *   voice note   the REAL handleVoiceMessage, the network mocked: WhatsApp gives no duration, the bytes are probed —
 *                and those same bytes are what is saved (no second download), BEFORE the link is sent
 *   audio file   whatsapp-bot.js handleDocumentMessage cannot be loaded in a test (it starts the server), so its
 *                classroom branch is pinned at the source, comments stripped: the kept-for-the-app call, with the
 *                buffer it already downloaded, in place of the bare redirect
 */
const fs = require('fs');
const path = require('path');

jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const mockOrder = [];
const mockDownload = jest.fn(() => Promise.resolve(Buffer.from('forty minutes of class')));
const mockCta = jest.fn(() => { mockOrder.push('link'); return Promise.resolve(true); });
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  startContinuousTypingIndicator: () => ({ stop: jest.fn() }),
  getMediaInfo: jest.fn(() => Promise.resolve(global.__KR_MEDIA)),
  downloadMedia: (...a) => mockDownload(...a),
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendCtaUrl: (...a) => mockCta(...a),
  sendAudio: jest.fn(() => Promise.resolve()),
  sendSticker: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/audio.service', () => ({
  getAudioDuration: jest.fn(() => Promise.resolve(global.__KR_PROBED)),
  convertToWav: jest.fn(() => Promise.resolve()),
  transcribeWithLanguagePreference: jest.fn(() => Promise.resolve({ text: 'x', language: 'ur', engine: 'soniox' })),
  transcribeAudio: jest.fn(() => Promise.resolve('x')),
  getASREngine: jest.fn(() => 'soniox'),
}));
jest.mock('../../bot/shared/services/tts', () => ({ synthesize: jest.fn() }));
jest.mock('../../bot/shared/services/openai.service', () => ({ detectIntent: jest.fn(), getResponseWithFormat: jest.fn() }));
const mockUploadBuffer = jest.fn((buffer, key) => { mockOrder.push('saved'); return Promise.resolve(`https://r2.example/b/${key}`); });
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadAudio: jest.fn(),
  uploadBuffer: (...a) => mockUploadBuffer(...a),
  listObjects: jest.fn(() => Promise.resolve([])),
  buildR2PublicUrl: (k) => `https://r2.example/b/${k}`,
}));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(), getOrCreateSession: jest.fn(() => Promise.resolve('sess-1')),
  updateSessionType: jest.fn(), storeConversation: jest.fn(), storeAudioSession: jest.fn(), storeLessonPlan: jest.fn(),
}));
jest.mock('../../bot/shared/services/observe/observe-audio-router', () => {
  const actual = jest.requireActual('../../bot/shared/services/observe/observe-audio-router');
  return { ...actual, routeLeaderAudio: jest.fn(() => Promise.resolve(false)) };
});
jest.mock('../../bot/shared/services/feature-registration.service', () => ({ isPendingName: jest.fn(() => Promise.resolve(false)) }));
jest.mock('../../bot/shared/services/conversation-state.service', () => ({ getState: jest.fn(() => Promise.resolve(null)), clearState: jest.fn() }));
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(() => Promise.resolve('ur')), setUserLanguage: jest.fn(), DEFAULT_LANGUAGE: 'en',
}));
jest.mock('../../bot/shared/services/lp-context.service', () => ({ injectLpContext: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../../bot/shared/services/coaching-orchestrator.service', () => ({
  handleReflectiveResponse: jest.fn(), initiateCoachingSession: jest.fn(),
}));
jest.mock('../../bot/shared/services/coaching/ab-v10-arms', () => ({ groupFor: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {};
  for (const m of ['select', 'eq', 'neq', 'or', 'order', 'limit', 'update', 'insert', 'single', 'gte', 'lte', 'gt', 'lt', 'in', 'is', 'not', 'upsert', 'delete']) {
    chain[m] = jest.fn(() => chain);
  }
  chain.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
  chain.then = (resolve) => resolve({ data: null, error: null });
  return { from: jest.fn(() => chain) };
});

/** The app-link decision, as the teacher-link branch takes it: onLink, then the link (sendCtaUrl). */
const mockRedirect = jest.fn(async (feature, args) => {
  if (!global.__KR_LINK) return false;
  if (args.onLink) global.__KR_SHAPE = await args.onLink({ journey: { journeyId: 'j_0123456789abcdef', feature } });
  return mockCta();
});
jest.mock('../../bot/shared/services/app-redirect.service', () => ({ redirectIfFlagged: (...a) => mockRedirect(...a) }));

const { handleVoiceMessage } = require('../../bot/shared/handlers/voice-message.handler');
const CoachingService = require('../../bot/shared/services/coaching-orchestrator.service');

const FROM = '+92300FIXTURE1';
const TEACHER = { id: '1ff9fc2e-9b4a-48d4-94f3-312ad52df81b', role: 'teacher', preferred_language: 'ur' };
const voiceNote = () => ({ id: 'wamid.1', audio: { id: 'media-1', mime_type: 'audio/ogg; codecs=opus', voice: true } });

beforeEach(() => {
  jest.clearAllMocks();
  mockOrder.length = 0;
  global.__KR_LINK = true;
  global.__KR_SHAPE = undefined;
  // WhatsApp sends no duration (classroom-audio.config.js): the length is the probe's.
  global.__KR_MEDIA = { mime_type: 'audio/ogg', file_size: 9_000_000, audio: { duration: 0 } };
  global.__KR_PROBED = 1812;
});

describe('the voice-note door', () => {
  test('AC1 — the probed bytes are saved (one download), with the door and the length, BEFORE the link', async () => {
    await handleVoiceMessage(voiceNote(), FROM, TEACHER);
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockUploadBuffer).toHaveBeenCalledTimes(1);
    const [buffer, key, contentType, opts] = mockUploadBuffer.mock.calls[0];
    expect(buffer.toString()).toBe('forty minutes of class');
    expect(key).toMatch(new RegExp(`^classroom_audio/${TEACHER.id}/\\d{4}-\\d{2}/portal_wa-[0-9a-f]{16}-[A-Za-z0-9-]+\\.ogg$`));
    expect(contentType).toBe('audio/ogg');
    expect(opts.metadata).toEqual(expect.objectContaining({ duration: '1812', door: 'voice' }));
    expect(mockOrder).toEqual(['saved', 'link']);
    expect(global.__KR_SHAPE).toEqual({ landing: 'ai_coaching_recording' });
    expect(mockRedirect).toHaveBeenCalledWith('ai_coaching', expect.objectContaining({ userId: TEACHER.id, reason: 'classroom_audio' }));
    expect(CoachingService.initiateCoachingSession).not.toHaveBeenCalled();
  });

  test('AC3 — no link for her: nothing is saved, and the WhatsApp coaching flow starts as before', async () => {
    global.__KR_LINK = false;
    await handleVoiceMessage(voiceNote(), FROM, TEACHER);
    expect(mockUploadBuffer).not.toHaveBeenCalled();
    expect(CoachingService.initiateCoachingSession).toHaveBeenCalledWith(TEACHER.id, 'sess-1', 'media-1', FROM, 1812);
  });

  test('AC3 — a voice note under 15 minutes never reaches the door', async () => {
    global.__KR_PROBED = 600;
    await handleVoiceMessage(voiceNote(), FROM, TEACHER).catch(() => {});
    expect(mockRedirect).not.toHaveBeenCalledWith('ai_coaching', expect.anything());
    expect(mockUploadBuffer).not.toHaveBeenCalled();
  });
});

describe('the audio-file door (whatsapp-bot.js), pinned at the source', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../bot/whatsapp-bot.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const start = src.indexOf("CLASSROOM AUDIO DETECTED (15+ minutes)");
  const end = src.indexOf('initiateCoachingSession(', start);
  const branch = start >= 0 && end > start ? src.slice(start, end) : '';

  test('the classroom branch is found', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });

  test('it keeps the file for the app with the bytes it already holds — no bare redirect left', () => {
    expect(branch).toMatch(/redirectClassroomRecording\(\s*\{[\s\S]*?buffer:\s*audioBuffer[\s\S]*?\}\s*\)/);
    expect(branch).toMatch(/door:\s*'document'/);
    expect(branch).toMatch(/reason:\s*'classroom_audio_document'/);
    expect(branch).toMatch(/filename:\s*message\.document\.filename/);
    expect(branch).not.toMatch(/buttonRedirectsToApp\(\s*'ai_coaching'/);
  });

  test('a leader\'s recording still goes to /observe first', () => {
    const leader = branch.indexOf('routeLeaderAudio(');
    const kept = branch.indexOf('redirectClassroomRecording(');
    expect(leader).toBeGreaterThanOrEqual(0);
    expect(kept).toBeGreaterThanOrEqual(0);
    expect(leader).toBeLessThan(kept);
  });
});
