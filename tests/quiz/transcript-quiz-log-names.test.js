'use strict';
/**
 * No person's name in the logs (data standard D4).
 *
 * Two log paths still carried the name of a person from the lesson: the
 * complaint strings the authoring loop logs (URDU_NAME_LATIN quotes the name;
 * URDU_TEACHER_FIELDS quotes the field it rejects) and the label text of
 * transcript_quiz.figure_label_stripped. Each name is now replaced by a short
 * hash — the same name gives the same hash, so two lines about it can still be
 * matched — and the fault code, the key and the reason stay as they were.
 * The questions themselves, and what is stored with the quiz, are unchanged.
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
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { logToFile } = require('../../bot/shared/utils/logger');
const { logEvent } = require('../../bot/shared/utils/structured-logger');

const QID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const PEOPLE = [{ latin: 'Hira', ur: 'حرا' }];
const BASE_DIGEST = {
  topic: 'Compare fractions', topic_as_taught: 'Compare fractions', subject: 'maths', grade_band: '6-8', language_of_instruction: 'ur', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'compare two fractions', statement_en: 'compare two fractions', taught_level: 'understand' },
    { id: 'S2', statement: 'read a fraction off a bar', statement_en: 'read a fraction off a bar', taught_level: 'recall' },
  ],
  key_terms: [{ term: 'cross multiplication', as_spoken: 'cross multiplication' }],
  examples_used: ["Hira: 2/3 of her bottle vs 3/5 of her friend's bottle"], misconceptions_surfaced: [],
};
const DIGEST = { ...BASE_DIGEST, people: PEOPLE };
/** Every token of the digest's people, in both scripts. */
const TOKENS = PEOPLE.flatMap((p) => [p.latin, p.ur]);
const SUMMARY = 'آج کے سبق میں fractions کا موازنہ سکھایا گیا، ایک بوتل کی مثال سے۔';
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
/** Every payload the two loggers received, as text. */
const logged = () => [
  ...logToFile.mock.calls.map((c) => JSON.stringify(c.slice(1))),
  ...logEvent.mock.calls.map((c) => JSON.stringify(c[1] || {})),
];
const withToken = (tokens) => logged().filter((t) => tokens.some((w) => t.includes(w)));

beforeEach(() => {
  jest.clearAllMocks(); mockCreate.mockReset();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true'; delete process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS;
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  jest.spyOn(Gen, 'renderFigures').mockResolvedValue({});
  jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
});

describe('figure_label_stripped: the reason and the key, never the name', () => {
  // A bar named after the lesson's child under a stem that never names her is
  // a stray label and is stripped; the event said which label, in full.
  const stray = (label) => {
    const qs = quiz();
    qs[0] = base({
      slo_id: 'S2', level: 'recall', question: 'تصویر میں کون سی پٹی زیادہ بھری ہے؟',
      options: ['پہلی پٹی', 'دوسری پٹی', 'دونوں برابر'],
      figure: { type: 'fraction_bar', bars: [{ parts: 3, shaded: 2, label }, { parts: 5, shaded: 3 }] }, figure_role: 'read_off',
    });
    return qs;
  };
  const stripped = () => logEvent.mock.calls.filter(([n]) => n === 'transcript_quiz.figure_label_stripped').map(([, p]) => p);

  test('a recorded person, in Urdu script', () => {
    validate(stray('حرا کی بوتل'), { language: 'ur', subject: 'maths', digest: DIGEST, nExpected: 8 });
    const events = stripped();
    expect(events.length).toBeGreaterThan(0);
    expect(withToken(TOKENS)).toEqual([]);
    expect(events[0]).toEqual(expect.objectContaining({ type: 'fraction_bar', key: 'bars[0].label', reason: expect.any(String) }));
    expect(events[0].value).toMatch(/‹name:[0-9a-f]{6}› کی بوتل/);
  });

  test('a name from a digest made before people were recorded, in English letters', () => {
    validate(stray('Hira کی بوتل'), { language: 'ur', subject: 'maths', digest: BASE_DIGEST, nExpected: 8 });
    expect(stripped().length).toBeGreaterThan(0);
    expect(withToken(['Hira'])).toEqual([]);
  });
});

// ── the authoring loop ────────────────────────────────────────────────────────
function reply(obj) { return { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.01 } }; }
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
const kind = (call) => {
  const p = call.messages[0].content;
  if (/REWRITE THESE QUESTIONS/.test(p)) return 'rewrite';
  if (/REWRITE THE TEACHER FIELDS/.test(p)) return 'fields';
  return 'author';
};

describe('the authoring loop logs its complaints with the code, never the name', () => {
  test('URDU_NAME_LATIN beside a hard fault (a digest from before people were recorded)', async () => {
    const bad = quiz();
    bad[0] = { ...bad[0], question: `‏Hira کی بوتل میں ${bad[0].question}` };
    bad[1] = { ...bad[1], options: ['دونوں برابر ہیں', 'دونوں برابر ہیں', '$\\frac{3}{6}$'] };
    mockCreate.mockImplementation((call) => Promise.resolve(kind(call) === 'author'
      ? reply({ lesson_summary: SUMMARY, questions: bad })
      : reply({ questions: [] })));
    wire(BASE_DIGEST);
    await Gen.process(QID, {});
    const rejected = logToFile.mock.calls.filter(([m]) => /validator rejected attempt/.test(m));
    expect(rejected.length).toBeGreaterThan(0);
    // the fault is still named, and the name is not
    expect(JSON.stringify(rejected[0][1])).toContain('URDU_NAME_LATIN');
    expect(JSON.stringify(rejected[0][1])).toMatch(/‹name:[0-9a-f]{6}›/);
    expect(withToken(['Hira'])).toEqual([]);
  });

  test('a teacher note quoted by URDU_TEACHER_FIELDS, with the lesson\'s people recorded', async () => {
    const bad = quiz();
    bad[2] = { ...bad[2], selected_because: "Hira's bottle example, the first step" };
    bad[1] = { ...bad[1], options: ['دونوں برابر ہیں', 'دونوں برابر ہیں', '$\\frac{3}{6}$'] };
    mockCreate.mockImplementation((call) => Promise.resolve(kind(call) === 'author'
      ? reply({ lesson_summary: SUMMARY, questions: bad })
      : reply({ questions: [], fields: [] })));
    wire(DIGEST);
    await Gen.process(QID, {});
    const rejected = logToFile.mock.calls.filter(([m]) => /validator rejected attempt/.test(m));
    expect(rejected.length).toBeGreaterThan(0);
    expect(JSON.stringify(rejected[0][1])).toContain('URDU_TEACHER_FIELDS');
    expect(withToken(TOKENS)).toEqual([]);
  });
});
