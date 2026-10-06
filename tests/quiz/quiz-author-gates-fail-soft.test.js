'use strict';
/**
 * THE QUIZ AUTHOR'S GATES FAIL SOFT — behind app_settings quiz_author_gates_v2.
 *
 * Measured with the gates on, on ten real sources: two teachers got NO quiz.
 * (1) A grade 2 lesson: the source check dropped two questions whose ONLY fault
 *     was a stem over eight words (a soft fault the rewrite could not shorten),
 *     so when the key check then found one real contradiction there was no room
 *     to drop it ("would leave 5, under the floor of 6") and the quiz failed.
 *     Gate stacking: a soft fault spent the margin a hard fault needed.
 * (2) An Urdu lesson: a set-level complaint no repair could reach (see the
 *     transliteration suite).
 *
 * What this suite pins, flag on:
 *   - a soft fault (a long grade 1-2 stem) is repaired, or SHIPPED AND COUNTED;
 *     it never costs the quiz a question;
 *   - a hard fault (a key the lesson contradicts, a key a blind solver rejects)
 *     is rewritten, else dropped; and when dropping would take the quiz under
 *     its floor, ONE targeted call writes REPLACEMENT questions from the lesson,
 *     re-checked like any other, before the quiz is ever refused;
 *   - a quiz is refused only when the replacements fail too, with that reason.
 * Flag off: exactly today's behaviour.
 *
 * The model is faked at the network boundary (llm-client); the solver at the
 * generate step's own verifyKeys seam, as every other suite does. The author,
 * the rewrite, the validator, the source check and the key check run for real.
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
  // the lesson's other moments, which a replacement question is written from
  ...[11, 12, 13].map((i) => `[${i}:00] Teacher: ${said(i)}.`),
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
let route = null;
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
  route = null;
  authorReply = { lesson_summary: 'You taught adding with carrying, ones first.', questions: [EIGHT[0], EIGHT[1], INVENTED, ...EIGHT.slice(3)] };
  rewriteReply = { questions: [REPLACEMENT] };
  const create = jest.fn(async (params) => {
    if (route) { const out = await route(params.messages[0].content); if (out) return reply(out); }
    const prompt = params.messages[0].content;
    if (/You are writing a short WhatsApp quiz/.test(prompt)) { prompts.author.push(prompt); return reply(authorReply); }
    if (/You are FIXING a short WhatsApp quiz/.test(prompt)) { prompts.rewrite.push(prompt); return reply(rewriteReply); }
    throw new Error(`unexpected model call: ${prompt.slice(0, 80)}`);
  });
  LLM.getClientForModel.mockReturnValue({ client: { chat: { completions: { create } } }, model: 'fake' });
});

// ── helpers for this suite ───────────────────────────────────────────────────
const KV = require('../../bot/shared/services/quiz/transcript-quiz-key-verify.service');
const GatesV2 = require('../../bot/shared/services/quiz/quiz-author-gates-v2');
const LpFixture = require('./helpers/lp-key-check-fixture');
const { logEvent } = require('../../bot/shared/utils/structured-logger');

/** A grade 1-2 stem over eight words that still asks the same sum. */
const LONG = (q, i) => ({ ...q, question: `Today the class added in columns, so now tell me what is ${100 + i} + ${20 + i}?` });
const asked = (prompt) => [...String(prompt).matchAll(/^q(\d+) · /gm)].map((m) => Number(m[1]));
/** One new question for each slot the replacement call asks for, from the lesson's other moments. */
const replacementsFor = (prompt) => asked(prompt).map((index, k) => ({
  index, ...goodQuestion(11 + k, index % 2 ? 'S2' : 'S1', index % 2 ? 'understand' : 'apply'), figure: null, figure_role: null,
}));
const failedMeta = () => supabase.from.callsFor('quizzes').flat()
  .filter((c) => c[0] === 'update' && c[1] && c[1].status === 'failed').map((c) => c[1].meta).pop();

/** A blind solver that finds no right option on the questions `bad` picks, and agrees with every other key. */
function solverRejecting(bad) {
  return jest.spyOn(Gen, 'verifyKeys').mockImplementation(async ({ questions, indices = null }) => {
    const idx = Array.isArray(indices) ? indices : questions.map((_, i) => i);
    return {
      verdicts: idx.map((index) => {
        const keyed = KV.keyedIndices(questions[index]);
        return bad(questions[index])
          ? { index, verdict: 'none_correct', keyed, blind: [], note: 'no option is right' }
          : { index, verdict: 'agree', keyed, blind: keyed, note: '' };
      }),
      model: 'stub-solver', costUsd: 0.001, latencyMs: 1,
    };
  });
}
const ORIGINAL_135 = (q) => /^Question [135]:/.test(String(q && q.question));

// ── 1. a soft fault never spends the margin ──────────────────────────────────

