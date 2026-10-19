'use strict';
/**
 * How long a phone remembers a class-link child (web-quiz-class-link.js pick): a HIGH-confidence pick is remembered
 * for min(the link's time left, 28 days) — the hub token it mints carries that exp, and a "Whose turn?" re-mint for
 * that child on that phone carries the SAME exp. A LOW pick (a homonym) keeps the hub token's 7 days and its 'low'.
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
const DEV = 'MemoryHorizonDevice_01';
const DEV2 = 'MemoryHorizonDevice_02';

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
// Every TTL this phone's memory was written with, in seconds (the Map keeps what each set was given).
const ttls = () => [...redis._store.values()].map((e) => e.ttl).filter((x) => x !== null);
// The last second any of it is kept until.
const lastUntilS = () => Math.max(...[...redis._store.values()].map((e) => e.until).filter((x) => x !== null)) / 1000;

describe('a high pick is remembered as long as the link (capped at 28 days)', () => {
  test('a high pick, the clock 8 days on → "Whose turn?" still, with that child\'s chip only', async () => {
    const code = await linkFor();
    const tok = await pickAndOpen(code, 'B', DEV);
    expect(tok.cl).toEqual({ c: C1, s: 'roster_pick', q: 'high', h: false });
    advance(8 * DAY);
    const a = await CL.arrive({ code, device_ref: DEV });
    expect(a.step).toBe('who');
    expect(a.kids.map((k) => k.first)).toEqual(['Bilal']);
    // another phone is still a stranger
    expect((await CL.arrive({ code, device_ref: DEV2 })).step).toBe('teacher');
  });

  test('the remembered chip still opens 27 days on, and is gone 28 days on (the stranger path again)', async () => {
    const code = await linkFor();
    await pickAndOpen(code, 'B', DEV);
    advance(27 * DAY);
    const a = await CL.arrive({ code, device_ref: DEV });
    expect(a.step).toBe('who');
    const p = await CL.pick({ code, s: a.s, chip: a.kids[0].chip, device_ref: DEV });
    expect(T.verify(hubToken(p.href), 'h')).toMatchObject({ ids: [BA], cl: { s: 'remembered', q: 'high' } });
    advance(1 * DAY);
    expect((await CL.arrive({ code, device_ref: DEV })).step).toBe('teacher');
  });

  test('a low pick (a homonym), 8 days on → the stranger path (today\'s behaviour), its token 7 days and still low', async () => {
    const code = await linkFor();
    const t0 = nowS();
    const tok = await pickAndOpen(code, 'Z', DEV);
    expect(tok.cl).toEqual({ c: C1, s: 'roster_pick', q: 'low', h: true });
    expect(tok.exp).toBe(t0 + T.HUB_TTL_S);
    expect(Math.max(...ttls())).toBeLessThanOrEqual(T.HUB_TTL_S);
    advance(6 * DAY);
    expect((await CL.arrive({ code, device_ref: DEV })).step).toBe('who'); // within today's 7 days: unchanged
    advance(2 * DAY);
    const a = await CL.arrive({ code, device_ref: DEV });
    expect(a.step).toBe('teacher');
    expect(JSON.stringify(a)).not.toMatch(/Zara|Bilal/);
  });
});

describe('a sibling on the same phone: the high pick\'s memory never stretches a low pick\'s', () => {
  // Step tokens name the link, not the phone: the walk is done once, the pick and the hub open happen on DEV.
  async function pickOn(code, letter, device, i = 0) {
    const c = await walkStranger(code, letter, DEV2);
    const p = await CL.pick({ code, s: c.s, chip: c.kids[i].chip, device_ref: device });
    expect((await HubDevice.deviceTrusted(hubToken(p.href), device)).ok).toBe(true);
    return T.verify(hubToken(p.href), 'h');
  }
  test.each([['low first', ['Z', 'B']], ['high first', ['B', 'Z']]])('%s, 8 days on → "Whose turn?" with the high child only', async (_, order) => {
    const code = await linkFor();
    for (const l of order) await pickOn(code, l, DEV);
    advance(6 * DAY);
    expect((await CL.arrive({ code, device_ref: DEV })).kids.map((k) => k.first).sort()).toEqual(['Bilal', 'Zara']);
    advance(2 * DAY);
    const a = await CL.arrive({ code, device_ref: DEV });
    expect(a.step).toBe('who');
    expect(a.kids.map((k) => k.first)).toEqual(['Bilal']);
  });
});

describe('the horizon: never past 28 days, never past the link\'s expires_at', () => {
  test('a link with a whole term left → the token exp and every memory TTL are exactly 28 days', async () => {
    const code = await linkFor();
    const t0 = nowS();
    const tok = await pickAndOpen(code, 'B', DEV);
    expect(tok.exp).toBe(t0 + 28 * DAY);
    expect(Math.max(...ttls())).toBe(28 * DAY);
  });

  test('a link ending in 3 days → the token exp is the link\'s expires_at, no memory outlives it', async () => {
    const code = await linkFor();
    const end = new Date(NOW.getTime() + 3 * DAY * 1000 + 1234);
    db.class_links[0].expires_at = end.toISOString();
    const tok = await pickAndOpen(code, 'B', DEV);
    expect(tok.exp).toBe(Math.floor(end.getTime() / 1000));
    expect(tok.exp).toBeLessThan(nowS() + T.HUB_TTL_S);
    expect(lastUntilS()).toBeLessThanOrEqual(tok.exp);
    advance(2 * DAY);
    expect((await CL.arrive({ code, device_ref: DEV })).step).toBe('who');
  });
});

describe('the "Whose turn?" re-mint carries the pick\'s exp', () => {
  test('the re-minted hub token\'s exp = the pick\'s exp, days later; still remembered/high', async () => {
    const code = await linkFor();
    const first = await pickAndOpen(code, 'B', DEV);
    advance(8 * DAY);
    const a = await CL.arrive({ code, device_ref: DEV });
    const p = await CL.pick({ code, s: a.s, chip: a.kids[0].chip, device_ref: DEV });
    const again = T.verify(hubToken(p.href), 'h');
    expect(again).toMatchObject({ ids: [BA], src: 'cl', cl: { c: C1, s: 'remembered', q: 'high', h: false } });
    expect(again.exp).toBe(first.exp);
    // opening the re-minted hub never stretches the memory past the pick's horizon
    expect((await HubDevice.deviceTrusted(hubToken(p.href), DEV)).ok).toBe(true);
    expect(lastUntilS()).toBeLessThanOrEqual(first.exp);
    advance(first.exp - nowS());
    expect((await CL.arrive({ code, device_ref: DEV })).step).toBe('teacher');
  });

  test('golden: a teacher-quiz device with no high pick behind it → the re-mint keeps today\'s 7 days', async () => {
    db.quiz_sessions.push({ id: 's1', student_id: ZK, device_ref: DEV, created_at: '2026-10-01T00:00:00Z' });
    const code = await linkFor();
    const a = await CL.arrive({ code, device_ref: DEV });
    expect(a.step).toBe('who');
    const t0 = nowS();
    const p = await CL.pick({ code, s: a.s, chip: a.kids[0].chip, device_ref: DEV });
    expect(T.verify(hubToken(p.href), 'h')).toMatchObject({ ids: [ZK], exp: t0 + T.HUB_TTL_S, cl: { s: 'remembered', q: 'high' } });
    expect(redis._store.size).toBe(0);
  });

  test('the teacher\'s own visit (practice) is not remembered past today\'s 7 days', async () => {
    const code = await linkFor();
    const jt = CL.signTeacherPreview(code);
    const a = await CL.arrive({ code, device_ref: DEV, jt });
    const right = a.teachers.find((t) => t.name === 'Rabia Testwala');
    const b = await CL.teacher({ code, s: a.s, tk: right.tk });
    const c = await CL.letter({ code, s: b.s, letter: 'B' });
    const t0 = nowS();
    const p = await CL.pick({ code, s: c.s, chip: c.kids[0].chip, device_ref: DEV });
    expect(T.verify(hubToken(p.href), 'h')).toMatchObject({ exp: t0 + T.HUB_TTL_S, cl: { q: 'high', m: 'practice' } });
    expect(redis._store.size).toBe(0);
  });
});

describe('other routes are untouched', () => {
  test('a hub link from the bot (signHub) and the handset path keep 7 days', async () => {
    const t0 = nowS();
    expect(T.verify(T.signHub([BA]), 'h').exp).toBe(t0 + T.HUB_TTL_S);
    expect(await HubDevice.rememberKids([BA], DEV)).toBe(true);
    expect(Math.max(...ttls())).toBe(T.HUB_TTL_S);
  });
});
