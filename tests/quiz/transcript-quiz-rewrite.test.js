'use strict';
/**
 * A QUIZ NEVER SHIPS SHORT — the targeted rewrite before the salvage.
 *
 * Two live generations on 2026-09-06 shipped 7 and 6 questions of 8. In both,
 * the retry re-rolled the WHOLE quiz, the model wrote the same rejected
 * question again, and the last-attempt salvage then dropped it:
 *
 *   English lesson: attempts 1 and 2 both rejected on `q0:
 *     PEDAGOGY_COUNT_RECALL` — the same "how many kinds of …" question twice —
 *     salvage dropped [0] → 7 questions.
 *   Urdu lesson: attempt 2 rejected on `q7: FIGURE_TYPE` (geometry on a
 *     non-maths subject) and `q0: PEDAGOGY_COUNT_RECALL`; salvage dropped
 *     [7, 0] → 6 questions.
 *
 * The rules are right; the RECOVERY is what fails. When the last full attempt's
 * remaining complaints are all per-question and touch at most three questions,
 * one small call rewrites exactly those questions and the merged set is
 * re-validated; only if that fails does the salvage drop anything.
 *
 * Mocked at the NETWORK boundary (llm-client's getClientForModel), never at a
 * module under test: the author prompt, the retry note, transcript-quiz-llm's
 * JSON extraction, the validator, the rewrite prompt, the merge and the salvage
 * all execute for real on this branch.
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
const Rewrite = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');
const { buildAuthorPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-author.service');

const QID = '33333333-3333-4333-8333-333333333333';
const SID = '44444444-4444-4444-8444-444444444444';

// ── the English lesson ───────────────────────────────────────────────────────
const DIGEST_EN = {
  topic: 'Degrees of Adjective', topic_as_taught: 'Degrees of Adjective', subject: 'english',
  grade_band: '6-8', language_of_instruction: 'en', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'name the three degrees of an adjective', taught_level: 'recall' },
    { id: 'S2', statement: 'compare two things with the comparative degree', taught_level: 'understand' },
    { id: 'S3', statement: 'use the superlative degree in a sentence', taught_level: 'understand' },
  ],
  key_terms: ['positive', 'comparative', 'superlative'], examples_used: ['tall, taller, tallest'], misconceptions_surfaced: [],
};
const SUMMARY_EN = 'She taught the three degrees of an adjective with tall, taller and tallest, then had the class compare two pupils and then the whole row.';

function enQ({ slo = 'S1', level = 'recall', question, options, why }) {
  return {
    slo_id: slo, level, question, options, correct_index: 0,
    explanation: 'The comparative compares two things and the superlative compares three or more.',
    selected_because: why || 'she wrote tall, taller, tallest on the board',
    distractor_misconceptions: { 1: 'uses the plain form to compare', 2: 'uses the superlative for two things' },
    option_feedback: {
      correct: 'Yes — that is the form we use when we compare, just like tall, taller, tallest on the board.',
      wrong: {
        1: 'That is the plain form; when we compare two things we add -er, as in taller.',
        2: 'That form is for three or more; for two things we use the comparative, taller.',
      },
    },
  };
}

/** Seven good questions plus the offender at index 0 — the live shape. */
function enEight({ q0 } = {}) {
  const bad = enQ({ question: 'How many kinds of adjective degree are there?', options: ['3', '2', '4'] });
  return [
    q0 || bad,
    enQ({ slo: 'S2', level: 'understand', question: 'Ali is 5 feet. Sara is 6 feet. Which word describes Sara?', options: ['taller', 'tall', 'tallest'] }),
    enQ({ question: 'Which of these is the plain (positive) degree?', options: ['tall', 'taller', 'tallest'] }),
    enQ({ slo: 'S3', level: 'understand', question: 'Which word fits: "He is the ____ boy in the whole school."', options: ['tallest', 'taller', 'tall'] }),
    enQ({ question: 'Which word is the superlative of "small"?', options: ['smallest', 'smaller', 'small'] }),
    enQ({ slo: 'S2', level: 'understand', question: 'Two mangoes are on the table. Which word compares them?', options: ['sweeter', 'sweetest', 'sweet'] }),
    enQ({ question: 'Which ending do we add for the comparative degree?', options: ['-er', '-est', '-ing'] }),
    enQ({ slo: 'S3', level: 'understand', question: 'Which sentence uses the superlative correctly?', options: ['She is the fastest of all.', 'She is the faster of all.', 'She is fast of all.'] }),
  ];
}

