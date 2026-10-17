'use strict';
/**
 * The kid hub's switches as ONE read (web-quiz-hub-switches.js), web_quiz_fast on.
 *
 * The hub asks about a dozen modules for their app_settings switches, each with its own 30 s cache and its own read.
 * With the fast page on, the hub starts ONE `.in('key', [every hub key])` read first and hands each module the raw rows;
 * each module parses them with its own rules, so a switch reads the same either way. Off: nothing here runs (the goldens
 * in web-quiz-hub-waves.test.js hold the reads, the waves and the bytes).
 *
 * Supabase, Redis and the loggers are the boundaries (hub-waves-fixture.js); every first-party module runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable() { return true; },
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    delete: jest.fn(async (k) => { store.delete(k); return true; }),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const fs = require('fs');
const path = require('path');
const Fx = require('./hub-waves-fixture');

const { S, NOW, DEVICE, CEILING_KEYS, settle, boot, measure, tokenOne, waveList } = Fx;
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'web-quiz-hub-waves.golden.json'), 'utf8'));
// Measured on the code before the seam (c3895d2df), fixture as here.
const BEFORE = { staleSettingsReads: 13, staleWaves: 8, coldSettingsReads: 14, coldWaves: 16 };

const SAVED = { ...process.env };
beforeAll(() => Fx.useClock());
afterAll(() => { jest.useRealTimers(); process.env = SAVED; });
beforeEach(() => { process.env = Fx.hubEnv(SAVED); });
afterEach(() => { try { require('../../../shared/services/quiz/web-quiz-hub-switches').stop(); } catch (_) { /* not loaded */ } });

const Seam = () => require('../../../shared/services/quiz/web-quiz-hub-switches');
const Fast = () => require('../../../shared/services/quiz/web-quiz-fast');
const settingsReads = (m) => m.perTable.app_settings || 0;
const realWait = (ms) => new Promise((r) => setTimeout(r, ms));
// The next thing's offer ids are fresh random ones on every answer (its switch is on in the every-switch case).
const noOffer = (json) => json.replace(/"offer":"[A-Za-z0-9_-]{10}"/g, '"offer":"-"');
/** A process whose fast switch is read (on) and every other switch cold. */
async function coldWithFastWarm(opts) {
  boot(opts);
  Fast().on();
  await settle();
  expect(Fast().on()).toBe(opts.fast);
}

describe('stale hub (31 s, every 30 s cache expired), fast on', () => {
  test('the switches are one read (plus the fast switch\'s own), no more waves, the recorded payload', async () => {
    boot({ fast: true });
    const tok = tokenOne();
    await measure(tok, { device: DEVICE });
    const warm = await measure(tok, { device: DEVICE });
    jest.setSystemTime(NOW + 31 * 1000);
    const stale = await measure(tok, { device: DEVICE });
    console.log(`stale hub: app_settings reads ${BEFORE.staleSettingsReads} -> ${settingsReads(stale)}, waves ${BEFORE.staleWaves} -> ${stale.waves}\n${waveList(S.lastReads)}`);
    expect(settingsReads(stale)).toBeLessThanOrEqual(2);
    expect(stale.waves).toBeLessThanOrEqual(BEFORE.staleWaves);
    expect(stale.out).toBe(GOLDEN.on_warm_payload);
    expect(stale.out).toBe(warm.out);
    expect(stale.open).toBe(warm.open);
    // The one background read refreshed every module: the next request reads no switch.
    const after = await measure(tok, { device: DEVICE });
    expect(settingsReads(after)).toBe(0);
    expect(after.out).toBe(warm.out);
  });
});

