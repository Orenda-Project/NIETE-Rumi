'use strict';
/**
 * The voice note must speak the SAME fidelity figure the report shows.
 *
 * Two surfaces read two different fields for one concept, and only the report
 * was migrated to the measured engine. The voice call was handed
 * `fidelity_analysis.score` — a separate gpt-4o-mini estimate of whole-plan
 * adherence — while Section B on the card comes from the executed÷prescribed
 * measurement. Over eight days: 2,307 sessions had both a measured score and a
 * delivered voice note; on 1,466 of them (63.5%, 858 teachers) the voice was fed
 * 70 or more while the measurement was under 50, and on 173 the measurement was
 * exactly 0. Median legacy 85.0 against median measured 37.5 — a mean gap of
 * +44.5 points. The legacy field is 85 on 84.5% of sessions, so it is very close
 * to a constant.
 *
 * Two reporters reproduce on their own stored rows: a teacher told "you followed
 * around 85%" while the card read 15/40, and another at 14/40 against the same
 * 85. Both halves of each complaint are the two fields on one session.
 *
 * The fix: the voice is fed the measured percentage, its band, and whether the
 * grader flagged the linked plan as the wrong lesson — and the prompt may quote a
 * figure ONLY when one is supplied. The band is what humans should hear
 * (single-call, temperature 0, so the raw percentage carries real wobble), so it
 * is supplied alongside. The legacy estimate is no longer produced for this
 * framework at all.
 *
 * And the script is persisted, because until now nothing recorded what a teacher
 * was actually told: the old finding could only prove "the wrong number was
 * supplied to the model", never "the wrong number was spoken aloud".
 *
 * Mocked at the network boundary only.
 */

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendAudioFromUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadVoiceDebrief: jest.fn().mockResolvedValue('https://r2.example/voice.mp3'),
  uploadReportImage: jest.fn(),
  uploadReportPDF: jest.fn(),
}));
jest.mock('../../bot/shared/services/audio.service', () => ({
  generateSpeechForLanguage: jest.fn().mockResolvedValue(Buffer.alloc(32000)),
}));
jest.mock('../../bot/shared/services/coaching/coaching-helpers.service', () => ({
  determineOutputLanguage: jest.fn().mockResolvedValue('en'),
}));
jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {
    update: jest.fn((patch) => { global.__UPDATES.push(patch); return chain; }),
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    single: jest.fn(() => Promise.resolve({ data: { analysis_data: global.__STORED }, error: null })),
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return { from: jest.fn(() => chain) };
});

const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
const ReportGenerator = require('../../bot/shared/services/coaching/report-generator.service');
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');

const create = jest.fn().mockResolvedValue({
  choices: [{ message: { content: 'Assalam-o-alaikum. You opened clearly today.' } }],
  usage: { prompt_tokens: 10, completion_tokens: 10 },
});
GPT5MiniService.openai = { chat: { completions: { create } } };

const C = fico.getScoringConstants();
const DOMS = C.domains;
const rows = (prefix, n, score) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, score, evidence: 'x' }));

// The shape the reporters' own sessions carry: a measured Section B alongside the
// stale whole-plan estimate the voice used to read.
function analysisWith(lpFidelity) {
  const domains = {};
  for (const [key, def] of Object.entries(DOMS)) {
    domains[key] = { indicators: rows(def.key, def.indicatorCount, 1) };
  }
  const a = fico.computeScores({
    framework: 'fico',
    has_lesson_plan: true,
    fidelity_analysis: { score: 85, max_score: 100, overall_commentary: 'Followed closely.' },
    lp_fidelity: lpFidelity,
    domains,
  });
  return fico.applyLpFidelity(a, lpFidelity);
}

const session = {
  user_id: 'u1', session_id: 's1', transcript_language: 'en',
  conversation_state: {}, users: { preferred_language: 'en' },
};

