'use strict';
/**
 * The eight questions of a quiz test eight different things — asked of the
 * model that writes them, not only checked afterwards.
 *
 * The validator names a question that repeats an earlier one
 * (DUPLICATE_QUESTION, transcript-quiz-duplicates) and the targeted rewrite
 * replaces it. On the production read replica about one shipped quiz in fifty
 * carried such a repeat, so the model that writes the quiz, the one that
 * rewrites a rejected question and the one that replaces a question with a
 * picture question are each told the rule up front: no two questions with the
 * same correct answer on the same fact; a question shape may come back only
 * with different numbers or a different item, and so a different answer.
 *
 * The rule is stated ONCE (transcript-quiz-contract DISTINCT_QUESTIONS_RULE)
 * and pasted into all three prompts, so they cannot drift. These tests read
 * the prompts the real builders return, and the prompts the real generate step
 * sends to the model (only the LLM client and the other network boundaries are
 * stubbed).
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Teacher', topic: 'Nouns' }),
  botNumber: jest.fn().mockReturnValue('923000000000'),
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
const { installAgreeingSolver } = require('./helpers/key-verify-agree');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const Rewrite = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');
const { buildAuthorPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { logEvent } = require('../../bot/shared/utils/structured-logger');

// What the rule must SAY — asserted on the prompt text itself, so a rule that
// is defined but never pasted in fails here.
const RULE = [
  'EVERY QUESTION TESTS SOMETHING NO OTHER QUESTION TESTS',
  'No two questions in the quiz may have the same correct answer on the same fact',
  'only with different numbers or a different item',
];
const carriesRule = (text) => RULE.forEach((line) => expect(text).toContain(line));
const carriesRuleOnce = (text) => { carriesRule(text); expect(text.split(RULE[0]).length - 1).toBe(1); };

const QID = '99999999-9999-4999-8999-999999999999';
const SID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DIGEST = {
  topic: 'Common and proper nouns', topic_as_taught: 'Common and proper nouns', subject: 'english',
  grade_band: '6-8', language_of_instruction: 'en', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'tell a proper noun from a common noun', statement_en: 'tell a proper noun from a common noun', taught_level: 'understand' },
    { id: 'S2', statement: 'capitalise proper nouns', statement_en: 'capitalise proper nouns', taught_level: 'recall' },
  ],
  key_terms: [{ term: 'proper noun' }, { term: 'common noun' }], examples_used: ['Lahore and city', 'Ali and boy'], misconceptions_surfaced: [],
};
const SUMMARY = 'You taught the difference between common and proper nouns, using Lahore and city, and Ali and boy.';
const nq = ({ slo = 'S1', level = 'understand', question, options }) => ({
  slo_id: slo, level, question, options, correct_index: 0,
  explanation: 'A proper noun names one particular person, place or thing.',
  selected_because: 'the class sorted nouns into common and proper',
  distractor_misconceptions: { 1: 'thinks every noun is proper', 2: 'confuses a verb with a noun' },
  option_feedback: { correct: 'Well done!', wrong: { 1: 'That one names a kind of thing, not one thing.', 2: 'Look at what the word names.' } },
});
function nouns({ repeat = false } = {}) {
  return [
    nq({ question: 'Which of these is a proper noun?', options: ['Lahore', 'city', 'river'] }),
    nq({ question: 'Which of these is a common noun?', options: ['boy', 'Ali', 'Karachi'] }),
    nq({ question: "In 'Ali lives in Lahore', which word is a proper noun?", options: ['Lahore', 'lives', 'in'] }),
    nq({ question: "In 'The girl reads a book', which word is a common noun?", options: ['book', 'reads', 'a'] }),
    nq({ slo: 'S2', level: 'recall', question: 'How does a proper noun begin?', options: ['With a capital letter', 'With a small letter', 'With a number'] }),
    repeat
      ? nq({ question: 'Which of these words is a proper noun?', options: ['Lahore', 'river', 'city'] })
      : nq({ question: 'Which of these names one particular river?', options: ['Ravi', 'river', 'water'] }),
    nq({ question: "Which word names one particular mountain: 'mountain' or 'K2'?", options: ['K2', 'mountain', 'both'] }),
    nq({ slo: 'S2', level: 'recall', question: 'Which is written correctly?', options: ['Islamabad', 'islamabad', 'ISLAMabad'] }),
  ];
}
const REPLACEMENT = nq({ question: 'Which of these is the name of one particular city?', options: ['Quetta', 'town', 'village'] });

function reply(obj) { return { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.01 } }; }
const promptOf = (call) => call[0].messages.map((m) => String(m.content || '')).join('\n');
const isRewrite = (call) => /REWRITE THESE QUESTIONS/.test(call.messages[0].content);
function wire() {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{
      id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: DIGEST.topic, subject: 'english', language: 'en', status: 'generating', meta: { digest: DIGEST, grade: '7', step: 'author' },
    }] }),
    coaching_sessions: { data: [{ id: SID, user_id: 'u-1', transcript_text: 'lesson '.repeat(400), transcript_language: 'en', created_at: '2026-09-24T04:00:00Z', analysis_data: {}, users: { phone_number: '923000000000', preferred_language: 'en', name: 'A B' } }] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [{ phone_number: '923000000000', preferred_language: 'en' }] },
  });
}

beforeEach(() => {
  jest.clearAllMocks(); mockCreate.mockReset();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true'; delete process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS;
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  jest.spyOn(Gen, 'renderFigures').mockResolvedValue({});
  jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
});

describe('the three prompts that write a question carry the rule, once', () => {
  test('the author prompt — from a recording and from a lesson plan', () => {
    carriesRuleOnce(buildAuthorPrompt({ digest: DIGEST, excerpts: 'the lesson', language: 'en', gradeBand: '6-8' }));
    carriesRuleOnce(buildAuthorPrompt({ digest: DIGEST, excerpts: '', language: 'ur', gradeBand: '3-5', lessonPlan: 'WHAT THE CLASS WAS TO LEARN: nouns' }));
  });

  test('the targeted rewrite — whatever the question was rejected for', () => {
    const qs = nouns();
    ['q3: stem too long (170 chars)', 'q3: DUPLICATE_QUESTION — asks what q0 already asks («…»), with the same answer («Lahore»)'].forEach((e) => {
      carriesRuleOnce(Rewrite.buildRewritePrompt({ digest: DIGEST, language: 'en', questions: qs, targets: Rewrite.rewriteTargets([e]) }));
    });
  });

  test('the add-pictures repair, which may replace a question with a new one', () => {
    carriesRuleOnce(Rewrite.buildAddPicturePrompt({ digest: { ...DIGEST, subject: 'maths', grade_band: '1-5' }, language: 'en', questions: nouns(), indices: [2, 3], need: 2, gradeBand: '1-5' }));
  });
});

describe('the rule reaches the model on the live generate path', () => {
  test('the author call carries it', async () => {
    mockCreate.mockResolvedValue(reply({ lesson_summary: SUMMARY, questions: nouns() }));
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    carriesRuleOnce(promptOf(mockCreate.mock.calls[0]));
  });

  test('the rewrite call for a repeated question carries it', async () => {
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 5, ...REPLACEMENT }] }))
      : Promise.resolve(reply({ lesson_summary: SUMMARY, questions: nouns({ repeat: true }) }))));
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    carriesRuleOnce(promptOf(mockCreate.mock.calls[0]));
    const rw = promptOf(mockCreate.mock.calls[1]);
    expect(rw).toContain('REWRITE THESE QUESTIONS: q5');
    carriesRuleOnce(rw);
  });
});

// ── Found by replaying two real lessons with the rule in place ───────────────
// A lesson on rounding shipped the same question twice although the author
// wrote no repeat: the targeted rewrite, asked to replace a question whose
// picture gave its answer away, wrote a copy of another question. The repeat
// was named after the rewrite and shipped as a soft fault — but the
// transcript_quiz.duplicate_question count only looked at author attempts, so
// it read 0. Then the picture repair drew a number line on the FIRST copy, and
// the check stopped seeing the pair at all: it skipped any pair where one
// question had a picture and the other did not.
const dupEvents = () => logEvent.mock.calls.filter((c) => c[0] === 'transcript_quiz.duplicate_question').map((c) => c[1]);

describe('a repeat is counted in what SHIPS, whichever step wrote it', () => {
  test('the author\'s repeat is counted as stage "author", and the shipped set, once repaired, has none', async () => {
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 5, ...REPLACEMENT }] }))
      : Promise.resolve(reply({ lesson_summary: SUMMARY, questions: nouns({ repeat: true }) }))));
    wire();
    expect((await Gen.process(QID, {})).ok).toBe(true);
    expect(dupEvents()).toEqual([expect.objectContaining({ quizId: QID, stage: 'author', indices: [5] })]);
  });

  test('a repeat the REWRITE writes is counted as stage "shipped"', async () => {
    // q5 is rejected for its length; its replacement is a copy of q0
    const authored = nouns();
    authored[5] = { ...authored[5], question: `${'Read this carefully. '.repeat(9)}Which of these names one particular river?` };
    const copyOfFirst = nq({ question: 'Which of these words is a proper noun?', options: ['city', 'Lahore', 'river'] });
    copyOfFirst.correct_index = 1;
    copyOfFirst.distractor_misconceptions = { 0: 'thinks every noun is proper', 2: 'confuses a verb with a noun' };
    copyOfFirst.option_feedback = { correct: 'Well done!', wrong: { 0: 'That one names a kind of thing, not one thing.', 2: 'Look at what the word names.' } };
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 5, ...copyOfFirst }] }))
      : Promise.resolve(reply({ lesson_summary: SUMMARY, questions: authored }))));
    wire();
    expect((await Gen.process(QID, {})).ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(dupEvents()).toEqual([expect.objectContaining({ quizId: QID, stage: 'shipped', questions: 1, indices: [5] })]);
  });
});

describe('a question with a picture and the same question without one are the same question', () => {
  const ctx = { language: 'en', subject: 'english', digest: DIGEST, nExpected: 8, lessonSummary: SUMMARY };
  // nq() builds the question's text fields; the picture and anything else is laid over it
  const endpoints = ({ question, options, ...rest } = {}) => ({
    ...nq({
      question: question || 'A shop has 5418 pencils. To round 5418 to the nearest 1000, what are the two endpoints?',
      options: options || ['5400 and 5500', '5000 and 6000', '5000 and 5500'],
    }),
    ...rest,
  });
  const line = { type: 'numberline', from: 5000, to: 6000, step: 100, points: [{ at: 5418 }] };

  test('one copy over a number line, the other as text: the later one is named', () => {
    const qs = nouns();
    qs[3] = endpoints({ figure: line, figure_role: 'model' });
    qs[6] = endpoints({ question: 'A shop has 5418 pencils. When rounding 5418 to the nearest 1000, what are the two thousands it is between?', options: ['4000 and 5000', '5400 and 5500', '5000 and 6000'] });
    qs[3].correct_index = 1; qs[6].correct_index = 2;
    const v = validate(qs, ctx);
    expect(v.questions[3].figure.type).toBe('numberline');
    expect(v.questions[6].figure).toBeUndefined();
    const errs = v.errors.filter((e) => /DUPLICATE_QUESTION/.test(e));
    expect(errs).toEqual([expect.stringMatching(/^q6: DUPLICATE_QUESTION — asks what q3 /)]);
  });

  test('the same stem over two DIFFERENT pictures is still two questions', () => {
    const qs = nouns();
    qs[3] = endpoints({ figure: line, figure_role: 'model' });
    qs[6] = endpoints({ figure: { ...line, points: [{ at: 5712 }] }, figure_role: 'model' });
    qs[3].correct_index = 1; qs[6].correct_index = 1;
    const v = validate(qs, ctx);
    expect(v.questions[3].figure.points).toEqual([{ at: 5418 }]);
    expect(v.questions[6].figure.points).toEqual([{ at: 5712 }]);
    expect(v.errors.filter((e) => /DUPLICATE_QUESTION/.test(e))).toEqual([]);
  });
});
