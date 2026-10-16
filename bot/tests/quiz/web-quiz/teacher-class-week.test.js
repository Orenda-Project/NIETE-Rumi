'use strict';
/**
 * The class week card on the teacher's Jugnu tab (/r/<token>?tab=jugnu) — "Forward the week" for a drawn class
 * inside its week window — behind app_settings web_quiz_class_week (effective only with web_quiz_class_round,
 * web_quiz_class_link, web_quiz_challenge_v2 and web_quiz_challenge all on).
 *
 * The routes run for real on an ephemeral port over the real data module, page and token. Faked: Supabase
 * (in-memory, filters applied; a select, filter or write naming a column the schema mirror lacks answers 42703),
 * Redis (a Map), the loggers, and the event-key module (its keyed hash needs a secret: a stand-in of the same
 * shape, cls = 12 hex). Children are invented "Testwala" fixtures.
 *
 * GOLDEN: with the class week off (or any parent off) the Jugnu tab is the page it was before the card existed,
 * byte for byte. The baselines in __goldens__/teacher-class-week-off.json were written by THIS test from the code
 * BEFORE the card existed (GOLDEN_WRITE=1); every later run compares against them.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockRedis = new Map();
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => true,
  setNX: jest.fn(async (k, v) => { if (mockRedis.has(k)) return false; mockRedis.set(k, v); return true; }),
}));
jest.mock('../../../shared/services/quiz/web-quiz-kid', () => ({
  cls: (id) => require('crypto').createHash('sha256').update(`cls|${id}`).digest('hex').slice(0, 12),
  kid: (id) => require('crypto').createHash('sha256').update(`kid|${id}`).digest('hex').slice(0, 16),
  envelope: (f) => ({ ev_v: 2, kid_v: 1, ...f }),
}));

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { makeFake } = require('./fake-supabase');
const { strictFrom } = require('./strict-columns');

const CHECKED = ['student_lists', 'class_enrollments', 'students', 'web_quiz_challenge_runs', 'child_rungs', 'child_phone_bindings',
  'class_links', 'challenge_passages', 'class_round_draws', 'app_settings'];

const NOW = Date.parse('2026-10-15T09:30:00Z'); // term 2026-27b (1 Oct – 31 Mar, PKT)
const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const CLASS = 'c1a55000-0000-4000-8000-000000000001';
const OTHER_CLASS = 'c1a55000-0000-4000-8000-000000000002';
const BASE_URL = 'https://portal.example.test';
const CODE = 'K7QX2M9P';
const id = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const at = (iso) => new Date(Date.parse(iso)).toISOString();
const KIDS = [[1, 'Zara Testwala'], [2, 'Bilal Testwala'], [3, 'Ayesha Testwala'], [4, 'Hamza Testwala'], [5, 'Noor Testwala']];
const FIRST = ['Zara', 'Bilal', 'Ayesha', 'Hamza', 'Noor'];
const BANNED = /picked|sampled|selected|chosen|test|exam|assessment|چنا|چنی|منتخب|امتحان|ٹیسٹ|نمونہ/i;
const ANY_DIGIT = /[0-9٠-٩۰-۹]/;

const ON = ['web_quiz_teacher_jugnu', 'web_quiz_challenge_v2', 'web_quiz_challenge', 'web_quiz_class_round', 'web_quiz_class_link', 'web_quiz_class_week'];
const settingsWith = (off = []) => ON.filter((k) => !off.includes(k)).map((key) => ({ key, value: 'true' }));
const DRAW = { term_code: '2026-27b', class_id: CLASS, round: '0123456789abcdef', week_start: at('2026-10-12T00:00:00Z'), week_end: at('2026-10-19T00:00:00Z') };

let DB;
function seed({ settings = settingsWith(), draws = [DRAW], classLinks = true } = {}) {
  DB = {
    app_settings: settings,
    users: [{ id: TEACHER, preferred_language: 'en' }],
    quizzes: [{ id: QUIZ, teacher_id: TEACHER, topic: 'Plants', subject: 'science', grade: '3', language: 'en', quiz_source: 'transcript',
      status: 'report_sent', list_id: null, created_at: at('2026-10-14T03:00:00Z'), meta: { share_code_id: SC } }],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: TEACHER, active: true, expires_at: null, language: 'en', created_at: at('2026-10-14T03:00:00Z') }],
    quiz_sessions: [], quiz_questions: [], quiz_answers: [],
    student_lists: [{ id: LIST, class_name: 'Grade 3', section: 'B', user_id: TEACHER, is_active: true, class_id: CLASS }],
    students: KIDS.map(([n, name]) => ({ id: id(n), list_id: LIST, roll_number: n, student_name: name, father_name: null, student_name_urdu: null, is_active: true, merged_into: null })),
    class_enrollments: KIDS.map(([n]) => ({ class_id: CLASS, student_id: id(n), is_active: true })),
    web_quiz_challenge_runs: [
      { id: 'r1', student_id: id(3), canonical_id: id(3), exercise: 'read', status: 'scored', mode: 'check', record: true, period_id: '2026-10', class_id: CLASS, wcpm: 40, meta: {}, created_at: at('2026-10-13T06:00:00Z'), scored_at: at('2026-10-13T06:01:00Z') },
    ],
    child_rungs: [],
    child_phone_bindings: [],
    challenge_passages: [],
  };
  if (draws) DB.class_round_draws = draws.map((d) => ({ ...d })); // a fresh row per test: the forward stamps it
  if (classLinks) DB.class_links = [{ code: CODE, class_id: CLASS, teacher_id: TEACHER, term_code: '2026-27b', expires_at: at('2027-03-31T18:59:59Z'), revoked_at: null }];
  const fake = makeFake(DB);
  const from = strictFrom((t) => (DB[t] === undefined ? missingTable(t) : fake.from(t)), CHECKED);
  Object.assign(require('../../../shared/config/supabase'), { from, rpc: fake.rpc });
}
function missingTable(t) {
  const b = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res({ data: null, error: { code: '42P01', message: `relation "${t}" does not exist` } }) : () => b) });
  return b;
}

// The copy deck's jg.week.* words, byte for byte: the page must carry exactly these.
const WEEK = {
  en: 'This week Jugnu is for everyone in our class. Open the pinned link and play at home.',
  ur: 'اس ہفتے جگنو ہماری کلاس کے سب بچوں کے لیے ہے۔ پِن کیا ہوا لنک کھولیں اور گھر پر کھیلیں۔',
};
const TITLE = { en: 'Forward the week', ur: 'اس ہفتے کا پیغام فارورڈ کریں' };
const SUB = {
  en: 'One fixed message for the class group, with no names and no numbers. The link is added for you.',
  ur: 'کلاس گروپ کے لیے ایک طے شدہ پیغام: نہ کوئی نام، نہ اعداد و شمار۔ لنک خود ساتھ لگ جاتا ہے۔',
};
let server;
let base;
let Token;
let Page;
let logEvent;
async function boot(opts) {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-key';
  process.env.WEB_QUIZ_BASE_URL = BASE_URL;
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  seed(opts);
  Token = require('../../../shared/services/quiz/teacher-report-token');
  Page = require('../../../shared/templates/teacher-jugnu.page');
  ({ logEvent } = require('../../../shared/utils/structured-logger'));
  const app = express();
  app.use('/api/internal/tr', require('../../../shared/routes/teacher-report-internal.routes'));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/tr`;
}
beforeEach(() => {
  mockRedis.clear();
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] });
});
afterEach(async () => { jest.useRealTimers(); if (server) await new Promise((r) => server.close(r)); server = null; delete process.env.WEB_QUIZ_BASE_URL; });

const get = (p) => fetch(`${base}${p}`, { headers: { 'x-api-key': 'test-key' }, redirect: 'manual' });
const html = async (p) => { const r = await get(p); expect(r.status).toBe(200); return r.text(); };
const tok = () => Token.signTeacherReport({ teacherId: TEACHER, quizId: QUIZ });
const tab = (lang = 'en') => html(`/page/${tok()}?tab=jugnu&class=${LIST}&lang=${lang}`);
const hasCard = (h) => h.includes('id="jwk"');
const eventsNamed = (name) => logEvent.mock.calls.filter(([n]) => n === `web_quiz.${name}`).map(([, d]) => d);
const forwardText = async (lang = 'en') => {
  const r = await get(`/wfwd/${tok()}?class=${LIST}&lang=${lang}`);
  expect(r.status).toBe(302);
  const loc = r.headers.get('location');
  expect(loc.startsWith('https://wa.me/?text=')).toBe(true);
  return decodeURIComponent(loc.slice('https://wa.me/?text='.length));
};

describe('GOLDEN: class week off (or any parent off) → the Jugnu tab is byte-identical to the page before the card', () => {
  const FILE = path.join(__dirname, '__goldens__', 'teacher-class-week-off.json');
  const digest = (h) => ({ sha256: crypto.createHash('sha256').update(h, 'utf8').digest('hex'), bytes: Buffer.byteLength(h, 'utf8') });
  const STATES = {
    week_off: ['web_quiz_class_week'],
    round_off: ['web_quiz_class_round'],
    link_off: ['web_quiz_class_link'],
    v2_off: ['web_quiz_challenge_v2'],
  };
  const writing = process.env.GOLDEN_WRITE === '1';
  const baseline = writing ? {} : JSON.parse(fs.readFileSync(FILE, 'utf8'));
  afterAll(() => { if (writing) fs.writeFileSync(FILE, `${JSON.stringify(baseline, null, 2)}\n`); });
  Object.entries(STATES).forEach(([name, off]) => ['en', 'ur'].forEach((lang) => {
    test(`${name} ${lang}: a drawn class inside its window renders exactly the original tab`, async () => {
      await boot({ settings: settingsWith(off) });
      const h = await tab(lang);
      const key = `${name}.${lang}`;
      if (writing) { baseline[key] = digest(h); return; }
      expect(hasCard(h)).toBe(false);
      expect(digest(h)).toEqual(baseline[key]);
      expect(eventsNamed('sample_window')).toEqual([]);
      expect((await get(`/wfwd/${tok()}?class=${LIST}`)).status).toBe(404);
    });
  }));
});

describe('the card shows only for a drawn class inside its week window', () => {
  test('every switch on, EN: the card carries the deck\'s title, sub-line and forward line, and a forward link', async () => {
    await boot();
    const h = await tab('en');
    expect(hasCard(h)).toBe(true);
    const card = (h.match(/<section class="card" id="jwk"[^>]*>[\s\S]*?<\/section>/) || [''])[0];
    expect(card).toContain(`/wfwd?class=${LIST}`);
    expect(card).toContain(`>${WEEK.en}<`);
    expect(card).toContain(`>${TITLE.en}<`);
    expect(card).toContain(`>${SUB.en}<`);
    expect(card).toMatch(/^<section class="card" id="jwk" dir="ltr" lang="en">/);
  });

  test('every switch on, UR: the card in the deck\'s Urdu, dir="rtl" lang="ur", set in the report\'s Nastaliq stack', async () => {
    await boot();
    const h = await tab('ur');
    const card = (h.match(/<section class="card" id="jwk"[^>]*>[\s\S]*?<\/section>/) || [''])[0];
    expect(card).toMatch(/^<section class="card" id="jwk" dir="rtl" lang="ur">/);
    expect(card).toContain(WEEK.ur);
    expect(card).toContain(TITLE.ur);
    expect(card).toContain(SUB.ur);
    const { FONTS } = require('../../../shared/templates/niete-brand');
    expect(h).toContain(`#jwk[lang="ur"]{font-family:${FONTS.bodyUrdu}`);
    expect(h).toContain("@font-face{font-family:'NastaliqUrdu'");
  });

  test.each([
    ['before week_start', [{ ...DRAW, week_start: at('2026-10-15T09:30:01Z') }]],
    ['at week_end', [{ ...DRAW, week_end: at('2026-10-15T09:30:00Z') }]],
    ['after week_end', [{ ...DRAW, week_start: at('2026-10-01T00:00:00Z'), week_end: at('2026-10-08T00:00:00Z') }]],
    ['an undrawn class', [{ ...DRAW, class_id: OTHER_CLASS }]],
    ['another term', [{ ...DRAW, term_code: '2026-27a' }]],
    ['a draw row without a week window', [{ term_code: DRAW.term_code, class_id: CLASS, round: DRAW.round }]],
    ['no draws table on this environment', null],
  ])('%s → no card and the forward route is 404', async (_, draws) => {
    await boot({ draws });
    expect(hasCard(await tab('en'))).toBe(false);
    expect((await get(`/wfwd/${tok()}?class=${LIST}`)).status).toBe(404);
    expect(eventsNamed('sample_window')).toEqual([]);
  });

  test('no live class link → no card', async () => {
    await boot({ classLinks: false });
    expect(hasCard(await tab('en'))).toBe(false);
    expect((await get(`/wfwd/${tok()}?class=${LIST}`)).status).toBe(404);
  });

  test('jg.week.forward absent from the page copy → no card (never an invented line)', async () => {
    await boot();
    delete Page.T.en.weekForward; delete Page.T.ur.weekForward;
    expect(hasCard(await tab('en'))).toBe(false);
    expect(hasCard(await tab('ur'))).toBe(false);
    expect((await get(`/wfwd/${tok()}?class=${LIST}`)).status).toBe(404);
  });
});

describe('the forward line', () => {
  test.each(['en', 'ur'])('%s: the fixed line + the class link only — no digit outside the code, no name, no count, no banned word', async (lang) => {
    await boot();
    const t = await forwardText(lang);
    const link = `${BASE_URL}/j/${CODE}`;
    expect(t).toBe(`${WEEK[lang]} ${link}`);
    const rest = t.replace(link, '');
    expect(rest).not.toMatch(ANY_DIGIT);
    FIRST.forEach((n) => expect(t).not.toContain(n));
    expect(rest).not.toMatch(BANNED);
    expect(t).not.toMatch(/ of |have started/);
  });

  test('a line carrying a digit, a roster name or a banned word is refused → no card', async () => {
    for (const bad of ['Our 5 readers this week:', 'Zara and friends read this week:', 'Your child was selected this week:', 'آپ کا بچہ منتخب ہوا:']) {
      // eslint-disable-next-line no-await-in-loop
      await boot();
      Page.T.en.weekForward = bad;
      // eslint-disable-next-line no-await-in-loop
      expect(hasCard(await tab('en'))).toBe(false);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => server.close(r)); server = null;
    }
  });
});

describe('events', () => {
  test('class_week_forwarded on the forward tap: w:s, cls and term only', async () => {
    await boot();
    await forwardText('en');
    const ev = eventsNamed('class_week_forwarded');
    expect(ev).toHaveLength(1);
    const { ev_v: v, kid_v: kv, ...fields } = ev[0];
    expect(v).toBe(2);
    expect(kv).toBe(1);
    expect(Object.keys(fields).sort()).toEqual(['cls', 'term', 'w']);
    expect(fields).toEqual({ w: 's', cls: expect.stringMatching(/^[0-9a-f]{12}$/), term: '2026-27b' });
    expect(JSON.stringify(ev[0])).not.toContain(CLASS);
    expect(JSON.stringify(ev[0])).not.toContain(CODE);
  });

  test('a card view writes no sample_window (the daily job is its one writer)', async () => {
    await boot();
    expect(hasCard(await tab('en'))).toBe(true);
    expect(hasCard(await tab('ur'))).toBe(true);
    expect(eventsNamed('sample_window')).toEqual([]);
    expect(logEvent.mock.calls.map(([n]) => n)).not.toContain('web_quiz.sample_window');
  });

  test('class_week_forwarded once per class per window: two taps → two redirects, one event, week_forwarded_at set once', async () => {
    await boot();
    expect(await forwardText('en')).toBe(`${WEEK.en} ${BASE_URL}/j/${CODE}`);
    const stamped = DB.class_round_draws[0].week_forwarded_at;
    expect(typeof stamped).toBe('string');
    expect(await forwardText('ur')).toBe(`${WEEK.ur} ${BASE_URL}/j/${CODE}`);
    expect(eventsNamed('class_week_forwarded')).toHaveLength(1);
    expect(DB.class_round_draws[0].week_forwarded_at).toBe(stamped);
  });

  test('already forwarded this window (a row stamped earlier) → the redirect, no event', async () => {
    await boot({ draws: [{ ...DRAW, week_forwarded_at: at('2026-10-13T08:00:00Z') }] });
    expect(await forwardText('en')).toBe(`${WEEK.en} ${BASE_URL}/j/${CODE}`);
    expect(eventsNamed('class_week_forwarded')).toEqual([]);
  });

  test('week_forwarded_at missing on this environment (42703 on the update) → the redirect still works, no event, one log line', async () => {
    await boot();
    const sb = require('../../../shared/config/supabase');
    const inner = sb.from;
    const refused = { data: null, error: { code: '42703', message: 'column class_round_draws.week_forwarded_at does not exist' } };
    const chain = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res(refused) : () => chain) });
    sb.from = (t) => (t === 'class_round_draws' ? new Proxy(inner(t), { get: (b, k) => (k === 'update' ? () => chain : b[k]) }) : inner(t));
    const { logToFile } = require('../../../shared/utils/logger');
    logToFile.mockClear();
    expect(await forwardText('en')).toBe(`${WEEK.en} ${BASE_URL}/j/${CODE}`);
    expect(await forwardText('en')).toBe(`${WEEK.en} ${BASE_URL}/j/${CODE}`);
    expect(eventsNamed('class_week_forwarded')).toEqual([]);
    expect(logToFile.mock.calls.filter(([m]) => /class week/.test(m) && /forward/.test(m))).toHaveLength(1);
  });

  test('the event-key module absent → the card still works, no event written', async () => {
    jest.doMock('../../../shared/services/quiz/web-quiz-kid', () => { throw new Error("Cannot find module 'web-quiz-kid'"); });
    await boot();
    expect(hasCard(await tab('en'))).toBe(true);
    await forwardText('en');
    expect(eventsNamed('class_week_forwarded')).toEqual([]);
    expect(eventsNamed('sample_window')).toEqual([]);
    jest.dontMock('../../../shared/services/quiz/web-quiz-kid');
  });
});
