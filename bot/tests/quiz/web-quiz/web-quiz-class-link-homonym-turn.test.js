'use strict';
/**
 * "Whose turn?" on the class link (web-quiz-class-link.js pick, the 'who' step) keeps a homonym pick LOW until it is
 * promoted (IDENTITY §2(b) rows 1 and 6). A remembered child is high when this phone's high-pick memory names them,
 * or the phone played a teacher's quiz as them; a child remembered only by the hub's own device record (written for
 * EVERY hub open, a low pick's too) whose first name two roster children share stays low, homonym_in_list true.
 * A unique first name is high, as before.
 *
 * Real modules (class link, hub device record, token, roster) on the faked boundaries only: Supabase (in memory),
 * Redis (a Map that honours each key's TTL against the clock), the loggers and the event key module. The clock is
 * frozen (Date only) and advanced by hand. Fixture names are invented.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  const live = (k) => {
    const e = store.get(k);
    if (!e) return null;
    if (e.until !== null && Date.now() >= e.until) { store.delete(k); return null; }
    return e;
  };
  const put = (k, v, ttl) => store.set(k, { v, ttl: ttl || null, until: ttl ? Date.now() + ttl * 1000 : null });
  return {
    _store: store,
    isAvailable: () => true,
    get: async (k) => { const e = live(k); return e ? e.v : null; },
    set: async (k, v, ttl = null) => { put(k, v, ttl); return true; },
    setNX: async (k, v, ttl = null) => { if (live(k)) return false; put(k, v, ttl); return true; },
    delete: async (k) => store.delete(k),
  };
});
jest.mock('../../../shared/services/quiz/web-quiz-kid', () => ({
  kid: (id) => `kid:${String(id).slice(-4)}`,
  dk: () => 'dk',
  cls: () => 'clshash00000',
  envelope: (f) => ({ ev_v: 2, ...f }),
}));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Roster = require('../../../shared/services/quiz/web-quiz-identity-roster');
const Flags = require('../../../shared/services/quiz/web-quiz-class-link-flags');
const HubDevice = require('../../../shared/services/quiz/web-quiz-hub-device');
const CL = require('../../../shared/services/quiz/web-quiz-class-link');

const DAY = 24 * 3600;
const NOW = new Date('2026-10-16T06:00:00Z');
const SCHOOL = '5c400000-0000-4000-8000-000000000001';
const T1 = '7e000000-0000-4000-8000-000000000001';
const T2 = '7e000000-0000-4000-8000-000000000002';
const C1 = 'c1a55000-0000-4000-8000-000000000001';
const C2 = 'c1a55000-0000-4000-8000-000000000002';
const ZK = 'c0000001-0000-4000-8000-000000000001';
const ZM = 'c0000001-0000-4000-8000-000000000002';
const BA = 'c0000001-0000-4000-8000-000000000003';
const DEV = 'HomonymTurnPhoneDev_01';
const DEV2 = 'HomonymTurnPhoneDev_02';

let db;
function seed() {
  db = {
    app_settings: [
      { key: 'web_quiz_challenge', value: true }, { key: 'web_quiz_challenge_v2', value: true }, { key: 'web_quiz_class_link', value: true },
    ],
    users: [
      { id: T1, name: 'Miss Rabia Testwala', school_id: SCHOOL, preferred_language: 'en' },
      { id: T2, name: 'Imran Testwala', school_id: SCHOOL, preferred_language: 'en' },
    ],
    classes: [
      { id: C1, school_id: SCHOOL, grade_code: '3', section: 'A', is_active: true },
      { id: C2, school_id: SCHOOL, grade_code: '4', section: 'A', is_active: true },
    ],
    class_teachers: [{ class_id: C1, teacher_user_id: T1, is_active: true }, { class_id: C2, teacher_user_id: T2, is_active: true }],
    class_enrollments: [ZK, ZM, BA].map((id, i) => ({ class_id: C1, student_id: id, roll_number: i + 1, is_active: true })),
    student_lists: [],
    students: [
      { id: ZK, student_name: 'Zara Khan', student_name_urdu: null, father_name: null, is_active: true, status: 'active', created_at: '2026-04-02T00:00:00Z' },
      { id: ZM, student_name: 'Zara Malik', student_name_urdu: null, father_name: null, is_active: true, status: 'active', created_at: '2026-04-02T00:00:00Z' },
      { id: BA, student_name: 'Bilal Testwala', student_name_urdu: null, father_name: null, is_active: true, status: 'active', created_at: '2026-04-02T00:00:00Z' },
    ],
    quiz_sessions: [],
    class_links: [],
  };
  Object.assign(supabase, makeFake(db, { uniques: { class_links: ['code'] } }));
}

// Only Date is frozen: the timers the modules use stay real.
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
  jest.clearAllMocks();
});
afterEach(() => { jest.useRealTimers(); });

const hubToken = (href) => href.replace(/^\/h\//, '').replace(/\?.*$/, '');
async function linkFor() {
  const m = await CL.mint({ teacherId: T1, classId: C1, now: new Date() });
  expect(m.ok).toBe(true);
  return m.code;
}
async function walkStranger(code, letter, device) {
  const a = await CL.arrive({ code, device_ref: device });
  expect(a.step).toBe('teacher');
  const right = a.teachers.find((t) => t.name === 'Rabia Testwala');
  const b = await CL.teacher({ code, s: a.s, tk: right.tk });
  return CL.letter({ code, s: b.s, letter });
}
// The stranger path → a pick → the hub opened on the same phone (the hub's own trust step), as a child does it.
async function pickAndOpen(code, letter, device, i = 0) {
  const c = await walkStranger(code, letter, device);
  const p = await CL.pick({ code, s: c.s, chip: c.kids[i].chip, device_ref: device });
  const tok = T.verify(hubToken(p.href), 'h');
  expect((await HubDevice.deviceTrusted(hubToken(p.href), device)).ok).toBe(true);
  return tok;
}
const memKeys = () => [...redis._store.keys()].filter((k) => k.startsWith('wq:cl:mem:'));
async function whoPick(code, device = DEV) {
  const a = await CL.arrive({ code, device_ref: device });
  expect(a.step).toBe('who');
  const p = await CL.pick({ code, s: a.s, chip: a.kids[0].chip, device_ref: device });
  return { a, tok: T.verify(hubToken(p.href), 'h') };
}

describe('"Whose turn?" keeps a homonym pick low until it is promoted', () => {
  test('a low homonym pick, 2 days on → Whose turn? → still low, h:true, today\'s 7 days', async () => {
    const code = await linkFor();
    const first = await pickAndOpen(code, 'Z', DEV);
    expect(first.cl).toEqual({ c: C1, s: 'roster_pick', q: 'low', h: true });
    advance(2 * DAY);
    const t0 = nowS();
    const { a, tok } = await whoPick(code);
    expect(a.kids.map((k) => k.first)).toEqual(['Zara']);
    expect(tok.ids).toEqual([first.ids[0]]);
    expect(tok.cl).toEqual({ c: C1, s: 'remembered', q: 'low', h: true });
    expect(tok.exp).toBe(t0 + T.HUB_TTL_S);
    // a low pick is never written to the phone's high-pick memory
    expect(memKeys()).toEqual([]);
  });

  test('the run row written by a low "Whose turn?" pick carries id_confidence low and homonym_in_list true', async () => {
    const code = await linkFor();
    await pickAndOpen(code, 'Z', DEV);
    advance(2 * DAY);
    const { tok } = await whoPick(code);
    expect(CL.runColumns(tok.cl, tok.ids[0])).toEqual({
      via: 'class_link', class_id: C1, id_src: 'remembered', id_confidence: 'low', homonym_in_list: true, canonical_id: tok.ids[0],
    });
  });

  test('golden: a high pick (a unique name), 2 days on → Whose turn? → high, as today', async () => {
    const code = await linkFor();
    const first = await pickAndOpen(code, 'B', DEV);
    expect(first.cl).toEqual({ c: C1, s: 'roster_pick', q: 'high', h: false });
    advance(2 * DAY);
    const { tok } = await whoPick(code);
    expect(tok).toMatchObject({ ids: [BA], exp: first.exp, cl: { c: C1, s: 'remembered', q: 'high', h: false } });
  });

  test('golden: a unique name remembered only by the hub\'s device record → high, today\'s 7 days', async () => {
    const code = await linkFor();
    expect(await HubDevice.rememberKids([BA], DEV)).toBe(true);
    const t0 = nowS();
    const { tok } = await whoPick(code);
    expect(tok).toMatchObject({ ids: [BA], exp: t0 + T.HUB_TTL_S, cl: { c: C1, s: 'remembered', q: 'high', h: false } });
  });

  test('a child in the high-pick memory record stays high on Whose turn?, even once a namesake joins the roster', async () => {
    // The class had one Zara when she was picked (a unique name: high, remembered); a second Zara is enrolled later.
    db.class_enrollments = db.class_enrollments.filter((e) => e.student_id !== ZM);
    const code = await linkFor();
    const first = await pickAndOpen(code, 'Z', DEV);
    expect(first).toMatchObject({ ids: [ZK], cl: { s: 'roster_pick', q: 'high', h: false } });
    db.class_enrollments.push({ class_id: C1, student_id: ZM, roll_number: 9, is_active: true });
    Roster._resetCache();
    expect((await walkStranger(code, 'Z', DEV2)).kids.map((k) => k.first)).toEqual(['Zara', 'Zara']);
    advance(2 * DAY);
    const { tok } = await whoPick(code);
    expect(tok).toMatchObject({ ids: [ZK], exp: first.exp, cl: { c: C1, s: 'remembered', q: 'high', h: false } });
  });

  test('golden: a phone that played a teacher\'s quiz as a homonym child → high, as today', async () => {
    db.quiz_sessions.push({ id: 's1', student_id: ZM, device_ref: DEV, created_at: '2026-10-01T00:00:00Z' });
    const code = await linkFor();
    const { tok } = await whoPick(code);
    expect(tok).toMatchObject({ ids: [ZM], cl: { c: C1, s: 'remembered', q: 'high', h: false } });
  });

  // The promotions (device_twice, a teacher confirm, the class round) are stored on child_identity.confirmed_at /
  // confirmed_by; no reader of them exists in the identity modules yet, so this step does not read them.
  test.todo('after a promotion (child_identity.confirmed_by device_twice / teacher / class_round) Whose turn? reads high');
});