describe('cold process (first hub after a start, the fast switch already read), fast on', () => {
  test('every switch on: the switches are ONE read and the hub has fewer waves', async () => {
    await coldWithFastWarm({ fast: true, every: true });
    const tok = tokenOne();
    const cold = await measure(tok, { device: DEVICE });
    const list = waveList(S.lastReads);
    const warm = await measure(tok, { device: DEVICE });
    console.log(`cold hub: app_settings reads ${BEFORE.coldSettingsReads} -> ${settingsReads(cold)}, waves ${BEFORE.coldWaves} -> ${cold.waves}; warm ${warm.waves}\n${list}`);
    expect(settingsReads(cold)).toBe(1);
    expect(S.lastReads.length).toBeGreaterThan(0);
    expect(cold.waves).toBeLessThanOrEqual(BEFORE.coldWaves - 6);
    expect(settingsReads(warm)).toBe(0);
    expect(noOffer(cold.out)).toBe(noOffer(warm.out));
  });

  test('the usual switches: the cold payload is the recorded one', async () => {
    await coldWithFastWarm({ fast: true });
    const cold = await measure(tokenOne(), { device: DEVICE });
    expect(settingsReads(cold)).toBe(1);
    expect(cold.out).toBe(GOLDEN.on_warm_payload);
  });

  test('the seam\'s read fails: every module reads its own switch, the payload is the module-read one', async () => {
    await coldWithFastWarm({ fast: true, every: true });
    const ok = await measure(tokenOne(), { device: DEVICE });
    await coldWithFastWarm({ fast: true, every: true });
    const db = require('../../../shared/config/supabase');
    const from = db.from;
    const keys = Seam().ALL_KEYS();
    db.from = (t) => {
      const b = from(t);
      if (t !== 'app_settings') return b;
      const inn = b.in;
      b.in = (c, vs) => { const r = inn(c, vs); if (c === 'key' && vs.length === keys.length) b.then = (res) => Promise.resolve({ data: null, error: { message: 'down' } }).then(res); return r; };
      return b;
    };
    const failed = await measure(tokenOne(), { device: DEVICE });
    db.from = from;
    expect(settingsReads(failed)).toBeGreaterThan(settingsReads(ok));
    expect(noOffer(failed.out)).toBe(noOffer(ok.out));
    expect(failed.open).toBe(ok.open);
  });

  test('the page events\' sync read (the relay) is filled by the one read alone: the next-offer switches\' own read never runs', async () => {
    await coldWithFastWarm({ fast: true, every: true, json: true });   // rows as the flips write them (JSON true)
    const State = require('../../../shared/services/quiz/web-quiz-next-offer-state');
    State._resetCache();
    const own = Object.values(State.KEYS).sort().join();
    const db = require('../../../shared/config/supabase');
    const from = db.from;
    let ownReads = 0;
    db.from = (t) => {
      const b = from(t);
      if (t !== 'app_settings') return b;
      const inn = b.in;
      b.in = (c, vs) => { if (c === 'key' && [...vs].sort().join() === own) { ownReads += 1; throw new Error('the switches\' own read'); } return inn(c, vs); };
      return b;
    };
    expect(State.hubSwitches.peek()).toBeNull();   // cold: nothing cached yet
    expect(await Seam().ensure()).toBe(true);
    db.from = from;
    expect(ownReads).toBe(0);
    expect(State.eventsV3Now()).toBe(true);
  });
});

