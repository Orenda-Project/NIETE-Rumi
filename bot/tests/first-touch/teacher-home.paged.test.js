'use strict';
/**
 * The teacher home's first answer is small (switch quiz_teacher_home_paged): the top card, the library and the newest
 * FIVE timeline rows + `more` + `after`; «More» asks GET /api/th/timeline for the next rows. The round trips and the
 * light lesson read are teacher-home.quick.test.js's. Switch off: today's answer, and the new route answers {off:true}.
 *
 * Round trips are counted with the waves fixture (every read takes READ_MS and gets a wave: 1 + the highest wave
 * already finished when it started). Only the network boundary is faked; every module under test runs for real.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
process.env.PORTAL_URL = 'https://portal.example';
process.env.WHATSAPP_BOT_NUMBER = '15550001111';
process.env.WEB_QUIZ_KID_KEY = 'unit-kid-key-not-a-secret-0123456789';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));
const mockWalk = { forHome: undefined };
jest.mock('../../shared/services/first-touch/walk-persona', () => mockWalk);
jest.mock('../../shared/services/first-touch/one-door.service', () => ({}));
// the walk-through persona handed in by its module name, so the real module is never required (no window for it)
jest.mock('../../shared/services/first-touch/optional-modules', () => ({ load: (n) => (n === 'testPersona' ? mockWalk : null) }));

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const supabase = require('../../shared/config/supabase');
const { logToFile } = require('../../shared/utils/logger');
const { logEvent } = require('../../shared/utils/structured-logger');
const HomeToken = require('../../shared/services/first-touch/teacher-home.token');
const Fx = require('./teacher-home-waves-fixture');

const GOLDEN = path.join(__dirname, '__goldens__', 'teacher-home-paged-off.json');
const PHONE = ['92300', '0000931'].join(''); // built at run time (no phone-shaped literal in the tree)
const DAY = 86400000;

let srv;
let R; // the router module of the last boot
const url = (p, base = '/api/internal/th') => `http://127.0.0.1:${srv.address().port}${base}${p}`;
const H = () => ({ 'x-api-key': process.env.INTERNAL_API_KEY });
const tokenAt = (now = Date.now()) => HomeToken.signTeacherHome({ uid: Fx.TEACHER.id, lang: 'en', via: 'go' }, { now });

/** A fresh process: modules (and their 30 s caches / 60 s memos) new, the fake seeded, the clock at `now`. */
async function boot({ paged = true, now = Fx.NOW, ...opts } = {}) {
  jest.resetModules();
  jest.setSystemTime(now);
  const sb = require('../../shared/config/supabase');
  const fake = Fx.seed(sb, { now: Fx.NOW, ...opts, settings: paged === null ? [] : [{ key: 'quiz_teacher_home_paged', value: paged }] });
  fake.db.users[0].phone_number = PHONE;
  const app = express();
  R = require('../../shared/services/first-touch/teacher-home.routes');
  app.use('/api/internal/th', R.createRouter());
  await stop();
  await new Promise((r) => { srv = app.listen(0, '127.0.0.1', r); });
  return fake;
}
/** The server closed with its keep-alive sockets: a later file's server on the same port never gets this one's requests. */
async function stop() {
  if (!srv) return;
  const s = srv;
  srv = null;
  s.closeAllConnections();
  await new Promise((r) => s.close(r));
}
/**
 * One GET on its own socket (no pooled keep-alive connection: a socket another file's server left open on a reused
 * port would answer for that server).
 */
function getJson(p, base) {
  return new Promise((resolve, reject) => {
    const req = http.get(url(p, base), { headers: H(), agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(text); } catch (_) { /* not JSON */ }
        resolve({ status: res.statusCode, text, body });
      });
    });
    req.on('error', reject);
  });
}
const home = (t = tokenAt()) => getJson(`/api/th/home?t=${t}`);
const page = (after, n = 10, t = tokenAt()) => getJson(`/api/th/timeline?t=${t}${after ? `&after=${encodeURIComponent(after)}` : ''}&n=${n}`);
/** Every page after the first, until `more` is 0. → all rows in order. */
async function walkAll(first, t) {
  const rows = first.timeline.slice();
  let { more, after } = first;
  let guard = 0;
  while (more > 0 && guard < 100) {
    const next = (await page(after, 10, t)).body;
    rows.push(...next.timeline);
    ({ more, after } = next);
    guard += 1;
  }
  return rows;
}
/** The same request with the switch off (today's answer). */
async function offHome(opts = {}) {
  await boot({ ...opts, paged: null });
  return (await home(tokenAt())).body;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'] });
  mockWalk.forHome = undefined;
});
afterEach(async () => {
  jest.useRealTimers();
  await stop();
});

