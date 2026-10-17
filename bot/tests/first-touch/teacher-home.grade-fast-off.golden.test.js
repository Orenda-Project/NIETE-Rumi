'use strict';
/**
 * The grade-fast switch (app_settings `quiz_teacher_home_grade_fast`) OFF is today, byte for byte: with the key absent,
 * `false`, the string "true", the JSON string "\"true\"", 1, {} or a failed read (only a JSON true is on), the page
 * shell (HTML + CSP header), the home's JSON and the library's JSON are compared with
 * tests/first-touch/__goldens__/teacher-home-grade-fast-off.json, RECORDED ON THE BASE by running this same file there
 * with TEACHER_HOME_RECORD=1 — each with the quick answer's switch (quiz_teacher_home_paged) absent and ON. The settings
 * reads and the other table reads per request are pinned in the same file (one request each, every switch cache
 * emptied first).
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
process.env.PORTAL_URL = 'https://portal.example';
process.env.WHATSAPP_BOT_NUMBER = ['1555', '000', '1111'].join('');
process.env.WEB_QUIZ_KID_KEY = 'unit-kid-key-not-a-secret-abcdefghij';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));
jest.mock('../../shared/services/first-touch/walk-persona', () => ({ forHome: async (phone, lists) => lists }));
jest.mock('../../shared/services/first-touch/one-door.service', () => ({}));
jest.mock('../../shared/services/first-touch/optional-modules', () => ({}));

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
const { seedMaker, TEACHER } = require('./maker-fixture');

const GOLDEN = path.join(__dirname, '__goldens__', 'teacher-home-grade-fast-off.json');
const RECORD = process.env.TEACHER_HOME_RECORD === '1';
const FAST = 'quiz_teacher_home_grade_fast';
const PAGED = 'quiz_teacher_home_paged';
// recording on the base: only the OFF test runs (the base has no fast switch to test)
const onDescribe = RECORD ? describe.skip : describe;

let srv;
let fake;
async function boot() {
  const app = express();
  app.use('/api/internal/th', createRouter({ List: { ...List, loadLessonPage: async () => ({ sessions: [], quizzes: [], counts: {}, lessons: [] }) } }));
  await new Promise((r) => { srv = app.listen(0, r); });
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));
const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/th${p}`;

/**
 * A fresh store with the home on, the quick answer's switch `paged` (true → a JSON true row) and the fast switch in
 * `state`, every switch cache emptied. `state.fail`: the read of the quick answer's / fast switch's row fails.
 */
function seed(state, paged) {
  fake = seedMaker(supabase, { on: true });
  fake.db.app_settings = [...fake.db.app_settings, { key: 'quiz_teacher_home', value: true },
    ...(paged ? [{ key: PAGED, value: true }] : []), ...(state.absent ? [] : [{ key: FAST, value: state.value }])];
  Flags.reset(); IdFlags._resetCache(); HubFlags._resetCache(); Gate._resetCache(); Bank._resetCache();
  if (state.fail) failSwitchRead();
}
/** Every app_settings read that asks for the quick answer's or the fast switch's row answers an error (.eq or .in). */
function failSwitchRead() {
  const from0 = supabase.from;
  const hit = (v) => [].concat(v).some((k) => k === PAGED || k === FAST);
  const down = { data: null, error: { message: 'settings down' } };
  supabase.from = (t) => {
    const b = from0(t);
    if (t !== 'app_settings') return b;
    const eq0 = b.eq.bind(b);
    const in0 = b.in.bind(b);
    b.eq = (k, v) => { const r = eq0(k, v); if (hit(v)) r.maybeSingle = async () => down; return r; };
    b.in = (k, v) => { const r = in0(k, v); return hit(v) ? { then: (ok, no) => Promise.resolve(down).then(ok, no) } : r; };
    return b;
  };
}
const STATES = {
  absent: { absent: true }, false: { value: false }, 'string true': { value: 'true' }, 'json string true': { value: '"true"' },
  1: { value: 1 }, '{}': { value: {} }, 'failed read': { value: true, fail: true },
};
const PAGEDS = { 'paged absent': false, 'paged on': true };
const tokenFor = (lang) => HomeToken.signTeacherHome({ uid: TEACHER.id, lang, via: 'go' });
// what is signed with the clock or minted at random (the page's token, the maker link, a share code) is masked; the rest as is
const mask = (s, t) => String(s).split(t).join('<T>').split(encodeURIComponent(t)).join('<T>')
  .replace(/\/m\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}/g, '/m/<M>').replace(/QUIZ-[A-Z0-9]{6}/g, 'QUIZ-<C>')
  .replace(/"c":"[0-9a-f-]{36}"/g, '"c":"<id>"'); // a share code minted at render: random code, random id
