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
const HOST = 'quiz_teacher_home';
const PAGED = 'quiz_teacher_home_paged';
const TIMING = 'quiz_teacher_server_timing';
const SWITCHES = [HOST, PAGED, TIMING];
const TIMING_RX = /^settings;dur=\d+(\.\d)?, db;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/;
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
async function boot() {
  const app = express();
  app.use('/api/internal/th', createRouter(deps()));
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
    expect(cold.switches).toEqual([PAGED]); // today: only the quick answer's switch (cold) is read
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

  test('switch OFF: the same settings reads per request as today (home and library, cold and warm)', async () => {
    seed({ rows: [{ key: TIMING, value: 'true' }] });
    await boot();
    const counts = [];
    for (const ask of [home, home, library]) {
      const before = tableReads(fake, 'app_settings');
      const sw0 = switchReads.length;
      await ask();
      counts.push([tableReads(fake, 'app_settings') - before > 0, switchReads.slice(sw0).length]);
    }
    // cold: the home's switch + the quick answer's; warm: none; the library: none
    expect(counts.map((c) => c[1])).toEqual([2, 0, 0]);
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
