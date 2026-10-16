'use strict';
/**
 * The landing /api/internal/go/* (ROLE.md §3): the REAL router on a real HTTP port, the real token signer, nonce
 * store (Redis as a Map), role resolver and door.keys writer; supabase is a table double.
 *  - OFF → 404 {off:true} on every route, before any read.
 *  - land: the server re-resolves (the token's side is a hint): teacher → 302 the teacher home; a chat-joined child →
 *    302 /h/<hub>?src=quiz; the remembered child answer → the join screen (or the family words while it is not built);
 *    unknown → the one question page; expired / unknown nonce / another phone → go.stale (200, never a 500).
 *  - who: {side, next}; role: writes the remembered answer ONCE (writer role_page), forgets the cached verdict, answers
 *    {next}; the users row is never written; a registered teacher who taps "I want to play" still lands on the teacher home.
 */
const { fixturePhone } = require('../quiz/web-quiz/fixture-phone');
process.env.WEB_QUIZ_BASE_URL = 'https://portal.example';
process.env.WEB_QUIZ_TOKEN_SECRET = 'unit-secret-not-a-secret';
process.env.INTERNAL_API_KEY = 'unit-internal-key';
process.env.STUDENT_MODE_ENABLED = 'true';

const express = require('express');
const { fakeDb } = require('../quiz/teacher-quiz-menu/fake-db');

