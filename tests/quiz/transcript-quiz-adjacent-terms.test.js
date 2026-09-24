'use strict';
/**
 * Two English terms side by side in an Urdu sentence read backwards.
 *
 * Staging, a lesson-plan quiz on proper fractions, options B and C:
 *   «جب numerator denominator سے چھوٹا ہو»   (when the numerator is smaller than the denominator)
 * The two English words are one left-to-right run inside a right-to-left line,
 * so "denominator" sits against «جب» and a reader going right to left meets it
 * FIRST: «when the denominator … the numerator is smaller» — the rule turned
 * around. Option A, «جب numerator اور denominator برابر ہوں», is fine: an Urdu
 * word between the terms keeps each in its own place. The same shape is common
 * in production Urdu quizzes («Liquid Solid میں تبدیل ہوتا ہے», «Sunday Saturday
 * کے بعد آتا ہے», «pen matter ہے»).
 *
 * A single English term of two words — "cross multiplication", "common
 * denominator", "improper fraction" — is ONE phrase and must stay one run; that
 * is what the page's Latin-run isolation exists for, and it is not touched.
 *
 * What this suite pins:
 *   1. the validator names the question and the field where two SEPARATE
 *      English terms of the lesson sit side by side, and leaves a genuine
 *      phrase, an Urdu word between the terms, an English sentence and the
 *      maths alone;
 *   2. it is one question's text to repair, and a SOFT fault;
 *   3. the author prompt says never to write two English terms side by side,
 *      and the targeted rewrite carries an in-place repair rule for it;
 *   4. on the generate path it is repaired in place by ONE targeted rewrite,
 *      and the quiz ships whatever that leaves — never a re-roll, never a
 *      dropped question, never a failed quiz over word order.
 *
 * The fixtures are synthetic. The detector was measured on real authored Urdu
 * quizzes before it was wired (the numbers are in the pull request).
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
const AdjacentTerms = require('../../bot/shared/services/quiz/transcript-quiz-adjacent-terms');
const { buildAuthorPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');

const QID = '66666666-6666-4666-8666-666666666666';
const SID = '55555555-5555-4555-8555-555555555555';

// ── 1. the staging item, in a fractions quiz ────────────────────────────────
const FR_DIGEST = {
  topic: 'Proper and improper fractions', topic_as_taught: 'Proper fraction', subject: 'maths', grade_band: '3-5',
  slos: [
    { id: 'S1', statement: 'name the numerator and the denominator of a fraction', statement_en: 'name the numerator and the denominator of a fraction', taught_level: 'recall' },
    { id: 'S2', statement: 'tell a proper fraction from an improper fraction', statement_en: 'tell a proper fraction from an improper fraction', taught_level: 'understand' },
  ],
  key_terms: [{ term: 'numerator' }, { term: 'denominator' }, { term: 'proper fraction' }, { term: 'improper fraction' }, { term: 'mixed fraction' }],
};
const FR_CTX = {
  language: 'ur', subject: 'maths', digest: FR_DIGEST, nExpected: 8, gradeBand: '3-5',
  lessonSummary: 'آج کے سبق میں numerator، denominator اور proper اور improper fractions کا فرق سکھایا گیا۔',
};
const F = (a, b) => `$\\frac{${a}}{${b}}$`;
const fq = (o) => ({
  slo_id: 'S1', level: 'recall', correct_index: 0,
  selected_because: 'سبق میں numerator اور denominator کے نام دہرائے گئے',
  distractor_misconceptions: { 1: 'اوپر اور نیچے کے عدد کو الٹ سمجھنا', 2: 'پوری چیز کو fraction سمجھنا' },
  ...o,
});
const STAGING_ITEM = fq({
  slo_id: 'S2', level: 'understand', question: 'ایک fraction کب proper fraction کہلاتی ہے؟',
  options: ['جب numerator denominator سے چھوٹا ہو', 'جب numerator اور denominator برابر ہوں', 'جب numerator denominator سے بڑا ہو'],
  explanation: 'proper fraction میں اوپر والا عدد نیچے والے سے چھوٹا ہوتا ہے۔',
  option_feedback: { correct: 'بالکل ٹھیک! اوپر والا عدد چھوٹا ہو تو fraction proper ہوتی ہے۔', wrong: { 1: 'برابر ہوں تو fraction ایک کے برابر ہوتی ہے۔', 2: 'اوپر والا عدد بڑا ہو تو وہ improper fraction ہے۔' } },
});
const REPAIRED_ITEM = {
  ...STAGING_ITEM,
  options: ['جب numerator کی قیمت denominator سے کم ہو', 'جب numerator اور denominator برابر ہوں', 'جب numerator کی قیمت denominator سے زیادہ ہو'],
};
function fractions() {
  return [
    fq({ question: `${F(3, 4)} میں لکیر کے اوپر والے عدد کو کیا کہتے ہیں؟`, options: ['numerator', 'denominator', 'mixed fraction'],
      explanation: 'لکیر کے اوپر والا عدد numerator ہے۔',
      option_feedback: { correct: 'بالکل درست! اوپر والا عدد numerator ہے۔', wrong: { 1: 'denominator لکیر کے نیچے ہوتا ہے۔', 2: 'mixed fraction میں پورا عدد بھی ہوتا ہے۔' } } }),
    fq({ question: `${F(3, 4)} میں لکیر کے نیچے والے عدد کو کیا کہتے ہیں؟`, options: ['denominator', 'numerator', 'mixed fraction'],
      explanation: 'لکیر کے نیچے والا عدد denominator ہے۔',
      option_feedback: { correct: 'شاباش! نیچے والا عدد denominator ہے۔', wrong: { 1: 'numerator لکیر کے اوپر ہوتا ہے۔', 2: 'یہاں کوئی پورا عدد نہیں ہے۔' } } }),
    fq({ slo_id: 'S2', level: 'understand', question: 'ان میں سے کون سی proper fraction ہے؟', options: [F(2, 5), F(7, 4), F(5, 5)],
      explanation: 'proper fraction میں اوپر والا عدد نیچے والے سے چھوٹا ہوتا ہے۔',
      option_feedback: { correct: 'بہت خوب! 2 چھوٹا ہے 5 سے۔', wrong: { 1: 'یہ improper fraction ہے کیونکہ 7 بڑا ہے 4 سے۔', 2: 'یہاں دونوں عدد برابر ہیں۔' } } }),
    fq({ slo_id: 'S2', level: 'understand', question: `${F(9, 4)} کس قسم کی fraction ہے؟`, options: ['improper fraction', 'proper fraction', 'دونوں میں سے کوئی نہیں'],
      explanation: 'اوپر والا عدد 9 نیچے والے عدد 4 سے بڑا ہے، اس لیے یہ improper fraction ہے۔',
      option_feedback: { correct: 'درست! 9 بڑا ہے 4 سے۔', wrong: { 1: 'proper fraction میں اوپر والا عدد چھوٹا ہوتا ہے۔', 2: 'ہر fraction کی ایک قسم ہوتی ہے۔' } } }),
    STAGING_ITEM,
    fq({ slo_id: 'S2', level: 'understand', question: `${F(5, 3)} کو کس قسم کی fraction کہا جاتا ہے؟`, options: ['improper fraction', 'proper fraction', 'mixed fraction'],
      explanation: '5 بڑا ہے 3 سے، اس لیے یہ improper fraction ہے۔',
      option_feedback: { correct: 'شاباش! یہ improper fraction ہے۔', wrong: { 1: 'proper fraction میں اوپر والا عدد چھوٹا ہوتا ہے۔', 2: 'mixed fraction میں ایک پورا عدد بھی لکھا ہوتا ہے۔' } } }),
    fq({ question: `${F(2, 7)} کا denominator کون سا عدد ہے؟`, options: ['7', '2', '9'],
      explanation: 'نیچے والا عدد 7 ہے، یہی denominator ہے۔',
      option_feedback: { correct: 'درست! نیچے والا عدد 7 ہے۔', wrong: { 1: '2 تو اوپر ہے۔', 2: 'دونوں عدد جمع نہیں کرتے۔' } } }),
    fq({ slo_id: 'S2', level: 'understand', question: 'کس fraction میں اوپر والا عدد نیچے والے سے بڑا ہوتا ہے؟', options: ['improper fraction', 'proper fraction', 'ہر fraction میں'],
      explanation: 'improper fraction میں اوپر والا عدد بڑا یا برابر ہوتا ہے۔',
      option_feedback: { correct: 'بہت اچھے! یہ improper fraction ہے۔', wrong: { 1: 'proper fraction میں اوپر والا عدد چھوٹا ہوتا ہے۔', 2: 'ہر fraction ایسی نہیں ہوتی۔' } } }),
  ];
}
const adjacency = (errs) => errs.filter((e) => /URDU_ADJACENT_TERMS/.test(e));

describe('1 — the validator names two separate English terms side by side', () => {
  test('the staging item: ONE complaint on q4, naming both options and the pair', () => {
    const errs = validate(fractions(), FR_CTX).errors;
    const got = adjacency(errs);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatch(/^q4: URDU_ADJACENT_TERMS — /);
    expect(got[0]).toContain('option 0');
    expect(got[0]).toContain('option 2');
    expect(got[0]).toContain('numerator denominator');
    // and nothing else about the quiz was wrong
    expect(errs.filter((e) => !/URDU_ADJACENT_TERMS/.test(e))).toEqual([]);
  });

  test('the repaired item — an Urdu word between the terms — passes', () => {
    const qs = fractions(); qs[4] = REPAIRED_ITEM;
    expect(validate(qs, FR_CTX).errors).toEqual([]);
  });

  test('a two-word term of the lesson stays one phrase: cross multiplication, common denominator, unlike fractions', () => {
    const digest = { ...FR_DIGEST, key_terms: [...FR_DIGEST.key_terms, { term: 'cross multiplication' }, { term: 'common denominator' }, { term: 'unlike fractions' }] };
    const qs = fractions(); qs[4] = REPAIRED_ITEM;
    qs[3] = { ...qs[3], explanation: 'unlike fractions کا موازنہ cross multiplication سے ہوتا ہے، یا ایک common denominator پر لکھ کر۔' };
    expect(adjacency(validate(qs, { ...FR_CTX, digest }).errors)).toEqual([]);
  });

  test('two KNOWN phrases side by side are two terms: «Improper Fraction Mixed Fraction میں تبدیل ہوتی ہے»', () => {
    const qs = fractions();
    qs[7] = { ...qs[7], explanation: 'تقسیم کے بعد Improper Fraction Mixed Fraction میں تبدیل ہوتی ہے۔' };
    const got = adjacency(validate(qs, FR_CTX).errors);
    expect(got.some((e) => /^q7: URDU_ADJACENT_TERMS — explanation\b/.test(e) && /Fraction Mixed/.test(e))).toBe(true);
  });

  test('an adjective with its noun, an English sentence the class said, and the maths are left alone', () => {
    const qs = fractions(); qs[4] = REPAIRED_ITEM;
    qs[0] = { ...qs[0], explanation: 'mixed fraction میں ایک whole number اور ایک proper fraction ہوتی ہے۔' };
    qs[1] = { ...qs[1], explanation: 'کلاس نے کہا: "the denominator tells the parts"، یعنی نیچے والا عدد حصے بتاتا ہے۔' };
    qs[6] = { ...qs[6], explanation: `denominator ${F(2, 7)} میں 7 ہے اور numerator 2 ہے۔` };
    expect(adjacency(validate(qs, FR_CTX).errors)).toEqual([]);
  });

  test('field by field: the pair is found in an Urdu line, and nothing is looked for in an English one', () => {
    const lex = AdjacentTerms.lessonLexicon(FR_DIGEST, fractions());
    expect(AdjacentTerms.adjacentTermsIn('جب numerator denominator سے چھوٹا ہو', lex).map((f) => f.pair)).toEqual(['numerator denominator']);
    expect(AdjacentTerms.adjacentTermsIn('when the numerator denominator is small', lex)).toEqual([]);
    expect(AdjacentTerms.adjacentTermsIn('جب numerator اور denominator برابر ہوں', lex)).toEqual([]);
  });

  test('an English quiz is never checked for it', () => {
    const qs = fractions();
    expect(adjacency(validate(qs, { ...FR_CTX, language: 'en' }).errors)).toEqual([]);
  });
});

/**
 * A one-word term beside a two-word term that OPENS WITH AN ADJECTIVE.
 *
 * Staging, an Urdu quiz on proper fractions, a stem:
 *   «ان میں سے کون سا fraction Proper Fraction ہے؟»   (which of these fractions is a proper fraction?)
 * It was not flagged. The lesson's terms were "Proper Fraction" and the like,
 * and "fraction" never stood alone anywhere in the quiz, so the word on the
 * left was not a known unit and the boundary was let through. But English
 * never puts a noun straight before an adjective inside one phrase: when the
 * right side is a lesson term that opens with an adjective ("Proper Fraction",
 * "like fractions", "Mixed Fraction"), a content word before it is a separate
 * part of the Urdu sentence, whatever else the quiz says about that word.
 */