const digest = (s) => crypto.createHash('sha256').update(s).digest('base64');

const REQUESTS = [
  ['shell en', 'en', (t) => `/quiz/teacher/${t}`],
  ['shell ur', 'ur', (t) => `/quiz/teacher/${t}`],
  ['shell bi ?lang=en', 'bi', (t) => `/quiz/teacher/${t}?lang=en`],
  ['home en g=4', 'en', (t) => `/api/th/home?t=${t}&g=4`],
  ['home ur', 'ur', (t) => `/api/th/home?t=${t}`],
  ['library en g=3', 'en', (t) => `/api/th/library?t=${t}&g=3`],
  ['library ur g=2', 'ur', (t) => `/api/th/library?t=${t}&g=2`],
];

async function once(state, paged, lang, pathOf) {
  seed(state, paged);
  await boot();
  const t = tokenFor(lang);
  fake.calls.length = 0;
  const res = await fetch(url(pathOf(t)), { headers: { 'x-api-key': process.env.INTERNAL_API_KEY } });
  const body = mask(await res.text(), t);
  const settingsReads = fake.calls.filter((c) => c.table === 'app_settings').length;
  const otherReads = fake.calls.filter((c) => c.table !== 'app_settings' && c.op === 'select').length;
  const out = { status: res.status, csp: res.headers.get('content-security-policy'), body: digest(body), bytes: Buffer.byteLength(body), settingsReads, otherReads };
  await new Promise((r) => srv.close(r));
  srv = null;
  return out;
}