const EN_REPLACEMENT = enQ({
  question: 'Which of these is the comparative degree of "tall"?',
  options: ['taller', 'tallest', 'tall'],
  why: 'she wrote tall, taller, tallest on the board',
});

// ── the Urdu lesson ──────────────────────────────────────────────────────────
const DIGEST_UR = {
  topic: 'Types of Maps', topic_as_taught: 'نقشوں کی اقسام', subject: 'sst',
  grade_band: '6-8', language_of_instruction: 'ur', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'نقشوں کی اقسام بتانا', taught_level: 'recall' },
    { id: 'S2', statement: 'نقشے اور تصویر میں فرق سمجھنا', taught_level: 'understand' },
    { id: 'S3', statement: 'نقشے کے پیمانے کا استعمال', taught_level: 'understand' },
  ],
  key_terms: ['map', 'scale'], examples_used: ['دیوار پر لگا نقشہ'], misconceptions_surfaced: [],
};
const SUMMARY_UR = 'انہوں نے دیوار پر لگے نقشے سے نقشوں کی اقسام پڑھائیں اور پھر پیمانے کی مدد سے فاصلہ ناپنا سکھایا۔';

function urQ({ slo = 'S1', level = 'recall', question, options, figure = null }) {
  return {
    slo_id: slo, level, question, options, correct_index: 0,
    explanation: 'نقشہ زمین کی چپٹی تصویر ہوتا ہے جس پر پیمانہ لکھا ہوتا ہے۔',
    selected_because: 'دیوار پر لگے نقشے والی بات سے لیا گیا',
    distractor_misconceptions: { 1: 'نقشے کو تصویر سمجھنا', 2: 'پیمانے کو نظر انداز کرنا' },
    option_feedback: {
      correct: 'بالکل ٹھیک — دیوار والے نقشے پر بھی یہی چیز دکھائی گئی تھی۔',
      wrong: {
        1: 'یہ تصویر کی بات ہے؛ نقشے پر پیمانہ اور نشانات ہوتے ہیں۔',
        2: 'پیمانہ ضروری ہوتا ہے، اسی سے اصل فاصلہ معلوم ہوتا ہے۔',
      },
    },
    ...(figure ? { figure, figure_role: 'read_off' } : {}),
  };
}

// Four of the eight sit on an SLO taught above recall: PEDAGOGY_LEVEL_MIX is
// measured on whatever set survives, so a fixture whose level mix only just
// clears at eight would fail the rule the moment one question is dropped — and
// the salvage would then drop a second one, which is the very effect this suite
// is measuring.
function urEight({ q0, q7 } = {}) {
  return [
    q0 || urQ({ question: 'نقشوں کی کتنی اقسام ہوتی ہیں؟', options: ['۳', '۲', '۴'] }),
    urQ({ slo: 'S2', level: 'understand', question: 'ان میں سے کون سی چیز ہر نقشے پر لازمی ہوتی ہے؟', options: ['پیمانہ', 'رنگ', 'کاغذ'] }),
    urQ({ slo: 'S2', level: 'understand', question: 'دیوار پر لگا ہوا نقشہ کس چیز کو دکھاتا ہے؟', options: ['زمین کا حصہ', 'ایک کمرہ', 'ایک کتاب'] }),
    urQ({ slo: 'S3', level: 'understand', question: 'پیمانہ کس کام آتا ہے؟', options: ['اصل فاصلہ معلوم کرنے', 'رنگ چننے', 'نام لکھنے'] }),
    urQ({ question: 'موسم دکھانے والا نقشہ کس قسم کا ہوتا ہے؟', options: ['موسمی نقشہ', 'سیاسی نقشہ', 'طبعی نقشہ'] }),
    urQ({ slo: 'S2', level: 'understand', question: 'پہاڑ اور دریا دکھانے کے لیے کون سا نقشہ چنیں گے؟', options: ['طبعی نقشہ', 'سیاسی نقشہ', 'موسمی نقشہ'] }),
    urQ({ question: 'ملکوں کی حدیں کون سا نقشہ دکھاتا ہے؟', options: ['سیاسی نقشہ', 'طبعی نقشہ', 'موسمی نقشہ'] }),
    q7 || urQ({
      slo: 'S3', level: 'understand', question: 'یہ شکل کس چیز کی ہے؟', options: ['مثلث', 'دائرہ', 'مربع'],
      figure: { type: 'geometry', kind: 'triangle', a: 3, b: 4 },
    }),
  ];
}