describe('the voice note reads the measured fidelity', () => {
  let spy;
  beforeEach(() => {
    create.mockClear();
    global.__UPDATES = [];
    global.__STORED = {};
    spy = jest.spyOn(GPT5MiniService, 'summarizeForVoiceDebrief');
  });
  afterEach(() => spy.mockRestore());

  const arg = () => spy.mock.calls[0][0];
  const prompt = () => create.mock.calls[0][0].messages[0].content;

  test('THE BUG: the measured 0% is what reaches the model, not the stale 85', async () => {
    const a = analysisWith({ status: 'ok', fidelity_pct: 0, band: 'low' });
    await ReportGenerator.generateAndSendVoiceDebrief(session, '923000000000', 'cs1', a);
    expect(arg().fidelityScore).toBe(0);
    expect(arg().fidelityBand).toBe('low');
  });

  test('the reporters\' own case: 37.5% measured against 15 on the card', async () => {
    const a = analysisWith({ status: 'ok', fidelity_pct: 37.5, band: 'low' });
    await ReportGenerator.generateAndSendVoiceDebrief(session, '923000000000', 'cs1', a);
    expect(arg().fidelityScore).toBe(37.5);
    expect(prompt()).not.toMatch(/\b85\b/);
  });

  test('the band travels, because a single temperature-0 call is what produced the number', async () => {
    const a = analysisWith({ status: 'ok', fidelity_pct: 92, band: 'high' });
    await ReportGenerator.generateAndSendVoiceDebrief(session, '923000000000', 'cs1', a);
    expect(arg().fidelityBand).toBe('high');
    expect(prompt()).toMatch(/high/i);
  });

  test('a plan the grader judged to be the wrong lesson is flagged, not read as a bad score', async () => {
    const a = analysisWith({ status: 'ok', fidelity_pct: 4, band: 'low', moderators: { note: 'lesson_mismatch' } });
    await ReportGenerator.generateAndSendVoiceDebrief(session, '923000000000', 'cs1', a);
    expect(arg().lessonMismatch).toBe(true);
    expect(prompt()).toMatch(/different lesson|not the lesson/i);
  });

  test('not measured: no figure supplied, and the prompt forbids inventing one', async () => {
    const a = analysisWith({ status: 'lp_absent' });
    await ReportGenerator.generateAndSendVoiceDebrief(session, '923000000000', 'cs1', a);
    expect(arg().fidelityScore).toBeNull();
    expect(arg().fidelityBand).toBeNull();
    expect(prompt()).toMatch(/do not state any lesson-plan percentage/i);
  });

  test('the prompt only invites a figure when one was supplied', async () => {
    const withNum = analysisWith({ status: 'ok', fidelity_pct: 60, band: 'partial' });
    await ReportGenerator.generateAndSendVoiceDebrief(session, '923000000000', 'cs1', withNum);
    expect(prompt()).toMatch(/60/);
    expect(prompt()).not.toMatch(/use the fidelityScore if provided/i);
  });

  test('what she was told is recorded, so this is measurable next time', async () => {
    const a = analysisWith({ status: 'ok', fidelity_pct: 60, band: 'partial' });
    await ReportGenerator.generateAndSendVoiceDebrief(session, '923000000000', 'cs1', a);
    const patch = global.__UPDATES.find((p) => p && p.analysis_data);
    expect(patch).toBeDefined();
    expect(patch.analysis_data.voice_debrief_script).toBe('Assalam-o-alaikum. You opened clearly today.');
    // the column write is untouched — no migration, the script rides in the JSONB
    const cols = global.__UPDATES.find((p) => p && p.voice_debrief_url);
    expect(cols.voice_debrief_language).toBe('en');
  });

  test('persisting the script cannot drop what the worker wrote meanwhile', async () => {
    global.__STORED = { observer_debrief: { notes: 'from the worker' } };
    const a = analysisWith({ status: 'ok', fidelity_pct: 60, band: 'partial' });
    await ReportGenerator.generateAndSendVoiceDebrief(session, '923000000000', 'cs1', a);
    const patch = global.__UPDATES.find((p) => p && p.analysis_data);
    expect(patch.analysis_data.observer_debrief).toEqual({ notes: 'from the worker' });
    expect(patch.analysis_data.voice_debrief_script).toBeTruthy();
  });
});

describe('the stale whole-plan estimate is no longer produced for this framework', () => {
  test('the fidelity fallback is skipped when the framework measures Section B itself', async () => {
    const fallback = jest.spyOn(GPT5MiniService, '_generateFidelityAssessment');
    const parse = jest.spyOn(GPT5MiniService, '_safeJsonParse').mockReturnValue({
      framework: 'fico',
      domains: Object.fromEntries(Object.entries(DOMS).map(([k, d]) => [k, { indicators: rows(d.key, d.indicatorCount, 1) }])),
    });
    create.mockClear();
    try {
      const out = await GPT5MiniService.analyzePedagogy('transcript', { language: 'en' }, { subject: 'Urdu', steps: [] }, fico);
      expect(fallback).not.toHaveBeenCalled();
      expect(out.analysis.fidelity_analysis).toBeUndefined();
    } finally {
      fallback.mockRestore();
      parse.mockRestore();
    }
  });
});
