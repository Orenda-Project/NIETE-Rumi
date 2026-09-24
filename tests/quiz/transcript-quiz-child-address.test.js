'use strict';
/**
 * An Urdu quiz never guesses the child's gender.
 *
 * About one production Urdu item in ten asked the child what they would do in
 * the MASCULINE — «کون سی علامت لگائیں گے؟», «آپ اسے حوصلہ کیسے دیں گے؟»,
 * wrong-answer feedback opening «آپ سوچ رہے ہیں…» — and nothing objected: the
 * only child-address check was a list of feminine stems. That list also fired
 * on plain third-person Urdu («دو سطحیں رب کرتی ہیں», «بیماریاں ہو سکتی ہیں»,
 * even «ہو گیا»), and on real content it never once caught a feminine address
 * to a child. The classes are boys and girls; both guesses are wrong.
 *
 * What this suite pins:
 *   1. the validator names each question that addresses the child with a
 *      gendered verb — masculine or feminine, explicit آپ or آپ left unsaid —
 *      in its stem, options, explanation or feedback, and leaves third-person
 *      description, "we", an honorific آپ ﷺ and quoted example sentences alone;
 *   2. the author prompt and the targeted rewrite state the neutral forms;
 *   3. it is a SOFT fault: one in-place repair is tried, and whatever that
 *      leaves, the quiz ships whole with the fault recorded — never a re-roll,
 *      never a dropped question, never a failed quiz over one verb.
 *
 * The fixtures are synthetic. The detector was measured on real authored items
 * before it was wired (the numbers are in the pull request).
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
const F = require('./helpers/lp-key-check-fixture');
const Rewrite = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { buildAuthorPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');

const QID = '77777777-7777-4777-8777-777777777777';
const SID = '88888888-8888-4888-8888-888888888888';

const DIGEST = {
  topic: 'Singular and plural', topic_as_taught: 'واحد اور جمع', subject: 'urdu',
  grade_band: '6-8', language_of_instruction: 'ur', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'واحد اور جمع کی پہچان', taught_level: 'recall' },
    { id: 'S2', statement: 'جمع بنانے کی علامتیں', taught_level: 'understand' },
    { id: 'S3', statement: 'جمع پہچاننے کا طریقہ', taught_level: 'understand' },
  ],
  key_terms: ['واحد', 'جمع'], examples_used: ['کتاب', 'بستہ'], misconceptions_surfaced: [],
};
const SUMMARY = 'آپ نے کتاب اور بستے کی مثالوں سے واحد اور جمع کا فرق پڑھایا اور جمع کی علامتیں دکھائیں۔';
const CTX = { language: 'ur', subject: 'urdu', digest: DIGEST, nExpected: 8, lessonSummary: SUMMARY, quizId: QID };

function uq({ slo = 'S1', level = 'recall', question, options, explanation, correct, wrong }) {
  return {
    slo_id: slo, level, question, options, correct_index: 0,
    explanation: explanation || 'جمع کا لفظ ایک سے زیادہ چیزیں بتاتا ہے۔',
    selected_because: 'سبق میں کتاب اور بستے کی مثال سے لیا گیا',
    distractor_misconceptions: { 1: 'واحد کو جمع سمجھنا', 2: 'علامت کو نظر انداز کرنا' },
    option_feedback: {
      correct: correct || 'شاباش! یہ جمع کا لفظ ہے۔',
      wrong: wrong || { 1: 'یہ واحد ہے؛ جمع کے آخر میں اکثر «یں» یا «ے» آتا ہے۔', 2: 'اس لفظ میں جمع کی علامت نہیں ہے۔' },
    },
  };
}

// Eight neutral questions. Third-person description, "we" and quoted words are
// deliberately in here: they must NOT be read as addressing the child.
function eight() {
  return [
    uq({ question: 'ان میں سے کون سا لفظ جمع ہے؟', options: ['کتابیں', 'کتاب', 'میز'] }),
    uq({ slo: 'S2', level: 'understand', question: 'لفظ «بستہ» کی جمع کیا ہے؟', options: ['بستے', 'بستہ', 'بستیں'], explanation: 'ہم «ہ» کو «ے» سے بدل کر جمع بناتے ہیں۔' }),
    uq({ slo: 'S2', level: 'understand', question: 'جمع بنانے کے لیے «کتاب» کے آخر میں کون سی علامت لگانی چاہیے؟', options: ['یں', 'ے', 'وں'] }),
    uq({ question: 'ان میں سے کون سا لفظ واحد ہے؟', options: ['کتاب', 'کتابیں', 'بستے'] }),
    uq({ slo: 'S3', level: 'understand', question: 'کون سا لفظ جمع میں بھی ویسا ہی رہتا ہے؟', options: ['پھول', 'کتاب', 'بستہ'], explanation: 'پھول واحد اور جمع میں ایک جیسا رہتا ہے، جیسے باغ میں بچے پھول چن رہے ہیں۔' }),
    uq({ question: 'لفظ «بچہ» کی جمع کیا ہے؟', options: ['بچے', 'بچوں', 'بچہ'], explanation: 'بچیاں کتابیں جمع کرتی ہیں اور بچے بستے اٹھاتے ہیں — دونوں جملوں میں جمع کے لفظ ہیں۔' }),
    uq({ slo: 'S2', level: 'understand', question: 'ان میں سے کس جملے میں جمع کا لفظ ہے؟', options: ['میرے پاس دو کتابیں ہیں', 'میرے پاس ایک کتاب ہے', 'یہ میری کتاب ہے'], explanation: 'کتابیں میز پر رکھی جا سکتی ہیں؛ «کتابیں» جمع ہے۔' }),
    uq({ slo: 'S3', level: 'understand', question: 'جمع پہچاننے کے لیے لفظ کے کس حصے کو دیکھنا چاہیے؟', options: ['آخری حصے کو', 'پہلے حرف کو', 'لفظ کی لمبائی کو'] }),
  ];
}

// The shapes the bead names, planted on one question each.
const MASC_STEM = (q) => ({ ...q, question: 'اگر «کتاب» کی جمع بنانی ہو تو کون سی علامت لگائیں گے؟' });
const NEUTRAL_STEM = (q) => ({ ...q, question: 'اگر «کتاب» کی جمع بنانی ہو تو کون سی علامت لگانی چاہیے؟' });
const MASC_FEEDBACK = (q) => ({ ...q, option_feedback: { ...q.option_feedback, wrong: { ...q.option_feedback.wrong, 1: 'آپ سوچ رہے ہیں کہ ہر لفظ کے آخر میں «ے» آتا ہے۔' } } });

const errsFor = (qs) => validate(qs, CTX).errors;
const childErrs = (errs) => errs.filter((e) => /PEDAGOGY_GENDERED_CHILD/.test(e));

describe('1 — the validator names every question that addresses the child with a gendered verb', () => {
  test('the neutral fixture is clean', () => {
    expect(errsFor(eight())).toEqual([]);
  });

  test('a masculine future with آپ left unsaid, in the stem — «کون سی علامت لگائیں گے؟»', () => {
    const qs = eight(); qs[2] = MASC_STEM(qs[2]);
    const errs = childErrs(errsFor(qs));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/^q2: PEDAGOGY_GENDERED_CHILD — question\b/);
    expect(errs[0]).toContain('لگائیں گے');
  });

  test('explicit آپ with a masculine habitual in the explanation, and a masculine progressive in feedback', () => {
    const qs = eight();
    qs[1] = { ...qs[1], explanation: 'جمع بنانے کے لیے آپ آخر میں «ے» لگاتے ہیں۔' };
    qs[3] = MASC_FEEDBACK(qs[3]);
    const errs = childErrs(errsFor(qs));
    expect(errs.map((e) => e.slice(0, 3))).toEqual(['q1:', 'q3:']);
    expect(errs[0]).toMatch(/explanation/);
    expect(errs[1]).toMatch(/option_feedback/);
  });

  test('the feminine guess is the same fault, named per question', () => {
    const qs = eight(); qs[0] = { ...qs[0], option_feedback: { ...qs[0].option_feedback, correct: 'آپ سمجھ سکتی ہیں کہ یہ جمع ہے۔' } };
    const errs = childErrs(errsFor(qs));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/^q0: PEDAGOGY_GENDERED_CHILD/);
    expect(errs[0]).toContain('سکتی ہیں');
  });

  test('an option is the child\'s own answer — «آخر میں «یں» لگائیں گے» guesses the one answering', () => {
    const qs = eight();
    const opts = ['آخر میں «یں» لگائیں گے', 'آخر میں «ے» لگائیں گے', 'اسے ویسا ہی رہنے دیں گے'];
    // a neutral stem does not make the options neutral
    qs[2] = { ...qs[2], question: 'اگر «بہار» کی جمع بنانی ہو تو کیا کرنا چاہیے؟', options: opts };
    let errs = childErrs(errsFor(qs));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/^q2: PEDAGOGY_GENDERED_CHILD — options\b/);
    // a gendered stem and gendered options are ONE complaint for the question
    qs[2] = { ...qs[2], question: 'اگر «بہار» کی جمع بنانی ہو تو آپ کیا کریں گے؟' };
    errs = childErrs(errsFor(qs));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/^q2: PEDAGOGY_GENDERED_CHILD — question \+ options/);
  });

  test('third person, "we", honorific آپ ﷺ and quoted examples are never the child', () => {
    const qs = eight();
    qs[0] = { ...qs[0], explanation: 'دو سطحیں آپس میں رب کرتی ہیں تو رگڑ پیدا ہوتی ہے، اور بیماریاں ہو سکتی ہیں۔' };
    qs[1] = { ...qs[1], question: 'ہم «بستہ» کی جمع بنانے کے لیے کیا کریں گے؟', options: ['«ہ» کو «ے» سے بدلیں گے', 'کچھ نہیں بدلیں گے', 'آخر میں «وں» لگائیں گے'] };
    qs[3] = { ...qs[3], explanation: 'ہر دوست کو 7 کتابیں ملیں گی اور 4 کتابیں بچ جائیں گی۔' };
    qs[4] = { ...qs[4], question: 'جملہ «چنٹو اور رانی چاٹ کھائیں گے» میں جمع کا لفظ کون سا ہے؟', options: ['چنٹو اور رانی', 'چاٹ', 'کھائیں'] };
    qs[5] = { ...qs[5], explanation: 'آپ ﷺ ہمیشہ سچ بولتے تھے، اور جب دادا کا انتقال ہو گیا تو چچا نے پرورش کی۔' };
    qs[7] = { ...qs[7], option_feedback: { ...qs[7].option_feedback, correct: 'بالکل! آپ نے ٹھیک سوچا، اور آپ بہت محنتی ہیں۔' } };
    expect(childErrs(errsFor(qs))).toEqual([]);
    expect(errsFor(qs)).not.toContain('feminine-stem address');
  });

  test('every neutral form the rules recommend passes — a repair that follows them converges', () => {
    const qs = eight();
    qs[0] = { ...qs[0], question: 'آپ کون سی علامت لگائیں؟' };
    qs[1] = { ...qs[1], question: 'کون سا لفظ استعمال ہوگا؟', explanation: 'بہار کے آخر میں «یں» لگانا ہوگا، یوں 9 میں 7 جمع کیا جائے گا۔' };
    qs[2] = { ...qs[2], question: 'اگر «بہار» کی جمع بنانی ہو تو کیا کرنا چاہیے؟', options: ['آخر میں «یں» لگانا', 'آخر میں «ے» لگانا', 'کچھ نہ بدلنا'] };
    qs[3] = { ...qs[3], option_feedback: { ...qs[3].option_feedback, wrong: { 1: 'شاید آپ نے سمجھا کہ ہر لفظ کے آخر میں «ے» آتا ہے۔', 2: 'یہ «یں» اور «ے» کی الجھن ہے۔' } } };
    qs[4] = { ...qs[4], question: 'آپ نے کون سا لفظ چنا؟ بتائیں، کون سا لفظ جمع میں بھی ویسا ہی رہتا ہے؟' };
    expect(childErrs(errsFor(qs))).toEqual([]);
  });

  test('an option under a stem about the Prophet ﷺ reads its آپ as that honorific third person', () => {
    const qs = eight();
    qs[6] = { ...qs[6], question: 'غار میں فرشتے نے آپ ﷺ سے کیا کہا تھا؟', options: ['کہ آپ پڑھیں گے', 'کہ آپ سفر کریں گے', 'کہ آپ تجارت کریں گے'] };
    expect(childErrs(errsFor(qs))).toEqual([]);
  });

  test('the teacher too: a summary that speaks to the teacher with a gendered verb is the teacher-summary fault, repaired on its own', () => {
    const gendered = 'آج آپ نے بچوں کو واحد اور جمع سکھایا۔ آخر میں آپ نے بتایا کہ آپ ٹیسٹ کیسے لیں گی۔';
    const errs = validate(eight(), { ...CTX, lessonSummary: gendered }).errors;
    const summary = errs.filter((e) => /^PEDAGOGY_GENDERED_TEACHER — "lesson_summary"/.test(e));
    expect(summary).toHaveLength(1);
    expect(summary[0]).toContain('لیں گی');
    expect(Rewrite.rewriteTargets(errs).summary).toHaveLength(1);
    expect(Gen.SOFT_FAULT.test(summary[0])).toBe(true);
    // a subject named in one clause carries across «اور» into the next
    const named = 'آج آپ نے نظم پڑھائی۔ آپ نے بتایا کہ وہ جوابات دے سکیں گے، اور نظم درست تلفظ سے پڑھ سکیں گے۔';
    expect(validate(eight(), { ...CTX, lessonSummary: named }).errors).toEqual([]);
  });

  test('an English quiz is never checked for Urdu agreement', () => {
    const qs = eight(); qs[2] = MASC_STEM(qs[2]);
    expect(childErrs(validate(qs, { ...CTX, language: 'en' }).errors)).toEqual([]);
  });

  test('the complaint is one question\'s text to repair, and it is soft', () => {
    const qs = eight(); qs[2] = MASC_STEM(qs[2]);
    const errs = errsFor(qs);
    expect(Rewrite.rewriteTargets(errs).indices).toEqual([2]);
    errs.forEach((e) => expect(Gen.SOFT_FAULT.test(e)).toBe(true));
  });
});

describe('2 — the prompts state the neutral forms', () => {
  test('the author prompt names the gendered forms to avoid and the neutral ones to use, and no longer recommends a masculine form', () => {
    const p = buildAuthorPrompt({ digest: DIGEST, excerpts: 'x', language: 'ur', n: 8, gradeBand: '6-8' });
    expect(p).toContain('THE CHILD HAS NO GENDER');
    ['لگائیں گے', 'لگائیں گی', 'جاتے ہیں', 'سوچ رہے ہیں', 'لگانی چاہیے', 'استعمال ہوگا', 'بتائیں'].forEach((w) => expect(p).toContain(w));
    expect(p).not.toContain('سمجھ سکتے ہیں');
  });
});

// ── the generate path, the LLM mocked at the network boundary ────────────────
function reply(obj) { return { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.01 } }; }
const promptOf = (call) => call[0].messages[0].content;
const isRewrite = (call) => /REWRITE THESE QUESTIONS/.test(call.messages[0].content);
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

beforeEach(() => {
  jest.clearAllMocks(); mockCreate.mockReset();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true'; delete process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS;
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  jest.spyOn(Gen, 'renderFigures').mockResolvedValue({});
  jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
});

describe('3 — a soft fault: repaired in place, and the quiz ships whatever the repair leaves', () => {
  test('one masculine stem → ONE rewrite carrying the rule → the neutral question ships, 8 of 8', async () => {
    const bad = eight(); bad[2] = MASC_STEM(bad[2]);
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 2, ...NEUTRAL_STEM(eight()[2]) }] }))
      : Promise.resolve(reply({ lesson_summary: SUMMARY, questions: bad }))));
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const rw = promptOf(mockCreate.mock.calls[1]);
    expect(rw).toContain('REWRITE THESE QUESTIONS: q2');
    expect(rw).toContain('THE CHILD HAS NO GENDER');
    expect(rw).toMatch(/keep the SAME question/i);
    const rows = storedRows();
    expect(rows).toHaveLength(8);
    expect(rows.map((x) => x.question_text)).toContain(NEUTRAL_STEM(eight()[2]).question);
  });

  test('a repair that leaves the verb as it was SHIPS the quiz whole with the fault recorded — no re-roll, nothing dropped', async () => {
    const bad = eight(); bad[2] = MASC_STEM(bad[2]); bad[3] = MASC_FEEDBACK(bad[3]);
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 2, ...bad[2] }, { index: 3, ...bad[3] }] }))   // the same gendered text back
      : Promise.resolve(reply({ lesson_summary: SUMMARY, questions: bad }))));
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);          // one author call + one repair; never a second full attempt
    expect(storedRows()).toHaveLength(8);
    const faults = lastMeta().soft_faults || [];
    expect(faults.filter((e) => /^q[23]: PEDAGOGY_GENDERED_CHILD/.test(e))).toHaveLength(2);
    expect(logEvent.mock.calls.map((c) => c[0])).not.toContain('transcript_quiz.failed');
  });

  // More than one repair takes used to mean NO repair at all (the cap refused the
  // whole list). The worst five are asked for now, and the rest get a second
  // batch — transcript-quiz-rewrite-overflow.test.js. Here the rewrite returns
  // nothing usable, so there is nothing to build a second batch on.
  test('more questions than one repair takes (six of eight) → the worst five are asked for; a rewrite with nothing usable leaves the attempt shipping, faults recorded', async () => {
    const bad = eight().map((q, i) => (i < 6 ? MASC_FEEDBACK(q) : q));
    mockCreate.mockResolvedValue(reply({ lesson_summary: SUMMARY, questions: bad }));
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);          // the author, then ONE repair of five
    expect(promptOf(mockCreate.mock.calls[1])).toContain('REWRITE THESE QUESTIONS: q0, q1, q2, q3, q4');
    expect(storedRows()).toHaveLength(8);
    expect((lastMeta().soft_faults || []).filter((e) => /PEDAGOGY_GENDERED_CHILD/.test(e))).toHaveLength(6);
  });

  test('third-person feminine Urdu is not a fault: a clean quiz ships on its first call, no repair', async () => {
    mockCreate.mockResolvedValue(reply({ lesson_summary: SUMMARY, questions: eight() }));
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(lastMeta().soft_faults).toBeUndefined();
  });

  test('the last-attempt salvage drops a broken question, never a misaddressed one', () => {
    const qs = eight(); qs[1] = { ...qs[1], options: ['بستے', 'بستے', 'بستیں'] }; qs[3] = MASC_FEEDBACK(qs[3]);
    const errs = errsFor(qs);
    expect(errs.some((e) => /^q1: duplicate options/.test(e))).toBe(true);
    expect(errs.some((e) => /^q3: PEDAGOGY_GENDERED_CHILD/.test(e))).toBe(true);
    const out = Gen.salvageWithoutBadFigures(qs, errs, { language: 'ur', subject: 'urdu', digest: DIGEST, quizId: QID, lessonSummary: SUMMARY });
    expect(out.refused).toBeUndefined();
    expect(out.dropped).toEqual([1]);
    expect(out.questions).toHaveLength(7);
    expect(out.softFaults.some((e) => /PEDAGOGY_GENDERED_CHILD/.test(e))).toBe(true);
  });
});

// ── the lesson-plan quiz takes the same path ─────────────────────────────────
describe('4 — an lp_v8 quiz: the live item as it went out is repaired in place before the key check', () => {
  // The render-QA item: «اگر آپ کو 'بہار' کی جمع بنانی ہو تو کیا کریں گے؟» with
  // «آخر میں 'یں' لگائیں گے» among its options. Keyed correctly here, so the only
  // fault is how it speaks to the child.
  const GENDERED = {
    ...F.AUTHORED[6],
    question: "اگر آپ کو 'بہار' کی جمع بنانی ہو تو کیا کریں گے؟",
    options: ["آخر میں 'یں' لگائیں گے", F.WRONG_KEY, "آخر میں 'وں' لگائیں گے"],
    correct_index: 0,
    explanation: "بہار کی جمع بہاریں ہے، جیسا سبق میں بتایا گیا۔",
    option_feedback: { correct: 'بالکل درست!', wrong: { 1: "یہ درست نہیں، بہار کی جمع بہاریں ہے۔", 2: "یہ درست نہیں، بہار کی جمع بہاریں ہے۔" } },
  };
  const NEUTRAL = {
    ...GENDERED,
    question: F.BAHAR_STEM,
    options: ["آخر میں 'یں' لگانا", F.WRONG_KEY, "آخر میں 'وں' لگانا"],
  };
  const LP_QUIZ = {
    id: QID, teacher_id: 'u-1', coaching_session_id: null, quiz_source: 'lp_v8', topic: 'واحد اور جمع',
    subject: 'urdu', language: 'ur', status: 'generating', grade: '3',
    meta: {
      step: 'digest', source: 'lp_offer', class: { grade: 3, subject: 'urdu' }, lesson_date: '2026-09-23',
      lessons: [{ lesson_id: F.LESSON_ID, asset_id: 'a-1', version_stamp: 'v8-20260920', content_hash: 'h-1', delivered_at: '2026-09-23T04:10:00Z' }],
    },
  };
  function wireLp() {
    installFrom(supabase.from, {
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [LP_QUIZ] }),
      coaching_sessions: () => { throw new Error('an lp_v8 quiz must never query coaching_sessions'); },
      niete_lp_asset_sources: { data: [{ asset_id: 'a-1', lesson_id: F.LESSON_ID, version_stamp: 'v8-20260920', content_hash: 'h-1', slide_script: F.SLIDE_SCRIPT, source_url: null, verified: 'upload' }] },
      quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
      users: { data: [{ id: 'u-1', name: 'A B', phone_number: '923001234567', preferred_language: 'ur' }] },
    });
  }
  const KIND = [
    ['digest', /^You are reading the LESSON PLAN/],
    ['check', /^You are CHECKING THE ANSWER KEY/],
    ['rewrite', /^You are FIXING/],
    ['author', /^You are writing a short WhatsApp quiz/],
  ];
  const kindOf = (call) => (KIND.find(([, re]) => re.test(call.messages[0].content)) || ['other'])[0];

  test('author → one in-place repair of q6 → key check on the repaired set → 8 stored, the neutral item among them', async () => {
    const authored = F.AUTHORED.map((q, i) => (i === 6 ? GENDERED : q));
    mockCreate.mockImplementation((call) => {
      const kind = kindOf(call);
      if (kind === 'digest') return Promise.resolve(reply(F.MODEL_DIGEST));
      if (kind === 'author') return Promise.resolve(reply({ lesson_summary: F.LESSON_SUMMARY, questions: authored }));
      if (kind === 'rewrite') return Promise.resolve(reply({ questions: [{ index: 6, ...NEUTRAL }] }));
      if (kind === 'check') {
        const idx = [...call.messages[0].content.matchAll(/^q(\d+): /gm)].map((m) => Number(m[1]));
        return Promise.resolve(reply({ verdicts: idx.map((index) => ({ index, verdict: 'consistent', quote: '' })) }));
      }
      return Promise.reject(new Error(`unexpected LLM call: ${call.messages[0].content.slice(0, 60)}`));
    });
    wireLp();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const kinds = mockCreate.mock.calls.map((c) => kindOf(c[0]));
    expect(kinds.filter((k) => k === 'author')).toHaveLength(1);        // never re-rolled
    expect(kinds.filter((k) => k === 'rewrite')).toHaveLength(1);
    const rw = mockCreate.mock.calls.find((c) => kindOf(c[0]) === 'rewrite')[0].messages[0].content;
    expect(rw).toContain('REWRITE THESE QUESTIONS: q6');
    expect(rw).toMatch(/q6: PEDAGOGY_GENDERED_CHILD — question \+ options/);
    // the key check read the REPAIRED item
    const check = mockCreate.mock.calls.find((c) => kindOf(c[0]) === 'check')[0].messages[0].content;
    expect(check).toContain(F.BAHAR_STEM);
    expect(check).not.toContain('کیا کریں گے؟');
    const rows = storedRows();
    expect(rows).toHaveLength(8);
    const bahar = rows.find((x) => x.question_text.includes('بہار') && x.question_text.includes('جمع بنانی'));
    expect(bahar.question_text.replace(/\u200f/g, '')).toBe(F.BAHAR_STEM);
    [bahar.option_a, bahar.option_b, bahar.option_c].forEach((o) => expect(o).not.toMatch(/لگائیں گے/));
  });
});