const UR_REPLACEMENT_0 = urQ({ question: 'ان میں سے کون سا نقشوں کی ایک قسم ہے؟', options: ['سیاسی نقشہ', 'پیمانہ', 'کاغذ'] });
const UR_REPLACEMENT_7 = urQ({
  slo: 'S3', level: 'understand', question: 'اگر پیمانہ ایک سینٹی میٹر برابر دس کلومیٹر ہو تو دو سینٹی میٹر کتنے بنیں گے؟',
  options: ['بیس کلومیٹر', 'دس کلومیٹر', 'دو کلومیٹر'],
});

// ── the harness ──────────────────────────────────────────────────────────────
function reply(obj) {
  return { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.01 } };
}

function quizRow(language, digest) {
  return {
    id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: digest.topic, subject: digest.subject,
    language, status: 'generating', meta: { digest, grade: '7', step: 'author' },
  };
}
function sessionRow(language) {
  return {
    id: SID, user_id: 'u-1', transcript_text: 'lesson '.repeat(400), transcript_language: language,
    created_at: '2026-09-06T05:00:00Z', analysis_data: { topic: 'x', subject: 'x' },
    users: { phone_number: '923001234567', preferred_language: language, first_name: 'Rifat', last_name: 'Noor' },
  };
}

function wire(language, digest) {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quizRow(language, digest)] }),
    coaching_sessions: { data: [sessionRow(language)] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [sessionRow(language).users] },
  });
}

/** The rows the pipeline actually stored. */
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

// ─────────────────────────────────────────────────────────────────────────────
describe('1 — rewriteTargets: which rejections one small call can repair', () => {
  test('all-per-question pedagogy/figure complaints on ≤3 questions are targetable', () => {
    const t = Rewrite.rewriteTargets([
      'q7: FIGURE_TYPE — "geometry" draws mathematics only; use flow, timeline or no picture',
      'q0: PEDAGOGY_COUNT_RECALL — this stem asks how many things were mentioned',
    ]);
    expect(t.indices).toEqual([0, 7]);
    expect(t.byIndex[0]).toHaveLength(1);
    expect(t.byIndex[7][0]).toMatch(/FIGURE_TYPE/);
  });

  test('two complaints on ONE question are one target', () => {
    const t = Rewrite.rewriteTargets([
      'q0: PEDAGOGY_COUNT_RECALL — …',
      'q0: PEDAGOGY_TEACHER_AS_SUBJECT — …',
    ]);
    expect(t.indices).toEqual([0]);
    expect(t.byIndex[0]).toHaveLength(2);
  });

  test('a quiz-level complaint is not targetable — a rewrite of 3 questions cannot fix the set', () => {
    expect(Rewrite.rewriteTargets(['q0: PEDAGOGY_COUNT_RECALL — …', 'SLOs uncovered: S3']).indices).toEqual([]);
    expect(Rewrite.rewriteTargets(['PEDAGOGY_LEVEL_MIX — only 3 of 8 …']).indices).toEqual([]);
    expect(Rewrite.rewriteTargets(['FIGURE_SHARE — 5/8 questions carry a picture']).indices).toEqual([]);
  });

  test('a structural complaint is not targetable', () => {
    expect(Rewrite.rewriteTargets(['q0: 2 options', 'q1: empty stem']).indices).toEqual([]);
  });

  test('more than three questions is a re-roll, not a repair', () => {
    const errs = [0, 1, 2, 3].map((i) => `q${i}: PEDAGOGY_COUNT_RECALL — …`);
    expect(Rewrite.rewriteTargets(errs).indices).toEqual([]);
  });

  test('an empty or missing error list is not targetable', () => {
    expect(Rewrite.rewriteTargets([]).indices).toEqual([]);
    expect(Rewrite.rewriteTargets(null).indices).toEqual([]);
  });
});

