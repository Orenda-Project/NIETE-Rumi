'use strict';
/**
 * The topic label follows the language the teacher CHOSE, not the digest's.
 *
 * Seen on production: a maths lesson taught in Urdu is offered under its
 * Urdu label (the rule language), the teacher chooses English, the questions
 * come out in English — but the row's `topic`, the student message and every
 * later /quiz listing keep the Urdu label. The single writer of the choice
 * (startGenerating, reached from the language button) must re-derive the
 * label for the chosen language from the digest it already holds.
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
  hasSeenIntroVideo: jest.fn().mockResolvedValue(true),
  markVideoShown: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const { installFrom } = require('./helpers/supabase-chain');
const Offer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');

const QID = '33333333-3333-4333-8333-333333333333';
const PHONE = '923001234567';
const UID = 'u-1';
const USER = { id: UID, preferred_language: 'en' };
const DIGEST = { topic: 'Least Common Multiple (LCM)', topic_as_taught: 'ایل سی ایم', subject: 'maths', slos: [] };

function wire(row) {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [row] }),
    users: { data: [{ id: UID, phone_number: PHONE, preferred_language: 'en' }] },
  });
}
const row = (over = {}) => ({
  id: QID, teacher_id: UID, status: 'offered', language: 'ur', subject: 'maths', topic: 'ایل سی ایم',
  meta: { digest: DIGEST, awaiting_language: true }, coaching_session_id: 'cs-1', ...over,
});
const updates = () => supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update');

beforeEach(() => jest.clearAllMocks());

test('choosing English on an Urdu-labelled lesson rewrites the topic to the English label', async () => {
  wire(row());
  expect(await Offer.handleLanguageButton(`tq_lang_en_${QID}`, PHONE, USER)).toBe(true);
  expect(updates()[0][1]).toEqual(expect.objectContaining({ status: 'generating', language: 'en', topic: 'Least Common Multiple (LCM)' }));
});

test('choosing Urdu on an English-labelled lesson rewrites the topic to the as-taught label', async () => {
  wire(row({ language: 'en', topic: 'Least Common Multiple (LCM)' }));
  expect(await Offer.handleLanguageButton(`tq_lang_ur_${QID}`, PHONE, USER)).toBe(true);
  expect(updates()[0][1]).toEqual(expect.objectContaining({ language: 'ur', topic: 'ایل سی ایم' }));
});

test('a row without a digest keeps whatever topic it had', async () => {
  wire(row({ meta: { awaiting_language: true }, topic: 'Lesson' }));
  await Offer.handleLanguageButton(`tq_lang_en_${QID}`, PHONE, USER);
  expect(updates()[0][1].topic).toBe('Lesson');
});
