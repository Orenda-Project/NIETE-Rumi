'use strict';
/**
 * A word the voice would misread is spelled for the voice only, with one voice per quiz (app_settings
 * `web_quiz_one_voice`, default off). The spellings are one shared Urdu list (web-quiz-ur-say.js), the same list the
 * storybook voice uses: web-quiz-voice.js sayAs() gives an Urdu line through it and every other language as written.
 *
 * «کیلا کا ہم آواز لفظ میلا ہو گا۔» means "the word that sounds like kela is mela (a fair)". Written without
 * vowel marks, میلا is also maila (dirty), and the voice said maila. The list gives the voice मेला for the whole word
 * میلا, in every line; the child still reads میلا on the page, as the quiz wrote it.
 *
 * Off, everything is today's: the words the voice is given, so every clip key and the clip map.
 *
 * Boundaries faked: supabase (in-memory), R2 + the voice gateway, the loggers. The services run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));
jest.mock('../../../shared/storage/r2', () => ({
  headObject: jest.fn(async () => ({ exists: false })),
  uploadBuffer: jest.fn(async () => true),
  getPresignedUrl: jest.fn(async (u) => u),
}));
jest.mock('../../../shared/services/tts', () => ({
  synthesize: jest.fn(async ({ provider, voice }) => ({ audio: Buffer.from('OggS-fake'), provider, voice, durationSec: 2 })),
}));

const { makeFake } = require('./fake-supabase');
const Publish = require('../../../shared/services/quiz/web-quiz-publish.service');
const Voice = require('../../../shared/services/quiz/web-quiz-voice');
const OneVoice = require('../../../shared/services/quiz/web-quiz-one-voice-flag');
const tts = require('../../../shared/services/tts');

const QUIZ = '22222222-2222-4222-8222-222222222222';
const QID = '99999991-9999-4999-8999-999999999999';
const WHY = 'کیلا کا ہم آواز لفظ میلا ہو گا۔';
const SAID = 'کیلا کا ہم آواز لفظ मेला ہو گا۔';

const row = (extra = {}) => ({
  id: QID, quiz_id: QUIZ, external_id: `vb:${QID}`, sort_order: 1, question_text: 'اس چیز کا ہم آواز لفظ کیا ہو سکتا ہے؟',
  option_a: 'میلا', option_b: 'پتیلا', option_c: null, option_d: null, correct_option: 'A',
  explanation: WHY, option_feedback: null, media: {}, render_pattern: 'P6a', ...extra,
});

function seed(rows) {
  return makeFake({
    quizzes: [{ id: QUIZ, topic: 'ہم آواز الفاظ', grade: '3', subject: 'Urdu', language: 'ur', meta: {}, quiz_source: 'video' }],
    quiz_questions: rows, app_settings: [],
  });
}
// The voice calls for the why (the only line with کیلا in it).
const whyCalls = () => tts.synthesize.mock.calls.map(([a]) => a).filter((a) => a.text.includes('کیلا'));

beforeEach(() => { OneVoice.reset(); tts.synthesize.mockClear(); });

describe('one voice: the voice is given the spelling it reads right, the page keeps the words as written', () => {
  test('the why «… میلا ہو گا» is sent to the voice as «… मेला ہو گا»; the question row is unchanged', async () => {
    const fake = seed([row()]);
    const out = await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from }, oneVoice: OneVoice.normalize(true) });
    expect(out.ok).toBe(true);
    const why = whyCalls();
    expect(why.map((a) => a.text)).toEqual([SAID]);
    expect(why[0].provider).toBe(Voice.ONE_VOICE.ur.provider);
    // what the page shows is the question row, never the voice's words
    expect(fake.db.quiz_questions[0].explanation).toBe(WHY);
    expect(fake.db.quiz_questions[0].option_a).toBe('میلا');
    // the clip's key is made from the words the voice was given: a clip recorded from «میلا» is recorded again
    const key = fake.db.quizzes[0].meta.web_one.audio[QID].why;
    expect(key).toMatch(/\/why-el-sara-[0-9a-f]{8}\.ogg$/);
  });

  test('off: the voice is given today\'s words, and every key is today\'s key', async () => {
    const fake = seed([row()]);
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from }, oneVoice: null });
    expect(whyCalls().map((a) => a.text)).toEqual([WHY]);
    const web = fake.db.quizzes[0].meta.web;
    expect(fake.db.quizzes[0].meta.web_one).toBeUndefined();
    expect(web.audio[QID].why).toBe(Publish.audioKey(QUIZ, QID, 'why', WHY, 'ur'));
  });
});

describe('sayAs: the shared Urdu list for an Urdu line, whole words only; any other language as written', () => {
  test('میلا is मेला wherever it stands as a whole word (no condition on the rest of the line)', () => {
    expect(Voice.sayAs(WHY, 'ur')).toBe(SAID);
    expect(Voice.sayAs('کیلا اور میلا ہم آواز ہیں۔', 'ur-PK')).toBe('کیلا اور मेला ہم آواز ہیں۔');
    expect(Voice.sayAs('اس کا کپڑا میلا ہے۔', 'ur')).toBe('اس کا کپڑا मेला ہے۔');
  });

  test('a longer word, another language, nothing: unchanged', () => {
    expect(Voice.sayAs('کیلا اور میلاد', 'ur')).toBe('کیلا اور میلاد');   // a longer word is not the word
    expect(Voice.sayAs('کیلا اور میلا', 'en')).toBe('کیلا اور میلا');
    expect(Voice.sayAs('', 'ur')).toBe('');
    expect(Voice.sayAs(null, 'ur')).toBe('');
  });

  test('one list: an Urdu line is exactly the shared list\'s, and the voice module keeps no table of its own', () => {
    const UrSay = require('../../../shared/services/quiz/web-quiz-ur-say');
    ['بچے ساتھ گئے اور کھیر کھائی۔', WHY, 'میرا ساتھی آیا'].forEach((t) => expect(Voice.sayAs(t, 'ur')).toBe(UrSay.sayOf(t)));
    expect(Voice.SAY_AS).toBeUndefined();
  });
});

describe('sayAs hands the voice to the shared list (a voice can be left out of a respelling)', () => {
  const UrSay = require('../../../shared/services/quiz/web-quiz-ur-say');
  afterEach(() => jest.restoreAllMocks());

  test('sayAs passes the voice it is given; with no voice, the list is asked with none', () => {
    const spy = jest.spyOn(UrSay, 'sayOf');
    Voice.sayAs(WHY, 'ur', { voice: 'voice-a' });
    expect(spy).toHaveBeenLastCalledWith(WHY, { voice: 'voice-a' });
    Voice.sayAs(WHY, 'ur');
    expect(spy).toHaveBeenLastCalledWith(WHY, { voice: undefined });
  });

  test('the publish step names the plan\'s Urdu voice', async () => {
    const spy = jest.spyOn(UrSay, 'sayOf');
    const fake = seed([row()]);
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from }, oneVoice: OneVoice.normalize(true) });
    expect(spy).toHaveBeenCalled();
    spy.mock.calls.forEach(([, opts]) => expect(opts).toEqual({ voice: Voice.ONE_VOICE.ur.voice }));
  });
});
