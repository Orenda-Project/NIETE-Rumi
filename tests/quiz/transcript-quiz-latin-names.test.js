'use strict';
/**
 * A person's name in an Urdu quiz is written in Urdu script — and when it is
 * not, the quiz records it.
 *
 * A remade grade 4 Urdu quiz kept the lesson's child, Hira, in English letters
 * inside the Urdu sentences ("‏Hira کی بوتل"), the bar's name included: the
 * Urdu style rule keeps TERMS in English letters and the model read the name
 * as one. The prompt now says a name is not a term. The check is light by
 * design — a Latin capitalised word in an Urdu field that the lesson's own
 * examples use as a name, not a key term — and it never refuses a quiz: it is
 * recorded in meta.soft_faults and on transcript_quiz.latin_name, so the rate
 * is visible.
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'A B', topic: 'Fractions' }),
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
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const { installAgreeingSolver } = require('./helpers/key-verify-agree');
const { latinNames } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { logEvent } = require('../../bot/shared/utils/structured-logger');

const DIGEST = {
  topic: 'Compare fractions', topic_as_taught: 'Compare fractions', subject: 'maths', grade_band: '4', language_of_instruction: 'ur', confidence: 0.9,
  slos: [{ id: 'S1', statement: 'compare two fractions', taught_level: 'understand' }],
  key_terms: ['cross multiplication', 'Fraction'], examples_used: ["Hira's bottle holds 2/3, her friend's 3/5"], misconceptions_surfaced: [],
};

describe('latinNames — the light check', () => {
  test('a name from the lesson, in English letters inside Urdu, in a stem or a bar name', () => {
    const qs = [
      { question: '‏Hira کی بوتل میں کتنا پانی ہے؟', options: ['a', 'b', 'c'] },
      { question: 'کون سی پٹی بڑی ہے؟', options: ['P', 'Q', 'R'], figure: { type: 'fraction_bar', bars: [{ parts: 3, shaded: 2, label: 'Hira کی بوتل' }] } },
      { question: 'حرا کی بوتل میں کتنا پانی ہے؟', options: ['a', 'b', 'c'] },
    ];
    expect(latinNames(qs, { language: 'ur', digest: DIGEST })).toEqual([
      'q0: URDU_NAME_LATIN — "Hira" is a person\'s name, not a term: in an Urdu quiz write it in Urdu script',
      'q1: URDU_NAME_LATIN — "Hira" is a person\'s name, not a term: in an Urdu quiz write it in Urdu script',
    ]);
  });

  test('never a term, never an English quiz, never a word the lesson did not use as a name', () => {
    const qs = [{ question: '‏Fraction کو cross multiplication سے compare کریں۔ Sara نے کہا', options: ['a', 'b', 'c'] }];
    expect(latinNames(qs, { language: 'ur', digest: DIGEST })).toEqual([]);
    expect(latinNames([{ question: 'Hira has a bottle.', options: ['a', 'b', 'c'] }], { language: 'en', digest: DIGEST })).toEqual([]);
  });
});

test('generate records it as a soft fault and an event, and the quiz ships', async () => {
  const QID = '44444444-4444-4444-8444-444444444444';
  const SID = '33333333-3333-4333-8333-333333333333';
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{
      id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: 'Compare fractions', subject: 'maths', language: 'ur', status: 'generating',
      meta: { digest: { ...DIGEST, grade_band: '6-8' }, grade: '7', step: 'author' },
    }] }),
    coaching_sessions: { data: [{ id: SID, user_id: 'u-1', transcript_text: 'سبق '.repeat(400), transcript_language: 'ur', created_at: '2026-09-07T04:00:00Z', analysis_data: {}, users: { phone_number: '920000000001', preferred_language: 'ur', name: 'A B' } }] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [{ phone_number: '920000000001', preferred_language: 'ur' }] },
  });
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  jest.spyOn(Gen, 'renderFigures').mockResolvedValue({});
  jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
  const item = (i) => ({
    slo_id: 'S1', level: i ? 'understand' : 'recall',
    question: i === 3 ? '‏Hira کی بوتل میں $\\frac{2}{3}$ پانی ہے۔ کون سا fraction بڑا ہے؟' : `کون سا fraction بڑا ہے، $\\frac{${i + 1}}{${i + 3}}$ یا $\\frac{${i + 1}}{${i + 4}}$؟ (${i})`,
    options: [`$\\frac{${i + 1}}{${i + 3}}$`, `$\\frac{${i + 1}}{${i + 4}}$`, 'دونوں برابر ہیں'], correct_index: 0,
    explanation: 'چھوٹا denominator بڑے حصے دیتا ہے۔', selected_because: 'سبق کی مثال',
    distractor_misconceptions: { 1: 'بڑا denominator بڑا سمجھنا', 2: 'صرف numerator دیکھنا' },
    option_feedback: { correct: 'جی ہاں۔', wrong: { 1: 'حصے چھوٹے ہیں۔', 2: 'دوبارہ دیکھیں۔' } },
  });
  const reply = { choices: [{ message: { content: JSON.stringify({
    lesson_summary: 'آج کے سبق میں fractions کا موازنہ سکھایا گیا، حرا کی بوتل کی مثال سے۔', lesson_summary_short: 'fractions کا موازنہ۔', checks_summary: 'یہ کوئز fractions کا موازنہ جانچتا ہے۔',
    questions: [0, 1, 2, 3, 4, 5, 6, 7].map(item),
  }) }, finish_reason: 'stop' }], usage: { cost: 0.004 } };
  // a maths lesson with no picture is sent back once (FIGURE_REQUIRED, attempt 1 only)
  mockCreate.mockResolvedValueOnce(reply).mockResolvedValueOnce(reply);
  const out = await Gen.process(QID);
  expect(out.ok).toBe(true);
  const metas = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((c) => c[1].meta).filter(Boolean);
  expect(metas.pop().soft_faults).toEqual(expect.arrayContaining([expect.stringMatching(/^q3: URDU_NAME_LATIN — "Hira"/)]));
  expect(logEvent).toHaveBeenCalledWith('transcript_quiz.latin_name', expect.objectContaining({ quizId: QID, names: ['Hira'], questions: [3] }));
});
