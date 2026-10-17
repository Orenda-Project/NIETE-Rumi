'use strict';
/**
 * One file each for the child home's scripts and styles (app_settings web_quiz_pack, default off, fail closed, 30 s cache).
 *
 * On: the hub payload (Hub.hub) says `pack: true`, and the edge links the home's scripts as one file and its styles as
 * one file. Off: the hub payload is today's (no `pack` key). Only JSON true is on (the string 'true' is off).
 * The switch rides the hub's one switch read (web_quiz_fast on): on adds no wave and no app_settings read over off.
 * With the fast page off it reads its own row in the background, never waited for.
 *
 * Supabase, Redis and WhatsApp are the boundaries and are faked; every first-party module on the path runs for real.
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

const Fx = require('./hub-waves-fixture');
const { makeFake } = require('./fake-supabase');

const SAVED = { ...process.env };
afterAll(() => { process.env = SAVED; });

describe('the switch (web-quiz-pack.js)', () => {
  let supabase;
  let Pack;
  const wait = () => new Promise((r) => setTimeout(r, 5));
  beforeEach(() => {
    jest.resetModules();
    supabase = require('../../../shared/config/supabase');
    Pack = require('../../../shared/services/quiz/web-quiz-pack');
  });
  const settings = (rows, fail = false) => {
    const fake = makeFake({ app_settings: rows });
    Object.assign(supabase, { from: (t) => { if (fail) throw new Error('db down'); return fake.from(t); } });
  };

  test('the first read after a start is off (never waited for); the next one answers from the refreshed cache', async () => {
    settings([{ key: 'web_quiz_pack', value: true }]);
    expect(Pack.KEY).toBe('web_quiz_pack');
    expect(Pack.on()).toBe(false);
    await wait();
    expect(Pack.on()).toBe(true);
  });

  test('missing, false, the string "true", 1, null, junk and a failed read are off; only JSON true is on', async () => {
    for (const [rows, want] of [[[], false], [[{ key: 'web_quiz_pack', value: false }], false], [[{ key: 'web_quiz_pack', value: 'true' }], false],
      [[{ key: 'web_quiz_pack', value: '"true"' }], false], [[{ key: 'web_quiz_pack', value: 1 }], false], [[{ key: 'web_quiz_pack', value: null }], false],
      [[{ key: 'web_quiz_pack', value: 'yes' }], false], [[{ key: 'web_quiz_pack', value: true }], true]]) {
      Pack._reset();
      settings(rows);
      Pack.on();
      await wait();
      expect([rows, Pack.on()]).toEqual([rows, want]);
    }
    Pack._reset();
    settings([], true);
    Pack.on();
    await wait();
    expect(Pack.on()).toBe(false);
  });

  test('it is one of the hub\'s one-read switches (its own key, parsed by its own rule)', () => {
    const Seam = require('../../../shared/services/quiz/web-quiz-hub-switches');
    const e = Seam.entries().find((x) => x.name === 'pack');
    expect(e).toBeTruthy();
    expect(e.keys).toEqual(['web_quiz_pack']);
    expect(Seam.ALL_KEYS()).toContain('web_quiz_pack');
    const now = Date.now();
    e.prime([{ key: 'web_quiz_pack', value: 'true' }], now);
    expect(e.peek().on).toBe(false);
    e.prime([{ key: 'web_quiz_pack', value: true }], now);
    expect(e.peek().on).toBe(true);
  });
});

describe('the hub payload, every child switch on (hub-waves fixture)', () => {
  beforeAll(() => Fx.useClock());
  afterAll(() => jest.useRealTimers());
  beforeEach(() => { process.env = Fx.hubEnv(SAVED); });
  const noOffer = (json) => json.replace(/"offer":"[A-Za-z0-9_-]{10}"/g, '"offer":"-"');
  const without = (json, k) => { const o = JSON.parse(noOffer(json)); delete o[k]; return o; };

  test('fast page on: on says `pack: true`, off has no `pack` key; the same waves and the same app_settings reads (it rides the one read)', async () => {
    const off = await Fx.hubWaves({ switches: ['web_quiz_pack'] });
    const on = await Fx.hubWaves({ switches: [] });
    expect(JSON.parse(off.out)).not.toHaveProperty('pack');
    expect(JSON.parse(on.out).pack).toBe(true);
    expect(without(on.out, 'pack')).toEqual(without(off.out, 'pack'));
    expect(on.warm.waves).toBe(off.warm.waves);
    expect(on.stale.waves).toBe(off.stale.waves);
    expect(on.warm.perTable.app_settings || 0).toBe(off.warm.perTable.app_settings || 0);
    expect(on.stale.perTable.app_settings || 0).toBe(off.stale.perTable.app_settings || 0);
  });

  test('the string "true" is off: no `pack` key', async () => {
    Fx.boot({ fast: true, every: true, json: true });
    Fx.S.db.app_settings.find((r) => r.key === 'web_quiz_pack').value = 'true';
    const tok = Fx.tokenOne();
    await Fx.measure(tok, { device: Fx.DEVICE });
    const warm = await Fx.measure(tok, { device: Fx.DEVICE });
    expect(JSON.parse(warm.out)).not.toHaveProperty('pack');
  });

  test('fast page off: on says `pack: true` with the same waves; at most its own background read more', async () => {
    const off = await Fx.hubWaves({ switches: ['web_quiz_pack'], fast: false });
    const on = await Fx.hubWaves({ switches: [], fast: false });
    expect(JSON.parse(off.out)).not.toHaveProperty('pack');
    expect(JSON.parse(on.out).pack).toBe(true);
    expect(without(on.out, 'pack')).toEqual(without(off.out, 'pack'));
    expect(on.warm.waves).toBe(off.warm.waves);
    expect(on.stale.waves).toBe(off.stale.waves);
    expect(on.warm.perTable.app_settings || 0).toBe(off.warm.perTable.app_settings || 0);
    expect(on.stale.perTable.app_settings || 0).toBe(off.stale.perTable.app_settings || 0);
  });
});
