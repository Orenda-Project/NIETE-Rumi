'use strict';
/**
 * The quiz language ask names English terms FROM THE LESSON.
 *
 * The ask tells the teacher what an Urdu quiz does with English terms: "Urdu —
 * English terms stay in English letters (…)". The two examples were hardcoded
 * as (fraction, numerator), so a Grade 5 science lesson on staging was told
 * about fractions. The examples now come from the lesson itself:
 *
 *   1. up to two of the digest's own key_terms that are English (Latin letters)
 *      and short enough to read at a glance;
 *   2. when the lesson has none (no digest yet — a quiz born from a lesson
 *      plan — or only Urdu terms), a pair that fits the SUBJECT, from one small
 *      map;
 *   3. and when neither fits, no examples at all — never another subject's.
 *
 * Every test drives a real sender (the offer's yes, the /quiz list, the 15:00
 * lesson-plan offer); only Supabase, WhatsApp and the queue are stubbed.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn() }));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({
  hasSeenIntroVideo: jest.fn().mockResolvedValue(true), markVideoShown: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WA = require('../../bot/shared/services/whatsapp.service');
const { installFrom } = require('./helpers/supabase-chain');
const Offer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');
const List = require('../../bot/shared/services/quiz/transcript-quiz-list.service');

const QID = '22222222-2222-4222-8222-222222222222';
const SID = '11111111-1111-4111-8111-111111111111';
const PHONE = '923001234567';
const UID = 'u-1';
const FSI = '\u2068';
const PDI = '\u2069';
const iso = (t) => `${FSI}${t}${PDI}`;

const teacher = (preferred = 'en') => ({ id: UID, phone_number: PHONE, preferred_language: preferred, name: 'T' });
const digest = (subject, terms) => ({
  topic: 'Lesson', topic_as_taught: 'Lesson', subject, grade_band: '3-5', language_of_instruction: 'ur', confidence: 0.9,
  slos: [{ id: 'S1', statement: 'a', taught_level: 'recall' }, { id: 'S2', statement: 'b', taught_level: 'understand' }],
  key_terms: terms.map((t) => (typeof t === 'string' ? { term: t, as_spoken: t } : t)),
  examples_used: [], misconceptions_surfaced: [],
});
const quizRow = (subject, meta) => ({
  id: QID, teacher_id: UID, coaching_session_id: SID, topic: 'Lesson', subject, language: 'ur',
  status: 'offered', meta,
});

/** The body of the one ask the teacher got after tapping yes on the offer. */
async function askAfterYes(subject, meta, preferred = 'en') {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quizRow(subject, meta)] }),
    users: { data: [teacher(preferred)] },
  });
  await Offer.handleOfferButton(`tq_yes_${QID}`, PHONE);
  expect(WA.sendInteractiveButtons).toHaveBeenCalledTimes(1);
  return WA.sendInteractiveButtons.mock.calls[0][1].body;
}

const exampleLine = (body) => body.split('\n').find((l) => /^(Urdu|\u200F?اردو)/.test(l));

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
});

describe('the lesson\'s own English terms', () => {
  test('a maths lesson names two of its own terms', async () => {
    const body = await askAfterYes('maths', { digest: digest('maths', ['common denominator', 'numerator', 'fraction']) });
    expect(exampleLine(body)).toBe(`Urdu — English terms stay in English letters (${iso('common denominator')}, ${iso('numerator')}).`);
  });

  test('a science lesson names science, never fractions', async () => {
    const body = await askAfterYes('science', { digest: digest('science', ['photosynthesis', 'chlorophyll', 'stomata']) });
    expect(exampleLine(body)).toBe(`Urdu — English terms stay in English letters (${iso('photosynthesis')}, ${iso('chlorophyll')}).`);
    expect(body).not.toMatch(/fraction|numerator/);
  });

  test('an English lesson names its grammar terms', async () => {
    const body = await askAfterYes('english', { digest: digest('english', ['proper noun', 'common noun']) });
    expect(exampleLine(body)).toBe(`Urdu — English terms stay in English letters (${iso('proper noun')}, ${iso('common noun')}).`);
  });

  test('in Urdu the terms are joined by the Urdu comma, each an isolate', async () => {
    const body = await askAfterYes('science', { digest: digest('science', ['photosynthesis', 'chlorophyll']) }, 'ur');
    expect(body).toContain(`(${iso('photosynthesis')}، ${iso('chlorophyll')})۔`);
    expect(body).not.toMatch(/fraction|numerator/);
  });

  test('Urdu-script terms, long phrases and repeats are passed over for ones that read as an example', async () => {
    const body = await askAfterYes('science', {
      digest: digest('science', [
        'ضیائی تالیف',                                   // not in English letters
        'the process by which green plants make food',   // a sentence, not a term
        'Photosynthesis', 'photosynthesis',              // one term, twice
        { term: '', as_spoken: 'x' },                     // nothing
        'carbon dioxide',
      ]),
    });
    expect(exampleLine(body)).toBe(`Urdu — English terms stay in English letters (${iso('Photosynthesis')}, ${iso('carbon dioxide')}).`);
  });

  test('one usable term is shown on its own', async () => {
    const body = await askAfterYes('science', { digest: digest('science', ['ضیائی تالیف', 'chlorophyll']) });
    expect(exampleLine(body)).toBe(`Urdu — English terms stay in English letters (${iso('chlorophyll')}).`);
  });
});

