'use strict';
/**
 * The people in a lesson, and their names in Urdu script, recorded once.
 *
 * The in-place repair of a Latin name (URDU_NAME_LATIN) only worked once a
 * repair had been asked about the name and returned its spelling. In 4 of 30
 * replays of a grade 4 fractions lesson in Urdu, a rewrite made for ANOTHER
 * fault (a gendered verb, the blind solve) wrote the lesson's child in English
 * letters into a teacher's note before the quiz knew the spelling, and it
 * shipped. The cause is that the spelling was learned late, per repair.
 *
 * Now the digest records each person in the lesson's material once,
 * { latin, ur }; the author and every Urdu rewrite are given the spelling up
 * front; and the validator writes it into every Urdu field and picture label
 * that still has the name in English letters. Every question that ships has
 * passed the validator, so no teacher note keeps "Hira".
 *
 * Names are never logged (data standard D4): the name events carry counts.
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
const F = require('./helpers/lp-key-check-fixture');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const Rewrite = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');
const Digest = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');
const { buildAuthorPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { logEvent } = require('../../bot/shared/utils/structured-logger');

const QID = '99999999-9999-4999-8999-999999999999';
const SID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// The four teacher notes the replays shipped with the child's name in English
// letters, each written by a rewrite made for another fault.
const LEFTOVER_NOTES = [
  '‏Hira کے بوتل کے مثال کا استعمال کرتے ہوئے cross multiplication کا اطلاق۔',
  '‏Hira کے مثال میں cross multiplication کے پہلے product کی شناخت کرنا۔',
  '‏Hira کے بوتل کے جوس کے موازنے کا پہلا step',
  '‏Hira کے بوتل کے جوس کے مثال سے common denominator کا تصور.',
];

const PEOPLE = [{ latin: 'Hira', ur: 'حرا' }];
const DIGEST = {
  topic: 'Compare fractions', topic_as_taught: 'Compare fractions', subject: 'maths', grade_band: '6-8', language_of_instruction: 'ur', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'compare two fractions', statement_en: 'compare two fractions', taught_level: 'understand' },
    { id: 'S2', statement: 'read a fraction off a bar', statement_en: 'read a fraction off a bar', taught_level: 'recall' },
  ],
  key_terms: [{ term: 'cross multiplication', as_spoken: 'cross multiplication' }, { term: 'common denominator', as_spoken: 'common denominator' }],
  examples_used: ["Hira: 2/3 of her bottle vs 3/5 of her friend's bottle"], misconceptions_surfaced: [],
  people: PEOPLE,
};
const OLD_DIGEST = (() => { const { people, ...d } = DIGEST; return d; })();   // eslint-disable-line no-unused-vars
const SUMMARY = 'آج کے سبق میں fractions کا موازنہ سکھایا گیا، ایک بوتل کی مثال سے۔';
const CTX = { language: 'ur', subject: 'maths', digest: DIGEST, nExpected: 8, lessonSummary: SUMMARY };
const base = (o) => ({
  slo_id: 'S1', level: 'understand', correct_index: 0,
  explanation: 'چھوٹا denominator بڑے حصے دیتا ہے۔', selected_because: 'سبق کی بوتل والی مثال',
  distractor_misconceptions: { 1: 'بڑا denominator بڑا سمجھنا', 2: 'صرف numerator دیکھنا' },
  option_feedback: { correct: 'جی ہاں۔', wrong: { 1: 'حصے چھوٹے ہیں۔', 2: 'دوبارہ دیکھیں۔' } },
  ...o,
});
function quiz() {
  return [2, 3, 4, 5, 6, 7, 8, 9].map((i) => base({
    level: i < 5 ? 'recall' : 'understand', slo_id: i < 5 ? 'S2' : 'S1',
    question: `کون سا fraction بڑا ہے، $\\frac{${i}}{${i + 2}}$ یا $\\frac{${i}}{${i + 3}}$؟ (${i})`,
    options: [`$\\frac{${i}}{${i + 2}}$`, `$\\frac{${i}}{${i + 3}}$`, 'دونوں برابر ہیں'],
  }));
}
/** The quiz with each leftover note as one question's selected_because. */
function withLeftovers() {
  const qs = quiz();
  LEFTOVER_NOTES.forEach((note, k) => { qs[k + 1] = { ...qs[k + 1], selected_because: note }; });
  return qs;
}
const names = (errs) => errs.filter((e) => /URDU_NAME_LATIN/.test(e));

