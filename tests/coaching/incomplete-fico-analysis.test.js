/**
 * An incomplete FICO analysis must never be reported as 0 for the sections the model left out.
 *
 * ICT feedback (DC tab row 151, 20 Oct): a teacher's 25-minute recording came back 10/148 — Lesson
 * Plan Fidelity 10/40, and High-Leverage Practices 0/48, Student Engagement 0/28, Teacher Subject
 * Knowledge 0/32. The scoring call finished normally (no truncation) but returned 1,506 tokens with
 * only the lesson_plan_fidelity section; nothing checked that every section came back, and the
 * report renders a missing section as 0 of its full max. 17 such sessions since 1 Aug (11 teachers).
 *
 * Now: a reply that carries SOME but not all of the framework's sections is retried once; if the
 * retry is complete it is used; if a section is still missing it is marked not assessed (left out of
 * the total, "not assessed" on the card with its own reason), never scored 0.
 *
 * Executes the real GPT5MiniService.analyzePedagogy with the real FICO module; the only mock is the
 * model client (network boundary).
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
const mockEvents = [];
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (name, data) => mockEvents.push({ name, ...data }),
  getCurrentCorrelationId: () => null,
}));

const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');
const { buildFicoGroups } = require('../../bot/shared/services/coaching/report-v2/score-adapters/fico-adapter');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const { domains: DECLARED, scaleMax: SCALE_MAX } = fico.getScoringConstants();
const SECTIONS = Object.keys(DECLARED);
const section = (id, score) => ({ indicators: [{ id, score, applicable: true, evidence: 'e' }] });
const FULL = {
  executive_summary: 'ok',
  domains: Object.fromEntries(SECTIONS.map((k, i) => [k, section(`${k}-1`, 1 + (i % 2))])),
};
const ONLY_B = { executive_summary: 'ok', domains: { lesson_plan_fidelity: section('B1', 1) } };
const reply = (obj) => ({
  choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, completion_tokens_details: { reasoning_tokens: 30 } },
});

function stub(replies) {
  const calls = [];
  GPT5MiniService.openai = { chat: { completions: { create: async (req) => { calls.push(req); return reply(replies[Math.min(calls.length, replies.length) - 1]); } } } };
  return calls;
}

describe('an incomplete FICO analysis is retried once and never scored 0 for missing sections', () => {
  const real = GPT5MiniService.openai;
  afterAll(() => { GPT5MiniService.openai = real; });

  test('a complete reply is used as it is — one call, every section scored', async () => {
    const calls = stub([FULL]);
    const { analysis } = await GPT5MiniService.analyzePedagogy('transcript', { language: 'en' }, null, fico);
    expect(calls).toHaveLength(1);
    for (const k of SECTIONS) expect(analysis.domains[k].assessed).not.toBe(false);
  });

  test('a partial reply is retried once and a complete retry replaces it', async () => {
    const calls = stub([ONLY_B, FULL]);
    const { analysis } = await GPT5MiniService.analyzePedagogy('transcript', { language: 'en' }, null, fico);
    expect(calls).toHaveLength(2);
    for (const k of SECTIONS) {
      expect(analysis.domains[k]).toBeTruthy();
      expect(analysis.domains[k].assessed).not.toBe(false);
    }
  });

  test('still partial after the retry: missing sections are not assessed, not 0, and leave the total', async () => {
    const calls = stub([ONLY_B, ONLY_B]);
    const { analysis } = await GPT5MiniService.analyzePedagogy('transcript', { language: 'en' }, null, fico);
    expect(calls).toHaveLength(2);
    const missing = SECTIONS.filter((k) => k !== 'lesson_plan_fidelity');
    for (const k of missing) {
      expect(analysis.domains[k].assessed).toBe(false);
      expect(analysis.domains[k].not_assessed_reason).toBe('analysis_incomplete');
    }
    // Only Section B's one row counts: 1 of SCALE_MAX, not 1 of the whole rubric.
    expect(analysis.scores.overall_marks).toBe(1);
    expect(analysis.scores.overall_max_marks).toBe(SCALE_MAX);

    // After the measured-fidelity merge too (applyLpFidelity recomputes the total).
    // The missing sections stay out: the total is Section B's alone, whatever B's own max is.
    const merged = fico.applyLpFidelity(JSON.parse(JSON.stringify(analysis)), { status: 'ok', fidelity_pct: 25 });
    const b = merged.domains.lesson_plan_fidelity;
    expect(merged.scores.overall_max_marks).toBe(b.domain_max);
    expect(merged.scores.overall_marks).toBe(b.domain_score);
    for (const k of missing) expect(merged.domains[k].assessed).toBe(false);
  });

  test('the report card shows "not assessed" with its own reason — never 0 of the full max, never the lesson-plan reason', async () => {
    stub([ONLY_B, ONLY_B]);
    const { analysis } = await GPT5MiniService.analyzePedagogy('transcript', { language: 'en' }, null, fico);
    for (const lang of ['en', 'ur']) {
      const groups = buildFicoGroups(analysis, lang);
      const hlp = groups.find((g) => g.domainKey === 'high_leverage_practices');
      expect(hlp.notAssessed).toBe(true);
      expect(hlp.score).toBeNull();
      expect(hlp.why).toBe(resolveUx('reportSectionNotAnalysed', { language: lang }));
      expect(hlp.why).not.toMatch(/lesson plan|لیسن پلان/i);
    }
  });

  describe('every analysis logs its shape — coaching.analysis.sections', () => {
    const META = { language: 'en', coachingSessionId: 'sess-123' };
    const last = () => mockEvents.filter((e) => e.name === 'coaching.analysis.sections').pop();
    beforeEach(() => { mockEvents.length = 0; });

    test('a complete analysis: result complete, every section, no retry, stop reason and tokens', async () => {
      stub([FULL]);
      await GPT5MiniService.analyzePedagogy('transcript', { ...META }, null, fico);
      expect(last()).toMatchObject({
        coachingSessionId: 'sess-123', result: 'complete', retried: false,
        sectionsExpected: SECTIONS.length, sectionsReturned: SECTIONS.length, missing: [],
        finishReason: 'stop', inputTokens: 100, outputTokens: 50, reasoningTokens: 30,
      });
      expect(last().responseChars).toBeGreaterThan(0);
      expect(typeof last().transcriptChars).toBe('number');
    });

    test('recovered by the retry: result recovered, and which sections the first reply lacked', async () => {
      stub([ONLY_B, FULL]);
      await GPT5MiniService.analyzePedagogy('transcript', { ...META }, null, fico);
      expect(last()).toMatchObject({
        result: 'recovered', retried: true, sectionsReturned: SECTIONS.length, missing: [],
        firstMissing: SECTIONS.filter((k) => k !== 'lesson_plan_fidelity'),
        firstReply: { finishReason: 'stop', outputTokens: 50, reasoningTokens: 30 },
      });
    });

    test('still incomplete: result incomplete with the missing sections', async () => {
      stub([ONLY_B, ONLY_B]);
      await GPT5MiniService.analyzePedagogy('transcript', { ...META }, null, fico);
      expect(last()).toMatchObject({
        result: 'incomplete', retried: true, sectionsReturned: 1,
        missing: SECTIONS.filter((k) => k !== 'lesson_plan_fidelity'),
      });
    });

    test('the event records the shape only — never the reply or transcript text', async () => {
      stub([FULL]);
      await GPT5MiniService.analyzePedagogy('SECRET LESSON WORDS', { ...META }, null, fico);
      expect(JSON.stringify(last())).not.toMatch(/SECRET LESSON WORDS|executive_summary/);
    });
  });

  test('the new reason exists in both offered languages and the Urdu is Urdu', () => {
    const en = resolveUx('reportSectionNotAnalysed', { language: 'en' });
    const ur = resolveUx('reportSectionNotAnalysed', { language: 'ur' });
    expect(en && en.trim().length).toBeGreaterThan(0);
    expect(/[؀-ۿ]/.test(ur)).toBe(true);
    expect(ur).not.toBe(en);
  });
});