describe('2 — the rewrite prompt', () => {
  const targets = Rewrite.rewriteTargets(['q0: PEDAGOGY_COUNT_RECALL — this stem asks how many things were mentioned']);

  test('the quiz-language rule is the FIRST instruction, before anything else', () => {
    const p = Rewrite.buildRewritePrompt({ digest: DIGEST_UR, language: 'ur', questions: urEight(), targets, gradeBand: '6-8' });
    const langAt = p.indexOf('Write EVERYTHING in Urdu');
    expect(langAt).toBeGreaterThanOrEqual(0);
    expect(langAt).toBeLessThan(p.indexOf('REWRITE THESE QUESTIONS'));
  });

  test('it carries the rejected question, its complaint verbatim, and its SLO — and no other question as a target', () => {
    const p = Rewrite.buildRewritePrompt({ digest: DIGEST_EN, language: 'en', questions: enEight(), targets, gradeBand: '6-8' });
    expect(p).toContain('REWRITE THESE QUESTIONS: q0');
    expect(p).toContain('How many kinds of adjective degree are there?');
    expect(p).toContain('this stem asks how many things were mentioned');
    expect(p).toContain('name the three degrees of an adjective');
    // the seven good ones are named as "staying", never as targets
    expect(p).toContain('Which word is the superlative of "small"?');
    expect(p).not.toContain('REWRITE THESE QUESTIONS: q0, q4');
  });

  test('a replacement is a text question — the rewrite never draws a new picture', () => {
    const p = Rewrite.buildRewritePrompt({ digest: DIGEST_EN, language: 'en', questions: enEight(), targets, gradeBand: '6-8' });
    expect(p).toMatch(/leave "figure" and "figure_role" null/i);
  });

  test('it is far smaller than the full author prompt it replaces', () => {
    const full = buildAuthorPrompt({ digest: DIGEST_EN, excerpts: 'x'.repeat(6000), language: 'en', n: 8, gradeBand: '6-8' });
    const p = Rewrite.buildRewritePrompt({ digest: DIGEST_EN, language: 'en', questions: enEight(), targets, gradeBand: '6-8' });
    expect(p.length).toBeLessThan(full.length / 2);
  });
});

describe('3 — the English lesson: one rejected question, replaced, 8 shipped', () => {
  test('the rewrite call carries exactly the offending index and the quiz ships 8 questions', async () => {
    mockCreate
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY_EN, questions: enEight() }))
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY_EN, questions: enEight() }))
      .mockResolvedValueOnce(reply({ questions: [{ index: 0, ...EN_REPLACEMENT }] }));
    wire('en', DIGEST_EN);

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);

    // three calls: two full attempts, then ONE targeted rewrite
    expect(mockCreate).toHaveBeenCalledTimes(3);
    const rw = promptOf(mockCreate.mock.calls[2]);
    expect(rw).toContain('REWRITE THESE QUESTIONS: q0');
    expect(rw).toContain('How many kinds of adjective degree are there?');

    const rows = storedRows();
    expect(rows).toHaveLength(8);
    expect(rows[0].question_text).toBe('Which of these is the comparative degree of "tall"?');
    expect(rows.map((x) => x.sort_order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('rewrite_attempted is emitted with the indices and the outcome, and no salvage happens', async () => {
    mockCreate
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY_EN, questions: enEight() }))
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY_EN, questions: enEight() }))
      .mockResolvedValueOnce(reply({ questions: [{ index: 0, ...EN_REPLACEMENT }] }));
    wire('en', DIGEST_EN);
    await Gen.process(QID, {});

    const names = logEvent.mock.calls.map((c) => c[0]);
    expect(names).toContain('transcript_quiz.rewrite_attempted');
    expect(names).not.toContain('transcript_quiz.figure_salvage');
    const ev = logEvent.mock.calls.find((c) => c[0] === 'transcript_quiz.rewrite_attempted')[1];
    expect(ev).toEqual(expect.objectContaining({ quizId: QID, indices: [0], ok: true }));
  });

  test('the rewrite is recorded in meta.author_attempts beside the two full attempts', async () => {
    mockCreate
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY_EN, questions: enEight() }))
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY_EN, questions: enEight() }))
      .mockResolvedValueOnce(reply({ questions: [{ index: 0, ...EN_REPLACEMENT }] }));
    wire('en', DIGEST_EN);
    await Gen.process(QID, {});

    const updates = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update');
    const withAttempts = updates.map((c) => c[1]).filter((p) => p.meta && p.meta.author_attempts);
    const attempts = withAttempts[withAttempts.length - 1].meta.author_attempts;
    expect(attempts.map((a) => a.attempt)).toEqual([1, 2, 'rewrite']);
    expect(attempts[2].indices).toEqual([0]);
    expect(attempts[2].errors).toEqual([]);
  });
});

