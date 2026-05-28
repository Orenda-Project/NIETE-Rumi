/**
 * Hero Narrative — reflective_corpus propagation (bd-1842 → bd-1843 regression).
 *
 * The corpus extracted at session-completion (bd-1842) is the bridge between the
 * v12 reflective chain and the celebration narrative. If the narrative ever stops
 * pulling `lesson_throughline_en` + `significant_moments[]` off `analysis.reflective_corpus`,
 * the hero report regresses to generic celebration copy. These tests lock the seam:
 * the prompt builder must read corpus fields, and the celebration LLM must produce
 * the exact downstream contract the hero template consumes.
 */

jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

// Mock GPT5MiniService.openai so the narrative call never touches the network.
// We can't preconfigure a single canned response here — different tests need
// different responses — so we expose a per-test setter on the mock module.
const mockOpenAI = { chat: { completions: { create: jest.fn() } } };
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ openai: mockOpenAI }));

const { buildPrompt, generateReportNarrative } = require('../../bot/shared/services/coaching/report-v2/narrative.service');

const ANALYSIS_WITH_CORPUS = {
  framework: 'hots',
  topic: 'Place Value',
  scores: { overall_percentage: 64 },
  strengths: [{ title: 'Warm tone' }],
  growth_opportunities: [{ area: 'Wait time', rationale: 'Asha rephrased before children had time' }],
  reflective_corpus: {
    lesson_throughline_en: 'children give confident wrong answers and the teacher re-explains herself',
    significant_moments: [
      { what_happened: 'class went silent on the tens-vs-ones distinction', significance_reason_en: 'collective confusion not addressed' },
      { what_happened: 'a child answered 23 for 32', significance_reason_en: 'reversal misconception not surfaced' },
      { what_happened: 'group whispered the answer for a struggling student', significance_reason_en: 'peer scaffolding teacher could amplify' },
    ],
  },
};

describe('buildPrompt() — corpus pull-through', () => {
  it('throughline appears in the prompt verbatim', () => {
    const prompt = buildPrompt(ANALYSIS_WITH_CORPUS, {
      transcript: 'T', trend: [], language: 'en', teacherName: 'Asha',
    });
    expect(prompt).toContain("THIS LESSON'S THROUGHLINE");
    expect(prompt).toContain('children give confident wrong answers');
  });

  it('first 5 significant_moments are formatted as "- what (reason)" lines', () => {
    const prompt = buildPrompt(ANALYSIS_WITH_CORPUS, {
      transcript: 'T', trend: [], language: 'en', teacherName: 'Asha',
    });
    expect(prompt).toContain('MOMENTS ALREADY SURFACED');
    expect(prompt).toContain('- class went silent on the tens-vs-ones distinction (collective confusion not addressed)');
    expect(prompt).toContain('- a child answered 23 for 32 (reversal misconception not surfaced)');
  });

  it('no reflective_corpus → "MOMENTS ALREADY SURFACED" omitted', () => {
    const noCorpus = { ...ANALYSIS_WITH_CORPUS, reflective_corpus: undefined };
    const prompt = buildPrompt(noCorpus, { transcript: 'T', trend: [], language: 'en', teacherName: 'Asha' });
    expect(prompt).not.toContain('MOMENTS ALREADY SURFACED');
    expect(prompt).not.toContain("THIS LESSON'S THROUGHLINE");
  });

  it('framework label tracks analysis.framework (HOTS here)', () => {
    const prompt = buildPrompt(ANALYSIS_WITH_CORPUS, { transcript: 'T', trend: [], language: 'en', teacherName: 'Asha' });
    expect(prompt).toContain('HOTS rubric analysis');
    expect(prompt).toContain('HOTS lens');
  });
});

describe('generateReportNarrative() — output guards', () => {
  beforeEach(() => mockOpenAI.chat.completions.create.mockReset());

  function mockResponse(payload) {
    mockOpenAI.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    });
  }

  it('valid JSON → moments is exactly 3 with {title, quote, why}', async () => {
    mockResponse({
      topic: 'Place Value', affirmation: 'A clear opening',
      identity: 'You ground children with calm framing.',
      moments: [
        { title: 'A', quote: 'q1', why: 'w1' },
        { title: 'B', quote: 'q2', why: 'w2' },
        { title: 'C', quote: 'q3', why: 'w3' },
      ],
      strength_name: 'Warmth', strength_note: 's',
      horizon_title: 'Wait Time', horizon_note: 'h',
      journey_note: 'j', score_framing: 'sf',
    });
    const out = await generateReportNarrative(ANALYSIS_WITH_CORPUS, { transcript: 'T', language: 'en', teacherName: 'Asha' });
    expect(out.moments).toHaveLength(3);
    expect(out.moments[0]).toEqual({ title: 'A', quote: 'q1', why: 'w1' });
  });

  it('5-moment payload → sliced to exactly 3', async () => {
    mockResponse({
      moments: [1, 2, 3, 4, 5].map((i) => ({ title: `T${i}`, quote: `Q${i}`, why: `W${i}` })),
    });
    const out = await generateReportNarrative(ANALYSIS_WITH_CORPUS, { transcript: 'T', language: 'en', teacherName: 'Asha' });
    expect(out.moments).toHaveLength(3);
    expect(out.moments.map((m) => m.title)).toEqual(['T1', 'T2', 'T3']);
  });

  it('try_next stripped from return value', async () => {
    mockResponse({
      topic: 't', moments: [], try_next: 'should be removed',
    });
    const out = await generateReportNarrative(ANALYSIS_WITH_CORPUS, { transcript: 'T', language: 'en', teacherName: 'Asha' });
    expect(out.try_next).toBeUndefined();
  });

  it('LLM throws → returns null', async () => {
    mockOpenAI.chat.completions.create.mockRejectedValue(new Error('boom'));
    const out = await generateReportNarrative(ANALYSIS_WITH_CORPUS, { transcript: 'T', language: 'en', teacherName: 'Asha' });
    expect(out).toBeNull();
  });

  it('output _language === opts.language', async () => {
    mockResponse({ moments: [] });
    const out = await generateReportNarrative(ANALYSIS_WITH_CORPUS, { transcript: 'T', language: 'sw', teacherName: 'Asha' });
    expect(out._language).toBe('sw');
  });
});
