'use strict';
/**
 * The home's and the library's JSON carry a Server-Timing header (settings, db, total; ms) when app_settings
 * `quiz_teacher_server_timing` is JSON true. That switch never costs a settings read of its own: it rides the home's own
 * switch read (`quiz_teacher_home`), and a cold reading of it is OFF until that read runs again. OFF (absent, false, the
 * string "true", 1, "yes", a failed read): headers and body byte-identical to the base's
 * (tests/first-touch/__goldens__/teacher-home-server-timing-off.json, RECORDED ON THE BASE) and the same settings reads.
 * Same harness as teacher-home.routes.test.js: the in-memory Supabase, /quiz's list stood in for, real fetch.
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
jest.mock('../../shared/services/first-touch/walk-persona', () => ({}));
jest.mock('../../shared/services/first-touch/one-door.service', () => ({}));
jest.mock('../../shared/services/first-touch/optional-modules', () => ({}));
jest.mock('../../shared/routes/story-teacher-internal.routes', () => ({}));
jest.mock('../../shared/services/quiz/story-teacher.service', () => ({}));

const fs = require('fs');
const path = require('path');
const express = require('express');
const supabase = require('../../shared/config/supabase');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Gate = require('../../shared/services/quiz/teacher-report-gate');
const List = require('../../shared/services/quiz/transcript-quiz-list.service');
const Bank = require('../../shared/services/first-touch/maker.bank');
const Flags = require('../../shared/services/first-touch/teacher-home.flags');
const HomeToken = require('../../shared/services/first-touch/teacher-home.token');
const { createRouter } = require('../../shared/services/first-touch/teacher-home.routes');
const { seedMaker, TEACHER, tableReads } = require('./maker-fixture');

const GOLDEN = path.join(__dirname, '__goldens__', 'teacher-home-server-timing-off.json');
const GOLDEN_RICH = path.join(__dirname, '__goldens__', 'teacher-home-server-timing-off-rich.json');
const HOST = 'quiz_teacher_home';
const PAGED = 'quiz_teacher_home_paged';
const TIMING = 'quiz_teacher_server_timing';
const SWITCHES = [HOST, PAGED, TIMING];
const TIMING_RX = /^settings;dur=\d+, db;dur=\d+, total;dur=\d+$/; // whole ms
// not compared: set per request by the server, or derived from the body (compared on its own)
const VOLATILE = ['date', 'etag', 'connection', 'keep-alive'];
const tokenFor = () => HomeToken.signTeacherHome({ uid: TEACHER.id, lang: 'en', via: 'go' });

let srv;
let fake;
let switchReads; // app_settings reads naming one of the home's switches (by .eq or .in)
const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/th${p}`;
const H = () => ({ 'x-api-key': process.env.INTERNAL_API_KEY });

/** The fake seeded: the home on (`host`: its value, null → no row), `rows` app_settings rows; every switch cache cold. */
function seed({ host = true, rows = [] } = {}) {
  fake = seedMaker(supabase, { on: false }); // the maker link (it carries an expiry) off: the body is the same on every run
  fake.db.app_settings = [...fake.db.app_settings, ...(host === null ? [] : [{ key: HOST, value: host }]), ...rows];
  const from0 = supabase.from;
  switchReads = [];
  supabase.from = (t) => {
    const b = from0(t);
    if (t !== 'app_settings') return b;
    const eq0 = b.eq.bind(b);
    const in0 = b.in.bind(b);
    b.eq = (k, v) => { if (SWITCHES.includes(v)) switchReads.push(v); return eq0(k, v); };
    b.in = (k, vs) => { if ((vs || []).some((v) => SWITCHES.includes(v))) switchReads.push(vs.join('+')); return in0(k, vs); };
    return b;
  };
  coldCaches();
}
function coldCaches() { Flags.reset(); IdFlags._resetCache(); HubFlags._resetCache(); Gate._resetCache(); Bank._resetCache(); }
const deps = () => ({ List: { ...List, loadLessonPage: jest.fn(async () => ({ sessions: [], quizzes: [], counts: {}, lessons: [] })) } });
async function boot(d = deps()) {
  const app = express();
  app.use('/api/internal/th', createRouter(d));
  await new Promise((r) => { srv = app.listen(0, r); });
}
async function get(p) {
  const res = await fetch(url(p), { headers: H() });
  const headers = Object.fromEntries(res.headers.entries());
  return { status: res.status, headers, text: await res.text() };
}
const stable = (h) => { const o = { ...h }; VOLATILE.forEach((k) => delete o[k]); return o; };
const home = () => get(`/api/th/home?t=${tokenFor()}&g=2`);
const library = () => get(`/api/th/library?t=${tokenFor()}&g=2`);
const durs = (h) => Object.fromEntries(h.split(', ').map((p) => { const [n, d] = p.split(';dur='); return [n, Number(d)]; }));
/** A builder whose every read of app_settings answers an error. */
const down = () => {
  const b = { then: (res, rej) => Promise.resolve({ data: null, error: { message: 'settings down' } }).then(res, rej) };
  ['select', 'eq', 'in', 'maybeSingle', 'single', 'limit', 'order'].forEach((m) => { b[m] = () => b; });
  return b;
};

