'use strict';
/**
 * app_settings web_quiz_read_feedback: a scored read carries a coarse `feedback` {stars, badge, words_heard} on EVERY
 * result body, the child's own phone or not, so a forwarded link or a cookie miss still answers the reading. The
 * speed (and what gives it back) stays on the child's own phone only. Off (absent, false, the string "true", 1, {}):
 * every body is today's, byte for byte, and the Jugnu page's menu has no new field.
 */
process.env.INTERNAL_API_KEY = 'route-key';
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');

const RF = require('../../../shared/services/quiz/web-quiz-read-feedback');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
const NR = require('../../../shared/services/quiz/web-quiz-next-offer-result');
const Device = require('../../../shared/services/quiz/web-quiz-hub-device');

let server; let base;
let settings = [];
const reads = { n: 0 };
beforeAll(async () => {
  const fake = makeFake({});
  Object.assign(supabase, {
    from: (t) => {
      if (t !== 'app_settings') return fake.from(t);
      reads.n += 1;
      return { select: () => ({ eq: (_k, key) => Promise.resolve({ data: settings.filter((r) => r.key === key), error: null }) }) };
    },
    rpc: fake.rpc,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => { RF._reset(); reads.n = 0; });
afterEach(() => jest.restoreAllMocks());

const KEY = { 'x-api-key': 'route-key', 'content-type': 'application/json' };
const own = 'OwnPhoneOwnPhoneOwnP_1';
const ct = T.signChallenge({ studentId: 'kid-1', ex: 'read', runId: 'run-1' });
const scored = { score: { correct: 40, attempted: 44, stopped: false, finished_early: true, time_left: 3 }, wcpm: 42, previous: { wcpm: 30, correct: 28, at: 'then' }, ended: 'self' };
const keysDeep = (o) => (o && typeof o === 'object' ? Object.keys(o).flatMap((k) => [k, ...keysDeep(o[k])]) : []);
const copy = (o) => JSON.parse(JSON.stringify(o));

function wire(body) {
  jest.spyOn(Ch, 'poll').mockImplementation(async () => copy(body));
  jest.spyOn(Ch, 'submit').mockImplementation(async () => copy(body));
  jest.spyOn(NR, 'challengeField').mockResolvedValue({});
  jest.spyOn(Device, 'deviceMayName').mockImplementation(async (ids, d) => d === own && ids.includes('kid-1'));
}
const get = async (h) => (await fetch(`${base}/ch/result/${encodeURIComponent(ct)}`, { headers: { ...KEY, ...h } })).json();
const post = async (h) => (await fetch(`${base}/ch/result`, { method: 'POST', headers: { ...KEY, ...h }, body: JSON.stringify({ ct, key: 'k' }) })).json();
// every builder of a scored body this switch touches, as the owner and as another phone
const BUILDERS = { 'result poll': get, 'result post': post };
const OTHER = [{}, { 'x-wq-device': 'OtherPhoneOtherPhone_2' }];

describe('the switch reads strictly: only the JSON true is on', () => {
  test.each([['absent', null], ['false', false], ['the string "true"', 'true'], ['1', 1], ['{}', {}], ['{enabled:true}', { enabled: true }]])('%s: every result body is today\'s, byte for byte', async (_n, value) => {
    settings = value === null ? [] : [{ key: RF.KEY, value }];
    wire(scored);
    for (const [name, call] of Object.entries(BUILDERS)) {
      expect([name, await call({ 'x-wq-device': own })]).toEqual([name, scored]);
      for (const h of OTHER) expect([name, await call(h)]).toEqual([name, { score: { attempted: 44, stopped: false }, ended: 'self' }]);
    }
    expect(await RF.menuField()).toEqual({});
  });
  test('a failed settings read is off, never on', async () => {
    const from = supabase.from;
    supabase.from = () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'down' } }) }) });
    try { expect(await RF.on()).toBe(false); expect(await RF.withBand(copy(scored))).toEqual(scored); } finally { supabase.from = from; }
  });
  test('one settings read per 30 s, whatever the key holds (absent, false, the string "true")', async () => {
    for (const s of [[], [{ key: RF.KEY, value: false }], [{ key: RF.KEY, value: 'true' }]]) {
      settings = s; RF._reset(); reads.n = 0;
      await RF.on(); await RF.on(); await RF.menuField();
      expect(reads.n).toBe(1);
    }
  });
});