describe('switch ON: the first answer', () => {
  test('a long history (52 recorded lessons + 128 quizzes): 5 round trips cold (the line: at most 6), against 15 today', async () => {
    // a cold process: the switches' 30 s caches and the class report's 60 s memo empty (a first open, or one a minute later)
    await boot({ paged: null });
    const off = await Fx.measure(() => home());
    await boot();
    const on = await Fx.measure(() => home());
    expect(off.value.status).toBe(200);
    expect(on.value.status).toBe(200);
    // the base's count, pinned (wave list in the failure message)
    // today's count (15 on an idle machine; a busy one can split a wave, never merge two)
    expect({ waves: off.waves >= 15, list: off.list }).toEqual({ waves: true, list: off.list });
    expect({ waves: on.waves, list: on.list }).toEqual({ waves: expect.any(Number), list: on.list });
    // pinned: a change that adds a serial read to the first answer turns this red (the line is ≤ 6; cold, the quick
    // answer's switch is read once the home's own answered — teacher-home.quick.test.js pins the warm 4)
    expect({ waves: on.waves, list: on.list }).toEqual({ waves: 5, list: on.list });
  });

  test('the recorded lessons are read once, eligible in the database, without the transcript or the whole analysis', async () => {
    await boot();
    Fx.S.queries.length = 0;
    expect((await home()).status).toBe(200);
    const sessions = Fx.S.queries.filter((q) => q.t === 'coaching_sessions');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].select).not.toMatch(/transcript_text|analysis_data(?!->)/);
    expect(sessions[0].likes).toEqual([['transcript_text', `${'_'.repeat(1500)}%`]]);
  });

  test('180 rows: 5 rows and more 175; the next call rows 6–15 in order; every page together = the whole list, none twice', async () => {
    await boot({ sessions: 100, quizzes: 120, quizzed: 40 });
    const first = (await home()).body;
    expect(first.timeline).toHaveLength(5);
    expect(first.more).toBe(175);
    const second = (await page(first.after, 10)).body;
    expect(second.timeline).toHaveLength(10);
    expect(second.more).toBe(165);
    const all = await walkAll(first, tokenAt());
    expect(all).toHaveLength(180);
    expect(new Set(all.map((r) => r.key)).size).toBe(180);
    expect(second.timeline).toEqual(all.slice(5, 15));
    const dates = all.map((r) => new Date(r.date || 0).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a)); // newest first, as today
    // today's answer (switch off) shows the newest 30 of the same list, row for row
    const off = await offHome({ sessions: 100, quizzes: 120, quizzed: 40 });
    expect(off.timeline).toHaveLength(30);
    expect(all.slice(0, 30)).toEqual(off.timeline);
  });

  test('the operator-sized teacher: the rows, the top card and the library are today\'s', async () => {
    await boot();
    const on = (await home()).body;
    const all = await walkAll(on, tokenAt());
    const off = await offHome();
    expect(all.slice(0, off.timeline.length)).toEqual(off.timeline);
    const strip = (h) => { const x = { ...h }; delete x.timeline; delete x.more; delete x.after; return x; };
    expect(strip(on)).toEqual(strip(off));
  });

  test('reads: never more requests than today (5-row teacher), fewer for a long history', async () => {
    const count = async (opts) => {
      await boot({ ...opts, paged: null });
      const off = await Fx.measure(() => home());
      await boot(opts);
      const on = await Fx.measure(() => home());
      return { off: off.reads, on: on.reads };
    };
    const small = await count({ sessions: 3, quizzes: 2, quizzed: 1 });
    expect(small.on).toBeLessThanOrEqual(small.off);
    const big = await count({ sessions: 100, quizzes: 120, quizzed: 40 });
    expect(big.on).toBeLessThan(big.off);
  });

  test('a teacher with five rows or fewer: more 0, nothing to fetch', async () => {
    await boot({ sessions: 2, quizzes: 1, quizzed: 1 });
    const first = (await home()).body;
    expect(first.timeline.length).toBeLessThanOrEqual(5);
    expect(first.more).toBe(0);
  });
});

