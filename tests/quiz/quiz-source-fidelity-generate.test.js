'use strict';
/**
 * SOURCE FIDELITY at generation, behind app_settings quiz_author_gates_v2.
 *
 * On: the author is asked for each question's source_quote; a question whose
 * quote cannot carry its answer is re-authored through the targeted rewrite
 * (never shipped as it was); one the rewrite cannot fix is dropped; the counts
 * and any teaching error land in quizzes.meta.source_fidelity.
 * Off: the author prompt, the calls and the rows are exactly today's.
 *
 * The model is faked at the network boundary (llm-client): the real author,
 * the real rewrite, the validator and the gate all run.
 */
jest.mock('../../bot/shared/services/llm-client', () => ({ getClientForModel: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn(), normaliseDigest: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'T', topic: 'Carrying' }),
  botNumber: jest.fn().mockReturnValue('923000000000'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const LLM = require('../../bot/shared/services/llm-client');
const Digest = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
const Share = require('../../bot/shared/services/quiz/video-quiz-share.service');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const WebItems = require('../../bot/shared/services/quiz/web-quiz-items');
const { installAgreeingSolver } = require('./helpers/key-verify-agree');
const { installNoPictureRepair } = require('./helpers/no-picture-repair');

const QID = '44444444-4444-4444-8444-444444444444';
const TID = '55555555-5555-4555-8555-555555555555';
const SID = '66666666-6666-4666-8666-666666666666';
const PHONE = '923001234567';
const QUIZ = {
  id: QID, teacher_id: TID, coaching_session_id: SID, quiz_source: 'transcript', topic: 'Carrying', subject: 'maths',
  language: 'en', status: 'generating', grade: '2', meta: { step: 'digest', source: 'list' },
};
const USER = { id: TID, name: 'T', phone_number: PHONE, preferred_language: 'en' };
const DIGEST = {
  topic: 'Adding with carrying', topic_as_taught: 'Adding with carrying', subject: 'maths', grade_band: '1-2', confidence: 0.9,
  slos: [{ id: 'S1', statement: 'a', statement_en: 'a', statement_ur: 'ا', taught_level: 'apply' },
    { id: 'S2', statement: 'b', statement_en: 'b', statement_ur: 'ب', taught_level: 'understand' }],
  key_terms: [], examples_used: ['146 + 27'], misconceptions_surfaced: ['carries out of every column'],
};
const said = (i) => `${100 + i} plus ${20 + i} makes ${120 + 2 * i}, ones first, then tens`;
function goodQuestion(i, slo, level) {
  return {
    slo_id: slo, level, question: `Question ${i}: what is ${100 + i} + ${20 + i}?`,
    options: [`${120 + 2 * i}`, `${130 + 2 * i}`, `${110 + 2 * i}`], correct_index: 0,
    explanation: `Add the ones, then the tens: ${120 + 2 * i}.`,
    selected_because: `Question ${i} checks adding two numbers in columns.`,
    distractor_misconceptions: { 1: 'carried when no column reached ten', 2: 'dropped a ten' },
    option_feedback: { correct: 'Yes — ones first, then tens.', wrong: { 1: 'No column reached ten, so nothing carries.', 2: 'A ten was lost from the tens column.' } },
    source_quote: said(i), teaching_error: null,
  };
}
const EIGHT = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => goodQuestion(i, i % 2 ? 'S1' : 'S2', i % 2 ? 'apply' : 'understand'));
const TRANSCRIPT = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `[0${i}:00] Teacher: ${said(i)}.`),
  '[09:00] Teacher: Which column do we add first?',
  '[10:00] Teacher: We carry when a column reaches ten: 146 plus 27 makes 173.',
].join('\n').repeat(3);
const SESSION = {
  id: SID, user_id: TID, status: 'completed', observation_type: null, transcript_text: TRANSCRIPT, transcript_language: 'en',
  analysis_data: { topic: 'Carrying', subject: 'maths' }, created_at: '2026-09-22T05:00:00Z', users: USER,
};
// q2 quotes the teacher's QUESTION, not the moment that answers it.
const INVENTED = { ...EIGHT[2], source_quote: 'Which column do we add first?' };
const REPLACEMENT = {
  index: 2, slo_id: 'S1', level: 'apply', question: 'What is 146 + 27?', options: ['173', '163', '1713'], correct_index: 0,
  explanation: 'The ones make 13, so carry 1 ten: 173.', selected_because: 'The class carried a ten in 146 plus 27.',
  distractor_misconceptions: { 1: 'forgot to carry the ten', 2: 'wrote 13 in the ones' },
  option_feedback: { correct: 'Yes — 13 ones is 1 ten and 3 ones.', wrong: { 1: 'The carried ten was left out.', 2: '13 ones is one ten and three ones.' } },
  figure: null, figure_role: null, source_quote: 'We carry when a column reaches ten: 146 plus 27 makes 173', teaching_error: null,
};

