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
  storyClip: jest.fn(), storyClipCapped: jest.fn(), sayClip: jest.fn(), formForChild: jest.fn(), gradeOf: jest.fn(), recordOn: jest.fn(), missingOn: jest.fn(), poolOn: jest.fn(),
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
  test('Jugnu\'s passages beside the games (the Stories door shows storybooks only): read along, read aloud, listen — each only when it would open', async () => {
    seed([...STORY_ON, ON('web_quiz_home_v3')], { passages: [passage('en.read.1.k01', 'read', 1, 9, 'Old kite'), passage('en.read.1.k02', 'read', 1, 2, 'The red kite'), passage('en.listen.1.k05', 'listen', 1, 3, 'The rain song')] });
    mockReadOpen.mockResolvedValue(true);
    const NAMES = { en: { bigger: 'Which is bigger?', missing: 'Missing number', read: 'Read aloud' }, ur: { read: 'اونچی آواز میں پڑھیں' } };
    mockCh.nameOf.mockImplementation((id, lang) => (NAMES[lang] || NAMES.en)[id]);
    const g = (await games()).games;
    expect(g.filter((r) => r.kind !== 'numbers')).toEqual([
      { kind: 'passage', id: 'en.read.1.k02', title: 'The red kite' },
      { kind: 'read', stop: 'read', name: 'Read aloud' },
      { kind: 'listen', id: 'en.listen.1.k05', title: 'The rain song' },
    ]);
    // the day's read-aloud cap reached: no read-aloud row; the read along and the listen stay
    mockReadOpen.mockResolvedValue(false);
    expect((await games()).games.filter((r) => r.kind !== 'numbers').map((r) => r.kind)).toEqual(['passage', 'listen']);
    // Story Time off: no passage rows (the room would not serve them)
    seed([ON('web_quiz_hub'), ON('web_quiz_home_v3')], { passages: [passage('en.read.1.k02', 'read', 1, 2, 'The red kite')] });
    expect((await games()).games.filter((r) => r.kind === 'passage')).toEqual([]);
  });
  test('a Games-door open asks for no story clip: the listen row is listed by its listening text alone (the clip is asked when the child opens the listen)', async () => {
    seed([...STORY_ON, ON('web_quiz_home_v3')], { passages: [passage('en.listen.1.k05', 'listen', 1, 3, 'The rain song'), passage('en.listen.1.k06', 'listen', 1, 1, 'No words yet')] });
    mockPassages.set('en.listen.1.k06', { ...mockPassages.get('en.listen.1.k06'), text: '' });
    mockReadOpen.mockResolvedValue(false);
    mockCh.storyClip.mockResolvedValue(null);
    mockCh.storyClipCapped.mockResolvedValue(null);
    const g = (await games()).games;
    // the newest listen has no words in the bank, so the one before it is the row
    expect(g.filter((r) => r.kind !== 'numbers')).toEqual([{ kind: 'listen', id: 'en.listen.1.k05', title: 'The rain song' }]);
    expect(mockCh.storyClip).not.toHaveBeenCalled();
    expect(mockCh.storyClipCapped).not.toHaveBeenCalled();
    expect(mockSynth).not.toHaveBeenCalled();
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

describe('web_quiz_list_states: a Games read that failed says so (the page shows a retry, never "nothing here")', () => {
  const games = () => Doors.door('tok', { kid: 'chip', d: 'games', lang: 'en' });
  test('on: an internal failure answers {games: [], err: 1}', async () => {
    seed([ON('web_quiz_hub'), ON('web_quiz_home_v3'), ON('web_quiz_list_states')]);
    mockCh.formForChild.mockImplementation(() => { throw new Error('db down'); });
    expect(await games()).toEqual({ games: [], err: 1 });
  });
  test('GOLDEN off: the same failure answers today\'s {games: []}', async () => {
    seed([ON('web_quiz_hub'), ON('web_quiz_home_v3'), { key: 'web_quiz_list_states', value: 'true' }]);
    mockCh.formForChild.mockImplementation(() => { throw new Error('db down'); });
    expect(await games()).toEqual({ games: [] });
  });
  // The grade and form reads are async: a rejection (not a throw) is how they fail live.
  test('on: a grade read that rejects answers {games: [], err: 1}, not a child with no games', async () => {
    seed([ON('web_quiz_hub'), ON('web_quiz_home_v3'), ON('web_quiz_list_states')]);
    mockCh.gradeOf.mockRejectedValueOnce(new Error('db down'));
    expect(await games()).toEqual({ games: [], err: 1 });
  });
  test('on: a form read that rejects answers {games: [], err: 1}', async () => {
    seed([ON('web_quiz_hub'), ON('web_quiz_home_v3'), ON('web_quiz_list_states')]);
    mockCh.formForChild.mockRejectedValueOnce(new Error('db down'));
    expect(await games()).toEqual({ games: [], err: 1 });
  });
  test('GOLDEN off: a grade read that rejects answers today\'s {games: []}', async () => {
    seed([ON('web_quiz_hub'), ON('web_quiz_home_v3')]);
    mockCh.gradeOf.mockRejectedValueOnce(new Error('db down'));
    expect(await games()).toEqual({ games: [] });
  });
  test('on: no form for the grade (a real answer) stays a true empty with no err', async () => {
    seed([ON('web_quiz_hub'), ON('web_quiz_home_v3'), ON('web_quiz_list_states')]);
    mockCh.formForChild.mockResolvedValueOnce(null);
    expect(await games()).toEqual({ games: [] });
  });
  test('on: rows that came back whole carry no err', async () => {
    seed([ON('web_quiz_hub'), ON('web_quiz_home_v3'), ON('web_quiz_list_states')]);
    expect(await games()).not.toHaveProperty('err');
  });
});

describe('web_quiz_list_states: a Stories read that failed is not "no stories" (the page keeps its own shelf)', () => {
  const Flags = require('../../../shared/services/quiz/web-quiz-home-flags');
  const real = Flags.flags;
  // The home's read (the first) is the real one; the next reads are the given ones, then real again.
  const flagsThen = (...next) => {
    const spy = jest.spyOn(Flags, 'flags');
    [real, ...next].forEach((f) => spy.mockImplementationOnce(f));
    spy.mockImplementation(real);
  };
  const down = () => Promise.reject(new Error('settings down'));
  const broken = () => undefined; // not a promise: the door itself throws, past its own catch
  const LS_ON = [ON('web_quiz_hub'), ON('web_quiz_home_v3'), ON('web_quiz_stories'), ON('web_quiz_list_states')];
  const LS_OFF = [[ON('web_quiz_hub'), ON('web_quiz_home_v3'), ON('web_quiz_stories')], [ON('web_quiz_hub'), ON('web_quiz_home_v3'), ON('web_quiz_stories'), { key: 'web_quiz_list_states', value: 'true' }]];
  afterEach(() => jest.restoreAllMocks());

  test('on: the shelf switch read fails -> {stories: [], shelf: false, err: 1}', async () => {
    seed(LS_ON);
    flagsThen(down);
    expect(await stories()).toEqual({ stories: [], shelf: false, err: 1 });
  });
  test('on: an internal failure -> {stories: [], shelf: false, err: 1}', async () => {
    seed(LS_ON);
    flagsThen(broken);
    expect(await stories()).toEqual({ stories: [], shelf: false, err: 1 });
    expect(require('../../../shared/utils/logger').logToFile).toHaveBeenCalledWith('⚠️ web quiz doors: unavailable', expect.objectContaining({ door: 'stories' }));
  });
  test('on: a whole read carries no err (shelf on, and shelf off)', async () => {
    seed(LS_ON);
    expect(await stories()).toEqual({ stories: [], shelf: true });
    seed([ON('web_quiz_hub'), ON('web_quiz_home_v3'), ON('web_quiz_list_states')]);
    expect(await stories()).toEqual({ stories: [], shelf: false });
  });
  test('GOLDEN off (absent, or the string \'true\'): both failures and the whole reads answer today\'s bytes', async () => {
    for (const settings of LS_OFF) {
      seed(settings);
      flagsThen(down);
      expect(JSON.stringify(await stories())).toBe('{"stories":[],"shelf":false}');
      jest.restoreAllMocks();
      seed(settings);
      flagsThen(broken);
      expect(JSON.stringify(await stories())).toBe('{"stories":[],"shelf":false}');
      jest.restoreAllMocks();
      seed(settings);
      expect(JSON.stringify(await stories())).toBe('{"stories":[],"shelf":true}');
      seed(settings.filter((r) => r.key !== 'web_quiz_stories'));
      expect(JSON.stringify(await stories())).toBe('{"stories":[],"shelf":false}');
    }
  });
});

// A settings outage, with the real home switches module over a fake client whose app_settings read fails the two ways
// a live client fails: it answers {error}, or the call itself throws. Under web_quiz_list_states the last good read
// (at most 10 min old) is kept and marked `down`, and both doors answer err: 1 (the page's retry), never an empty
// shelf or an empty Games list. A cold process, an old read, or the switch off: today's all-off answer, byte for byte.
describe('a settings outage: the retry, never an empty shelf (web_quiz_list_states)', () => {
  const Flags = require('../../../shared/services/quiz/web-quiz-home-flags');
  const games = () => Doors.door('tok', { kid: 'chip', d: 'games', lang: 'en', now: NOW });
  const LS_ON = [ON('web_quiz_hub'), ON('web_quiz_home_v3'), ON('web_quiz_stories'), ON('web_quiz_list_states')];
  const OFF_SETS = [[ON('web_quiz_hub'), ON('web_quiz_home_v3'), ON('web_quiz_stories')], [ON('web_quiz_hub'), ON('web_quiz_home_v3'), ON('web_quiz_stories'), { key: 'web_quiz_list_states', value: 'true' }]];
  const ALL_OFF = '{"home":false,"stories":false,"column":false,"shelf":false,"list":false}';
  const SEC = 1000;
  const MIN = 60 * SEC;
  let healthy = null;
  // the app_settings read fails from now on: 'error' answers {error}, 'throw' throws from the call
  const settingsDown = (mode) => {
    healthy = supabase.from;
    const from = healthy;
    supabase.from = (t) => {
      if (t !== 'app_settings') return from(t);
      if (mode === 'throw') throw new Error('settings down');
      const q = { select: () => q, in: () => Promise.resolve({ data: null, error: { message: 'settings down' } }) };
      return q;
    };
  };
  const settingsBack = () => { supabase.from = healthy; };
  const at = (ms) => jest.setSystemTime(NOW + ms);
  afterEach(() => jest.setSystemTime(NOW));

  test.each(['error', 'throw'])('the read fails (%s) 31 s after a good read with the switch on: the last good switches, marked down', async (mode) => {
    seed(LS_ON);
    await Flags.flags();
    at(31 * SEC);
    settingsDown(mode);
    expect(await Flags.flags()).toMatchObject({ home: true, stories: true, list: true, down: true });
  });
  test.each(['error', 'throw'])('the read fails (%s) more than 10 min after the last good read: today\'s all-off answer, no down', async (mode) => {
    seed(LS_ON);
    await Flags.flags();
    at(10 * MIN + SEC);
    settingsDown(mode);
    expect(JSON.stringify(await Flags.flags())).toBe(ALL_OFF);
  });
  test('down holds 10 min from the last good read, not from the last failure', async () => {
    seed(LS_ON);
    await Flags.flags();
    settingsDown('error');
    at(31 * SEC);
    expect((await Flags.flags()).down).toBe(true);
    at(9 * MIN);
    expect((await Flags.flags()).down).toBe(true);
    at(10 * MIN + SEC);
    expect(JSON.stringify(await Flags.flags())).toBe(ALL_OFF);
  });
  test.each(['error', 'throw'])('a cold process (no good read yet), the read fails (%s): today\'s all-off answer, no down', async (mode) => {
    seed(LS_ON);
    settingsDown(mode);
    expect(JSON.stringify(await Flags.flags())).toBe(ALL_OFF);
  });
  test('GOLDEN off (absent, or the string \'true\'): a failed read after a good one is today\'s all-off answer, byte for byte', async () => {
    for (const settings of OFF_SETS) {
      for (const mode of ['error', 'throw']) {
        seed(settings);
        await Flags.flags();
        at(31 * SEC);
        settingsDown(mode);
        expect(JSON.stringify(await Flags.flags())).toBe(ALL_OFF);
        jest.setSystemTime(NOW);
      }
    }
  });
  test('a failed read is kept for the 30 s cache only: the first read that works after it answers fresh, with no down', async () => {
    seed(LS_ON);
    await Flags.flags();
    at(31 * SEC);
    settingsDown('error');
    await Flags.flags();
    settingsBack();
    expect((await Flags.flags()).down).toBe(true); // inside the failed read's 30 s
    at(62 * SEC);
    const f = await Flags.flags();
    expect(f).toMatchObject({ home: true, stories: true, list: true });
    expect(f).not.toHaveProperty('down');
  });

  // An outage costs one settings read (and one log line) per 30 s, not one per request.
  const countReads = () => {
    const from = supabase.from;
    const n = { reads: 0 };
    supabase.from = (t) => { if (t === 'app_settings') n.reads += 1; return from(t); };
    return n;
  };
  const failLogs = () => require('../../../shared/utils/logger').logToFile.mock.calls.filter((c) => /web quiz home: settings lookup failed/.test(c[0])).length;
  const twenty = async () => { const out = []; for (let i = 0; i < 20; i += 1) out.push(JSON.stringify(await Flags.flags())); return out; };
  test.each(['error', 'throw'])('switch on, the read fails (%s): 20 calls -> 1 read and 1 log line; 1 more of each after 30 s', async (mode) => {
    seed(LS_ON);
    await Flags.flags();
    at(31 * SEC);
    settingsDown(mode);
    const n = countReads();
    const logs0 = failLogs();
    const out = await twenty();
    expect(n.reads).toBe(1);
    expect(failLogs() - logs0).toBe(1);
    expect(new Set(out).size).toBe(1);
    expect(JSON.parse(out[0])).toMatchObject({ home: true, list: true, down: true });
    at(62 * SEC);
    await twenty();
    expect(n.reads).toBe(2);
    expect(failLogs() - logs0).toBe(2);
  });
  test.each(['error', 'throw'])('cold, or the switch off, the read fails (%s): 20 calls -> 1 read, 1 log line, today\'s all-off bytes each time; 1 more after 30 s', async (mode) => {
    for (const settings of [LS_ON, ...OFF_SETS]) {
      jest.setSystemTime(NOW);
      seed(settings);
      if (settings !== LS_ON) await Flags.flags(); // the switch off in the last good read; LS_ON here is the cold process
      at(31 * SEC);
      settingsDown(mode);
      const n = countReads();
      const logs0 = failLogs();
      const out = await twenty();
      expect(n.reads).toBe(1);
      expect(failLogs() - logs0).toBe(1);
      out.forEach((o) => expect(o).toBe(ALL_OFF));
      at(62 * SEC);
      expect(JSON.stringify(await Flags.flags())).toBe(ALL_OFF);
      expect(n.reads).toBe(2);
    }
  });
  test('the settings come back inside the failed read\'s 30 s: the next read after it is the fresh one', async () => {
    seed(LS_ON);
    settingsDown('error');
    expect(JSON.stringify(await Flags.flags())).toBe(ALL_OFF);
    settingsBack();
    at(31 * SEC);
    expect(await Flags.flags()).toMatchObject({ home: true, stories: true, list: true });
  });

  // the doors, an outage longer than the 30 s cache
  test.each(['error', 'throw'])('Stories, the settings read fails (%s) past the cache: {stories: [], shelf: false, err: 1}', async (mode) => {
    seed(LS_ON);
    expect(await stories()).toEqual({ stories: [], shelf: true });
    at(31 * SEC);
    settingsDown(mode);
    expect(await stories()).toEqual({ stories: [], shelf: false, err: 1 });
  });
  test.each(['error', 'throw'])('Games, the settings read fails (%s) past the cache: {games: [], err: 1}, no grade read made', async (mode) => {
    seed(LS_ON);
    expect((await games()).games.length).toBeGreaterThan(0);
    at(31 * SEC);
    settingsDown(mode);
    mockCh.gradeOf.mockClear();
    expect(await games()).toEqual({ games: [], err: 1 });
    expect(mockCh.gradeOf).not.toHaveBeenCalled();
  });
  // the cache runs out while the door is open: the home's first read was good, the read behind it fails
  test.each(['error', 'throw'])('Stories, the shelf switch read fails (%s) after the door\'s first read: err: 1, not "no stories"', async (mode) => {
    seed(LS_ON);
    await Flags.flags();
    at(29 * SEC);
    mockWho.mockImplementationOnce(async () => { at(31 * SEC); settingsDown(mode); return { studentId: KID, grade: 3, rootId: null }; });
    expect(await stories()).toEqual({ stories: [], shelf: false, err: 1 });
  });
  test.each(['error', 'throw'])('Games, the grade read and the settings read behind it fail (%s): err: 1, not a child with no games', async (mode) => {
    seed(LS_ON);
    await Flags.flags();
    at(29 * SEC);
    mockCh.gradeOf.mockImplementationOnce(async () => { at(31 * SEC); settingsDown(mode); throw new Error('db down'); });
    expect(await games()).toEqual({ games: [], err: 1 });
  });
  test('more than 10 min into the outage: today\'s fail-closed answer (404 home_off)', async () => {
    seed(LS_ON);
    await Flags.flags();
    at(10 * MIN + SEC);
    settingsDown('error');
    await expect(stories()).rejects.toMatchObject({ status: 404, body: { error: 'home_off' } });
    await expect(games()).rejects.toMatchObject({ status: 404, body: { error: 'home_off' } });
  });
  test('GOLDEN off (absent, or the string \'true\'): every outage row answers today\'s bytes', async () => {
    for (const settings of OFF_SETS) {
      for (const mode of ['error', 'throw']) {
        seed(settings);
        await Flags.flags();
        at(31 * SEC);
        settingsDown(mode);
        await expect(stories()).rejects.toMatchObject({ status: 404, body: { error: 'home_off' } });
        await expect(games()).rejects.toMatchObject({ status: 404, body: { error: 'home_off' } });
        jest.setSystemTime(NOW);
        seed(settings);
        await Flags.flags();
        at(29 * SEC);
        mockWho.mockImplementationOnce(async () => { at(31 * SEC); settingsDown(mode); return { studentId: KID, grade: 3, rootId: null }; });
        expect(JSON.stringify(await stories())).toBe('{"stories":[],"shelf":false}');
        jest.setSystemTime(NOW);
        seed(settings);
        await Flags.flags();
        at(29 * SEC);
        mockCh.gradeOf.mockImplementationOnce(async () => { at(31 * SEC); settingsDown(mode); throw new Error('db down'); });
        expect(JSON.stringify(await games())).toBe('{"games":[]}');
        jest.setSystemTime(NOW);
      }
    }
  });
});