describe('switch ON: GET /api/th/timeline', () => {
  test('the walk-through persona\'s hidden lists stay hidden on every page', async () => {
    mockWalk.forHome = async (phone, lists) => (phone === PHONE ? { ...lists, lessons: lists.lessons.filter((r) => r.kind !== 'session') } : lists);
    await boot({ sessions: 100, quizzes: 120, quizzed: 40 });
    const first = (await home()).body;
    const all = await walkAll(first, tokenAt());
    expect(all.length).toBeGreaterThan(15);
    expect(all.filter((r) => r.kind === 'coach')).toEqual([]);
    expect(first.more).toBe(all.length - 5);
  });

  test('a forged, garbled or expired token: the same answer as the home gives', async () => {
    await boot();
    for (const t of ['nope', `${tokenAt().slice(0, -3)}abc`, tokenAt(Fx.NOW - 2 * DAY)]) {
      const h = await home(t);
      const p = await page(null, 10, t);
      expect([p.status, p.body]).toEqual([h.status, h.body]);
      expect([404, 410]).toContain(p.status);
    }
  });

  test('+5 d and +400 d: a stale link answers as the home; a fresh one pages the same list', async () => {
    for (const later of [5 * DAY, 400 * DAY]) {
      await boot({ sessions: 100, quizzes: 120, quizzed: 40, now: Fx.NOW + later });
      const old = tokenAt(Fx.NOW);
      const h = await home(old);
      const p = await page(null, 10, old);
      expect([p.status, p.body]).toEqual([h.status, h.body]);
      const fresh = tokenAt();
      const first = (await home(fresh)).body;
      const all = await walkAll(first, fresh);
      expect(all).toHaveLength(180);
      expect(new Set(all.map((r) => r.key)).size).toBe(180);
    }
  });

  test('a cursor that is not the page\'s own: 400; n is held to 1–20', async () => {
    await boot({ sessions: 100, quizzes: 120, quizzed: 40 });
    const first = (await home()).body;
    expect((await page('../x', 10)).status).toBe(400);
    expect((await page(first.after, 500)).body.timeline).toHaveLength(20);
  });

  test('no log line carries a teacher id', async () => {
    await boot({ sessions: 100, quizzes: 120, quizzed: 40 });
    logToFile.mockClear(); logEvent.mockClear();
    const first = (await home()).body;
    await walkAll(first, tokenAt());
    const lines = JSON.stringify([...logToFile.mock.calls, ...logEvent.mock.calls]);
    expect(lines).not.toContain(Fx.TEACHER.id);
  });
});

describe('switch OFF (absent, false, anything but true)', () => {
  test.each([[null], [false], ['yes'], [1], ['true'], ['"true"'], [' TRUE '], [{ enabled: true }]])('%p: today\'s answer byte for byte; the new route answers {off:true}', async (paged) => {
    await boot({ paged });
    const out = await home();
    expect(out.status).toBe(200);
    if (process.env.RECORD_GOLDEN === '1' && paged === null) fs.writeFileSync(GOLDEN, out.text);
    expect(out.text).toBe(fs.readFileSync(GOLDEN, 'utf8'));
    const p = await page(null, 10);
    expect([p.status, p.body]).toEqual([404, { off: true }]);
  });
});

