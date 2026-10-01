'use strict';
/**
 * Meta bill cut — the report delivery, executed for real (generateReport →
 * sendHeroImageReport → generateAndSendVoiceDebrief), with only the network and
 * the LLM/TTS edges mocked.
 *
 *   NC2 (N2-C03 / N1-07)  "🔄 Step 5/5: Creating your personalized voice debrief..."
 *                         rides on the hero image caption instead of its own text.
 *                         Before: image + text + audio. After: image (caption carries
 *                         the same line) + audio.
 *   NC5 (N2-U02)          the sweeper's English "you didn't get back… generating your
 *                         report now" text becomes one line in the same caption.
 *   NC5 (N2-C05)          a photo-gate recovery whose notice already said "putting your
 *                         report together" does not also get "Step 4/5".
 *   NC5 (N1-13)           each report piece (hero image, voice debrief, commit prompt)
 *                         goes out once per session even when the job runs twice.
 *
 * Fallbacks pinned too: a caption that would pass 1,024 code points keeps the old
 * separate Step 5/5 text; a retry (no voice note follows) gets no Step 5 line; a
 * hero send that fails gives its claim back so the retry can deliver it.
 */
const os = require('os');
const path = require('path');

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
  TEMP_DIR: require('path').join(require('os').tmpdir(), 'rumi-test-meta-bill-nc2'),
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
const mockHelpers = require('../../bot/shared/services/coaching/coaching-helpers.service');
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: jest.fn().mockResolvedValue({}),
  markAsCompleted: jest.fn().mockResolvedValue({}),
  markAsFailed: jest.fn().mockResolvedValue({}),
  getSession: jest.fn().mockResolvedValue({ id: 'sess-nc2' }),
}));
jest.mock('../../bot/shared/services/coaching/coaching-feedback.service', () => ({
  sendFeedbackPrompt: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/feature-linker.service', () => ({ suggestNext: jest.fn().mockResolvedValue(true) }));

// An in-memory Redis: the per-piece claims must persist across two runs of the job.
const mockRedisStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async (k, v) => { if (mockRedisStore.has(k)) return false; mockRedisStore.set(k, v); return true; }),
  delete: jest.fn(async (k) => { mockRedisStore.delete(k); return true; }),
  get: jest.fn(async (k) => (mockRedisStore.has(k) ? mockRedisStore.get(k) : null)),
  set: jest.fn(async (k, v) => { mockRedisStore.set(k, v); return true; }),
}));