describe('4 — the Urdu lesson: a figure rejection and a pedagogy rejection, both replaced', () => {
  test('two offending indices go in one call and the quiz ships 8 questions', async () => {
    mockCreate
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY_UR, questions: urEight() }))
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY_UR, questions: urEight() }))
      .mockResolvedValueOnce(reply({ questions: [{ index: 0, ...UR_REPLACEMENT_0 }, { index: 7, ...UR_REPLACEMENT_7 }] }));
    wire('ur', DIGEST_UR);

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(3);
    const rw = promptOf(mockCreate.mock.calls[2]);
    expect(rw).toContain('REWRITE THESE QUESTIONS: q0, q7');
    expect(rw).toMatch(/geometry/);

    const rows = storedRows();
    expect(rows).toHaveLength(8);
    expect(rows[7].question_text).toContain('پیمانہ');
    expect(rows.some((x) => x.media && x.media.question_image)).toBe(false);
  });
});

describe('5 — the rewrite fails: the salvage still runs and the teacher still gets a quiz', () => {
  test('a rewrite that repeats the same bad question falls through to the salvage', async () => {
    const stillBad = enQ({ question: 'How many kinds of adjective degree are there?', options: ['3', '2', '4'] });
    mockCreate
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY_EN, questions: enEight() }))
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY_EN, questions: enEight() }))
      .mockResolvedValueOnce(reply({ questions: [{ index: 0, ...stillBad }] }));
    wire('en', DIGEST_EN);

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(storedRows()).toHaveLength(7);
    const ev = logEvent.mock.calls.find((c) => c[0] === 'transcript_quiz.rewrite_attempted')[1];
    expect(ev.ok).toBe(false);
    expect(logEvent.mock.calls.map((c) => c[0])).toContain('transcript_quiz.figure_salvage');
  });

  test('a rewrite call that throws is not fatal — the salvage still ships 7', async () => {
    mockCreate
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY_EN, questions: enEight() }))
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY_EN, questions: enEight() }))
      .mockRejectedValueOnce(new Error('502 upstream'));
    wire('en', DIGEST_EN);

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(storedRows()).toHaveLength(7);
  });

  test('a rewrite that fixes ONE of two rejections salvages the other — 7, not 6', async () => {
    mockCreate
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY_UR, questions: urEight() }))
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY_UR, questions: urEight() }))
      .mockResolvedValueOnce(reply({ questions: [
        { index: 0, ...UR_REPLACEMENT_0 },
        { index: 7, ...urQ({ slo: 'S3', level: 'understand', question: 'یہ شکل کس چیز کی ہے؟', options: ['مثلث', 'دائرہ', 'مربع'], figure: { type: 'geometry', kind: 'triangle', a: 3, b: 4 } }) },
      ] }));
    wire('ur', DIGEST_UR);

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(storedRows()).toHaveLength(7);
  });
});

describe('6 — a rejection the rewrite must NOT try to repair', () => {
  test('an all-wrong-script attempt is re-rolled, never rewritten', async () => {
    // an English quiz that came back entirely in Urdu: every question complains,
    // so there is nothing small to repair.
    mockCreate
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY_UR, questions: urEight() }))
      .mockResolvedValueOnce(reply({ lesson_summary: SUMMARY_EN, questions: enEight({ q0: EN_REPLACEMENT }) }));
    wire('en', DIGEST_EN);

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);   // no rewrite call at all
    expect(storedRows()).toHaveLength(8);
    expect(logEvent.mock.calls.map((c) => c[0])).not.toContain('transcript_quiz.rewrite_attempted');
  });
});

