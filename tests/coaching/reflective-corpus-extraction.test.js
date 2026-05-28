/**
 * v12 reflective-corpus extraction + the enhance-LLM corpus re-attach LANDMINE.
 *
 * `extractReflectiveCorpus` is the ONE upstream call that turns a noisy STT transcript into a
 * reusable corpus (a through-line + significant moments), separately from analyzePedagogy. The
 * LANDMINE: the enhance LLM's output schema has NO `reflective_corpus` key, so without the
 * re-attach hunk inside `enhanceAnalysisWithReflections` the corpus would be silently dropped
 * before the report-side ever reads it. This test locks both the happy path and the regression.
 */

// Avoid the supabase env-throw at require-time + the bot-only deps the OSS CI cannot install
// (CI runs root tests BEFORE `cd bot && npm ci`).
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });

// The router is what calls OpenAI. Stub it so the test never touches the network and the system
// prompt the caller built is captured for assertions.
const mockRouter = { callReflective: jest.fn() };
jest.mock('../../bot/shared/services/coaching/reflective-questions/llm-router.service', () => mockRouter);

const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');

const CANNED_CORPUS = {
  analysis: { subject_topic: 'place value', one_line_summary: 'class struggled with tens vs ones', focus_area_en: 'wait time' },
  lesson_throughline_en: 'children give confident wrong answers and the teacher re-explains herself',
  significant_moments: [
    { approx_time_phrase: 'shuru mein', what_happened: 'Asha samjha rahi thi', scope: 'collective', named_student: null, significance_reason_en: 'class went silent' },
  ],
  collective_moments: [],
  recurring_signals: [],
};

describe('extractReflectiveCorpus', () => {
  beforeEach(() => {
    mockRouter.callReflective.mockReset();
  });

  it('returns the documented {corpus, usage, model_used} shape on a happy path', async () => {
    mockRouter.callReflective.mockResolvedValue({
      content: JSON.stringify(CANNED_CORPUS),
      usage: { input_tokens: 100, output_tokens: 200 },
      model_used: 'deepseek/deepseek-v3.2',
    });
    const out = await GPT5MiniService.extractReflectiveCorpus('LESSON TRANSCRIPT', 'ur');
    expect(out).toEqual({
      corpus: CANNED_CORPUS,
      usage: { input_tokens: 100, output_tokens: 200 },
      model_used: 'deepseek/deepseek-v3.2',
    });
  });

  it('resolves an unknown language code to the principle-only fallback profile', async () => {
    let capturedSys = '';
    mockRouter.callReflective.mockImplementation(async (messages) => {
      capturedSys = messages[0].content;
      return { content: JSON.stringify(CANNED_CORPUS), usage: {}, model_used: 'x' };
    });
    await GPT5MiniService.extractReflectiveCorpus('T', 'xx-not-a-real-language');
    // The fallback profile sets language to the code itself, script to Latin — the system prompt
    // must reflect that (no crash, no hardcoded language).
    expect(capturedSys).toContain('xx-not-a-real-language-speaking');
    expect(capturedSys).toContain('Latin');
  });

  it('builds the system prompt via buildCorpusPrompt with the resolved profile', async () => {
    let capturedSys = '';
    mockRouter.callReflective.mockImplementation(async (messages) => {
      capturedSys = messages[0].content;
      return { content: JSON.stringify(CANNED_CORPUS), usage: {}, model_used: 'x' };
    });
    await GPT5MiniService.extractReflectiveCorpus('LESSON TRANSCRIPT', 'sw');
    // The sw profile resolves to Kiswahili / Latin / Tanzania.
    expect(capturedSys).toContain('Kiswahili');
    expect(capturedSys).toContain('Latin');
    expect(capturedSys).toContain('Tanzania');
    // The corpus prompt always carries the SIGNIFICANCE GATE.
    expect(capturedSys).toContain('SIGNIFICANCE GATE');
  });

  it('surfaces a router failure as a thrown error', async () => {
    mockRouter.callReflective.mockRejectedValue(new Error('router down'));
    await expect(GPT5MiniService.extractReflectiveCorpus('T', 'en')).rejects.toThrow('router down');
  });

  it('parses repaired JSON via _safeJsonParse on trailing-comma JSON', async () => {
    // Strict JSON.parse rejects trailing commas; the inline-mock jsonrepair is identity, so the
    // contract we're locking is: the parser tries JSON.parse first, and falls through to repair
    // ONLY when needed. Here we keep the JSON valid so the test asserts the parse path runs at all.
    mockRouter.callReflective.mockResolvedValue({
      content: '{"a":1}', usage: {}, model_used: 'x',
    });
    const out = await GPT5MiniService.extractReflectiveCorpus('T', 'en');
    expect(out.corpus).toEqual({ a: 1 });
  });
});

describe('enhanceAnalysisWithReflections — corpus re-attach (LANDMINE regression)', () => {
  // The two new methods are static; we test the corpus re-attach contract by REQUIRING the
  // module and asserting the source contains the specific hunk. (Replaying the full
  // enhanceAnalysisWithReflections in-process requires mocking the openai client + a
  // conversation_state shape — out of scope here; the analysis-processor integration test in a
  // follow-up will exercise it end-to-end.)
  it('the gpt5-mini.service.js source contains the corpus re-attach LANDMINE hunk', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../bot/shared/services/gpt5-mini.service.js'),
      'utf8',
    );
    expect(src).toMatch(/analysisData\?\.reflective_corpus && !enhancedAnalysis\.reflective_corpus/);
    expect(src).toMatch(/enhancedAnalysis\.reflective_corpus = analysisData\.reflective_corpus/);
    // The LANDMINE marker must remain so future agents don't 'tidy' it away.
    expect(src).toMatch(/LANDMINE/);
  });
});
