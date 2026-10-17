'use strict';
/**
 * A guard on the hub's one switch read (web-quiz-hub-switches.js, web_quiz_fast on): a hub switch with its own read is
 * a second settings read with the fast page on.
 *
 * Runtime (the hub booted on the recording fake of hub-waves-fixture.js, every first-party module real): with the fast
 * page on, every hub switch ON and every hub switch OFF are each exactly ONE app_settings read, and every key the hub
 * asks for (fast on and fast off) is in the one read's keys or on the named list below.
 * Static pre-check: every key a hub module names (a `*_KEY` / `KEYS` constant, or a literal in `.eq('key', …)` /
 * `.in('key', …)`) in shared/services/quiz/web-quiz-hub*.js and the `*-flag(s).js` modules they require is covered too.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
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

const { S, DEVICE, CEILING_KEYS, boot, settle, measure, tokenOne } = Fx;
const DIR = path.join(__dirname, '../../../shared/services/quiz');
// Keys the hub may ask for outside the one read, each with its reason.
const EXEMPT = {
  web_quiz_fast: 'the fast switch decides whether the one read runs; web-quiz-fast.js reads it (the timer\'s read carries it)',
};
// A second combined settings read on the child home, named: its keys are exempt here, and each tier reads them in
// exactly ONE read (the one read with the fast page on, its own combined read with it off).
const COMBINED = {
  'home-flags combined read (1 read per tier)': ['web_quiz_home_v3', 'web_quiz_stories', 'web_quiz_remember_column'],
};
Object.values(COMBINED).flat().forEach((k) => { EXEMPT[k] = 'home-flags combined read (1 read per tier)'; });
const Seam = () => require('../../../shared/services/quiz/web-quiz-hub-switches');
const settingsReads = () => S.reads.filter((r) => r.t === 'app_settings').length;
const uncovered = (keys) => [...keys].filter((k) => !Seam().ALL_KEYS().includes(k) && !EXEMPT[k]).sort();

const SAVED = { ...process.env };
beforeAll(() => Fx.useClock());
afterAll(() => { jest.useRealTimers(); process.env = SAVED; });
beforeEach(() => { process.env = Fx.hubEnv(SAVED); });

// A cold process with the fast switch already read (as at a start), then one hub request; the keys it asked for.
async function coldHub(opts) {
  boot(opts);
  require('../../../shared/services/quiz/web-quiz-fast').on();
  await settle();
  // the keys of each app_settings read of the request, one list per read
  const perRead = [];
  const db = require('../../../shared/config/supabase');
  const from = db.from;
  db.from = (t) => {
    const b = from(t);
    if (t !== 'app_settings') return b;
    const { eq, in: inn } = b;
    b.eq = (c, v) => { if (c === 'key') perRead.push([v]); return eq(c, v); };
    b.in = (c, vs) => { if (c === 'key') perRead.push([...vs]); return inn(c, vs); };
    return b;
  };
  Fx.askedKeys.clear();
  const m = await measure(tokenOne(), { device: DEVICE });
  db.from = from;
  return { m, reads: m.perTable.app_settings || 0, keys: new Set(Fx.askedKeys), perRead };
}
// reads that carry the whole combined set: its own read (fast off) or the one read (fast on); a module reading one of
// its keys alone (the stories module's own read of web_quiz_stories) is not it
const combinedReads = (perRead, keys) => perRead.filter((ks) => keys.every((k) => ks.includes(k))).length;

describe('runtime: the hub with the fast page on is ONE app_settings read, every switch ON or OFF', () => {
  test.each([
    ['every hub switch ON', { fast: true, every: true }],
    // the hub's own switch stays on (off, the hub is closed: web_quiz_off before any switch is read)
    ['every hub switch OFF but the hub itself', { fast: true, every: true, off: CEILING_KEYS.filter((k) => k !== 'web_quiz_hub') }],
  ])('%s: exactly one settings read, every key asked for in the one read or named', async (_, opts) => {
    const { reads, keys, perRead } = await coldHub(opts);
    expect(reads).toBe(1);
    expect(uncovered(keys)).toEqual([]);
    for (const ks of Object.values(COMBINED)) expect(combinedReads(perRead, ks)).toBe(1);
  });

  test('fast off (each module its own read): every key the hub asks for is in the one read or named', async () => {
    const { keys, perRead } = await coldHub({ fast: false, every: true });
    expect(keys.size).toBeGreaterThan(20);
    expect(uncovered(keys)).toEqual([]);
    for (const ks of Object.values(COMBINED)) expect(combinedReads(perRead, ks)).toBe(1);
  });

  // The games menu (web-quiz-challenge.js menu -> settingOn) does not start the one read yet: its own seam is open.
  test.failing('OPEN: the games menu seam (challenge settingOn outside the one read): the games menu with the fast page on is ONE settings read', async () => {
    boot({ fast: true, every: true });
    require('../../../shared/services/quiz/web-quiz-fast').on();
    await settle();
    S.reads = [];
    await require('../../../shared/services/quiz/web-quiz-challenge').menu(tokenOne(), { device: DEVICE });
    await settle();
    expect(settingsReads()).toBe(1);
  });
});

function keysNamedIn(file) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const out = new Set();
  const lits = (s) => [...s.matchAll(/'([a-z][a-z0-9_]*)'/g)].map((m) => m[1]);
  for (const m of src.matchAll(/\b[A-Z0-9_]*KEYS?\s*=\s*([^;]*);/g)) lits(m[1]).forEach((k) => out.add(k));
  for (const m of src.matchAll(/\.(?:eq|in)\(\s*'key'\s*,\s*([^)]*)\)/g)) lits(m[1]).forEach((k) => out.add(k));
  return [...out];
}

describe('static pre-check: every switch a hub module names is in the one read or named', () => {
  const hub = fs.readdirSync(DIR).filter((f) => /^web-quiz-hub.*\.js$/.test(f));
  const flags = new Set();
  for (const f of hub) {
    for (const m of fs.readFileSync(path.join(DIR, f), 'utf8').matchAll(/require\('\.\/([a-z0-9-]+-flags?)'\)/g)) flags.add(`${m[1]}.js`);
  }
  const files = [...new Set([...hub, ...flags])].sort();

  test('the scan finds the hub flag modules (it is not vacuous)', () => {
    expect(files).toEqual(expect.arrayContaining(['web-quiz-hub-flags.js', 'web-quiz-hub-play.js', 'web-quiz-home-flags.js', 'web-quiz-identity-flags.js', 'web-quiz-home-fallback-flag.js']));
    expect(files.reduce((n, f) => n + keysNamedIn(f).length, 0)).toBeGreaterThan(20);
  });

  test('every key named is in hubSwitches\' keys or on the named list', () => {
    const missing = files.flatMap((f) => uncovered(keysNamedIn(f)).map((k) => `${f}: ${k}`));
    expect(missing).toEqual([]);
  });
});
