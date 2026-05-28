/**
 * v12 reflective-question chain — Q1/Q2/Q3 + guardrails ladder.
 *
 * Locks: Q1 is corpus-only, Q2/Q3 include CONVERSATION SO FAR, guardrails violations trigger
 * one retry, two consecutive violations fall back to buildSafeFallback, and the TTS gates
 * (roman_script + inline_digit) only fire for non-Latin-script languages.
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });

const mockRouter = { callReflective: jest.fn() };
jest.mock('../../bot/shared/services/coaching/reflective-questions/llm-router.service', () => mockRouter);

const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
const { buildSafeFallback } = require('../../bot/shared/services/coaching/reflective-questions/guardrails');
const { resolveProfile } = require('../../bot/shared/services/coaching/reflective-questions/language-profiles');

const CORPUS = {
  lesson_throughline_en: 'children give confident wrong answers and the teacher re-explains',
  significant_moments: [
    { approx_time_phrase: 'mwanzoni', what_happened: 'mwalimu aliuliza', scope: 'collective', named_student: null, significance_reason_en: 'class silent' },
  ],
  collective_moments: [],
  recurring_signals: [],
};

function mockCall(question, opts = {}) {
  return {
    content: JSON.stringify({ question, question_en: opts.question_en || question }),
    usage: {},
    model_used: opts.model_used || 'deepseek/deepseek-v3.2',
  };
}

describe('_generateReflectiveQuestionV12 — Q1 (corpus-only)', () => {
  beforeEach(() => mockRouter.callReflective.mockReset());

  it('Q1 user payload is corpus-only (no CONVERSATION SO FAR block)', async () => {
    let capturedUser = '';
    mockRouter.callReflective.mockImplementation(async (messages) => {
      capturedUser = messages[1].content;
      return mockCall('A clean Q1 question.');
    });
    await GPT5MiniService._generateReflectiveQuestionV12(CORPUS, [], 1, 'en', 'Asha');
    expect(capturedUser).toMatch(/^CORPUS:/);
    expect(capturedUser).not.toMatch(/CONVERSATION SO FAR/);
  });

  it('Q1 system prompt carries the MARKED NOTICING beat', async () => {
    let capturedSys = '';
    mockRouter.callReflective.mockImplementation(async (messages) => {
      capturedSys = messages[0].content;
      return mockCall('A clean Q1.');
    });
    await GPT5MiniService._generateReflectiveQuestionV12(CORPUS, [], 1, 'en', 'Asha');
    expect(capturedSys).toContain('QUESTION 1 — MARKED NOTICING');
  });

  it('returns the language-side question string (legacy contract preserved)', async () => {
    mockRouter.callReflective.mockResolvedValue(mockCall('What was going through your mind then?'));
    const q = await GPT5MiniService._generateReflectiveQuestionV12(CORPUS, [], 1, 'en', 'Asha');
    expect(q).toBe('What was going through your mind then?');
  });
});

describe('_generateReflectiveQuestionV12 — Q2/Q3 (chain adaptation)', () => {
  beforeEach(() => mockRouter.callReflective.mockReset());

  it('Q2 user payload includes CONVERSATION SO FAR with the teacher\'s Q1 answer', async () => {
    let capturedUser = '';
    mockRouter.callReflective.mockImplementation(async (messages) => {
      capturedUser = messages[1].content;
      return mockCall('A clean Q2.');
    });
    const history = [
      { role: 'assistant', content: 'Q1 here' },
      { role: 'user', content: 'I felt the class wasn\'t with me.' },
    ];
    await GPT5MiniService._generateReflectiveQuestionV12(CORPUS, history, 2, 'en', 'Asha');
    expect(capturedUser).toContain('CORPUS:');
    expect(capturedUser).toContain('CONVERSATION SO FAR:');
    expect(capturedUser).toContain("I felt the class wasn't with me.");
  });

  it('Q2 system prompt carries the LEARNER REASONING beat', async () => {
    let capturedSys = '';
    mockRouter.callReflective.mockImplementation(async (messages) => {
      capturedSys = messages[0].content;
      return mockCall('A clean Q2.');
    });
    await GPT5MiniService._generateReflectiveQuestionV12(CORPUS, [{ role: 'user', content: 'a' }], 2, 'en', 'Asha');
    expect(capturedSys).toContain('QUESTION 2 — LEARNER REASONING');
  });

  it('Q3 system prompt carries the FORWARD COMMITMENT + chorus-yes anti-default', async () => {
    let capturedSys = '';
    mockRouter.callReflective.mockImplementation(async (messages) => {
      capturedSys = messages[0].content;
      return mockCall('A clean Q3.');
    });
    await GPT5MiniService._generateReflectiveQuestionV12(CORPUS, [{ role: 'user', content: 'a' }], 3, 'en', 'Asha');
    expect(capturedSys).toContain('QUESTION 3 — FORWARD COMMITMENT');
    expect(capturedSys).toContain('DO NOT REPEAT THE SAME THING EVERY LESSON');
  });
});

describe('_generateReflectiveQuestionV12 — guardrails ladder', () => {
  beforeEach(() => mockRouter.callReflective.mockReset());

  it('a clean first generation is returned as-is (no retry)', async () => {
    mockRouter.callReflective.mockResolvedValue(mockCall('Clean question.'));
    const q = await GPT5MiniService._generateReflectiveQuestionV12(CORPUS, [], 1, 'en', 'Asha');
    expect(q).toBe('Clean question.');
    expect(mockRouter.callReflective).toHaveBeenCalledTimes(1);
  });

  it('a meta_leak violation triggers ONE retry with the FIX THESE PROBLEMS appendix', async () => {
    // First call: meta-leak ("Q1"). Second call: clean.
    mockRouter.callReflective
      .mockResolvedValueOnce(mockCall('Reflect on Q1, what happened?'))
      .mockImplementationOnce(async (messages) => {
        const sys = messages[0].content;
        expect(sys).toContain('FIX THESE PROBLEMS');
        return mockCall('Clean rewrite.');
      });
    const q = await GPT5MiniService._generateReflectiveQuestionV12(CORPUS, [], 1, 'en', 'Asha');
    expect(q).toBe('Clean rewrite.');
    expect(mockRouter.callReflective).toHaveBeenCalledTimes(2);
  });

  it('two violations in a row falls back to buildSafeFallback for the language', async () => {
    // Both calls produce meta-leak.
    mockRouter.callReflective
      .mockResolvedValueOnce(mockCall('Q1 leak.'))
      .mockResolvedValueOnce(mockCall('Q2 leak again.'));
    const q = await GPT5MiniService._generateReflectiveQuestionV12(CORPUS, [], 1, 'sw', 'Asha');
    // sw → Kiswahili fallback.
    const expected = buildSafeFallback(1, CORPUS, resolveProfile('sw'));
    expect(q).toBe(expected);
  });

  it('non-Latin script enforces TTS gates (roman_script)', async () => {
    // Romanised Urdu — almost all Latin letters. Triggers roman_script.
    mockRouter.callReflective
      .mockResolvedValueOnce(mockCall('Asha, lesson ke bare mein aap kya sochti hain ab?'))
      .mockResolvedValueOnce(mockCall('سوال صاف لکھا گیا ہے بغیر کسی غلطی کے۔'));
    const q = await GPT5MiniService._generateReflectiveQuestionV12(CORPUS, [], 1, 'ur', 'Asha');
    expect(q).toBe('سوال صاف لکھا گیا ہے بغیر کسی غلطی کے۔');
    expect(mockRouter.callReflective).toHaveBeenCalledTimes(2);
  });

  it('Latin-script language (en/sw) skips the TTS gates', async () => {
    // An English question with inline digit "5" — would fire `inline_digit` for non-Latin,
    // but must pass for English.
    mockRouter.callReflective.mockResolvedValue(mockCall('What if 5 students gave that answer?'));
    const q = await GPT5MiniService._generateReflectiveQuestionV12(CORPUS, [], 1, 'en', 'Asha');
    expect(q).toBe('What if 5 students gave that answer?');
    expect(mockRouter.callReflective).toHaveBeenCalledTimes(1);
  });
});
