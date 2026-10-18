'use strict';
/**
 * One voice per quiz (app_settings `web_quiz_one_voice`, default off): Jugnu's long clips are never recorded on the fly.
 *
 * A listening story and a Story Time read-along are read slowly, with pauses and emphasis, and each take is checked
 * (words heard, alignment, pace) before it is stored. With the switch on, a missing long clip is never made by the
 * recorder a child's open, the warm job or a door label calls: that take would be unchecked, and in a voice whose
 * delivery differs from the checked takes. The recorder refuses it (no voice call) and says so
 * (`web_quiz.ch_clip_ungated_refused`). A short line (a prompt, an option, a door label) is not recorded on a child's
 * open or by the warm job either (a paid call at an unknown moment): only the pre-flip batch
 * (scripts/quiz/one-voice-missing-keys.js --record-short, `{ batch: true }`) records it, its Urdu words respelled for
 * the voice by the shared list (web-quiz-ur-say.js), the screen text unchanged.
 *
 * The warm job, with the switch on, also says how much of the one voice is there:
 * `web_quiz.one_voice_coverage {plan, total, present, missing_long, missing_short, math_unlit}` once per run.
 *
 * Off, everything is today's: a missing long clip is recorded, and no coverage event is written.
 *
 * Boundaries faked: supabase (in-memory), R2, the voice gateway, the loggers. The services run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), generateCorrelationId: () => 'test', runWithCorrelation: (_id, fn) => fn(),
}));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));
jest.mock('../../../shared/storage/r2', () => ({
  headObject: jest.fn(async () => ({ exists: false })),
  uploadBuffer: jest.fn(async () => true),
  presignKey: jest.fn(async (key) => `https://signed.test/${key}`),
  getPresignedUrl: jest.fn(async (u) => u),
}));
jest.mock('../../../shared/services/tts', () => ({
  synthesize: jest.fn(async ({ provider, voice }) => ({ audio: Buffer.from('OggS-fake'), provider, voice, durationSec: 2 })),
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../../shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-not-used';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key-not-used';

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const tts = require('../../../shared/services/tts');
const { logEvent } = require('../../../shared/utils/structured-logger');
const OneVoice = require('../../../shared/services/quiz/web-quiz-one-voice-flag');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
const CW = require('../../../shared/services/quiz/web-quiz-challenge-clip-warm');

const STORY_EN = 'One day it rained. The children stayed inside and read a book together.';
const STORY_UR = 'ایک دن بارش ہوئی۔ بچے گھر میں رہے اور مل کر کتاب پڑھی۔';

function seed(flag) {
  const fake = makeFake({ app_settings: flag === undefined ? [] : [{ key: 'web_quiz_one_voice', value: flag }] });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  return fake;
}
const events = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

beforeEach(() => {
  OneVoice.reset(); Ch.__reset(); CW.__reset();
  tts.synthesize.mockClear(); r2.uploadBuffer.mockClear(); logEvent.mockClear();
  r2.headObject.mockImplementation(async () => ({ exists: false }));
});

describe('switch on: a missing long clip is refused, never recorded on the fly', () => {
  test.each([
    ['the listening story', 'listen', 'en', STORY_EN],
    ['the listening story (Urdu)', 'listen', 'ur', STORY_UR],
    ['a Story Time read-along', 'read', 'ur', STORY_UR],
  ])('%s: no voice call, no upload, one refusal event (once per clip)', async (_name, ex, lang, text) => {
    seed(true);
    await OneVoice.on();
    const key = Ch.clipKey(ex, 'story', lang, text);
    expect(await Ch.warmClip(key, text, lang)).toBe('missing');
    expect(await Ch.recordClip(key, text, lang)).toBeNull();
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(r2.uploadBuffer).not.toHaveBeenCalled();
    expect(events('web_quiz.ch_clip_ungated_refused')).toEqual([{ lang, ex, part: 'story', plan: OneVoice.currentPlan().sig }]);
  });

  test('a child\'s open of a story with no clip: no clip url, no voice call (the serve path)', async () => {
    seed(true);
    await OneVoice.on();
    expect(await Ch.storyClip('en', STORY_EN)).toBeNull();
    await new Promise((r) => setImmediate(r));
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(events('web_quiz.ch_clip_ungated_refused')).toHaveLength(1);
  });

  test('a long clip already in the store is served as today', async () => {
    seed(true);
    await OneVoice.on();
    r2.headObject.mockImplementation(async () => ({ exists: true }));
    const url = await Ch.storyClip('en', STORY_EN);
    expect(url).toMatch(/^https:\/\/signed\.test\/.*\/listen\/story-el-/);
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(events('web_quiz.ch_clip_ungated_refused')).toHaveLength(0);
  });

  test('a short line (a prompt, an option, a door label) is not recorded on the fly: refused once per clip', async () => {
    seed(true);
    await OneVoice.on();
    const prompt = Ch.clipKey('listen', 'q1', 'en', 'Where did the children stay?');
    const option = Ch.clipKey('listen', 'q1-opt', 'en', 'Inside');
    const door = Ch.clipKey('door', 'say', 'en', 'Stories');
    for (const [key, text] of [[prompt, 'Where did the children stay?'], [option, 'Inside'], [door, 'Stories']]) {
      expect(await Ch.warmClip(key, text, 'en')).toBe('missing');
      expect(await Ch.recordClip(key, text, 'en')).toBeNull();
    }
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(events('web_quiz.ch_clip_ungated_refused').map((e) => [e.ex, e.part])).toEqual([['listen', 'q1'], ['listen', 'q1-opt'], ['door', 'say']]);
  });

  test('the pre-flip batch records a short line in the storybook voice; never a long one', async () => {
    seed(true);
    await OneVoice.on();
    const prompt = Ch.clipKey('listen', 'q1', 'en', 'Where did the children stay?');
    expect(await Ch.recordClip(prompt, 'Where did the children stay?', 'en', undefined, { batch: true })).not.toBeNull();
    expect(tts.synthesize.mock.calls[0][0]).toMatchObject({ voice: 'hpp4J3VqNfWAUOO0d1Us', model: 'eleven_multilingual_v2' });
    const story = Ch.clipKey('listen', 'story', 'en', STORY_EN);
    expect(await Ch.recordClip(story, STORY_EN, 'en', undefined, { batch: true })).toBeNull();
    expect(tts.synthesize).toHaveBeenCalledTimes(1);
    expect(events('web_quiz.ch_clip_ungated_refused')).toHaveLength(1);
  });

  test('Urdu: the batch sends the respelled words to the voice; the key is the screen text\'s', async () => {
    seed(true);
    await OneVoice.on();
    const text = 'بچے ساتھ گئے اور کھیر کھائی۔';
    const key = Ch.clipKey('listen', 'q2', 'ur', text);
    await Ch.recordClip(key, text, 'ur', undefined, { batch: true });
    expect(tts.synthesize.mock.calls[0][0].text).toBe('بچے साथ گئے اور खीर کھائی۔');
    expect(r2.uploadBuffer.mock.calls[0][1]).toBe(key);
    // a word that only contains a listed word is left as it is
    tts.synthesize.mockClear();
    const other = 'میرا ساتھی آیا';
    await Ch.recordClip(Ch.clipKey('listen', 'q3', 'ur', other), other, 'ur', undefined, { batch: true });
    expect(tts.synthesize.mock.calls[0][0].text).toBe(other);
  });
});

describe('switch off: today\'s recorder, unchanged', () => {
  test('off: an Urdu line goes to the voice as it is written (no respelling)', async () => {
    seed(false);
    await OneVoice.on();
    const text = 'بچے ساتھ گئے';
    expect(await Ch.warmClip(Ch.clipKey('listen', 'q2', 'ur', text), text, 'ur')).toBe('recorded');
    expect(tts.synthesize.mock.calls[0][0].text).toBe(text);
  });

  test.each([[undefined], [false], ['true'], [{}], [{ enabled: true }]])('value %p: a missing long clip is recorded on the fly in today\'s voice', async (flag) => {
    seed(flag);
    await OneVoice.on();
    expect(OneVoice.currentPlan()).toBeNull();
    const key = Ch.clipKey('listen', 'story', 'en', STORY_EN);
    expect(await Ch.warmClip(key, STORY_EN, 'en')).toBe('recorded');
    expect(tts.synthesize).toHaveBeenCalledTimes(1);
    expect(tts.synthesize.mock.calls[0][0]).toMatchObject({ provider: 'soniox' });
    expect(events('web_quiz.ch_clip_ungated_refused')).toHaveLength(0);
  });
});

describe('the warm run says how much of the one voice is there', () => {
  const NOW = Date.parse('2026-10-16T06:00:00Z');
  const WARM_ON = [
    { key: 'web_quiz_challenge', value: true },
    { key: 'web_quiz_challenge_v2', value: true },
    { key: 'web_quiz_challenge_clip_warm', value: true },
  ];
  const passage = (id, lang, kind, text, questions) => ({ passage_id: id, lang, kind, pool: 'check', text, questions });
  const PASSAGES = {
    'en.listen.9.cov': passage('en.listen.9.cov', 'en', 'listen', STORY_EN, [
      { id: 'en.listen.9.cov.q1', prompt: 'Where did the children stay?' },
      { id: 'en.listen.9.cov.q2', prompt: 'What is $2+3$?' },
    ]),
  };
  const rows = Object.values(PASSAGES).map((p) => ({ passage_id: p.passage_id, lang: p.lang, kind: p.kind, pool: 'check', status: 'calibrated', released_at: new Date(NOW - 86400000).toISOString(), withdrawn_at: null }));
  let bankSpy; let tapSpy;
  beforeEach(() => {
    const Bank = require('../../../shared/services/child-test/item-bank');
    bankSpy = jest.spyOn(Bank, 'getPassage').mockImplementation((id) => PASSAGES[id] || null);
    tapSpy = jest.spyOn(Ch, 'tapOptions').mockImplementation(() => ({ options: ['Inside', 'Outside'] }));
  });
  afterEach(() => { bankSpy.mockRestore(); tapSpy.mockRestore(); });

  function seedWarm(flag) {
    const fake = makeFake({ app_settings: [{ key: 'web_quiz_one_voice', value: flag }, ...WARM_ON], challenge_passages: rows.map((r) => ({ ...r })) });
    Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  }

  test('on: one event with the plan, the totals, the long and short clips still missing, and the maths stems', async () => {
    seedWarm(true);
    await OneVoice.on();
    const out = await CW.warmClips({ now: NOW });
    expect(out).not.toBeNull();
    // nothing is recorded by the warm job with the switch on: the story (long) and the two prompts (short) stay missing
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(events('web_quiz.one_voice_coverage')).toEqual([
      { plan: OneVoice.currentPlan().sig, total: 3, present: 0, missing_long: 1, missing_short: 2, math_unlit: 1 },
    ]);
  });

  test('on, every clip already there: present = total, nothing missing', async () => {
    seedWarm(true);
    await OneVoice.on();
    r2.headObject.mockImplementation(async () => ({ exists: true }));
    await CW.warmClips({ now: NOW });
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(events('web_quiz.one_voice_coverage')).toEqual([
      { plan: OneVoice.currentPlan().sig, total: 3, present: 3, missing_long: 0, missing_short: 0, math_unlit: 1 },
    ]);
  });

  test('off: no coverage event; the warm event is today\'s', async () => {
    seedWarm(false);
    await OneVoice.on();
    await CW.warmClips({ now: NOW });
    expect(events('web_quiz.one_voice_coverage')).toHaveLength(0);
    expect(events('web_quiz.ch_clip_warm')).toHaveLength(1);
  });
});

/*
 * The quiz lines may be voiced to match the bank's recordings of people (a plan naming another voice), but Jugnu's
 * challenge (the passages, the listening story, the read-along, the prompts, the door labels) stays in the storybook
 * and passage voice: a clip's key and its recording follow that voice, never the quiz lines' voice.
 */