test('flag on: a long grade 1-2 stem is never CUT — no shortening rewrite; it ships whole and is counted', async () => {
  // Live, 5 Oct: the shortening rewrite turned "Bunty lifts 7 toys onto the shelf. How many stay on the floor?"
  // into "Bunty has 20 toys. Picks 7 up. How many?" — 7 and 13 both defensible. The web reads a stem aloud;
  // a spoken long stem beats a cut one.
  wire({ gates: true });
  authorReply = { lesson_summary: 'You taught adding with carrying, ones first.', questions: EIGHT.map((q, i) => ([3, 5, 7].includes(i) ? LONG(q, i + 1) : q)) };
  const r = await Gen.process(QID, { phone: PHONE });
  expect(r).toEqual(expect.objectContaining({ ok: true }));
  expect(prompts.rewrite.filter((p) => /STEM_TOO_LONG_G12/.test(p))).toHaveLength(0);   // nobody is asked to cut it
  const rows = inserted();
  expect(rows).toHaveLength(8);                        // nothing dropped for length
  expect(rows.map((x) => x.question_text)).toContain(LONG(EIGHT[3], 4).question);         // the stem as written
  expect(readyMeta().source_fidelity).toMatchObject({
    refused: 3, dropped: 0, kept_unfixed: 3, kept_soft: 3,
    by_reason: { STEM_TOO_LONG_G12: 3 },
  });
  readyMeta().source_fidelity.items.forEach((it) => expect(it.outcome).toBe('kept_soft'));
});

test('flag on: beside a real fault on the same question, the rewrite fixes the fault and is not told to shorten', async () => {
  wire({ gates: true });
  authorReply = { lesson_summary: 'You taught adding with carrying, ones first.', questions: [EIGHT[0], EIGHT[1], { ...LONG(EIGHT[2], 3), source_quote: 'Which column do we add first?' }, ...EIGHT.slice(3)] };
  await Gen.process(QID, { phone: PHONE });
  expect(prompts.rewrite.length).toBeGreaterThan(0);
  expect(prompts.rewrite[0]).toMatch(/q2: SOURCE_QUOTE_IS_QUESTION/);
  expect(prompts.rewrite[0]).not.toMatch(/STEM_TOO_LONG_G12/);
});

test('flag off: long grade 1-2 stems are not looked at (no source check), as today', async () => {
  wire({ gates: undefined });
  authorReply = { lesson_summary: 'You taught adding with carrying, ones first.', questions: EIGHT.map((q, i) => ([3, 5, 7].includes(i) ? LONG(q, i + 1) : q)) };
  const r = await Gen.process(QID, { phone: PHONE });
  expect(r).toEqual(expect.objectContaining({ ok: true }));
  expect(inserted()).toHaveLength(8);
  expect(readyMeta().source_fidelity).toBeUndefined();
});

// ── 2. a hard fault the floor cannot spare is REPLACED from the lesson ──────

test('flag on: three keys a blind solver rejects, a rewrite that gives nothing → ONE replacement call from the lesson, and the quiz ships 8', async () => {
  wire({ gates: true });
  authorReply = { lesson_summary: 'You taught adding with carrying, ones first.', questions: EIGHT };
  solverRejecting(ORIGINAL_135);
  route = (prompt) => {
    if (!/You are FIXING a short WhatsApp quiz/.test(prompt)) return null;
    prompts.rewrite.push(prompt);
    return /REPLACE_FROM_SOURCE/.test(prompt) ? { questions: replacementsFor(prompt) } : { questions: [] };
  };
  const r = await Gen.process(QID, { phone: PHONE });
  expect(r).toEqual(expect.objectContaining({ ok: true }));
  const replaceCalls = prompts.rewrite.filter((p) => /REPLACE_FROM_SOURCE/.test(p));
  expect(replaceCalls).toHaveLength(1);                 // ONE targeted call
  expect(asked(replaceCalls[0])).toEqual([0, 2, 4]);         // "Question 1, 3, 5"
  expect(replaceCalls[0]).toMatch(/"source_quote"/);      // written from the lesson, quote and all
  // …and it is SHOWN the lesson's unused moments to copy (the rewrite otherwise sees only the digest)
  expect(replaceCalls[0]).toContain(said(11));
  expect(replaceCalls[0]).not.toContain(`«${said(2)}.»`);   // a moment a staying question already quotes is not offered
  const rows = inserted();
  expect(rows).toHaveLength(8);
  rows.forEach((row) => expect(row.question_text).not.toMatch(/^Question [135]:/));
  expect(readyMeta().key_verify).toMatchObject({ status: 'replaced', dropped: 0, replaced: 3 });
  expect(readyMeta().key_verify.disagreements.map((d) => d.outcome)).toEqual(['replaced', 'replaced', 'replaced']);
  const ev = logEvent.mock.calls.filter((c) => c[0] === 'transcript_quiz.replacement');
  expect(ev).toHaveLength(1);
  expect(ev[0][1]).toEqual(expect.objectContaining({ quizId: QID, after: 'key_verify', asked: 3, replaced: 3, left: 0 }));
});

