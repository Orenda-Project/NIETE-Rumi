'use strict';
/**
 * The landing /api/internal/go/*: the REAL router on a real HTTP port, the real token signer, nonce map (Redis as a
 * Map), role resolver and door.keys writer; supabase is a table double that counts every read.
 *  - OFF → 404 {off:true} on every route.
 *  - The one question paints with NO database read (a spy on the table double); who this phone is, is asked after paint.
 *  - The server re-resolves (the token's side is a hint): teacher → 302 the teacher home (the teacher home's token
 *    shape); a chat-joined child → the "Is it <First>?" sheet with the notice when a binding can be written, else 302
 *    /h/<hub>?from=quiz; the class-roster family → the sheet (first names only, ≤ 4, ONE school) or the question;
 *    the remembered child answer → 302 the join screen (or the family words while it is not built);
 *    expired / unknown nonce / another device → go.stale (200, never a 500).
 *  - who / role / bind: the remembered answer ONCE per link (writer role_page); the users row and the students rows are
 *    never written; a bind's pick must be one of THIS phone's (or this device's) children; the binding itself is the
 *    join page's write (a stub here).
 * When the folder <os tmpdir>/one-door-pages exists, the rendered pages are written there (role.html, pick-one.html,
 * pick-many.html, family.html, stale.html) for the page audit: create the folder to get them. No env name is read.
 */
process.env.WEB_QUIZ_BASE_URL = 'https://portal.example';
process.env.WEB_QUIZ_TOKEN_SECRET = 'unit-secret-not-a-secret';
process.env.INTERNAL_API_KEY = 'unit-internal-key';
process.env.STUDENT_MODE_ENABLED = 'true';
const fs = require('fs');
const path = require('path');
const express = require('express');
const { fixturePhone } = require('../quiz/web-quiz/fixture-phone');
const { fakeDb } = require('../quiz/teacher-quiz-menu/fake-db');

let mockDb;
let mockReads = 0;
jest.mock('../../shared/config/supabase', () => ({ from: (...a) => { mockReads += 1; return mockDb.from(...a); }, rpc: (...a) => mockDb.rpc(...a) }));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockMarks = [];
jest.mock('../../shared/services/feature-intro.service', () => ({
  markVideoShown: jest.fn(async (u, f) => { mockMarks.push(['shown', u, f]); return true; }),
  markFeatureUsed: jest.fn(async (u, f) => {
    mockMarks.push(['used', u, f]);
    mockDb.tables.user_feature_first_use.push({ user_id: u, feature: f, intro_shown_count: 1, feature_used_at: new Date().toISOString() });
    return true;
  }),
}));
// the join page's module, the quiz-maker page's signer and the walk-through module (their own changes): stood in
// through optional-modules.js per test (no path is mocked, so these tests hold whether or not those modules have landed)
let mockJoin = {};
let mockMaker = {};
let mockPersona = {};
const Optional = require('../../shared/services/first-touch/optional-modules');
const standIn = () => {
  Optional._set('studentJoin', new Proxy({}, { get: (t, k) => mockJoin[k] }));
  Optional._set('makerToken', new Proxy({}, { get: (t, k) => mockMaker[k] }));
  Optional._set('testPersona', new Proxy({}, { get: (t, k) => mockPersona[k] }));
  Optional._set('teacherHomeToken', null);
};
standIn();