describe('key on: the feedback band on every scored body; the speed only on the own phone', () => {
  beforeEach(() => { settings = [{ key: RF.KEY, value: true }]; });
  test('owner: today\'s body plus feedback; another phone: the score, the feedback, and none of the owner-only keys at any depth', async () => {
    wire(scored);
    const fb = { stars: 3, badge: 'faster', words_heard: 44 };   // 40 of 44 right = 91 %
    for (const [name, call] of Object.entries(BUILDERS)) {
      expect([name, await call({ 'x-wq-device': own })]).toEqual([name, { ...scored, feedback: fb }]);
      for (const h of OTHER) {
        const body = await call(h);
        expect([name, body.feedback]).toEqual([name, fb]);
        expect([name, keysDeep(body).filter((k) => RF.OWNER_ONLY.includes(k))]).toEqual([name, []]);
      }
    }
    expect(await RF.menuField()).toEqual({ read_feedback: true });
  });
  test('a 0-word read and a stopped read get the kind band; a pending read and a tap game get none', async () => {
    expect(RF.band({ score: { correct: 0, attempted: 0, stopped: false, time_left: 0 }, wcpm: 0 })).toEqual({ stars: 0, badge: 'try', words_heard: 0 });
    expect(RF.band({ score: { correct: 5, attempted: 6, stopped: true }, wcpm: 0 })).toEqual({ stars: 0, badge: 'try', words_heard: 0 });
    expect(RF.band({ score: { correct: 0, attempted: 0 }, wcpm: null, implausible: 'floor' })).toEqual({ stars: 0, badge: 'try', words_heard: 0 });
    expect(await RF.withBand({ pending: true })).toEqual({ pending: true });
    expect(await RF.withBand({ score: { correct: 3, n: 5 } })).toEqual({ score: { correct: 3, n: 5 } });
    wire({ pending: true });
    expect(await get({})).toEqual({ pending: true });
  });
  test('"faster" only against the child\'s own last read, and only on a read long enough to be honest', () => {
    const b = (correct, w, p) => RF.band({ score: { correct, attempted: correct }, wcpm: w, previous: p == null ? null : { wcpm: p } }).badge;
    expect([b(40, 42, 40), b(40, 41, 40), b(40, 42, null), b(10, 42, 30)]).toEqual(['faster', 'star', 'star', 'star']);
  });
});

describe('the band and the page agree (wq-moment.js draws the same stars and badge from the full result)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'dashboard', 'public', 'wq', 'wq-moment.js'), 'utf8');
  const win = {};
  vm.runInContext(src, vm.createContext({ window: win, document: {} }));
  const M = win.WQMoment;
  test.each([
    [{ correct: 40, attempted: 44 }, 42, 30], [{ correct: 9, attempted: 10 }, 20, null], [{ correct: 7, attempted: 10 }, 30, 29],
    [{ correct: 3, attempted: 10 }, 12, null], [{ correct: 50, attempted: 50 }, 50, 50], [{ correct: 20, attempted: 22 }, 60, 40],
  ])('%j at %s a minute (last %s)', (score, wcpm, prev) => {
    const out = { score: { ...score, stopped: false }, wcpm, previous: prev == null ? null : { wcpm: prev } };
    const lv = M.level(M.feedback(out), 3);
    const band = RF.band(out);
    expect({ stars: band.stars, badge: band.badge }).toEqual({ stars: lv.stars, badge: lv.badge });
    // and the page draws the same stars and badge from the band alone (another phone's body)
    const stripped = { score: { attempted: score.attempted, stopped: false }, feedback: band };
    const lv2 = M.level(M.feedback(stripped), 3);
    expect({ stars: lv2.stars, badge: lv2.badge }).toEqual({ stars: band.stars, badge: band.badge });
    expect(M.feedback(stripped).words).toBe(score.attempted);
  });
  test('the numbers are one table: the page\'s and the server\'s thresholds match', () => {
    expect(src).toMatch(/STAR_AT = \[0\.7, 0\.9\]/);
    expect(src).toMatch(/GROWTH_UP = 2;/);
    expect(src).toMatch(/MIN_WORDS = 15,/);
    expect([RF.STAR_AT, RF.GROWTH_UP, RF.MIN_WORDS]).toEqual([[0.7, 0.9], 2, 15]);
  });
});
