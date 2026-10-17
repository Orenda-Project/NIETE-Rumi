'use strict';
/**
 * The walk-through row for listed test phones (switch quiz_test_personas, sandbox only): the REAL landing router on a
 * real HTTP port, the real token signer, nonce map (Redis as a Map), role resolver, bindings repo and door.keys reader;
 * supabase is a table double. It is walk-persona.js's seam test: the bindings repo is never mocked or spied on.
 *  1 OFF (absent / false / garbage / a read that throws) → the one question page byte-identical to the page without
 *    the row; POST /persona 404 {off:true}
 *  2 ON but the phone's user id is not on the fixture rule's test-teacher list → the same bytes, the same 404
 *  3 ON + listed + "Start as a new phone": a coach phone resolves unknown; its phone links are erased; door keys from
 *    before the tap are ignored and newer ones honoured; after the join's binding the next /quiz resolves child through
 *    the binding; the code binder no longer refuses the phone as a teacher's
 *  4 "A teacher with no lessons yet": the resolver still says teacher; the teacher home's lists are emptied
 *  5 "Back to my real self": get() is null, the coach phone lands on its own teacher home, the walk's own phone links
 *    are gone
 *  6 nothing logs the phone or the user id; no Redis key holds the phone
 *  7 the eraser runs exactly once per "Start as a new phone" tap, never on the other two (read off the table writes)
 * And: production / staging never turn it on, whatever the switch says.
 */
process.env.WEB_QUIZ_BASE_URL = 'https://portal.example';
process.env.WEB_QUIZ_TOKEN_SECRET = 'unit-secret-not-a-secret';
process.env.INTERNAL_API_KEY = 'unit-internal-key';
process.env.STUDENT_MODE_ENABLED = 'true';
process.env.WQ_TOMB_SALT = 'unit-salt-not-a-secret';
const express = require('express');
const { fixturePhone } = require('../quiz/web-quiz/fixture-phone');
const { fakeDb } = require('../quiz/teacher-quiz-menu/fake-db');

