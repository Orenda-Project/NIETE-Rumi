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
 * With ONE_DOOR_DUMP_DIR set, the rendered pages are written there (role.html, pick-one.html, pick-many.html,
 * family.html, stale.html) for the page audit.
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
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const { mountGo } = require('../../shared/services/first-touch/go.mount');

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
const DUMP = process.env.ONE_DOOR_DUMP_DIR || null;
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
function world({ on = true, family = [], lists = null, schools = { 't-1': 'sch-1', 't-2': 'sch-1' }, quizSessions = [], teacherHome = true, makerPage = false } = {}) {
  const settings = [];
  if (on) settings.push({ key: 'quiz_one_door', value: 'true' });
  if (teacherHome) settings.push({ key: 'quiz_teacher_home', value: 'true' });
  if (makerPage) settings.push({ key: 'quiz_maker_page', value: 'true' });
  settings.push({ key: 'web_quiz_hub', value: 'true' });
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

  test('its route is mounted on the router when the module exports mount()', () => {
    jest.isolateModules(() => {
      const mount = jest.fn((r) => r.post('/persona', (req, res) => res.json({ ok: true })));
      require('../../shared/services/first-touch/optional-modules')._set('testPersona', { mount });
      require('../../shared/services/first-touch/go.routes');
      expect(mount).toHaveBeenCalledTimes(1);
    });
  });
});
