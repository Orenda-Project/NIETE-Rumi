'use strict';
/**
 * The teacher app's Home card for the standing class link (web-quiz-class-link-app.js), through the bot's internal
 * routes POST /api/internal/wq/cl/app and /app/tap:
 *   - off (the class link or a parent switch) -> 404 not_found, nothing minted;
 *   - a teacher sees only the classes they teach (class_teachers), each with its label parts, its link and the SAME
 *     wa.me href the report card's Forward builds (forwardHref, ?f=1); another teacher's class is never minted;
 *   - the canary scope (web_quiz_class_link_canary, helper web-quiz-class-link-canary.js) filters classes BEFORE any mint;
 *     the helper absent = no restriction, the helper failing = left out;
 *   - a tap logs quiz_forward_tap{surface class_link} through forwardHref and folds that class (sent) for the term;
 *     a tap on a class that is not the teacher's is 404 and changes nothing;
 *   - with the evening round on: a READY round today -> {lesson, played:0}; finished sittings -> a count of children
 *     (each child once) and the report page's Evening rounds link; never a child's name.
 * Faked boundaries: Supabase (in memory), Redis (a Map), the loggers, the event key, the canary helper (virtual).
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
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
jest.mock('../../shared/services/quiz/web-quiz-kid', () => ({
  kid: (id) => `kid:${String(id).slice(-4)}`, dk: () => 'dk', cls: () => 'clshash00000', qk: () => 'qk00000000', envelope: (f) => ({ ev_v: 2, ...f }),
}));
jest.mock('../../shared/services/quiz/web-quiz-class-link-canary', () => ({ inCanary: jest.fn(async () => true) }), { virtual: true });

const http = require('http');
const express = require('express');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const redis = require('../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const Canary = require('../../shared/services/quiz/web-quiz-class-link-canary');

const A = '7e000000-0000-4000-8000-0000000000a1';
const B = '7e000000-0000-4000-8000-0000000000b2';
const C1 = 'c1a55000-0000-4000-8000-0000000000c1';
const C2 = 'c1a55000-0000-4000-8000-0000000000c2';
const C3 = 'c1a55000-0000-4000-8000-0000000000c3';
const S1 = '5c000000-0000-4000-8000-000000000051';
const S2 = '5c000000-0000-4000-8000-000000000052';
const ZARA = 'c0000001-0000-4000-8000-0000000000e1';
const ALI = 'c0000002-0000-4000-8000-0000000000e2';
const NOW = new Date('2026-11-24T13:00:00Z'); // 18:00 PKT, a Tuesday
const DAY = '2026-11-24';
const ON = (k) => ({ key: k, value: true });
const LINK_ON = [ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_link')];

let db;
function seed(over = {}) {
  db = {
    app_settings: LINK_ON,
    classes: [
      { id: C1, school_id: S1, grade_code: 'grade_3', section: 'A', is_active: true },
      { id: C2, school_id: S2, grade_code: 'grade_5', section: null, is_active: true },
      { id: C3, school_id: S1, grade_code: 'grade_4', section: 'B', is_active: true },
    ],
    class_teachers: [
      { class_id: C1, teacher_user_id: A, is_active: true },
      { class_id: C2, teacher_user_id: A, is_active: true },
      { class_id: C3, teacher_user_id: B, is_active: true },
    ],
    class_enrollments: [
      { class_id: C1, student_id: ZARA, is_active: true },
      { class_id: C1, student_id: ALI, is_active: true },
      { class_id: C2, student_id: ALI, is_active: true },
      { class_id: C3, student_id: ZARA, is_active: true },
    ],
    students: [{ id: ZARA, student_name: 'Zara Test', is_active: true }, { id: ALI, student_name: 'Ali Test', is_active: true }],
    class_links: [],
    quizzes: [],
    quiz_share_codes: [],
    quiz_sessions: [],
    ...over,
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
  require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache();
  require('../../shared/services/quiz/web-quiz-evening-round')._resetCache();
}

const App = () => require('../../shared/services/quiz/web-quiz-class-link-app');
const CL = () => require('../../shared/services/quiz/web-quiz-class-link');

beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  Canary.inCanary.mockImplementation(async () => true);
  process.env.WEB_QUIZ_TOKEN_SECRET = 'class-link-app-test-secret';
  process.env.WEB_QUIZ_BASE_URL = 'https://quiz.example.org';
  seed();
});

function serve() {
  const app = express();
  app.use(express.json());
  app.use('/cl', require('../../shared/routes/web-quiz-class-link.routes'));
  const server = http.createServer(app);
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}
const post = (base, p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('off', () => {
  test('the class link off: no card (null), the route 404 not_found, nothing minted', async () => {
    seed({ app_settings: [ON('web_quiz_challenge'), ON('web_quiz_challenge_v2')] });
    expect(await App().forApp(A, { now: NOW })).toBeNull();
    const s = await serve();
    try {
      const r = await post(s.base, '/cl/app', { teacher: A });
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: 'not_found' });
      const t = await post(s.base, '/cl/app/tap', { teacher: A, class_id: C1, how: 'forward' });
      expect(t.status).toBe(404);
    } finally { s.server.close(); }
    expect(db.class_links).toEqual([]);
    expect(logEvent).not.toHaveBeenCalled();
  });

  test('no teacher id: null', async () => {
    expect(await App().forApp(null, { now: NOW })).toBeNull();
  });
});

describe('a teacher sees only their own classes', () => {
  test('teacher A: Class 3 A and Class 5 (no section), each with its link and the report card\'s wa.me href', async () => {
    const out = await App().forApp(A, { now: NOW });
    expect(out.classes.map((c) => [c.classId, c.grade, c.section])).toEqual([[C1, 3, 'A'], [C2, 5, null]]);
    const codes = Object.fromEntries(db.class_links.map((l) => [l.class_id, l.code]));
    expect(Object.keys(codes).sort()).toEqual([C1, C2].sort()); // C3 (teacher B) never minted
    for (const c of out.classes) {
      expect(c.url).toBe(`https://quiz.example.org/j/${codes[c.classId]}`);
      expect(c.sent).toBe(false);
      expect(c.round).toBeNull();
      // eslint-disable-next-line no-await-in-loop
      expect(c.sendHref).toBe(await CL().forwardHref({ teacherId: A, classId: c.classId }));
    }
    expect(out.reportHref).toBeNull();
    expect(JSON.stringify(out)).not.toMatch(/Zara|Ali/);
  });

  test('teacher B sees only C3; the route answers the same for the teacher it is given', async () => {
    const s = await serve();
    try {
      const r = await post(s.base, '/cl/app', { teacher: B });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.classes.map((c) => c.classId)).toEqual([C3]);
      expect(body.classes[0]).toMatchObject({ grade: 4, section: 'B', sent: false, round: null });
    } finally { s.server.close(); }
  });

  test('a teacher with no class: an empty list (nothing drawn)', async () => {
    const out = await App().forApp('7e000000-0000-4000-8000-0000000000ff', { now: NOW });
    expect(out).toEqual({ classes: [], reportHref: null });
  });
});

describe('the canary scope filters before any mint', () => {
  test('a class outside the canary gets no card and no link row', async () => {
    Canary.inCanary.mockImplementation(async ({ classId }) => classId === C1);
    const out = await App().forApp(A, { now: NOW });
    expect(out.classes.map((c) => c.classId)).toEqual([C1]);
    expect(db.class_links.map((l) => l.class_id)).toEqual([C1]);
    expect(Canary.inCanary).toHaveBeenCalledWith({ classId: C1, schoolId: S1 });
    expect(Canary.inCanary).toHaveBeenCalledWith({ classId: C2, schoolId: S2 });
  });

  test('by school: the canary lists S2 only -> Class 5 only', async () => {
    Canary.inCanary.mockImplementation(async ({ schoolId }) => schoolId === S2);
    const out = await App().forApp(A, { now: NOW });
    expect(out.classes.map((c) => c.classId)).toEqual([C2]);
  });

  test('a failing canary read leaves the class out (fail closed)', async () => {
    Canary.inCanary.mockImplementation(async () => { throw new Error('read failed'); });
    const out = await App().forApp(A, { now: NOW });
    expect(out.classes).toEqual([]);
    expect(db.class_links).toEqual([]);
  });

  test('a tap on a class outside the canary is 404 and logs nothing', async () => {
    Canary.inCanary.mockImplementation(async ({ classId }) => classId !== C1);
    expect(await App().tap({ teacherId: A, classId: C1, how: 'forward' })).toBeNull();
    expect(logEvent).not.toHaveBeenCalled();
  });

  test('the helper absent (not deployed yet): no restriction', () => {
    let out;
    return new Promise((done) => {
      jest.isolateModules(() => {
        jest.doMock('../../shared/services/quiz/web-quiz-class-link-canary', () => {
          throw Object.assign(new Error("Cannot find module './web-quiz-class-link-canary' from 'web-quiz-class-link-app.js'"), { code: 'MODULE_NOT_FOUND' });
        }, { virtual: true });
        const sb = require('../../shared/config/supabase');
        const fake = makeFake(db);
        Object.assign(sb, { from: fake.from, rpc: fake.rpc });
        out = require('../../shared/services/quiz/web-quiz-class-link-app').forApp(A, { now: NOW });
      });
      out.then((o) => { expect(o.classes.map((c) => c.classId)).toEqual([C1, C2]); done(); });
    });
  });
});

describe('Send / Copy (the tap)', () => {
  test('forward: logs quiz_forward_tap{class_link, wa_me} via forwardHref, answers its href, and folds that class', async () => {
    const before = await App().forApp(A, { now: NOW });
    jest.clearAllMocks();
    const s = await serve();
    try {
      const r = await post(s.base, '/cl/app/tap', { teacher: A, class_id: C1, how: 'forward' });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true, href: before.classes[0].sendHref });
    } finally { s.server.close(); }
    const ev = logEvent.mock.calls.filter(([n]) => n === 'web_quiz.quiz_forward_tap');
    expect(ev).toHaveLength(1);
    expect(ev[0][1]).toMatchObject({ surface: 'class_link', method: 'wa_me', origin: 'class_link', share_code_id: null });
    const after = await App().forApp(A, { now: NOW });
    expect(after.classes.map((c) => [c.classId, c.sent])).toEqual([[C1, true], [C2, false]]);
  });

  test('copy: logs method copy and folds the class too', async () => {
    await App().forApp(A, { now: NOW });
    jest.clearAllMocks();
    expect(await App().tap({ teacherId: A, classId: C2, how: 'copy' })).toEqual({ ok: true });
    expect(logEvent.mock.calls.filter(([n]) => n === 'web_quiz.quiz_forward_tap')[0][1]).toMatchObject({ surface: 'class_link', method: 'copy' });
    const after = await App().forApp(A, { now: NOW });
    expect(after.classes.find((c) => c.classId === C2).sent).toBe(true);
  });

  test('another teacher\'s class: null (404), no event, nothing folded', async () => {
    expect(await App().tap({ teacherId: A, classId: C3, how: 'forward' })).toBeNull();
    expect(logEvent).not.toHaveBeenCalled();
    expect(db.class_links).toEqual([]);
    expect([...redis._store.keys()].filter((k) => k.includes(C3))).toEqual([]);
  });

  test('a bad body: 400 at the route (no teacher, a class that is not an id, an unknown how)', async () => {
    const s = await serve();
    try {
      expect((await post(s.base, '/cl/app/tap', { class_id: C1, how: 'forward' })).status).toBe(400);
      expect((await post(s.base, '/cl/app/tap', { teacher: A, class_id: 'x', how: 'forward' })).status).toBe(400);
      expect((await post(s.base, '/cl/app/tap', { teacher: A, class_id: C1, how: 'sms' })).status).toBe(400);
      expect((await post(s.base, '/cl/app', {})).status).toBe(400);
    } finally { s.server.close(); }
  });
});

describe('tonight\'s evening round', () => {
  function withRound({ topic = 'Adding two-digit numbers', status = 'ready', sessions = [] } = {}) {
    seed({
      app_settings: [...LINK_ON, ON('web_quiz_evening_round')],
      quizzes: [{
        id: 'qr1', teacher_id: A, quiz_source: 'lp_v8', status, topic,
        meta: { source: 'evening_round', class_id: C1, round_day: DAY, round_code: 'RND234', share_code_id: 'scr1', class_link_code: 'K7Q2MXTRAB', n_items: 7, n_recall: 2 },
      }],
      quiz_share_codes: [{ id: 'scr1', code: 'RND234', quiz_id: 'qr1', class_id: C1 }],
      quiz_sessions: sessions,
    });
  }

  test('a ready round, nobody played yet: {lesson, played: 0} on its class only; no report link', async () => {
    withRound();
    const out = await App().forApp(A, { now: NOW });
    expect(out.classes.find((c) => c.classId === C1).round).toEqual({ lesson: 'Adding two-digit numbers', played: 0 });
    expect(out.classes.find((c) => c.classId === C2).round).toBeNull();
    expect(out.reportHref).toBeNull();
  });

  test('before the round is ready: nothing (no clock promise)', async () => {
    withRound({ status: 'generating' });
    const out = await App().forApp(A, { now: NOW });
    expect(out.classes.every((c) => c.round === null)).toBe(true);
  });

  test('children played: a count (each child once, finished sittings only) + the report page\'s Evening rounds link; no names', async () => {
    withRound({
      sessions: [
        { id: 's1', share_code_id: 'scr1', student_id: ZARA, status: 'completed', completed_at: '2026-11-24T12:00:00Z' },
        { id: 's2', share_code_id: 'scr1', student_id: ZARA, status: 'completed', completed_at: '2026-11-24T12:10:00Z' },
        { id: 's3', share_code_id: 'scr1', student_id: ALI, status: 'completed', completed_at: '2026-11-24T12:20:00Z' },
        { id: 's4', share_code_id: 'scr1', student_id: 'c0000003-0000-4000-8000-0000000000e3', status: 'in_progress', completed_at: null },
      ],
    });
    const out = await App().forApp(A, { now: NOW });
    expect(out.classes.find((c) => c.classId === C1).round).toEqual({ lesson: 'Adding two-digit numbers', played: 2 });
    expect(out.reportHref).toMatch(/^https:\/\/quiz\.example\.org\/r\/[^?#]+\?tab=class#evening-rounds$/);
    expect(JSON.stringify(out)).not.toMatch(/Zara|Ali/);
  });

  test('the writer\'s fallback topic ("Lesson") is no title: lesson null', async () => {
    withRound({ topic: 'Lesson' });
    const out = await App().forApp(A, { now: NOW });
    expect(out.classes.find((c) => c.classId === C1).round).toEqual({ lesson: null, played: 0 });
  });

  test('the evening round off: no round line even with a ready round', async () => {
    withRound();
    db.app_settings = LINK_ON;
    require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache();
    const out = await App().forApp(A, { now: NOW });
    expect(out.classes.every((c) => c.round === null)).toBe(true);
  });
});
