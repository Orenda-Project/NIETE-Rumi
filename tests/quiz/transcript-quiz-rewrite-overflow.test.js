'use strict';
/**
 * More faulted questions than one targeted rewrite takes (five).
 *
 * The rewrite answered "more than five" with NOTHING: the whole list was
 * refused, so a quiz whose faults were verbs that guess the child's gender or
 * two English terms side by side — faults repaired in place, never a reason to
 * re-author — shipped every one of them (a replay of a grade 3 Urdu fractions
 * lesson, 24 Sep 2026; on production, 1–24 Sep, one quiz shipped seven such
 * questions). And an attempt with a few real faults plus a handful of in-place
 * ones went over the cap on the in-place ones alone and was thrown away whole
 * (22 production quizzes in the same window).
 *
 * Now: the worst five are rewritten — the key's truth first, then how a
 * question speaks to the child, then English terms side by side, then Latin
 * names, then the rest — the merged set is validated again, and what is left
 * gets ONE second batch. Never a third. More than five questions that need
 * re-asking (not repairing in place) is still a re-roll on an early attempt.
 *
 * Mocked at the network boundary only (the LLM client), plus supabase, WhatsApp,
 * the queue, R2 and the PDF renderer. The author, the validator, the targeted
 * rewrite and generate all run for real.
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
const Rewrite = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');

const QID = '99999999-9999-4999-8999-999999999999';
const SID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DIGEST = {
  topic: 'Singular and plural', topic_as_taught: 'واحد اور جمع', subject: 'urdu',
  grade_band: '6-8', language_of_instruction: 'ur', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'واحد اور جمع کی پہچان', taught_level: 'recall' },
    { id: 'S2', statement: 'جمع بنانے کی علامتیں', taught_level: 'understand' },
    { id: 'S3', statement: 'جمع پہچاننے کا طریقہ', taught_level: 'understand' },
  ],
  key_terms: ['واحد', 'جمع', 'noun', 'suffix'], examples_used: ['کتاب', 'بستہ'], misconceptions_surfaced: [],
};
const SUMMARY = 'آپ نے کتاب اور بستے کی مثالوں سے واحد اور جمع کا فرق پڑھایا اور جمع کی علامتیں دکھائیں۔';
const CTX = { language: 'ur', subject: 'urdu', digest: DIGEST, nExpected: 8, lessonSummary: SUMMARY, quizId: QID };

function uq({ slo = 'S1', level = 'recall', question, options, explanation }) {
  return {
    slo_id: slo, level, question, options, correct_index: 0,
    explanation: explanation || 'جمع کا لفظ ایک سے زیادہ چیزیں بتاتا ہے۔',
    selected_because: 'سبق میں کتاب اور بستے کی مثال سے لیا گیا',
    distractor_misconceptions: { 1: 'واحد کو جمع سمجھنا', 2: 'علامت کو نظر انداز کرنا' },
    option_feedback: {
      correct: 'شاباش! یہ جمع کا لفظ ہے۔',
      wrong: { 1: 'یہ واحد ہے؛ جمع کے آخر میں اکثر «یں» یا «ے» آتا ہے۔', 2: 'اس لفظ میں جمع کی علامت نہیں ہے۔' },
    },
  };
}
function eight() {
  return [
    uq({ question: 'ان میں سے کون سا لفظ جمع ہے؟', options: ['کتابیں', 'کتاب', 'میز'] }),
    uq({ slo: 'S2', level: 'understand', question: 'لفظ «بستہ» کی جمع کیا ہے؟', options: ['بستے', 'بستہ', 'بستیں'] }),
    uq({ slo: 'S2', level: 'understand', question: 'جمع بنانے کے لیے «کتاب» کے آخر میں کون سی علامت لگانی چاہیے؟', options: ['یں', 'ے', 'وں'] }),
    uq({ question: 'ان میں سے کون سا لفظ واحد ہے؟', options: ['کتاب', 'کتابیں', 'بستے'] }),
    uq({ slo: 'S3', level: 'understand', question: 'کون سا لفظ جمع میں بھی ویسا ہی رہتا ہے؟', options: ['پھول', 'کتاب', 'بستہ'] }),
    uq({ question: 'لفظ «بچہ» کی جمع کیا ہے؟', options: ['بچے', 'بچوں', 'بچہ'] }),
    uq({ slo: 'S2', level: 'understand', question: 'ان میں سے کس جملے میں جمع کا لفظ ہے؟', options: ['میرے پاس دو کتابیں ہیں', 'میرے پاس ایک کتاب ہے', 'یہ میری کتاب ہے'] }),
    uq({ slo: 'S3', level: 'understand', question: 'جمع پہچاننے کے لیے لفظ کے کس حصے کو دیکھنا چاہیے؟', options: ['آخری حصے کو', 'پہلے حرف کو', 'لفظ کی لمبائی کو'] }),
  ];
}

// The faults, planted on one question each.
/** A verb that guesses the child is a boy — repaired in place. */
const GENDERED = (q) => ({ ...q, option_feedback: { ...q.option_feedback, wrong: { ...q.option_feedback.wrong, 1: 'آپ سوچ رہے ہیں کہ ہر لفظ کے آخر میں «ے» آتا ہے۔' } } });
/** Two English terms side by side — repaired in place. */
const ADJACENT = (q) => ({ ...q, option_feedback: { ...q.option_feedback, wrong: { ...q.option_feedback.wrong, 2: 'اس لفظ کے noun suffix میں جمع کی علامت نہیں ہے۔' } } });
/** A key defended by the class against the fact — must be re-asked. */
const BY_AUTHORITY = (q) => ({ ...q, explanation: 'بستہ کی جمع بستے ہے، لیکن استاد نے کلاس میں بستیں کو بھی درست مانا تھا۔' });
const CLEAN = eight();