describe('7 — the author prompt: the two prompt fixes this bead carries', () => {
  test('"question 1 is the easiest" says what easiest MEANS, and rules out the count', () => {
    const p = buildAuthorPrompt({ digest: DIGEST_EN, excerpts: 'x', language: 'en', n: 8, gradeBand: '6-8' });
    const line = p.split('\n').find((l) => /Question 1/.test(l));
    expect(line).toBeDefined();
    expect(line).toMatch(/pick|identif/i);
    expect(line).toMatch(/never a count/i);
  });

  test('the retry note restates the quiz-language rule FIRST, before the complaints', () => {
    const p = buildAuthorPrompt({
      digest: DIGEST_EN, excerpts: 'x', language: 'en', n: 8, gradeBand: '6-8',
      previousErrors: ['q0: PEDAGOGY_COUNT_RECALL — …'],
    });
    const noteAt = p.indexOf('A PREVIOUS ATTEMPT FAILED THESE CHECKS');
    const langAgain = p.indexOf('Write EVERYTHING in English', noteAt - 400);
    expect(noteAt).toBeGreaterThan(0);
    expect(langAgain).toBeGreaterThan(0);
    expect(langAgain).toBeLessThan(noteAt);
  });

  test('an attempt that came back in the wrong script is NAMED as that, not left as eight complaints', () => {
    const wrongScript = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `q${i}: an English quiz must be written in English — the stem and options are mostly not Latin script`);
    const p = buildAuthorPrompt({
      digest: DIGEST_EN, excerpts: 'x', language: 'en', n: 8, gradeBand: '6-8', previousErrors: wrongScript,
    });
    expect(p).toMatch(/WHOLE PREVIOUS ATTEMPT (CAME BACK )?IN THE WRONG (SCRIPT|LANGUAGE)/i);
  });
});

describe('8 — mergeReplacements puts a replacement back where it belongs, or nowhere', () => {
  const targets = { indices: [0, 7], byIndex: { 0: ['q0: PEDAGOGY_COUNT_RECALL — …'], 7: ['q7: FIGURE_TYPE — …'] } };
  const eight = enEight();

  test('a reply with no "index" is matched positionally, in the order the targets were asked', () => {
    const r = Rewrite.mergeReplacements(eight, { questions: [{ ...EN_REPLACEMENT }, { ...EN_REPLACEMENT, question: 'second' }] }, targets);
    expect(r.replaced).toEqual([0, 7]);
    expect(r.questions[0].question).toBe(EN_REPLACEMENT.question);
    expect(r.questions[7].question).toBe('second');
  });

  test('a replacement naming an index we did not ask about is discarded, never relocated', () => {
    const r = Rewrite.mergeReplacements(eight, { questions: [{ index: 2, ...EN_REPLACEMENT }] }, targets);
    expect(r).toBeNull();
    // and the good half of a mixed reply still lands
    const r2 = Rewrite.mergeReplacements(eight, { questions: [{ index: 2, ...EN_REPLACEMENT }, { index: 7, ...EN_REPLACEMENT }] }, targets);
    expect(r2.replaced).toEqual([7]);
    expect(r2.questions[2].question).toBe(eight[2].question);
  });

  test('a replacement that draws a picture is discarded and its original kept', () => {
    const withFig = { index: 0, ...EN_REPLACEMENT, figure: { type: 'geometry', kind: 'triangle' } };
    expect(Rewrite.mergeReplacements(eight, { questions: [withFig] }, targets)).toBeNull();
  });

  test('a kept replacement inherits its question\'s slo_id and level when it names neither', () => {
    const bare = { index: 7, question: 'q', options: ['a', 'b', 'c'], correct_index: 0 };
    const r = Rewrite.mergeReplacements(eight, { questions: [bare] }, targets);
    expect(r.questions[7]).toEqual(expect.objectContaining({
      slo_id: eight[7].slo_id, level: eight[7].level, figure: null, figure_role: null,
    }));
  });
});