let prompts;
let authorReply;
let rewriteReply;
function reply(json) {
  return { choices: [{ message: { content: JSON.stringify(json) }, finish_reason: 'stop' }], usage: { cost: 0.002 } };
}
function wire({ gates }) {
  const settings = gates === undefined ? [] : [{ key: 'quiz_author_gates_v2', value: gates }];
  installFrom(supabase.from, ({
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [QUIZ] }),
    coaching_sessions: { data: [SESSION] },
    niete_lp_downloads: { data: [] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [USER] },
    // the rows the query names, as the database would return them
    app_settings: (calls) => {
      const eq = calls.find((c) => c[0] === 'eq' && c[1] === 'key');
      const inn = calls.find((c) => c[0] === 'in' && c[1] === 'key');
      const keys = eq ? [eq[2]] : (inn ? inn[2] : []);
      return { data: settings.filter((r) => keys.includes(r.key)) };
    },
  }));
}
const inserted = () => supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert').map((c) => c[1]).pop();
const readyMeta = () => supabase.from.callsFor('quizzes').flat()
  .filter((c) => c[0] === 'update' && c[1] && c[1].status === 'ready').map((c) => c[1].meta).pop();

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  installNoPictureRepair(Gen);
  WebItems.__resetCache();
  WhatsAppService.sendMessage.mockResolvedValue(true);
  Share.mintCode.mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'T', topic: 'Carrying' });
  Digest.run.mockResolvedValue({ digest: DIGEST, grade: '2', gradeSource: 'profile', lpHint: null, model: 'dm', costUsd: 0.002 });
  prompts = { author: [], rewrite: [] };
  authorReply = { lesson_summary: 'You taught adding with carrying, ones first.', questions: [EIGHT[0], EIGHT[1], INVENTED, ...EIGHT.slice(3)] };
  rewriteReply = { questions: [REPLACEMENT] };
  const create = jest.fn(async (params) => {
    const prompt = params.messages[0].content;
    if (/You are writing a short WhatsApp quiz/.test(prompt)) { prompts.author.push(prompt); return reply(authorReply); }
    if (/You are FIXING a short WhatsApp quiz/.test(prompt)) { prompts.rewrite.push(prompt); return reply(rewriteReply); }
    throw new Error(`unexpected model call: ${prompt.slice(0, 80)}`);
  });
  LLM.getClientForModel.mockReturnValue({ client: { chat: { completions: { create } } }, model: 'fake' });
});

test('flag off: the author prompt asks for no source quote, no rewrite runs, the invented row ships as today', async () => {
  wire({ gates: undefined });
  const r = await Gen.process(QID, { phone: PHONE });
  expect(r).toEqual(expect.objectContaining({ ok: true }));
  expect(prompts.author.length).toBeGreaterThan(0);
  prompts.author.forEach((p) => expect(p).not.toMatch(/THE ANSWER COMES FROM THE LESSON|source_quote/));
  expect(prompts.rewrite).toHaveLength(0);
  expect(inserted()).toHaveLength(8);
  expect(readyMeta().source_fidelity).toBeUndefined();
});

test('flag on: the quote that cannot carry its answer is RE-AUTHORED on the lesson\'s own example, and counted', async () => {
  wire({ gates: 'true' });
  const r = await Gen.process(QID, { phone: PHONE });
  expect(r).toEqual(expect.objectContaining({ ok: true }));
  prompts.author.forEach((p) => expect(p).toMatch(/THE ANSWER COMES FROM THE LESSON[\s\S]*GRADE 1-2 READING LOAD/));
  // the JSON the model copies carries the two fields, or it leaves them out
  prompts.author.forEach((p) => expect(p).toMatch(/"figure_role": null, "source_quote": "", "teaching_error": null \}/));
  expect(prompts.rewrite).toHaveLength(1);
  expect(prompts.rewrite[0]).toMatch(/q2: SOURCE_QUOTE_IS_QUESTION/);
  expect(prompts.rewrite[0]).toMatch(/"source_quote"/);
  const rows = inserted();
  expect(rows).toHaveLength(8);
  expect(rows.map((x) => x.question_text)).toContain('What is 146 + 27?');
  expect(rows.map((x) => x.question_text)).not.toContain(INVENTED.question);
  expect(readyMeta().source_fidelity).toMatchObject({
    status: 'rewritten', checked: 8, refused: 1, rewritten: 1, dropped: 0, kept_unfixed: 0,
    by_reason: { SOURCE_QUOTE_IS_QUESTION: 1 }, items: [expect.objectContaining({ index: 2, outcome: 'rewritten' })],
  });
});

test('flag on: a replacement that still does not carry its answer is DROPPED, never shipped as the invented row', async () => {
  wire({ gates: true });
  rewriteReply = { questions: [{ ...REPLACEMENT, source_quote: 'Zainab has fourteen marbles and gives seven away' }] };
  const r = await Gen.process(QID, { phone: PHONE });
  expect(r).toEqual(expect.objectContaining({ ok: true }));
  const rows = inserted();
  expect(rows).toHaveLength(7);
  expect(rows.map((x) => x.question_text)).not.toContain(INVENTED.question);
  expect(readyMeta().source_fidelity).toMatchObject({ status: 'dropped', refused: 1, rewritten: 0, dropped: 1 });
});

test('flag on: a teaching error the author flagged is recorded for the report, and nothing is refused', async () => {
  wire({ gates: 'true' });
  authorReply = {
    ...authorReply,
    questions: EIGHT.map((q, i) => (i === 4 ? { ...q, teaching_error: { said: 'the class said 12', correct: `${120 + 2 * 5} is right` } } : q)),
  };
  await Gen.process(QID, { phone: PHONE });
  expect(prompts.rewrite).toHaveLength(0);
  const sf = readyMeta().source_fidelity;
  expect(sf).toMatchObject({ status: 'clean', refused: 0 });
  expect(sf.teaching_errors).toEqual([expect.objectContaining({ said: 'the class said 12', correct: '130 is right', quote: said(5) })]);
});