function reply(obj) { return { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.01 } }; }
const promptOf = (call) => call[0].messages[0].content;
const isRewrite = (call) => /REWRITE THESE QUESTIONS/.test(call.messages[0].content);
const asked = (prompt) => ((/REWRITE THESE QUESTIONS: ([^\n]+)/.exec(prompt) || [])[1] || '').split(', ').map((s) => Number(s.slice(1)));
/** A rewrite that repairs every question it is asked for, back to the clean one. */
const repairsAll = (call) => reply({ questions: asked(call.messages[0].content).map((i) => ({ index: i, ...CLEAN[i] })) });

function wire() {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{
      id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: DIGEST.topic, subject: 'urdu', language: 'ur', status: 'generating', meta: { digest: DIGEST, grade: '7', step: 'author' },
    }] }),
    coaching_sessions: { data: [{ id: SID, user_id: 'u-1', transcript_text: 'سبق '.repeat(400), transcript_language: 'ur', created_at: '2026-09-23T04:00:00Z', analysis_data: {}, users: { phone_number: '923001234567', preferred_language: 'ur', name: 'A B' } }] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [{ phone_number: '923001234567', preferred_language: 'ur' }] },
  });
}
const storedRows = () => { const ins = supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert'); return ins.length ? ins[0][1] : []; };
const lastMeta = () => {
  const ups = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]).filter((u) => u.meta);
  return ups.length ? ups[ups.length - 1].meta : {};
};
const rewrites = () => mockCreate.mock.calls.filter((c) => isRewrite(c[0])).map(promptOf);
const authorCalls = () => mockCreate.mock.calls.filter((c) => !isRewrite(c[0]));
const author = (questions) => (call) => (isRewrite(call) ? repairsAll(call) : reply({ lesson_summary: SUMMARY, questions }));

beforeEach(() => {
  jest.clearAllMocks(); mockCreate.mockReset();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true'; delete process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS;
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  jest.spyOn(Gen, 'renderFigures').mockResolvedValue({});
  jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
});

