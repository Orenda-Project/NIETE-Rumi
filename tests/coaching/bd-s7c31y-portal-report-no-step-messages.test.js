'use strict';
/**
 * bd-s7c31y (operator, 19 Oct) — a TEACHER's own DC recording made in the PORTAL is followed in
 * the portal, so the report job sends no "Step 4/5" and no "Step 5/5" to her WhatsApp. What she
 * comes back for still arrives there: the report image and the voice note. Her WhatsApp
 * recording keeps both step lines, exactly as before. Observations are out of scope.
 *
 * Harness: meta-bill-nc2-report-caption.test.js (generateReport executed for real; network,
 * LLM and TTS mocked), with the session's audio_url as the dial.
 */
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendImage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendAudioFromUrl: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
const mockWA = require('../../bot/shared/services/whatsapp.service');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({
  TEMP_DIR: require('path').join(require('os').tmpdir(), 'rumi-test-bd-s7c31y'),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadReportImage: jest.fn().mockResolvedValue('https://r2.example/report.png'),
  uploadReportPDF: jest.fn().mockResolvedValue('https://r2.example/report.pdf'),
  uploadVoiceDebrief: jest.fn().mockResolvedValue('https://r2.example/voice.ogg'),
}));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  inferLessonTopic: jest.fn().mockResolvedValue('N/A'),
  inferLessonSubject: jest.fn().mockResolvedValue('N/A'),
  summarizeForVoiceDebrief: jest.fn().mockResolvedValue('A short spoken debrief.'),
  enhanceAnalysisWithReflections: jest.fn(),
}));
jest.mock('../../bot/shared/services/tts', () => ({
  synthesize: jest.fn().mockResolvedValue({ audio: Buffer.from('OGG'), durationSec: 30 }),
}));
jest.mock('../../bot/shared/services/coaching/coaching-card/commitment-card.service', () => ({
  generateCommitmentCard: jest.fn().mockResolvedValue({ _source: 'llm', commitment: 'c', action: 'a', language: 'en' }),
}));
jest.mock('../../bot/shared/services/coaching/coaching-helpers.service', () => ({
  determineOutputLanguage: jest.fn().mockResolvedValue('en'),
  calculateTotalCost: jest.fn(() => 0),
  recordQualityMetrics: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: jest.fn().mockResolvedValue({}),
  markAsCompleted: jest.fn().mockResolvedValue({}),
  markAsFailed: jest.fn().mockResolvedValue({}),
  getSession: jest.fn().mockResolvedValue({ id: 'sess-s7c31y' }),
}));
jest.mock('../../bot/shared/services/coaching/coaching-feedback.service', () => ({
  sendFeedbackPrompt: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/feature-linker.service', () => ({ suggestNext: jest.fn().mockResolvedValue(true) }));

const mockRedisStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async (k, v) => { if (mockRedisStore.has(k)) return false; mockRedisStore.set(k, v); return true; }),
  delete: jest.fn(async (k) => { mockRedisStore.delete(k); return true; }),
  get: jest.fn(async (k) => (mockRedisStore.has(k) ? mockRedisStore.get(k) : null)),
  set: jest.fn(async (k, v) => { mockRedisStore.set(k, v); return true; }),
}));

const PORTAL_AUDIO = 'https://acct.r2.cloudflarestorage.com/digital-coach-audio/classroom_audio/user-s7/2026-10/portal_abc-123.webm';
const WA_AUDIO = 'https://acct.r2.cloudflarestorage.com/digital-coach-audio/classroom_audio/user-s7/2026-10/wamid_abc.ogg';
let mockAudioUrl = PORTAL_AUDIO;
jest.mock('../../bot/shared/config/supabase', () => {
  const makeChain = (table) => {
    const chain = {};
    ['select', 'eq', 'not', 'neq', 'order', 'limit', 'in', 'update', 'insert'].forEach((m) => { chain[m] = jest.fn(() => chain); });
    const row = () => (table === 'users'
      ? { preferred_language: 'en' }
      : {
        id: 'sess-s7c31y', user_id: 'user-s7', status: 'analysis_complete', created_at: '2026-10-19T00:00:00Z',
        observation_type: null, audio_url: mockAudioUrl,
        conversation_state: { questions_answered: 1, questions_at_completion: 1 },
        analysis_data: { framework: 'fico' }, transcript_language: 'ur', transcript_text: 'x',
        users: { phone_number: '923016669553', name: 'Naheeda', region: 'ICT', preferred_language: 'en' },
      });
    chain.single = jest.fn(async () => ({ data: row(), error: null }));
    chain.maybeSingle = jest.fn(async () => ({ data: row(), error: null }));
    chain.then = (resolve) => resolve({ data: null, error: null });
    return chain;
  };
  return { from: jest.fn((t) => makeChain(t)) };
});

const ReportGeneratorService = require('../../bot/shared/services/coaching/report-generator.service');
const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');

const SID = 'sess-s7c31y';
const FROM = '923016669553';
const BASE = '📋 Your coaching report · Grouped words · 19 Oct';
const STEP4 = getCoachingMessage('step4_generatingReport', 'en');
const STEP5 = getCoachingMessage('step5_voiceDebrief', 'en');

const texts = () => mockWA.sendMessage.mock.calls.map((c) => c[1]);
const captions = () => mockWA.sendImage.mock.calls.map((c) => c[2]);

beforeEach(() => {
  Object.values(mockWA).forEach((fn) => fn.mockClear());
  mockWA.sendMessage.mockResolvedValue(true);
  mockWA.sendImage.mockResolvedValue(true);
  mockRedisStore.clear();
  jest.spyOn(ReportGeneratorService, 'enhanceAnalysisWithReflections').mockResolvedValue({ framework: 'fico', topic: 'Grouped words' });
  jest.spyOn(ReportGeneratorService, 'generatePDFReport').mockResolvedValue({ png: Buffer.from('PNG'), caption: BASE });
  jest.spyOn(ReportGeneratorService, 'scheduleTranscriptQuiz').mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

describe('a teacher\'s PORTAL recording: no step messages, the report still arrives', () => {
  beforeEach(() => { mockAudioUrl = PORTAL_AUDIO; });

  test('no Step 4/5 text', async () => {
    await ReportGeneratorService.generateReport(SID, { from: FROM });
    expect(texts()).not.toContain(STEP4);
  });

  test('no Step 5/5 — neither on the image caption nor as its own text', async () => {
    await ReportGeneratorService.generateReport(SID, { from: FROM });
    expect(captions()[0]).toBe(BASE);
    expect(texts()).not.toContain(STEP5);
  });

  test('the report image and the voice note are still sent to WhatsApp', async () => {
    await ReportGeneratorService.generateReport(SID, { from: FROM });
    expect(mockWA.sendImage).toHaveBeenCalledTimes(1);
    expect(mockWA.sendAudioFromUrl).toHaveBeenCalledTimes(1);
  });
});

describe('CONTROL — a teacher\'s WhatsApp recording keeps Step 4/5 and Step 5/5', () => {
  beforeEach(() => { mockAudioUrl = WA_AUDIO; });

  // Staging/production send Step 5/5 as its own text (the caption ride-along, Meta bill cut
  // NC2, is sandbox-only for now).
  test('Step 4/5 and Step 5/5 texts', async () => {
    await ReportGeneratorService.generateReport(SID, { from: FROM });
    expect(texts()).toContain(STEP4);
    expect(texts()).toContain(STEP5);
    expect(mockWA.sendAudioFromUrl).toHaveBeenCalledTimes(1);
  });
});
