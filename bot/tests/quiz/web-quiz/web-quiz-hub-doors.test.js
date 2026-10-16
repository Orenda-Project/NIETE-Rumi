'use strict';
/**
 * The v3 home's door screens (web-quiz-hub-doors.js, web_quiz_home_v3): GET /doors/h/<token>?d=stories|games.
 * Stories: this week's story first, then every story the child can open now, shuffled per child per Pakistan day
 * (stable within the day, `pos` on every row), the ones already met last; only rows that would open (a read with its
 * text, a listen with its clip); 0 / 1 / many. Games: the number games by the Trail's own rule. Switch off: 404.
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

describe('Stories: 0 / 1 / many, only what opens', () => {
  test('0: no released story -> an empty list (the page shows its own line), the shelf flag passed through', async () => {
    seed([...STORY_ON, ON('web_quiz_home_v3'), ON('web_quiz_stories')]);
    expect(await stories()).toEqual({ stories: [], shelf: true });
  });
  test('Story Time off: no passage rows (the room would not serve them)', async () => {
    seed([ON('web_quiz_hub'), ON('web_quiz_home_v3')], { passages: [passage('en.read.1.k01', 'read', 1, 3)] });
    expect((await stories()).stories).toEqual([]);
  });
  test('1: this week\'s story, the one primary row', async () => {
    seed([...STORY_ON, ON('web_quiz_home_v3')], { passages: [passage('en.read.1.k01', 'read', 1, 3, 'The red kite')] });
    const out = await stories();
    expect(out.stories).toEqual([{ kind: 'passage', id: 'en.read.1.k01', title: 'The red kite', pos: 0, week: true, fresh: true }]);
    expect(out.shelf).toBe(false);
  });
  test('many: newest read first; unseen next; met last; listen rows only with a clip; untitled, unreleased, above-band and reserve rows never', async () => {
    const ps = [
      passage('en.read.1.k01', 'read', 1, 20), passage('en.read.1.k02', 'read', 1, 1, 'Newest'), passage('en.read.1.k03', 'read', 1, 10),
      passage('en.read.1.k04', 'read', 1, 12), passage('en.listen.1.k05', 'listen', 1, 4), passage('en.listen.1.k06', 'listen', 1, 5, 'No clip yet'),
      passage('en.read.3.k07', 'read', 3, 2, 'Too hard'), { ...passage('en.read.1.k08', 'read', 1, -2, 'Next week') },
      passage('en.read.1.reserve01', 'read', 1, 30, 'Reserve'),
    ];
    mockPassages.set('en.read.1.k09', { text: 'x', title_en: null, title_ur: null, kind: 'read', pool: 'practice' });
    ps.push({ passage_id: 'en.read.1.k09', lang: 'en', band: 1, kind: 'read', pool: 'practice', status: 'reviewed', released_at: ago(6) });
    mockCh.storyClip.mockImplementation(async (lang, text) => (/No clip yet/.test(text) ? null : 'https://r2.example.test/c.ogg'));
    seed([...STORY_ON, ON('web_quiz_home_v3')], { passages: ps, runs: [{ student_id: KID, passage_id: 'en.read.1.k01' }] });
    const out = (await stories()).stories;
    const ids = out.map((r) => r.id);
    expect(ids[0]).toBe('en.read.1.k02');
    expect(out[0]).toMatchObject({ week: true, pos: 0 });
    expect(ids.slice(1, 4).sort()).toEqual(['en.listen.1.k05', 'en.read.1.k03', 'en.read.1.k04']);
    expect(ids[4]).toBe('en.read.1.k01');
    expect(out[4]).toMatchObject({ done: true });
    expect(out.map((r) => r.pos)).toEqual([0, 1, 2, 3, 4]);
    expect(out.find((r) => r.id === 'en.listen.1.k05').kind).toBe('listen');
    for (const never of ['en.listen.1.k06', 'en.read.3.k07', 'en.read.1.k08', 'en.read.1.reserve01', 'en.read.1.k09']) expect(ids).not.toContain(never);
  });
  test('a row\'s words in the quiz voice when the clip exists (the speaker plays it)', async () => {
    mockCh.sayClip.mockImplementation(async (t) => (t === 'The red kite' ? 'https://r2.example.test/say.ogg' : null));
    seed([...STORY_ON, ON('web_quiz_home_v3')], { passages: [passage('en.read.1.k01', 'read', 1, 3, 'The red kite')] });
    expect((await stories()).stories[0].say).toBe('https://r2.example.test/say.ogg');
  });

  test('the wait for the say clips leaves no timer behind once they answer (a door read never holds the process open)', async () => {
    mockCh.sayClip.mockImplementation(async () => null);
    const set = jest.spyOn(global, 'setTimeout');
    const clear = jest.spyOn(global, 'clearTimeout');
    try {
      await stories();
      const waits = set.mock.calls.map((c, i) => [c[1], set.mock.results[i].value]).filter(([ms]) => ms === 600).map(([, id]) => id);
      expect(waits.length).toBeGreaterThan(0);
      waits.forEach((id) => expect(clear).toHaveBeenCalledWith(id));
    } finally { set.mockRestore(); clear.mockRestore(); }
  });
});

describe('listen rows and the daily cap on recorded clips (the door takes no more than half, as its labels)', () => {
  const RealCh = () => jest.requireActual('../../../shared/services/quiz/web-quiz-challenge');
  const listens = () => [passage('en.listen.1.k21', 'listen', 1, 4, 'Known clip'), passage('en.listen.1.k22', 'listen', 1, 5, 'Unknown clip')];
  beforeEach(() => {
    const Ch = RealCh();
    Ch.__reset();
    // the door asks the real clip helpers (the stand-in delegates), so the recorder and its cap run for real
    mockCh.storyClip.mockImplementation((...a) => Ch.storyClip(...a));
    if (typeof Ch.storyClipCapped === 'function') mockCh.storyClipCapped = (...a) => Ch.storyClipCapped(...a);
    mockHead.mockImplementation(async (key) => ({ exists: key === Ch.clipKey('listen', 'story', 'en', 'Known clip text.') }));
  });
  afterEach(() => { delete mockCh.storyClipCapped; RealCh().__reset(); });

  test('past half the day\'s recordings: an unknown clip starts no recording and is not listed; a known clip still lists', async () => {
    const Ch = RealCh();
    expect(await Ch.warmClip(Ch.clipKey('listen', 'story', 'en', 'Known clip text.'), 'Known clip text.', 'en', { record: false })).toBe('had');
    Ch.__useClips(Ch.MAX_CLIP_RECORDINGS / 2);
    seed([...STORY_ON, ON('web_quiz_home_v3')], { passages: listens() });
    const ids = (await stories()).stories.map((r) => r.id);
    expect(mockSynth).not.toHaveBeenCalled();
    expect(ids).toContain('en.listen.1.k21');
    expect(ids).not.toContain('en.listen.1.k22');
  });

  test('under half: a missing clip is recorded in the background as today (listed on a later open)', async () => {
    seed([...STORY_ON, ON('web_quiz_home_v3')], { passages: listens() });
    const ids = (await stories()).stories.map((r) => r.id);
    expect(ids).not.toContain('en.listen.1.k22');
    expect(mockSynth).toHaveBeenCalledWith(expect.objectContaining({ text: 'Unknown clip text.' }));
  });
});

describe('the shuffle: stable within a Pakistan day, per child', () => {
  const ten = () => Array.from({ length: 10 }, (_, i) => passage(`en.read.1.s${i}`, 'read', 1, 10 + i));
  test('00:10 PKT and 23:50 PKT give the same order; another day or another child may not', async () => {
    seed([...STORY_ON, ON('web_quiz_home_v3')], { passages: ten() });
    const at = (iso) => stories({ now: Date.parse(iso) }).then((o) => o.stories.map((r) => r.id).join());
    const early = await at('2026-10-15T19:10:00Z'); // 00:10 PKT on the 16th
    const late = await at('2026-10-16T18:50:00Z');  // 23:50 PKT on the 16th
    expect(late).toBe(early);
    // the next Pakistan day re-deals the shelf itself, not only the seed (ten rows: an equal order by chance is negligible)
    const next = await at('2026-10-16T19:10:00Z');  // 00:10 PKT on the 17th
    expect(next.split(',')).toHaveLength(10);
    expect(next.split(',').sort()).toEqual(early.split(',').sort());
    expect(next).not.toBe(early);
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