describe('1b — a word before a lesson term that opens with an adjective', () => {
  const PHRASE_DIGEST = {
    ...FR_DIGEST,
    key_terms: [{ term: 'Proper Fraction' }, { term: 'Improper Fraction' }, { term: 'like fractions' }, { term: 'Least Common Multiple' }, { term: 'Simple Present Tense' }],
  };
  // "fraction" only ever appears inside a phrase in this quiz — the staging shape
  const lexFor = (extra) => AdjacentTerms.lessonLexicon(PHRASE_DIGEST, [
    { question: 'ان میں سے کون سی Proper Fraction ہے؟', options: ['Proper Fraction', 'Improper Fraction', 'دونوں'], explanation: 'Proper Fraction میں اوپر والا عدد چھوٹا ہوتا ہے۔', option_feedback: { correct: 'درست!', wrong: {} } },
    ...(extra || []),
  ]);
  const flagged = (text) => AdjacentTerms.adjacentTermsIn(text, lexFor()).map((f) => f.pair);

  test('the staging stem: «کون سا fraction Proper Fraction ہے؟» is two parts of the sentence side by side', () => {
    expect(flagged('ان میں سے کون سا fraction Proper Fraction ہے؟')).toEqual(['fraction Proper']);
  });

  test('the same shape with another adjective-led term: «fractions like fractions بن جائیں», «fraction Improper Fraction ہو»', () => {
    expect(flagged('تاکہ denominator 16 بن جائے اور fractions like fractions بن جائیں۔')).toEqual(['fractions like']);
    expect(flagged('اگر حاصل شدہ fraction Improper Fraction ہو تو اسے Mixed Number میں بدلیں۔')).toEqual(['fraction Improper']);
  });

  test('a term whose adjectives are its own words is still one phrase: Least Common Multiple, Simple Present Tense, «ایک Proper Fraction»', () => {
    expect(flagged('5 اور 2 کا Least Common Multiple 10 ہے۔')).toEqual([]);
    expect(flagged('یہ جملہ Simple Present Tense میں ہے۔')).toEqual([]);
    expect(flagged('یہ ایک Proper Fraction ہے۔')).toEqual([]);
  });

  test('through the validator, on a quiz where "fraction" never stands alone: the staging stem is named on its question', () => {
    // Every bare "fraction" becomes «کسر», so the word is only ever part of a phrase — the staging quiz's shape.
    const bare = /(?<!(?:proper|improper|mixed|like|unlike) )\bfractions?\b/gi;
    const urduOnly = (x) => (typeof x === 'string' ? x.replace(bare, 'کسر')
      : Array.isArray(x) ? x.map(urduOnly)
        : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, urduOnly(v)])) : x);
    const qs = [...fractions().slice(0, 4), REPAIRED_ITEM, ...fractions().slice(5)].map(urduOnly);
    qs[2] = { ...qs[2], question: 'ان میں سے کون سا fraction Proper Fraction ہے؟' };
    const got = adjacency(validate(qs, { ...FR_CTX, digest: PHRASE_DIGEST }).errors);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatch(/^q2: URDU_ADJACENT_TERMS — question\b/);
    expect(got[0]).toContain('fraction Proper');
  });
});