let mockDb;
jest.mock('../../shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a), rpc: (...a) => mockDb.rpc(...a) }));
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
let mockTeacherHome = (f) => `th-${f.uid}-${f.lang}`;
jest.mock('../../shared/services/first-touch/teacher-home.token', () => ({ signTeacherHome: (f) => mockTeacherHome(f) }), { virtual: true });

const redis = require('../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../shared/utils/structured-logger');
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
const PH = { unknown: fixturePhone(101), teach: fixturePhone(102), parent: fixturePhone(103) };
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const DEV2 = 'BBBBBBBBBBBBBBBBBBBBBB';

let server;
let base;
beforeAll(async () => {
  const app = express();
  mountGo(app);
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/go`;
});
afterAll(() => new Promise((r) => server.close(r)));

function world({ on = true, hub = true } = {}) {
  const settings = [];
  if (on) settings.push({ key: 'quiz_one_door', value: 'true' });
  if (hub) settings.push({ key: 'web_quiz_hub', value: 'true' });
  mockDb = fakeDb({
    app_settings: settings,
    users: [{ ...UNKNOWN }, { ...TEACHER }, { ...PARENT }],
    students: [{ id: 's-1', phone: PH.parent, list_id: null, is_active: true, student_name: 'Sara Testwala' }],
    user_feature_first_use: [], child_phone_bindings: [], quizzes: [], coaching_sessions: [], quiz_sessions: [],
  });
  OneDoorFlags._resetCache(); HubFlags._resetCache(); IdFlags._resetCache();
  redis.__keys.clear();
  mockMarks.length = 0;
  mockTeacherHome = (f) => `th-${f.uid}-${f.lang}`;
}
const mint = async (user, phone, side = 'unknown', lang = 'bi') => {
  OneDoorFlags._resetCache();
  return (await OneDoor.mintLanding({ user, phone, side, lang, src: 'typed' })).split('/quiz/go/')[1];
};
const H = (dev = DEV) => ({ 'x-api-key': 'unit-internal-key', 'x-wq-device': dev, 'content-type': 'application/json' });
const land = (t, dev) => fetch(`${base}/land/${t}`, { headers: H(dev), redirect: 'manual' });
const post = (p, body, dev) => fetch(`${base}/${p}`, { method: 'POST', headers: H(dev), body: JSON.stringify(body) });

beforeEach(() => { jest.clearAllMocks(); });

test('no internal key → refused', async () => {
  world();
  const r = await fetch(`${base}/land/x.y`, { redirect: 'manual' });
  expect([401, 403]).toContain(r.status);
});

test('switch OFF → 404 {off:true} on every route, nothing read', async () => {
  world({ on: false });
  const t = GoToken.signGo({ uid: 'u-unknown', side: 'unknown', n: 'n'.repeat(22), lang: 'bi', src: 'typed' });
  const r = await land(t);
  expect(r.status).toBe(404);
  expect(await r.json()).toEqual({ off: true });
  expect((await post('role', { t, side: 'child' })).status).toBe(404);
  expect((await post('who', { t })).status).toBe(404);
});

describe('land', () => {
  test('unknown → the one question page: data-screen=role, two tiles (child first), no primary, Urdu first', async () => {
    world();
    const r = await land(await mint(UNKNOWN, PH.unknown));
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('data-screen="role"');
    expect(html.indexOf('data-side="child"')).toBeLessThan(html.indexOf('data-side="teacher"'));
    expect(html).not.toContain('data-primary');
    expect(html).toContain('جگنو کو بتائیں، آپ کون ہیں؟');
    expect(html).toContain('مجھے کھیلنا ہے');
    expect(html).not.toMatch(/\btest\b|\bexam\b|assessment|امتحان|ٹیسٹ/i);
    expect(html).not.toContain(PH.unknown);
    expect(Buffer.byteLength(html)).toBeLessThan(30 * 1024);
    expect(r.headers.get('content-security-policy')).toMatch(/script-src 'sha256-/);
  });

  test('the token said unknown but the phone is a registered teacher → the server wins: 302 the teacher home', async () => {
    world();
    const r = await land(await mint(TEACHER, PH.teach, 'unknown'));
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/quiz/teacher/th-u-teach-bi');
  });

  test('teacher home not on this branch yet (the signer answers null) → the go.error words, 200, never a 500', async () => {
    world();
    mockTeacherHome = () => null;
    const r = await land(await mint(TEACHER, PH.teach, 'teacher'));
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('یہ نہیں ہو سکا۔');
  });

  test('a chat-joined child → 302 the child home /h/<hub token>?src=quiz (IA.md RULING #1)', async () => {
    world();
    const r = await land(await mint(PARENT, PH.parent, 'child'));
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toMatch(/^\/h\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}\?src=quiz$/);
  });

  test('the token\'s life is re-usable on the same phone (RULING F9); another phone → go.stale', async () => {
    world();
    const t = await mint(UNKNOWN, PH.unknown);
    expect((await land(t)).status).toBe(200);
    expect((await land(t)).status).toBe(200);
    const other = await land(t, DEV2);
    expect(other.status).toBe(200);
    expect(await other.text()).toContain('This link has expired.');
  });

  test('a forged token, an expired one, a nonce the server does not hold → go.stale, never a 500', async () => {
    world();
    const forged = await land('eyJrIjoiZ28ifQ.AAAAAAAAAAAAAAAAAAAAAA');
    expect(await forged.text()).toContain('This link has expired.');
    const old = GoToken.signGo({ uid: 'u-unknown', side: 'unknown', n: 'm'.repeat(22), lang: 'ur', src: 'typed' }, { now: Date.now() - 25 * 3600 * 1000 });
    const r = await land(old);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('اس لنک کی مدت ختم ہو گئی ہے۔');
    const lost = GoToken.signGo({ uid: 'u-unknown', side: 'unknown', n: 'q'.repeat(22), lang: 'bi', src: 'typed' });
    expect(await (await land(lost)).text()).toContain('This link has expired.');
  });
});

describe('who / role — the one answer, remembered on the server', () => {
  test('who: unknown → {side:unknown, next:null}; a known teacher → {next: the teacher home}', async () => {
    world();
    expect(await (await post('who', { t: await mint(UNKNOWN, PH.unknown) })).json()).toEqual({ side: 'unknown', next: null });
    expect(await (await post('who', { t: await mint(TEACHER, PH.teach) })).json()).toEqual({ side: 'teacher', next: '/quiz/teacher/th-u-teach-bi' });
  });

  test('"I teach a class" → the teacher key (writer role_page) ONCE, the verdict forgotten, {next: the teacher home}; the users row untouched', async () => {
    world();
    const t = await mint(UNKNOWN, PH.unknown);
    const r = await post('role', { t, side: 'teacher' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ next: '/quiz/teacher/th-u-unknown-bi', side: 'teacher' });
    expect(mockMarks).toEqual([['shown', 'u-unknown', 'quiz_door_teacher'], ['used', 'u-unknown', 'quiz_door_teacher']]);
    expect(mockDb.writes.filter((w) => w.table === 'users')).toEqual([]);
    expect(logEvent).toHaveBeenCalledWith('one_door.role', { side: 'teacher', writer: 'role_page' });
    // a double tap re-reads, it never writes twice
    await post('role', { t, side: 'teacher' });
    expect(mockMarks).toHaveLength(2);
  });

  test('"I want to play" → the child key; with the join screen not built the page goes back to the landing (the family words)', async () => {
    world();
    const t = await mint(UNKNOWN, PH.unknown);
    const r = await (await post('role', { t, side: 'child' })).json();
    expect(mockMarks.map((m) => m[2])).toEqual(['quiz_door_child', 'quiz_door_child']);
    expect(r.next).toBe(`/quiz/go/${t}`);
  });

  test('a registered teacher who taps "I want to play": the key is written, but the server\'s answer wins (teacher home)', async () => {
    world();
    const r = await (await post('role', { t: await mint(TEACHER, PH.teach, 'unknown'), side: 'child' })).json();
    expect(r).toEqual({ next: '/quiz/teacher/th-u-teach-bi', side: 'teacher' });
  });

  test('a stale token → 410 {error:go.stale}; a side outside the two → 400', async () => {
    world();
    const old = GoToken.signGo({ uid: 'u-unknown', side: 'unknown', n: 'm'.repeat(22), lang: 'bi', src: 'typed' }, { now: Date.now() - 25 * 3600 * 1000 });
    expect((await post('role', { t: old, side: 'child' })).status).toBe(410);
    expect((await post('role', { t: await mint(UNKNOWN, PH.unknown), side: 'admin' })).status).toBe(400);
  });

  test('bind: m-student-join\'s writer not on this branch → 501, never a 500', async () => {
    world();
    const r = await post('bind', { t: await mint(PARENT, PH.parent, 'child'), kid: '55555555-5555-4555-8555-000000000001' });
    expect(r.status).toBe(501);
  });
});
