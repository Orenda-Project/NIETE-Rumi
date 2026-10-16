'use strict';
/**
 * One row per kid-hub switch: turning the switch ON must not add a round trip (wave) to the hub.
 *
 * A change that adds a hub switch adds ONE row here: [its switch keys]. For each row the hub is booted with web_quiz_fast
 * on and every other ceiling switch on, once with the row's switches OFF and once with them ON, on the same fixture
 * (hub-waves-fixture.js). Warm waves ON must equal OFF, and so must the stale ones (31 s later, every 30 s cache expired).
 *
 * +1 wave is allowed only for a read that needs a value the hub computes last, and the reason is named in the change's
 * description: [keys, { extra: 1, why: '...' }]. An optional staleExtra sets the stale allowance on its own (it defaults
 * to extra). Nothing else may loosen a row.
 * A new switch also joins CEILING_KEYS in the fixture (the ceiling test in web-quiz-hub-waves.test.js checks that).
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

const ROWS = [
  [['web_quiz_home_v3', 'web_quiz_stories']],
  [['quiz_student_join']],
  [['web_quiz_challenge_book']],
  [['web_quiz_phone_bind']],
];

const SAVED = { ...process.env };
beforeAll(() => Fx.useClock());
afterAll(() => { jest.useRealTimers(); process.env = SAVED; });
beforeEach(() => { process.env = Fx.hubEnv(SAVED); });

describe('a hub switch ON adds no wave over OFF (fast page on, every other switch on)', () => {
  test.each(ROWS.map((r) => [r[0].join(' + '), r]))('%s', async (_, [keys, allow]) => {
    const extra = (allow && allow.extra) || 0;
    const staleExtra = allow && allow.staleExtra !== undefined ? allow.staleExtra : extra;
    const off = await Fx.hubWaves({ switches: keys });
    const on = await Fx.hubWaves({ switches: [] });
    const show = (what, a, b, la, lb, ok) => `${keys.join(' + ')}, ${what}: OFF ${a} waves, ON ${b} (allowed +${ok}).\nOFF (table, caller):\n${la}\nON (table, caller):\n${lb}`;
    console.log(`${keys.join(' + ')}: warm OFF ${off.warm.waves} ON ${on.warm.waves}; stale OFF ${off.stale.waves} ON ${on.stale.waves}`);
    if (on.warm.waves !== off.warm.waves + extra) throw new Error(show('warm', off.warm.waves, on.warm.waves, off.list, on.list, extra));
    if (on.stale.waves !== off.stale.waves + staleExtra) throw new Error(show('stale', off.stale.waves, on.stale.waves, off.staleList, on.staleList, staleExtra));
  });
});