describe('more than five faulted questions', () => {
  test('the planted faults are what the validator sees', () => {
    const qs = CLEAN.map((q, i) => (i < 6 ? GENDERED(q) : q));
    expect(validate(qs, CTX).errors.filter((e) => /PEDAGOGY_GENDERED_CHILD/.test(e))).toHaveLength(6);
    expect(validate([ADJACENT(CLEAN[0]), ...CLEAN.slice(1)], CTX).errors).toEqual([expect.stringMatching(/^q0: URDU_ADJACENT_TERMS/)]);
    expect(validate([CLEAN[0], BY_AUTHORITY(CLEAN[1]), ...CLEAN.slice(2)], CTX).errors).toEqual([expect.stringMatching(/^q1: KEY_BY_AUTHORITY/)]);
  });

  test('six of eight speak to the child with a gender: five are repaired, then the sixth, and the quiz ships clean', async () => {
    const bad = CLEAN.map((q, i) => (i < 6 ? GENDERED(q) : q));
    mockCreate.mockImplementation(author(bad));
    wire();

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const [first, second] = rewrites();
    expect(asked(first)).toEqual([0, 1, 2, 3, 4]);
    expect(asked(second)).toEqual([5]);
    expect(rewrites()).toHaveLength(2);
    expect(authorCalls()).toHaveLength(1);                 // repaired, never re-authored
    expect(storedRows()).toHaveLength(8);
    expect(lastMeta().soft_faults).toBeUndefined();
  });

  test('the worst go first: the class\'s key, then the child\'s gender, then English terms side by side', async () => {
    // q7: key defended by the class (re-ask) · q1, q3, q5: gendered · q0, q2, q4: adjacent terms.
    const bad = CLEAN.map((q, i) => {
      if (i === 7) return BY_AUTHORITY(q);
      if ([1, 3, 5].includes(i)) return GENDERED(q);
      if ([0, 2, 4].includes(i)) return ADJACENT(q);
      return q;
    });
    mockCreate.mockImplementation(author(bad));
    wire();

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const [first, second] = rewrites();
    expect(asked(first)).toEqual([0, 1, 3, 5, 7]);          // chosen by harm, listed by position
    expect(first).toContain('KEY BY AUTHORITY.');
    expect(asked(second)).toEqual([2, 4]);
    expect(authorCalls()).toHaveLength(1);
    expect(storedRows()).toHaveLength(8);
    expect(lastMeta().soft_faults).toBeUndefined();
  });

  test('never more than two batches: a rewrite that repairs nothing leaves the in-place faults recorded, and the quiz still ships', async () => {
    const bad = CLEAN.map((q, i) => (i < 7 ? GENDERED(q) : q));
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? reply({ questions: asked(call.messages[0].content).map((i) => ({ index: i, ...bad[i] })) })   // the same verbs back
      : reply({ lesson_summary: SUMMARY, questions: bad })));
    wire();

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(rewrites()).toHaveLength(2);
    // the second batch gives the two the first left out their turn
    expect(asked(rewrites()[0])).toEqual([0, 1, 2, 3, 4]);
    expect(asked(rewrites()[1])).toEqual([0, 1, 2, 5, 6]);
    expect(authorCalls()).toHaveLength(1);
    expect(storedRows()).toHaveLength(8);
    expect((lastMeta().soft_faults || []).filter((e) => /PEDAGOGY_GENDERED_CHILD/.test(e))).toHaveLength(7);
  });
});

describe('which questions one rewrite takes', () => {
  const g = (i) => `q${i}: PEDAGOGY_GENDERED_CHILD — verbs`;
  const a = (i) => `q${i}: URDU_ADJACENT_TERMS — terms`;
  const k = (i) => `q${i}: KEY_BY_AUTHORITY — class`;
  const hard = (i) => `q${i}: duplicate options`;

  test('chosen by harm, then by position; the rest wait for the second batch', () => {
    const t = Rewrite.rewriteTargets([a(0), g(1), a(2), g(3), hard(4), g(5), k(7)], { partial: true });
    expect(t.indices).toEqual([0, 1, 3, 5, 7]);
    expect(t.deferred).toEqual([2, 4]);
    expect(Object.keys(t.byIndex).map(Number).sort((x, y) => x - y)).toEqual([0, 1, 3, 5, 7]);
  });

  test('more than five questions that need re-asking is still a re-roll on an early attempt', () => {
    const errs = [0, 1, 2, 3, 4, 5].map(hard);
    expect(Rewrite.rewriteTargets(errs, { partial: 'in_place' }).indices).toEqual([]);
    // …but in-place faults never push a repairable set over the cap
    expect(Rewrite.rewriteTargets([hard(0), hard(1), g(2), g(3), a(4), a(5)], { partial: 'in_place' }).indices).toHaveLength(5);
  });

  test('without the option, the cap behaves exactly as before', () => {
    expect(Rewrite.rewriteTargets([0, 1, 2, 3, 4, 5].map(g)).indices).toEqual([]);
  });
});