describe('1 — the digest records each person once, with the Urdu spelling', () => {
  test('both digest prompts ask for "people" as {latin, ur}, only from the lesson\'s material', () => {
    const t = Digest.buildDigestPrompt({ transcript: 'سبق', transcriptLanguage: 'ur' });
    const lp = LpDigest.buildLpDigestPrompt({ slideScript: F.SLIDE_SCRIPT, language: 'ur', grade: 3, subject: 'urdu' });
    [t, lp].forEach((p) => {
      expect(p).toMatch(/"people": \[ \{ "latin": "", "ur": "" \} \]/);
      expect(p).toMatch(/never the teacher/i);
      expect(p).toMatch(/never a child in the class/i);
    });
  });

  test('the normaliser keeps each person once, in English letters and in Urdu script, and drops the rest', () => {
    const d = Digest.normaliseDigest({
      topic: 'x',
      people: [
        { latin: 'Hira', ur: 'حرا' },
        { latin: 'Hira', ur: 'حرا' },                 // twice
        { latin: 'Ahmed Ali', ur: 'احمد علی' },       // two words
        { latin: 'Sara', ur: 'Sara' },                 // no Urdu spelling
        { latin: 'علی', ur: 'علی' },                   // no English letters
        { latin: '', ur: 'زینب' },
        'Bilal',
      ],
    });
    expect(d.people).toEqual([{ latin: 'Hira', ur: 'حرا' }, { latin: 'Ahmed Ali', ur: 'احمد علی' }]);
    expect(Digest.normaliseDigest({ topic: 'x' }).people).toEqual([]);
  });

  test('a common name is written the way families write it, whatever spelling the model guessed', () => {
    // Replayed: 3 of 16 lesson-plan digests spelled Hira «ہرا» — the Urdu word
    // for "green" — and, fed to every writer, the whole quiz said it.
    const d = Digest.normaliseDigest({ topic: 'x', people: [{ latin: 'Hira', ur: 'ہرا' }, { latin: 'Ali', ur: 'الی' }, { latin: 'Gulnaz', ur: 'گلناز' }] });
    expect(d.people).toEqual([{ latin: 'Hira', ur: 'حرا' }, { latin: 'Ali', ur: 'علی' }, { latin: 'Gulnaz', ur: 'گلناز' }]);
    // a stored digest from before is read the same way
    const v = validate(withLeftovers(), { ...CTX, digest: { ...DIGEST, people: [{ latin: 'Hira', ur: 'ہرا' }] } });
    expect(JSON.stringify(v.questions)).not.toContain('ہرا');
    expect(v.questions[1].selected_because).toContain('حرا');
    // and both digest prompts say a name is never spelled as an ordinary Urdu word
    [Digest.buildDigestPrompt({ transcript: 'سبق', transcriptLanguage: 'ur' }), LpDigest.buildLpDigestPrompt({ slideScript: F.SLIDE_SCRIPT, language: 'ur' })]
      .forEach((p) => expect(p).toMatch(/Hira → «حرا», never «ہرا»/));
  });

  test('the lesson-plan digest keeps the people its model returns', async () => {
    mockCreate.mockResolvedValueOnce(reply({ ...F.MODEL_DIGEST, people: PEOPLE }));
    const out = await LpDigest.run({ slideScript: F.SLIDE_SCRIPT, language: 'ur', grade: 3, subject: 'urdu', lessonId: F.LESSON_ID });
    expect(out.digest.people).toEqual(PEOPLE);
  });
});