const redis = require('../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const WebQuizToken = require('../../shared/services/quiz/web-quiz-token');
const OneDoorFlags = require('../../shared/services/first-touch/one-door.flags');
const OneDoor = require('../../shared/services/first-touch/one-door.service');
const GoToken = require('../../shared/services/first-touch/go.token');
const Page = require('../../shared/services/first-touch/go.page');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const { mountGo } = require('../../shared/services/first-touch/go.mount');
// the bot's WhatsApp number, built at run time (no phone-shaped literal in the source)
const BOT = ['92', '300', '000', '0000'].join('');

const ROW = { registration_completed: false, registration_state: null, name: null, teacher_uuid: null, school_id: null, portal_activated: false, role: null };
const UNKNOWN = { id: 'u-unknown', ...ROW };
const TEACHER = { id: 'u-teach', ...ROW, registration_completed: true, name: 'Asma Testwala', role: 'teacher' };
const PARENT = { id: 'u-parent', ...ROW };
const FAMILY = { id: 'u-family', ...ROW };
const PH = { unknown: fixturePhone(101), teach: fixturePhone(102), parent: fixturePhone(103), family: fixturePhone(104) };
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const DEV2 = 'BBBBBBBBBBBBBBBBBBBBBB';
const QDEV = 'QQQQQQQQQQQQQQQQQQQQQQ';
const THIS_YEAR = new Date().toISOString();
const LAST_YEAR = new Date(Date.now() - 400 * 86400000).toISOString();
const DUMP_DIR = path.join(require('os').tmpdir(), 'one-door-pages');
const DUMP = fs.existsSync(DUMP_DIR) ? DUMP_DIR : null;
const dump = (name, html) => { if (DUMP) { fs.mkdirSync(DUMP, { recursive: true }); fs.writeFileSync(path.join(DUMP, name), html); } };

let server;
let base;
beforeAll(async () => {
  const app = express();
  mountGo(app);
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/go`;
});
afterAll(() => new Promise((r) => server.close(r)));

const roster = (id, name, list = 'l-1', phone = PH.family, school = 'sch-1') => ({ id, student_name: name, list_id: list, parent_phone: phone, school_id: school, is_active: true, status: 'active', merged_into: null });
function world({ on = true, family = [], lists = null, schools = { 't-1': 'sch-1', 't-2': 'sch-1' }, quizSessions = [], teacherHome = true, makerPage = false, adv, oneButton, goLinkLang } = {}) {
  const settings = [];
  if (goLinkLang !== undefined) settings.push({ key: 'web_quiz_go_link_lang', value: goLinkLang });
  if (on) settings.push({ key: 'quiz_one_door', value: 'true' });
  if (teacherHome) settings.push({ key: 'quiz_teacher_home', value: 'true' });
  if (makerPage) settings.push({ key: 'quiz_maker_page', value: 'true' });
  settings.push({ key: 'web_quiz_hub', value: 'true' });
  if (adv !== undefined) settings.push({ key: 'web_quiz_adventure_look', value: adv });
  if (oneButton !== undefined) settings.push({ key: 'web_quiz_one_button', value: oneButton });
  mockDb = fakeDb({
    app_settings: settings,
    users: [{ ...UNKNOWN }, { ...TEACHER }, { ...PARENT }, { ...FAMILY },
      { id: 't-1', ...ROW, role: 'teacher', school_id: schools['t-1'] }, { id: 't-2', ...ROW, role: 'teacher', school_id: schools['t-2'] }],
    students: [{ id: 's-1', phone: PH.parent, list_id: null, is_active: true, student_name: 'Sara Testwala', status: 'active' },
      { id: 's-9', phone: null, list_id: null, is_active: true, student_name: 'Zain Testwala', status: 'active' }, ...family],
    student_lists: lists || [{ id: 'l-1', user_id: 't-1', is_active: true, created_at: THIS_YEAR }, { id: 'l-2', user_id: 't-2', is_active: true, created_at: THIS_YEAR }],
    quiz_sessions: quizSessions,
    user_feature_first_use: [], child_phone_bindings: [], quizzes: [], coaching_sessions: [], lesson_plans: [],
    training_assessment_attempts: [], assessment_requests: [], class_teachers: [],
  });
  OneDoorFlags._resetCache(); HubFlags._resetCache(); IdFlags._resetCache();
  redis.__keys.clear();
  mockMarks.length = 0;
  mockJoin = {};
  mockMaker = {};
  mockPersona = {};
}
const WRITER = () => ({
  joinUrl: jest.fn(({ n, lang }) => `/quiz/join/j.${lang}${n.length}AAAAAAAAAAAAAAAAAA`),
  bindPick: jest.fn(async ({ kid }) => ({ next: `/h/hub.AAAAAAAAAAAAAAAAAAAAAA?from=bind&k=${kid.length}` })),
});
const mint = async (user, phone, side = 'unknown', lang = 'bi') => {
  OneDoorFlags._resetCache();
  return (await OneDoor.mintLanding({ user, phone, side, lang, src: 'typed' })).split('/quiz/go/')[1];
};
const H = (dev = DEV) => ({ 'x-api-key': 'unit-internal-key', 'x-wq-device': dev, 'content-type': 'application/json' });
const land = (t, dev, q = '') => fetch(`${base}/land/${t}${q}`, { headers: H(dev), redirect: 'manual' });
const post = (p, body, dev) => fetch(`${base}/${p}`, { method: 'POST', headers: H(dev), body: JSON.stringify(body) });
const studentWrites = () => mockDb.writes.filter((w) => w.table === 'students' || w.table === 'users');

beforeEach(() => { jest.clearAllMocks(); });

test('no internal key → refused', async () => {
  world();
  const r = await fetch(`${base}/land/x.y`, { redirect: 'manual' });
  expect([401, 403]).toContain(r.status);
});

test('switch OFF → 404 {off:true} on every route, before any read', async () => {
  world({ on: false });
  const t = GoToken.signGo({ uid: 'u-unknown', side: 'unknown', n: 'n'.repeat(22), lang: 'bi', src: 'typed' });
  const r = await land(t);
  expect(r.status).toBe(404);
  expect(await r.json()).toEqual({ off: true });
  for (const p of ['who', 'role', 'bind']) expect((await post(p, { t, side: 'child', pick: 'a'.repeat(16) })).status).toBe(404);
});

describe('land', () => {
  test('unknown → the one question with NO database read: data-screen=role, two tiles (child first), no primary, Urdu first', async () => {
    world();
    const t = await mint(UNKNOWN, PH.unknown);
    await land(t);                       // warms the switch's 30 s cache, as any landing after the first
    mockReads = 0;
    const r = await land(t);
    expect(mockReads).toBe(0);
    expect(r.status).toBe(200);
    const html = await r.text();
    dump('role.html', html);
    expect(html).toContain('data-screen="role"');
    expect(html.indexOf('data-side="child"')).toBeLessThan(html.indexOf('data-side="teacher"'));
    expect(html).not.toContain('data-primary');
    expect(html).toContain('جگنو کو بتائیں، آپ کون ہیں؟');
    expect(html).toContain('مجھے کھیلنا ہے');
    const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
    expect(visible).not.toMatch(/\btest\b|\bexam\b|assessment|امتحان|ٹیسٹ/i);
    expect(html).not.toMatch(/\.test\(/);
    expect(html).not.toContain(PH.unknown);
    expect(Buffer.byteLength(html)).toBeLessThan(30 * 1024);
    expect(r.headers.get('content-security-policy')).toMatch(/script-src 'sha256-/);
  });

  test('the token said unknown but the phone is a registered teacher → the page asks the server after paint: who → the teacher home', async () => {
    world();
    const t = await mint(TEACHER, PH.teach, 'unknown');
    const w = await (await post('who', { t })).json();
    expect(w.side).toBe('teacher');
    const th = w.next.split('/quiz/teacher/')[1];
    expect(WebQuizToken.verify(th, 'th')).toMatchObject({ k: 'th', uid: 'u-teach', lang: 'bi', via: 'go' });
  });

  test.each([['en', 'en'], ['ur', 'ur'], [null, 'bi']])('a teacher whose stored language is %s gets a teacher home in %s (the link itself said bi)', async (stored, want) => {
    world();
    mockDb.tables.users.find((u) => u.id === 'u-teach').preferred_language = stored;
    const t = await mint(TEACHER, PH.teach, 'unknown');
    const w = await (await post('who', { t })).json();
    expect(WebQuizToken.verify(w.next.split('/quiz/teacher/')[1], 'th')).toMatchObject({ uid: 'u-teach', lang: want, via: 'go' });
  });

  test('a link that already names en or ur keeps it, whatever the stored language', async () => {
    world();
    mockDb.tables.users.find((u) => u.id === 'u-teach').preferred_language = 'en';
    const t = await mint(TEACHER, PH.teach, 'unknown', 'ur');
    const w = await (await post('who', { t })).json();
    expect(WebQuizToken.verify(w.next.split('/quiz/teacher/')[1], 'th')).toMatchObject({ lang: 'ur' });
  });

  test('"Not a teacher? Change" (src change): the question stays on screen for a registered teacher and a known child', async () => {
    world({ family: [roster('r-1', 'Ali Testwala')] });
    for (const [user, phone] of [[TEACHER, PH.teach], [PARENT, PH.parent], [FAMILY, PH.family]]) {
      OneDoorFlags._resetCache();
      const url = await OneDoor.mintLanding({ user, phone, side: 'unknown', lang: 'bi', src: 'change' });
      const t = url.split('/quiz/go/')[1];
      const r = await land(t);
      expect(r.status).toBe(200);
      expect(await r.text()).toContain('data-screen="role"');
      expect(await (await post('who', { t })).json()).toEqual({ side: 'unknown', next: null });
    }
    // the tap still meets the server's answer: a registered teacher who taps "I want to play" keeps the teacher home
    const t = (await OneDoor.mintLanding({ user: TEACHER, phone: PH.teach, side: 'unknown', lang: 'bi', src: 'change' })).split('/quiz/go/')[1];
    const j = await (await post('role', { t, side: 'child' })).json();
    expect(j.next).toMatch(/^\/quiz\/teacher\//);
  });

  test('mintLandingForPhone (the child home\'s Change row): the phone alone is enough; switch OFF, no phone, no user → null', async () => {
    world();
    const { normalisePhone } = require('../../shared/services/quiz/student-identity.service');
    mockDb.tables.users.find((u) => u.id === 'u-parent').phone_number = `+${normalisePhone(PH.parent)}`;
    const url = await OneDoor.mintLandingForPhone({ phoneNorm: normalisePhone(PH.parent), lang: 'ur' });
    const t = url.split('/quiz/go/')[1];
    expect(GoToken.verifyGo(t).ok).toMatchObject({ uid: 'u-parent', side: 'unknown', lang: 'ur', src: 'change' });
    expect(url).not.toContain(normalisePhone(PH.parent));
    expect(await (await post('who', { t })).json()).toEqual({ side: 'unknown', next: null });
    const withId = await OneDoor.mintLandingForPhone({ phoneNorm: normalisePhone(PH.parent), userId: 'u-parent', lang: 'en' });
    expect(GoToken.verifyGo(withId.split('/quiz/go/')[1]).ok).toMatchObject({ uid: 'u-parent', lang: 'bi' });
    expect(await OneDoor.mintLandingForPhone({ phoneNorm: '', lang: 'ur' })).toBeNull();
    expect(await OneDoor.mintLandingForPhone({ phoneNorm: normalisePhone(fixturePhone(199)), lang: 'ur' })).toBeNull();
    world({ on: false });
    expect(await OneDoor.mintLandingForPhone({ phoneNorm: normalisePhone(PH.parent), lang: 'ur' })).toBeNull();
  });

  test('a teacher token → 302 the teacher home (the teacher home\'s token shape)', async () => {
    world();
    const r = await land(await mint(TEACHER, PH.teach, 'teacher'));
    expect(r.status).toBe(302);
    expect(WebQuizToken.verify(r.headers.get('location').split('/quiz/teacher/')[1], 'th')).toMatchObject({ uid: 'u-teach', via: 'go' });
  });

  test('a chat-joined child, no binding writer on the branch → 302 /h/<hub>?from=quiz (a known child: no "saved" line)', async () => {
    world();
    const r = await land(await mint(PARENT, PH.parent, 'child'));
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toMatch(/^\/h\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}\?from=quiz$/);
  });

  test('a chat-joined child with the writer → "Is it <First>?" + the three notice sentences BEFORE "Yes, it\'s me"; first name only', async () => {
    world();
    mockJoin = WRITER();
    const r = await land(await mint(PARENT, PH.parent, 'child'));
    const html = await r.text();
    dump('pick-one.html', html);
    expect(html).toContain('data-screen="pick"');
    expect(html).toContain('Is it Sara?');
    expect(html).not.toContain('Testwala');
    const yes = html.indexOf('data-tap="pick_yes"');
    for (const s of ['31 March', 'STOP', 'microphone']) expect(html.indexOf(s)).toBeGreaterThan(0);
    for (const s of ['31 March', 'STOP', 'microphone']) expect(html.indexOf(s)).toBeLessThan(yes);
    expect(html).toContain('?ask=1');
    expect(studentWrites()).toEqual([]);
  });

  test('the class-roster family (one school, ≤ 4) → chips with FIRST names only; no surname, school, class or phone', async () => {
    world({ family: [roster('r-1', 'Ali Testwala'), roster('r-2', 'Hina Testwala', 'l-2')] });
    mockJoin = WRITER();
    const r = await land(await mint(FAMILY, PH.family, 'child'));
    const html = await r.text();
    dump('pick-many.html', html);
    const chips = html.match(/data-tap="pick_chip"/g) || [];
    expect(chips).toHaveLength(2);
    expect(html).toContain('<bdi>Ali</bdi>');
    expect(html).toContain('<bdi>Hina</bdi>');
    expect(html).not.toMatch(/Testwala|sch-1|"l-1"|Grade/);
    expect(html).not.toContain(PH.family);
    expect(studentWrites()).toEqual([]);
  });

  test.each([
    ['two schools', { family: [roster('r-1', 'Ali Testwala'), roster('r-2', 'Hina Testwala', 'l-2', PH.family, 'sch-2')] }],
    ['more than 4 children', { family: ['a', 'b', 'c', 'd', 'e'].map((x, i) => roster(`r-${i}`, `${x} Testwala`)) }],
    ['a list from last school year', { family: [roster('r-1', 'Ali Testwala')], lists: [{ id: 'l-1', user_id: 't-1', is_active: true, created_at: LAST_YEAR }] }],
  ])('a roster number on %s → the one question, no names', async (_n, opts) => {
    world(opts);
    mockJoin = WRITER();
    const r = await land(await mint(FAMILY, PH.family, 'child'));
    const html = await r.text();
    expect(html).toContain('data-screen="role"');
    expect(html).not.toMatch(/Ali|Hina|data-tap="pick_chip"/);
  });

  test('the remembered child answer → 302 the join screen (/quiz/join/…); without the join page → the family words', async () => {
    world();
    mockDb.tables.user_feature_first_use.push({ user_id: 'u-unknown', feature: 'quiz_door_child', intro_shown_count: 1, feature_used_at: new Date().toISOString() });
    mockJoin = WRITER();
    const t = await mint(UNKNOWN, PH.unknown, 'join');
    const r = await land(t);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toMatch(/^\/quiz\/join\//);
    mockJoin = {};
    const f = await land(t);
    const html = await f.text();
    dump('family.html', html);
    expect(html).toContain('data-screen="go.family"');
  });

  test('the stale and error pages carry ONE tap back to the bot (wa.me/<bot>?text=quiz, "Open WhatsApp"); no number → the words alone', async () => {
    const saved = { W: process.env.WHATSAPP_BOT_NUMBER, R: process.env.REFERRAL_BOT_NUMBER };
    try {
      world();
      process.env.WHATSAPP_BOT_NUMBER = `+92 300 ${BOT.slice(5)}`;
      const t = await mint(UNKNOWN, PH.unknown);
      await land(t);
      const stale = await (await land(t, DEV2)).text();
      expect(stale).toContain('data-screen="go.stale"');
      expect(stale).toContain(`href="https://wa.me/${BOT}?text=quiz"`);
      expect(stale).toContain('Open WhatsApp');
      expect(stale).toContain('واٹس\u00a0ایپ کھولیں');
      expect(stale.match(/wa\.me/g)).toHaveLength(1);
      const ur = Page.buildMessagePage({ id: 'go.error', lang: 'ur', bot: BOT }).html;
      expect(ur).toContain(`href="https://wa.me/${BOT}?text=quiz"`);
      expect(ur).toContain('واٹس\u00a0ایپ کھولیں');
      expect(ur).not.toContain('Open WhatsApp');
      delete process.env.WHATSAPP_BOT_NUMBER; delete process.env.REFERRAL_BOT_NUMBER;
      const none = await (await land(t, DEV2)).text();
      expect(none).toContain('This link has expired.');
      expect(none).not.toContain('wa.me');
      expect(Page.buildMessagePage({ id: 'go.stale', lang: 'bi', bot: 'not a number' }).html).not.toContain('wa.me');
    } finally {
      if (saved.W === undefined) delete process.env.WHATSAPP_BOT_NUMBER; else process.env.WHATSAPP_BOT_NUMBER = saved.W;
      if (saved.R === undefined) delete process.env.REFERRAL_BOT_NUMBER; else process.env.REFERRAL_BOT_NUMBER = saved.R;
    }
  });

  test('the question and pick pages: an error shows the same ONE tap back (hidden until the error); the page never reloads', async () => {
    const saved = process.env.WHATSAPP_BOT_NUMBER;
    try {
      process.env.WHATSAPP_BOT_NUMBER = BOT;
      world();
      const role = await (await land(await mint(UNKNOWN, PH.unknown))).text();
      expect(role).toContain(`<a class="wa" id="go-wa" href="https://wa.me/${BOT}?text=quiz" data-tap="open_whatsapp" hidden>`);
      mockJoin = WRITER();
      const pick = await (await land(await mint(PARENT, PH.parent, 'child'))).text();
      expect(pick).toContain('data-screen="pick"');
      expect(pick).toContain('id="go-wa"');
      expect(Page._SCRIPT).toContain('$("go-wa")');
      expect(Page._SCRIPT).not.toMatch(/location\.reload/);
      delete process.env.WHATSAPP_BOT_NUMBER;
      expect(await (await land(await mint(UNKNOWN, PH.unknown))).text()).not.toContain('id="go-wa"');
    } finally {
      if (saved === undefined) delete process.env.WHATSAPP_BOT_NUMBER; else process.env.WHATSAPP_BOT_NUMBER = saved;
    }
  });

  test('the error line a parent reads is at least 18 px (Urdu)', () => {
    expect(String(Page._CSS)).toMatch(/\.err\{[^}]*font-size:18px/);
  });

  test('re-usable on the same phone; another phone → go.stale; forged / expired / unknown nonce → go.stale; never a 500', async () => {
    world();
    const t = await mint(UNKNOWN, PH.unknown);
    expect((await land(t)).status).toBe(200);
    expect((await land(t)).status).toBe(200);
    const other = await land(t, DEV2);
    const html = await other.text();
    dump('stale.html', html);
    expect(other.status).toBe(200);
    expect(html).toContain('This link has expired.');
    expect(await (await land('eyJrIjoiZ28ifQ.AAAAAAAAAAAAAAAAAAAAAA')).text()).toContain('This link has expired.');
    const old = GoToken.signGo({ uid: 'u-unknown', side: 'unknown', n: 'm'.repeat(22), lang: 'ur', src: 'typed' }, { now: Date.now() - 25 * 3600 * 1000 });
    expect(await (await land(old)).text()).toContain('اس لنک کی مدت ختم ہو گئی ہے۔');
    const lost = GoToken.signGo({ uid: 'u-unknown', side: 'unknown', n: 'q'.repeat(22), lang: 'bi', src: 'typed' });
    expect(await (await land(lost)).text()).toContain('This link has expired.');
  });
});

describe('who / role — the one answer, remembered on the server', () => {
  test('who: unknown → {side:unknown, next:null}; a child who played on THIS device (and a writer) → known {pick, first}', async () => {
    world({ quizSessions: [{ id: 'qs-1', student_id: 's-9', device_ref: QDEV, created_at: new Date().toISOString() }] });
    const t = await mint(UNKNOWN, PH.unknown);
    expect(await (await post('who', { t })).json()).toEqual({ side: 'unknown', next: null });
    expect(await (await post('who', { t, d: QDEV })).json()).toEqual({ side: 'unknown', next: null });   // no writer yet
    mockJoin = WRITER();
    const w = await (await post('who', { t, d: QDEV })).json();
    expect(w.known).toEqual({ pick: expect.stringMatching(/^[0-9a-f]{16}$/), first: 'Zain' });
  });

  test('who: an unknown phone learns no name from a device ref it does not hold (another ref, a malformed ref, an inactive child)', async () => {
    world({ quizSessions: [{ id: 'qs-1', student_id: 's-9', device_ref: QDEV, created_at: new Date().toISOString() }] });
    mockJoin = WRITER();
    const t = await mint(UNKNOWN, PH.unknown);
    for (const d of ['RRRRRRRRRRRRRRRRRRRRRR', 'QQQQ', `${QDEV}' or 1=1`, ['x'], 42]) {
      const j = await (await post('who', { t, d })).json();
      expect(j).toEqual({ side: 'unknown', next: null });
      expect(JSON.stringify(j)).not.toMatch(/Zain/);
    }
    mockDb.tables.students.find((r) => r.id === 's-9').is_active = false;
    expect(await (await post('who', { t, d: QDEV })).json()).toEqual({ side: 'unknown', next: null });
  });

  test('"I teach a class" → the teacher key ONCE, {next: the teacher home}; the users row untouched', async () => {
    world();
    const t = await mint(UNKNOWN, PH.unknown);
    const r = await post('role', { t, side: 'teacher' });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.side).toBe('teacher');
    expect(j.next).toMatch(/^\/quiz\/teacher\//);
    expect(mockMarks).toEqual([['shown', 'u-unknown', 'quiz_door_teacher'], ['used', 'u-unknown', 'quiz_door_teacher']]);
    expect(studentWrites()).toEqual([]);
    expect(logEvent).toHaveBeenCalledWith('one_door.role', { side: 'teacher', writer: 'role_page' });
    await post('role', { t, side: 'teacher' });
    expect(mockMarks).toHaveLength(2);   // a double tap re-reads, it never writes twice
  });

  test('"I want to play" → the child key; next = the landing (the family words) without the join page, the join screen with it', async () => {
    world();
    const t = await mint(UNKNOWN, PH.unknown);
    const r = await (await post('role', { t, side: 'child' })).json();
    expect(mockMarks.map((m) => m[2])).toEqual(['quiz_door_child', 'quiz_door_child']);
    expect(r.next).toBe(`/quiz/go/${t}`);
    mockJoin = WRITER();
    expect((await (await post('role', { t, side: 'child' })).json()).next).toMatch(/^\/quiz\/join\//);
  });

  test('a registered teacher who taps "I want to play": the server\'s answer wins (the teacher home)', async () => {
    world();
    const r = await (await post('role', { t: await mint(TEACHER, PH.teach, 'unknown'), side: 'child' })).json();
    expect(r.side).toBe('teacher');
    expect(r.next).toMatch(/^\/quiz\/teacher\//);
  });

  test('web_quiz_practice_play on: a registered teacher who taps "I want to play" lands on the practice home for the class\'s grade', async () => {
    world();
    mockDb.tables.app_settings.push({ key: 'web_quiz_practice_play', value: true });
    require('../../shared/services/quiz/web-quiz-practice-play')._reset();
    const r = await (await post('role', { t: await mint(TEACHER, PH.teach, 'unknown', 'ur'), side: 'child' })).json();
    expect(r.side).toBe('teacher');
    const m = /^\/h\/([^?]+)\?from=door$/.exec(r.next);
    expect(m).not.toBeNull();
    // the practice home's own token: no child, a grade, Back to this teacher's home
    const tok = WebQuizToken.verify(m[1], 'h');
    expect(tok).toMatchObject({ ids: [], pr: 1, lang: 'ur' });
    expect([1, 2, 3, 4, 5]).toContain(tok.g);
    expect(tok.bk).toMatch(/^\/quiz\/teacher\//);
    expect(studentWrites()).toEqual([]);
    expect(logEvent).toHaveBeenCalledWith('one_door.practice', expect.objectContaining({ grade: tok.g }));
    require('../../shared/services/quiz/web-quiz-practice-play')._reset();
  });

  test('GOLDEN: web_quiz_practice_play false → the teacher home, as before', async () => {
    world();
    mockDb.tables.app_settings.push({ key: 'web_quiz_practice_play', value: false });
    require('../../shared/services/quiz/web-quiz-practice-play')._reset();
    const r = await (await post('role', { t: await mint(TEACHER, PH.teach, 'unknown'), side: 'child' })).json();
    expect(r.next).toMatch(/^\/quiz\/teacher\//);
    require('../../shared/services/quiz/web-quiz-practice-play')._reset();
  });

  test('a stale token → 410 {error:go.stale}; a side outside the two → 400', async () => {
    world();
    const old = GoToken.signGo({ uid: 'u-unknown', side: 'unknown', n: 'm'.repeat(22), lang: 'bi', src: 'typed' }, { now: Date.now() - 25 * 3600 * 1000 });
    expect((await post('role', { t: old, side: 'child' })).status).toBe(410);
    expect((await post('role', { t: await mint(UNKNOWN, PH.unknown), side: 'admin' })).status).toBe(400);
  });
});

describe('bind — "Yes, it\'s me"', () => {
  const pickFrom = (html) => (html.match(/data-pick="([0-9a-f]{16})"/) || html.match(/"pick":"([0-9a-f]{16})"/) || [])[1];

  test('the writer not on the branch → 501, never a 500', async () => {
    world();
    expect((await post('bind', { t: await mint(PARENT, PH.parent, 'child'), pick: 'a'.repeat(16) })).status).toBe(501);
  });

  test('the sheet\'s pick → the writer gets THIS phone\'s child id (src quiz), once; a forged pick → 400; nothing written here', async () => {
    world();
    mockJoin = WRITER();
    const t = await mint(PARENT, PH.parent, 'child');
    const pick = pickFrom(await (await land(t)).text());
    expect((await post('bind', { t, pick: 'f'.repeat(16) })).status).toBe(400);
    const r = await post('bind', { t, pick });
    expect(r.status).toBe(200);
    expect((await r.json()).next).toMatch(/^\/h\/.*from=bind/);
    expect(mockJoin.bindPick).toHaveBeenCalledTimes(1);
    expect(mockJoin.bindPick.mock.calls[0][0]).toMatchObject({ kid: 's-1', src: 'quiz', device: DEV });
    expect((await post('bind', { t, pick })).status).toBe(409);   // single-use per link
    expect(studentWrites()).toEqual([]);
  });

  test('a refused or failed bind does not use the link up: the same link binds on the next tap; a done bind does', async () => {
    world();
    mockJoin = WRITER();
    mockJoin.bindPick.mockResolvedValueOnce({ refused: 'max_kids' }).mockRejectedValueOnce(new Error('db down'));
    const t = await mint(PARENT, PH.parent, 'child');
    const pick = pickFrom(await (await land(t)).text());
    expect((await post('bind', { t, pick })).status).toBe(409);
    expect((await post('bind', { t, pick })).status).toBe(503);
    const r = await post('bind', { t, pick });
    expect(r.status).toBe(200);
    expect(mockJoin.bindPick).toHaveBeenCalledTimes(3);
    expect((await post('bind', { t, pick })).status).toBe(409);   // done: single-use from here
    expect(mockJoin.bindPick).toHaveBeenCalledTimes(3);
  });

  test('the writer is told the page\'s language and the quiz page\'s device ref (rung 4b), nothing when unknown', async () => {
    world({ quizSessions: [{ id: 'qs-1', student_id: 's-9', device_ref: QDEV, created_at: new Date().toISOString() }] });
    mockJoin = WRITER();
    const u = await mint(UNKNOWN, PH.unknown, 'unknown', 'ur');
    const known = (await (await post('who', { t: u, d: QDEV })).json()).known;
    expect((await post('bind', { t: u, pick: known.pick, d: QDEV })).status).toBe(200);
    expect(mockJoin.bindPick.mock.calls[0][0]).toMatchObject({ kid: 's-9', src: 'device', device: DEV, quizDevice: QDEV, lang: 'ur' });
    const t = await mint(PARENT, PH.parent, 'child');   // a bilingual page: no language preference is passed on
    await post('bind', { t, pick: pickFrom(await (await land(t)).text()), d: 'not-a-ref' });
    expect(mockJoin.bindPick.mock.calls[1][0]).not.toHaveProperty('quizDevice');
    expect(mockJoin.bindPick.mock.calls[1][0]).not.toHaveProperty('lang');
  });

  test('the roster family\'s chip → src roster; the device-known child → src device', async () => {
    world({ family: [roster('r-1', 'Ali Testwala')], quizSessions: [{ id: 'qs-1', student_id: 's-9', device_ref: QDEV, created_at: new Date().toISOString() }] });
    mockJoin = WRITER();
    const t = await mint(FAMILY, PH.family, 'child');
    await post('bind', { t, pick: pickFrom(await (await land(t)).text()) });
    expect(mockJoin.bindPick.mock.calls[0][0]).toMatchObject({ kid: 'r-1', src: 'roster' });
    const u = await mint(UNKNOWN, PH.unknown);
    const known = (await (await post('who', { t: u, d: QDEV })).json()).known;
    expect((await post('bind', { t: u, pick: known.pick, d: QDEV })).status).toBe(200);
    expect(mockJoin.bindPick.mock.calls[1][0]).toMatchObject({ kid: 's-9', src: 'device' });
  });

  test('a teacher\'s phone is never bound (409), whatever the pick', async () => {
    world();
    mockJoin = WRITER();
    expect((await post('bind', { t: await mint(TEACHER, PH.teach, 'unknown'), pick: 'a'.repeat(16) })).status).toBe(409);
    expect(mockJoin.bindPick).not.toHaveBeenCalled();
  });
});

describe('a teacher while the teacher home is not serving', () => {
  test('quiz_teacher_home OFF, the quiz-maker page ON → 302 /m/<token> (a working teacher screen)', async () => {
    world({ teacherHome: false, makerPage: true });
    mockMaker = { signMaker: jest.fn((f) => `mk.${f.via}${f.tour}AAAAAAAAAAAAAAAAAAAA`) };
    const r = await land(await mint(TEACHER, PH.teach, 'teacher'));
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toMatch(/^\/m\/mk\.menu0/);
    expect(mockMaker.signMaker).toHaveBeenCalledWith({ uid: 'u-teach', lang: 'bi', tour: 0, via: 'menu' });
  });

  test('neither the teacher home nor the maker page → the honest line (200), never a 500 or a dead link', async () => {
    world({ teacherHome: false, makerPage: false });
    mockMaker = { signMaker: jest.fn(() => 'mk.x') };
    const r = await land(await mint(TEACHER, PH.teach, 'teacher'));
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('data-screen="go.error"');
    expect(mockMaker.signMaker).not.toHaveBeenCalled();
  });
});

describe('the sandbox walk-through hooks (the module present; its own switch decides inside get/row)', () => {
  const COACH = { id: 'u-coach', ...ROW, role: 'coach', name: 'Coach Testwala' };
  const coachWorld = () => { world(); mockDb.tables.users.push({ ...COACH }); };

  test('absent persona → the coach is a teacher, as always', async () => {
    coachWorld();
    mockPersona = { get: jest.fn(async () => null) };
    expect((await (await post('who', { t: await mint(COACH, fixturePhone(105)) })).json()).side).toBe('teacher');
  });

  test('fresh → the coach phone resolves unknown (the question); door answers older than the walk are ignored, newer honoured', async () => {
    coachWorld();
    const since = Date.now() - 1000;
    mockPersona = { get: jest.fn(async () => ({ as: 'fresh', since })) };
    mockDb.tables.user_feature_first_use.push({ user_id: 'u-coach', feature: 'quiz_door_child', intro_shown_count: 1, feature_used_at: new Date(since - 60000).toISOString() });
    const t = await mint(COACH, fixturePhone(105));
    expect((await (await post('who', { t })).json()).side).toBe('unknown');
    mockDb.tables.user_feature_first_use.push({ user_id: 'u-coach', feature: 'quiz_door_child', intro_shown_count: 1, feature_used_at: new Date().toISOString() });
    mockJoin = WRITER();
    expect((await (await post('who', { t })).json()).next).toMatch(/^\/quiz\/join\//);
  });

  test('teacher_empty → teacher; the persona rides the reply event (QA excludes the walk)', async () => {
    coachWorld();
    mockPersona = { get: jest.fn(async () => ({ as: 'teacher_empty', since: Date.now() })) };
    const Role = require('../../shared/services/first-touch/role.service');
    expect(await Role.resolveRole({ user: { id: 'u-unknown', ...ROW }, phone: PH.unknown })).toMatchObject({ side: 'teacher', src: 'persona', persona: 'teacher_empty' });
  });

  test('the row the module builds sits under the note on the one question page; none when it returns nothing', async () => {
    world();
    mockPersona = { row: jest.fn(async () => '<section data-screen="walkthrough">Walk</section>') };
    const html = await (await land(await mint(UNKNOWN, PH.unknown))).text();
    expect(html.indexOf('data-screen="walkthrough"')).toBeGreaterThan(html.indexOf('class="note"'));
    mockPersona = { row: jest.fn(async () => null) };
    expect(await (await land(await mint(UNKNOWN, PH.unknown))).text()).not.toContain('walkthrough');
  });

  test('the module ABSENT: the one question page is byte-identical to the page without a row, and /persona is 404', async () => {
    world();
    Optional._set('testPersona', null);
    try {
      const t = await mint(UNKNOWN, PH.unknown);
      const r = await land(t);
      const built = Page.buildRolePage({ t, lang: 'bi' });
      expect(await r.text()).toBe(built.html);
      expect(r.headers.get('content-security-policy')).toBe(built.csp);
      expect((await post('persona', { t, as: 'fresh' })).status).toBe(404);
    } finally {
      standIn();
    }
  });

  test('its route is mounted on the router when the module exports mount()', () => {
    jest.isolateModules(() => {
      const mount = jest.fn((r) => r.post('/persona', (req, res) => res.json({ ok: true })));
      require('../../shared/services/first-touch/optional-modules')._set('testPersona', { mount });
      require('../../shared/services/first-touch/go.routes');
      expect(mount).toHaveBeenCalledTimes(1);
    });
  });
});

describe('the door\'s v3 lines join the sitting (web_quiz_events_v3)', () => {
  const KEY = 'k'.repeat(32);
  const v3Lines = (name) => logEvent.mock.calls.filter(([n]) => n === `web_quiz.${name}`).map(([, d]) => d);
  let was;
  beforeEach(() => { was = process.env.WEB_QUIZ_KID_KEY; process.env.WEB_QUIZ_KID_KEY = KEY; });
  afterEach(() => { if (was === undefined) delete process.env.WEB_QUIZ_KID_KEY; else process.env.WEB_QUIZ_KID_KEY = was; });
  const eventsOn = () => { mockDb.tables.app_settings.push({ key: 'web_quiz_events_v3', value: 'true' }); OneDoorFlags._resetCache(); };

  test('on: role_asked and role_answered carry kid_v and ONE sitting id keyed by this phone, no raw id', async () => {
    world();
    eventsOn();
    const t = await mint(UNKNOWN, PH.unknown);
    await post('who', { t });
    await post('role', { t, side: 'child' });
    const [asked] = v3Lines('role_asked');
    const [answered] = v3Lines('role_answered');
    expect(asked).toMatchObject({ w: 's', ev_v: 3, v3: 1, kid: null, sit: expect.stringMatching(/^[a-z2-9]{10}$/) });
    expect(answered).toMatchObject({ w: 's', ev_v: 3, v3: 1, kid: null, role: 'student', sit: asked.sit });
    [asked, answered].forEach((d) => {
      expect(d).toHaveProperty('kid_v');
      const s = JSON.stringify(d);
      expect(s).not.toContain('u-unknown');
      expect(s).not.toContain(PH.unknown);
      expect(s).not.toContain(DEV);
    });
  });

  test('on: a stale link\'s go_stale line carries the sitting too', async () => {
    world();
    eventsOn();
    const old = GoToken.signGo({ uid: 'u-unknown', side: 'unknown', n: 'm'.repeat(22), lang: 'bi', src: 'typed' }, { now: Date.now() - 25 * 3600 * 1000 });
    await land(old);
    expect(v3Lines('go_stale')).toEqual([expect.objectContaining({ ev_v: 3, kid: null, why: 'expired', sit: expect.stringMatching(/^[a-z2-9]{10}$/) })]);
  });

  test('off: no v3 line at all (today)', async () => {
    world();
    const t = await mint(UNKNOWN, PH.unknown);
    await post('who', { t });
    await post('role', { t, side: 'child' });
    const old = GoToken.signGo({ uid: 'u-unknown', side: 'unknown', n: 'm'.repeat(22), lang: 'bi', src: 'typed' }, { now: Date.now() - 25 * 3600 * 1000 });
    await land(old);
    expect(['role_asked', 'role_answered', 'go_stale'].flatMap(v3Lines)).toEqual([]);
  });
});

describe('the adventure look (web_quiz_adventure_look AND web_quiz_one_button, both JSON true): the same pages in the new look, the same reads', () => {
  const advClass = (html) => /<html[^>]*class="wq-adv"/.test(html);
  const cssHash = (html) => require('crypto').createHash('sha256').update(/<style>([\s\S]*?)<\/style>/.exec(html)[1], 'utf8').digest('base64');
  // the keys of every app_settings read, as the door's one read asks for them
  function spyKeys() {
    const keys = [];
    const from = mockDb.from.bind(mockDb);
    mockDb.from = (tb) => { const b = from(tb); if (tb === 'app_settings') { const inF = b.in; b.in = (c, vs) => { keys.push(...vs); return inF.call(b, c, vs); }; } return b; };
    return keys;
  }
  async function today(t) {
    world({});
    OneDoorFlags._resetCache();
    return { role: await (await land(t)).text(), stale: await (await land('x.y')).text() };
  }
  test.each([
    [true, true, true],
    [true, undefined, false], [true, false, false], [true, 'true', false], [true, 1, false],
    ['true', true, false], [false, true, false], [1, true, false], [undefined, true, false], [undefined, undefined, false],
  ])('look %p, one button %p → the look %p; the reads are today\'s; off = today\'s page, byte for byte', async (adv, oneButton, want) => {
    world({});
    const t = await mint(UNKNOWN, PH.unknown);
    const off = await today(t);
    world({ adv, oneButton });
    const keys = spyKeys();
    OneDoorFlags._resetCache();
    mockReads = 0;
    const cold = await (await land(t)).text();
    expect(mockReads).toBe(1);                       // the one switch read, as today: both keys ride it
    expect(advClass(cold)).toBe(want);
    if (!want) expect(cold).toBe(off.role);
    mockReads = 0;
    const r = await land(t);
    expect(mockReads).toBe(0);                       // the one question still paints with NO database read
    const html = await r.text();
    expect(advClass(html)).toBe(want);
    if (want) expect(r.headers.get('content-security-policy')).toContain(`style-src 'sha256-${cssHash(html)}'`);
    else expect(html).toBe(off.role);
    mockReads = 0;
    const stale = await (await land('x.y')).text();
    expect(mockReads).toBe(0);
    expect(stale).toContain('data-screen="go.stale"');
    expect(advClass(stale)).toBe(want);
    if (!want) expect(stale).toBe(off.stale);
    expect(keys).toEqual(expect.arrayContaining(['quiz_one_door', 'web_quiz_adventure_look', 'web_quiz_one_button']));
  });

  test('the "Is it <First>?" sheet a known family phone lands on carries the look with both switches, and not with the look alone', async () => {
    for (const [oneButton, want] of [[true, true], [undefined, false]]) {
      world({ adv: true, oneButton, family: [roster('r-1', 'Ali Testwala')] });
      OneDoorFlags._resetCache();
      mockJoin = WRITER();
      const t = await mint(FAMILY, PH.family, 'child');
      const r = await land(t);
      const html = await r.text();
      expect(html).toContain('data-screen="pick"');
      expect([oneButton, advClass(html)]).toEqual([oneButton, want]);
      if (want) {
        expect(html).toContain('class="yes wq-btn wq-btn--primary"');
        expect(r.headers.get('content-security-policy')).toContain(`style-src 'sha256-${cssHash(html)}'`);
      } else expect(html).not.toContain('wq-btn');
    }
  });
});

// web_quiz_go_link_lang: the link's own ?lang (the edge passes it as ?ll=, and the page posts it back as `l`) decides the
// page's language and the join's, before the language the link was minted in. Off: neither is read.
describe('the link\'s language through the one door', () => {
  const joinLang = (next) => (/^\/quiz\/join\/j\.(bi|ur)/.exec(String(next)) || [])[1] || null;
  const boot = (html) => JSON.parse(/<script type="application\/json" id="go-boot">([\s\S]*?)<\/script>/.exec(html)[1]);
  test('on: an Urdu link opened with ?lang=en paints English first and joins in English; the page posts the language back', async () => {
    world({ goLinkLang: true });
    mockJoin = WRITER();
    const t = await mint(UNKNOWN, PH.unknown, 'unknown', 'ur');
    const html = await (await land(t, DEV, '?ll=en')).text();
    expect(boot(html).l).toBe('en');
    // the door itself in English only: the page's language, its heading and tiles, no Urdu line
    expect(html).toContain('<html lang="en" dir="ltr"');
    expect(html).toContain('Tell Jugnu who you are');
    expect(html).toContain('I want to play');
    const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
    expect(visible).not.toMatch(/[\u0600-\u06FF]/);
    expect(joinLang((await (await post('role', { t, side: 'child', l: 'en' })).json()).next)).toBe('bi');
  });
  test('on: an English link opened with ?lang=ur joins in Urdu; a remembered child answer (who) carries it too', async () => {
    world({ goLinkLang: true });
    mockJoin = WRITER();
    mockDb.tables.user_feature_first_use.push({ user_id: 'u-unknown', feature: 'quiz_door_child', intro_shown_count: 1, feature_used_at: new Date().toISOString() });
    const t = await mint(UNKNOWN, PH.unknown, 'join', 'bi');
    expect(joinLang((await (await post('who', { t, l: 'ur' })).json()).next)).toBe('ur');
    const r = await land(t, DEV, '?ll=ur');
    expect(joinLang(r.headers.get('location'))).toBe('ur');
  });
  test('on: no language on the link, or one that is not en/ur: the link\'s own, as today', async () => {
    world({ goLinkLang: true });
    mockJoin = WRITER();
    const t = await mint(UNKNOWN, PH.unknown, 'unknown', 'ur');
    expect(boot(await (await land(t, DEV, '?ll=fr')).text()).l).toBeUndefined();
    expect(joinLang((await (await post('role', { t, side: 'child' })).json()).next)).toBe('ur');
    expect(joinLang((await (await post('role', { t, side: 'child', l: 'fr' })).json()).next)).toBe('ur');
  });
  test.each([['absent', undefined], ['false', false], ['the string "true"', 'true']])('switch %s: the link\'s language is never read; the page is today\'s, byte for byte', async (_, v) => {
    world({ goLinkLang: v });
    mockJoin = WRITER();
    const t = await mint(UNKNOWN, PH.unknown, 'unknown', 'ur');
    const today = await (await land(t)).text();
    expect(await (await land(t, DEV, '?ll=en')).text()).toBe(today);
    expect(joinLang((await (await post('role', { t, side: 'child', l: 'en' })).json()).next)).toBe('ur');
  });
});