describe('2 — one question\'s text to repair, and never a reason to send nothing', () => {
  test('the targeted rewrite takes it, and it is a soft fault', () => {
    const errs = validate(fractions(), FR_CTX).errors;
    expect(Rewrite.rewriteTargets(errs).indices).toEqual([4]);
    errs.forEach((e) => expect(Gen.SOFT_FAULT.test(e)).toBe(true));
  });

  test('the last-attempt salvage never drops a question for it', () => {
    const qs = fractions(); qs[1] = { ...qs[1], options: ['denominator', 'denominator', 'mixed fraction'] };
    const errs = validate(qs, FR_CTX).errors;
    const out = Gen.salvageWithoutBadFigures(qs, errs, { language: 'ur', subject: 'maths', digest: FR_DIGEST, quizId: QID, lessonSummary: FR_CTX.lessonSummary, gradeBand: '3-5' });
    expect(out.refused).toBeUndefined();
    expect(out.dropped).toEqual([1]);
    expect(out.softFaults.some((e) => /^q\d: URDU_ADJACENT_TERMS/.test(e))).toBe(true);
  });
});

describe('3 — the prompts', () => {
  test('the author prompt says never to put two English terms side by side, with the fix, and keeps a two-word term whole', () => {
    const p = buildAuthorPrompt({ digest: FR_DIGEST, excerpts: 'x', language: 'ur', n: 8, gradeBand: '3-5' });
    expect(p).toContain('NEVER TWO ENGLISH TERMS SIDE BY SIDE');
    expect(p).toContain('numerator کی قیمت denominator سے کم');
    expect(p).toContain('cross multiplication');
  });

  test('the targeted rewrite for this fault repairs the SAME question in place', () => {
    const errs = validate(fractions(), FR_CTX).errors;
    const p = Rewrite.buildRewritePrompt({ digest: FR_DIGEST, language: 'ur', questions: fractions(), targets: Rewrite.rewriteTargets(errs) });
    expect(p).toContain('TWO ENGLISH TERMS SIDE BY SIDE — REPAIR IN PLACE');
    expect(p).toMatch(/q4: URDU_ADJACENT_TERMS/);
  });
});

