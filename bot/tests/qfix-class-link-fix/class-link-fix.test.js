'use strict';
/**
 * Three gaps on the standing class link (web-quiz-class-link.js), each driven through arrive()/teacher()/letter()/pick():
 *   1. a shared phone: "Whose turn?" also offers the teacher step, so a sibling can get in; the sibling's high pick
 *      joins the same phone record, so the next "Whose turn?" lists both;
 *   2. the hub token a pick mints carries the class's Urdu (l: 'ur') for a teacher who reads Urdu, and no `l` otherwise;
 *   3. Redis down: a high pick cannot be remembered, so its token keeps the hub's 7 days, never the 28-day horizon.
 *
 * Real modules (class link, hub device record, token, roster) on the faked boundaries only: Supabase (in memory),
 * Redis (a Map with TTLs, and a switch for "down"), the loggers and the event key module. Fixture names are invented.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  const state = { up: true };
  const live = (k) => {
    const e = store.get(k);
    if (!e) return null;
    if (e.until !== null && Date.now() >= e.until) { store.delete(k); return null; }
    return e;
  };
  const put = (k, v, ttl) => store.set(k, { v, ttl: ttl || null, until: ttl ? Date.now() + ttl * 1000 : null });
  return {
    _store: store,
    _state: state,
    isAvailable: () => state.up,
    get: async (k) => { if (!state.up) return null; const e = live(k); return e ? e.v : null; },
    set: async (k, v, ttl = null) => { if (!state.up) return false; put(k, v, ttl); return true; },
    setNX: async (k, v, ttl = null) => { if (!state.up) return false; if (live(k)) return false; put(k, v, ttl); return true; },
    delete: async (k) => store.delete(k),
  };
});
jest.mock('../../shared/services/quiz/web-quiz-kid', () => ({
  kid: (id) => `kid:${String(id).slice(-4)}`,
  dk: () => 'dk',
  cls: () => 'clshash00000',
  envelope: (f) => ({ ev_v: 2, ...f }),
}));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const redis = require('../../shared/services/cache/railway-redis.service');
const T = require('../../shared/services/quiz/web-quiz-token');
const Roster = require('../../shared/services/quiz/web-quiz-identity-roster');
const Flags = require('../../shared/services/quiz/web-quiz-class-link-flags');
const HubDevice = require('../../shared/services/quiz/web-quiz-hub-device');
const CL = require('../../shared/services/quiz/web-quiz-class-link');

const DAY = 24 * 3600;
const NOW = new Date('2026-10-16T06:00:00Z');
const SCHOOL = '5c400000-0000-4000-8000-000000000001';
const T1 = '7e000000-0000-4000-8000-000000000001';
const T2 = '7e000000-0000-4000-8000-000000000002';
const C1 = 'c1a55000-0000-4000-8000-000000000001';
const C2 = 'c1a55000-0000-4000-8000-000000000002';
const ZK = 'c0000001-0000-4000-8000-000000000001';
const HA = 'c0000001-0000-4000-8000-000000000002';
const BA = 'c0000001-0000-4000-8000-000000000003';
const DEV = 'SharedPhoneDevice_0001';

let db;
function seed(lang = 'en') {
  db = {
    app_settings: [
      { key: 'web_quiz_challenge', value: true }, { key: 'web_quiz_challenge_v2', value: true }, { key: 'web_quiz_class_link', value: true },
    ],
    users: [
      { id: T1, name: 'Miss Rabia Testwala', school_id: SCHOOL, preferred_language: lang },
      { id: T2, name: 'Imran Testwala', school_id: SCHOOL, preferred_language: 'en' },
    ],
    classes: [
      { id: C1, school_id: SCHOOL, grade_code: '3', section: 'A', is_active: true },
      { id: C2, school_id: SCHOOL, grade_code: '4', section: 'A', is_active: true },
    ],
    class_teachers: [{ class_id: C1, teacher_user_id: T1, is_active: true }, { class_id: C2, teacher_user_id: T2, is_active: true }],
    class_enrollments: [ZK, HA, BA].map((id, i) => ({ class_id: C1, student_id: id, roll_number: i + 1, is_active: true })),
    student_lists: [],
    students: [
      { id: ZK, student_name: 'Zara Test', student_name_urdu: null, father_name: null, is_active: true, status: 'active', created_at: '2026-04-02T00:00:00Z' },
      { id: HA, student_name: 'Hina Test', student_name_urdu: null, father_name: null, is_active: true, status: 'active', created_at: '2026-04-02T00:00:00Z' },
      { id: BA, student_name: 'Bilal Test', student_name_urdu: null, father_name: null, is_active: true, status: 'active', created_at: '2026-04-02T00:00:00Z' },
    ],
    quiz_sessions: [],
    class_links: [],
  };
  Object.assign(supabase, makeFake(db, { uniques: { class_links: ['code'] } }));
}

const FAKE_DATE_ONLY = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'];
const nowS = () => Math.floor(Date.now() / 1000);
const advance = (s) => jest.setSystemTime(Date.now() + s * 1000);

beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.WEB_QUIZ_BASE_URL = 'https://quiz.example.org'; });
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: FAKE_DATE_ONLY, now: NOW });
  seed();
  Flags._resetCache();
  Roster._resetCache();
  redis._store.clear();
  redis._state.up = true;
  jest.clearAllMocks();
});
afterEach(() => { jest.useRealTimers(); });

const hubToken = (href) => href.replace(/^\/h\//, '').replace(/\?.*$/, '');
async function linkFor() {
  const m = await CL.mint({ teacherId: T1, classId: C1, now: new Date() });
  expect(m.ok).toBe(true);
  return m.code;
}
// From a teacher step (arrive's, or "Whose turn?"'s `other`): the right teacher → a letter → the first chip, picked.
async function pickFromTeacherStep(code, step, letter, device) {
  expect(step.step).toBe('teacher');
  const right = step.teachers.find((t) => t.name === 'Rabia Testwala');
  const b = await CL.teacher({ code, s: step.s, tk: right.tk });
  expect(b.step).toBe('letter');
  const c = await CL.letter({ code, s: b.s, letter });
  return CL.pick({ code, s: c.s, chip: c.kids[0].chip, device_ref: device });
}
async function pickAndOpen(code, step, letter, device) {
  const p = await pickFromTeacherStep(code, step, letter, device);
  expect((await HubDevice.deviceTrusted(hubToken(p.href), device)).ok).toBe(true);
  return T.verify(hubToken(p.href), 'h');
}

describe('1. a shared phone: "Whose turn?" also opens the teacher step', () => {
  test('a remembered phone gets "Whose turn?" with an `other` teacher step; a sibling walks it and both are listed next time', async () => {
    const code = await linkFor();
    const first = await pickAndOpen(code, await CL.arrive({ code, device_ref: DEV }), 'H', DEV);
    expect(first.cl).toMatchObject({ s: 'roster_pick', q: 'high' });

    advance(DAY);
    const a = await CL.arrive({ code, device_ref: DEV });
    expect(a.step).toBe('who');
    expect(a.kids.map((k) => k.first)).toEqual(['Hina']);
    // the sibling's door: the same teacher step a fresh phone gets, signed as a teacher step for this code
    expect(a.other).toBeTruthy();
    expect(a.other.step).toBe('teacher');
    expect(a.other.teachers.map((t) => t.name).sort()).toEqual(['Imran Testwala', 'Rabia Testwala']);
    a.other.teachers.forEach((t) => expect(Object.keys(t).sort()).toEqual(['name', 'tk']));
    expect(T.verify(a.other.s, 'cl')).toMatchObject({ c: code, st: 'teacher' });

    const sib = await pickAndOpen(code, a.other, 'Z', DEV);
    expect(sib.ids).toEqual([ZK]);
    expect(sib.cl).toMatchObject({ s: 'roster_pick', q: 'high' });
    expect(sib.exp - nowS()).toBe(28 * DAY);

    advance(DAY);
    const again = await CL.arrive({ code, device_ref: DEV });
    expect(again.step).toBe('who');
    expect(again.kids.map((k) => k.first).sort()).toEqual(['Hina', 'Zara']);
    // the class-link record on this phone holds both high picks
    const rec = [...redis._store.entries()].find(([k]) => k.startsWith('wq:cl:mem:'));
    expect(Object.keys(rec[1].v).sort()).toEqual([HA, ZK].sort());
  });

  test('the teacher\'s own visit: the `other` step stays practice', async () => {
    const code = await linkFor();
    await pickAndOpen(code, await CL.arrive({ code, device_ref: DEV }), 'H', DEV);
    const jt = CL.signTeacherPreview(code);
    const a = await CL.arrive({ code, device_ref: DEV, jt });
    expect(a.step).toBe('who');
    expect(T.verify(a.other.s, 'cl')).toMatchObject({ st: 'teacher', p: 1 });
  });
});

describe('2. the hub token carries the class\'s Urdu', () => {
  test.each([
    ['ur', 'ur'],
    ['en', undefined],
    [null, undefined],
    ['fr', undefined],
  ])('teacher preferred_language %p → hub token l %p (stranger pick and "Whose turn?" re-pick)', async (teacherLang, want) => {
    seed(teacherLang);
    const code = await linkFor();
    const p = await pickFromTeacherStep(code, await CL.arrive({ code, device_ref: DEV }), 'B', DEV);
    expect(T.verify(hubToken(p.href), 'h').l).toBe(want);
    await HubDevice.deviceTrusted(hubToken(p.href), DEV);
    const w = await CL.arrive({ code, device_ref: DEV });
    expect(w.step).toBe('who');
    const r = await CL.pick({ code, s: w.s, chip: w.kids[0].chip, device_ref: DEV });
    expect(T.verify(hubToken(r.href), 'h').l).toBe(want);
  });
});

describe('3. Redis down: no 28-day token for a phone nothing remembers', () => {
  test('a high pick with Redis down mints the hub\'s 7 days', async () => {
    const code = await linkFor();
    const step = await CL.arrive({ code, device_ref: DEV });
    redis._state.up = false;
    const p = await pickFromTeacherStep(code, step, 'B', DEV);
    const tok = T.verify(hubToken(p.href), 'h');
    expect(tok.cl).toMatchObject({ q: 'high' });
    expect(tok.exp - nowS()).toBe(T.HUB_TTL_S);
  });

  test('Redis up: the same pick still gets 28 days (unchanged)', async () => {
    const code = await linkFor();
    const p = await pickFromTeacherStep(code, await CL.arrive({ code, device_ref: DEV }), 'B', DEV);
    expect(T.verify(hubToken(p.href), 'h').exp - nowS()).toBe(28 * DAY);
  });
});
