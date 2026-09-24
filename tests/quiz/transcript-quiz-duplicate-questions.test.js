'use strict';
/**
 * A class quiz never asks the same question twice.
 *
 * Staging, an Urdu lesson on proper fractions: Q5 «ان میں سے کون سا Proper
 * Fraction ہے؟» and Q6 «ان میں سے کون سا fraction Proper Fraction ہے؟» — the
 * same three fractions in another order, the same answer. Nothing looked at the
 * quiz as a whole, so a child answered one question twice and the class lost a
 * question's worth of the lesson. Run over the shipped production quizzes, the
 * same fault is in about one in fifty (the measurement is in the pull request).
 *
 * THE RULE (transcript-quiz-duplicates). A later question duplicates an earlier
 * one when they have the SAME ANSWER, the SAME PICTURE (or none), ask about the
 * SAME ITEM — every number and every quoted word or blank sentence of one stem
 * is in the other — and their stems are near-identical once the text is
 * normalised: with the same three options, most of the words; with other
 * options, nearly all of them. "Which is a proper fraction?" beside "which is
 * an improper fraction?" (another answer), "Which article goes before 'kite'?"
 * beside "…before 'tree'?" (another item), and rounding 18 beside rounding 16
 * (other numbers) are three different questions, and pass.
 *
 * THE REPAIR. The LATER question is named (`qN: DUPLICATE_QUESTION`), so the
 * targeted rewrite replaces it with a different question at the same SLO and
 * level. It is never a reason to send nothing: when the rewrite fails, the quiz
 * ships and the fault is recorded (a soft, in-place fault — never a re-roll,
 * never a dropped question).
 *
 * Fixtures are synthetic. Only the network (Supabase, WhatsApp, R2, the LLM
 * client) is stubbed; the validator, the rewrite and the generate step run.
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
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { logEvent } = require('../../bot/shared/utils/structured-logger');

const QID = '77777777-7777-4777-8777-777777777777';
const SID = '88888888-8888-4888-8888-888888888888';
const dupes = (errs) => errs.filter((e) => /DUPLICATE_QUESTION/.test(e));

// ── 1. the staging quiz: Urdu, proper fractions ──────────────────────────────
const FR_DIGEST = {
  topic: 'Proper fractions', topic_as_taught: 'Proper Fraction', subject: 'maths', grade_band: '3-5',
  slos: [
    { id: 'S1', statement: 'name the parts of a fraction', statement_en: 'name the parts of a fraction', taught_level: 'recall' },
    { id: 'S2', statement: 'identify a proper fraction', statement_en: 'identify a proper fraction', taught_level: 'understand' },
  ],
  key_terms: [{ term: 'numerator' }, { term: 'denominator' }, { term: 'Proper Fraction' }, { term: 'Improper Fraction' }],
};
const FR_CTX = {
  language: 'ur', subject: 'maths', digest: FR_DIGEST, nExpected: 8, gradeBand: '3-5',
  lessonSummary: 'آج کے سبق میں fraction کے حصے اور Proper Fraction کی پہچان سکھائی گئی۔',
};
const F = (a, b) => `$\\frac{${a}}{${b}}$`;
const fq = (o) => ({
  slo_id: 'S2', level: 'understand', correct_index: 0,
  selected_because: 'سبق میں Proper Fraction کی مثالیں بورڈ پر لکھی گئیں',
  distractor_misconceptions: { 1: 'اوپر والے عدد کو بڑا سمجھنا', 2: 'برابر عدد والی fraction کو Proper سمجھنا' },
  explanation: 'Proper Fraction میں اوپر والا عدد نیچے والے عدد سے چھوٹا ہوتا ہے۔',
  option_feedback: { correct: 'بالکل درست!', wrong: { 1: 'یہاں اوپر والا عدد بڑا ہے۔', 2: 'یہاں دونوں عدد برابر ہیں۔' } },
  ...o,
});
function fractions() {
  return [
    fq({ slo_id: 'S1', level: 'recall', question: `${F(2, 5)} میں اوپر والے عدد کو کیا کہتے ہیں؟`, options: ['numerator', 'denominator', 'fraction'],
      explanation: 'اوپر والا عدد numerator کہلاتا ہے۔', option_feedback: { correct: 'شاباش!', wrong: { 1: 'یہ نیچے والا عدد ہے۔', 2: 'یہ پورے عدد کا نام ہے۔' } } }),
    fq({ slo_id: 'S1', level: 'recall', question: `${F(2, 5)} میں نیچے والے عدد کو کیا کہتے ہیں؟`, options: ['denominator', 'numerator', 'fraction'],
      explanation: 'نیچے والا عدد denominator کہلاتا ہے۔', option_feedback: { correct: 'درست!', wrong: { 1: 'یہ اوپر والا عدد ہے۔', 2: 'یہ پورے عدد کا نام ہے۔' } } }),
    fq({ slo_id: 'S1', level: 'recall', question: `${F(4, 9)} کا denominator کون سا عدد ہے؟`, options: ['9', '4', '13'],
      explanation: 'نیچے والا عدد 9 ہے۔', option_feedback: { correct: 'بالکل!', wrong: { 1: '4 اوپر ہے۔', 2: 'عدد جمع نہیں کرتے۔' } } }),
    fq({ question: `${F(5, 8)} کس قسم کی fraction ہے؟`, options: ['Proper Fraction', 'Improper Fraction', 'پورا عدد'],
      option_feedback: { correct: 'درست! 5 چھوٹا ہے 8 سے۔', wrong: { 1: 'Improper میں اوپر والا عدد بڑا ہوتا ہے۔', 2: 'یہ پورا عدد نہیں ہے۔' } } }),
    fq({ question: 'ان میں سے کون سا Proper Fraction ہے؟', options: [F(3, 7), F(7, 3), F(3, 3)] }),
    // Q6 of the staging quiz: the same three fractions in another order, the same answer.
    // (The staging stem also ran two English terms together — «fraction Proper Fraction» —
    // which the adjacent-terms check already names; this copy keeps an Urdu word between
    // them so the repeat is the ONLY thing wrong with the quiz.)
    fq({ question: 'ان میں سے کون سا fraction ایک Proper Fraction ہے؟', options: [F(3, 7), F(3, 3), F(7, 3)],
      option_feedback: { correct: 'شاباش!', wrong: { 1: 'یہاں دونوں عدد برابر ہیں۔', 2: 'یہاں اوپر والا عدد بڑا ہے۔' } },
      distractor_misconceptions: { 1: 'برابر عدد والی fraction کو Proper سمجھنا', 2: 'اوپر والے عدد کو بڑا سمجھنا' } }),
    fq({ question: `${F(9, 4)} کس قسم کی fraction ہے؟`, options: ['Improper Fraction', 'Proper Fraction', 'پورا عدد'],
      option_feedback: { correct: 'درست! 9 بڑا ہے 4 سے۔', wrong: { 1: 'Proper میں اوپر والا عدد چھوٹا ہوتا ہے۔', 2: 'یہ پورا عدد نہیں ہے۔' } } }),
    fq({ question: 'Proper Fraction میں اوپر والا عدد کیسا ہوتا ہے؟', options: ['نیچے والے سے چھوٹا', 'نیچے والے سے بڑا', 'نیچے والے کے برابر'],
      option_feedback: { correct: 'بہت خوب!', wrong: { 1: 'یہ Improper Fraction ہے۔', 2: 'برابر ہو تو fraction ایک کے برابر ہوتی ہے۔' } } }),
  ];
}

describe('1 — the validator names the later copy of a question', () => {
  test('the staging pair: ONE complaint, on q5, naming q4 — and nothing else about the quiz is wrong', () => {
    const errs = validate(fractions(), FR_CTX).errors;
    const got = dupes(errs);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatch(/^q5: DUPLICATE_QUESTION — /);
    expect(got[0]).toContain('q4');
    expect(errs.filter((e) => !/DUPLICATE_QUESTION/.test(e))).toEqual([]);
  });

  test('the same question with other wrong options is still the same question', () => {
    const qs = fractions();
    qs[5] = { ...qs[5], question: 'ان میں سے کون سا Proper Fraction ہے؟', options: [F(3, 7), F(8, 5), F(6, 6)] };
    expect(dupes(validate(qs, FR_CTX).errors)).toEqual([expect.stringMatching(/^q5: DUPLICATE_QUESTION — .*q4/)]);
  });

  test('a stem that only adds "that you learned in class" around the same question is the same question', () => {
    const qs = fractions();
    qs[5] = { ...qs[5], question: 'ان میں سے کون سا Proper Fraction ہے جو آپ نے کلاس میں سیکھا؟', options: [F(3, 7), F(5, 2), F(4, 4)] };
    expect(dupes(validate(qs, FR_CTX).errors)).toEqual([expect.stringMatching(/^q5: DUPLICATE_QUESTION/)]);
  });
});

describe('2 — different questions that look alike are left alone', () => {
  const ok = (qs, ctx = FR_CTX) => expect(dupes(validate(qs, ctx).errors)).toEqual([]);

  test('the same three fractions, the opposite question: proper beside improper', () => {
    const qs = fractions();
    qs[5] = { ...qs[5], question: 'ان میں سے کون سا Improper Fraction ہے؟', options: [F(7, 3), F(3, 7), F(3, 3)],
      option_feedback: { correct: 'درست!', wrong: { 1: 'یہ Proper ہے۔', 2: 'دونوں عدد برابر ہیں۔' } } };
    ok(qs);
  });

  test('the same template about another number: rounding 18, then rounding 16', () => {
    const qs = fractions();
    qs[4] = { ...qs[4], question: 'اگر 18 کو قریب ترین 10 تک Round Off کریں تو جواب کیا ہوگا؟', options: ['20', '10', '15'] };
    qs[5] = { ...qs[5], question: 'اگر 16 کو قریب ترین 10 تک Round Off کریں تو جواب کیا ہوگا؟', options: ['20', '10', '15'] };
    ok(qs);
  });

  test('the same template about another word, and another blank sentence', () => {
    const qs = fractions();
    qs[4] = { ...qs[4], question: "Which article comes before the word 'kite'?", options: ['a', 'an', 'the'] };
    qs[5] = { ...qs[5], question: "Which article comes before the word 'tree'?", options: ['a', 'an', 'the'] };
    qs[6] = { ...qs[6], question: 'حسنین ____ بستہ۔ خالی جگہ میں کون سا لفظ آئے گا؟', options: ['کا', 'کی', 'کے'] };
    qs[7] = { ...qs[7], question: 'درخت پر چڑیا ____ گھونسلا ہے۔ خالی جگہ میں کون سا لفظ آئے گا؟', options: ['کا', 'کی', 'کے'] };
    ok(qs, { ...FR_CTX, language: 'en', subject: 'english' });
  });

  test('answers that differ only by a capital letter or a vowel mark are different answers', () => {
    const qs = fractions();
    qs[4] = { ...qs[4], question: "In 'Pinky is wearing a pinky dress', which word is the noun?", options: ['Pinky', 'pinky', 'wearing'] };
    qs[5] = { ...qs[5], question: "In 'Pinky is wearing a pinky dress', which word is the adjective?", options: ['pinky', 'Pinky', 'wearing'] };
    qs[6] = { ...qs[6], question: "اگر 'ت' اور 'پ' کے اوپر زبر لگے تو کون سی آواز بنے گی؟", options: ['تَپ', 'تِپ', 'تُپ'] };
    qs[7] = { ...qs[7], question: "اگر 'ت' اور 'پ' کے نیچے زیر لگے تو کون سی آواز بنے گی؟", options: ['تِپ', 'تَپ', 'تُپ'] };
    ok(qs, { ...FR_CTX, language: 'en', subject: 'english' });
  });

  test('the same stem over two different pictures asks about two different pictures', () => {
    const qs = fractions();
    qs[4] = { ...qs[4], question: 'تصویر میں کتنا حصہ رنگا ہوا ہے؟', options: [F(3, 4), F(1, 4), F(4, 3)], figure: { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] } };
    qs[5] = { ...qs[5], question: 'تصویر میں کتنا حصہ رنگا ہوا ہے؟', options: [F(3, 4), F(1, 4), F(4, 3)], figure: { type: 'fraction_bar', bars: [{ parts: 8, shaded: 6 }] } };
    ok(qs);
  });
});

describe('2b — select-all questions, and questions the check cannot read', () => {
  const { duplicateQuestionErrors } = require('../../bot/shared/services/quiz/transcript-quiz-duplicates');
  const multi = (question, options, correct) => ({ question, options, answer_mode: 'multi', correct_indices: correct });

  test('a select-all question asked again with the same correct SET is named; another set is not', () => {
    const a = multi('Which of these are proper nouns?', ['Lahore', 'city', 'Ali', 'boy'], [0, 2]);
    const same = multi('Which of these words are proper nouns?', ['Ali', 'boy', 'Lahore', 'city'], [0, 2]);
    const other = multi('Which of these are proper nouns?', ['Lahore', 'city', 'Ali', 'boy'], [0, 1]);
    expect(duplicateQuestionErrors([a, same])).toEqual([expect.stringMatching(/^q1: DUPLICATE_QUESTION — .*q0.*«Lahore, Ali»/)]);
    expect(duplicateQuestionErrors([a, other])).toEqual([]);
  });

  test('a question with no usable answer is left to the per-question checks, never thrown on', () => {
    const good = { question: 'Which of these is a proper noun?', options: ['Lahore', 'city', 'river'], correct_index: 0 };
    const quiz = [
      good,
      { ...good, correct_index: 7 },
      { ...good, correct_index: undefined },
      { ...good, options: 'Lahore, city, river' },
      { ...good, options: ['', 'city', 'river'] },
      null,
      'not a question',
    ];
    expect(() => duplicateQuestionErrors(quiz)).not.toThrow();
    expect(duplicateQuestionErrors(quiz)).toEqual([]);
    expect(duplicateQuestionErrors(undefined)).toEqual([]);
  });

  test('a third copy names the FIRST question, and each copy is named once', () => {
    const good = { question: 'Which of these is a proper noun?', options: ['Lahore', 'city', 'river'], correct_index: 0 };
    const errs = duplicateQuestionErrors([good, { ...good, options: ['river', 'Lahore', 'city'], correct_index: 1 }, { ...good }]);
    expect(errs).toEqual([expect.stringMatching(/^q1: DUPLICATE_QUESTION — asks what q0 /), expect.stringMatching(/^q2: DUPLICATE_QUESTION — asks what q0 /)]);
  });
});

describe('3 — one question to rewrite, and never a reason to send nothing', () => {
  test('the targeted rewrite takes the LATER question, and it is a soft fault', () => {
    const errs = validate(fractions(), FR_CTX).errors;
    expect(errs).toEqual([expect.stringMatching(/^q5: DUPLICATE_QUESTION/)]);
    expect(Rewrite.rewriteTargets(errs).indices).toEqual([5]);
    errs.forEach((e) => expect(Gen.SOFT_FAULT.test(e)).toBe(true));
  });

  test('the rewrite prompt asks for a different question, and lists the earlier one as staying', () => {
    const qs = fractions();
    const errs = validate(qs, FR_CTX).errors;
    const p = Rewrite.buildRewritePrompt({ digest: FR_DIGEST, language: 'ur', questions: qs, targets: Rewrite.rewriteTargets(errs) });
    expect(p).toContain('REWRITE THESE QUESTIONS: q5');
    expect(p).toContain('ASKED TWICE');
    expect(p).toMatch(/q4: ان میں سے کون سا Proper Fraction ہے؟/);
  });

  test('the last-attempt salvage never drops a question for it', () => {
    const qs = fractions(); qs[1] = { ...qs[1], options: ['denominator', 'denominator', 'fraction'] };
    const errs = validate(qs, FR_CTX).errors;
    const out = Gen.salvageWithoutBadFigures(qs, errs, { language: 'ur', subject: 'maths', digest: FR_DIGEST, quizId: QID, lessonSummary: FR_CTX.lessonSummary, gradeBand: '3-5' });
    expect(out.refused).toBeUndefined();
    expect(out.dropped).toEqual([1]);
    expect(out.softFaults.some((e) => /^q4: DUPLICATE_QUESTION/.test(e))).toBe(true);
  });
});

// ── 4. the generate path, the LLM mocked at the network boundary ─────────────
// An English lesson on nouns, grade 7 (no picture is demanded).
const EN_DIGEST = {
  topic: 'Common and proper nouns', topic_as_taught: 'Common and proper nouns', subject: 'english',
  grade_band: '6-8', language_of_instruction: 'en', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'tell a proper noun from a common noun', statement_en: 'tell a proper noun from a common noun', taught_level: 'understand' },
    { id: 'S2', statement: 'capitalise proper nouns', statement_en: 'capitalise proper nouns', taught_level: 'recall' },
  ],
  key_terms: [{ term: 'proper noun' }, { term: 'common noun' }], examples_used: ['Lahore and city', 'Ali and boy'], misconceptions_surfaced: [],
};
const EN_SUMMARY = 'You taught the difference between common and proper nouns, using Lahore and city, and Ali and boy.';
const nq = ({ slo = 'S1', level = 'understand', question, options }) => ({
  slo_id: slo, level, question, options, correct_index: 0,
  explanation: 'A proper noun names one particular person, place or thing.',
  selected_because: 'the class sorted nouns into common and proper',
  distractor_misconceptions: { 1: 'thinks every noun is proper', 2: 'confuses a verb with a noun' },
  option_feedback: { correct: 'Well done!', wrong: { 1: 'That one names a kind of thing, not one thing.', 2: 'Look at what the word names.' } },
});
function nouns() {
  return [
    nq({ question: 'Which of these is a proper noun?', options: ['Lahore', 'city', 'river'] }),
    nq({ question: 'Which of these is a common noun?', options: ['boy', 'Ali', 'Karachi'] }),
    nq({ question: "In 'Ali lives in Lahore', which word is a proper noun?", options: ['Lahore', 'lives', 'in'] }),
    nq({ question: "In 'The girl reads a book', which word is a common noun?", options: ['book', 'reads', 'a'] }),
    nq({ slo: 'S2', level: 'recall', question: 'How does a proper noun begin?', options: ['With a capital letter', 'With a small letter', 'With a number'] }),
    // the same question as q0, the options in another order
    nq({ question: 'Which of these words is a proper noun?', options: ['Lahore', 'river', 'city'] }),
    nq({ question: "Which word names one particular mountain: 'mountain' or 'K2'?", options: ['K2', 'mountain', 'both'] }),
    nq({ slo: 'S2', level: 'recall', question: "Which is written correctly?", options: ['Islamabad', 'islamabad', 'ISLAMabad'] }),
  ];
}
const REPLACEMENT = nq({ question: 'Which of these names one particular river?', options: ['Ravi', 'river', 'water'] });

function reply(obj) { return { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.01 } }; }
const promptOf = (call) => call[0].messages[0].content;
const isRewrite = (call) => /REWRITE THESE QUESTIONS/.test(call.messages[0].content);
function wire() {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{
      id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: EN_DIGEST.topic, subject: 'english', language: 'en', status: 'generating', meta: { digest: EN_DIGEST, grade: '7', step: 'author' },
    }] }),
    coaching_sessions: { data: [{ id: SID, user_id: 'u-1', transcript_text: 'lesson '.repeat(400), transcript_language: 'en', created_at: '2026-09-24T04:00:00Z', analysis_data: {}, users: { phone_number: '923000000000', preferred_language: 'en', name: 'A B' } }] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [{ phone_number: '923000000000', preferred_language: 'en' }] },
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

describe('4 — on the generate path: the later copy is rewritten, and the quiz always ships', () => {
  test('the fixture is otherwise clean: the planted copy is the only complaint', () => {
    const errs = validate(nouns(), { language: 'en', subject: 'english', digest: EN_DIGEST, nExpected: 8, lessonSummary: EN_SUMMARY }).errors;
    expect(errs).toEqual([expect.stringMatching(/^q5: DUPLICATE_QUESTION — .*q0/)]);
  });

  test('ONE targeted rewrite replaces the later copy → 8 different questions ship, no fault recorded', async () => {
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 5, ...REPLACEMENT }] }))
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: nouns() }))));
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const rw = promptOf(mockCreate.mock.calls[1]);
    expect(rw).toContain('REWRITE THESE QUESTIONS: q5');
    expect(rw).toContain('ASKED TWICE');
    const rows = storedRows();
    expect(rows).toHaveLength(8);
    expect(rows.map((x) => x.question_text)).toContain('Which of these names one particular river?');
    expect(rows.map((x) => x.question_text)).not.toContain('Which of these words is a proper noun?');
    expect(lastMeta().soft_faults).toBeUndefined();
    expect(logEvent.mock.calls.map((c) => c[0])).toContain('transcript_quiz.duplicate_question');
  });

  test('a rewrite that writes the copy again SHIPS the quiz whole with the fault recorded — no re-roll, nothing dropped', async () => {
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 5, ...nouns()[5] }] }))
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: nouns() }))));
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);          // one author call + one repair; never a second full attempt
    expect(storedRows()).toHaveLength(8);
    expect((lastMeta().soft_faults || []).filter((e) => /^q5: DUPLICATE_QUESTION/.test(e))).toHaveLength(1);
    const events = logEvent.mock.calls.map((c) => c[0]);
    expect(events).not.toContain('transcript_quiz.failed');
    expect(events).toContain('transcript_quiz.shipped_with_soft_faults');
  });
});