describe('no English terms in the lesson: a pair that fits the subject', () => {
  test.each([
    ['maths', 'fraction', 'numerator'],
    ['science', 'photosynthesis', 'cell'],
    ['english', 'noun', 'verb'],
  ])('%s with only Urdu terms', async (subject, a, b) => {
    const body = await askAfterYes(subject, { digest: digest(subject, ['واحد', 'جمع']) });
    expect(exampleLine(body)).toBe(`Urdu — English terms stay in English letters (${iso(a)}, ${iso(b)}).`);
  });

  test('a subject the map has no pair for gets no examples at all', async () => {
    const body = await askAfterYes('sst', { digest: digest('sst', ['نقشہ']) });
    expect(exampleLine(body)).toBe('Urdu — English terms stay in English letters.');
    expect(body).not.toMatch(/\(/);
  });

  test('no examples in Urdu either', async () => {
    const body = await askAfterYes('genk', { digest: digest('genk', []) }, 'ur');
    expect(body).toContain('اردو — English اصطلاحات انگریزی حروف میں۔');
    expect(body).not.toMatch(/\(|fraction/);
  });
});

describe('the other senders pass the lesson too', () => {
  test('/quiz on a lesson whose quiz failed re-asks with the lesson\'s own terms', async () => {
    const session = {
      id: SID, user_id: UID, created_at: '2026-09-05T05:00:00Z', transcript_text: 'x'.repeat(3000),
      transcript_language: 'ur', analysis_data: { topic: 'Plants', subject: 'Science' },
    };
    installFrom(supabase.from, {
      coaching_sessions: { data: [session] },
      quizzes: { data: [{ ...quizRow('science', { digest: digest('science', ['stomata', 'xylem']) }), status: 'failed' }] },
    });
    await List.handleListPick(`tq_pick_${SID}`, PHONE, teacher('en'));
    const body = WA.sendInteractiveButtons.mock.calls[0][1].body;
    expect(exampleLine(body)).toBe(`Urdu — English terms stay in English letters (${iso('stomata')}, ${iso('xylem')}).`);
  });

  test('/quiz on a lesson with no quiz yet (no digest) uses the subject\'s pair', async () => {
    const session = {
      id: SID, user_id: UID, created_at: '2026-09-05T05:00:00Z', transcript_text: 'x'.repeat(3000),
      transcript_language: 'ur', analysis_data: { topic: 'Plants', subject: 'General Science' },
    };
    installFrom(supabase.from, {
      coaching_sessions: { data: [session] },
      quizzes: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: [{ id: QID }] } : { data: [] }),
    });
    await List.handleListPick(`tq_pick_${SID}`, PHONE, teacher('en'));
    const body = WA.sendInteractiveButtons.mock.calls[0][1].body;
    expect(exampleLine(body)).toBe(`Urdu — English terms stay in English letters (${iso('photosynthesis')}, ${iso('cell')}).`);
  });

  test('a lesson-plan quiz still waiting for its language, picked from /quiz, uses the subject\'s pair', async () => {
    installFrom(supabase.from, {
      quizzes: { data: [{ ...quizRow('general_science', { step: 'awaiting_language', awaiting_language: true }), quiz_source: 'lp_v8', coaching_session_id: null }] },
    });
    await List.handleListPick(`tq_pick_lp_${QID}`, PHONE, teacher('en'));
    const body = WA.sendInteractiveButtons.mock.calls[0][1].body;
    expect(exampleLine(body)).toBe(`Urdu — English terms stay in English letters (${iso('photosynthesis')}, ${iso('cell')}).`);
  });
});

describe('the WhatsApp body cap', () => {
  test('with the longest terms the filter lets through, the ask stays inside 1024 code points', async () => {
    const long = 'abcdefghij klmnopqrstu v';   // at the length limit
    for (const preferred of ['en', 'ur']) {
      jest.clearAllMocks();
      const body = await askAfterYes('science', { digest: digest('science', [long, `${long.slice(0, -1)}w`]) }, preferred);
      expect(body).toContain(long);
      expect([...body].length).toBeLessThanOrEqual(1024);
    }
  });
});