describe('grade-fast OFF: today, byte for byte, with today\'s read counts', () => {
  test('every state × the quick answer absent/on × every request equals the base recording', async () => {
    // one pass first, discarded: the long-lived caches of the modules around the home (bot number, other switches) are
    // warm in every state alike; the teacher home's own switch caches are emptied before every request
    for (const [, lang, pathOf] of REQUESTS) await once(STATES.absent, false, lang, pathOf);
    const got = {};
    for (const [pn, paged] of Object.entries(PAGEDS)) {
      for (const [name, state] of Object.entries(STATES)) {
        for (const [req, lang, pathOf] of REQUESTS) got[`${pn}|${name}|${req}`] = await once(state, paged, lang, pathOf);
      }
    }
    if (RECORD) {
      // the base has no fast switch: every readable state must record the same answer, or the recording is not of today
      Object.keys(PAGEDS).forEach((pn) => Object.keys(STATES).filter((n) => !STATES[n].fail).forEach((n) => REQUESTS.forEach(([req]) => {
        expect(got[`${pn}|${n}|${req}`]).toEqual(got[`${pn}|absent|${req}`]);
      })));
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
      return;
    }
    expect(got).toEqual(JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
  });
});

onDescribe('grade-fast ON (a JSON true): only the shell\'s script changes; the reads are today\'s', () => {
  const Page = require('../../shared/services/first-touch/teacher-home.page');
  test.each(Object.entries(PAGEDS))('%s: the shells carry the fast script and its own hash; home and library answers and every read count are today\'s', async (pn, paged) => {
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    const [fromHash, toHash] = paged ? [Page.SCRIPT_PAGED_HASH, Page.SCRIPT_PAGED_FAST_HASH] : [Page.SCRIPT_HASH, Page.FAST_SCRIPT_HASH];
    for (const [, lang, pathOf] of REQUESTS) await once(STATES.absent, paged, lang, pathOf);
    for (const [req, lang, pathOf] of REQUESTS) {
      const got = await once({ value: true }, paged, lang, pathOf);
      const today = golden[`${pn}|absent|${req}`];
      expect([req, got.settingsReads, got.otherReads, got.status]).toEqual([req, today.settingsReads, today.otherReads, today.status]);
      if (req.startsWith('shell')) {
        expect(today.csp).toContain(fromHash);
        expect(got.csp).toBe(today.csp.replace(fromHash, toHash));
        expect(got.csp).not.toBe(today.csp);
        expect(got.body).not.toBe(today.body);
      } else {
        expect([req, got.body, got.bytes]).toEqual([req, today.body, today.bytes]);
      }
    }
  });

  test('the home itself off: the shell is today\'s 404, and the fast switch is never read (one settings read)', async () => {
    fake = seedMaker(supabase, { on: true });
    fake.db.app_settings = [...fake.db.app_settings, { key: PAGED, value: true }, { key: FAST, value: true }];
    Flags.reset();
    await boot();
    fake.calls.length = 0;
    const res = await fetch(url(`/quiz/teacher/${tokenFor('en')}`), { headers: { 'x-api-key': process.env.INTERNAL_API_KEY } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ off: true });
    expect(fake.calls.filter((c) => c.table === 'app_settings')).toHaveLength(1);
  });
});

onDescribe('the switch read: the quick answer\'s one app_settings read answers both switches', () => {
  const read = async (rows) => {
    fake = seedMaker(supabase, { on: true });
    fake.db.app_settings = rows;
    Flags.reset();
    fake.calls.length = 0;
    const paged = await Flags.paged();
    const fast = await Flags.gradeFast();
    const both = await Flags.pagedSwitches();
    return { paged, fast, both, reads: fake.calls.filter((c) => c.table === 'app_settings').length };
  };
  test.each([
    ['absent', [], false],
    ['false', [{ key: FAST, value: false }], false],
    ['the string "true"', [{ key: FAST, value: 'true' }], false],
    ['the JSON string "\\"true\\""', [{ key: FAST, value: '"true"' }], false],
    ['1', [{ key: FAST, value: 1 }], false],
    ['{}', [{ key: FAST, value: {} }], false],
    ['JSON true', [{ key: FAST, value: true }], true],
  ])('%s → read as expected, in the quick answer\'s single read (30 s cache)', async (_, rows, want) => {
    for (const paged of [false, true]) {
      const all = [{ key: 'quiz_teacher_home', value: true }, ...(paged ? [{ key: PAGED, value: true }] : []), ...rows];
      expect(await read(all)).toEqual({ paged, fast: want, both: { paged, gradeFast: want }, reads: 1 });
    }
  });
  test('a read that fails → both off, and the next call asks again (no failure is held)', async () => {
    fake = seedMaker(supabase, { on: true });
    fake.db.app_settings = [{ key: PAGED, value: true }, { key: FAST, value: true }];
    failSwitchRead();
    Flags.reset();
    expect(await Flags.pagedSwitches()).toEqual({ paged: false, gradeFast: false });
    fake = seedMaker(supabase, { on: true });
    fake.db.app_settings = [{ key: PAGED, value: true }, { key: FAST, value: true }];
    expect(await Flags.pagedSwitches()).toEqual({ paged: true, gradeFast: true });
  });
  test('a thrown read → both off', async () => {
    fake = seedMaker(supabase, { on: true });
    supabase.from = () => { throw new Error('app_settings down'); };
    Flags.reset();
    expect([await Flags.paged(), await Flags.gradeFast()]).toEqual([false, false]);
  });
});