test('flag on: replacements the solver still rejects → refused with the precise reason, never sent', async () => {
  wire({ gates: true });
  authorReply = { lesson_summary: 'You taught adding with carrying, ones first.', questions: EIGHT };
  solverRejecting((q) => ORIGINAL_135(q) || /^Question 1[123]:/.test(String(q.question)));
  route = (prompt) => {
    if (!/You are FIXING a short WhatsApp quiz/.test(prompt)) return null;
    prompts.rewrite.push(prompt);
    return /REPLACE_FROM_SOURCE/.test(prompt) ? { questions: replacementsFor(prompt) } : { questions: [] };
  };
  const r = await Gen.process(QID, { phone: PHONE });
  expect(r).toEqual(expect.objectContaining({ failed: true, reason: 'key_disagreement' }));
  expect(prompts.rewrite.filter((p) => /REPLACE_FROM_SOURCE/.test(p))).toHaveLength(1);
  expect(failedMeta().key_verify.refused).toMatch(/replacement/);
  expect(inserted()).toBeUndefined();
});

test('flag off: the same rejected keys fail the quiz exactly as today — no replacement call', async () => {
  wire({ gates: undefined });
  authorReply = { lesson_summary: 'You taught adding with carrying, ones first.', questions: EIGHT };
  solverRejecting(ORIGINAL_135);
  route = (prompt) => {
    if (!/You are FIXING a short WhatsApp quiz/.test(prompt)) return null;
    prompts.rewrite.push(prompt);
    return { questions: [] };
  };
  const r = await Gen.process(QID, { phone: PHONE });
  expect(r).toEqual(expect.objectContaining({ failed: true, reason: 'key_disagreement' }));
  expect(prompts.rewrite.filter((p) => /REPLACE_FROM_SOURCE/.test(p))).toHaveLength(0);
  expect(failedMeta().key_verify.refused).toMatch(/under the floor of 6/);
});

// ── 3. the lesson-plan key check: the stage that cost the grade 2 teacher ────

describe('the key check (a lesson-plan quiz), flag on', () => {
  const KEY_CHECK = /You are CHECKING THE ANSWER KEY/;
  const verdicts = (prompt, bad) => ({
    verdicts: [...String(prompt).matchAll(/^q(\d+): /gm)].map((m) => Number(m[1])).map((index) => (bad(index)
      ? { index, verdict: 'contradicts', quote: 'بہار سے بہاریں' }
      : { index, verdict: 'consistent', quote: '' })),
  });
  afterEach(() => GatesV2.setEnabled(false));

  test('contradictions the floor cannot spare are REPLACED from the lesson, re-checked, and the quiz keeps 8', async () => {
    GatesV2.setEnabled(true);
    jest.spyOn(Gen, 'renderFigures').mockResolvedValue({});
    jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
    const qs = EIGHT.map((q) => ({ ...q }));
    let checks = 0;
    route = (prompt) => {
      if (KEY_CHECK.test(prompt)) {
        checks += 1;
        // the authored keys at 1, 3, 5 contradict the lesson; the replacements do not
        return verdicts(prompt, (i) => checks === 1 && [1, 3, 5].includes(i));
      }
      if (!/You are FIXING a short WhatsApp quiz/.test(prompt)) return null;
      prompts.rewrite.push(prompt);
      return /REPLACE_FROM_SOURCE/.test(prompt) ? { questions: replacementsFor(prompt) } : { questions: [] };
    };
    const attempts = [];
    const kc = await Gen.runKeyCheck(Gen, {
      questions: qs, slideScript: LpFixture.SLIDE_SCRIPT, digest: DIGEST, language: 'en', quizId: QID, teacherId: TID,
      lessonSummary: 'The plan teaches adding with carrying.', gradeBand: '1-2', attempts, sourceText: TRANSCRIPT,
    });
    expect(kc.failed).toBeUndefined();
    expect(kc.changed).toBe(true);
    expect(kc.questions).toHaveLength(8);
    expect(kc.record).toMatchObject({ status: 'replaced', contradicted: 3, replaced: 3, dropped: 0 });
    expect(prompts.rewrite.filter((p) => /REPLACE_FROM_SOURCE/.test(p))).toHaveLength(1);
    expect(checks).toBe(2);                              // the replacements were checked again
  });

  test('flag off: the same contradictions fail the quiz as today (key_conflict)', async () => {
    GatesV2.setEnabled(false);
    jest.spyOn(Gen, 'renderFigures').mockResolvedValue({});
    jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
    route = (prompt) => {
      if (KEY_CHECK.test(prompt)) return verdicts(prompt, (i) => [1, 3, 5].includes(i));
      if (!/You are FIXING a short WhatsApp quiz/.test(prompt)) return null;
      prompts.rewrite.push(prompt);
      return { questions: [] };
    };
    const kc = await Gen.runKeyCheck(Gen, {
      questions: EIGHT.map((q) => ({ ...q })), slideScript: LpFixture.SLIDE_SCRIPT, digest: DIGEST, language: 'en', quizId: QID,
      teacherId: TID, lessonSummary: 'The plan teaches adding with carrying.', gradeBand: '1-2', attempts: [],
    });
    expect(kc.failed).toBe(true);
    expect(kc.record.refused).toMatch(/under the floor of 6/);
    expect(prompts.rewrite.filter((p) => /REPLACE_FROM_SOURCE/.test(p))).toHaveLength(0);
  });
});
