/**
 * DC feedback (2026-09-23, bd-azzhu) — "Was this coaching report useful to you?" goes out
 * RIGHT AFTER the voice debrief, before the session-complete + commitment question.
 *
 * It used to be scheduled 90 s after completeSession(), so it landed AFTER the
 * "✅ your coaching session is complete" line — a survey about a session the bot had
 * already declared over. New order:
 *
 *   report → voice debrief → survey (👍/👎) → session-complete + commit prompt → quiz
 *
 * Moving it earlier opens one real risk, pinned here too: the teacher can now tap the
 * survey BEFORE completeSession() writes the session's coaching_quality_metrics row. The
 * survey creates the row on demand, so recordQualityMetrics must UPDATE that row, never
 * insert a second one — the table has no unique key on coaching_session_id.
 *
 * The survey service and the ux catalog are deliberately NOT mocked: the assertions read
 * the real prompt, so a wrong-language or wrong-key send goes red.
 */

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendImage: jest.fn().mockResolvedValue(true),
  sendImageFromUrl: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
const mockWA = require('../../bot/shared/services/whatsapp.service');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ TEMP_DIR: '/tmp/rumi-test-azzhu' }));

jest.mock('../../bot/shared/storage/r2', () => ({
  uploadReportImage: jest.fn().mockResolvedValue('https://r2.example/report.png'),
  uploadReportPDF: jest.fn().mockResolvedValue('https://r2.example/report.pdf'),
  uploadImageWithRetry: jest.fn().mockResolvedValue('https://r2.example/card.png'),
  uploadVoiceDebrief: jest.fn().mockResolvedValue('https://r2.example/voice.mp3'),
}));

jest.mock('../../bot/shared/services/coaching/coaching-card/commitment-card.service', () => ({
  generateCommitmentCard: jest.fn().mockResolvedValue({
    _source: 'llm', commitment: 'Ask one open question', action: 'Try a think-pair-share', language: 'en',
  }),
}));

jest.mock('../../bot/shared/services/coaching/coaching-helpers.service', () => ({
  determineOutputLanguage: jest.fn().mockResolvedValue('en'),
  calculateTotalCost: jest.fn(() => 0),
  recordQualityMetrics: jest.fn().mockResolvedValue(true),
}));
const mockHelpers = require('../../bot/shared/services/coaching/coaching-helpers.service');

jest.mock('../../bot/shared/services/feature-linker.service', () => ({
  suggestNext: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  set: jest.fn(), get: jest.fn(), del: jest.fn(),
}));

let mockPreferred = 'en';
const mockSessionRow = {
  id: 'sess-azzhu',
  user_id: 'user-azzhu',
  status: 'analysis_complete',
  created_at: '2026-09-23T00:00:00Z',
  conversation_state: { questions_answered: 3 },
  analysis_data: { framework: 'oecd' },
  transcript_language: 'ur',
  users: { phone_number: '923016669553', name: 'Mehwish', region: 'ICT', preferred_language: 'ur' },
};
jest.mock('../../bot/shared/config/supabase', () => {
  const makeChain = (table) => {
    const chain = {};
    ['select', 'eq', 'not', 'neq', 'order', 'limit', 'in'].forEach((m) => { chain[m] = jest.fn(() => chain); });
    const row = () => (table === 'users' ? { preferred_language: mockPreferred } : mockSessionRow);
    chain.single = jest.fn(async () => ({ data: row(), error: null }));
    chain.maybeSingle = jest.fn(async () => ({ data: row(), error: null }));
    chain.update = jest.fn(() => chain);
    chain.insert = jest.fn(() => chain);
    chain.then = (resolve) => resolve({ data: null, error: null });
    return chain;
  };
  return { from: jest.fn((t) => makeChain(t)) };
});