// ── 4. the generate path, the LLM mocked at the network boundary ─────────────
// An English-grammar lesson quizzed in Urdu, grade 7 (no picture is demanded),
// with the production shape «Brother کا feminine noun Sister ہے۔» in one feedback.
const EN_DIGEST = {
  topic: 'Gender of nouns', topic_as_taught: 'masculine and feminine nouns', subject: 'english',
  grade_band: '6-8', language_of_instruction: 'ur', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'name the feminine noun for a masculine noun', statement_en: 'name the feminine noun for a masculine noun', taught_level: 'recall' },
    { id: 'S2', statement: 'tell a masculine noun from a feminine noun', statement_en: 'tell a masculine noun from a feminine noun', taught_level: 'understand' },
  ],
  key_terms: [{ term: 'masculine noun' }, { term: 'feminine noun' }], examples_used: ['brother and sister', 'king and queen'], misconceptions_surfaced: [],
};
const EN_SUMMARY = 'آج کے سبق میں masculine noun اور feminine noun کی پہچان اور ان کے جوڑے سکھائے گئے۔';
const gq = ({ slo = 'S1', level = 'recall', question, options, explanation, correct, wrong }) => ({
  slo_id: slo, level, question, options, correct_index: 0,
  explanation: explanation || 'ہر masculine noun کا ایک feminine noun ہوتا ہے۔',
  selected_because: 'سبق میں جوڑوں کی مثالیں دی گئیں',
  distractor_misconceptions: { 1: 'جوڑا الٹ سمجھنا', 2: 'کوئی اور رشتہ چن لینا' },
  option_feedback: { correct: correct || 'بالکل درست!', wrong: wrong || { 1: 'یہ اس کا جوڑا نہیں ہے۔', 2: 'یہ بھی اس کا جوڑا نہیں ہے۔' } },
});
function grammar() {
  return [
    gq({ question: 'Brother کا feminine noun کیا ہے؟', options: ['Sister', 'Mother', 'Uncle'], correct: 'شاباش! Brother کے ساتھ جوڑا Sister کا ہے۔' }),
    gq({ question: 'King کا feminine noun کیا ہے؟', options: ['Queen', 'Princess', 'Aunt'], correct: 'درست! King کے ساتھ جوڑا Queen کا ہے۔' }),
    gq({ question: 'Father کا feminine noun کیا ہے؟', options: ['Mother', 'Sister', 'Daughter'] }),
    gq({ question: 'Boy کا feminine noun کیا ہے؟', options: ['Girl', 'Woman', 'Lady'] }),
    gq({ slo: 'S2', level: 'understand', question: 'ان میں سے کون سا masculine noun ہے؟', options: ['Uncle', 'Aunt', 'Niece'] }),
    gq({ slo: 'S2', level: 'understand', question: 'ان میں سے کون سا feminine noun ہے؟', options: ['Niece', 'Nephew', 'Uncle'] }),
    gq({ slo: 'S2', level: 'understand', question: 'لفظ Son کس قسم کا noun ہے؟', options: ['masculine noun', 'feminine noun', 'دونوں'] }),
    gq({ slo: 'S2', level: 'understand', question: 'لفظ Daughter کس قسم کا noun ہے؟', options: ['feminine noun', 'masculine noun', 'دونوں'] }),
  ];
}
const TWO_TERMS = (q) => ({ ...q, option_feedback: { ...q.option_feedback, correct: 'بالکل درست! Brother کا feminine noun Sister ہے۔' } });
const ONE_PLACE = (q) => ({ ...q, option_feedback: { ...q.option_feedback, correct: 'بالکل درست! Brother کے لیے feminine noun کا جواب Sister ہے۔' } });