describe('Jugnu\'s challenge clips are the storybook voice, whatever voice the quiz lines take', () => {
  const Voice = require('../../../shared/services/quiz/web-quiz-voice');
  const SANA = { provider: 'elevenlabs', voice: 'XKV307Y3BonMEUh5pCNM', name: 'Sana', model: 'eleven_v4', settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true } };
  const MATCHED = { voices: { en: { ...Voice.ONE_VOICE.en }, ur: SANA }, bank: ['q', 'opts'] };

  test('the story voice table: EN Bella at storyteller pace (multilingual v2, speed 0.9), UR Sara (v4)', () => {
    expect(Voice.STORY_VOICE.en).toMatchObject({ provider: 'elevenlabs', voice: 'hpp4J3VqNfWAUOO0d1Us', model: 'eleven_multilingual_v2', settings: { speed: 0.9 } });
    expect(Voice.setIdOf(Voice.STORY_VOICE.en)).toBe('el-bella-cff2e4');
    expect(Voice.STORY_VOICE.ur).toMatchObject({ provider: 'elevenlabs', voice: '9cI5mhBtM4WtQ9Fo6jWQ', model: 'eleven_v4' });
    expect(Voice.setIdOf(Voice.STORY_VOICE.ur)).toBe('el-sara');
  });

  test.each([
    ['en', 'listen', 'story', 'el-bella-cff2e4'],
    ['ur', 'listen', 'story', 'el-sara'],
    ['ur', 'read', 'story', 'el-sara'],
    ['en', 'listen', 'q1', 'el-bella-cff2e4'],
    ['ur', 'door', 'say', 'el-sara'],
  ])('%s %s/%s: the key names %s, not the quiz lines\' voice', async (lang, ex, part, tag) => {
    seed(MATCHED);
    await OneVoice.on();
    expect(OneVoice.currentPlan()).not.toBeNull();
    expect(Ch.clipKey(ex, part, lang, 'Words.')).toMatch(new RegExp(`/${part}-${tag}-[0-9a-f]{8}\\.ogg$`));
  });

  test('a short challenge line is recorded in the storybook voice (its model and settings)', async () => {
    seed(MATCHED);
    await OneVoice.on();
    const key = Ch.clipKey('listen', 'q1', 'ur', 'بچے کہاں رہے؟');
    expect(await Ch.recordClip(key, 'بچے کہاں رہے؟', 'ur', undefined, { batch: true })).not.toBeNull();
    expect(tts.synthesize.mock.calls[0][0]).toMatchObject({ provider: 'elevenlabs', voice: '9cI5mhBtM4WtQ9Fo6jWQ', model: 'eleven_v4' });
    tts.synthesize.mockClear();
    const en = Ch.clipKey('door', 'say', 'en', 'Stories');
    await Ch.recordClip(en, 'Stories', 'en', undefined, { batch: true });
    expect(tts.synthesize.mock.calls[0][0]).toMatchObject({ voice: 'hpp4J3VqNfWAUOO0d1Us', model: 'eleven_multilingual_v2', voiceSettings: { speed: 0.9 } });
  });

  test('off: today\'s quiz voice in the key, as before', async () => {
    seed(false);
    await OneVoice.on();
    expect(Ch.clipKey('listen', 'story', 'en', 'Words.')).toContain(`-${Voice.voiceTag('en')}-`);
  });
});