const ReportGeneratorService = require('../../bot/shared/services/coaching/report-generator.service');
const CoachingFeedbackService = require('../../bot/shared/services/coaching/coaching-feedback.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const { COACHING_CARD_COPY } = require('../../bot/shared/config/coaching-card.config');

const surveyCalls = (lang) => mockWA.sendInteractiveButtons.mock.calls
  .map((c, i) => ({ body: c[1].body, order: mockWA.sendInteractiveButtons.mock.invocationCallOrder[i] }))
  .filter((c) => c.body === resolveUx('coachingSurveyAsk', { language: lang }));
const commitCalls = (lang) => mockWA.sendInteractiveButtons.mock.calls
  .map((c, i) => ({ body: c[1].body, order: mockWA.sendInteractiveButtons.mock.invocationCallOrder[i] }))
  .filter((c) => c.body.endsWith(COACHING_CARD_COPY[lang].commitPrompt));

describe('DC (bd-azzhu) — the coaching survey follows the voice debrief', () => {
  let voiceSpy; let scheduleSpy;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    Object.values(mockWA).forEach((fn) => fn.mockClear());
    mockPreferred = 'en';
    mockHelpers.determineOutputLanguage.mockResolvedValue('en');
    jest.spyOn(ReportGeneratorService, 'enhanceAnalysisWithReflections').mockResolvedValue({ framework: 'oecd', topic: 'Fractions' });
    jest.spyOn(ReportGeneratorService, 'generatePDFReport').mockResolvedValue({ png: Buffer.from('PNG'), caption: 'cap' });
    jest.spyOn(ReportGeneratorService, 'sendHeroImageReport').mockResolvedValue(true);
    voiceSpy = jest.spyOn(ReportGeneratorService, 'generateAndSendVoiceDebrief').mockResolvedValue(true);
    jest.spyOn(ReportGeneratorService, 'scheduleTranscriptQuiz').mockResolvedValue(false);
    scheduleSpy = jest.spyOn(CoachingFeedbackService, 'scheduleFeedbackPrompt');
  });

  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  it.each(['en', 'ur'])('[%s] sends the survey after the voice debrief and before the commit prompt', async (lang) => {
    mockPreferred = lang;
    mockHelpers.determineOutputLanguage.mockResolvedValue(lang);
    await ReportGeneratorService.generateReport('sess-azzhu', { from: '923016669553' });

    const survey = surveyCalls(lang);
    const commit = commitCalls(lang);
    expect(survey).toHaveLength(1);       // present — before any ordering claim
    expect(commit).toHaveLength(1);
    expect(voiceSpy).toHaveBeenCalled();
    expect(survey[0].order).toBeGreaterThan(voiceSpy.mock.invocationCallOrder[0]);
    expect(survey[0].order).toBeLessThan(commit[0].order);
  });

  it('carries the session id on its buttons, so the tap lands on THIS session', async () => {
    await ReportGeneratorService.generateReport('sess-azzhu', { from: '923016669553' });
    const call = mockWA.sendInteractiveButtons.mock.calls
      .find((c) => c[1].body === resolveUx('coachingSurveyAsk', { language: 'en' }));
    expect(call[1].buttons.map((b) => b.id)).toEqual(['coaching_fb_yes_sess-azzhu', 'coaching_fb_no_sess-azzhu']);
  });

  it('is sent exactly once — no delayed copy is still scheduled behind it', async () => {
    await ReportGeneratorService.generateReport('sess-azzhu', { from: '923016669553' });
    expect(scheduleSpy).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();                 // the old 90 s timer would fire here
    await Promise.resolve();
    expect(surveyCalls('en')).toHaveLength(1);
  });

  it('a failed survey send never stops the commitment question', async () => {
    const real = mockWA.sendInteractiveButtons.getMockImplementation();
    mockWA.sendInteractiveButtons.mockImplementation(async (to, p) => {
      if (p.body === resolveUx('coachingSurveyAsk', { language: 'en' })) throw new Error('graph 500');
      return real ? real(to, p) : true;
    });
    await ReportGeneratorService.generateReport('sess-azzhu', { from: '923016669553' });
    expect(commitCalls('en')).toHaveLength(1);
  });
});

// ─── The one-row rule: an early tap must not produce a second metrics row ─────────────
describe('DC (bd-azzhu) — recordQualityMetrics never duplicates the survey\'s row', () => {
  const load = (existingRow) => {
    jest.resetModules();
    const writes = [];
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: (table) => {
        const b = {};
        ['select', 'eq', 'order', 'limit'].forEach((m) => { b[m] = () => b; });
        b.maybeSingle = async () => ({ data: existingRow, error: null });
        b.insert = (payload) => { writes.push({ table, op: 'insert', payload }); return Promise.resolve({ error: null }); };
        b.update = (payload) => { writes.push({ table, op: 'update', payload }); return b; };
        b.then = (resolve) => resolve({ data: null, error: null });
        return b;
      },
    }));
    const Helpers = jest.requireActual('../../bot/shared/services/coaching/coaching-helpers.service');
    return { Helpers, writes };
  };
  const session = {
    id: 'sess-azzhu', created_at: '2026-09-23T00:00:00Z', completed_at: '2026-09-23T00:05:00Z',
    transcription_started_at: '2026-09-23T00:00:00Z', transcription_completed_at: '2026-09-23T00:01:00Z',
    analysis_started_at: '2026-09-23T00:01:00Z', analysis_completed_at: '2026-09-23T00:03:00Z',
    total_cost: 0.1, diarization_confidence: 0.9,
  };

  afterEach(() => jest.resetModules());

  it('the survey tap came first → UPDATES that row and keeps her rating', async () => {
    const { Helpers, writes } = load({ id: 'm-1' });
    await Helpers.recordQualityMetrics(session);
    const metrics = writes.filter((w) => w.table === 'coaching_quality_metrics');
    expect(metrics.map((w) => w.op)).toEqual(['update']);
    expect(metrics[0].payload).not.toHaveProperty('user_satisfaction_rating');
    expect(metrics[0].payload).toMatchObject({ processing_time_seconds: 300, session_cost: 0.1 });
  });

  it('no row yet → INSERTS exactly one', async () => {
    const { Helpers, writes } = load(null);
    await Helpers.recordQualityMetrics(session);
    const metrics = writes.filter((w) => w.table === 'coaching_quality_metrics');
    expect(metrics.map((w) => w.op)).toEqual(['insert']);
    expect(metrics[0].payload).toMatchObject({ coaching_session_id: 'sess-azzhu' });
  });
});
