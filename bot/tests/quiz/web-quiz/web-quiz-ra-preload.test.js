'use strict';
/**
 * The read-along player's preload (app_settings web_quiz_ra_preload): the games menu says `ra_pre: true` only when the
 * switch is the stored JSON boolean true, the read-along is on, and the menu can serve a passage (Story Time on, a read
 * stop). Anything else leaves the menu exactly as it was (a golden recorded from the base). The switch is read in the
 * background, never waited for: the waves are the same on or off, and never above the base's (the constants below).
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

const fs = require('fs');
const path = require('path');

const BASE = { warm: 3, stale: 6 };   // the base's waves on this fixture (child with no class, fast on), warm / stale
const GOLDEN = path.join(__dirname, 'fixtures', 'ra-preload-off-menu.golden.json');

function tables(extra = []) {
  return {
    app_settings: [{ key: 'web_quiz_challenge', value: true }, { key: 'web_quiz_fast', value: true },
      { key: 'web_quiz_challenge_v2', value: true }, { key: 'web_quiz_challenge_story', value: true }, ...extra],
    student_lists: [],
    students: [{ id: KID, list_id: null, self_reported_class: '3' }],
    quiz_share_codes: [{ id: SC, code: 'ABCD12', language: 'en', parent_share_code_id: null, invited_by_student_id: null }],
    quiz_sessions: [],
    web_quiz_challenge_runs: [],
  };
}

let reads = [];
let doneMax = 0;
let fake;
let failRead = false;
function seed(extra, { story = true } = {}) {
  const t = tables(extra);
  if (!story) t.app_settings = t.app_settings.filter((r) => r.key !== 'web_quiz_challenge_story');
  fake = makeFake(t);
  const from = (tb) => {
    const b = fake.from(tb);
    const then = b.then;
    b.then = (res, rej) => {
      const rec = { t: tb, wave: doneMax + 1 };
      reads.push(rec);
      return new Promise((r) => setTimeout(r, READ_MS))
        .then(() => { doneMax = Math.max(doneMax, rec.wave); if (failRead && tb === 'app_settings' && b._rapre) throw new Error('boom'); return then.call(b, (x) => x); })
        .then(res, rej);
    };
    const inn = b.in && b.in.bind(b);
    if (inn) b.in = (col, vals) => { if (tb === 'app_settings' && Array.isArray(vals) && vals.includes('web_quiz_ra_preload')) b._rapre = true; return inn(col, vals); };
    return b;
  };
  Object.assign(require('../../../shared/config/supabase'), { from, rpc: fake.rpc });
}
const settle = () => new Promise((r) => setTimeout(r, 12 * READ_MS));

let Ch;
let T;
function boot(extra, o) {
  jest.resetModules();
  jest.setSystemTime(NOW);
  seed(extra, o);
  Ch = require('../../../shared/services/quiz/web-quiz-challenge');
  T = require('../../../shared/services/quiz/web-quiz-token');
}
const tok = () => T.sign({ k: 'h', ids: [KID], exp: Math.floor(NOW / 1000) + 3600 });

async function measure(token) {
  await settle();
  reads = [];
  doneMax = 0;
  const out = await Ch.menu(token, { device: DEVICE });
  const waves = doneMax;
  await settle();
  return { out, waves };
}
// the first menu starts the switch's background read; the next (after it lands) carries its answer
async function primed(extra, o) {
  boot(extra, o);
  const t = tok();
  await measure(t);
  return measure(t);
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
  failRead = false;
  process.env = { ...SAVED, WEB_QUIZ_TOKEN_SECRET: 'menu-waves-secret', INTERNAL_API_KEY: 'test-internal-key' };
});

const RA = { key: 'web_quiz_readalong', value: true };
const PRE = (value) => ({ key: 'web_quiz_ra_preload', value });

describe('the read-along preload mark on the games menu', () => {
  test('on (boolean true, read-along on, passage menu): the menu says ra_pre once', async () => {
    const { out } = await primed([RA, PRE(true)]);
    expect(out.ra_pre).toBe(true);
    expect(out.v2.story).toBe(true);
    expect(out.exercises.some((e) => e.id === 'read')).toBe(true);
  });

  test('a story-less menu (Story Time off) never carries it', async () => {
    const { out } = await primed([RA, PRE(true)], { story: false });
    expect(out).not.toHaveProperty('ra_pre');
  });

  test.each([['the string true', 'true'], ['a quoted string', '"true"'], ['yes', 'yes'], ['one', 1], ['an object', { enabled: true }], ['false', false], ['null', null]])('a stored %s is off', async (_n, value) => {
    const { out } = await primed([RA, PRE(value)]);
    expect(out).not.toHaveProperty('ra_pre');
  });

  test('no row is off; read-along off is off', async () => {
    expect((await primed([RA])).out).not.toHaveProperty('ra_pre');
    expect((await primed([PRE(true)])).out).not.toHaveProperty('ra_pre');
  });

  test('a failed read is off', async () => {
    failRead = true;
    const { out } = await primed([RA, PRE(true)]);
    expect(out).not.toHaveProperty('ra_pre');
  });

  test('off (no switch row): the menu is the base golden, byte for byte', async () => {
    const { out } = await primed([RA]);
    const text = JSON.stringify(out, null, 1);
    // The golden was recorded once from the base code (write `${text}\n` to GOLDEN by hand to re-record).
    expect(`${text}\n`).toBe(fs.readFileSync(GOLDEN, 'utf8'));
  });

  test('on: the same menu as off, plus the one key', async () => {
    const off = (await primed([RA])).out;
    const on = (await primed([RA, PRE(true)])).out;
    const { ra_pre: mark, ...rest } = on;
    expect(mark).toBe(true);
    expect(rest).toEqual(off);
  });
});

describe('the read-along preload switch adds no wave', () => {
  async function warmAndStale(extra) {
    boot(extra);
    const t = tok();
    await measure(t);
    const warm = await measure(t);
    jest.setSystemTime(NOW + 31 * 1000);
    const stale = await measure(t);
    return { warm, stale };
  }
  test('on: the same waves as off, warm and stale; off never above the base', async () => {
    const off = await warmAndStale([RA]);
    const on = await warmAndStale([RA, PRE(true)]);
    console.log(`menu waves: off ${off.warm.waves} warm / ${off.stale.waves} stale; on ${on.warm.waves} / ${on.stale.waves}; base ${BASE.warm} / ${BASE.stale}`);
    expect(on.warm.out.ra_pre).toBe(true);
    expect({ warm: on.warm.waves, stale: on.stale.waves }).toEqual({ warm: off.warm.waves, stale: off.stale.waves });
    expect(off.warm.waves).toBeLessThanOrEqual(BASE.warm);
    expect(off.stale.waves).toBeLessThanOrEqual(BASE.stale);
  });
});