let mockLang = 'en';
let mockQuestionsAtCompletion = 0;
jest.mock('../../bot/shared/config/supabase', () => {
  const makeChain = (table) => {
    const chain = {};
    ['select', 'eq', 'not', 'neq', 'order', 'limit', 'in', 'update', 'insert'].forEach((m) => { chain[m] = jest.fn(() => chain); });
    const row = () => (table === 'users'
      ? { preferred_language: mockLang }
      : {
        id: 'sess-nc2', user_id: 'user-nc2', status: 'analysis_complete', created_at: '2026-09-23T00:00:00Z',
        conversation_state: { questions_answered: mockQuestionsAtCompletion, questions_at_completion: mockQuestionsAtCompletion },
        analysis_data: { framework: 'fico' }, transcript_language: 'ur', transcript_text: 'x',
        users: { phone_number: '923016669553', name: 'Mehwish', region: 'ICT', preferred_language: mockLang },
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

const SID = 'sess-nc2';
const FROM = '923016669553';
const BASE = '📋 Your coaching report · Fractions · 23 Sep';

const texts = () => mockWA.sendMessage.mock.calls.map((c) => c[1]);
const captions = () => mockWA.sendImage.mock.calls.map((c) => c[2]);
const order = (fn, i = 0) => fn.mock.invocationCallOrder[i];

beforeEach(() => {
  Object.values(mockWA).forEach((fn) => fn.mockClear());
  mockWA.sendImage.mockResolvedValue(true);
  mockRedisStore.clear();
  mockLang = 'en';
  mockQuestionsAtCompletion = 0;
  mockHelpers.determineOutputLanguage.mockResolvedValue('en');
  jest.spyOn(ReportGeneratorService, 'enhanceAnalysisWithReflections').mockResolvedValue({ framework: 'fico', topic: 'Fractions' });
  jest.spyOn(ReportGeneratorService, 'generatePDFReport').mockResolvedValue({ png: Buffer.from('PNG'), caption: BASE });
  jest.spyOn(ReportGeneratorService, 'scheduleTranscriptQuiz').mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

describe('NC2 — Step 5/5 rides on the report image caption', () => {
  test.each(['en', 'ur'])('[%s] image (caption = report line + Step 5/5) → audio; no separate Step 5/5 text', async (lang) => {
    mockLang = lang;
    mockHelpers.determineOutputLanguage.mockResolvedValue(lang);
    await ReportGeneratorService.generateReport(SID, { from: FROM });

    const step5 = getCoachingMessage('step5_voiceDebrief', lang);
    expect(mockWA.sendImage).toHaveBeenCalledTimes(1);
    expect(captions()[0]).toBe(`${BASE}\n${step5}`);
    expect(texts()).not.toContain(step5);
    expect(mockWA.sendAudioFromUrl).toHaveBeenCalledTimes(1);
    expect(order(mockWA.sendAudioFromUrl)).toBeGreaterThan(order(mockWA.sendImage));
  });

  test('a retry (no voice note follows) gets the plain caption and no Step 5/5 anywhere', async () => {
    await ReportGeneratorService.generateReport(SID, { from: FROM, attempt: 2 });
    const step5 = getCoachingMessage('step5_voiceDebrief', 'en');
    expect(captions()[0]).toBe(BASE);
    expect(texts()).not.toContain(step5);
    expect(mockWA.sendAudioFromUrl).not.toHaveBeenCalled();
  });

  test('FALLBACK — a caption that would pass 1,024 code points keeps the separate Step 5/5 text', async () => {
    const long = `📋 ${'x'.repeat(1010)}`;
    ReportGeneratorService.generatePDFReport.mockResolvedValue({ png: Buffer.from('PNG'), caption: long });
    await ReportGeneratorService.generateReport(SID, { from: FROM });
    const step5 = getCoachingMessage('step5_voiceDebrief', 'en');
    expect(captions()[0]).toBe(long);
    expect(texts()).toContain(step5);
    expect(mockWA.sendAudioFromUrl).toHaveBeenCalledTimes(1);
  });
});

describe('NC5 (N2-U02) — the auto-complete notice is a caption line, not its own text', () => {
  test.each([
    [0, 'reportCaption_autoCompletedAudioOnly'],
    [1, 'reportCaption_autoCompletedWithReflections'],
  ])('%i reflections answered → the caption carries %s', async (answered, key) => {
    mockQuestionsAtCompletion = answered;
    await ReportGeneratorService.generateReport(SID, { from: FROM, partial: true, autoCompleted: true });
    const line = getCoachingMessage(key, 'en');
    expect(captions()[0]).toContain(line);
    expect(captions()[0].startsWith(BASE)).toBe(true);
    expect(captions()[0].endsWith(getCoachingMessage('step5_voiceDebrief', 'en'))).toBe(true);
  });

  test('a live (not auto-completed) report carries no auto-complete line', async () => {
    await ReportGeneratorService.generateReport(SID, { from: FROM });
    expect(captions()[0]).not.toContain(getCoachingMessage('reportCaption_autoCompletedAudioOnly', 'en'));
  });

  test.each(['en', 'ur'])('[%s] both lines exist in both languages and the Urdu is Urdu', (lang) => {
    for (const key of ['reportCaption_autoCompletedAudioOnly', 'reportCaption_autoCompletedWithReflections']) {
      const s = getCoachingMessage(key, lang);
      expect(s.trim().length).toBeGreaterThan(0);
      if (lang === 'ur') expect(/[؀-ۿ]/.test(s)).toBe(true);
    }
  });
});

describe('NC5 (N2-C05) — the recovery notice already said it: no Step 4/5', () => {
  test('progressNoticeSent → no Step 4/5 text', async () => {
    await ReportGeneratorService.generateReport(SID, { from: FROM, partial: true, suppressPartialBanner: true, progressNoticeSent: true });
    expect(texts()).not.toContain(getCoachingMessage('step4_generatingReport', 'en'));
    expect(mockWA.sendImage).toHaveBeenCalledTimes(1);
  });

  test('CONTROL — a live report still says Step 4/5', async () => {
    await ReportGeneratorService.generateReport(SID, { from: FROM });
    expect(texts()).toContain(getCoachingMessage('step4_generatingReport', 'en'));
  });
});

describe('NC5 (N1-13) — each report piece goes out once per session', () => {
  test('the job running twice sends the image, the voice note and the commit prompt ONCE', async () => {
    await ReportGeneratorService.generateReport(SID, { from: FROM });
    await ReportGeneratorService.generateReport(SID, { from: FROM });
    expect(mockWA.sendImage).toHaveBeenCalledTimes(1);
    expect(mockWA.sendAudioFromUrl).toHaveBeenCalledTimes(1);
    const commits = mockWA.sendInteractiveButtons.mock.calls.filter((c) => (c[1].buttons || []).some((b) => b.id === `card_yes_${SID}`));
    expect(commits).toHaveLength(1);
    // …and the duplicate run does not fall back to the standalone "session complete" line.
    expect(texts()).not.toContain(getCoachingMessage('sessionComplete', 'en'));
    // …nor re-announce the voice note it is not sending.
    expect(texts()).not.toContain(getCoachingMessage('step5_voiceDebrief', 'en'));
  });

  test('a hero send that FAILS gives its claim back, so the retry can deliver it', async () => {
    mockWA.sendImage.mockResolvedValueOnce(false);
    await expect(ReportGeneratorService.generateReport(SID, { from: FROM })).rejects.toThrow();
    await ReportGeneratorService.generateReport(SID, { from: FROM, attempt: 2 });
    expect(mockWA.sendImage).toHaveBeenCalledTimes(2);
  });
});

afterAll(() => {
  try { require('fs').rmSync(path.join(os.tmpdir(), 'rumi-test-meta-bill-nc2'), { recursive: true, force: true }); } catch (_) { /* best effort */ }
});
