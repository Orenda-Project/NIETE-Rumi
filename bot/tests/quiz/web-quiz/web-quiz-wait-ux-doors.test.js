'use strict';
/**
 * The Games door, faster (web_quiz_wait_ux, web-quiz-wait-ux.js): its reads start side by side and the rows' spoken
 * labels are waited for at most SAY_WAIT_MS. Off: today's order and today's 600 ms wait, the same rows.
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

const WaitUx = require('../../../shared/services/quiz/web-quiz-wait-ux');

const KID = '44444444-4444-4444-8444-000000000093';
const ON = (k) => ({ key: k, value: true });
const BASE = ['web_quiz_hub', 'web_quiz_home_v3', 'web_quiz_challenge', 'web_quiz_challenge_v2', 'web_quiz_challenge_story'].map(ON);
const NOW = Date.parse('2026-10-16T12:00:00Z');
const ago = (d) => new Date(NOW - d * 86400000).toISOString();
function passage(id, kind, band, releasedDaysAgo, title) {
  mockPassages.set(id, { text: `${title} text.`, title_en: title, title_ur: null, kind, pool: 'practice' });
  return { passage_id: id, twin_of: null, lang: 'en', band, kind, pool: 'practice', status: 'reviewed', released_at: ago(releasedDaysAgo), title_en: title, title_ur: null };
}
async function seed(settings) {
  const db = { app_settings: settings, challenge_passages: [passage('en.read.1.k02', 'read', 1, 2, 'The red kite'), passage('en.listen.1.k05', 'listen', 1, 3, 'The rain song')], web_quiz_challenge_runs: [], child_rungs: [] };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Home._resetCache();
  Play._resetCache();
  WaitUx._resetCache();
  await WaitUx.refresh();
}
const games = () => Doors.door('tok', { kid: 'chip', d: 'games', lang: 'en', now: NOW });
const NAMES = { bigger: 'Which is bigger?', missing: 'Missing number', read: 'Read aloud' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'wait-ux-doors-test-secret';
  mockWho.mockResolvedValue({ studentId: KID, grade: 3, rootId: null });
  mockHubFlags.mockResolvedValue({ hub: true, challenge: true });
  mockCh.sayClip.mockResolvedValue(null);
  mockCh.formForChild.mockResolvedValue('3');
  mockCh.gradeOf.mockResolvedValue(3);
  mockCh.recordOn.mockResolvedValue(true);
  mockCh.missingOn.mockResolvedValue(true);
  mockCh.poolOn.mockResolvedValue(false);
  mockCh.nameOf.mockImplementation((id) => NAMES[id]);
  mockReadOpen.mockResolvedValue(true);
});

describe('the switch', () => {
  test.each([['the string true', 'true'], ['a quoted true', '"true"'], ['1', 1], ['an object', { enabled: true }]])('%s is off', async (_, value) => {
    await seed([...BASE, { key: 'web_quiz_wait_ux', value }]);
    expect(WaitUx.on()).toBe(false);
  });
  test('no row: off; the JSON boolean true: on', async () => {
    await seed(BASE);
    expect(WaitUx.on()).toBe(false);
    await seed([...BASE, ON('web_quiz_wait_ux')]);
    expect(WaitUx.on()).toBe(true);
  });
  test('carry: off leaves the hub answer untouched; on adds wait_ux', async () => {
    await seed(BASE);
    expect(JSON.stringify(await WaitUx.carry(Promise.resolve({ x: 1 })))).toBe('{"x":1}');
    await seed([...BASE, ON('web_quiz_wait_ux')]);
    expect(await WaitUx.carry({ x: 1 })).toEqual({ x: 1, wait_ux: true });
  });
  test('the hub\'s own read carries it (prime): a row with JSON true is on, from the cache alone', async () => {
    await seed(BASE);
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    Flags._resetCache();
    Flags.prime([...BASE, ON('web_quiz_wait_ux')], NOW);
    expect(WaitUx.on(NOW)).toBe(true);
  });
  test('an old cache: on just past the 30 s mark (no flicker for an answer built across it), off after two TTLs', async () => {
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    Flags._resetCache();
    Flags.prime([...BASE, ON('web_quiz_wait_ux')], NOW);
    expect(WaitUx.on(NOW + 31 * 1000)).toBe(true);
    expect(WaitUx.on(NOW + 60 * 1000)).toBe(false);
    Flags._resetCache();
    expect(WaitUx.on(NOW)).toBe(false);
  });
});

describe('the Games door: same rows, reads side by side, a short label wait', () => {
  test('off and on answer the same rows (golden)', async () => {
    mockCh.sayClip.mockImplementation(async (t) => (t === 'Which is bigger?' ? 'https://r2.test/say.ogg' : null));
    await seed(BASE);
    const off = await games();
    await seed([...BASE, ON('web_quiz_wait_ux')]);
    const on = await games();
    expect(JSON.stringify(on)).toBe(JSON.stringify(off));
    expect(off.games.map((g) => g.kind)).toEqual(['numbers', 'numbers', 'passage', 'read', 'listen']);
    expect(off.games[1].say).toBe('https://r2.test/say.ogg');
  });
  test('off: today\'s order: nothing past the grade is asked before the grade answers', async () => {
    await seed(BASE);
    let release;
    mockCh.gradeOf.mockImplementation(() => new Promise((r) => { release = () => r(3); }));
    const p = games();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockCh.gradeOf).toHaveBeenCalled();
    expect(mockCh.recordOn).not.toHaveBeenCalled();
    expect(mockReadOpen).not.toHaveBeenCalled();
    release();
    await p;
  });
  test('on: the switches, the read cap and the grade are asked together, before the grade answers', async () => {
    await seed([...BASE, ON('web_quiz_wait_ux')]);
    let release;
    mockCh.gradeOf.mockImplementation(() => new Promise((r) => { release = () => r(3); }));
    const p = games();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockCh.gradeOf).toHaveBeenCalled();
    expect(mockCh.recordOn).toHaveBeenCalled();
    expect(mockCh.missingOn).toHaveBeenCalled();
    expect(mockCh.poolOn).toHaveBeenCalled();
    expect(mockReadOpen).toHaveBeenCalled();
    release();
    expect((await p).games).toHaveLength(5);
  });
  test('a label clip that never comes: off waits 600 ms, on answers within the short wait', async () => {
    mockCh.sayClip.mockImplementation(() => new Promise(() => {}));
    await seed(BASE);
    let t = Date.now();
    await games();
    expect(Date.now() - t).toBeGreaterThanOrEqual(590);
    await seed([...BASE, ON('web_quiz_wait_ux')]);
    t = Date.now();
    const g = await games();
    expect(Date.now() - t).toBeLessThan(400);
    expect(WaitUx.SAY_WAIT_MS).toBeLessThanOrEqual(150);
    expect(g.games.every((r) => !r.say)).toBe(true);
  });
  test('on, grade-1 form, or no challenge: the same answers as off', async () => {
    await seed([...BASE, ON('web_quiz_wait_ux')]);
    mockCh.formForChild.mockResolvedValue('1');
    expect((await games()).games).toEqual([{ kind: 'numbers', stop: 'numbers' }]);
    mockCh.formForChild.mockResolvedValue(null);
    expect((await games()).games).toEqual([]);
    mockHubFlags.mockResolvedValue({ hub: true, challenge: false });
    expect((await games()).games).toEqual([]);
  });
});

describe('the Games door on: a read that fails, fails it as it does off (the door\'s own fallback: no rows)', () => {
  const settle = (p) => p.then((v) => ({ ok: JSON.stringify(v) }), (e) => ({ err: e.message }));
  async function both() {
    await seed(BASE);
    const off = await settle(games());
    await seed([...BASE, ON('web_quiz_wait_ux')]);
    const on = await settle(games());
    return { off, on };
  }
  test.each([
    ['the grade', () => mockCh.gradeOf.mockRejectedValue(new Error('grade down'))],
    ['the record switch', () => mockCh.recordOn.mockRejectedValue(new Error('record down'))],
    ['the missing switch', () => mockCh.missingOn.mockRejectedValue(new Error('missing down'))],
    ['the pool switch', () => mockCh.poolOn.mockRejectedValue(new Error('pool down'))],
    ['the passages\' switch', () => jest.spyOn(Play, 'switches').mockRejectedValue(new Error('story down'))],
    ['the child\'s rung', () => jest.spyOn(Play, 'readingRungOf').mockRejectedValue(new Error('rung down'))],
  ])('%s fails: the door falls back to no rows, on and off alike', async (_, fail) => {
    fail();
    const { off, on } = await both();
    expect(JSON.parse(off.ok)).toEqual({ games: [] });
    expect(on).toEqual(off);
  });
  test.each([
    ['the missing switch, with record off', () => { mockCh.recordOn.mockResolvedValue(false); mockCh.missingOn.mockRejectedValue(new Error('missing down')); }],
    ['the pool switch, with no missing stop', () => { mockCh.missingOn.mockResolvedValue(false); mockCh.poolOn.mockRejectedValue(new Error('pool down')); }],
    ['the read cap', () => mockReadOpen.mockRejectedValue(new Error('cap down'))],
    ['the child\'s rung, with the passages off', () => { jest.spyOn(Play, 'switches').mockResolvedValue({ story: false }); jest.spyOn(Play, 'readingRungOf').mockRejectedValue(new Error('rung down')); }],
  ])('%s fails where off never asks or forgives it: the same rows on and off', async (_, fail) => {
    fail();
    const { off, on } = await both();
    expect(off.ok).toBeTruthy();
    expect(on).toEqual(off);
  });
  test('the challenge off: on asks nothing past the hub\'s switches, as off', async () => {
    mockHubFlags.mockResolvedValue({ hub: true, challenge: false });
    const rung = jest.spyOn(Play, 'readingRungOf');
    await seed([...BASE, ON('web_quiz_wait_ux')]);
    expect((await games()).games).toEqual([]);
    expect(mockCh.gradeOf).not.toHaveBeenCalled();
    expect(mockReadOpen).not.toHaveBeenCalled();
    expect(rung).not.toHaveBeenCalled();
  });
  afterEach(() => jest.restoreAllMocks());
});

// web_quiz_list_states with the faster door on (its live path: gamesDoor hands over to the side-by-side reads at once).
// A grade or form read that fails is a failed door (err: 1, the page's retry), never a child with no games.
describe('web_quiz_list_states, wait_ux on: a failed grade or form read says so', () => {
  const LS = [...BASE, ON('web_quiz_wait_ux'), ON('web_quiz_list_states')];
  const logged = () => require('../../../shared/utils/logger').logToFile.mock.calls.filter((c) => /doors: unavailable/.test(c[0]) && c[1] && c[1].door === 'games');
  // the side-by-side path ran: it asks the switches beside the grade, which the one-after-another path never does on a failed grade
  const together = () => { expect(WaitUx.on()).toBe(true); expect(mockCh.recordOn).toHaveBeenCalled(); };
  test('on: a grade read that rejects answers {games: [], err: 1}, not a child with no games', async () => {
    await seed(LS);
    mockCh.gradeOf.mockRejectedValueOnce(new Error('db down'));
    expect(await games()).toEqual({ games: [], err: 1 });
    together();
    expect(logged()).toHaveLength(1);
  });
  test('on: a form read that rejects answers {games: [], err: 1}', async () => {
    await seed(LS);
    mockCh.formForChild.mockRejectedValueOnce(new Error('db down'));
    expect(await games()).toEqual({ games: [], err: 1 });
    together();
  });
  test('on: a form read that throws answers {games: [], err: 1}', async () => {
    await seed(LS);
    mockCh.formForChild.mockImplementationOnce(() => { throw new Error('db down'); });
    expect(await games()).toEqual({ games: [], err: 1 });
    together();
  });
  test('GOLDEN off (absent, or the string \'true\'): a grade or form read that fails answers today\'s {games: []}, byte for byte', async () => {
    for (const ls of [[], [{ key: 'web_quiz_list_states', value: 'true' }]]) {
      await seed([...BASE, ON('web_quiz_wait_ux'), ...ls]);
      mockCh.gradeOf.mockRejectedValueOnce(new Error('db down'));
      expect(JSON.stringify(await games())).toBe('{"games":[]}');
      together();
      mockCh.formForChild.mockRejectedValueOnce(new Error('db down'));
      expect(JSON.stringify(await games())).toBe('{"games":[]}');
    }
    expect(logged()).toHaveLength(0);
  });
  test('on: no form for the grade (a real answer) stays a true empty with no err', async () => {
    await seed(LS);
    mockCh.formForChild.mockResolvedValueOnce(null);
    expect(JSON.stringify(await games())).toBe('{"games":[]}');
    together();
  });
  test('on: rows that came back whole carry no err', async () => {
    await seed(LS);
    const g = await games();
    expect(g).not.toHaveProperty('err');
    expect(g.games.length).toBeGreaterThan(0);
  });
});
