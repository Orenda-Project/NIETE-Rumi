'use strict';
/**
 * A GENDERED LESSON SUMMARY NEVER REACHES THE TEACHER'S DOCUMENT.
 *
 * The whole pipeline, end to end, on the round-6 rule (PLAN_R6 D5): the author
 * returns a summary that calls the teacher "She", the validator rejects the
 * quiz on `PEDAGOGY_GENDERED_TEACHER`, the retry does it again, and the
 * TARGETED REWRITE — extended this round to the quiz-level `lesson_summary` —
 * repairs that one field in one small call. What is stored on the row, and
 * therefore printed on the pre-send PDF, is the repaired summary.
 *
 * Mocked at the NETWORK boundary (llm-client's getClientForModel) only: the
 * author prompt, the validator, the pedagogy rule, the rewrite prompt, the
 * merge and the store all execute for real on this branch.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Rifat Noor', topic: 'x' }),
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
  getClientForModel: (model) => ({
    client: { chat: { completions: { create: (...a) => mockCreate(...a) } } },
    model,
  }),
}));

const supabase = require('../../bot/shared/config/supabase');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');

const QID = '55555555-5555-4555-8555-555555555555';
const SID = '66666666-6666-4666-8666-666666666666';

const DIGEST = {
  topic: 'Parts of a plant', topic_as_taught: 'Parts of a plant', subject: 'english',
  grade_band: '3-5', language_of_instruction: 'en', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'name the parts of a plant', taught_level: 'recall' },
    { id: 'S2', statement: 'explain what roots do', taught_level: 'understand' },
  ],
  key_terms: ['root', 'stem'], examples_used: ['the money plant on the window sill'],
  misconceptions_surfaced: [],
};

const GENDERED_SUMMARY = 'The teacher reviewed the parts of a plant with the class. She then '
  + 'pulled up the money plant to show the root, and asked what the root does.';
const NEUTRAL_SUMMARY = 'Today you reviewed the parts of a plant with the class. You then pulled '
  + 'up the money plant to show the root, and asked what the root does.';

function q({ slo = 'S1', level = 'recall', question, options }) {
  return {
    slo_id: slo, level, question, options, correct_index: 0,
    explanation: 'The root is the part under the soil and it drinks water.',
    selected_because: 'the moment the money plant was pulled up',
    distractor_misconceptions: { 1: 'takes a leaf for a root', 2: 'takes a flower for a root' },
    option_feedback: {
      correct: 'Yes — the root is under the soil, drinking water for the whole plant.',
      wrong: {
        1: 'Leaves are up in the air making food; the part under the soil is the root.',
        2: 'Flowers make seeds at the top; the part under the soil is the root.',
      },
    },
  };
}

/** Eight questions with nothing wrong with them — the summary is the only fault. */
function eightGood() {
  return [
    q({ question: 'Which part of the plant is under the soil?', options: ['root', 'leaf', 'flower'] }),
    q({ slo: 'S2', level: 'understand', question: 'What do the roots do for the plant?', options: ['drink water', 'make seeds', 'catch light'] }),
    q({ question: 'Which part holds the plant up?', options: ['stem', 'root', 'flower'] }),
    q({ slo: 'S2', level: 'understand', question: 'A plant in dry soil droops. Which part is short of water?', options: ['root', 'flower', 'seed'] }),
    q({ question: 'Which part of a money plant grows down into the soil?', options: ['root', 'seed', 'fruit'] }),
    q({ slo: 'S2', level: 'understand', question: 'Why is the root under the soil and not above it?', options: ['it drinks water from the soil', 'it catches the light', 'it makes the seeds'] }),
    q({ question: 'Which part makes the seeds?', options: ['flower', 'root', 'stem'] }),
    q({ slo: 'S2', level: 'apply', question: 'A plant is pulled out of the pot. Which part will be covered in soil?', options: ['the root', 'the flower', 'the top leaf'] }),
  ];
}

function reply(obj) {
  return { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.01 } };
}

function wire() {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update')
      ? { data: [{ id: QID }] }
      : {
        data: [{
          id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: DIGEST.topic,
          subject: DIGEST.subject, language: 'en', status: 'generating',
          meta: { digest: DIGEST, grade: '4', step: 'author' },
        }],
      }),
    coaching_sessions: {
      data: [{
        id: SID, user_id: 'u-1', transcript_text: 'lesson '.repeat(400), transcript_language: 'en',
        created_at: '2026-09-06T05:00:00Z', analysis_data: { topic: 'x', subject: 'x' },
        users: { phone_number: '923001234567', preferred_language: 'en', first_name: 'Rifat', last_name: 'Noor' },
      }],
    },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [{ phone_number: '923001234567', preferred_language: 'en', first_name: 'Rifat' }] },
  });
}

