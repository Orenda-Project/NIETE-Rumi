'use strict';
/**
 * Jugnu's challenge clips in the storybook voice on their own (app_settings `web_quiz_challenge_story_voice`, default
 * off, JSON true only). With it on and `web_quiz_one_voice` off, the listening story, the Story Time read-along, the
 * prompts, options and door lines take the storybook voice (EN Bella at storyteller pace, UR Sara) at the one-voice rate
 * (32 kb/s): the very keys the one-voice plan names, so one checked set serves both switches. The quiz lines keep
 * today's voice. A long clip is never recorded on the fly; a short line only by the pre-flip batch.
 *
 * Off, every key and every recording is today's.
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
const Voice = require('../../../shared/services/quiz/web-quiz-voice');

const REYNA = { voices: { en: { provider: 'soniox', voice: 'Reyna', name: 'Reyna' }, ur: { provider: 'soniox', voice: 'Reyna', name: 'Reyna' } }, kbps: 32, loudness_lufs: -21 };
const KEY = 'web_quiz_challenge_story_voice';

function seed(rows) {
  const fake = makeFake({ app_settings: rows });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  return fake;
}
const events = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

beforeEach(() => {
  OneVoice.reset(); Ch.__reset();
  tts.synthesize.mockClear(); r2.uploadBuffer.mockClear(); logEvent.mockClear();
  r2.headObject.mockImplementation(async () => ({ exists: false }));
});

describe('on, one voice off: the challenge clips are the storybook voice', () => {
  test.each([
    ['en', 'listen', 'story', 'el-bella-cff2e4'],
    ['ur', 'listen', 'story', 'el-sara'],
    ['ur', 'read', 'story', 'el-sara'],
    ['en', 'listen', 'q1', 'el-bella-cff2e4'],
    ['ur', 'listen', 'q2-opt', 'el-sara'],
    ['en', 'door', 'say', 'el-bella-cff2e4'],
  ])('%s %s/%s: the key names %s at 32 kb/s', async (lang, ex, part, tag) => {
    seed([{ key: KEY, value: true }]);
    await OneVoice.on();
    expect(OneVoice.currentPlan()).toBeNull();
    expect(await Ch.storyVoiceOn()).toBe(true);
    expect(Ch.clipKey(ex, part, lang, 'Words.')).toMatch(new RegExp(`/${part}-${tag}-k32-[0-9a-f]{8}\\.ogg$`));
  });

  test('the same keys the one-voice plan names: one checked set serves both switches', async () => {
    seed([{ key: KEY, value: true }]);
    await OneVoice.on(); await Ch.storyVoiceOn();
    const mine = ['en', 'ur'].map((l) => Ch.clipKey('listen', 'story', l, 'Words.'));
    OneVoice.reset(); Ch.__reset();
    seed([{ key: 'web_quiz_one_voice', value: REYNA }]);
    await OneVoice.on();
    expect(['en', 'ur'].map((l) => Ch.clipKey('listen', 'story', l, 'Words.'))).toEqual(mine);
  });

  test('a missing listening story is refused: no voice call on a child\'s open', async () => {
    seed([{ key: KEY, value: true }]);
    await OneVoice.on(); await Ch.storyVoiceOn();
    expect(await Ch.storyClip('en', 'One day it rained. The children stayed inside.')).toBeNull();
    await new Promise((r) => setImmediate(r));
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(events('web_quiz.ch_clip_ungated_refused')).toHaveLength(1);
  });

  test('a story clip in the store is served from the storybook voice\'s key', async () => {
    seed([{ key: KEY, value: true }]);
    await OneVoice.on(); await Ch.storyVoiceOn();
    r2.headObject.mockImplementation(async () => ({ exists: true }));
    expect(await Ch.storyClip('ur', 'ایک دن بارش ہوئی۔')).toMatch(/\/listen\/story-el-sara-k32-[0-9a-f]{8}\.ogg$/);
  });

  test('the batch records a short Urdu line in Sara, its words respelled; on the fly it is refused', async () => {
    seed([{ key: KEY, value: true }]);
    await OneVoice.on(); await Ch.storyVoiceOn();
    const key = Ch.clipKey('listen', 'q1', 'ur', 'بچے کہاں رہے؟');
    expect(await Ch.recordClip(key, 'بچے کہاں رہے؟', 'ur')).toBeNull();
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(await Ch.recordClip(key, 'بچے کہاں رہے؟', 'ur', undefined, { batch: true })).not.toBeNull();
    expect(tts.synthesize.mock.calls[0][0]).toMatchObject({ provider: 'elevenlabs', voice: '9cI5mhBtM4WtQ9Fo6jWQ', model: 'eleven_v4', outputFormat: 'opus_48000_32' });
  });
});

describe('off: today\'s challenge voice, unchanged', () => {
  test.each([[undefined], [false], ['true'], [{}]])('value %p: today\'s quiz voice in the key, recorded on the fly as today', async (value) => {
    seed(value === undefined ? [] : [{ key: KEY, value }]);
    await OneVoice.on();
    expect(await Ch.storyVoiceOn()).toBe(false);
    const key = Ch.clipKey('listen', 'story', 'en', 'Words.');
    expect(key).toMatch(new RegExp(`/story-${Voice.voiceTag('en')}-[0-9a-f]{8}\\.ogg$`));
    expect(await Ch.recordClip(key, 'Words.', 'en')).not.toBeNull();
    expect(tts.synthesize.mock.calls[0][0]).toMatchObject(Voice.quizVoice('en'));
    expect(events('web_quiz.ch_clip_ungated_refused')).toHaveLength(0);
  });

  test('one voice on: its plan decides, whatever this switch says', async () => {
    seed([{ key: 'web_quiz_one_voice', value: { ...REYNA, kbps: 64 } }, { key: KEY, value: true }]);
    await OneVoice.on(); await Ch.storyVoiceOn();
    expect(Ch.clipKey('listen', 'story', 'en', 'Words.')).toMatch(/\/story-el-bella-cff2e4-[0-9a-f]{8}\.ogg$/);
  });
});
