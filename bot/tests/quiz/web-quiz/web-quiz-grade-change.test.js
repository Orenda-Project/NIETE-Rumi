'use strict';
/**
 * A grown-up changes the child's grade, for good (app_settings web_quiz_grade_change): default off, on only for the
 * stored JSON boolean true, read in the hub switches' one settings read. On, the hub answer carries
 * `grownups.grade = {now, cls}` for the chosen child, and POST /hub/:token/grade writes students.self_reported_class
 * as 'Grade N' on the child's own row (a merged record's target), behind the hub's own guards (the chip is one of the
 * token's children, the phone is trusted, a grade 1-5, at most 5 changes a day). Off, every hub answer is byte for byte
 * the hub's own and the write answers 404. child_identity is never touched. Invented children only.
 * Supabase, the loggers, Redis and the phone-trust store are the boundaries.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({ incr: jest.fn(), expire: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-hub-device', () => ({ deviceTrusted: jest.fn(), deviceMayName: jest.fn(async () => false) }));

process.env.INTERNAL_API_KEY = 'route-key';
process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(40);

const KEY = 'web_quiz_grade_change';
const LOOSE = '11111111-1111-4111-8111-111111111111';   // a loose child: Grade 3 from the family
const LISTED = '22222222-2222-4222-8222-222222222222';  // on a teacher's list: Class 4
const MERGED = '33333333-3333-4333-8333-333333333333';  // a merged record, folded into CANON
const CANON = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';   // nobody on this link
const DEVICE = 'AbCdEfGhIjKlMnOpQrStUv';

let rows = [];
let db = {};
let updates = [];
let reads = [];
let redis = new Map();
function seed() {
  Object.assign(require('../../../shared/config/supabase'), {
    from(t) {
      const st = { t, f: [], one: false, upd: null };
      const match = () => (db[t] || []).filter((r) => st.f.every(([c, v, many]) => (many ? v.map(String).includes(String(r[c])) : String(r[c]) === String(v))));
      const answer = () => {
        if (st.upd) {
          updates.push({ table: t, values: st.upd, where: Object.fromEntries(st.f.map(([c, v]) => [c, v])) });
          match().forEach((r) => Object.assign(r, st.upd));
          return { data: null, error: null };
        }
        if (t === 'app_settings') return { data: rows, error: null };
        reads.push(t);
        const m = match();
        return { data: st.one ? m[0] || null : m, error: null };
      };
      const b = {
        select() { return b; },
        update(v) { st.upd = v; return b; },
        eq(c, v) { st.f.push([c, v]); return b; },
        in(c, v) { if (t !== 'app_settings') st.f.push([c, v, true]); return b; },
        order() { return b; },
        limit() { return b; },
        gte() { return b; },
        lte() { return b; },
        neq() { return b; },
        is() { return b; },
        not() { return b; },
        async maybeSingle() { st.one = true; return answer(); },
        then(res, rej) { return Promise.resolve(answer()).then(res, rej); },
      };
      return b;
    },
  });
}

let Grade;
let Flags;
let T;
let logEvent;
let deviceTrusted;
beforeEach(() => {
  jest.resetModules();
  rows = [];
  updates = [];
  reads = [];
  redis = new Map();
  db = {
    students: [
      { id: LOOSE, student_name: 'Noor Testwala', self_reported_class: 'Grade 3', list_id: null, is_active: true, merged_into: null, status: 'active' },
      { id: LISTED, student_name: 'Sami Testwala', self_reported_class: null, list_id: 'list-1', is_active: true, merged_into: null, status: 'active' },
      { id: MERGED, student_name: 'Rafi Testwala', self_reported_class: 'Grade 2', list_id: null, is_active: true, merged_into: CANON, status: 'merged' },
      { id: CANON, student_name: 'Rafi Testwala', self_reported_class: 'Grade 2', list_id: null, is_active: true, merged_into: null, status: 'active' },
      { id: OTHER, student_name: 'Zoya Testwala', self_reported_class: 'Grade 5', list_id: null, is_active: true, merged_into: null, status: 'active' },
    ],
    student_lists: [{ id: 'list-1', class_name: 'Class 4', user_id: 'u-1', section: 'A', class_id: null }],
    class_enrollments: [],
    classes: [],
    quiz_sessions: [],
    quizzes: [],
  };
  seed();
  const R = require('../../../shared/services/cache/railway-redis.service');
  R.incr.mockImplementation(async (k) => { redis.set(k, (redis.get(k) || 0) + 1); return redis.get(k); });
  R.expire.mockImplementation(async () => 1);
  deviceTrusted = require('../../../shared/services/quiz/web-quiz-hub-device').deviceTrusted;
  deviceTrusted.mockImplementation(async (_t, d) => (d === DEVICE ? { ok: true, why: 'bound', ids: [LOOSE, LISTED, MERGED] } : { ok: false, why: 'other', ids: [] }));
  logEvent = require('../../../shared/utils/structured-logger').logEvent;
  Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
  T = require('../../../shared/services/quiz/web-quiz-token');
  Grade = require('../../../shared/services/quiz/web-quiz-grade-change');
});

const OFF_VALUES = [['absent', undefined], ['false', false], ['the string true', 'true'], ['the number 1', 1], ['an object', { enabled: true }], ['null', null]];
const turnOn = async (...v) => { const value = v.length ? v[0] : true; rows = value === undefined ? [] : [{ key: KEY, value }]; await Flags.flags(); };
const tokenOf = (ids = [LOOSE, LISTED, MERGED]) => T.signHub(ids);
const chip = (id) => T.chipId('h', id);
const statusOf = async (p) => { try { await p; return 200; } catch (e) { return e.status || 500; } };

describe('the switch rides the hub switches\' one read', () => {
  test('its key is one line of the hub registry, a JSON-true switch', () => {
    expect(Flags.GRADE_CHANGE_KEY).toBe(KEY);
    expect(Flags.KEYS).toContain(KEY);
    expect(Flags.SWITCHES.find(([, k]) => k === KEY)).toEqual(['gradeChange', KEY, 'json']);
  });
  test('on() is the cache only: cold is off, and asks nothing', async () => {
    rows = [{ key: KEY, value: true }];
    expect(Grade.on()).toBe(false);
    await Flags.flags();
    expect(Grade.on()).toBe(true);
  });
  test.each(OFF_VALUES)('%s: off', async (_n, value) => {
    await turnOn(value);
    expect(Grade.on()).toBe(false);
  });
});

describe('carry: the hub answer says grade_on only while on, and reads nothing', () => {
  const answer = (id, extra = {}) => ({ lang: 'en', kids: [{ chip: chip(id), first: 'Noor', grade: '3' }], kid: chip(id), ...extra });
  test('on: grownups.grade_on = true, and no student, class or grade read (counted)', async () => {
    await turnOn();
    const n = reads.length;
    const out = await Grade.carry(answer(LISTED), tokenOf());
    expect(out.grownups).toEqual({ grade_on: true });
    expect(reads.slice(n)).toEqual([]);
  });
  test('on: merges into the grownups the hub already sent (the teacher switch stays)', async () => {
    await turnOn();
    const out = await Grade.carry(Promise.resolve(answer(LOOSE, { grownups: { teacher_href: '/quiz/teacher/abc', teacher_label: 'Back' } })), tokenOf());
    expect(out.grownups).toEqual({ teacher_href: '/quiz/teacher/abc', teacher_label: 'Back', grade_on: true });
  });
  test('on, no chosen child, a locked page or a coach\'s preview: untouched', async () => {
    await turnOn();
    const none = { lang: 'en', kids: [], kid: null };
    expect(JSON.stringify(await Grade.carry({ ...none }, tokenOf()))).toBe(JSON.stringify(none));
    const locked = { locked: true, kid: chip(LOOSE) };
    expect(JSON.stringify(await Grade.carry({ ...locked }, tokenOf()))).toBe(JSON.stringify(locked));
    const pr = { practice: 1, grade: 3, kid: null };
    expect(JSON.stringify(await Grade.carry({ ...pr }, tokenOf()))).toBe(JSON.stringify(pr));
  });
  test.each(OFF_VALUES)('%s: the answer as it came, byte for byte, and no read', async (_n, value) => {
    await turnOn(value);
    const before = JSON.stringify(answer(LOOSE, { grownups: { teacher_href: '/x' } }));
    const out = await Grade.carry(answer(LOOSE, { grownups: { teacher_href: '/x' } }), tokenOf());
    expect(JSON.stringify(out)).toBe(before);
    expect(reads).toEqual([]);
  });
  test('a non-object answer passes through', async () => {
    await turnOn();
    expect(await Grade.carry(null, tokenOf())).toBeNull();
    expect(await Grade.carry([1], tokenOf())).toEqual([1]);
  });
});

describe('get: the sheet asks the grade when it opens, behind the same guards as the write', () => {
  const ask = (id, device = DEVICE, token = tokenOf()) => Grade.get({ token, kid: chip(id), device });
  test('a loose child: {now: 3, cls: null}', async () => {
    await turnOn();
    expect(await ask(LOOSE)).toEqual({ now: 3, cls: null });
  });
  test('a listed child: the class grade is cls; the family has none yet, so now is the class grade', async () => {
    await turnOn();
    expect(await ask(LISTED)).toEqual({ now: 4, cls: 4 });
  });
  test('a listed child whose family chose Grade 2: now 2, cls 4', async () => {
    db.students[1].self_reported_class = 'Grade 2';
    await turnOn();
    expect(await ask(LISTED)).toEqual({ now: 2, cls: 4 });
  });
  test('a merged record: the canonical row\'s grade', async () => {
    db.students[3].self_reported_class = 'Grade 5';
    await turnOn();
    expect(await ask(MERGED)).toEqual({ now: 5, cls: null });
  });
  test.each(OFF_VALUES)('%s: 404, no child read', async (_n, value) => {
    await turnOn(value);
    expect(await statusOf(ask(LOOSE))).toBe(404);
    expect(reads).toEqual([]);
  });
  test('a chip of another child, a forged token: 403', async () => {
    await turnOn();
    expect(await statusOf(ask(OTHER))).toBe(403);
    expect(await statusOf(ask(LOOSE, DEVICE, `${tokenOf().split('.')[0]}.AAAAAAAAAAAAAAAAAAAAAA`))).toBe(403);
  });
  test('an untrusted phone (or none): 403', async () => {
    await turnOn();
    expect(await statusOf(ask(LOOSE, 'ZzZzZzZzZzZzZzZzZzZzZz'))).toBe(403);
    expect(await statusOf(ask(LOOSE, null))).toBe(403);
  });
});

describe('browse: a class child\'s Stories and Videos default grade is the family\'s (only while on)', () => {
  test('on, a class child whose family chose 2: 2; no family grade: the class grade', async () => {
    db.students[1].self_reported_class = 'Grade 2';
    await turnOn();
    expect(await Grade.browseGrade({ studentId: LISTED, grade: '4' })).toBe('2');
    db.students[1].self_reported_class = null;
    expect(await Grade.browseGrade({ studentId: LISTED, grade: '4' })).toBe('4');
  });
  test.each(OFF_VALUES)('%s: the hub\'s own grade, and no read', async (_n, value) => {
    db.students[1].self_reported_class = 'Grade 2';
    await turnOn(value);
    expect(await Grade.browseGrade({ studentId: LISTED, grade: '4' })).toBe('4');
    expect(reads).toEqual([]);
  });
  const STORIES = { key: 'web_quiz_stories', value: true };
  const shelfGrade = async () => {
    const Hub = require('../../../shared/services/quiz/web-quiz-hub');
    jest.spyOn(Hub, 'kidFromHub').mockImplementation(async () => ({ studentId: LISTED, grade: '4', rootId: null, lang: 'en' }));
    return (await require('../../../shared/services/quiz/web-quiz-stories').shelf('tok', { kid: 'k', l: 'en', device: DEVICE })).grade;
  };
  test('the Stories shelf (no grade asked): on -> the family\'s 2; off -> the class 4; a grade the page asks still wins', async () => {
    db.students[1].self_reported_class = 'Grade 2';
    rows = [STORIES, { key: KEY, value: true }]; await Flags.flags();
    expect(await shelfGrade()).toBe(2);
    const Hub = require('../../../shared/services/quiz/web-quiz-hub');
    expect((await require('../../../shared/services/quiz/web-quiz-stories').shelf('tok', { kid: 'k', g: '5', l: 'en', device: DEVICE })).grade).toBe(5);
    expect(Hub.kidFromHub).toHaveBeenCalled();
  });
  test.each(OFF_VALUES)('the Stories shelf, %s: the class grade, as today', async (_n, value) => {
    db.students[1].self_reported_class = 'Grade 2';
    rows = [STORIES, ...(value === undefined ? [] : [{ key: KEY, value }])]; await Flags.flags();
    expect(await shelfGrade()).toBe(4);
  });
  const LIB = { key: 'web_quiz_library', value: true };
  const libGrade = async () => {
    const Hub = require('../../../shared/services/quiz/web-quiz-hub');
    jest.spyOn(Hub, 'kidFromHub').mockImplementation(async () => ({ studentId: LISTED, grade: '4', rootId: null, lang: 'en' }));
    return (await require('../../../shared/services/quiz/web-quiz-library').libHub('tok', { kid: 'k', device: DEVICE })).grade;
  };
  test('the Videos library from the hub: on -> the family\'s 2; off values -> the class 4', async () => {
    db.students[1].self_reported_class = 'Grade 2';
    rows = [LIB, { key: KEY, value: true }]; await Flags.flags();
    expect(await libGrade()).toBe('2');
  });
  test.each(OFF_VALUES)('the Videos library, %s: the class grade, as today', async (_n, value) => {
    db.students[1].self_reported_class = 'Grade 2';
    rows = [LIB, ...(value === undefined ? [] : [{ key: KEY, value }])]; await Flags.flags();
    expect(await libGrade()).toBe('4');
  });
});

describe('set: the guards', () => {
  test('off: 404, nothing written', async () => {
    await turnOn(false);
    expect(await statusOf(Grade.set({ token: tokenOf(), kid: chip(LOOSE), device: DEVICE, grade: 4 }))).toBe(404);
    expect(updates).toEqual([]);
  });
  test.each([[0], [6], ['3'], [3.5], [null], [undefined], [-1]])('grade %p: 400, nothing written', async (g) => {
    await turnOn();
    expect(await statusOf(Grade.set({ token: tokenOf(), kid: chip(LOOSE), device: DEVICE, grade: g }))).toBe(400);
    expect(updates).toEqual([]);
  });
  test('a chip of another child (not on this link): 403, nothing written', async () => {
    await turnOn();
    expect(await statusOf(Grade.set({ token: tokenOf(), kid: chip(OTHER), device: DEVICE, grade: 4 }))).toBe(403);
    expect(updates).toEqual([]);
  });
  test('a forged token: 403, nothing written', async () => {
    await turnOn();
    expect(await statusOf(Grade.set({ token: `${tokenOf().split('.')[0]}.AAAAAAAAAAAAAAAAAAAAAA`, kid: chip(LOOSE), device: DEVICE, grade: 4 }))).toBe(403);
    expect(updates).toEqual([]);
  });
  test('an untrusted phone (or none): 403, nothing written', async () => {
    await turnOn();
    expect(await statusOf(Grade.set({ token: tokenOf(), kid: chip(LOOSE), device: 'ZzZzZzZzZzZzZzZzZzZzZz', grade: 4 }))).toBe(403);
    expect(await statusOf(Grade.set({ token: tokenOf(), kid: chip(LOOSE), grade: 4 }))).toBe(403);
    expect(updates).toEqual([]);
  });
  test('a trusted phone that may see only a sibling: 403', async () => {
    await turnOn();
    deviceTrusted.mockImplementation(async () => ({ ok: true, why: 'played', ids: [LISTED] }));
    expect(await statusOf(Grade.set({ token: tokenOf(), kid: chip(LOOSE), device: DEVICE, grade: 4 }))).toBe(403);
    expect(updates).toEqual([]);
  });
});

describe('set: the write, the caches, the event', () => {
  test('a loose child 3 -> 4: self_reported_class = "Grade 4" on that row only; {ok:true, grade:4}', async () => {
    await turnOn();
    expect(await Grade.set({ token: tokenOf(), kid: chip(LOOSE), device: DEVICE, grade: 4 })).toEqual({ ok: true, grade: 4 });
    expect(updates).toEqual([{ table: 'students', values: { self_reported_class: 'Grade 4' }, where: { id: LOOSE } }]);
  });
  test('child_identity is never read or written', async () => {
    await turnOn();
    await Grade.set({ token: tokenOf(), kid: chip(LOOSE), device: DEVICE, grade: 4 });
    expect(reads.filter((t) => /child_identity/.test(t))).toEqual([]);
    expect(updates.filter((u) => /child_identity/.test(u.table))).toEqual([]);
  });
  test('a merged record: the write lands on its merged_into row', async () => {
    await turnOn();
    await Grade.set({ token: tokenOf(), kid: chip(MERGED), device: DEVICE, grade: 1 });
    expect(updates).toEqual([{ table: 'students', values: { self_reported_class: 'Grade 1' }, where: { id: CANON } }]);
  });
  test('the event: web_quiz.grade_set {kid_hash, from, to, class_grade, via}, no name, no phone, no id', async () => {
    await turnOn();
    await Grade.set({ token: tokenOf(), kid: chip(LISTED), device: DEVICE, grade: 2 });
    const ev = logEvent.mock.calls.filter(([n]) => n === 'web_quiz.grade_set');
    expect(ev).toHaveLength(1);
    expect(ev[0][1]).toEqual({ kid_hash: expect.stringMatching(/^[0-9a-f]{16}$/), from: 4, to: 2, class_grade: 4, via: 'grownups' });
    expect(JSON.stringify(ev[0][1])).not.toMatch(/Testwala|2222|AbCdEf/);
  });
  test('the child\'s cached rows are dropped for that child (the shared answer rows, the roster lookups)', async () => {
    await turnOn();
    const ChildRows = require('../../../shared/services/quiz/web-quiz-hub-child-rows');
    const Roster = require('../../../shared/services/quiz/web-quiz-identity-roster');
    const a = jest.spyOn(ChildRows, 'forget');
    const b = jest.spyOn(Roster, 'forgetChild');
    await Grade.set({ token: tokenOf(), kid: chip(MERGED), device: DEVICE, grade: 3 });
    expect(a).toHaveBeenCalledWith(expect.arrayContaining([MERGED, CANON]));
    expect(b.mock.calls.map(([id]) => id)).toEqual(expect.arrayContaining([MERGED, CANON]));
  });
  test('the next ask reads the new grade', async () => {
    await turnOn();
    await Grade.set({ token: tokenOf(), kid: chip(LOOSE), device: DEVICE, grade: 5 });
    expect(await Grade.get({ token: tokenOf(), kid: chip(LOOSE), device: DEVICE })).toEqual({ now: 5, cls: null });
  });
});

describe('set: at most 5 changes a child a day', () => {
  test('the same grade again: ok, nothing written, not counted, no event', async () => {
    await turnOn();
    expect(await Grade.set({ token: tokenOf(), kid: chip(LOOSE), device: DEVICE, grade: 3 })).toEqual({ ok: true, grade: 3 });
    expect(updates).toEqual([]);
    expect(redis.size).toBe(0);
    expect(logEvent.mock.calls.filter(([n]) => n === 'web_quiz.grade_set')).toEqual([]);
  });
  test('the 6th change in a day: 429, not written', async () => {
    await turnOn();
    for (let i = 0; i < 5; i++) expect(await Grade.set({ token: tokenOf(), kid: chip(LOOSE), device: DEVICE, grade: (i % 2) + 4 })).toMatchObject({ ok: true });
    expect(await statusOf(Grade.set({ token: tokenOf(), kid: chip(LOOSE), device: DEVICE, grade: 1 }))).toBe(429);
    expect(updates).toHaveLength(5);
    // a sibling still may
    expect(await Grade.set({ token: tokenOf(), kid: chip(LISTED), device: DEVICE, grade: 1 })).toEqual({ ok: true, grade: 1 });
  });
  test('Redis down: counted in this process, the same ceiling', async () => {
    await turnOn();
    require('../../../shared/services/cache/railway-redis.service').incr.mockImplementation(async () => null);
    for (let i = 0; i < 5; i++) await Grade.set({ token: tokenOf(), kid: chip(LOOSE), device: DEVICE, grade: (i % 2) + 4 });
    expect(await statusOf(Grade.set({ token: tokenOf(), kid: chip(LOOSE), device: DEVICE, grade: 1 }))).toBe(429);
  });
  test('the counter keys on the child, never the raw id or a name', async () => {
    await turnOn();
    await Grade.set({ token: tokenOf(), kid: chip(LOOSE), device: DEVICE, grade: 4 });
    const keys = [...redis.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(LOOSE);
  });
});

// ── the routes ─────────────────────────────────────────────────────────────────────────────────────────
async function serve(fn, hubOut) {
  const express = require('express');
  const Hub = require('../../../shared/services/quiz/web-quiz-hub');
  const spy = jest.spyOn(Hub, 'hub').mockImplementation(async () => JSON.parse(JSON.stringify(hubOut)));
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
  const h = { 'x-api-key': 'route-key' };
  const tok = tokenOf();
  const api = {
    tok,
    hubGet: async () => (await fetch(`${base}/hub/${tok}`, { headers: h })).text(),
    hubPost: async () => (await fetch(`${base}/hub/${tok}`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{}' })).text(),
    gradeGet: async (kid, device = DEVICE) => {
      const r = await fetch(`${base}/hub/${tok}/grade?kid=${kid}`, { headers: { ...h, ...(device ? { 'x-wq-device': device } : {}) } });
      return { status: r.status, body: await r.json() };
    },
    grade: async (body, device = DEVICE) => {
      const r = await fetch(`${base}/hub/${tok}/grade`, { method: 'POST', headers: { ...h, 'content-type': 'application/json', ...(device ? { 'x-wq-device': device } : {}) }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    },
  };
  try { return await fn(api); } finally { spy.mockRestore(); await new Promise((r) => server.close(r)); }
}

describe('the routes', () => {
  const HUB = () => ({ lang: 'en', kids: [{ chip: chip(LOOSE), first: 'Noor', animal: 'owl', grade: '3' }], kid: chip(LOOSE), rt: false, grownups: { teacher_href: '/quiz/teacher/abc', teacher_label: 'Back' } });
  test('on: the hub GET and POST answers carry grownups.grade_on, nothing else changes, and no child read is added', async () => {
    await turnOn();
    const golden = JSON.stringify(HUB());
    await serve(async (api) => {
      const n = reads.length;
      for (const out of [await api.hubGet(), await api.hubPost()]) {
        expect(JSON.parse(out).grownups.grade_on).toBe(true);
        expect(out.replace(/,"grade_on":true/, '')).toBe(golden);
      }
      expect(reads.slice(n)).toEqual([]);
    }, HUB());
  });
  test.each(OFF_VALUES)('%s: the hub GET and POST answers byte for byte the OFF golden; the grade route 404', async (_n, value) => {
    await turnOn(value);
    const golden = JSON.stringify(HUB());
    await serve(async (api) => {
      expect(await api.hubGet()).toBe(golden);
      expect(await api.hubPost()).toBe(golden);
      expect((await api.grade({ kid: chip(LOOSE), grade: 4 })).status).toBe(404);
      expect((await api.gradeGet(chip(LOOSE))).status).toBe(404);
    }, HUB());
    expect(updates).toEqual([]);
  });
  test('POST /hub/:token/grade: 200 {ok, grade}; 400 a bad grade; 403 a foreign chip or an untrusted phone; 429 the 6th', async () => {
    await turnOn();
    await serve(async (api) => {
      expect(await api.grade({ kid: chip(LOOSE), grade: 4 })).toEqual({ status: 200, body: { ok: true, grade: 4 } });
      expect((await api.grade({ kid: chip(LOOSE), grade: 6 })).status).toBe(400);
      expect((await api.grade({ kid: chip(LOOSE), grade: '3' })).status).toBe(400);
      expect((await api.grade({ kid: chip(OTHER), grade: 4 })).status).toBe(403);
      expect((await api.grade({ kid: chip(LOOSE), grade: 4 }, 'ZzZzZzZzZzZzZzZzZzZzZz')).status).toBe(403);
      expect((await api.grade({ kid: chip(LOOSE), grade: 4 }, null)).status).toBe(403);
      for (let i = 0; i < 4; i++) expect((await api.grade({ kid: chip(LOOSE), grade: (i % 2) + 2 })).status).toBe(200);
      expect((await api.grade({ kid: chip(LOOSE), grade: 1 })).status).toBe(429);
    }, HUB());
    expect(updates).toHaveLength(5);
  });
  test('GET /hub/:token/grade?kid=: 200 {now, cls}; 403 a foreign chip or an untrusted phone', async () => {
    await turnOn();
    await serve(async (api) => {
      expect(await api.gradeGet(chip(LISTED))).toEqual({ status: 200, body: { now: 4, cls: 4 } });
      expect((await api.gradeGet(chip(OTHER))).status).toBe(403);
      expect((await api.gradeGet(chip(LOOSE), 'ZzZzZzZzZzZzZzZzZzZzZz')).status).toBe(403);
      expect((await api.gradeGet(chip(LOOSE), null)).status).toBe(403);
    }, HUB());
  });
});
