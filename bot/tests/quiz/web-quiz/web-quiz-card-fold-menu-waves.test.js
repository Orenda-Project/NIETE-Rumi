'use strict';
/**
 * The games menu's cost with the child home on (web_quiz_home_v3): its `no_class` read (a child no teacher's quiz has
 * reached shares with "Share") starts beside the menu's own lookups, never after them. Every read takes READ_MS at the
 * boundary (Supabase, faked) and is given a WAVE, 1 + the highest wave of the reads already finished when it started;
 * the page waits for the highest wave. With the home on, the menu waits for exactly as many waves as with it off, warm
 * and 31 s later (every 30 s cache stale), and off it never waits longer than the base did (the constants below, the
 * base's own counts on this fixture), for a class child and for a child with no class.
 *
 * Supabase, Redis and the loggers are the boundaries; every first-party module on the path runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    isAvailable: () => true,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    set: async (k, v) => { store.set(k, v); return true; },
    delete: async (k) => { store.delete(k); return true; },
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; },
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');

const READ_MS = 8;
const NOW = Date.UTC(2026, 9, 14, 6, 0, 0);
const KID = '44444444-4444-4444-8444-444444444444';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const SC = '33333333-3333-4333-8333-333333333333';
const DEVICE = 'FamilyPhoneDeviceRef_1';

// The base's waves on this fixture (fast on, home absent; measured on the base before the fold), warm / stale.
const BASE = { class: { warm: 4, stale: 7 }, loose: { warm: 3, stale: 6 } };

function tables({ home, loose }) {
  return {
    app_settings: [{ key: 'web_quiz_challenge', value: true }, { key: 'web_quiz_fast', value: true },
      ...(home ? [{ key: 'web_quiz_home_v3', value: true }] : [])],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: 't1', is_active: true }],
    students: [loose ? { id: KID, list_id: null, self_reported_class: '3' } : { id: KID, list_id: LIST }],
    quiz_share_codes: [{ id: SC, code: 'ABCD12', language: 'en', parent_share_code_id: null, invited_by_student_id: null }],
    quiz_sessions: loose ? [] : [{ id: 's1', student_id: KID, share_code_id: SC, quiz_id: 'q1', status: 'completed', created_at: new Date(NOW - 3600000).toISOString() }],
    web_quiz_challenge_runs: [],
  };
}

let reads = [];
let doneMax = 0;
function seed(opts) {
  const fake = makeFake(tables(opts));
  const from = (t) => {
    const b = fake.from(t);
    const then = b.then;
    b.then = (res, rej) => {
      const rec = { t, wave: doneMax + 1 };
      reads.push(rec);
      return new Promise((r) => setTimeout(r, READ_MS))
        .then(() => { doneMax = Math.max(doneMax, rec.wave); return then.call(b, (x) => x); })
        .then(res, rej);
    };
    return b;
  };
  Object.assign(require('../../../shared/config/supabase'), { from, rpc: fake.rpc });
}
const settle = () => new Promise((r) => setTimeout(r, 12 * READ_MS));

let Ch;
let T;
function boot(opts) {
  jest.resetModules();
  jest.setSystemTime(NOW);
  seed(opts);
  Ch = require('../../../shared/services/quiz/web-quiz-challenge');
  T = require('../../../shared/services/quiz/web-quiz-token');
}

async function measure(token) {
  await settle();
  reads = [];
  doneMax = 0;
  const out = await Ch.menu(token, { device: DEVICE });
  const waves = doneMax;
  await settle();
  return { out, waves };
}

async function warmAndStale(opts) {
  boot(opts);
  const tok = T.sign({ k: 'h', ids: [KID], exp: Math.floor(NOW / 1000) + 3600 });
  await measure(tok);
  const warm = await measure(tok);
  jest.setSystemTime(NOW + 31 * 1000);
  const stale = await measure(tok);
  return { warm, stale };
}

const SAVED = { ...process.env };
beforeAll(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'] });
});
afterAll(() => {
  jest.useRealTimers();
  process.env = SAVED;
});
beforeEach(() => {
  process.env = { ...SAVED, WEB_QUIZ_TOKEN_SECRET: 'menu-waves-secret', INTERNAL_API_KEY: 'test-internal-key' };
});

describe.each([['a class child', 'class', false], ['a child with no class', 'loose', true]])('the games menu with the child home on: %s', (_name, key, loose) => {
  test('home on: the same waves as home off, warm and stale (+0); off never above the base', async () => {
    const off = await warmAndStale({ loose });
    const on = await warmAndStale({ loose, home: true });
    console.log(`menu waves (${key}): home off ${off.warm.waves} warm / ${off.stale.waves} stale; home on ${on.warm.waves} / ${on.stale.waves}; base ${BASE[key].warm} / ${BASE[key].stale}`);
    // The fixture reaches the fold's read: a child with no class gets no_class, a class child none.
    if (loose) expect(on.warm.out.no_class).toBe(true);
    else expect(on.warm.out).not.toHaveProperty('no_class');
    expect(off.warm.out).not.toHaveProperty('no_class');
    expect({ warm: on.warm.waves, stale: on.stale.waves }).toEqual({ warm: off.warm.waves, stale: off.stale.waves });
    expect(off.warm.waves).toBeLessThanOrEqual(BASE[key].warm);
    expect(off.stale.waves).toBeLessThanOrEqual(BASE[key].stale);
  });
});