describe('2 — the validator writes the recorded spelling (the four leftover teacher notes)', () => {
  test('without a recorded spelling the four notes are four name faults (the replays)', () => {
    const errs = validate(withLeftovers(), { ...CTX, digest: OLD_DIGEST }).errors;
    expect(errs.filter((e) => !/URDU_NAME_LATIN/.test(e))).toEqual([]);
    expect(names(errs).map((e) => e.slice(0, 19))).toEqual(['q1: URDU_NAME_LATIN', 'q2: URDU_NAME_LATIN', 'q3: URDU_NAME_LATIN', 'q4: URDU_NAME_LATIN']);
  });

  test('with it, each note ships the name in Urdu script and nothing is complained of', () => {
    const v = validate(withLeftovers(), CTX);
    expect(v.errors).toEqual([]);
    LEFTOVER_NOTES.forEach((note, k) => {
      expect(v.questions[k + 1].selected_because).toBe(note.replace('Hira', 'حرا'));
    });
    expect(JSON.stringify(v.questions)).not.toMatch(/\bHira\b/);
  });

  test('every Urdu field and every picture label, and only the recorded people', () => {
    const qs = quiz();
    qs[0] = base({
      slo_id: 'S2', level: 'recall',
      question: 'تصویر میں Hira کی بوتل اور دوست کی بوتل ہے۔ Hira کی بوتل کا کتنا حصہ پانی سے بھرا ہے؟',
      options: ['$\\frac{2}{3}$', '$\\frac{3}{5}$', '$\\frac{1}{3}$'],
      explanation: 'Hira کی بوتل کے 3 حصوں میں سے 2 بھرے ہیں۔',
      option_feedback: { correct: 'درست، Hira کی بوتل۔', wrong: { 1: 'یہ دوست کی بوتل ہے۔', 2: 'Hira کی بوتل دوبارہ دیکھیں۔' } },
      distractor_misconceptions: { 1: 'Hira کی بوتل کو دوست کی سمجھنا', 2: 'خالی حصہ گننا' },
      figure: { type: 'fraction_bar', bars: [{ parts: 3, shaded: 2, label: 'Hira کی بوتل' }, { parts: 5, shaded: 3, label: 'دوست کی بوتل' }] },
      figure_role: 'read_off',
    });
    const v = validate(qs, CTX);
    expect(v.errors).toEqual([]);
    expect(JSON.stringify(v.questions[0])).not.toMatch(/\bHira\b/);
    expect(v.questions[0].figure.bars[0].label).toBe('حرا کی بوتل');
    // a name the digest did not record is still a name fault
    const other = quiz(); other[5] = { ...other[5], selected_because: 'سبق میں Sara کی مثال' };
    const sara = { ...CTX, digest: { ...DIGEST, examples_used: [...DIGEST.examples_used, "Sara's apples"] } };
    expect(names(validate(other, sara).errors)).toHaveLength(1);
    // and an English quiz is never rewritten into Urdu script
    const en = quiz().map((q, i) => ({ ...q, question: `Which fraction is bigger for Hira? (${i})`, options: ['2/3', '3/5', 'the same'], explanation: 'Two thirds is more.', selected_because: "Hira's bottle", option_feedback: { correct: 'Yes.', wrong: { 1: 'No.', 2: 'No.' } }, distractor_misconceptions: { 1: 'x', 2: 'y' } }));
    expect(JSON.stringify(validate(en, { ...CTX, language: 'en' }).questions)).not.toContain('حرا');
  });
});

describe('3 — the author and every Urdu rewrite are given the spelling up front', () => {
  const RULE = /Hira → «حرا»/;
  test('the author prompt, in an Urdu quiz only', () => {
    expect(buildAuthorPrompt({ digest: DIGEST, excerpts: '…', language: 'ur', gradeBand: '6-8' })).toMatch(RULE);
    expect(buildAuthorPrompt({ digest: DIGEST, excerpts: '…', language: 'en', gradeBand: '6-8' })).not.toMatch(RULE);
    expect(buildAuthorPrompt({ digest: OLD_DIGEST, excerpts: '…', language: 'ur', gradeBand: '6-8' })).not.toMatch(/THE PEOPLE IN THIS LESSON/);
  });

  test('the targeted rewrite, the teacher-fields repair and the picture repair', async () => {
    const qs = quiz();
    const targets = Rewrite.rewriteTargets(['q3: PEDAGOGY_GENDERED_CHILD — question speaks to the child with a gendered verb']);
    expect(Rewrite.buildRewritePrompt({ digest: DIGEST, language: 'ur', questions: qs, targets })).toMatch(RULE);
    expect(Rewrite.buildTeacherFieldsPrompt({ digest: DIGEST, questions: qs, indices: [3] })).toMatch(RULE);
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pictures: [] }) }, finish_reason: 'stop' }], usage: {} });
    await Rewrite.addPictures({ questions: qs, digest: { ...DIGEST, grade_band: '4' }, language: 'ur', gradeBand: '4', need: 1 });
    expect(mockCreate.mock.calls[0][0].messages[0].content).toMatch(RULE);
  });
});

