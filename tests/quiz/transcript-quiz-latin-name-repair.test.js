'use strict';
/**
 * A person's name written in English letters inside an Urdu quiz
 * (URDU_NAME_LATIN) is REPAIRED IN PLACE, the way two English terms side by
 * side are: one targeted rewrite, then the quiz ships, never a refusal.
 *
 * Until now the check only recorded it, so an Urdu stem still read "‏Hira کی
 * بوتل" in English letters. Now:
 *   1. the validator names it on its question, with every field it sits in,
 *      a picture's labels included; a key term is still never a name;
 *   2. it is a soft, in-place fault: the targeted rewrite takes it, the salvage
 *      never drops a question for it, and it never costs a hard fault its
 *      place in the repair;
 *   3. the rewrite prompt carries a repair rule for it and asks for the Urdu
 *      spelling of each name, and it lists the lesson's key terms as words;
 *   4. the merge keeps the picture of a question repaired in place and writes
 *      the name in its labels the same way as the stem, so the two agree;
 *   5. on the generate path the name comes out «حرا» in the stem, options,
 *      explanation, feedback and teacher notes, and the bar says «حرا» too.
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
const Rewrite = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { logEvent } = require('../../bot/shared/utils/structured-logger');

const QID = '77777777-7777-4777-8777-777777777777';
const SID = '88888888-8888-4888-8888-888888888888';

// A grade 7 Urdu fractions quiz (no picture is demanded at this grade), with
// the lesson's child in two questions: q0 in the stem, an option, the
// explanation, the feedback and the teacher's note; q1 in the stem and in the
// bar's name. Written once with the name in English letters, once in Urdu.
const DIGEST = {
  topic: 'Compare fractions', topic_as_taught: 'Compare fractions', subject: 'maths', grade_band: '6-8', language_of_instruction: 'ur', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'compare two fractions', statement_en: 'compare two fractions', taught_level: 'understand' },
    { id: 'S2', statement: 'read a fraction off a bar', statement_en: 'read a fraction off a bar', taught_level: 'recall' },
  ],
  key_terms: [{ term: 'cross multiplication', as_spoken: 'cross multiplication' }, { term: 'Fraction', as_spoken: 'fraction' }],
  examples_used: ["Hira's bottle holds 2/3 of water, her friend's 3/5"], misconceptions_surfaced: [],
};
const SUMMARY = 'آج کے سبق میں fractions کا موازنہ سکھایا گیا، ایک بوتل کی مثال سے۔';
const CTX = { language: 'ur', subject: 'maths', digest: DIGEST, nExpected: 8, lessonSummary: SUMMARY };
const base = (o) => ({
  slo_id: 'S1', level: 'understand', correct_index: 0,
  explanation: 'چھوٹا denominator بڑے حصے دیتا ہے۔', selected_because: 'سبق کی بوتل والی مثال',
  distractor_misconceptions: { 1: 'بڑا denominator بڑا سمجھنا', 2: 'صرف numerator دیکھنا' },
  option_feedback: { correct: 'جی ہاں۔', wrong: { 1: 'حصے چھوٹے ہیں۔', 2: 'دوبارہ دیکھیں۔' } },
  ...o,
});
const BARS = (a) => ({ type: 'fraction_bar', bars: [{ parts: 3, shaded: 2, label: `${a} کی بوتل` }, { parts: 5, shaded: 3, label: 'دوست کی بوتل' }] });
function quiz(n) {
  return [
    base({
      question: `${n} کی بوتل میں $\\frac{2}{3}$ پانی ہے اور دوست کی بوتل میں $\\frac{3}{5}$۔ کس کی بوتل میں زیادہ پانی ہے؟`,
      options: [`${n} کی بوتل`, 'دوست کی بوتل', 'دونوں میں برابر'],
      explanation: `cross multiplication سے ${n} کی بوتل میں $\\frac{10}{15}$ اور دوست کی بوتل میں $\\frac{9}{15}$ بنتا ہے۔`,
      option_feedback: { correct: `بالکل! ${n} کی بوتل میں زیادہ پانی ہے۔`, wrong: { 1: 'دوست کی بوتل میں $\\frac{9}{15}$ ہے۔', 2: 'دونوں کو cross multiplication سے دیکھیں۔' } },
      selected_because: `سبق میں ${n} کی بوتل کی مثال`,
    }),
    base({
      slo_id: 'S2', level: 'recall',
      question: `تصویر میں ${n} کی بوتل اور دوست کی بوتل ہے۔ ${n} کی بوتل کا کتنا حصہ پانی سے بھرا ہے؟`,
      options: ['$\\frac{2}{3}$', '$\\frac{3}{5}$', '$\\frac{1}{3}$'],
      explanation: `${n} کی بوتل کے 3 حصوں میں سے 2 بھرے ہیں۔`,
      option_feedback: { correct: 'درست، 3 میں سے 2 حصے۔', wrong: { 1: 'یہ دوست کی بوتل ہے۔', 2: 'خالی حصہ نہیں، بھرا حصہ گنیں۔' } },
      figure: BARS(n), figure_role: 'read_off',
    }),
    ...[2, 3, 4, 5, 6, 7].map((i) => base({
      level: i < 4 ? 'recall' : 'understand', slo_id: i < 4 ? 'S2' : 'S1',
      question: `کون سا fraction بڑا ہے، $\\frac{${i}}{${i + 2}}$ یا $\\frac{${i}}{${i + 3}}$؟ (${i})`,
      options: [`$\\frac{${i}}{${i + 2}}$`, `$\\frac{${i}}{${i + 3}}$`, 'دونوں برابر ہیں'],
    })),
  ];
}
const LATIN = () => quiz('Hira');
const URDU = () => quiz('حرا');
const names = (errs) => errs.filter((e) => /URDU_NAME_LATIN/.test(e));

describe('1 — the validator names it on its question, every field included', () => {
  test('the same quiz in Urdu script is clean, and in English letters only the name is named', () => {
    expect(validate(URDU(), CTX).errors).toEqual([]);
    const errs = validate(LATIN(), CTX).errors;
    expect(errs.filter((e) => !/URDU_NAME_LATIN/.test(e))).toEqual([]);
    expect(names(errs)).toHaveLength(2);
    const [q0, q1] = names(errs);
    expect(q0).toMatch(/^q0: URDU_NAME_LATIN — "Hira" is a person's name, not a term/);
    ['question', 'option 0', 'explanation', 'option_feedback', 'selected_because'].forEach((f) => expect(q0).toContain(f));
    expect(q1).toMatch(/^q1: URDU_NAME_LATIN — "Hira"/);
    expect(q1).toContain('figure labels');
    // it says what to write: the same question, the name in Urdu script everywhere
    expect(q0).toMatch(/Urdu script/);
  });

  test('a name only in a picture\'s label is still named on its question', () => {
    const qs = URDU(); qs[1] = { ...qs[1], figure: BARS('Hira') };
    const errs = names(validate(qs, CTX).errors);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/^q1: URDU_NAME_LATIN — "Hira" is a person's name, not a term, written in English letters in figure labels\. /);
  });

  test('a key term is never a name ({term, as_spoken}), and an English quiz is never checked', () => {
    const vocab = {
      ...DIGEST,
      key_terms: [{ term: 'Brother', as_spoken: 'brother' }, { term: 'Sister', as_spoken: 'sister' }],
      examples_used: ['Brother and Sister', "Hira's brother"],
    };
    const qs = URDU(); qs[2] = { ...qs[2], explanation: 'جیسے Brother اور Sister کی مثال میں۔' };
    expect(names(validate(qs, { ...CTX, digest: vocab }).errors)).toEqual([]);
    expect(names(validate(LATIN(), { ...CTX, language: 'en' }).errors)).toEqual([]);
  });
});

describe('2 — a soft, in-place fault', () => {
  test('the targeted rewrite takes it, and it never refuses a quiz', () => {
    const errs = validate(LATIN(), CTX).errors;
    expect(Rewrite.rewriteTargets(errs).indices).toEqual([0, 1]);
    errs.forEach((e) => expect(Gen.SOFT_FAULT.test(e)).toBe(true));
  });

  test('the last-attempt salvage never drops a question for it', () => {
    const qs = LATIN(); qs[4] = { ...qs[4], options: ['دونوں برابر ہیں', 'دونوں برابر ہیں', '$\\frac{4}{7}$'] };
    const errs = validate(qs, CTX).errors;
    const out = Gen.salvageWithoutBadFigures(qs, errs, { language: 'ur', subject: 'maths', digest: DIGEST, quizId: QID, lessonSummary: SUMMARY, gradeBand: '6-8' });
    expect(out.refused).toBeUndefined();
    expect(out.dropped).toEqual([4]);
    expect(out.softFaults.some((e) => /^q\d: URDU_NAME_LATIN/.test(e))).toBe(true);
  });

  test('in-place questions never cost a hard fault its repair: over the cap, they are the ones left out', () => {
    // two questions with a hard fault, four with only the name: six in all
    const errs = [
      'q2: stem >200 code points',
      'q5: duplicate options',
      ...[0, 1, 3, 4].map((i) => `q${i}: URDU_NAME_LATIN — "Hira" is a person's name, not a term, and question writes it in English letters`),
    ];
    const t = Rewrite.rewriteTargets(errs);
    expect(t.indices).toEqual([0, 1, 2, 3, 5]);
    // six hard faults are still a re-roll, and six in-place questions alone still no repair
    expect(Rewrite.rewriteTargets([0, 1, 2, 3, 4, 5].map((i) => `q${i}: 2 options`)).indices).toEqual([]);
    expect(Rewrite.rewriteTargets([0, 1, 2, 3, 4, 5].map((i) => `q${i}: URDU_NAME_LATIN — "Hira" is a person's name`)).indices).toEqual([]);
  });
});

describe('3 — the rewrite prompt', () => {
  test('carries the in-place rule, asks for each name\'s Urdu spelling, and lists the key terms as words', () => {
    const qs = LATIN();
    const errs = validate(qs, CTX).errors;
    const p = Rewrite.buildRewritePrompt({ digest: DIGEST, language: 'ur', questions: qs, targets: Rewrite.rewriteTargets(errs) });
    expect(p).toContain('A NAME IN ENGLISH LETTERS — REPAIR IN PLACE');
    expect(p).toContain('«حرا»');
    expect(p).toMatch(/"names"/);
    expect(p).toMatch(/q0: URDU_NAME_LATIN/);
    // a real digest's key terms are objects: they are listed by their words
    expect(p).not.toContain('[object Object]');
    expect(p).toContain('cross multiplication');
  });

  test('a prompt without the fault carries neither the rule nor the "names" field', () => {
    const qs = URDU(); qs[3] = { ...qs[3], options: ['x', 'x', 'y'] };
    const p = Rewrite.buildRewritePrompt({ digest: DIGEST, language: 'ur', questions: qs, targets: Rewrite.rewriteTargets(['q3: duplicate options']) });
    expect(p).not.toContain('A NAME IN ENGLISH LETTERS — REPAIR IN PLACE');
    expect(p).not.toMatch(/"names"/);
  });
});

describe('4 — the merge: the picture stays, and its label agrees with the stem', () => {
  const errs = () => validate(LATIN(), CTX).errors;

  test('a question repaired in place keeps its picture, and the name in the bar is written as in the stem', () => {
    const targets = Rewrite.rewriteTargets(errs());
    const q1 = { ...URDU()[1], figure: null, figure_role: null };
    const out = Rewrite.mergeReplacements(LATIN(), { questions: [{ index: 0, ...URDU()[0] }, { index: 1, ...q1 }], names: { Hira: 'حرا' } }, targets);
    expect(out.replaced).toEqual([0, 1]);
    expect(out.questions[1].figure).toEqual(BARS('حرا'));
    expect(out.questions[1].figure_role).toBe('read_off');
    expect(JSON.stringify(out.questions)).not.toContain('Hira');
    expect(validate(out.questions, CTX).errors).toEqual([]);
  });

  test('a name the model left in English letters is written with the spelling it gave, in every Urdu field', () => {
    const targets = Rewrite.rewriteTargets(errs());
    const leftover = { ...URDU()[0], explanation: LATIN()[0].explanation, selected_because: LATIN()[0].selected_because };
    const out = Rewrite.mergeReplacements(LATIN(), { questions: [{ index: 0, ...leftover }, { index: 1, ...URDU()[1], figure: null }], names: { Hira: 'حرا' } }, targets);
    expect(out.questions[0].explanation).toBe(URDU()[0].explanation);
    expect(out.questions[0].selected_because).toBe(URDU()[0].selected_because);
    expect(JSON.stringify(out.questions)).not.toContain('Hira');
  });

  test('a spelling is taken only for a name that was named, and only in Urdu script', () => {
    const targets = Rewrite.rewriteTargets(errs());
    const reply = (map) => ({ questions: [{ index: 0, ...URDU()[0] }, { index: 1, ...URDU()[1], figure: null }], names: map });
    // Latin letters are not a spelling: the label keeps the name it had
    expect(Rewrite.mergeReplacements(LATIN(), reply({ Hira: 'Heera' }), targets).questions[1].figure).toEqual(BARS('Hira'));
    // a word nobody complained about is never rewritten
    const out = Rewrite.mergeReplacements(LATIN(), reply({ Hira: 'حرا', Fraction: 'کسر' }), targets);
    expect(out.questions[1].figure).toEqual(BARS('حرا'));
    expect(JSON.stringify(out.questions)).toContain('fraction');
  });

  test('a question rewritten for a hard fault is still a text question (NO NEW PICTURES is unchanged)', () => {
    const qs = LATIN();
    const targets = Rewrite.rewriteTargets(['q1: FIGURE_MISMATCH — the key is not on the bars']);
    const out = Rewrite.mergeReplacements(qs, { questions: [{ index: 1, ...URDU()[2], figure: null }] }, targets);
    expect(out.questions[1].figure).toBeNull();
  });
});

// ── 5. the generate path ──────────────────────────────────────────────────────
function reply(obj) { return { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.01 } }; }
const promptOf = (call) => call[0].messages[0].content;
const isRewrite = (call) => /REWRITE THESE QUESTIONS/.test(call.messages[0].content);
function wire() {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{
      id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: DIGEST.topic, subject: 'maths', language: 'ur', status: 'generating', meta: { digest: DIGEST, grade: '7', step: 'author' },
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
  installAgreeingSolver(Gen);
  // a drawn picture per figured question, so a stored row carries its figure
  jest.spyOn(Gen, 'renderFigures').mockImplementation(async ({ questions }) => Object.fromEntries(
    questions.map((q, i) => (q && q.figure ? [i, `https://r2/q${i}.png`] : null)).filter(Boolean),
  ));
  jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
});

describe('5 — on the generate path: one rewrite, then ship', () => {
  test('the name comes out «حرا» in every field, and the bar\'s label agrees with the stem', async () => {
    // the repair writes the name in Urdu, leaves it once in English letters in
    // an explanation, and gives the spelling; the picture it was told to leave
    // alone is put back with the same spelling
    const fixed1 = { ...URDU()[1], explanation: LATIN()[1].explanation, figure: null, figure_role: null };
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ names: { Hira: 'حرا' }, questions: [{ index: 0, ...URDU()[0] }, { index: 1, ...fixed1 }] }))
      : Promise.resolve(reply({ lesson_summary: SUMMARY, questions: LATIN() }))));
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);            // one author call + one repair
    const rw = promptOf(mockCreate.mock.calls[1]);
    expect(rw).toContain('REWRITE THESE QUESTIONS: q0, q1');
    expect(rw).toContain('A NAME IN ENGLISH LETTERS — REPAIR IN PLACE');
    const rows = storedRows();
    expect(rows).toHaveLength(8);
    expect(JSON.stringify(rows)).not.toContain('Hira');
    const bottle = rows.find((x) => x.question_text.includes('تصویر'));
    expect(bottle.question_text).toContain('حرا کی بوتل');
    expect(JSON.stringify(bottle.media.figure)).toContain('حرا کی بوتل');
    const q0 = rows.find((x) => x.question_text.includes('زیادہ پانی'));
    expect([q0.option_a, q0.option_b, q0.option_c]).toContain('حرا کی بوتل');
    expect(lastMeta().soft_faults).toBeUndefined();
    const events = logEvent.mock.calls.map((c) => c[0]);
    expect(events).toContain('transcript_quiz.latin_name_found');
    expect(events).not.toContain('transcript_quiz.latin_name');    // nothing shipped in English letters
  });

  test('a repair that leaves the name as it was SHIPS the quiz whole, the fault recorded once per question', async () => {
    mockCreate.mockImplementation((call) => (isRewrite(call)
      ? Promise.resolve(reply({ questions: [{ index: 0, ...LATIN()[0] }, { index: 1, ...LATIN()[1], figure: null }] }))
      : Promise.resolve(reply({ lesson_summary: SUMMARY, questions: LATIN() }))));
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);            // never a second full attempt
    const rows = storedRows();
    expect(rows).toHaveLength(8);
    // the question that shipped is the one that was written, picture and all
    expect(rows.find((x) => x.question_text.includes('تصویر')).media.figure).toBeTruthy();
    const soft = lastMeta().soft_faults || [];
    expect(soft.filter((e) => /^q0: URDU_NAME_LATIN/.test(e))).toHaveLength(1);
    expect(soft.filter((e) => /^q1: URDU_NAME_LATIN/.test(e))).toHaveLength(1);
    const events = logEvent.mock.calls.map((c) => c[0]);
    expect(events).not.toContain('transcript_quiz.failed');
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.latin_name', expect.objectContaining({ quizId: QID, names: ['Hira'], questions: [0, 1] }));
  });
});