describe('a switch reads the same through the seam as through its own read', () => {
  // rows: every hub key the seam reads, as the strings 'true' / 'false', JSON true / false, a JSON string, or missing.
  const VARIANTS = {
    'string true': () => 'true',
    'JSON true': () => true,
    'string false': () => 'false',
    'JSON string "true"': () => '"true"',
    'every other on': (i) => (i % 2 ? 'true' : false),
    missing: () => undefined,
  };
  const noAt = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v, (k, x) => (k === 'at' ? undefined : x))));

  test.each(Object.keys(VARIANTS))('%s', async (name) => {
    const rowsOf = (keys) => keys.map((key, i) => ({ key, value: VARIANTS[name](i) })).filter((r) => r.value !== undefined);
    // Own reads: each module's own read, in the seam's order, from these rows.
    boot({ fast: true, every: true });
    const keys = Seam().ALL_KEYS();
    S.db.app_settings = [...rowsOf(keys), { key: 'web_quiz_fast', value: true }];
    const own = {};
    const ownSays = {};
    for (const e of Seam().entries()) { ownSays[e.name] = noAt(await e.read()); own[e.name] = noAt(e.peek()); }
    // The seam: one read of the same rows, each module primed from it.
    boot({ fast: true, every: true });
    S.db.app_settings = [...rowsOf(keys), { key: 'web_quiz_fast', value: true }];
    Fast().on();
    await settle();
    S.reads = [];
    expect(await Seam().ensure()).toBe(true);
    expect(S.reads.filter((r) => r.t === 'app_settings').length).toBe(1);
    const primed = {};
    for (const e of Seam().entries()) primed[e.name] = noAt(e.peek());
    expect(Object.keys(primed).length).toBe(15);  // every module the hub reads a switch through, but the fast switch itself (challenge: 5 switches; stories: 4 keys; the next thing: 3 keys; the finish card: 1)
    // The same cache, but where the module's own read reads nothing (keep my place's way back with its parent off:
    // it answers false before its cache; primed, its cache holds what its read would hold).
    const skipped = Object.keys(own).filter((n) => own[n] === null);
    expect(skipped.filter((n) => n !== 'bind-way-back')).toEqual([]);
    skipped.forEach((n) => { delete own[n]; delete primed[n]; });
    expect(primed).toEqual(own);
    // ...and a primed module answers what its own read answered, from its cache: no read of its own.
    S.reads = [];
    const primedSays = {};
    for (const e of Seam().entries()) primedSays[e.name] = noAt(await e.read());
    expect(primedSays).toEqual(ownSays);
    expect(S.reads.filter((r) => r.t === 'app_settings').length).toBe(0);
  });

  test('the seam reads every key the hub asks for (fast off: each module\'s own read), never web_quiz_fast', async () => {
    boot({ fast: false, every: true });
    Fx.askedKeys.clear();
    const tok = tokenOne();
    await measure(tok, { device: DEVICE });
    jest.setSystemTime(NOW + 6 * 60 * 1000);          // every cache expired, the brand's 5 min one too
    await measure(tok, { device: DEVICE });
    const keys = Seam().ALL_KEYS();
    expect(keys).not.toContain('web_quiz_fast');
    expect([...Fx.askedKeys].filter((k) => k !== 'web_quiz_fast' && !keys.includes(k)).sort()).toEqual([]);
    expect(keys).toEqual(expect.arrayContaining(['web_quiz_brand', 'web_quiz_db_deadline']));
  });
});

describe('the hub payload with the switches as strings or JSON: fast on is fast off plus `fast`', () => {
  test.each([['string \'true\' rows', false], ['JSON true rows', true]])('%s', async (_, json) => {
    boot({ fast: false, every: true, json });
    await measure(tokenOne(), { device: DEVICE });
    const off = await measure(tokenOne(), { device: DEVICE });
    // fast on, cold (the seam primes every module) and warm
    await coldWithFastWarm({ fast: true, every: true, json });
    const cold = await measure(tokenOne(), { device: DEVICE });
    const warm = await measure(tokenOne(), { device: DEVICE });
    // the next thing's offer ids are fresh random ones on every answer
    const noOffer = (json) => json.replace(/"offer":"[A-Za-z0-9_-]{10}"/g, '"offer":"-"');
    for (const on of [cold, warm]) {
      const p = JSON.parse(on.out);
      expect(p.fast).toBe(true);
      delete p.fast;
      expect(noOffer(JSON.stringify(p))).toBe(noOffer(off.out));
      expect(on.open).toBe(off.open);
    }
  });
});

