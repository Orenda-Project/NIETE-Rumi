'use strict';
/**
 * Web quiz sound items: the page gets the item's OWN recorded clips.
 *
 * A "whose sound is this?" item carries the sound in media.stimulus_audio. If
 * E2 drops it the child sees the letters and never hears the sound, so the item
 * cannot be answered. Supabase is the boundary and is faked; the R2 module runs
 * for real (a non-R2 URL is passed through unsigned, no network).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const WQ = require('../../../shared/services/quiz/web-quiz.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const qid = (n) => `9999999${n}-9999-4999-8999-999999999999`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();

function row(n, text, media, extra = {}) {
  return {
    id: qid(n), quiz_id: QUIZ, external_id: `vb:${n}`, sort_order: n, question_text: text,
    option_a: 'نُ', option_b: 'پَ', option_c: null, option_d: null, correct_option: 'A',
    explanation: null, option_feedback: null, media, render_pattern: 'P6a', ...extra,
  };
}

function seed(questions, meta = {}) {
  const fake = makeFake({
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Example',
      topic: 'Sounds', language: 'ur', active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null,
      uses_count: 0, created_at: new Date().toISOString() }],
    quizzes: [{ id: QUIZ, topic: 'Sounds', grade: '1', subject: 'Urdu', language: 'ur', meta, quiz_source: 'video_bank' }],
    quiz_questions: questions,
    quiz_sessions: [], students: [], quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

const SAVED = { ...process.env };
beforeEach(() => { process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' }; delete process.env.WEB_QUIZ_TOKEN_SECRET; WQ._resetQuizCache(); });
afterAll(() => { process.env = SAVED; });

const CLIPS = {
  language: 'ur',
  question_audio: ['https://r2/q1.ogg'],
  stimulus_audio: 'https://r2/stim1.ogg',
  explanation_audio: 'https://r2/why1.ogg',
};

describe('E2 carries the sound item\'s own clips', () => {
  test('"whose sound is this?": the sound to identify, the spoken question and the why', async () => {
    seed([row(1, 'یہ کس کی آواز ہے؟', CLIPS)]);
    const q = (await WQ.getQuiz('AB12CD')).quiz.questions[0];
    expect(q.audio).toEqual(expect.objectContaining({ q: 'https://r2/q1.ogg', stim: 'https://r2/stim1.ogg', why: 'https://r2/why1.ogg' }));
  });

  test('a stem that already asks the question: its clip speaks the answer, so it is never sent before the answer', async () => {
    seed([row(1, 'When the switch is open, does the bulb light?', { ...CLIPS, language: 'en' })]);
    const q = (await WQ.getQuiz('AB12CD')).quiz.questions[0];
    expect(q.audio && q.audio.stim).toBeFalsy();
    expect(q.audio).toEqual(expect.objectContaining({ q: 'https://r2/q1.ogg' }));
  });

  test('the recorded question clip wins over a generated one (the bank\'s own voice first); the sound still comes through', async () => {
    seed([row(1, 'یہ کس کی آواز ہے؟', CLIPS)], {});
    const helpers = require('../../../shared/services/quiz/web-quiz-media');
    const spy = jest.spyOn(helpers, 'presignAudio').mockResolvedValue({ [qid(1)]: { q: 'https://r2/gen-q.mp3', opts: [], why: null } });
    const q = (await WQ.getQuiz('AB12CD')).quiz.questions[0];
    spy.mockRestore();
    expect(q.audio).toEqual(expect.objectContaining({ q: 'https://r2/q1.ogg', stim: 'https://r2/stim1.ogg', why: 'https://r2/why1.ogg' }));
  });

  test.each([
    ['یہ لفظ کیسے لکھتے ہیں؟', true],
    ['Select the word with the following sound:', true],
    ['What is the first letter of this word', true],
    ['Listen and tap.', true],
    // A statement to judge true or false that merely mentions sounds: its clip says the answer.
    ['زبر، زیر، پیش کے استعمال سے ہم الف، چھوٹی ی، اور واؤ کی آواز نکال سکتے ہیں۔', false],
    ['Count the number of squares in the picture', false],
    // Listen items of the bank, as the bank words them: the clip is the subject.
    ['Tap the word with the following sound:', true],
    ['Select the word that sounds like:', true],
    ['یہ کس حرف کی آواز ہے؟', true],
    ['یہ کون سا لفظ ہے؟', true],
    ['پل؛ اس لفظ میں پ کے اوپر کونسے اعراب کا استعمال کیا گیا ہے؟', true],
    // Ordinary questions that only say "following" or talk ABOUT sound: the clip in that slot speaks the answer (R20).
    ['Which of the following is a common noun?', false],
    ['Complete the following word: s _ n g e r', false],
    ['What is 5 in the following division?', false],
    ['Answer the following question', false],
    ['Musical sounds are:', false],
    ['Sound intensity is', false],
    ['Which of the following will produce high sound?', false],
    ['Jojo has covered his ears because of a sound. What could be the intensity?', false],
    ['کھیلتے ہوئے بچوں کو کس کی آواز آئی؟', false],
    // A rhyme item that already NAMES its word ("which sounds like روٹی?"): the bank's clip there says the answer (موٹی).
    ['روٹی جیسی آواز کس کی ہے؟', false],
    ['لال کی آواز کس جیسی ہے؟', false],
    ['موٹا جیسی آواز کس کی ہے؟', false],
  ])('the sound is sent only when the child needs it to answer: %s', async (stem, sent) => {
    // A stem that sends the child to a picture is only served with its picture (the E2 guard).
    seed([row(1, stem, /picture/.test(stem) ? { ...CLIPS, question_image: 'https://r2/squares.png' } : CLIPS)]);
    const q = (await WQ.getQuiz('AB12CD')).quiz.questions[0];
    expect(Boolean(q.audio && q.audio.stim)).toBe(sent);
  });

  test('a question with no clips has no audio block', async () => {
    seed([row(1, 'Which letter?', { language: 'ur' })]);
    const q = (await WQ.getQuiz('AB12CD')).quiz.questions[0];
    expect(q.audio).toBeUndefined();
  });
});