/*
 * The flip goes language by language: a plan that leaves a language out (its voice null) keeps that language's
 * challenge exactly as today (today's voice in the key, a missing long clip recorded on the fly), and a plan whose quiz
 * lines are in another recorded voice, or a per-quiz map, still keeps the challenge in the storybook voice.
 */
describe('a language the plan leaves out keeps today\'s challenge; any quiz voice keeps the storybook voice', () => {
  const Voice = require('../../../shared/services/quiz/web-quiz-voice');
  const MATCHED_SETS = { en: Voice.SET_VOICES['el-shanaya-e228e6'], ur: Voice.SET_VOICES['el-reva-cc0c3b'] };

  test('UR only: an English long clip is keyed and recorded on the fly in today\'s voice, never refused', async () => {
    seed({ voices: { ur: { ...Voice.ONE_VOICE.ur } } });   // English not named: today's voice
    await OneVoice.on();
    expect(OneVoice.currentPlan()).not.toBeNull();
    const key = Ch.clipKey('listen', 'story', 'en', STORY_EN);
    expect(key).toContain(`-${Voice.voiceTag('en')}-`);
    expect(await Ch.warmClip(key, STORY_EN, 'en')).toBe('recorded');
    expect(tts.synthesize.mock.calls[0][0]).toMatchObject({ provider: 'soniox' });
    expect(events('web_quiz.ch_clip_ungated_refused')).toHaveLength(0);
  });

  test('UR only: an English short line is recorded on the fly as today', async () => {
    seed({ voices: { ur: { ...Voice.ONE_VOICE.ur } } });   // English not named: today's voice
    await OneVoice.on();
    expect(await Ch.warmClip(Ch.clipKey('listen', 'q1', 'en', 'Where?'), 'Where?', 'en')).toBe('recorded');
    expect(tts.synthesize.mock.calls[0][0]).toMatchObject({ provider: 'soniox' });
  });

  test('UR only: the Urdu long clip is still refused, in the storybook voice\'s key', async () => {
    seed({ voices: { ur: { ...Voice.ONE_VOICE.ur } } });   // English not named: today's voice
    await OneVoice.on();
    const key = Ch.clipKey('listen', 'story', 'ur', STORY_UR);
    expect(key).toMatch(/\/story-el-sara-[0-9a-f]{8}\.ogg$/);
    expect(await Ch.warmClip(key, STORY_UR, 'ur')).toBe('missing');
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(events('web_quiz.ch_clip_ungated_refused')).toHaveLength(1);
  });

  test.each([
    ['quiz lines in the voices matched to the bank', { voices: MATCHED_SETS }],
    ['a per-quiz map', { voices: MATCHED_SETS, quiz_voices: { 'quiz-a': 'el-anjura-e228e6', 'quiz-b': 'keep' } }],
  ])('%s: the challenge keys stay Bella / Sara', async (_name, flag) => {
    seed(flag);
    await OneVoice.on();
    expect(OneVoice.currentPlan()).not.toBeNull();
    expect(Ch.clipKey('listen', 'story', 'en', 'Words.')).toMatch(/\/story-el-bella-cff2e4-[0-9a-f]{8}\.ogg$/);
    expect(Ch.clipKey('door', 'say', 'ur', 'Words.')).toMatch(/\/say-el-sara-[0-9a-f]{8}\.ogg$/);
  });
});
