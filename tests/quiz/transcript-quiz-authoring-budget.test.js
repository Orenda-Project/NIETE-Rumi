'use strict';
/**
 * The authoring budget, after the first real morning on production (2026-09-07).
 *
 * Seven real quizzes reached the author; two teachers got "I couldn't make a
 * good quiz". Both died the same way: attempt 1 was spent on something that is
 * not a fault of the questions (the quiz language, or a drawable lesson with no
 * picture), and attempt 2 — the LAST one — hit a complaint nothing could repair:
 * once a quiz-level "only 4/8 at/below taught level", once FOUR per-question
 * length faults where the rewrite stops at three. Two attempts, four ways to
 * lose one, one narrow repair. This suite pins the wider policy:
 *   1. three full attempts by default (TRANSCRIPT_QUIZ_MAX_ATTEMPTS overrides);
 *   2. the picture is demanded on the FIRST attempt only;
 *   3. the targeted rewrite repairs up to FIVE questions, including a
 *      multi-select fault, which is one question's text like a long option;
 *   4. the level-mix rule names the questions pitched above the lesson, so the
 *      rewrite can bring them down instead of the teacher losing the quiz.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true), sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true), sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendImageWithButtons: jest.fn().mockResolvedValue(true), sendTextReturningId: jest.fn().mockResolvedValue('m1'),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'A B', topic: 'x' }),
  botNumber: jest.fn().mockReturnValue('920000000000'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClientForModel: (model) => ({ client: { chat: { completions: { create: (...a) => mockCreate(...a) } } }, model }),
}));

const supabase = require('../../bot/shared/config/supabase');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const Rewrite = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');

const QID = '55555555-5555-4555-8555-555555555555';
const SID = '66666666-6666-4666-8666-666666666666';

const DIGEST = {
  topic: 'Food chains', topic_as_taught: 'Food chains', subject: 'science',
  grade_band: '6-8', language_of_instruction: 'en', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'name producers, consumers and decomposers', taught_level: 'recall' },
    { id: 'S2', statement: 'order the links of a simple food chain', taught_level: 'understand' },
    { id: 'S3', statement: 'say what happens when one link disappears', taught_level: 'understand' },
  ],
  key_terms: ['producer', 'consumer', 'decomposer'], examples_used: ['grass → goat → lion'], misconceptions_surfaced: [],
};
const SUMMARY = 'Today you taught the links of a food chain with grass, goat and lion, then had the class order three chains and say what happens when the goat disappears.';

function q({ slo = 'S1', level = 'recall', question, options, why }) {
  return {
    slo_id: slo, level, question, options, correct_index: 0,
    explanation: 'A producer makes its own food; a consumer eats; a decomposer breaks the dead down.',
    selected_because: why || 'grass, goat, lion written on the board',
    distractor_misconceptions: { 1: 'thinks the goat makes its own food', 2: 'thinks the lion is a decomposer' },
    option_feedback: {
      correct: 'Yes — that is the link we put first, just like grass on the board.',
      wrong: { 1: 'That one eats; the chain starts with the one that makes its own food.', 2: 'That one breaks the dead down; it comes at the very end.' },
    },
  };
}
const LONG_WHY = 'the moment in the lesson when the teacher wrote the three words on the board and then asked every row to name one more producer one more consumer and one more decomposer from the school garden';

function eight() {
  return [
    q({ question: 'Which of these makes its own food?', options: ['grass', 'goat', 'lion'] }),
    q({ slo: 'S2', level: 'understand', question: 'Which comes first in the chain grass, goat, lion?', options: ['grass', 'goat', 'lion'] }),
    q({ question: 'Which of these is a consumer?', options: ['goat', 'grass', 'sun'] }),
    q({ slo: 'S3', level: 'understand', question: 'If every goat disappears, what happens to the lions?', options: ['they go hungry', 'they eat grass', 'nothing changes'] }),
    q({ question: 'Which word means "breaks the dead down"?', options: ['decomposer', 'producer', 'consumer'] }),
    q({ slo: 'S2', level: 'understand', question: 'Which chain is in the right order?', options: ['grass → goat → lion', 'lion → goat → grass', 'goat → grass → lion'] }),
    q({ question: 'Which of these is a producer?', options: ['a mango tree', 'a cat', 'a crow'] }),
    q({ slo: 'S3', level: 'understand', question: 'If the grass dries up, which link is hit first?', options: ['the goat', 'the lion', 'the decomposer'] }),
  ];
}
function reply(obj) { return { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.01 } }; }
function wire() {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{
      id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: DIGEST.topic, subject: 'science', language: 'en', status: 'generating', meta: { digest: DIGEST, grade: '7', step: 'author' },
    }] }),
    coaching_sessions: { data: [{ id: SID, user_id: 'u-1', transcript_text: 'lesson '.repeat(400), transcript_language: 'en', created_at: '2026-09-07T04:00:00Z', analysis_data: {}, users: { phone_number: '923001234567', preferred_language: 'en', first_name: 'A', last_name: 'B' } }] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [{ phone_number: '923001234567', preferred_language: 'en' }] },
  });
}
const storedRows = () => { const ins = supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert'); return ins.length ? ins[0][1] : []; };
const promptOf = (call) => call[0].messages[0].content;

beforeEach(() => {
  jest.clearAllMocks(); mockCreate.mockReset();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true'; delete process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS;
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Gen, 'renderFigures').mockResolvedValue({});
  jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
});

describe('1 — the budget', () => {
  test('three full attempts by default; TRANSCRIPT_QUIZ_MAX_ATTEMPTS overrides', () => {
    expect(Gen.maxAttempts()).toBe(3);
    process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS = '2';
    expect(Gen.maxAttempts()).toBe(2);
    process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS = 'nonsense';
    expect(Gen.maxAttempts()).toBe(3);
  });
  test('the picture is demanded on the FIRST attempt only, whatever the budget', () => {
    const noFig = eight();
    expect(Gen.figureRequiredError({ questions: noFig, subject: 'science', attempt: 1, maxAttempts: 3 })).toMatch(/FIGURE_REQUIRED/);
    expect(Gen.figureRequiredError({ questions: noFig, subject: 'science', attempt: 2, maxAttempts: 3 })).toBeNull();
    expect(Gen.figureRequiredError({ questions: noFig, subject: 'science', attempt: 3, maxAttempts: 3 })).toBeNull();
  });
});

describe('2 — the rewrite reaches further', () => {
  test('four length faults plus a thin multi-select on five questions are ONE repair, not a re-roll', () => {
    const errs = [
      'q1: Q_MISSING_WHY — "selected_because" is 40 words; 15 at most',
      'q3: Q_MISSING_WHY — "selected_because" is 39 words; 15 at most',
      'q5: Q_MISSING_WHY — "selected_because" is 33 words; 15 at most',
      'q6: option >72 code points',
      'q7: MULTI_TOO_FEW_CORRECT — "correct_indices" must name at least 2 correct options; got [0]',
    ];
    expect(Rewrite.rewriteTargets(errs).indices).toEqual([1, 3, 5, 6, 7]);
  });
  test('six questions is still a re-roll', () => {
    const errs = [0, 1, 2, 3, 4, 5].map((i) => `q${i}: Q_MISSING_WHY — "selected_because" is 40 words; 15 at most`);
    expect(Rewrite.rewriteTargets(errs).indices).toEqual([]);
  });
});

describe('3 — the level mix names its questions', () => {
  test('a set with too many questions above the taught level gets per-question PEDAGOGY_LEVEL_ABOVE lines the rewrite accepts', () => {
    // S1 was taught at recall; four questions on it are asked at understand (+1 each, allowed
    // singly) — 4/8 at or below is under the 60 % floor.
    const qs = eight();
    [0, 2, 4, 6].forEach((i) => { qs[i].level = 'understand'; });
    const v = validate(qs, { language: 'en', subject: 'science', digest: DIGEST, nExpected: 8, lessonSummary: SUMMARY, quizId: QID });
    expect(v.ok).toBe(false);
    expect(v.errors).toEqual(expect.arrayContaining([expect.stringMatching(/^only 4\/8 at\/below taught level/)]));
    const named = v.errors.filter((e) => /^q\d+: PEDAGOGY_LEVEL_ABOVE/.test(e));
    expect(named.length).toBeGreaterThanOrEqual(1);   // ceil(0.6 × 8) − 4 = 1 question to bring down
    const t = Rewrite.rewriteTargets(v.errors);
    expect(t.indices.length).toBe(named.length);
    expect(t.indices.every((i) => [0, 2, 4, 6].includes(i))).toBe(true);
  });
});

describe('4 — the two production deaths, replayed', () => {
  test('a science lesson: no picture on attempt 1, four long "why" notes on attempt 2 → one rewrite → 8 shipped', async () => {
    const bad = eight();
    [1, 3, 5, 6].forEach((i) => { bad[i].selected_because = LONG_WHY; });
    const fixed = [1, 3, 5, 6].map((i) => ({ index: i, ...eight()[i] }));
    mockCreate
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY, questions: eight() }))   // attempt 1: fine but no figure
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY, questions: bad }))       // attempt 2: 4 length faults
      .mockResolvedValueOnce(reply({ questions: fixed }));                              // the repair
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(promptOf(mockCreate.mock.calls[2])).toContain('REWRITE THESE QUESTIONS: q1, q3, q5, q6');
    expect(storedRows()).toHaveLength(8);
  });
  test('an Urdu-taught maths lesson quizzed in English: four questions above the taught level → one rewrite → 8 shipped', async () => {
    const above = eight();
    [0, 2, 4, 6].forEach((i) => { above[i].level = 'understand'; });
    mockCreate
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY, questions: above }))
      .mockImplementation((call) => {
        // the repair call: answer whatever indices it asks for with recall-level questions
        const m = /REWRITE THESE QUESTIONS: ([^\n]+)/.exec(call.messages[0].content);
        const idx = m ? m[1].split(',').map((s) => Number(s.trim().replace('q', ''))) : [];
        return Promise.resolve(reply({ questions: idx.map((i) => ({ index: i, ...eight()[i] })) }));
      });
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(storedRows()).toHaveLength(8);
  });
});