/** The `meta` the pipeline last wrote to the quizzes row. */
function storedMeta() {
  const updates = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update');
  const withMeta = updates.map((c) => c[1]).filter((u) => u && u.meta);
  return withMeta.length ? withMeta[withMeta.length - 1].meta : null;
}
function storedRows() {
  const ins = supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert');
  return ins.length ? ins[0][1] : [];
}
const promptOf = (call) => call[0].messages[0].content;

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockReset();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
  delete process.env.QUIZ_MULTI_SELECT_FLOW_ID;
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Gen, 'renderFigures').mockResolvedValue({});
  jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
});

describe('a gendered lesson_summary is repaired, not shipped', () => {
  test('two gendered attempts, one summary-only rewrite, and the neutral summary is what is stored', async () => {
    mockCreate
      .mockResolvedValueOnce(reply({ lesson_summary: GENDERED_SUMMARY, questions: eightGood() }))
      .mockResolvedValueOnce(reply({ lesson_summary: GENDERED_SUMMARY, questions: eightGood() }))
      .mockResolvedValueOnce(reply({ lesson_summary: NEUTRAL_SUMMARY }));
    wire();

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);

    // two full attempts, then ONE small call that rewrites the summary only
    expect(mockCreate).toHaveBeenCalledTimes(3);
    const rewritePrompt = promptOf(mockCreate.mock.calls[2]);
    expect(rewritePrompt).toContain('THE LESSON SUMMARY — rewrite it');
    expect(rewritePrompt).toContain(GENDERED_SUMMARY);
    expect(rewritePrompt).toContain('PEDAGOGY_GENDERED_TEACHER');
    expect(rewritePrompt).not.toContain('REWRITE THESE QUESTIONS');

    // the quiz ships whole — a gendered summary costs no question
    expect(storedRows()).toHaveLength(8);
    expect(storedMeta().lesson_summary).toBe(NEUTRAL_SUMMARY);
    expect(storedMeta().lesson_summary).not.toMatch(/\bshe\b/i);
  });

  test('the retry note quotes the complaint back, so the second attempt is told what to fix', async () => {
    mockCreate
      .mockResolvedValueOnce(reply({ lesson_summary: GENDERED_SUMMARY, questions: eightGood() }))
      .mockResolvedValueOnce(reply({ lesson_summary: NEUTRAL_SUMMARY, questions: eightGood() }));
    wire();

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    // the second attempt fixed it: no rewrite call at all
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(promptOf(mockCreate.mock.calls[1])).toContain('PEDAGOGY_GENDERED_TEACHER');
    expect(storedMeta().lesson_summary).toBe(NEUTRAL_SUMMARY);
  });

  test('the gendered_teacher event names the field, so the rate is measurable', async () => {
    mockCreate
      .mockResolvedValueOnce(reply({ lesson_summary: GENDERED_SUMMARY, questions: eightGood() }))
      .mockResolvedValueOnce(reply({ lesson_summary: NEUTRAL_SUMMARY, questions: eightGood() }));
    wire();
    await Gen.process(QID, {});

    const ev = logEvent.mock.calls.filter((c) => c[0] === 'transcript_quiz.gendered_teacher');
    expect(ev.length).toBeGreaterThan(0);
    expect(ev[0][1]).toEqual(expect.objectContaining({ quizId: QID, field: 'lesson_summary', hits: 1 }));
  });

  test('a rewrite that returns the SAME gendered summary fails the quiz rather than printing it', async () => {
    mockCreate
      .mockResolvedValueOnce(reply({ lesson_summary: GENDERED_SUMMARY, questions: eightGood() }))
      .mockResolvedValueOnce(reply({ lesson_summary: GENDERED_SUMMARY, questions: eightGood() }))
      .mockResolvedValueOnce(reply({ lesson_summary: GENDERED_SUMMARY }));
    wire();

    const r = await Gen.process(QID, {});
    expect(r.failed).toBe(true);
    expect(r.reason).toBe('validator_failed');
    expect(storedRows()).toHaveLength(0);
  });
});
