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
// a gone teacher's refusal: today's reads vs the quick answer's (its reads start before the user is known)
const OFF_GONE_READS = 3;
const ON_GONE_READS = 33; // +1: the class report's fold-by-child switch read (in parallel with its sessions, no new wave)

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
  test('a long history (52 recorded lessons + 128 quizzes): 5 round trips cold, 4 warm (the line: at most 6), against 15 today', async () => {
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
    // pinned: a change that adds a serial read to the answer turns this red (the line is ≤ 6). Cold: the quick answer's
    // switch is read only once the home's own switch answered (one wave on a cold cache, never on today's 404 path)
    expect({ waves: on.waves, list: on.list }).toEqual({ waves: 5, list: on.list });
    // warm (the same teacher 20 s later: the switches' 30 s caches full): 4 at most
    jest.setSystemTime(Fx.NOW + 20000);
    const warm = await Fx.measure(() => home(tokenAt(Fx.NOW + 20000)));
    expect(warm.value.status).toBe(200);
    expect({ waves: warm.waves <= 4, list: warm.list }).toEqual({ waves: true, list: warm.list });
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
  let todayReads = null; // the absent row's read count: every OFF value takes today's reads, not only today's bytes
  test.each([[null], [false], ['yes'], [1], ['true'], ['"true"'], [' TRUE '], [{ enabled: true }]])('%p: today\'s answer byte for byte, by today\'s reads', async (paged) => {
    await boot({ paged });
    const m = await Fx.measure(() => home());
    const out = m.value;
    expect(out.status).toBe(200);
    if (paged === null) todayReads = m.reads;
    expect(m.reads).toBe(todayReads);
    if (process.env.TEACHER_HOME_RECORD === '1' && paged === null) fs.writeFileSync(GOLDEN, out.text);
    expect(out.text).toBe(fs.readFileSync(GOLDEN, 'utf8'));
  });
});

describe('switch OFF (absent): today\'s reads and round trips, pinned', () => {
  // Recorded with the key absent. The plain base gives long 45 / 17, small 44 / 17, big 45 / 17 and the shell 1 / 1.
  // Reads +1 everywhere: the quick answer's own switch read. It starts beside the user read, so it adds no round trip.
  // Waves -2 on the home: the class report's fold switch is read beside its sessions (base wave 10), and the report
  // gate starts with the lesson reads (base wave 13). The shell +1 wave: it must know the switch before it serves.
  // An extra serial or unconditional read on today's path turns this red (wave list in the failure message).
  // The send-again check in two halves: long and big ask the lessons' quizzes and their codes as their own pair (+2 reads);
  // small makes the same reads, its lessons' half starting as soon as the lessons are in (2 round trips sooner).
  // + the named-item switch's own read on the home (+1), and the named-item + early-pick reads on the shell (+2), each
  // beside a read already in flight (no new round trip)
  const PINS = { long: { reads: 49, waves: 15 }, small: { reads: 46, waves: 13 }, big: { reads: 49, waves: 15 }, shell: { reads: 4, waves: 2 } };
  test.each([
    ['long', {}],
    ['small', { sessions: 3, quizzes: 2, quizzed: 1 }],
    ['big', { sessions: 100, quizzes: 120, quizzed: 40 }],
  ])('the home, %s history', async (name, opts) => {
    await boot({ ...opts, paged: null });
    const m = await Fx.measure(() => home());
    expect(m.value.status).toBe(200);
    expect({ reads: m.reads, waves: m.waves, list: m.list }).toEqual({ ...PINS[name], list: m.list });
  });
  test('the shell', async () => {
    await boot({ paged: null });
    const m = await Fx.measure(() => getJson(`/quiz/teacher/${tokenAt()}`));
    expect(m.value.status).toBe(200);
    expect({ reads: m.reads, waves: m.waves, list: m.list }).toEqual({ ...PINS.shell, list: m.list });
  });
});

/** The next app_settings read of `key` fails (the database answers an error). */
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
/** Counts the app_settings reads of `key` from now on (by .eq, or among the keys of an .in read). → { n } */
function watchSetting(key) {
  const seen = { n: 0 };
  const sb = require('../../shared/config/supabase');
  const from0 = sb.from;
  sb.from = (t) => {
    const b = from0(t);
    if (t !== 'app_settings') return b;
    const eq0 = b.eq.bind(b);
    const in0 = b.in.bind(b);
    b.eq = (k, v) => { if (v === key) seen.n += 1; return eq0(k, v); };
    b.in = (k, vs) => { if ((vs || []).includes(key)) seen.n += 1; return in0(k, vs); };
    return b;
  };
  return seen;
}