function reply(obj) { return { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.01 } }; }
const promptOf = (call) => call[0].messages[0].content;
const isRewrite = (call) => /REWRITE THESE QUESTIONS/.test(call.messages[0].content);
function wire() {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{
      id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: EN_DIGEST.topic, subject: 'english', language: 'ur', status: 'generating', meta: { digest: EN_DIGEST, grade: '7', step: 'author' },
    }] }),
    coaching_sessions: { data: [{ id: SID, user_id: 'u-1', transcript_text: 'سبق '.repeat(400), transcript_language: 'ur', created_at: '2026-09-24T04:00:00Z', analysis_data: {}, users: { phone_number: '923001234567', preferred_language: 'ur', name: 'A B' } }] },
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

describe('4 — on the generate path: repaired in place, and the quiz ships whatever the repair leaves', () => {
  test('the fixture is otherwise clean, and the planted feedback is the only complaint', () => {
    const qs = grammar(); qs[0] = TWO_TERMS(qs[0]);
    const errs = validate(qs, { language: 'ur', subject: 'english', digest: EN_DIGEST, nExpected: 8, lessonSummary: EN_SUMMARY }).errors;
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/^q0: URDU_ADJACENT_TERMS — option_feedback\.correct\b/);
  });

  test('one pair side by side → ONE rewrite carrying the rule → the repaired question ships, 8 of 8', async () => {
    const bad = grammar(); bad[0] = TWO_TERMS(bad[0]);
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 0, ...ONE_PLACE(grammar()[0]) }] }))
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: bad }))));
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const rw = promptOf(mockCreate.mock.calls[1]);
    expect(rw).toContain('REWRITE THESE QUESTIONS: q0');
    expect(rw).toContain('TWO ENGLISH TERMS SIDE BY SIDE — REPAIR IN PLACE');
    const rows = storedRows();
    expect(rows).toHaveLength(8);
    const q0 = rows.find((x) => x.question_text.includes('Brother'));
    expect(JSON.stringify(q0.option_feedback)).toContain('feminine noun کا جواب Sister');
    expect(lastMeta().soft_faults).toBeUndefined();
  });

  test('a repair that leaves the pair as it was SHIPS the quiz whole with the fault recorded — no re-roll, nothing dropped', async () => {
    const bad = grammar(); bad[0] = TWO_TERMS(bad[0]);
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 0, ...bad[0] }] }))   // the same text back
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: bad }))));
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);          // one author call + one repair; never a second full attempt
    expect(storedRows()).toHaveLength(8);
    expect((lastMeta().soft_faults || []).filter((e) => /^q0: URDU_ADJACENT_TERMS/.test(e))).toHaveLength(1);
    const events = logEvent.mock.calls.map((c) => c[0]);
    expect(events).not.toContain('transcript_quiz.failed');
    expect(events).toContain('transcript_quiz.adjacent_terms');
  });

  test('beside a gendered verb, both are repaired by the same ONE call, and the quiz ships', async () => {
    const bad = grammar(); bad[0] = TWO_TERMS(bad[0]);
    bad[3] = { ...bad[3], question: 'Boy کا feminine noun آپ کیا لکھیں گے؟' };
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 0, ...ONE_PLACE(grammar()[0]) }, { index: 3, ...grammar()[3] }] }))
      : Promise.resolve(reply({ lesson_summary: EN_SUMMARY, questions: bad }))));
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const rw = promptOf(mockCreate.mock.calls[1]);
    expect(rw).toContain('REWRITE THESE QUESTIONS: q0, q3');
    expect(rw).toContain('TWO ENGLISH TERMS SIDE BY SIDE — REPAIR IN PLACE');
    expect(rw).toContain('THE CHILD HAS NO GENDER');
    expect(storedRows()).toHaveLength(8);
  });
});