describe('the 25 s timer (one per process)', () => {
  test('fast off: the timer (started at boot) reads nothing; a hub request with fast off never arms it', async () => {
    boot({ fast: false, every: true });
    await measure(tokenOne(), { device: DEVICE });
    S.reads = [];
    Seam().start({ everyMs: 15 });
    await realWait(150);
    expect(S.reads.filter((r) => r.t === 'app_settings')).toEqual([]);
    expect(Seam().armed()).toBe(false);
    Seam().stop();
  });

  test('never started by a hub request (the bot starts it at boot), armed by a fast one, and never keeps the process alive', async () => {
    await coldWithFastWarm({ fast: true, every: true });
    await measure(tokenOne(), { device: DEVICE });
    expect(Seam().running()).toBe(false);
    expect(Seam().armed()).toBe(true);
    const boot = require('fs').readFileSync(require('path').join(__dirname, '../../../whatsapp-bot.js'), 'utf8');
    expect(boot).toMatch(/require\('\.\/shared\/services\/quiz\/web-quiz-hub-switches'\)\.start\(\)/);
    Seam().start();
    expect(Seam().running()).toBe(true);
    expect(Seam()._handle().hasRef()).toBe(false);
    Seam().start();                                   // once per process
    expect(Seam().running()).toBe(true);
    Seam().stop();
    expect(Seam().running()).toBe(false);
  });

  test('a switch flipped in the database lands at the next tick (before the module\'s own 30 s cache)', async () => {
    const flip = async (timer) => {
      await coldWithFastWarm({ fast: true, every: true });
      const tok = tokenOne();
      await measure(tok, { device: DEVICE });
      expect(JSON.parse((await measure(tok, { device: DEVICE })).out).book_on).toBe(true);
      S.db.app_settings.find((r) => r.key === 'web_quiz_challenge_book').value = 'false';
      jest.setSystemTime(NOW + 26 * 1000);           // every 30 s cache still fresh
      if (timer) Seam().start({ everyMs: 15 });
      await realWait(120);                            // a tick (real time) at +26 s
      Seam().stop();
      const next = await measure(tok, { device: DEVICE });
      return { book: JSON.parse(next.out).book_on, reads: settingsReads(next) };
    };
    expect(await flip(false)).toEqual({ book: true, reads: 0 });  // no timer: the cache answers
    const got = await flip(true);
    expect(got.book).not.toBe(true);                               // the timer's read primed the Book's switch
    expect(got.reads).toBe(0);                                     // and the request read no switch
  });

  test('a quiet spell (no request for 40 s): the timer keeps itself and every switch fresh, the fast one too; a flip lands at the next tick', async () => {
    await coldWithFastWarm({ fast: true, every: true });
    const tok = tokenOne();
    await measure(tok, { device: DEVICE });
    S.db.app_settings.find((r) => r.key === 'web_quiz_challenge_book').value = 'false';
    jest.setSystemTime(NOW + 40 * 1000);            // every 30 s cache, the fast switch's included, is past its time
    Seam().start({ everyMs: 15 });
    await realWait(120);                            // ticks with no request in between
    expect(Seam().running()).toBe(true);            // the fast switch's own row kept the timer going
    expect(require('../../../shared/services/quiz/web-quiz-fast').fresh()).toBe(true);
    Seam().stop();
    const next = await measure(tok, { device: DEVICE });
    expect(JSON.parse(next.out).book_on).not.toBe(true);
    expect(settingsReads(next)).toBe(0);
  });

  test('the fast switch flipped off: the timer\'s next tick reads it, disarms, and reads nothing more', async () => {
    await coldWithFastWarm({ fast: true, every: true });
    await measure(tokenOne(), { device: DEVICE });
    S.db.app_settings.find((r) => r.key === 'web_quiz_fast').value = false;
    Seam().start({ everyMs: 15 });
    await realWait(120);
    expect(Seam().armed()).toBe(false);
    expect(require('../../../shared/services/quiz/web-quiz-fast').fresh()).toBe(false);
    S.reads = [];
    await realWait(80);
    expect(S.reads.filter((r) => r.t === 'app_settings')).toEqual([]);
    Seam().stop();
  });

  test('no value older than twice its cache time is served while it is re-read (a quiet spell waits, as today)', async () => {
    await coldWithFastWarm({ fast: true, every: true });
    const Swr = require('../../../shared/services/quiz/web-quiz-swr');
    const at = Date.now();
    expect(Swr.MAX_STALE).toBe(2);
    expect(Swr.stale({ at, on: true }, 30000, at + 29999)).toBe(false);  // fresh: no re-read
    expect(Swr.stale({ at, on: true }, 30000, at + 30000)).toBe(true);   // past its time: answered, re-read behind it
    expect(Swr.stale({ at, on: true }, 30000, at + 59999)).toBe(true);
    expect(Swr.stale({ at, on: true }, 30000, at + 60000)).toBe(false);  // twice its time: waited for
    expect(Swr.stale(null, 30000, at)).toBe(false);                      // cold: waited for
    // and the hub after 61 s quiet with no timer sees a flip made in the meantime
    const tok = tokenOne();
    await measure(tok, { device: DEVICE });
    S.db.app_settings.find((r) => r.key === 'web_quiz_challenge_book').value = 'false';
    jest.setSystemTime(NOW + 61 * 1000);
    expect(JSON.parse((await measure(tok, { device: DEVICE })).out).book_on).not.toBe(true);
  });

  test('a request before the first tick is answered as without the timer (the cold seam read)', async () => {
    await coldWithFastWarm({ fast: true, every: true });
    Seam().start();
    const cold = await measure(tokenOne(), { device: DEVICE });
    expect(settingsReads(cold)).toBe(1);
  });
});
