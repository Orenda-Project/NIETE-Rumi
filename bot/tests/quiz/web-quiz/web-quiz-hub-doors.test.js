'use strict';
/**
 * The v3 home's door screens (web-quiz-hub-doors.js, web_quiz_home_v3): GET /doors/h/<token>?d=stories|games.
 * Stories: the storybooks' door — no Jugnu passage is listed, read or voiced (the shelf flag only). Games: the number
 * games by the Trail's own rule. Switch off: 404. The pure day seed and shuffle stay exported and tested.
 * Supabase is faked; the hub (who the child is), the item bank and the challenge's clip/grade helpers are stood in for.
 * Invented children and passages only.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
const mockWho = jest.fn();
const mockHubFlags = jest.fn();
jest.mock('../../../shared/services/quiz/web-quiz-hub', () => ({ kidFromHub: (...a) => mockWho(...a), flags: (...a) => mockHubFlags(...a) }));
const mockPassages = new Map();
jest.mock('../../../shared/services/child-test/item-bank', () => ({ getPassage: (id) => mockPassages.get(id) || null }));
const mockCh = {
  storyClip: jest.fn(), sayClip: jest.fn(), formForChild: jest.fn(), gradeOf: jest.fn(), recordOn: jest.fn(), missingOn: jest.fn(), poolOn: jest.fn(),
  nameOf: jest.fn((id, lang) => (lang === 'ur' ? { bigger: 'بڑا کون سا ہے؟', missing: 'غائب عدد' } : { bigger: 'Which is bigger?', missing: 'Missing number' })[id]),
};
jest.mock('../../../shared/services/quiz/web-quiz-challenge', () => mockCh);
const mockReadOpen = jest.fn();
jest.mock('../../../shared/services/quiz/web-quiz-challenge-budget', () => ({ readOpen: (...a) => mockReadOpen(...a) }));
// The real clip recorder's boundaries, for the daily-cap rows below (the store and the paid voice).
const mockHead = jest.fn(async () => ({ exists: false }));
jest.mock('../../../shared/storage/r2', () => ({
  headObject: (...a) => mockHead(...a), uploadBuffer: jest.fn(async () => 'ok'), presignKey: jest.fn(async (key) => `https://signed.test/${key}`),
  listKeys: jest.fn(async () => []), deleteKey: jest.fn(async () => true), deleteAudio: jest.fn(async () => true),
  getPresignedUploadUrl: jest.fn(), getPresignedUrl: jest.fn(), buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`), downloadFromR2: jest.fn(),
}));
const mockSynth = jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 1 }));
jest.mock('../../../shared/services/tts', () => ({ synthesize: (...a) => mockSynth(...a) }));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../../shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../../shared/services/gpt5-mini.service', () => ({ analyzePedagogy: jest.fn(), extractReflectiveCorpus: jest.fn() }));
jest.mock('@anthropic-ai/sdk', () => {
  class Anthropic { constructor() { this.messages = { create: jest.fn() }; } }
  Anthropic.default = Anthropic;
  Anthropic.APIError = class APIError extends Error {};
  return Anthropic;
}, { virtual: true });
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Doors = require('../../../shared/services/quiz/web-quiz-hub-doors');
const Home = require('../../../shared/services/quiz/web-quiz-hub-home');
const Play = require('../../../shared/services/quiz/web-quiz-hub-play');

const KID = '44444444-4444-4444-8444-000000000091';
const KID2 = '44444444-4444-4444-8444-000000000092';
const ON = (k) => ({ key: k, value: true });
const STORY_ON = ['web_quiz_hub', 'web_quiz_challenge', 'web_quiz_challenge_v2', 'web_quiz_challenge_story'].map(ON);
const NOW = Date.parse('2026-10-16T12:00:00Z'); // 17:00 PKT
const ago = (d) => new Date(NOW - d * 86400000).toISOString();
// The clock is pinned at NOW for every test (release dates, the PKT day of the shuffle, the daily clip count); the
// timers the code waits on stay real.
beforeAll(() => jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance'] }));
afterAll(() => jest.useRealTimers());

function passage(id, kind, band, releasedDaysAgo, title = `Story ${id}`) {
  mockPassages.set(id, { text: `${title} text.`, title_en: title, title_ur: null, kind, pool: 'practice' });
  return { passage_id: id, twin_of: null, lang: 'en', band, kind, pool: 'practice', status: 'reviewed', released_at: ago(releasedDaysAgo), title_en: title, title_ur: null };
}

let db;
function seed(settings, { passages = [], runs = [] } = {}) {
  db = { app_settings: settings, challenge_passages: passages, web_quiz_challenge_runs: runs, child_rungs: [] };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Home._resetCache();
  Play._resetCache();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPassages.clear();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-doors-test-secret';
  mockWho.mockResolvedValue({ studentId: KID, grade: 3, rootId: null });
  mockHubFlags.mockResolvedValue({ hub: true, challenge: true });
  mockCh.storyClip.mockResolvedValue('https://r2.example.test/clip.ogg?sig');
  mockCh.sayClip.mockResolvedValue(null);
  mockCh.formForChild.mockResolvedValue('3');
  mockCh.gradeOf.mockResolvedValue(3);
  mockCh.recordOn.mockResolvedValue(true);
  mockCh.missingOn.mockResolvedValue(true);
  mockCh.poolOn.mockResolvedValue(false);
  mockReadOpen.mockResolvedValue(false);
  delete mockCh.listenOn;
});

const stories = (opts) => Doors.door('tok', { kid: 'chip', d: 'stories', lang: 'en', now: NOW, ...opts });

describe('the switch and who', () => {
  test('web_quiz_home_v3 off or absent: 404 home_off, nothing read about the child', async () => {
    seed(STORY_ON);
    await expect(stories()).rejects.toMatchObject({ status: 404, body: { error: 'home_off' } });
    seed([...STORY_ON, { key: 'web_quiz_home_v3', value: 'false' }]);
    await expect(stories()).rejects.toMatchObject({ status: 404, body: { error: 'home_off' } });
    expect(mockWho).not.toHaveBeenCalled();
  });
  test('a token or phone that is not this child\'s: 401; an unknown door: 400', async () => {
    seed([...STORY_ON, ON('web_quiz_home_v3')]);
    mockWho.mockResolvedValue(null);
    await expect(stories()).rejects.toMatchObject({ status: 401 });
    await expect(Doors.door('tok', { kid: 'chip', d: 'videos' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('the Stories door is the storybooks\' door: no Jugnu passage is listed or asked for', () => {
  test('released reads and listens, Story Time on: no rows, no clip asked, no passage read; the shelf flag passed through', async () => {
    seed([...STORY_ON, ON('web_quiz_home_v3'), ON('web_quiz_stories')], { passages: [passage('en.read.1.k01', 'read', 1, 3, 'The red kite'), passage('en.listen.1.k02', 'listen', 1, 2, 'The rain song')] });
    expect(await stories()).toEqual({ stories: [], shelf: true });
    expect(mockCh.storyClip).not.toHaveBeenCalled();
    expect(mockCh.sayClip).not.toHaveBeenCalled();
    expect(mockSynth).not.toHaveBeenCalled();
    seed([...STORY_ON, ON('web_quiz_home_v3')], { passages: [passage('en.read.1.k01', 'read', 1, 3, 'The red kite')] });
    expect(await stories()).toEqual({ stories: [], shelf: false });
  });
});

describe('Stories: no passage, with or without Story Time', () => {
  test('no released story -> an empty list, the shelf flag passed through', async () => {
    seed([...STORY_ON, ON('web_quiz_home_v3'), ON('web_quiz_stories')]);
    expect(await stories()).toEqual({ stories: [], shelf: true });
  });
  test('Story Time off: no passage rows (the room would not serve them)', async () => {
    seed([ON('web_quiz_hub'), ON('web_quiz_home_v3')], { passages: [passage('en.read.1.k01', 'read', 1, 3)] });
    expect((await stories()).stories).toEqual([]);
  });
});

describe('the shuffle: stable within a Pakistan day, per child', () => {
  const ten = () => Array.from({ length: 10 }, (_, i) => passage(`en.read.1.s${i}`, 'read', 1, 10 + i));
  test('the day seed: 00:10 PKT and 23:50 PKT the same; another Pakistan day or another child not', () => {
    expect(Doors.daySeed(KID, Date.parse('2026-10-15T19:10:00Z'))).toBe(Doors.daySeed(KID, Date.parse('2026-10-16T18:50:00Z')));
    expect(Doors.daySeed(KID, Date.parse('2026-10-16T19:10:00Z'))).not.toBe(Doors.daySeed(KID, Date.parse('2026-10-16T18:50:00Z')));
    expect(Doors.daySeed(KID2, NOW)).not.toBe(Doors.daySeed(KID, NOW));
  });
  test('seededOrder is a permutation and deterministic', () => {
    const xs = Array.from({ length: 12 }, (_, i) => i);
    const a = Doors.seededOrder(xs, 'a1b2c3d4');
    expect(a.slice().sort((p, q) => p - q)).toEqual(xs);
    expect(Doors.seededOrder(xs, 'a1b2c3d4')).toEqual(a);
    expect(Doors.seededOrder(xs, '0f0f0f0f')).not.toEqual(a);
    expect(xs).toEqual(Array.from({ length: 12 }, (_, i) => i));
  });
});

describe('Games: the number games by the Trail\'s own rule', () => {
  const games = (lang = 'en') => Doors.door('tok', { kid: 'chip', d: 'games', lang });
  beforeEach(() => seed([ON('web_quiz_hub'), ON('web_quiz_home_v3')]));
  test('grade 3: missing number and which is bigger, by id, with the bank\'s names', async () => {
    expect((await games()).games).toEqual([{ kind: 'numbers', stop: 'missing', name: 'Missing number' }, { kind: 'numbers', stop: 'bigger', name: 'Which is bigger?' }]);
  });
  test('under the pool the missing-number stop is the Number warm-up (the page names it)', async () => {
    mockCh.poolOn.mockResolvedValue(true);
    expect((await games()).games[0]).toEqual({ kind: 'numbers', stop: 'missing', warm: true });
  });
  test('without the missing-number switch: which is bigger only', async () => {
    mockCh.missingOn.mockResolvedValue(false);
    expect((await games()).games.map((g) => g.stop)).toEqual(['bigger']);
  });
  test('Jugnu\'s read-aloud and listen steps are rows here (the Stories door has storybooks only), by the games page\'s own rules', async () => {
    mockReadOpen.mockResolvedValue(true);
    mockCh.listenOn = jest.fn(async () => true);
    mockCh.storyClip.mockResolvedValue('https://r2.example.test/listen.ogg');
    mockCh.nameOf.mockImplementation((id, lang) => ({ en: { bigger: 'Which is bigger?', missing: 'Missing number', read: 'Read aloud', listen: 'Listen and answer' }, ur: { read: 'اونچی آواز میں پڑھیں', listen: 'سنیں اور جواب دیں' } })[lang === 'ur' ? 'ur' : 'en'][id]);
    expect((await games()).games.slice(-2)).toEqual([{ kind: 'read', stop: 'read', name: 'Read aloud' }, { kind: 'read', stop: 'listen', name: 'Listen and answer' }]);
    expect((await games('ur')).games.filter((g) => g.kind === 'read').map((g) => g.name)).toEqual(['اونچی آواز میں پڑھیں', 'سنیں اور جواب دیں']);
    // the day's read-aloud cap reached: no read row (the games page would not open it); no listen clip yet: no listen row
    mockReadOpen.mockResolvedValue(false);
    mockCh.storyClip.mockResolvedValue(null);
    expect((await games()).games.filter((g) => g.kind === 'read')).toEqual([]);
  });
  test('the grade-1 form: its one game', async () => {
    mockCh.formForChild.mockResolvedValue('1');
    expect((await games()).games).toEqual([{ kind: 'numbers', stop: 'numbers' }]);
  });
  test('no challenge for this grade, or the challenge off: none', async () => {
    mockCh.formForChild.mockResolvedValue(null);
    expect((await games()).games).toEqual([]);
    mockHubFlags.mockResolvedValue({ hub: true, challenge: false });
    expect((await games()).games).toEqual([]);
  });
});
