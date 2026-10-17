'use strict';
/**
 * The teacher home's answer is quick (switch quiz_teacher_home_paged): every read that does not need another starts at
 * once, the recorded lessons are read light, and the JSON is today's, byte for byte. Switch off: today's reads.
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
jest.mock('../../shared/services/first-touch/walk-persona', () => mockWalk, { virtual: true });
jest.mock('../../shared/services/first-touch/one-door.service', () => ({}));
jest.mock('../../shared/services/first-touch/optional-modules', () => ({}));

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
const PHONE = '923000000931';
const DAY = 86400000;

let srv;
let R; // the router module of the last boot
const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/th${p}`;
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
  await new Promise((r) => { srv = app.listen(0, r); });
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
function getJson(p) {
  return new Promise((resolve, reject) => {
    const req = http.get(url(p), { headers: H(), agent: false }, (res) => {
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

describe('switch ON: the same answer, in a few round trips', () => {
  test('a long history (52 recorded lessons + 128 quizzes): 4 round trips (the line: at most 6), against 15 today', async () => {
    // a cold process: the switches' 30 s caches and the class report's 60 s memo empty (a first open, or one a minute later)
    await boot({ paged: null });
    const off = await Fx.measure(() => home());
    await boot();
    const on = await Fx.measure(() => home());
    expect(off.value.status).toBe(200);
    expect(on.value.status).toBe(200);
    // the base's count, pinned (wave list in the failure message)
    expect({ waves: off.waves, list: off.list }).toEqual({ waves: 15, list: off.list });
    // pinned: a change that adds a serial read to the answer turns this red (the line is ≤ 6)
    expect({ waves: on.waves, list: on.list }).toEqual({ waves: 4, list: on.list });
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

  test.each([
    ['52 recorded lessons + 128 quizzes', {}],
    ['180 rows', { sessions: 100, quizzes: 120, quizzed: 40 }],
    ['a short history', { sessions: 3, quizzes: 2, quizzed: 1 }],
    ['no lessons at all', { sessions: 0, quizzes: 0, quizzed: 0 }],
  ])('%s: the JSON is today\'s, byte for byte', async (_, opts) => {
    await boot(opts);
    const on = await home();
    await boot({ ...opts, paged: null });
    const off = await home();
    expect(on.status).toBe(200);
    expect(on.text).toBe(off.text);
  });

  test('the walk-through persona\'s view of the lists: the same answer as today\'s', async () => {
    mockWalk.forHome = async (phone, lists) => (phone === PHONE ? { ...lists, lessons: lists.lessons.filter((r) => r.kind !== 'session') } : lists);
    await boot();
    const on = await home();
    await boot({ paged: null });
    const off = await home();
    expect(on.body.timeline.filter((r) => r.kind === 'coach')).toEqual([]);
    expect(on.text).toBe(off.text);
  });

  test('reads: never more requests than today (a short history), fewer for a long one', async () => {
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

  test('a forged, garbled or expired token: today\'s refusal', async () => {
    for (const t of ['nope', `${tokenAt().slice(0, -3)}abc`, tokenAt(Fx.NOW - 2 * DAY)]) {
      await boot();
      const on = await home(t);
      await boot({ paged: null });
      const off = await home(t);
      expect([on.status, on.text]).toEqual([off.status, off.text]);
      expect([404, 410]).toContain(on.status);
    }
  });

  test('+5 d and +400 d: the same answer as today\'s', async () => {
    for (const later of [5 * DAY, 400 * DAY]) {
      await boot({ now: Fx.NOW + later });
      const on = await home(tokenAt());
      await boot({ paged: null, now: Fx.NOW + later });
      const off = await home(tokenAt());
      expect(on.status).toBe(200);
      expect(on.text).toBe(off.text);
    }
  });

  test('no log line carries a teacher id', async () => {
    await boot({ sessions: 100, quizzes: 120, quizzed: 40 });
    logToFile.mockClear(); logEvent.mockClear();
    expect((await home()).status).toBe(200);
    const lines = JSON.stringify([...logToFile.mock.calls, ...logEvent.mock.calls]);
    expect(lines).not.toContain(Fx.TEACHER.id);
  });
});

describe('switch OFF (absent, false, anything but true)', () => {
  test.each([[null], [false], ['yes'], [1]])('%p: today\'s answer byte for byte', async (paged) => {
    await boot({ paged });
    const out = await home();
    expect(out.status).toBe(200);
    if (process.env.RECORD_GOLDEN === '1' && paged === null) fs.writeFileSync(GOLDEN, out.text);
    expect(out.text).toBe(fs.readFileSync(GOLDEN, 'utf8'));
  });
});