let mockDb;
let mockThrowPersona = false;
jest.mock('../../shared/config/supabase', () => ({
  from: (table) => {
    const b = mockDb.from(table);
    if (table !== 'app_settings') return b;
    const ins = b.in;
    b.in = (c, v) => { if (mockThrowPersona && Array.isArray(v) && v.includes('quiz_test_personas')) throw new Error('boom'); return ins(c, v); };
    return b;
  },
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));
jest.mock('../../shared/services/feature-intro.service', () => ({
  markVideoShown: jest.fn(async () => true),
  markFeatureUsed: jest.fn(async (u, f) => {
    mockDb.tables.user_feature_first_use.push({ user_id: u, feature: f, intro_shown_count: 1, feature_used_at: new Date().toISOString() });
    return true;
  }),
}));
jest.mock('../../shared/services/quiz/web-quiz-student-join', () => ({}));

const redis = require('../../shared/services/cache/railway-redis.service');
const logger = require('../../shared/utils/logger');
const { logEvent } = require('../../shared/utils/structured-logger');
const OneDoorFlags = require('../../shared/services/first-touch/one-door.flags');
const OneDoor = require('../../shared/services/first-touch/one-door.service');
const Page = require('../../shared/services/first-touch/go.page');
const Role = require('../../shared/services/first-touch/role.service');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const BindRepo = require('../../shared/services/quiz/child-phone-bindings.repo');
const WebQuizBind = require('../../shared/services/quiz/web-quiz-bind.service');
const { mountGo } = require('../../shared/services/first-touch/go.mount');
const { createQuizGoRouter } = require('../../../dashboard/routes/quiz-go.routes');

const persona = () => require('../../shared/services/first-touch/walk-persona');
const GoToken = require('../../shared/services/first-touch/go.token');
const keptRec = async () => { const v = await redis.get(persona()._keptKey(NORM.coach)); return v == null ? null : JSON.parse(v); };
const sideOf = (next) => GoToken.verifyGo(next.split('/quiz/go/')[1]).ok.side;

const ROW = { registration_completed: false, registration_state: null, name: null, teacher_uuid: null, school_id: null, portal_activated: false, role: null };
const COACH = { id: 'u-coach', ...ROW, role: 'coach', name: 'Coach Testwala' };
const OTHER = { id: 'u-other', ...ROW, role: 'coach', name: 'Other Testwala' };
const PH = { coach: fixturePhone(201), other: fixturePhone(202) };
const NORM = { coach: BindRepo.normalisePhone(PH.coach), other: BindRepo.normalisePhone(PH.other) };
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const HOUR = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();

let server;
let base;
beforeAll(async () => {
  const app = express();
  mountGo(app);
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  // a loaded machine can stretch the gap between two requests past Node's 5 s keep-alive: never reuse a closed socket
  server.keepAliveTimeout = 120000;
  server.headersTimeout = 121000;
  base = `http://127.0.0.1:${server.address().port}/api/internal/go`;
});
afterAll(() => new Promise((r) => server.close(r)));

/**
 * `sw` = the quiz_test_personas value ('ABSENT' = no row); `listed` = the coach's id on the test-teacher list.
 * The coach phone holds one old binding and an old teacher key (from before any walk).
 */
function world({ sw = 'true', listed = true, bindings = null, keys = null } = {}) {
  const settings = [{ key: 'quiz_one_door', value: 'true' }, { key: 'web_quiz_hub', value: 'true' }, { key: 'quiz_teacher_home', value: 'true' },
    { key: 'web_quiz_identity_canon', value: 'true' }, { key: 'web_quiz_phone_bind', value: 'true' }];
  if (sw !== 'ABSENT') settings.push({ key: 'quiz_test_personas', value: sw });
  settings.push({ key: 'web_quiz_fixture_rule', value: JSON.stringify({ student_lists: [], teachers: listed ? ['u-coach'] : ['u-someone-else'] }) });
  mockDb = fakeDb({
    app_settings: settings,
    users: [{ ...COACH, phone_number: PH.coach }, { ...OTHER, phone_number: PH.other }],
    students: [{ id: 's-old', phone: null, list_id: null, is_active: true, student_name: 'Old Testwala', status: 'active' },
      { id: 's-walk', phone: null, list_id: null, is_active: true, student_name: 'Walk Testwala', status: 'active' }],
    child_phone_bindings: bindings || [{ id: 'b-old', canonical_id: 's-old', phone_norm: NORM.coach, via: 'save', bound_at: iso(Date.now() - 48 * HOUR), revoked_at: null, expires_at: iso(Date.now() + 90 * 24 * HOUR) }],
    user_feature_first_use: keys || [{ user_id: 'u-coach', feature: 'quiz_door_teacher', intro_shown_count: 1, feature_used_at: iso(Date.now() - 2 * HOUR) }],
    quizzes: [], coaching_sessions: [], lesson_plans: [], student_lists: [], training_assessment_attempts: [], assessment_requests: [],
    class_teachers: [], quiz_sessions: [], child_identity: [],
  });
  mockThrowPersona = false;
  OneDoorFlags._resetCache(); HubFlags._resetCache(); IdFlags._resetCache();
  try { persona()._resetCache(); } catch (_) { /* the module is not there on the base */ }
  redis.__keys.clear();
}
const mint = async (user = COACH, phone = PH.coach, side = 'unknown', lang = 'bi') => {
  OneDoorFlags._resetCache();
  return (await OneDoor.mintLanding({ user, phone, side, lang, src: 'other' })).split('/quiz/go/')[1];
};
const NEXT = /^\/quiz\/go\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/;
const H = { 'x-api-key': 'unit-internal-key', 'x-wq-device': DEV, 'content-type': 'application/json' };
const land = (t, q = '') => fetch(`${base}/land/${t}${q}`, { headers: H, redirect: 'manual' });
const post = (p, body) => fetch(`${base}/${p}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
const tap = async (as, t) => post('persona', { t: t || await mint(), as });
const resolve = (user = COACH, phone = PH.coach) => Role.resolveRole({ user: { id: user.id }, phone });
const activeOnCoach = () => mockDb.tables.child_phone_bindings.filter((b) => b.phone_norm === NORM.coach && !b.revoked_at);
// the shared double records each write's rows as an array and keeps an inserted row in its table, as the database does
const inserted = () => mockDb.writes.filter((w) => w.op === 'insert').flatMap((w) => w.rows);

beforeEach(() => { jest.clearAllMocks(); delete process.env.RAILWAY_ENVIRONMENT_NAME; delete process.env.ENVIRONMENT; });

describe('1 · OFF: the page without the row, byte for byte; the POST 404', () => {
  test.each([['absent', 'ABSENT'], ['false', 'false'], ['garbage', '{"nope":1'], ['throws', 'true']])('%s', async (label, sw) => {
    world({ sw });
    if (label === 'throws') mockThrowPersona = true;
    const t = await mint();
    const r = await land(t);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toBe(Page.buildRolePage({ t, lang: 'bi' }).html);
    expect(html).not.toContain('data-screen="walk"');
    expect(html).not.toContain('data-persona=');
    const p = await tap('fresh', t);
    expect(p.status).toBe(404);
    expect(await p.json()).toEqual({ off: true });
    expect(activeOnCoach()).toHaveLength(1);
    expect(persona().get).toBeDefined();
    expect(await persona().get(PH.coach)).toBeNull();
  });
});

describe('1b · OFF writes nothing: the switch is read before the link is opened', () => {
  test.each([['absent', 'ABSENT'], ['false', 'false']])('%s — the POST leaves Redis exactly as it found it', async (label, sw) => {
    world({ sw });
    const t = await mint();
    const before = [...redis.__keys.keys()].sort();
    const p = await tap('fresh', t);
    expect(p.status).toBe(404);
    expect([...redis.__keys.keys()].sort()).toEqual(before);
    expect(mockDb.writes).toEqual([]);
  });
});

describe('2 · ON but not on the list: the same bytes, the same 404', () => {
  test('a coach phone whose id is not on the test-teacher list', async () => {
    world({ listed: false });
    const t = await mint();
    const html = await (await land(t)).text();
    expect(html).toBe(Page.buildRolePage({ t, lang: 'bi' }).html);
    const p = await tap('fresh', t);
    expect(p.status).toBe(404);
    expect(await p.json()).toEqual({ off: true });
    expect(await persona().allowed('u-coach')).toBe(false);
    expect(activeOnCoach()).toHaveLength(1);
  });
});

describe('the row (ON + listed)', () => {
  test('rendered under the note, its three taps, the page\'s policy unchanged, no test words, < 30 KB', async () => {
    world();
    const t = await mint();
    const r = await land(t);
    const html = await r.text();
    expect(html).toContain('data-screen="walk"');
    expect(html.indexOf('class="note"')).toBeLessThan(html.indexOf('data-screen="walk"'));
    for (const as of ['fresh', 'teacher_empty', 'real']) expect(html).toContain(`data-persona="${as}"`);
    expect(html).toContain('نئے فون کی طرح شروع کریں');
    expect(html).toContain('Start as a new phone');
    expect(html).toContain('A teacher with no lessons yet');
    expect(html).toContain('Back to my real self');
    const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
    expect(visible).not.toMatch(/\btest\b|\bexam\b|assessment|امتحان|ٹیسٹ/i);
    expect(html).not.toMatch(/ style=| on[a-z]+=/i);                  // nothing the page's policy would block
    expect(html).not.toContain(PH.coach);
    expect(html).not.toContain('u-coach');
    expect(Buffer.byteLength(html)).toBeLessThan(30 * 1024);
    expect(r.headers.get('content-security-policy')).toBe(Page.buildRolePage({ t, lang: 'bi' }).csp);
    // the Urdu-only page carries no English line in the row
    const ur = await (await land(await mint(COACH, PH.coach, 'unknown', 'ur'))).text();
    expect(ur).toContain('data-screen="walk"');
    expect(ur.slice(ur.indexOf('data-screen="walk"'))).not.toContain('Start as a new phone');
  });

  test('row() — the shape other pages embed (the teacher home\'s foot): a listed phone\'s section, \'\' for anyone else', async () => {
    world();
    const t = await mint();
    const html = await persona().row({ lang: 'bi', token: t });
    expect(html.startsWith('<section data-screen="walk">')).toBe(true);
    expect(html.endsWith('</section>')).toBe(true);
    expect(html.match(/data-persona="/g)).toHaveLength(3);
    expect(await persona().row({ lang: 'bi', token: await mint(OTHER, PH.other) })).toBe('');   // not on the list
    expect(await persona().row({ lang: 'bi', token: 'x.y' })).toBe('');                        // not a token
    expect(await persona().row({ lang: 'bi' })).toBe('');
    world({ sw: 'false' });
    expect(await persona().row({ lang: 'bi', token: await mint() })).toBe('');                  // switch off
  });

  test('a bad `as` → 400, a stale token → 410, nothing written', async () => {
    world();
    expect((await tap('nobody')).status).toBe(400);
    expect((await post('persona', { t: 'x.y', as: 'fresh' })).status).toBe(410);
    expect(activeOnCoach()).toHaveLength(1);
    expect(await persona().get(PH.coach)).toBeNull();
  });
});

describe('3 · "Start as a new phone"', () => {
  test('a coach phone resolves unknown; links erased; the old key ignored; the walk\'s answer and join honoured; tomorrow → child', async () => {
    world();
    expect((await resolve()).side).toBe('teacher');
    const r = await tap('fresh');
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toEqual({ done: true, as: 'fresh', next: expect.stringMatching(NEXT) });
    // the page goes on to a NEW landing: the one question (its own nonce, so the answer is not spent)
    const q = await land(j.next.split('/quiz/go/')[1]);
    expect(q.status).toBe(200);
    expect(await q.text()).toContain('data-screen="role"');
    expect(activeOnCoach()).toHaveLength(0);
    expect((await persona().get(PH.coach)).as).toBe('fresh');
    const w = await resolve();
    expect(w).toMatchObject({ side: 'unknown', src: 'none' });

    // the walk's own answer on the one question page (written after the tap) is honoured: the join screen
    await new Promise((ok) => setTimeout(ok, 5));
    mockDb.tables.user_feature_first_use.push({ user_id: 'u-coach', feature: 'quiz_door_child', intro_shown_count: 1, feature_used_at: new Date().toISOString() });
    expect((await resolve()).side).toBe('join');

    // the join's binding (via guest) → the same phone tomorrow is the child, through the binding
    mockDb.tables.child_phone_bindings.push({ id: 'b-walk', canonical_id: 's-walk', phone_norm: NORM.coach, via: 'guest', bound_at: new Date().toISOString(), revoked_at: null, expires_at: iso(Date.now() + 90 * 24 * HOUR) });
    expect(await resolve()).toMatchObject({ side: 'child', src: 'bound', children: ['s-walk'] });
  });

  test('a door key from before the tap (even a child one) is read as absent', async () => {
    world({ keys: [{ user_id: 'u-coach', feature: 'quiz_door_child', intro_shown_count: 1, feature_used_at: iso(Date.now() - HOUR) }] });
    await tap('fresh');
    expect((await resolve()).side).toBe('unknown');
  });

  test('the landing after the tap asks the one question (the token said teacher; the server re-resolves)', async () => {
    world();
    await tap('fresh');
    const t = await mint(COACH, PH.coach, 'teacher');
    const r = await land(t);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('data-screen="role"');
  });

  test('the code binder does not refuse the phone as a teacher\'s while it walks as a new phone', async () => {
    world();
    const before = await WebQuizBind.handleCode({ phone: PH.coach, body: 'JUGNU-ABCD2', mode: 'teacher' });
    expect(before).toMatchObject({ outcome: 'refused', reason: 'teacher_phone' });
    await tap('fresh');
    const after = await WebQuizBind.handleCode({ phone: PH.coach, body: 'JUGNU-ABCD2', mode: 'teacher' });
    expect(after.reason).not.toBe('teacher_phone');
  });

  test('another phone is untouched by this phone\'s walk', async () => {
    world();
    await tap('fresh');
    expect(await persona().get(PH.other)).toBeNull();
    expect((await resolve(OTHER, PH.other)).side).toBe('teacher');
  });
});

describe('4 · "A teacher with no lessons yet"', () => {
  test('the resolver still says teacher; the teacher home\'s lists are emptied for this phone only', async () => {
    world();
    const r = await tap('teacher_empty');
    const j = await r.json();
    expect(j).toEqual({ done: true, as: 'teacher_empty', next: expect.stringMatching(NEXT) });
    expect(await resolve()).toMatchObject({ side: 'teacher', persona: 'teacher_empty' });
    const home = await land(j.next.split('/quiz/go/')[1]);
    expect(home.status).toBe(302);
    expect(home.headers.get('location')).toMatch(/^\/(quiz\/teacher|m)\//);
    expect(activeOnCoach()).toHaveLength(1);
    const lists = { lessons: [{ id: 'l' }], played: new Map([['q', {}]]), shares: [{ id: 's' }], other: 1 };
    const hidden = await persona().forHome(PH.coach, lists);
    expect(hidden.lessons).toEqual([]);
    expect(hidden.shares).toEqual([]);
    expect(hidden.played.size).toBe(0);
    expect(hidden.other).toBe(1);
    expect(await persona().forHome(PH.other, lists)).toBe(lists);
  });
});

describe('5 · "Back to my real self"', () => {
  test('get() is null; the coach phone lands on its own teacher home; the walk\'s own links gone, the phone\'s own put back', async () => {
    world();
    await tap('fresh');
    expect((await keptRec()).kept).toEqual([{ id: 's-old', via: 'save' }]);
    mockDb.tables.child_phone_bindings.push({ id: 'b-walk', canonical_id: 's-walk', phone_norm: NORM.coach, via: 'guest', bound_at: new Date(Date.now() + 1000).toISOString(), revoked_at: null, expires_at: iso(Date.now() + 90 * 24 * HOUR) });
    await tap('teacher_empty');
    const r = await tap('real');
    expect(await r.json()).toEqual({ done: true, as: 'real', next: expect.stringMatching(NEXT) });
    expect(await persona().get(PH.coach)).toBeNull();
    expect((await resolve()).side).toBe('teacher');
    const live = activeOnCoach();
    expect(live.map((b) => b.id)).not.toContain('b-walk');           // the walk's own link erased …
    expect(live.map((b) => b.canonical_id)).toEqual(['s-old']);      // … and the phone's own the only live one, put back
    const back = mockDb.writes.filter((w) => w.table === 'child_phone_bindings' && w.op === 'insert').flatMap((w) => w.rows);
    expect(back).toEqual([expect.objectContaining({ canonical_id: 's-old', phone_norm: NORM.coach, via: 'save' })]);
    const land302 = await land(await mint(COACH, PH.coach, 'teacher'));
    expect(land302.status).toBe(302);
    expect(land302.headers.get('location')).toMatch(/^\/(quiz\/teacher|m)\//);
  });

  test('"real" with no walk running erases nothing', async () => {
    world();
    await tap('real');
    expect(activeOnCoach()).toHaveLength(1);
  });

  test('a second "Start as a new phone" keeps what the first one erased', async () => {
    world();
    await tap('fresh');
    const first = await keptRec();
    await tap('fresh');
    expect(await keptRec()).toEqual(first);
    expect(first.kept).toEqual([{ id: 's-old', via: 'save' }]);
  });

  test('each child comes back with its own kind of link and a fresh school-year expiry', async () => {
    world({ bindings: [
      { id: 'b-t', canonical_id: 's-old', phone_norm: NORM.coach, via: 'teacher', bound_at: iso(Date.now() - 48 * HOUR), revoked_at: null, expires_at: iso(Date.now() + 90 * 24 * HOUR) },
      { id: 'b-g', canonical_id: 's-walk', phone_norm: NORM.coach, via: 'guest', bound_at: iso(Date.now() - 47 * HOUR), revoked_at: null, expires_at: iso(Date.now() + 90 * 24 * HOUR) },
    ] });
    await tap('fresh');
    await tap('real');
    const back = mockDb.writes.filter((w) => w.table === 'child_phone_bindings' && w.op === 'insert').flatMap((w) => w.rows);
    const exp = BindRepo.expiresAtFor(new Date()).toISOString();
    expect(back).toEqual([
      expect.objectContaining({ canonical_id: 's-old', via: 'teacher', expires_at: exp }),
      expect.objectContaining({ canonical_id: 's-walk', via: 'guest', expires_at: exp }),
    ]);
    expect(await keptRec()).toBeNull();
  });

  test('the persona ran out before "Back to my real self": the record outlives it; real — or the next /quiz — puts the phone back once', async () => {
    world();
    await tap('fresh');
    expect(redis.set).toHaveBeenCalledWith(persona()._keptKey(NORM.coach), expect.any(String), 7 * 24 * 3600);
    redis.__keys.delete(persona()._key(NORM.coach));            // a day of silence
    await tap('real');
    expect(inserted().map((r) => r.canonical_id)).toEqual(['s-old']);
    expect(await keptRec()).toBeNull();

    world();
    await tap('fresh');
    redis.__keys.delete(persona()._key(NORM.coach));
    expect(await persona().get(PH.coach)).toBeNull();             // the resolver's read on the next /quiz
    expect(inserted().map((r) => r.canonical_id)).toEqual(['s-old']);
    expect(await keptRec()).toBeNull();
    await persona().get(PH.coach);
    expect(mockDb.writes.filter((w) => w.op === 'insert')).toHaveLength(1);   // once: one insert per link put back
    expect(inserted()).toHaveLength(1);
  });
});

describe('the persona\'s keys and clock', () => {
  test('the record slides with the persona: each read that finds the persona gives the record 7 days again', async () => {
    world();
    await tap('fresh');
    redis.expire.mockClear();
    await persona().get(PH.coach);
    expect(redis.expire).toHaveBeenCalledWith(persona()._key(NORM.coach), 24 * 3600);
    expect(redis.expire).toHaveBeenCalledWith(persona()._keptKey(NORM.coach), 7 * 24 * 3600);
  });

  test('the switch going off mid-walk keeps the record; "Back to my real self" after it is on again still puts the phone back', async () => {
    world();
    await tap('fresh');
    const sw = mockDb.tables.app_settings.find((r) => r.key === 'quiz_test_personas');
    sw.value = 'false'; persona()._resetCache();
    expect(await persona().get(PH.coach)).toBeNull();
    expect(redis.__keys.has(persona()._keptKey(NORM.coach))).toBe(true);
    expect(mockDb.writes.filter((w) => w.op === 'insert')).toHaveLength(0);
    sw.value = 'true'; persona()._resetCache();
    const r = await tap('real');
    expect(r.status).toBe(200);
    expect(inserted().map((r) => r.canonical_id)).toEqual(['s-old']);
    expect(redis.__keys.has(persona()._keptKey(NORM.coach))).toBe(false);
  });

  test('the record does not stick (a write Redis drops): the tap fails and the phone keeps every link', async () => {
    world();
    const keptKey = persona()._keptKey(NORM.coach);
    const realSet = redis.set.getMockImplementation();
    redis.set.mockImplementation(async (k, v, t) => (k === keptKey ? true : realSet(k, v, t)));   // says yes, keeps nothing
    try {
      const r = await tap('fresh');
      expect(r.status).toBe(503);
      expect(activeOnCoach().map((b) => b.id)).toEqual(['b-old']);
      expect(mockDb.writes.filter((w) => w.table === 'child_phone_bindings')).toEqual([]);
      expect(await persona().get(PH.coach)).toBeNull();
    } finally { redis.set.mockImplementation(realSet); }
  });

  test('two reads at once after the persona ran out put the phone back once (one restore holds the phone)', async () => {
    world();
    await tap('fresh');
    redis.__keys.delete(persona()._key(NORM.coach));            // a day of silence
    await Promise.all([persona().get(PH.coach), persona().get(PH.coach)]);   // e.g. the resolver and the binder
    expect(inserted().map((r) => r.canonical_id)).toEqual(['s-old']);
    expect(await keptRec()).toBeNull();
    for (const k of redis.__keys.keys()) expect(k).not.toMatch(/^wq:persona:lock:/);   // the hold is let go
  });

  test('a reader that saw the record but gets the hold only after the first restore finds it gone and does nothing', async () => {
    world();
    await tap('fresh');
    redis.__keys.delete(persona()._key(NORM.coach));
    const realNX = redis.setNX.getMockImplementation();
    const realDel = redis.delete.getMockImplementation();
    let released;
    const firstDone = new Promise((r) => { released = r; });
    let calls = 0;
    redis.setNX.mockImplementation(async (k, v, t) => { calls += 1; if (calls === 2) await firstDone; return realNX(k, v, t); });
    redis.delete.mockImplementation(async (k) => { const out = await realDel(k); if (/^wq:persona:lock:/.test(k)) released(); return out; });
    try {
      await Promise.all([persona().get(PH.coach), persona().get(PH.coach)]);
    } finally { redis.setNX.mockImplementation(realNX); redis.delete.mockImplementation(realDel); }
    expect(calls).toBe(2);
    expect(inserted().map((r) => r.canonical_id)).toEqual(['s-old']);
  });

  test('one hashed persona key and one hashed record key; each read slides the persona\'s day', async () => {
    world();
    await tap('fresh');
    const keys = [...redis.__keys.keys()].filter((k) => k.startsWith('wq:persona:'));
    expect(keys.filter((k) => /^wq:persona:[0-9a-f]{32}$/.test(k))).toHaveLength(1);
    expect(keys.filter((k) => /^wq:persona:kept:[0-9a-f]{32}$/.test(k))).toHaveLength(1);
    expect(keys).toHaveLength(2);
    for (const k of keys) expect(k).not.toContain(NORM.coach);
    redis.expire.mockClear();
    await persona().get(PH.coach);
    expect(redis.expire).toHaveBeenCalledWith(persona()._key(NORM.coach), 24 * 3600);
  });

  test('every tap forgets the cached answer for the phone, once', async () => {
    world();
    const spy = jest.spyOn(Role, 'forgetDoorVerdict');
    for (const as of ['fresh', 'teacher_empty', 'real']) {
      spy.mockClear();
      await tap(as);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(NORM.coach);
    }
    spy.mockRestore();
  });

  test('the next link: the one question after a new phone, the home after the other two', async () => {
    world();
    expect(sideOf((await (await tap('fresh')).json()).next)).toBe('unknown');
    expect(sideOf((await (await tap('teacher_empty')).json()).next)).toBe('teacher');
    expect(sideOf((await (await tap('real')).json()).next)).toBe('teacher');
  });

  test('across the three taps nothing is written outside the phone links (no student, reading or user row)', async () => {
    world();
    await tap('fresh');
    mockDb.tables.child_phone_bindings.push({ id: 'b-walk', canonical_id: 's-walk', phone_norm: NORM.coach, via: 'guest', bound_at: new Date(Date.now() + 1000).toISOString(), revoked_at: null, expires_at: iso(Date.now() + 90 * 24 * HOUR) });
    await tap('teacher_empty');
    await tap('real');
    expect(mockDb.writes.length).toBeGreaterThan(0);
    expect([...new Set(mockDb.writes.map((w) => w.table))]).toEqual(['child_phone_bindings']);
  });
});

describe('6 · nothing logs the phone or the user id', () => {
  test('every log line, event and Redis key across the three taps', async () => {
    world();
    await tap('fresh');
    await resolve();
    await tap('teacher_empty');
    await tap('real');
    const said = JSON.stringify([logger.logToFile.mock.calls, logger.logError.mock.calls, logEvent.mock.calls]);
    for (const s of [PH.coach, NORM.coach, 'u-coach']) expect(said).not.toContain(s);
    const personaEvents = logEvent.mock.calls.filter(([n]) => n === 'web_quiz.test_persona').map(([, p]) => p);
    expect(personaEvents.map((p) => p.as)).toEqual(['fresh', 'teacher_empty', 'real']);
    for (const k of redis.__keys.keys()) { expect(k).not.toContain(NORM.coach); expect(k).not.toContain(PH.coach.replace(/\D/g, '')); }
  });
});

describe('7 · the eraser runs once per "Start as a new phone" tap, never on the others', () => {
  test('the phone-wide erase, read off the table writes (the real repo; no spy)', async () => {
    world();
    // the phone-wide erase is the one bindings update filtered by this phone, revoked as a STOP
    const phoneWide = () => mockDb.writes.filter((w) => w.table === 'child_phone_bindings' && w.fields
      && w.fields.revoked_by === 'stop' && w.filters.some(([op, c, v]) => op === 'eq' && c === 'phone_norm' && v === NORM.coach));
    await tap('fresh');
    expect(phoneWide()).toHaveLength(1);
    expect(phoneWide()[0].fields).toEqual({ phone_norm: null, revoked_at: expect.any(String), revoked_by: 'stop' });
    await tap('teacher_empty');
    await tap('real');
    expect(phoneWide()).toHaveLength(1);
    // the table double keeps no inserts: the link "real" put back is laid in by hand, so the next erase finds it
    mockDb.tables.child_phone_bindings.push({ id: 'b-back', canonical_id: 's-old', phone_norm: NORM.coach, via: 'save', bound_at: iso(Date.now()), revoked_at: null, expires_at: iso(Date.now() + 90 * 24 * HOUR) });
    await tap('fresh');
    expect(phoneWide()).toHaveLength(2);
  });
});

describe('never on staging or production', () => {
  test.each(['production', 'prod', 'staging'])('RAILWAY_ENVIRONMENT_NAME=%s → OFF whatever the switch says', async (env) => {
    world();
    process.env.RAILWAY_ENVIRONMENT_NAME = env;
    expect(await persona().flagOn()).toBe(false);
    const t = await mint();
    expect(await (await land(t)).text()).toBe(Page.buildRolePage({ t, lang: 'bi' }).html);
    expect((await tap('fresh', t)).status).toBe(404);
  });
});

describe('the edge forwards /api/go/persona path-for-path', () => {
  test('{t, as} only; the bot\'s 404 falls through', async () => {
    const calls = [];
    const callBot = async (method, p, req, body) => {
      calls.push({ method, p, body });
      return body.as === 'real' ? { status: 404, body: { off: true } } : { status: 200, body: { done: true, as: body.as } };
    };
    const app = express();
    app.use(createQuizGoRouter({ callBot }));
    app.use((req, res) => res.status(299).send('spa'));
    const s = await new Promise((ok) => { const x = app.listen(0, '127.0.0.1', () => ok(x)); });
    const url = `http://127.0.0.1:${s.address().port}/api/go/persona`;
    const TOK = 'eyJrIjoiZ28ifQ.AAAAAAAAAAAAAAAAAAAAAA';
    const send = (b) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const a = await send({ t: TOK, as: 'fresh', extra: 'x' });
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({ done: true, as: 'fresh' });
    expect(calls[0]).toEqual({ method: 'POST', p: '/api/internal/go/persona', body: { t: TOK, as: 'fresh' } });
    expect((await send({ t: TOK, as: 'real' })).status).toBe(299);
    expect(calls[1].body).toEqual({ t: TOK, as: 'real' });
    await send({ t: TOK, as: 'drop table' });
    expect(calls[2].body).toEqual({ t: TOK });
    await new Promise((ok) => s.close(ok));
  });
});
