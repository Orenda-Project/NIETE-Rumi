'use strict';
/**
 * REASONS A CHILD CAN FOLLOW (behind app_settings quiz_author_gates_v2).
 *
 * A grade 1-5 child hears the explanation and the wrong-option feedback read
 * aloud. Authored, they were adult prose of 15-25 words. With the flag on, a
 * reason over its grade's cap (grades 1-2: one sentence, 12 words; 3-5: two
 * sentences, 18 words) gets ONE small call that rewrites only those texts; code
 * keeps a rewrite only when it is shorter and keeps every number, and writes it
 * into that field alone — the stem, options and key never move. It never costs
 * a question. Flag off: nothing runs.
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
const { installAgreeingSolver } = require('./helpers/key-verify-agree');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const GatesV2 = require('../../bot/shared/services/quiz/quiz-author-gates-v2');
const Reasons = require('../../bot/shared/services/quiz/transcript-quiz-child-reasons');
const { logEvent } = require('../../bot/shared/utils/structured-logger');

const LONG = 'The plant needs its roots because the roots, which grow deep under the soil, take in the water and food that the plant needs to grow.';
const LONG_WRONG = 'That is not right, because the leaves, which are green and flat, make food from sunlight rather than taking in water from the soil below.';
const SHORT = 'Roots take in water from the soil.';
const SHORT_WRONG = 'Leaves make food. Roots take in water.';

describe('the rule, banded by grade', () => {
  test('grades 1-2: one sentence, 12 words; 3-5: two sentences, 18 words; 6+ and no grade: none', () => {
    expect(Reasons.reasonCap('1-2')).toEqual(expect.objectContaining({ words: 12, sentences: 1 }));
    expect(Reasons.reasonCap('3-5')).toEqual(expect.objectContaining({ words: 18, sentences: 2 }));
    expect(Reasons.reasonCap('4')).toEqual(expect.objectContaining({ words: 18 }));
    expect(Reasons.reasonCap('6-8')).toBeNull();
    expect(Reasons.reasonCap(null)).toBeNull();
  });

  test('names every reason over its cap, explanation and each feedback line', () => {
    const q = { question: 'Which part takes in water?', options: ['roots', 'leaves', 'flower'], correct_index: 0, explanation: LONG, option_feedback: { correct: SHORT, wrong: { 1: LONG_WRONG, 2: SHORT_WRONG } } };
    const long = Reasons.longReasons([q], { gradeBand: '1-2', language: 'en' });
    expect(long.map((l) => l.field)).toEqual(['explanation', 'wrong.1', 'wrong.2']); // wrong.2 is two sentences
    expect(Reasons.longReasons([q], { gradeBand: '6-8', language: 'en' })).toEqual([]);
  });

  test('a rewrite that loses a number or is not shorter is refused', () => {
    expect(Reasons.acceptable('Start at 19 and count back 7 steps to reach 12, which is the answer here.', 'Count back from 19 to 12.')).toBe(false);
    expect(Reasons.acceptable('Start at 19 and count back 7 steps to reach 12, which is the answer here.', 'Count back 7 from 19 to get 12.')).toBe(true);
    expect(Reasons.acceptable('Short one.', 'Short one, but longer now.')).toBe(false);
  });
});

// ── the generate path ────────────────────────────────────────────────────────
const QID = '77777777-7777-4777-8777-777777777777';
const SID = '88888888-8888-4888-8888-888888888888';
const DIGEST = {
  topic: 'Parts of a plant', topic_as_taught: 'parts of a plant', subject: 'science',
  grade_band: '1-2', language_of_instruction: 'en', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'name the parts of a plant', statement_en: 'name the parts of a plant', taught_level: 'recall' },
    { id: 'S2', statement: 'say what each part does', statement_en: 'say what each part does', taught_level: 'understand' },
  ],
  key_terms: [{ term: 'roots' }, { term: 'leaves' }], examples_used: ['a bean plant'], misconceptions_surfaced: [],
};
const SUMMARY = 'Today the class learned the parts of a plant and what each part does.';
const PARTS = [
  ['Which part takes in water?', 'roots', 'leaves', 'flower'],
  ['Which part makes food?', 'leaves', 'roots', 'stem'],
  ['Which part holds the plant up?', 'stem', 'flower', 'seed'],
  ['Which part makes seeds?', 'flower', 'leaves', 'roots'],
  ['Which part grows under the soil?', 'roots', 'flower', 'leaves'],
  ['Which part is green and flat?', 'leaves', 'roots', 'seed'],
  ['Which part carries water up?', 'stem', 'seed', 'flower'],
  ['What grows into a new plant?', 'seed', 'leaves', 'stem'],
];
const moment = (key) => `the ${key} is a part of the plant we looked at`;
const gq = ([question, ...options], k) => ({
  slo_id: k % 2 ? 'S2' : 'S1', level: k % 2 ? 'understand' : 'recall', question, options, correct_index: 0,
  explanation: k === 0 ? LONG : `The ${options[0]} is the right part.`,
  selected_because: 'the class looked at a bean plant',
  distractor_misconceptions: { 1: 'mixes up the parts', 2: 'mixes up the parts' },
  option_feedback: { correct: 'Well done!', wrong: { 1: k === 0 ? LONG_WRONG : `The ${options[1]} is a different part.`, 2: `The ${options[2]} is a different part.` } },
  source_quote: moment(options[0]), teaching_error: null,
});
const quiz = () => PARTS.map(gq);
const TRANSCRIPT = PARTS.map((p) => `Teacher: ${moment(p[1])}.`).join('\n').repeat(4);

function reply(obj) { return { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.01 } }; }
const promptOf = (call) => call[0].messages[0].content;
const isReasons = (call) => /READ ALOUD to a child/.test(call.messages[0].content);
function wire({ gates }) {
  const settings = gates === undefined ? [] : [{ key: 'quiz_author_gates_v2', value: gates }];
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{
      id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: DIGEST.topic, subject: 'science', language: 'en', status: 'generating', meta: { digest: DIGEST, grade: '2', step: 'author' },
    }] }),
    coaching_sessions: { data: [{ id: SID, user_id: 'u-1', transcript_text: TRANSCRIPT, transcript_language: 'en', created_at: '2026-09-24T04:00:00Z', analysis_data: {}, users: { phone_number: '923001234567', preferred_language: 'en', name: 'A B' } }] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [{ phone_number: '923001234567', preferred_language: 'en' }] },
    app_settings: (calls) => {
      const eq = calls.find((c) => c[0] === 'eq' && c[1] === 'key');
      const inn = calls.find((c) => c[0] === 'in' && c[1] === 'key');
      const keys = eq ? [eq[2]] : (inn ? inn[2] : []);
      return { data: settings.filter((r) => keys.includes(r.key)) };
    },
  });
}
const storedRows = () => { const ins = supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert'); return ins.length ? ins[0][1] : []; };
const lastMeta = () => {
  const ups = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]).filter((u) => u.meta);
  return ups.length ? ups[ups.length - 1].meta : {};
};
/** The reasons call answers each id with a short text (id order follows the prompt). */
function shortReply(call) {
  const ids = [...promptOf([call]).matchAll(/"id":(\d+)[^\n]*"kind":"(\w+)"/g)].map((m) => ({ id: Number(m[1]), kind: m[2] }));
  return reply({ texts: ids.map(({ id, kind }) => ({ id, text: kind === 'wrong' ? SHORT_WRONG.split(' ').slice(0, 3).join(' ').replace('.', '') + '.' : SHORT })) });
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
afterEach(() => GatesV2.setEnabled(false));

describe('on the generate path', () => {
  test('flag on: the long reasons of a grade 2 quiz are shortened in place; stems, options and keys are unchanged', async () => {
    mockCreate.mockImplementation((call) => (isReasons(call)
      ? Promise.resolve(shortReply(call))
      : Promise.resolve(reply({ lesson_summary: SUMMARY, questions: quiz() }))));
    wire({ gates: true });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const rows = storedRows();
    expect(rows.length).toBeGreaterThanOrEqual(6);
    const q0 = rows.find((x) => x.question_text === PARTS[0][0]);
    expect(q0.explanation).toBe(SHORT);
    expect(Object.values(q0.option_feedback.wrong)).not.toContain(LONG_WRONG);
    // the key and the options did not move
    rows.forEach((row) => {
      const src = PARTS.find((p) => p[0] === row.question_text);
      expect(src).toBeTruthy();
      expect([row.option_a, row.option_b, row.option_c].sort()).toEqual(src.slice(1).sort());
      expect(row['option_' + row.correct_option.toLowerCase()]).toBe(src[1]);
    });
    const rec = lastMeta().child_reasons;
    expect(rec).toEqual(expect.objectContaining({ band: '1-2', targets: 2, rewritten: 2, still_long: 0, status: 'shortened' }));
    expect(rec.words_after).toBeLessThan(rec.words_before);
    expect(logEvent.mock.calls.map((c) => c[0])).toContain('transcript_quiz.child_reasons');
  });

  test('flag on, the call fails: the quiz ships with its reasons as authored, counted', async () => {
    mockCreate.mockImplementation((call) => (isReasons(call)
      ? Promise.reject(Object.assign(new Error('boom'), { code: 'NOPE' }))
      : Promise.resolve(reply({ lesson_summary: SUMMARY, questions: quiz() }))));
    wire({ gates: true });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(storedRows().length).toBeGreaterThanOrEqual(6);
    expect(storedRows().find((x) => x.question_text === PARTS[0][0]).explanation).toBe(LONG);
    expect(lastMeta().child_reasons).toEqual(expect.objectContaining({ status: 'error', rewritten: 0 }));
  });

  test('flag off: no reasons call, the text is as authored, no record', async () => {
    mockCreate.mockImplementation(() => Promise.resolve(reply({ lesson_summary: SUMMARY, questions: quiz() })));
    wire({ gates: undefined });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(storedRows().find((x) => x.question_text === PARTS[0][0]).explanation).toBe(LONG);
    expect(lastMeta().child_reasons).toBeUndefined();
    expect(mockCreate.mock.calls.filter((c) => isReasons(c[0]))).toHaveLength(0);
  });
});