/** The next app_settings read of `key` answers an error. */
function failSetting(key) {
  const sb = require('../../shared/config/supabase');
  const from0 = sb.from;
  sb.from = (t) => {
    const b = from0(t);
    if (t !== 'app_settings') return b;
    const eq0 = b.eq.bind(b);
    b.eq = (k, v) => { const r = eq0(k, v); if (v === key) r.maybeSingle = async () => ({ data: null, error: { message: 'settings down' } }); return r; };
    return b;
  };
}
const post = (p, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const req = http.request(url(p), { method: 'POST', agent: false, headers: { ...H(), 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
    res.resume(); res.on('end', () => resolve(res.statusCode));
  });
  req.on('error', reject);
  req.end(data);
});

describe('switch OFF: a failed read of the switch', () => {
  test('today\'s answer byte for byte; the new route answers {off:true}', async () => {
    await boot({ paged: true });
    failSetting('quiz_teacher_home_paged');
    expect((await home()).text).toBe(fs.readFileSync(GOLDEN, 'utf8'));
    const p = await page(null, 10);
    expect([p.status, p.body]).toEqual([404, { off: true }]);
  });
});

describe('switch ON: the list held for «More»', () => {
  const OTHER = 'a0000000-0000-4000-8000-0000000000f2';
  const tokenOf = (uid) => HomeToken.signTeacherHome({ uid, lang: 'en', via: 'go' });

  test('held per teacher: one teacher\'s rows never reach another, whatever cursor the other sends', async () => {
    const fake = await boot({ sessions: 100, quizzes: 120, quizzed: 40 });
    fake.db.users.push({ ...fake.db.users[0], id: OTHER, name: 'Bano Testwala', phone_number: null });
    const a = (await home()).body;
    expect(a.more).toBeGreaterThan(0);
    const mine = new Set((await walkAll(a, tokenAt())).map((r) => r.key));
    const b = await page(a.after, 20, tokenOf(OTHER));
    expect(b.status).toBe(200);
    expect(b.body.timeline.filter((r) => mine.has(r.key))).toEqual([]);
    const bHome = (await home(tokenOf(OTHER))).body;
    expect(bHome.timeline.filter((r) => mine.has(r.key))).toEqual([]);
    const b2 = await page(null, 20, tokenOf(OTHER));
    expect(b2.body.timeline.filter((r) => mine.has(r.key))).toEqual([]);
  });

  test('held: the next page reads nothing new while the list is held', async () => {
    await boot({ sessions: 100, quizzes: 120, quizzed: 40 });
    const first = (await home()).body;
    const m = await Fx.measure(() => page(first.after));
    expect(m.value.status).toBe(200);
    expect(m.reads).toBe(0);
  });

  const RANDOM = 'b0000000-0000-4000-8000-0000000000e9';
  test.each([
    ['POST /api/th/send', (t) => post('/api/th/send', { t, kind: 'again', id: RANDOM })],
    ['POST /api/th/quiz/make', (t) => post('/api/th/quiz/make', { t, kind: 'coaching', id: RANDOM })],
    ['POST /api/th/confirm', (t) => post('/api/th/confirm', { t, looseId: RANDOM, candidateId: Fx.QZ(1), decision: 'unsure' })],
    ['POST /api/th/step (a send marked)', (t) => post('/api/th/step', { t, step: 'share_tap', kind: 'again', id: Fx.QZ(1), c: Fx.CODE(1) })],
  ])('%s drops the held list: the next «More» reads the lists again', async (_, act) => {
    await boot({ sessions: 100, quizzes: 120, quizzed: 40 });
    const t = tokenAt();
    const first = (await home(t)).body;
    await act(t);
    const m = await Fx.measure(() => page(first.after, 10, t));
    expect(m.value.status).toBe(200);
    expect(m.reads).toBeGreaterThan(0);
  });

  test('the walk-through persona\'s view on the route\'s OWN read (no list held): the hidden lists stay hidden', async () => {
    mockWalk.forHome = async (phone, lists) => (phone === PHONE ? { ...lists, lessons: lists.lessons.filter((r) => r.kind !== 'session') } : lists);
    await boot({ sessions: 100, quizzes: 120, quizzed: 40 });
    const first = (await page(null, 20)).body; // straight to the route: nothing held
    expect(first.timeline.length).toBe(20);
    expect(first.timeline.filter((r) => r.kind === 'coach')).toEqual([]);
  });
});
