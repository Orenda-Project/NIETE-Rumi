'use strict';
/**
 * The standing class link /j/<code> (web-quiz-class-link.js): minting from the roster, the term, the arrival
 * gate (a device that played in the class vs a stranger device), the first-name chips with the homonym rule,
 * the pick's hub hand-off, the teacher's card and its forward link.
 *
 * Faked boundaries only: Supabase (in memory, filters applied), Redis (a Map), the loggers, and the event
 * key module (web-quiz-kid.js, mocked to fixed keys). Fixture names are invented.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    set: async (k, v) => { store.set(k, v); return true; },
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; },
    delete: async (k) => store.delete(k),
  };
});
jest.mock('../../../shared/services/quiz/web-quiz-kid', () => ({
  kid: (id) => `kid:${String(id).slice(-4)}`,
  dk: () => 'dk',
  cls: () => 'clshash00000',
  envelope: (f) => ({ ev_v: 2, ...f }),
}));

const fs = require('fs');
const path = require('path');
const { makeFake } = require('./fake-supabase');
const { strictColumns } = require('./schema-columns');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const redis = require('../../../shared/services/cache/railway-redis.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Roster = require('../../../shared/services/quiz/web-quiz-identity-roster');
const Flags = require('../../../shared/services/quiz/web-quiz-class-link-flags');
const CL = require('../../../shared/services/quiz/web-quiz-class-link');
const { renderPage } = require('../../../shared/templates/teacher-report.page');

const GOLDEN = path.join(__dirname, '__golden__', 'class-link-teacher-off.json');
const SCHOOL = '5c400000-0000-4000-8000-000000000001';
const T1 = '7e000000-0000-4000-8000-000000000001';
const T2 = '7e000000-0000-4000-8000-000000000002';
const T3 = '7e000000-0000-4000-8000-000000000003';
const T4 = '7e000000-0000-4000-8000-000000000004';
const C1 = 'c1a55000-0000-4000-8000-000000000001';
const C2 = 'c1a55000-0000-4000-8000-000000000002';
const C4 = 'c1a55000-0000-4000-8000-000000000004';
const ZK = 'c0000001-0000-4000-8000-000000000001';
const ZM = 'c0000001-0000-4000-8000-000000000002';
const BA = 'c0000001-0000-4000-8000-000000000003';
const MA = 'c0000001-0000-4000-8000-000000000004';
const OUT = 'c0000001-0000-4000-8000-000000000009';
const DEV_PLAYED = 'PlayedInClassDevice_01';
const DEV_FRESH = 'FreshStrangerDevice_02';
const ROSTER_NAMES = ['Zara', 'Bilal', 'Ayaan', 'Khan', 'Malik', 'Ahmed', 'Tariq', 'Muhammad', 'Sana'];

const STRICT_TABLES = ['class_links', 'users', 'classes', 'class_teachers', 'class_enrollments', 'quiz_sessions'];

let db;
function seed() {
  db = {
    app_settings: [
      { key: 'web_quiz_challenge', value: true }, { key: 'web_quiz_challenge_v2', value: true }, { key: 'web_quiz_class_link', value: true },
    ],
    users: [
      { id: T1, name: 'Miss Rabia Noor', school_id: SCHOOL, preferred_language: 'en' },
      { id: T2, name: 'Imran Shah', school_id: SCHOOL, preferred_language: 'ur' },
      { id: T3, name: 'Hina Gul', school_id: SCHOOL, preferred_language: 'ur' },
      { id: T4, name: 'Saad Mir', school_id: SCHOOL, preferred_language: 'en' },
    ],
    classes: [
      { id: C1, school_id: SCHOOL, grade_code: '3', section: 'A', is_active: true },
      { id: C2, school_id: SCHOOL, grade_code: '4', section: 'A', is_active: true },
      { id: C4, school_id: SCHOOL, grade_code: '5', section: 'B', is_active: true },
    ],
    class_teachers: [
      { class_id: C1, teacher_user_id: T1, is_active: true },
      { class_id: C2, teacher_user_id: T2, is_active: true },
      { class_id: C2, teacher_user_id: T3, is_active: true },
      { class_id: C4, teacher_user_id: T4, is_active: true },
    ],
    class_enrollments: [ZK, ZM, BA, MA].map((id, i) => ({ class_id: C1, student_id: id, roll_number: i + 1, is_active: true })),
    student_lists: [],
    students: [
      { id: ZK, student_name: 'Zara Khan', student_name_urdu: null, father_name: null, is_active: true, status: 'active', created_at: '2026-04-02T00:00:00Z' },
      { id: ZM, student_name: 'Zara Malik', student_name_urdu: null, father_name: null, is_active: true, status: 'active', created_at: '2026-04-02T00:00:00Z' },
      { id: BA, student_name: 'Bilal Ahmed', student_name_urdu: null, father_name: 'Tariq', is_active: true, status: 'active', created_at: '2026-04-02T00:00:00Z' },
      { id: MA, student_name: 'Muhammad Ayaan', student_name_urdu: null, father_name: null, is_active: true, status: 'active', created_at: '2026-04-02T00:00:00Z' },
      { id: OUT, student_name: 'Sana Testwala', is_active: true, status: 'active', created_at: '2026-04-02T00:00:00Z' },
    ],
    quiz_sessions: [
      { id: 's1', student_id: ZK, device_ref: DEV_PLAYED, created_at: '2026-10-01T00:00:00Z' },
      { id: 's2', student_id: OUT, device_ref: DEV_PLAYED, created_at: '2026-10-01T00:00:00Z' },
    ],
    class_links: [],
  };
  // A column outside the schema's set answers 42703 (a misspelt column fails here, not on the live database).
  Object.assign(supabase, strictColumns(makeFake(db, { uniques: { class_links: ['code'] } }), STRICT_TABLES));
}

beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.WEB_QUIZ_BASE_URL = 'https://quiz.example.org'; });
beforeEach(() => {
  seed();
  Flags._resetCache();
  Roster._resetCache();
  redis._store.clear();
  jest.clearAllMocks();
});

const names = (payload) => ROSTER_NAMES.filter((n) => JSON.stringify(payload).includes(n));
async function linkFor(classId = C1, teacherId = T1) {
  const m = await CL.mint({ teacherId, classId });
  expect(m.ok).toBe(true);
  return m.code;
}
async function walkStranger(code, letter, device = DEV_FRESH) {
  const a = await CL.arrive({ code, device_ref: device });
  const right = a.teachers.find((t) => t.name === 'Rabia Noor');
  const b = await CL.teacher({ code, s: a.s, tk: right.tk });
  return CL.letter({ code, s: b.s, letter });
}

// ── the term ───────────────────────────────────────────────────────────────────────────────────────
describe('termOf (IDENTITY §17, PKT boundaries)', () => {
  test.each([
    ['2026-03-31T18:59:59Z', '2025-26b', '2026-03-31T18:59:59.000Z'],
    ['2026-03-31T19:00:00Z', '2026-27a', '2026-09-30T18:59:59.000Z'],
    ['2026-09-30T18:59:59Z', '2026-27a', '2026-09-30T18:59:59.000Z'],
    ['2026-09-30T19:00:00Z', '2026-27b', '2027-03-31T18:59:59.000Z'],
    ['2026-10-15T12:00:00Z', '2026-27b', '2027-03-31T18:59:59.000Z'],
    ['2027-01-10T00:00:00Z', '2026-27b', '2027-03-31T18:59:59.000Z'],
  ])('%s → %s, expires %s', (at, code, expires) => {
    expect(CL.termOf(new Date(at))).toEqual({ term_code: code, expires_at: expires });
  });
});

// ── (c) minting ────────────────────────────────────────────────────────────────────────────────────
describe('(c) the code and the roster-minted link', () => {
  test('the code: 10 characters of ABCDEFGHJKLMNPQRSTUVWXYZ23456789 from crypto.randomInt, never the class id', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) {
      const c = CL.newCode();
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
      expect(c.length).toBeGreaterThanOrEqual(8);
      seen.add(c);
    }
    expect(seen.size).toBe(200);
    expect(CL.newCode(() => 0)).toBe('AAAAAAAAAA');
    expect(CL.CODE_RX.test('KZ7QW3MNPX')).toBe(true);
    ['KZ7QW3MNPI', 'KZ7QW3MNP0', 'KZ7QW31', 'kz7qw3mnpx'].forEach((bad) => expect(CL.CODE_RX.test(bad)).toBe(false));
  });

  test('minted for a class the teacher has with an enrolled roster; one active link per (class, term)', async () => {
    const m = await CL.mint({ teacherId: T1, classId: C1, now: new Date('2026-10-15T12:00:00Z') });
    expect(m).toMatchObject({ ok: true, term_code: '2026-27b', expires_at: '2027-03-31T18:59:59.000Z' });
    expect(db.class_links).toHaveLength(1);
    expect(db.class_links[0]).toMatchObject({ code: m.code, class_id: C1, teacher_id: T1, term_code: '2026-27b', revoked_at: null });
    const again = await CL.mint({ teacherId: T1, classId: C1, now: new Date('2026-10-16T12:00:00Z') });
    expect(again.code).toBe(m.code);
    expect(db.class_links).toHaveLength(1);
  });

  test('a teacher with no such class is refused; a class with no enrolled child is refused', async () => {
    expect(await CL.mint({ teacherId: T1, classId: C2 })).toEqual({ ok: false, reason: 'not_your_class' });
    expect(await CL.mint({ teacherId: T4, classId: C4 })).toEqual({ ok: false, reason: 'no_roster' });
    expect(db.class_links).toHaveLength(0);
  });

  test('"make a new link" revokes the old one: the old code falls back like an unknown code', async () => {
    const old = await linkFor();
    const fresh = await CL.mint({ teacherId: T1, classId: C1, renew: true });
    expect(fresh.code).not.toBe(old);
    expect(db.class_links.find((r) => r.code === old).revoked_at).toBeTruthy();
    await expect(CL.resolve(old)).rejects.toMatchObject({ status: 404, body: { error: 'not_found' } });
    expect(await CL.resolve(fresh.code)).toEqual({ lang: 'en' });
  });
});

// ── (d) fallback ───────────────────────────────────────────────────────────────────────────────────
describe('(d) expired / revoked / switch off / parent off → not_found (the edge renders the unknown-code page)', () => {
  const nf = { status: 404, body: { error: 'not_found' } };
  test('expired', async () => {
    const code = await linkFor();
    db.class_links[0].expires_at = '2026-01-01T00:00:00.000Z';
    await expect(CL.resolve(code)).rejects.toMatchObject(nf);
    await expect(CL.arrive({ code, device_ref: DEV_FRESH })).rejects.toMatchObject(nf);
  });
  test('revoked', async () => {
    const code = await linkFor();
    db.class_links[0].revoked_at = '2026-10-10T00:00:00.000Z';
    await expect(CL.resolve(code)).rejects.toMatchObject(nf);
  });
  test.each(['web_quiz_class_link', 'web_quiz_challenge_v2', 'web_quiz_challenge'])('%s off', async (key) => {
    const code = await linkFor();
    db.app_settings.find((r) => r.key === key).value = false;
    Flags._resetCache();
    await expect(CL.resolve(code)).rejects.toMatchObject(nf);
    await expect(CL.arrive({ code, device_ref: DEV_PLAYED })).rejects.toMatchObject(nf);
  });
  test('an unknown code', async () => {
    await expect(CL.resolve('KZ7QW3MNPX')).rejects.toMatchObject(nf);
  });
});

// ── (a) the stranger path ──────────────────────────────────────────────────────────────────────────
describe('(a) a stranger device: teacher name → first letter → first-name chips', () => {
  test('before the teacher and letter taps no child name is sent; after them only the matching first names', async () => {
    const code = await linkFor();
    const a = await CL.arrive({ code, device_ref: DEV_FRESH });
    expect(a.step).toBe('teacher');
    expect(names(a)).toEqual([]);
    expect(a.teachers.length).toBeGreaterThanOrEqual(2);
    expect(a.teachers.length).toBeLessThanOrEqual(3);
    expect(a.teachers.map((t) => t.name)).toContain('Rabia Noor');

    // a wrong tap returns to this step and shows no children
    const wrong = a.teachers.find((t) => t.name !== 'Rabia Noor');
    const w = await CL.teacher({ code, s: a.s, tk: wrong.tk });
    expect(w.step).toBe('teacher');
    expect(names(w)).toEqual([]);
    // the wrong tap's step token does not open the letter step
    await expect(CL.letter({ code, s: w.s, letter: 'Z' })).rejects.toMatchObject({ status: 403 });

    const right = a.teachers.find((t) => t.name === 'Rabia Noor');
    const b = await CL.teacher({ code, s: a.s, tk: right.tk });
    expect(b.step).toBe('letter');
    expect(b.letters).toEqual('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));
    expect(names(b)).toEqual([]);

    const z = await CL.letter({ code, s: b.s, letter: 'Z' });
    expect(z.step).toBe('chips');
    expect(z.kids.map((k) => k.first)).toEqual(['Zara', 'Zara']);
    expect(names(z)).toEqual(['Zara']);
    expect(JSON.stringify(z)).not.toMatch(/Khan|Malik|Bilal|Ayaan|Tariq/);
    const bl = await CL.letter({ code, s: b.s, letter: 'B' });
    expect(bl.kids.map((k) => k.first)).toEqual(['Bilal']);
    expect(JSON.stringify(bl)).not.toMatch(/Ahmed|Tariq/);
  });

  test('the Muhammad-prefix rule: "Muhammad Ayaan" is the child Ayaan, under the letter A', async () => {
    const code = await linkFor();
    const a = await walkStranger(code, 'A');
    expect(a.kids.map((k) => k.first)).toEqual(['Ayaan']);
    const m = await walkStranger(code, 'M');
    expect(m.kids).toEqual([]);
  });

  test('door_shown on resolve (server, cls only, no kid); no event for a link-preview fetch', async () => {
    const code = await linkFor();
    await CL.resolve(code, { preview: true });
    expect(logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.door_shown')).toHaveLength(0);
    await CL.resolve(code);
    const ev = logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.door_shown');
    expect(ev).toHaveLength(1);
    expect(ev[0][1]).toEqual({ ev_v: 2, w: 's', door: 'class_link', surface: 'landing', cls: 'clshash00000', kid: null });
    expect(JSON.stringify(ev[0][1])).not.toContain(code);
    expect(JSON.stringify(ev[0][1])).not.toContain(C1);
  });
});

// ── (b) a device that has played in this class ─────────────────────────────────────────────────────
describe('(b) a device whose remembered child is enrolled → "Whose turn?" with only remembered children', () => {
  test('only the enrolled child it played as; never a classmate, never a child of another class', async () => {
    const code = await linkFor();
    const a = await CL.arrive({ code, device_ref: DEV_PLAYED });
    expect(a.step).toBe('who');
    expect(a.kids.map((k) => k.first)).toEqual(['Zara']);
    expect(JSON.stringify(a)).not.toMatch(/Malik|Bilal|Ayaan|Sana|Khan/);
    const p = await CL.pick({ code, s: a.s, chip: a.kids[0].chip, device_ref: DEV_PLAYED });
    const tok = T.verify(p.href.replace(/^\/h\//, '').replace(/\?.*$/, ''), 'h');
    expect(tok).toMatchObject({ ids: [ZK], src: 'cl', cl: { c: C1, s: 'remembered', q: 'high', h: false } });
  });

  test('the hand-off is /h/<token>?from=class_link: the hub, its one writer, logs hub_open with that source', async () => {
    const code = await linkFor();
    const a = await CL.arrive({ code, device_ref: DEV_PLAYED });
    const p = await CL.pick({ code, s: a.s, chip: a.kids[0].chip, device_ref: DEV_PLAYED });
    expect(p.href).toMatch(/^\/h\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}\?from=class_link$/);
    const b = await walkStranger(code, 'B');
    const pb = await CL.pick({ code, s: b.s, chip: b.kids[0].chip, device_ref: DEV_FRESH });
    expect(pb.href.endsWith('?from=class_link')).toBe(true);
  });

  test('a remembered-chip pick from another device is refused (the gate is re-checked at the pick)', async () => {
    const code = await linkFor();
    const a = await CL.arrive({ code, device_ref: DEV_PLAYED });
    await expect(CL.pick({ code, s: a.s, chip: a.kids[0].chip, device_ref: DEV_FRESH })).rejects.toMatchObject({ status: 403 });
  });
});

// ── (f)(g) the pick ────────────────────────────────────────────────────────────────────────────────
describe('(f)(g) the pick writes via=class_link, class_id = the link\'s class, and the homonym rule', () => {
  test('identical first names → both picks low + homonym_in_list = true; distinct → high', async () => {
    const code = await linkFor();
    const z = await walkStranger(code, 'Z');
    const picks = [];
    for (const k of z.kids) {
      const p = await CL.pick({ code, s: z.s, chip: k.chip, device_ref: DEV_FRESH });
      picks.push(T.verify(p.href.replace(/^\/h\//, '').replace(/\?.*$/, ''), 'h'));
    }
    expect(picks.map((t) => t.ids[0]).sort()).toEqual([ZK, ZM].sort());
    picks.forEach((t) => expect(t.cl).toEqual({ c: C1, s: 'roster_pick', q: 'low', h: true }));
    const b = await walkStranger(code, 'B');
    const pb = T.verify((await CL.pick({ code, s: b.s, chip: b.kids[0].chip, device_ref: DEV_FRESH })).href.replace(/^\/h\//, '').replace(/\?.*$/, ''), 'h');
    expect(pb).toMatchObject({ k: 'h', ids: [BA], src: 'cl', cl: { c: C1, s: 'roster_pick', q: 'high', h: false } });
    expect(CL.runColumns(pb.cl, BA)).toEqual({ via: 'class_link', class_id: C1, id_src: 'roster_pick', id_confidence: 'high', homonym_in_list: false, canonical_id: BA });
  });

  test('door_tap on a completed pick carries the child\'s key and the door, never a name, the code or the class id', async () => {
    const code = await linkFor();
    const b = await walkStranger(code, 'B');
    await CL.pick({ code, s: b.s, chip: b.kids[0].chip, device_ref: DEV_FRESH });
    const ev = logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.door_tap');
    expect(ev).toHaveLength(1);
    expect(ev[0][1]).toEqual({ ev_v: 2, w: 's', door: 'class_link', surface: 'landing', cls: 'clshash00000', kid: `kid:${BA.slice(-4)}` });
    expect(JSON.stringify(ev[0][1])).not.toMatch(new RegExp(`Bilal|${code}|${C1}`));
  });

  test('a chip from another letter or a forged chip is refused', async () => {
    const code = await linkFor();
    const z = await walkStranger(code, 'Z');
    const b = await walkStranger(code, 'B');
    await expect(CL.pick({ code, s: z.s, chip: b.kids[0].chip, device_ref: DEV_FRESH })).rejects.toMatchObject({ status: 403 });
    await expect(CL.pick({ code, s: z.s, chip: 'f'.repeat(16), device_ref: DEV_FRESH })).rejects.toMatchObject({ status: 403 });
  });
});

// ── (h) the teacher previewing ─────────────────────────────────────────────────────────────────────
describe('(h) the teacher\'s own link plays as practice', () => {
  test('a pick on a visit opened from the teacher card is mode = practice', async () => {
    const code = await linkFor();
    const jt = CL.signTeacherPreview(code);
    const a = await CL.arrive({ code, device_ref: DEV_FRESH, jt });
    const right = a.teachers.find((t) => t.name === 'Rabia Noor');
    const b = await CL.teacher({ code, s: a.s, tk: right.tk });
    const l = await CL.letter({ code, s: b.s, letter: 'B' });
    const tok = T.verify((await CL.pick({ code, s: l.s, chip: l.kids[0].chip, device_ref: DEV_FRESH })).href.replace(/^\/h\//, '').replace(/\?.*$/, ''), 'h');
    expect(tok.cl.m).toBe('practice');
    expect(CL.runColumns(tok.cl, BA).mode).toBe('practice');
    expect(logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.door_tap')).toHaveLength(0);
  });

  test('a teacher token for another code is ignored (a child\'s pick stays counted)', async () => {
    const code = await linkFor();
    const jt = CL.signTeacherPreview('KZ7QW3MNPX');
    const a = await CL.arrive({ code, device_ref: DEV_PLAYED, jt });
    const tok = T.verify((await CL.pick({ code, s: a.s, chip: a.kids[0].chip, device_ref: DEV_PLAYED })).href.replace(/^\/h\//, '').replace(/\?.*$/, ''), 'h');
    expect(tok.cl.m).toBeUndefined();
  });
});

// ── the teacher's card ─────────────────────────────────────────────────────────────────────────────
describe('the teacher card and (j) the forward link', () => {
  const CLASS_DATA = { cells: [{ grade: '3', subject: 'maths', avg: 70, played: 4, quizzes: 1 }], weeks: [], quizzes: [] };

  test('golden: switch off → the class tab is byte-identical to the original page', async () => {
    db.app_settings.find((r) => r.key === 'web_quiz_class_link').value = false;
    const extra = await CL.forTeacher(T1);
    expect(extra).toBeNull();
    const html = renderPage({ class: { ...CLASS_DATA } }, { lang: 'en', tab: 'class', tokens: { self: 'tok.sig' }, now: Date.UTC(2026, 9, 15, 7) });
    const htmlUr = renderPage({ class: { ...CLASS_DATA } }, { lang: 'ur', tab: 'class', tokens: { self: 'tok.sig' }, now: Date.UTC(2026, 9, 15, 7) });
    if (process.env.GOLDEN_WRITE === '1') fs.writeFileSync(GOLDEN, `${JSON.stringify({ html, htmlUr }, null, 2)}\n`);
    const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    expect(html).toBe(want.html);
    expect(htmlUr).toBe(want.htmlUr);
  });

  test('switch on: the card on the class tab, the link minted for the enrolled class only, Copy as selectable text', async () => {
    const extra = await CL.forTeacher(T1);
    expect(extra.cards).toHaveLength(1);
    const code = db.class_links[0].code;
    expect(extra.cards[0].url).toBe(`https://quiz.example.org/j/${code}`);
    const html = renderPage({ class: { ...CLASS_DATA, classLink: extra } }, { lang: 'en', tab: 'class', tokens: { self: 'tok.sig' } });
    expect(html).toContain("Your class&#39;s Jugnu link");
    expect(html).toContain('Forward it once a term and pin it. It always opens this week&#39;s story.');
    // Copy is a server link (logged), not a client toggle; the link text is shown open only after it
    expect(html).toContain(`<a class="btn btn-ghost act" href="/r/tok.sig/jlink?class=${C1}&amp;how=copy">Copy</a>`);
    expect(html).toContain(`<a class="btn btn-primary act" href="/r/tok.sig/jlink?class=${C1}&amp;how=forward">`);
    expect(html).not.toContain('<textarea');
    const opened = renderPage({ class: { ...CLASS_DATA, classLink: { ...extra, open: C1 } } }, { lang: 'en', tab: 'class', tokens: { self: 'tok.sig' } });
    expect(opened).not.toContain('how=copy');
    expect(opened).toContain(`<details class="act" open><summary>Copy</summary><textarea readonly rows="2" dir="ltr">https://quiz.example.org/j/${code}</textarea></details>`);
    expect(html).not.toContain('<script');
    const ur = renderPage({ class: { ...CLASS_DATA, classLink: extra } }, { lang: 'ur', tab: 'class', tokens: { self: 'tok.sig' } });
    expect(ur).toContain('آپ کی کلاس کا جگنو لنک');
  });

  test('(j) the forward text is the URL only: no count, no name; class_link_forwarded{cls} is logged', async () => {
    const out = await CL.forwardHref({ teacherId: T1, classId: C1 });
    const code = db.class_links[0].code;
    const text = decodeURIComponent(out.replace(/^https:\/\/wa\.me\/\?text=/, ''));
    expect(out.startsWith('https://wa.me/?text=')).toBe(true);
    expect(text).toBe(`https://quiz.example.org/j/${code}`);
    const ev = logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.class_link_forwarded');
    expect(ev).toHaveLength(1);
    expect(ev[0][1]).toEqual({ ev_v: 2, w: 's', cls: 'clshash00000', how: 'forward' });
  });

  test('Copy: logs class_link_forwarded{how:copy} and goes back to the report with the card open', async () => {
    const out = await CL.forwardHref({ teacherId: T1, classId: C1, how: 'copy', reportBase: '/r/tok.sig' });
    expect(out).toBe(`/r/tok.sig?tab=class&cl_open=${C1}#class-link`);
    const ev = logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.class_link_forwarded');
    expect(ev).toHaveLength(1);
    expect(ev[0][1]).toEqual({ ev_v: 2, w: 's', cls: 'clshash00000', how: 'copy' });
  });

  test('(j) a class that is not the teacher\'s has no forward link', async () => {
    expect(await CL.forwardHref({ teacherId: T1, classId: C2 })).toBeNull();
  });
});

// ── the report route that serves the card's two links ────────────────────────────────────────────
describe('GET /api/internal/tr/jlink/:token (the card\'s Forward and Copy)', () => {
  const express = require('express');
  const Token = require('../../../shared/services/quiz/teacher-report-token');
  let server;
  let base;
  beforeEach(async () => {
    const app = express();
    app.use('/api/internal/tr', require('../../../shared/routes/teacher-report-internal.routes'));
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}/api/internal/tr`;
  });
  afterEach(() => new Promise((r) => server.close(r)));
  const get = (p) => fetch(`${base}${p}`, { headers: { 'x-api-key': 'test-internal-key' }, redirect: 'manual' });

  test('how=copy → 303 back to the class tab with this card open; logged {how:copy}', async () => {
    const tok = Token.signTeacherReport({ teacherId: T1 });
    const r = await get(`/jlink/${tok}?class=${C1}&how=copy`);
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`/r/${encodeURIComponent(tok)}?tab=class&cl_open=${C1}#class-link`);
    const ev = logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.class_link_forwarded');
    expect(ev.map((e) => e[1].how)).toEqual(['copy']);
  });

  test('Forward → 302 wa.me with the URL only; logged {how:forward}; another teacher\'s class → 404', async () => {
    const tok = Token.signTeacherReport({ teacherId: T1 });
    const r = await get(`/jlink/${tok}?class=${C1}&how=forward`);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(`https://wa.me/?text=${encodeURIComponent(`https://quiz.example.org/j/${db.class_links[0].code}`)}`);
    expect(logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.class_link_forwarded').map((e) => e[1].how)).toEqual(['forward']);
    expect((await get(`/jlink/${tok}?class=${C2}&how=copy`)).status).toBe(404);
  });
});

// ── "Make a new link": the teacher closes a link that went to the wrong group ─────────────────────────
describe('POST /api/internal/tr/jnew/:token ("Make a new link")', () => {
  const express = require('express');
  const Token = require('../../../shared/services/quiz/teacher-report-token');
  let server;
  let base;
  beforeEach(async () => {
    const app = express();
    app.use('/api/internal/tr', require('../../../shared/routes/teacher-report-internal.routes'));
    const cl = express.Router();
    cl.use(express.json());
    cl.use('/cl', require('../../../shared/routes/web-quiz-class-link.routes'));
    app.use('/api/internal/wq', cl);
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}/api/internal`;
  });
  afterEach(() => new Promise((r) => server.close(r)));
  const post = (tok, body) => fetch(`${base}/tr/jnew/${tok}`, {
    method: 'POST', headers: { 'x-api-key': 'test-internal-key', 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual',
  });
  const snapshot = () => JSON.parse(JSON.stringify(db.class_links));

  test('(a) the class\'s teacher → 303 back to the class tab; the old row revoked, one new active row', async () => {
    const old = await linkFor();
    const tok = Token.signTeacherReport({ teacherId: T1 });
    const r = await post(tok, { class: C1, n: CL.signRenewNonce({ teacherId: T1, classId: C1 }) });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`/r/${encodeURIComponent(tok)}?tab=class#class-link`);
    const oldRow = db.class_links.find((x) => x.code === old);
    expect(typeof oldRow.revoked_at).toBe('string');
    const active = db.class_links.filter((x) => x.class_id === C1 && x.revoked_at == null);
    expect(active).toHaveLength(1);
    expect(active[0].code).not.toBe(old);
    expect(active[0].teacher_id).toBe(T1);
    expect(CL.CODE_RX.test(active[0].code)).toBe(true);
    // nothing is sent: the teacher forwards the new link from their own WhatsApp
    expect(logEvent.mock.calls.map((c) => c[0]).filter((n) => /send|msg_sent|ledger/.test(n))).toEqual([]);
  });

  test('(b) the old /j/ code then answers not_found: the page an unknown code gets', async () => {
    const old = await linkFor();
    expect((await fetch(`${base}/wq/cl/${old}`)).status).toBe(200);
    await post(Token.signTeacherReport({ teacherId: T1 }), { class: C1, n: CL.signRenewNonce({ teacherId: T1, classId: C1 }) });
    const r = await fetch(`${base}/wq/cl/${old}`);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'not_found' });
    const fresh = db.class_links.find((x) => x.class_id === C1 && x.revoked_at == null).code;
    expect((await fetch(`${base}/wq/cl/${fresh}`)).status).toBe(200);
  });

  test('(c) another teacher\'s token is refused and no row changes (no nonce → 400; their own nonce, not their class → 404)', async () => {
    await linkFor();
    const before = snapshot();
    const r = await post(Token.signTeacherReport({ teacherId: T2 }), { class: C1 });
    expect(r.status).toBe(400);
    expect(db.class_links).toEqual(before);
    const own = await post(Token.signTeacherReport({ teacherId: T2 }), { class: C1, n: CL.signRenewNonce({ teacherId: T2, classId: C1 }) });
    expect(own.status).toBe(404);
    expect(db.class_links).toEqual(before);
    const bad = await post(Token.signTeacherReport({ teacherId: T1 }), { class: 'not-a-class' });
    expect(bad.status).toBe(400);
    expect(db.class_links).toEqual(before);
  });

  test('(d) switch off (or its parent off) → 404 and no row changes', async () => {
    await linkFor();
    const before = snapshot();
    db.app_settings.find((x) => x.key === 'web_quiz_class_link').value = false;
    Flags._resetCache();
    expect((await post(Token.signTeacherReport({ teacherId: T1 }), { class: C1 })).status).toBe(404);
    db.app_settings.find((x) => x.key === 'web_quiz_class_link').value = true;
    db.app_settings.find((x) => x.key === 'web_quiz_challenge_v2').value = false;
    Flags._resetCache();
    expect((await post(Token.signTeacherReport({ teacherId: T1 }), { class: C1 })).status).toBe(404);
    expect(db.class_links).toEqual(before);
  });
});

describe('the card\'s "Make a new link" and "Open" (EN + UR, no script)', () => {
  const CLASS_DATA = { cells: [{ grade: '3', subject: 'maths', avg: 70, played: 4, quizzes: 1 }], weeks: [], quizzes: [] };
  test('(f) "Make a new link" is a plain link to the confirm state (no one-tap POST form), and Open on the teacher\'s own preview link', async () => {
    const extra = await CL.forTeacher(T1);
    const { preview } = extra.cards[0];
    const en = renderPage({ class: { ...CLASS_DATA, classLink: extra } }, { lang: 'en', tab: 'class', tokens: { self: 'tok.sig' } });
    expect(en).toContain(`<a class="btn btn-ghost act" href="/r/tok.sig?tab=class&amp;jconfirm=${C1}#class-link">Make a new link</a>`);
    expect(en).not.toContain('<form method="post" action="/r/tok.sig/jnew"');
    expect(en).not.toContain('name="n"');
    expect(en).toContain(`<a class="btn btn-ghost act" href="${preview.replace(/&/g, '&amp;')}">Open</a>`);
    expect(en).not.toContain('<script');
    const ur = renderPage({ class: { ...CLASS_DATA, classLink: extra } }, { lang: 'ur', tab: 'class', tokens: { self: 'tok.sig' } });
    expect(ur).toContain('>نیا لنک بنائیں</a>');
    expect(ur).not.toContain('/r/tok.sig/jnew');
    expect(ur).toContain('>کھولیں</a>');
  });
});

// ── "Make a new link" asks first: a no-JS confirm card with a signed nonce (teacher + class, 10 minutes) ──
describe('"Make a new link" asks first (confirm card, signed nonce)', () => {
  const express = require('express');
  const Token = require('../../../shared/services/quiz/teacher-report-token');
  const CONFIRM_EN = 'The old link will stop working for everyone. Forward the new one to the class group.';
  const CONFIRM_UR = 'پرانا لنک سب کے لیے بند ہو جائے گا۔ نیا لنک کلاس گروپ میں بھیج دیں۔';
  let server;
  let base;
  beforeEach(async () => {
    const app = express();
    app.use('/api/internal/tr', require('../../../shared/routes/teacher-report-internal.routes'));
    const cl = express.Router();
    cl.use(express.json());
    cl.use('/cl', require('../../../shared/routes/web-quiz-class-link.routes'));
    app.use('/api/internal/wq', cl);
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}/api/internal`;
  });
  afterEach(() => { jest.restoreAllMocks(); return new Promise((r) => server.close(r)); });
  const H = { 'x-api-key': 'test-internal-key' };
  const post = (tok, body) => fetch(`${base}/tr/jnew/${tok}`, {
    method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual',
  });
  const snapshot = () => JSON.parse(JSON.stringify(db.class_links));
  const live = async (code) => (await fetch(`${base}/wq/cl/${code}`)).status;
  const nonceFrom = (html) => { const m = html.match(/<input type="hidden" name="n" value="([^"]+)">/); return m ? m[1] : null; };

  test('(a) POST jnew with no nonce → 400; nothing revoked, the old code still live', async () => {
    const old = await linkFor();
    const before = snapshot();
    const r = await post(Token.signTeacherReport({ teacherId: T1 }), { class: C1 });
    expect(r.status).toBe(400);
    expect(db.class_links).toEqual(before);
    expect(await live(old)).toBe(200);
  });

  test('(b) a forged, other-class, other-teacher, other-teacher-expired or wrong-kind nonce → 400; nothing revoked', async () => {
    const old = await linkFor();
    const before = snapshot();
    const tok = Token.signTeacherReport({ teacherId: T1 });
    const good = CL.signRenewNonce({ teacherId: T1, classId: C1 });
    const forged = `${good.slice(0, -1)}${good.endsWith('A') ? 'B' : 'A'}`;
    const otherClass = CL.signRenewNonce({ teacherId: T1, classId: C4 });
    const otherTeacher = CL.signRenewNonce({ teacherId: T2, classId: C1 });
    const realNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(realNow - 11 * 60 * 1000);
    const expired = CL.signRenewNonce({ teacherId: T1, classId: C1 });
    const expiredOther = CL.signRenewNonce({ teacherId: T2, classId: C1 });
    Date.now.mockRestore();
    // another signed kind (the card's own preview token) is not a nonce either
    const wrongKind = CL.signTeacherPreview(old);
    for (const n of [forged, otherClass, otherTeacher, expiredOther, wrongKind, 'not-a-nonce']) {
      expect((await post(tok, { class: C1, n })).status).toBe(400);
    }
    expect(db.class_links).toEqual(before);
    expect(await live(old)).toBe(200);
    // the nonce is good for 10 minutes, then not
    expect(CL.verifyRenewNonce(good, { teacherId: T1, classId: C1 })).toBe(true);
    expect(CL.verifyRenewNonce(expired, { teacherId: T1, classId: C1 })).toBe(false);
  });

  test('(b2) a STALE nonce (this teacher, this class, past 10 minutes) → 303 back to the confirm state, nothing revoked; it then carries a fresh nonce', async () => {
    const old = await linkFor();
    const before = snapshot();
    const tok = Token.signTeacherReport({ teacherId: T1 });
    const realNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(realNow - 11 * 60 * 1000);
    const stale = CL.signRenewNonce({ teacherId: T1, classId: C1 });
    Date.now.mockRestore();
    const r = await post(tok, { class: C1, n: stale });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`/r/${encodeURIComponent(tok)}?tab=class&jconfirm=${C1}#class-link`);
    expect(db.class_links).toEqual(before);
    expect(await live(old)).toBe(200);
    // a stale nonce whose signature was tampered with is still forged → 400
    const forgedStale = `${stale.slice(0, -1)}${stale.endsWith('A') ? 'B' : 'A'}`;
    expect((await post(tok, { class: C1, n: forgedStale })).status).toBe(400);
    // following the 303: the confirm card again, with a fresh nonce that works
    const again = await (await fetch(`${base}/tr/page/${tok}?tab=class&lang=en&jconfirm=${C1}`, { headers: H })).text();
    const fresh = nonceFrom(again);
    expect(fresh).not.toBe(stale);
    expect(CL.verifyRenewNonce(fresh, { teacherId: T1, classId: C1 })).toBe(true);
    expect((await post(tok, { class: C1, n: fresh })).status).toBe(303);
    expect(await live(old)).toBe(404);
  });

  test('(c) GET the confirm state → the three strings (EN and UR) and a nonce for this teacher and class; the card otherwise unchanged', async () => {
    await linkFor();
    const tok = Token.signTeacherReport({ teacherId: T1 });
    const self = `/r/${encodeURIComponent(tok)}`;
    const en = await (await fetch(`${base}/tr/page/${tok}?tab=class&lang=en&jconfirm=${C1}`, { headers: H })).text();
    expect(en).toContain(`<p class="small">${CONFIRM_EN}</p>`);
    const n = nonceFrom(en);
    expect(n).toBeTruthy();
    expect(CL.verifyRenewNonce(n, { teacherId: T1, classId: C1 })).toBe(true);
    expect(CL.verifyRenewNonce(n, { teacherId: T2, classId: C1 })).toBe(false);
    expect(en).toContain(`<form method="post" action="${self}/jnew" class="act"><input type="hidden" name="class" value="${C1}"><input type="hidden" name="n" value="${n}"><button type="submit" class="btn btn-ghost" style="width:100%;font:inherit;font-weight:700;cursor:pointer">Make a new link</button></form>`);
    expect(en).toContain(`<a class="btn btn-ghost act" href="${self}?tab=class#class-link">Keep this link</a>`);
    expect(en).not.toContain('jconfirm=');
    expect(en).not.toContain('<script');
    const ur = await (await fetch(`${base}/tr/page/${tok}?tab=class&lang=ur&jconfirm=${C1}`, { headers: H })).text();
    expect(ur).toContain(CONFIRM_UR);
    expect(ur).toContain('>نیا لنک بنائیں</button></form>');
    expect(ur).toContain('>یہی لنک رکھیں</a>');
    expect(nonceFrom(ur)).toBeTruthy();
    // the card otherwise unchanged: the confirm block stands exactly where the plain link stood
    const extra = await CL.forTeacher(T1);
    const { renderClassLinkCard, COPY } = require('../../../shared/templates/teacher-class-link-card');
    for (const lang of ['en', 'ur']) {
      const plain = renderClassLinkCard(extra, { lang, base: '/r/tok.sig' });
      const asked = renderClassLinkCard({ ...extra, confirm: { classId: C1, n: 'NONCE' } }, { lang, base: '/r/tok.sig' });
      const C = COPY[lang];
      const makeLink = `<a class="btn btn-ghost act" href="/r/tok.sig?tab=class&amp;jconfirm=${C1}#class-link">${C.make}</a>`;
      const confirmBlock = `<p class="small">${C.renewConfirm}</p>
<form method="post" action="/r/tok.sig/jnew" class="act"><input type="hidden" name="class" value="${C1}"><input type="hidden" name="n" value="NONCE"><button type="submit" class="btn btn-ghost" style="width:100%;font:inherit;font-weight:700;cursor:pointer">${C.renewGo}</button></form>
<a class="btn btn-ghost act" href="/r/tok.sig?tab=class#class-link">${C.renewKeep}</a>`;
      expect(plain).toContain(makeLink);
      expect(asked).toBe(plain.replace(makeLink, confirmBlock));
    }
  });

  test('(c) a confirm for a class that is not this teacher\'s → no nonce, the card as normal', async () => {
    await linkFor();
    const tok = Token.signTeacherReport({ teacherId: T1 });
    const html = await (await fetch(`${base}/tr/page/${tok}?tab=class&lang=en&jconfirm=${C2}`, { headers: H })).text();
    expect(nonceFrom(html)).toBeNull();
    expect(html).not.toContain(CONFIRM_EN);
    expect(html).toContain(`jconfirm=${C1}#class-link">Make a new link</a>`);
  });

  test('(d) the confirm card\'s POST with its nonce → 303 back; the old code revoked, the new one live', async () => {
    const old = await linkFor();
    const tok = Token.signTeacherReport({ teacherId: T1 });
    const page = await (await fetch(`${base}/tr/page/${tok}?tab=class&lang=en&jconfirm=${C1}`, { headers: H })).text();
    const r = await post(tok, { class: C1, n: nonceFrom(page) });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`/r/${encodeURIComponent(tok)}?tab=class#class-link`);
    expect(await live(old)).toBe(404);
    const fresh = db.class_links.filter((x) => x.class_id === C1 && x.revoked_at == null);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].code).not.toBe(old);
    expect(await live(fresh[0].code)).toBe(200);
    // 4: after the 303 the card shows the new link, as today
    const after = await (await fetch(`${base}/tr/page/${tok}?tab=class&lang=en`, { headers: H })).text();
    expect(after).toContain(`https://quiz.example.org/j/${fresh[0].code}`);
    expect(after).not.toContain(`/j/${old}`);
  });

  test('(e) switch off: jconfirm is ignored (no card, no nonce) and POST jnew answers 404 as today, nothing revoked', async () => {
    await linkFor();
    const before = snapshot();
    db.app_settings.find((x) => x.key === 'web_quiz_class_link').value = false;
    Flags._resetCache();
    const tok = Token.signTeacherReport({ teacherId: T1 });
    const asked = await (await fetch(`${base}/tr/page/${tok}?tab=class&lang=en&jconfirm=${C1}`, { headers: H })).text();
    const plain = await (await fetch(`${base}/tr/page/${tok}?tab=class&lang=en`, { headers: H })).text();
    expect(asked).toBe(plain);
    expect(asked).not.toContain('class-link');
    expect((await post(tok, { class: C1 })).status).toBe(404);
    expect((await post(tok, { class: C1, n: CL.signRenewNonce({ teacherId: T1, classId: C1 }) })).status).toBe(404);
    expect(db.class_links).toEqual(before);
  });
});

// ── the teacher's own visit is not a child's door ───────────────────────────────────────────────────
describe('the teacher\'s own /j/ visit (from the card) does not count as "opened"', () => {
  test('GET /cl/:code with the card\'s signed teacher token → no door_shown; another code\'s token → door_shown', async () => {
    const express = require('express');
    const app = express();
    app.use('/cl', require('../../../shared/routes/web-quiz-class-link.routes'));
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    try {
      const code = await linkFor();
      const other = 'KZ7QW3MNPX';
      const at = (q) => fetch(`http://127.0.0.1:${server.address().port}/cl/${code}${q}`);
      const shown = () => logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.door_shown').length;
      expect((await at(`?jt=${encodeURIComponent(CL.signTeacherPreview(code))}`)).status).toBe(200);
      expect(shown()).toBe(0);
      expect((await at(`?jt=${encodeURIComponent(CL.signTeacherPreview(other))}`)).status).toBe(200);
      expect(shown()).toBe(1);
      expect((await at('')).status).toBe(200);
      expect(shown()).toBe(2);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
