/**
 * Commitment Card — content shape + per-language rules.
 *
 * Locks: Q3 extraction (question_number → last-answer fallback), the documented
 * { commitment, action, highlights, lesson_label, language, _source } shape on
 * the LLM path, and the per-language gender + code-switch rules baked into the
 * prompt (Urdu: respectful آپ-imperative, NEVER تم; Kiswahili: Think-Pair-Write
 * stays English; pedagogical terms inline-English in RTL).
 */

jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockOpenAI = { chat: { completions: { create: jest.fn() } } };
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ openai: mockOpenAI }));

const { extractQ3, buildPrompt, generateCommitmentCard, LANG_NAME } = require('../../bot/shared/services/coaching/coaching-card/commitment-card.service');

const ANALYSIS = {
  framework: 'oecd',
  strengths: [{ title: 'Warm tone' }],
  growth_opportunities: [{ area: 'Wait time', observation: 'Asha rephrased before children finished', strategies: ['Pause 3-5s after a question'] }],
};

const Q3_TURN = {
  question_number: '3',
  question: 'Q3 from the chain',
  answer: 'I want to leave space for the children to think before I jump in to rephrase.',
};

function mockResponse(payload) {
  mockOpenAI.chat.completions.create.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(payload) } }],
  });
}

describe('extractQ3', () => {
  it('returns the turn whose question_number is "3" when present', () => {
    const cs = { questions: [
      { question_number: '1', answer: 'A1' },
      { question_number: '2', answer: 'A2' },
      Q3_TURN,
    ]};
    expect(extractQ3(cs)).toBe(Q3_TURN);
  });

  it('falls back to the LAST question when no question_number === "3"', () => {
    const last = { question_number: '7', answer: 'Last answer here.' };
    const cs = { questions: [
      { question_number: '1', answer: 'A1' },
      last,
    ]};
    expect(extractQ3(cs)).toBe(last);
  });

  it('returns null when no question has an answer >= 3 chars', () => {
    const cs = { questions: [{ question_number: '3', answer: 'ok' }] };
    expect(extractQ3(cs)).toBeNull();
  });

  it('returns null when conversationState is missing or empty', () => {
    expect(extractQ3(null)).toBeNull();
    expect(extractQ3({})).toBeNull();
    expect(extractQ3({ questions: [] })).toBeNull();
  });
});

describe('buildPrompt — per-language rules', () => {
  it('Urdu prompt names آپ-imperative AND forbids تم', () => {
    const p = buildPrompt('ur', ANALYSIS, Q3_TURN);
    expect(p).toContain('آپ-imperative');
    expect(p).toMatch(/NEVER use the intimate تم/);
  });

  it('Urdu prompt locks concrete code-switch examples in English (Latin letters)', () => {
    const p = buildPrompt('ur', ANALYSIS, Q3_TURN);
    expect(p).toContain('"open-ended questions" NOT "کھلے سوال"');
    expect(p).toContain('"wait time" NOT "انتظار کا وقت"');
  });

  it('Kiswahili prompt locks Think-Pair-Write as English', () => {
    const p = buildPrompt('sw', ANALYSIS, Q3_TURN);
    expect(p).toContain('Think-Pair-Write');
  });

  it('Arabic prompt steers toward verbal-noun / impersonal phrasing', () => {
    const p = buildPrompt('ar', ANALYSIS, Q3_TURN);
    expect(p).toMatch(/verbal noun \/ impersonal/);
  });

  it('the prompt embeds the teacher\'s Q3 answer verbatim (sliced to 400)', () => {
    const p = buildPrompt('en', ANALYSIS, Q3_TURN);
    expect(p).toContain(Q3_TURN.answer);
  });

  it('LANG_NAME covers en/sw/ur/ar', () => {
    expect(LANG_NAME.en).toBe('English');
    expect(LANG_NAME.sw).toBe('Kiswahili');
    expect(LANG_NAME.ur).toBe('Urdu');
    expect(LANG_NAME.ar).toBe('Arabic');
  });
});

describe('generateCommitmentCard — happy path', () => {
  beforeEach(() => mockOpenAI.chat.completions.create.mockReset());

  it('returns the documented LLM-source shape', async () => {
    mockResponse({
      commitment: 'You will leave space for children to think.',
      action: 'Next class, after each open-ended question pause for 3 seconds before calling on a student.',
      highlights: ['open-ended question', 'pause for 3 seconds'],
      lesson_label: 'Fractions · Halves',
    });
    const out = await generateCommitmentCard(ANALYSIS, { questions: [Q3_TURN] }, 'en', { teacherName: 'Asha' });
    expect(out).toMatchObject({
      commitment: 'You will leave space for children to think.',
      action: expect.stringContaining('open-ended question'),
      highlights: ['open-ended question', 'pause for 3 seconds'],
      lesson_label: 'Fractions · Halves',
      language: 'en',
      _source: 'llm',
    });
  });

  it('language code is sliced to 2 chars', async () => {
    mockResponse({ commitment: 'C', action: 'A' });
    const out = await generateCommitmentCard(ANALYSIS, { questions: [Q3_TURN] }, 'en-US', { teacherName: 'Asha' });
    expect(out.language).toBe('en');
  });
});