// ── 4. the generate path ──────────────────────────────────────────────────────
function reply(obj) { return { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.01 } }; }
const isRewrite = (call) => /REWRITE THESE QUESTIONS/.test(call.messages[0].content);
function wire(digest) {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{
      id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: digest.topic, subject: 'maths', language: 'ur', status: 'generating', meta: { digest, grade: '7', step: 'author' },
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
  jest.spyOn(Gen, 'renderFigures').mockResolvedValue({});
  jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
});

describe('4 — on the generate path: a rewrite for another fault never leaves the name in a teacher note', () => {
  // The replayed shape: the author's q3 speaks to the child with a gendered
  // verb; its one repair fixes the verb and writes the child in English
  // letters into the teacher's note, and the quiz has learned no spelling.
  const gendered = () => { const qs = quiz(); qs[3] = { ...qs[3], question: `${qs[3].question} آپ کیا کہیں گے؟` }; return qs; };
  const repaired = () => ({ ...quiz()[3], question: `${quiz()[3].question} بتائیں۔`, selected_because: LEFTOVER_NOTES[2] });

  test('the note ships «حرا», no fault is recorded, and the repair was told the spelling', async () => {
    mockCreate.mockImplementation((call) => Promise.resolve(isRewrite(call)
      ? reply({ questions: [{ index: 3, ...repaired() }] })
      : reply({ lesson_summary: 'آج کے سبق میں Hira کی بوتل کی مثال سے fractions کا موازنہ سکھایا گیا۔', questions: gendered() })));
    wire(DIGEST);
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const rw = mockCreate.mock.calls.map(([c]) => c.messages[0].content).find((p) => /REWRITE THESE QUESTIONS/.test(p));
    expect(rw).toMatch(/Hira → «حرا»/);
    const rows = storedRows();
    expect(rows).toHaveLength(8);
    expect(JSON.stringify(rows)).not.toMatch(/\bHira\b/);
    expect(JSON.stringify(rows)).toContain('حرا کے بوتل کے جوس کے موازنے کا پہلا step');
    expect((lastMeta().soft_faults || []).filter((e) => /URDU_NAME_LATIN/.test(e))).toEqual([]);
    // the teacher's summary is the teacher's page too
    expect(lastMeta().lesson_summary).toContain('حرا کی بوتل');
    expect(lastMeta().lesson_summary).not.toMatch(/\bHira\b/);
  });

  test('a name the repair could not reach is recorded, and no event carries the name (D4)', async () => {
    mockCreate.mockImplementation((call) => Promise.resolve(isRewrite(call)
      ? reply({ questions: [{ index: 3, ...repaired() }] })
      : reply({ lesson_summary: SUMMARY, questions: gendered() })));
    wire(OLD_DIGEST);   // a digest from before people were recorded
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect((lastMeta().soft_faults || []).filter((e) => /^q3: URDU_NAME_LATIN/.test(e))).toHaveLength(1);
    const nameEvents = logEvent.mock.calls.filter(([name]) => /latin_name/.test(name));
    expect(nameEvents.length).toBeGreaterThan(0);
    nameEvents.forEach(([, payload]) => {
      expect(JSON.stringify(payload)).not.toMatch(/Hira|حرا/);
    });
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.latin_name', expect.objectContaining({ quizId: QID, names: 1, questions: [3] }));
  });
});