describe('the quick answer\'s switch, read', () => {
  test('a failed read of the switch: today\'s answer byte for byte', async () => {
    await boot({ paged: true });
    failSetting('quiz_teacher_home_paged');
    const out = await home();
    expect(out.status).toBe(200);
    expect(out.text).toBe(fs.readFileSync(GOLDEN, 'utf8'));
  });

  test('never while the home itself is off (today\'s 404 reads one switch), never on another route', async () => {
    const fake = await boot({ paged: true });
    fake.db.app_settings = fake.db.app_settings.filter((r) => r.key !== 'quiz_teacher_home');
    const off = watchSetting('quiz_teacher_home_paged');
    const home0 = watchSetting('quiz_teacher_home');
    expect((await home()).status).toBe(404);
    expect({ paged: off.n, home: home0.n }).toEqual({ paged: 0, home: 1 });
    await boot({ paged: true });
    const lib = watchSetting('quiz_teacher_home_paged');
    await getJson(`/api/th/library?t=${tokenAt()}&g=3`);
    expect(lib.n).toBe(0);
    const homeOn = watchSetting('quiz_teacher_home_paged');
    await home();
    expect(homeOn.n).toBe(1); // the counter counts: the home itself asks
  });
});

describe('a failed user read with the switch ON', () => {
  test('the route\'s refusal (503), and no promise left rejecting unheard', async () => {
    const seen = [];
    const onRej = (e) => seen.push(e);
    process.on('unhandledRejection', onRej);
    try {
      await boot({ paged: true });
      const sb = require('../../shared/config/supabase');
      const from0 = sb.from;
      sb.from = (t) => {
        const b = from0(t);
        if (t !== 'users') return b;
        const eq0 = b.eq.bind(b);
        b.eq = (k, v) => { const r = eq0(k, v); r.maybeSingle = async () => ({ data: null, error: { message: 'users down' } }); return r; };
        return b;
      };
      const out = await home();
      expect(out.status).toBe(503);
      for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));
      expect(seen.map((e) => String(e && e.message))).toEqual([]);
    } finally { process.removeListener('unhandledRejection', onRej); }
  });
});

describe('the video bank\'s load (maker.bank chipTree)', () => {
  const bankWaves = async (opts) => {
    await boot({ paged: true });
    const Bank = require('../../shared/services/first-touch/maker.bank');
    Bank._resetCache();
    return Fx.measure(() => Bank.chipTree(Date.now(), opts));
  };
  test('today\'s call (the maker page, the home with the switch OFF): the two reads one after the other, as today', async () => {
    const m = await bankWaves(undefined);
    expect(m.list.split('\n').filter((l) => /quizzes|student_videos/.test(l)).map((l) => l.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim()))
      .toEqual(['wave 1: quizzes', 'wave 2: student_videos']);
  });
  test('the quick answer\'s call: both in one round trip, and callers meanwhile share the one load', async () => {
    const m = await bankWaves({ quick: true });
    expect(m.list).toMatch(/wave 1: (quizzes.*student_videos|student_videos.*quizzes)/);
    const Bank = require('../../shared/services/first-touch/maker.bank');
    Bank._resetCache();
    const n = await Fx.measure(() => Promise.all([Bank.chipTree(Date.now(), { quick: true }), Bank.chipTree(Date.now(), { quick: true })]));
    expect(n.reads).toBe(m.reads);
  });
});

describe('the page (its shell)', () => {
  const shell = (t = tokenAt()) => getJson(`/quiz/teacher/${t}`);
  test('switch ON: the quick answer\'s page (the 15 s wait and «Try again»); OFF, false, "true" or a failed read: today\'s page', async () => {
    const Page = () => require('../../shared/services/first-touch/teacher-home.page');
    await boot({ paged: true });
    const on = await shell();
    expect(on.status).toBe(200);
    expect(on.text).toContain('id="th-retry"');
    expect(on.text).toContain(Page().SCRIPT_PAGED);
    for (const paged of [null, false, 'true']) {
      await boot({ paged });
      const off = await shell();
      expect(off.text).not.toContain('id="th-retry"');
      expect(off.text).toContain(`<script>${Page().SCRIPT}</script>`);
    }
    await boot({ paged: true });
    failSetting('quiz_teacher_home_paged');
    expect((await shell()).text).not.toContain('id="th-retry"');
  });
});

describe('a token whose teacher is gone (users row absent)', () => {
  test('today\'s refusal both ways; ON starts its reads before the user is known: the cost, pinned', async () => {
    const run = async (paged) => {
      const fake = await boot({ paged });
      fake.db.users = [];
      // every read the request started, counted once they have all settled (the ON reads keep running after the 404)
      const settled = async (r) => {
        let n = -1;
        while (n !== Fx.S.reads.length) { n = Fx.S.reads.length; await new Promise((ok) => setTimeout(ok, Fx.READ_MS * 4)); }
        return r;
      };
      const m = await Fx.measure(() => home().then(settled));
      return { status: m.value.status, body: m.value.text, reads: m.reads, waves: m.waves };
    };
    const off = await run(null);
    const on = await run(true);
    expect(on.status).toBe(404);
    expect(on.body).toBe(off.body);
    expect({ off: off.reads, on: on.reads }).toEqual({ off: OFF_GONE_READS, on: ON_GONE_READS });
  });
});
