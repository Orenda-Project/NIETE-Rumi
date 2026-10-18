'use strict';
/**
 * app_settings `web_quiz_video_shelf`: the lesson lengths the hub's grade warm-up reads are kept in Redis for their life,
 * and a restarted bot (a deploy) reads them back once, so the first Videos open after a deploy shows "6 min" on its
 * lessons without reading every lesson's file again. Only whole reads are kept; a stale one is never read back; the
 * other readers (the library's own lists, the watch screen) keep nothing, as today. Invented lessons only.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
const mockStore = new Map();
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  _up: true,
  isAvailable() { return this._up; },
  set: jest.fn(async function set(k, v, ttl) { if (!this._up) return false; mockStore.set(k, { raw: typeof v === 'string' ? v : JSON.stringify(v), ttl }); return true; }),
  // like the real one: the raw strings Redis holds, null when Redis is away
  scanValues: jest.fn(async function scanValues(match) {
    if (!this._up) return null;
    const rx = new RegExp(`^${match.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return [...mockStore.entries()].filter(([k]) => rx.test(k)).map(([, e]) => e.raw);
  }),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
const mockPresign = jest.fn();
jest.mock('../../../shared/services/quiz/web-quiz-media', () => ({ presignVideo: (...a) => mockPresign(...a), signPoster: jest.fn() }));

const SIX_H = 6 * 60 * 60 * 1000;
const V = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// An MP4 head whose movie header says `secs` seconds (version 0: timescale 1000).
function head(secs) {
  const b = Buffer.alloc(64);
  b.write('mvhd', 8, 'ascii');
  b[12] = 0;
  b.writeUInt32BE(1000, 8 + 16);
  b.writeUInt32BE(secs * 1000, 8 + 20);
  return b;
}
const fetchOk = jest.fn(async () => ({ status: 206, arrayBuffer: async () => head(360) }));

// A restart: a fresh copy of the module (an empty memory), with the same Redis.
function boot() {
  let Videos;
  jest.isolateModules(() => { Videos = require('../../../shared/services/quiz/web-quiz-videos'); });
  return Videos;
}
const redis = require('../../../shared/services/cache/railway-redis.service');

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  redis._up = true;
  mockPresign.mockImplementation(async ({ video_id: id }) => ({ url: `https://files.example.test/${id}.mp4`, bytes: 2400000, poster: null }));
});

describe('kept: the grade warm-up\'s whole reads', () => {
  test('warmMeta with keep: each lesson read is kept for the rest of its life, and a restart reads it back without fetching', async () => {
    const a = boot();
    await a.warmMeta([V(1), V(2)], { fetchImpl: fetchOk, keep: true });
    expect(fetchOk).toHaveBeenCalledTimes(2);
    expect([...mockStore.keys()].sort()).toEqual([`wq:vmeta:${V(1)}`, `wq:vmeta:${V(2)}`]);
    mockStore.forEach((e) => { expect(e.ttl).toBeGreaterThan(0); expect(e.ttl).toBeLessThanOrEqual(SIX_H / 1000); });

    const b = boot();
    expect(b.peekMeta(V(1))).toBeUndefined();
    await b.restoreMeta();
    expect(b.peekMeta(V(1))).toEqual({ bytes: 2400000, poster: null, secs: 360 });
    expect(b.peekMeta(V(2))).toEqual({ bytes: 2400000, poster: null, secs: 360 });
    await b.warmMeta([V(1), V(2)], { fetchImpl: fetchOk, keep: true });
    expect(fetchOk).toHaveBeenCalledTimes(2);
  });

  test('read back once per process: a second ask reads Redis no more', async () => {
    const a = boot();
    await a.warmMeta([V(1)], { fetchImpl: fetchOk, keep: true });
    const b = boot();
    await Promise.all([b.restoreMeta(), b.restoreMeta()]);
    await b.restoreMeta();
    expect(redis.scanValues).toHaveBeenCalledTimes(1);
  });

  test('a read back keeps its first read\'s age: past six hours from then it is not used', async () => {
    const t0 = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await boot().warmMeta([V(1)], { fetchImpl: fetchOk, keep: true });
    clock.mockReturnValue(t0 + SIX_H - 60 * 1000);
    const b = boot();
    await b.restoreMeta();
    expect(b.peekMeta(V(1))).toEqual(expect.objectContaining({ secs: 360 }));
    clock.mockReturnValue(t0 + SIX_H + 1);
    expect(b.peekMeta(V(1))).toBeUndefined();
    const c = boot();
    await c.restoreMeta();
    expect(c.peekMeta(V(1))).toBeUndefined();
    clock.mockRestore();
  });

  test('a lesson whose details did not come back is never kept', async () => {
    mockPresign.mockImplementation(async ({ video_id: id }) => (id === V(1) ? null : { url: `https://files.example.test/${id}.mp4`, bytes: 1, poster: null }));
    const lost = jest.fn(async () => { throw new Error('offline'); });
    const a = boot();
    await a.warmMeta([V(1)], { fetchImpl: fetchOk, keep: true });
    await a.warmMeta([V(2)], { fetchImpl: lost, keep: true });
    expect(a.peekMeta(V(1))).toBeNull();
    expect(a.peekMeta(V(2))).toEqual(expect.objectContaining({ secs: null }));
    expect(mockStore.size).toBe(0);
  });

  test('a lesson already in memory is not replaced by what Redis holds', async () => {
    await boot().warmMeta([V(1)], { fetchImpl: fetchOk, keep: true });
    const b = boot();
    b._metaCache.set(V(1), { at: Date.now(), v: { bytes: 9, poster: null, secs: 42 } });
    await b.restoreMeta();
    expect(b.peekMeta(V(1))).toEqual({ bytes: 9, poster: null, secs: 42 });
  });

  test('Redis away, or holding something that is not a kept lesson: no throw, nothing read back, the warm-up still fetches', async () => {
    mockStore.set(`wq:vmeta:${V(3)}`, { raw: 'not json' });
    mockStore.set(`wq:vmeta:${V(4)}`, { raw: JSON.stringify({ id: V(4), at: 'x', v: { secs: 5 } }) });
    mockStore.set(`wq:vmeta:${V(5)}`, { raw: JSON.stringify({ id: 'nope', at: Date.now(), v: { secs: 5 } }) });
    const b = boot();
    await expect(b.restoreMeta()).resolves.toBeUndefined();
    [3, 4, 5].forEach((n) => expect(b.peekMeta(V(n))).toBeUndefined());
    redis._up = false;
    const c = boot();
    await expect(c.restoreMeta()).resolves.toBeUndefined();
    await c.warmMeta([V(1)], { fetchImpl: fetchOk, keep: true });
    expect(c.peekMeta(V(1))).toEqual(expect.objectContaining({ secs: 360 }));
    redis.scanValues.mockImplementationOnce(async () => { throw new Error('down'); });
    await expect(boot().restoreMeta()).resolves.toBeUndefined();
  });

  test('forgetMeta drops one lesson from memory', async () => {
    const a = boot();
    await a.warmMeta([V(1)], { fetchImpl: fetchOk });
    a.forgetMeta(V(1));
    expect(a.peekMeta(V(1))).toBeUndefined();
  });
});

describe('not kept: every other reader, as today', () => {
  test('warmMeta without keep (the library\'s list) writes nothing to Redis and reads nothing from it', async () => {
    const a = boot();
    await a.warmMeta([V(1), V(2)], { fetchImpl: fetchOk });
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.scanValues).not.toHaveBeenCalled();
    expect(mockStore.size).toBe(0);
  });
});

describe('the library\'s grade warm-up keeps, and reads back first', () => {
  test('warmGrade reads back what Redis holds before it asks, then asks for its grade\'s lessons with keep', async () => {
    const supabase = require('../../../shared/config/supabase');
    const F = require('./videos-v3-fixture');
    const Lib = require('../../../shared/services/quiz/web-quiz-library');
    const Videos = require('../../../shared/services/quiz/web-quiz-videos');
    const Bank = require('../../../shared/services/quiz/web-quiz-bank');
    F.seed(supabase, [{ key: 'web_quiz_library', value: true }]);
    Lib._reset();
    const order = [];
    const restore = jest.spyOn(Videos, 'restoreMeta').mockImplementation(async () => { order.push('restore'); });
    const warm = jest.spyOn(Videos, 'warmMeta').mockImplementation(async (ids, o) => { order.push(['warm', o && o.keep]); });
    Lib.warmGrade('3');
    await Lib._idle();
    expect(order).toEqual(['restore', ['warm', true]]);
    const want = (await Bank.bank()).rows.filter((r) => String(r.grade) === '3').map((r) => r.id);
    expect([...warm.mock.calls[0][0]].sort()).toEqual([...want].sort());
    [restore, warm].forEach((sp) => sp.mockRestore());
  });
});
