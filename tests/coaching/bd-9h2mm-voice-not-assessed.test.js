'use strict';
/**
 * The voice note must not speak a lesson-plan fidelity figure for a section that
 * was never assessed.
 *
 * Two things had to change together, and only one of them is a flag. The call
 * site passes `hasLessonPlan` and a `fidelityScore`, and the prompt tells the
 * model to "explicitly reference how closely the teacher followed their plan" —
 * so suppressing those two scalars is necessary. It is not sufficient: the voice
 * prompt then JSON-dumps the WHOLE analysis object, so the legacy Section B
 * proxy score and its ten indicators are still sitting in the prompt for the
 * model to read a number out of. The analysis handed to the voice call is
 * PROJECTED — Section B replaced by the fact that it was not assessed.
 *
 * Mocked at the network boundary only: the chat completion, TTS, R2, Supabase
 * and WhatsApp. The real report-generator and the real prompt builder run, and
 * the assertions read the prompt that was actually sent.
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
  const chain = { update: jest.fn(() => chain), eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
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

const rows = (prefix, n, score) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, score, evidence: 'x' }));

function fullAnalysis() {
  return fico.computeScores({
    framework: 'fico',
    has_lesson_plan: true,
    fidelity_analysis: { score: 85, max_score: 100, overall_commentary: 'Followed closely.' },
    domains: {
      lesson_plan_fidelity: { indicators: rows('B', 10, 3) },
      high_leverage_practices: { indicators: rows('C', 12, 3) },
      student_engagement: { indicators: rows('D', 7, 3) },
      teacher_subject_knowledge: { indicators: rows('F', 8, 2) },
    },
  });
}

const session = {
  user_id: 'u1', session_id: 's1', transcript_language: 'en',
  conversation_state: {}, users: { preferred_language: 'en' },
};

describe('the voice note on a session with no measured fidelity', () => {
  let spy;
  beforeEach(() => {
    create.mockClear();
    spy = jest.spyOn(GPT5MiniService, 'summarizeForVoiceDebrief');
  });
  afterEach(() => spy.mockRestore());

  const notAssessed = () => fico.applyLpFidelity(fullAnalysis(), { status: 'lp_absent' });
  const arg = () => spy.mock.calls[0][0];
  const prompt = () => create.mock.calls[0][0].messages[0].content;

  test('THE BUG: the model is not handed a lesson-plan score to read out', async () => {
    await ReportGenerator.generateAndSendVoiceDebrief(session, '923000000000', 'cs1', notAssessed());
    expect(arg().fidelityScore).toBeNull();
    expect(arg().hasLessonPlan).toBe(false);
    expect(arg().sectionBNotAssessed).toBe(true);
  });

  test('and no Section B number survives anywhere in the payload it dumps', async () => {
    await ReportGenerator.generateAndSendVoiceDebrief(session, '923000000000', 'cs1', notAssessed());
    const b = arg().analysis.domains.lesson_plan_fidelity;
    expect(b.assessed).toBe(false);
    expect(b.domain_score).toBeUndefined();
    expect(b.domain_max).toBeUndefined();
    expect(b.indicators).toBeUndefined();
    // the separate legacy estimate that sat at 85 on 84.5% of sessions
    expect(arg().analysis.fidelity_analysis).toBeUndefined();
    // and nothing in the sent prompt says "85"
    expect(prompt()).not.toMatch(/\b85\b/);
  });

  test('the sent prompt forbids stating a fidelity figure', async () => {
    await ReportGenerator.generateAndSendVoiceDebrief(session, '923000000000', 'cs1', notAssessed());
    expect(prompt()).toMatch(/do not state any lesson-plan percentage/i);
  });

  test('the caller is not mutated — the stored analysis keeps its own shape', async () => {
    const a = notAssessed();
    await ReportGenerator.generateAndSendVoiceDebrief(session, '923000000000', 'cs1', a);
    expect(a.domains.lesson_plan_fidelity.domain_max).toBe(40);
    expect(a.fidelity_analysis.score).toBe(85);
  });

  test('a MEASURED session still gets its section, and the ban is not applied', async () => {
    const a = fullAnalysis();
    fico.applyLpFidelity(a, { status: 'ok', fidelity_pct: 60, band: 'partial' });
    await ReportGenerator.generateAndSendVoiceDebrief(session, '923000000000', 'cs1', a);
    expect(arg().sectionBNotAssessed).toBe(false);
    expect(arg().analysis.domains.lesson_plan_fidelity.domain_score).toBe(24);
    expect(prompt()).not.toMatch(/do not state any lesson-plan percentage/i);
  });
});