// one home and one library answer before any row, so lazily loaded modules never add a read to the file's first row
beforeAll(async () => { seed(); await boot(); await home(); await library(); await new Promise((r) => srv.close(r)); srv = null; });
afterEach(async () => { jest.restoreAllMocks(); await new Promise((r) => (srv ? srv.close(r) : r())); srv = null; });

describe('switch ON (JSON true)', () => {
  test.each([['home', home], ['library', library]])('%s: Server-Timing settings, db, total; the body is the OFF body, byte for byte', async (_, ask) => {
    seed({ rows: [{ key: TIMING, value: true }] });
    await boot();
    const on = await ask();
    expect(on.status).toBe(200);
    expect(on.headers['server-timing']).toMatch(TIMING_RX);
    const d = durs(on.headers['server-timing']);
    expect(d.total).toBeGreaterThanOrEqual(d.db);
    expect(d.total).toBeGreaterThanOrEqual(d.settings);
    fake.db.app_settings = fake.db.app_settings.filter((r) => r.key !== TIMING);
    coldCaches();
    const off = await ask();
    expect(off.headers['server-timing']).toBeUndefined();
    expect(on.text).toBe(off.text);
  });

  test('the quick home (quiz_teacher_home_paged true) carries it too; the same body as OFF', async () => {
    seed({ rows: [{ key: PAGED, value: true }, { key: TIMING, value: true }] });
    await boot();
    const on = await home();
    expect(on.status).toBe(200);
    expect(on.headers['server-timing']).toMatch(TIMING_RX);
    fake.db.app_settings = fake.db.app_settings.filter((r) => r.key !== TIMING);
    coldCaches();
    const off = await home();
    expect(off.headers['server-timing']).toBeUndefined();
    expect(on.text).toBe(off.text);
  });

  test('a refusal (a forged token) carries none', async () => {
    seed({ rows: [{ key: TIMING, value: true }] });
    await boot();
    const res = await get(`/api/th/home?t=${tokenFor().slice(0, -3)}abc`);
    expect(res.status).toBe(404);
    expect(res.headers['server-timing']).toBeUndefined();
  });
});

describe('switch ON: each phase holds its own time (a slow read lands in its phase, never in the other)', () => {
  const SLOW = 400; // ms; well above the in-memory fixture's own time for either phase
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** The video bank (a data-phase read on the full home, the quick home and the library) answering SLOW ms late. */
  const slowBank = () => ({ ...deps(), Bank: { ...Bank, chipTree: async (...a) => { await sleep(SLOW); return Bank.chipTree(...a); } } });
  /** The quick answer's switch read (the page switches' one `.in` read, a settings wait the home's route awaits) answering SLOW ms late. */
  function slowPagedRead() {
    const from1 = supabase.from;
    supabase.from = (t) => {
      const b = from1(t);
      if (t !== 'app_settings') return b;
      const in1 = b.in.bind(b);
      b.in = (k, vs) => ([].concat(vs || []).includes(PAGED) ? { then: (ok, no) => sleep(SLOW).then(() => in1(k, vs)).then(ok, no) } : in1(k, vs));
      return b;
    };
  }
  const phases = (res) => { expect(res.status).toBe(200); expect(res.headers['server-timing']).toMatch(TIMING_RX); return durs(res.headers['server-timing']); };

  test.each([
    ['home (full answer)', [], home],
    ['home (quick answer)', [{ key: PAGED, value: true }], home],
    ['library', [], library],
  ])('%s: a slow data read is counted in db, not in settings', async (_, rows, ask) => {
    seed({ rows: [...rows, { key: TIMING, value: true }] });
    await boot(slowBank());
    const d = phases(await ask());
    expect(d.db).toBeGreaterThanOrEqual(SLOW - 20);
    expect(d.settings).toBeLessThan(SLOW - 20);
    expect(d.settings + d.db).toBeLessThanOrEqual(d.total + 2); // disjoint phases inside the whole (whole-ms rounding)
  });

  test.each([
    ['home (full answer)', []],
    ['home (quick answer)', [{ key: PAGED, value: true }]],
  ])('%s: a slow quick-answer switch read is counted in settings, not in db', async (_, rows) => {
    seed({ rows: [...rows, { key: TIMING, value: true }] });
    slowPagedRead();
    await boot();
    const d = phases(await home());
    expect(d.settings).toBeGreaterThanOrEqual(SLOW - 20);
    expect(d.db).toBeLessThan(SLOW - 20);
    expect(d.settings + d.db).toBeLessThanOrEqual(d.total + 2);
  });
});

describe('switch OFF: today\'s headers and body (golden recorded on the base)', () => {
  test('absent row: home and library, every header but the volatile ones, and the body', async () => {
    seed();
    await boot();
    const out = {};
    for (const [name, ask] of [['home', home], ['library', library]]) {
      const res = await ask();
      expect(res.status).toBe(200);
      out[name] = { headers: stable(res.headers), body: res.text };
    }
    if (process.env.TEACHER_HOME_RECORD === '1') fs.writeFileSync(GOLDEN, `${JSON.stringify(out, null, 2)}\n`);
    expect(out).toEqual(JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
  });

  test.each([['the string "true"', 'true'], ['false', false], ['1', 1], ['"yes"', 'yes'], ['{}', {}]])('%s → no header, the golden answer', async (_, value) => {
    seed({ rows: [{ key: TIMING, value }] });
    await boot();
    const g = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    for (const [name, ask] of [['home', home], ['library', library]]) {
      const res = await ask();
      expect(res.headers['server-timing']).toBeUndefined();
      expect({ headers: stable(res.headers), body: res.text }).toEqual(g[name]);
    }
  });
});

describe('switch OFF, a home with a sent quiz, its plays and its code (golden recorded on the base)', () => {
  const QUIZ = 'c0000000-0000-4000-8000-0000000000a1';
  const CODE = 'f0000000-0000-4000-8000-0000000000a1';
  const SESSION = 'e0000000-0000-4000-8000-0000000000c1';
  const AT = '2026-01-05T08:00:00.000Z';
  /** One lesson with its sent quiz (played by 2 of 5) and a live share code; the class report and its gate stood in for. */
  function richDeps() {
    fake.db.quizzes.push({
      id: QUIZ, teacher_id: TEACHER.id, quiz_source: 'transcript', status: 'sent', topic: 'Photosynthesis', subject: 'Science',
      coaching_session_id: SESSION, created_at: AT,
      meta: { student_message: 'Class, play this quiz: https://portal.example/q/ABCDEF', share_code_id: CODE, share_code: 'ABCDEF' },
    });
    fake.db.quiz_share_codes.push({ id: CODE, code: 'ABCDEF', quiz_id: QUIZ, teacher_user_id: TEACHER.id, active: true, expires_at: '2099-01-01T00:00:00.000Z', created_at: AT, invited_by_student_id: null });
    const quiz = fake.db.quizzes.find((q) => q.id === QUIZ);
    return {
      List: { ...List, loadLessonPage: jest.fn(async () => ({ sessions: [{ id: SESSION, created_at: AT, transcript_text: 'x'.repeat(500), analysis_data: { topic: 'Photosynthesis' } }], quizzes: [quiz], counts: {}, lessons: [] })) },
      Report: { ...require('../../shared/services/quiz/teacher-report.data'), classReport: jest.fn(async () => ({ quizzes: [{ id: QUIZ, played: 2, of: 5, date: AT, topic: 'Photosynthesis', source: 'transcript' }] })) },
      Gate: { ...Gate, teacherReportOn: jest.fn(async () => true), reportUrls: ({ quizId }) => ({ live: `/r/${quizId}/live`, remind: `/r/${quizId}/remind` }) },
    };
  }
  test('absent row and the string "true": home and library, every header but the volatile ones, and the body', async () => {
    const out = {};
    for (const [label, rows] of [['absent', []], ['string', [{ key: TIMING, value: 'true' }]]]) {
      if (srv) { await new Promise((r) => srv.close(r)); srv = null; }
      seed({ rows });
      await boot(richDeps());
      for (const [name, ask] of [['home', home], ['library', library]]) {
        const res = await ask();
        expect(res.status).toBe(200);
        expect(res.headers['server-timing']).toBeUndefined();
        out[`${label}_${name}`] = { headers: stable(res.headers), body: res.text };
      }
    }
    expect(JSON.parse(out.absent_home.body).timeline.length).toBeGreaterThan(0); // a rich fixture, not an empty home
    expect(out.string_home).toEqual(out.absent_home);
    expect(out.string_library).toEqual(out.absent_library);
    const g = { home: out.absent_home, library: out.absent_library };
    if (process.env.TEACHER_HOME_RECORD === '1') fs.writeFileSync(GOLDEN_RICH, `${JSON.stringify(g, null, 2)}\n`);
    expect(g).toEqual(JSON.parse(fs.readFileSync(GOLDEN_RICH, 'utf8')));
  });
});

describe('the timing switch rides the home switch\'s read (never a read of its own)', () => {
  /** app_settings reads of one home request after the home's switch was read by another caller (host warm). */
  async function warmHostRequest({ riderCold, rows = [] }) {
    seed({ rows });
    await boot();
    coldCaches();
    await Flags.on();
    if (riderCold && typeof Flags.resetTiming === 'function') Flags.resetTiming();
    const before = tableReads(fake, 'app_settings');
    const sw0 = switchReads.length;
    const res = await home();
    expect(res.status).toBe(200);
    return { reads: tableReads(fake, 'app_settings') - before, switches: switchReads.slice(sw0), res };
  }

  test('host warm, rider cold: the same settings reads as today; the rider is OFF until the host\'s next read', async () => {
    const today = await warmHostRequest({ riderCold: false });
    await new Promise((r) => srv.close(r)); srv = null;
    const cold = await warmHostRequest({ riderCold: true, rows: [{ key: TIMING, value: true }] });
    expect(cold.reads).toBe(today.reads);
    expect(cold.switches).toEqual([Flags.PAGE_KEYS.join('+')]); // today: only the quick answer's switch read (cold), the page switches' one read
    expect(cold.res.headers['server-timing']).toBeUndefined();
    expect(typeof Flags.resetTiming).toBe('function');
  });

  test('rider ON, every cache cold: settings reads ≤ today\'s; the header is there', async () => {
    seed();
    await boot();
    const base = tableReads(fake, 'app_settings');
    const offRes = await home();
    const todayReads = tableReads(fake, 'app_settings') - base;
    await new Promise((r) => srv.close(r)); srv = null;
    seed({ rows: [{ key: TIMING, value: true }] });
    await boot();
    const before = tableReads(fake, 'app_settings');
    const sw0 = switchReads.length;
    const res = await home();
    expect(offRes.status).toBe(200);
    expect(tableReads(fake, 'app_settings') - before).toBeLessThanOrEqual(todayReads);
    expect(switchReads.slice(sw0).filter((k) => k === TIMING)).toEqual([]); // never read alone
    expect(switchReads.slice(sw0)).toHaveLength(2); // the home's switch (with the rider) + the quick answer's
    expect(res.headers['server-timing']).toMatch(TIMING_RX);
  });

  // today's app_settings reads per request (the base's product, the same fixture): every switch and flag cache cold, then warm
  // (home cold 5: the hub switches' read is shared by its concurrent callers, web-quiz-hub-flags flags(), one read not two)
  const TODAY = { homeCold: 5, homeWarm: 0, libraryWarm: 0, libraryCold: 1 };
  test.each([['absent', []], ['the string "true"', [{ key: TIMING, value: 'true' }]], ['false', [{ key: TIMING, value: false }]]])('switch OFF (%s): today\'s settings reads per request, exactly (home cold / warm, library warm, library cold)', async (_, rows) => {
    const reads = async (ask) => { const before = tableReads(fake, 'app_settings'); await ask(); return tableReads(fake, 'app_settings') - before; };
    seed({ rows });
    await boot();
    const homeCold = await reads(home);
    const homeWarm = await reads(home);
    const libraryWarm = await reads(library);
    await new Promise((r) => srv.close(r)); srv = null;
    seed({ rows }); // a fresh fixture and cold caches: the library first
    await boot();
    const libraryCold = await reads(library);
    expect({ homeCold, homeWarm, libraryWarm, libraryCold }).toEqual(TODAY);
  });

  // the first home of a fresh process (every deploy restarts one): the file's warm-up above hides the reads of modules
  // loaded on first use, so this row loads every module new and pins that first answer's settings reads too
  // (9 with the named-item switch's own first read, 10 with the story-counts switch's, 9 with the hub switches' read shared
  // by its concurrent callers)
  const FIRST_BOOT = { homeFirst: 9 };
  test.each([['absent', []], ['the string "true"', [{ key: TIMING, value: 'true' }]], ['false', [{ key: TIMING, value: false }]]])('switch OFF (%s): the first home of a fresh process, today\'s settings reads exactly', async (_, rows) => {
    let homeFirst;
    await jest.isolateModulesAsync(async () => {
      const sb = require('../../shared/config/supabase');
      const fx = require('./maker-fixture');
      const f = fx.seedMaker(sb, { on: false });
      f.db.app_settings = [...f.db.app_settings, { key: HOST, value: true }, ...rows];
      const L = require('../../shared/services/quiz/transcript-quiz-list.service');
      const d = { List: { ...L, loadLessonPage: jest.fn(async () => ({ sessions: [], quizzes: [], counts: {}, lessons: [] })) } };
      const app = express();
      app.use('/api/internal/th', require('../../shared/services/first-touch/teacher-home.routes').createRouter(d));
      await new Promise((r) => { srv = app.listen(0, r); });
      const before = fx.tableReads(f, 'app_settings');
      const res = await home();
      expect(res.status).toBe(200);
      homeFirst = fx.tableReads(f, 'app_settings') - before;
    });
    expect({ homeFirst }).toEqual(FIRST_BOOT);
  });
});

describe('a failed read of the home\'s switch', () => {
  test('OFF as today (404 {off:true}), no header, even with the timing row on', async () => {
    seed({ rows: [{ key: TIMING, value: true }] });
    const from0 = supabase.from;
    supabase.from = (t) => (t === 'app_settings' ? down() : from0(t));
    await boot();
    for (const ask of [home, library]) {
      const res = await ask();
      expect(res.status).toBe(404);
      expect(JSON.parse(res.text)).toEqual({ off: true });
      expect(res.headers['server-timing']).toBeUndefined();
    }
  });
});

describe('the home\'s own decision is today\'s for every value (its read now brings two rows)', () => {
  const FAILED = Symbol('failed');
  // today's answers (the base's Flags.on): JSON true and the string "true" are ON
  const HOSTS = [['absent', undefined, false], ['false', false, false], ['true', true, true], ['the string "true"', 'true', true], ['"yes"', 'yes', false], ['a failed read', FAILED, false]];
  const CASES = [];
  HOSTS.forEach(([name, value, want]) => {
    [['timing row present', true], ['timing row absent', false]].forEach(([tName, withTiming]) => {
      [['host row first', false], ['timing row first', true]].forEach(([oName, timingFirst]) => CASES.push([`${name}, ${tName}, ${oName}`, value, withTiming, timingFirst, want]));
    });
  });
  test.each(CASES)('%s', async (_, value, withTiming, timingFirst, want) => {
    seed({ host: null });
    const hostRow = value === undefined || value === FAILED ? [] : [{ key: HOST, value }];
    const timingRow = withTiming ? [{ key: TIMING, value: true }] : [];
    fake.db.app_settings = [...fake.db.app_settings, ...(timingFirst ? [...timingRow, ...hostRow] : [...hostRow, ...timingRow])];
    if (value === FAILED) { const from0 = supabase.from; supabase.from = (t) => (t === 'app_settings' ? down() : from0(t)); }
    const before = tableReads(fake, 'app_settings');
    expect(await Flags.on()).toBe(want);
    if (value !== FAILED) expect(tableReads(fake, 'app_settings') - before).toBe(1); // one read, as today
    expect(await Flags.on()).toBe(want); // the cached reading agrees
  });

  test.each([[true, true], ['true', false], [false, false], [1, false], ['yes', false], [{}, false], [undefined, false]])('the timing reading for %p, primed by the home\'s read: %p', async (value, want) => {
    seed({ rows: value === undefined ? [] : [{ key: TIMING, value }] });
    expect(typeof Flags.timing).toBe('function');
    expect(await Flags.timing()).toBe(false); // cold: OFF, and no read
    expect(tableReads(fake, 'app_settings')).toBe(0);
    await Flags.on();
    expect(await Flags.timing()).toBe(want);
    expect(tableReads(fake, 'app_settings')).toBe(1);
    expect(Flags.TIMING_KEY).toBe(TIMING);
    Flags.reset();
    expect(await Flags.timing()).toBe(false);
  });
});
