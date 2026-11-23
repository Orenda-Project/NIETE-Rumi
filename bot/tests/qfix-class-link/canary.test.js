'use strict';
/**
 * web_quiz_class_link_canary ({all?, regions?, school_ids?, class_ids?}): while it lists schools or classes, the evening round is
 * written only for those classes (the production flip starts with one sector); {"all": true} -> every class; no row, empty
 * lists or anything else -> NO class (a missing row is off, ORG 4.5: CL2's deploy must not reach every class because the
 * row was never written or already deleted); a failed read -> no class (a blip pauses new exposure, never widens it).
 * The same scope gates the teacher app's class-link card (forApp) before any mint. The tile, the badge and the reminder
 * read rounds, so a class with no round shows nothing.
 * Faked boundaries: Supabase (in memory), Redis (a Map), the enqueue seam, the loggers, WhatsApp.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn().mockResolvedValue(true) }));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: async (k) => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null),
    set: async (k, v) => { store.set(k, v); return true; },
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; },
    delete: async (k) => store.delete(k),
  };
});

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const redis = require('../../shared/services/cache/railway-redis.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');

const S1 = '5c400000-0000-4000-8000-0000000000a1';
const S2 = '5c400000-0000-4000-8000-0000000000a2';
const C1 = 'c1a55000-0000-4000-8000-0000000000f1';
const C2 = 'c1a55000-0000-4000-8000-0000000000f2';
const T1 = '7e000000-0000-4000-8000-0000000000f1';
const T2 = '7e000000-0000-4000-8000-0000000000f2';
const NOW = new Date('2026-11-24T11:05:00Z'); // Tuesday 16:05 PKT
const ON = (k) => ({ key: k, value: true });
const SWITCHES = [ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_link'), ON('web_quiz_evening_round')];
const dl = (user, grade, subject, at, lesson) => ({
  id: `d-${lesson}`, user_id: user, lesson_id: lesson, asset_id: `a-${lesson}`, version_stamp: 'v8', content_hash: `h-${lesson}`, phone: null, status: 'sent', grade, subject, created_at: at,
});
const LESSONS = ['grade_3_english_ch4_seg2', 'grade_4_english_ch2_seg1'];

let db;
function seed(settings = SWITCHES) {
  db = {
    app_settings: settings,
    schools: [{ id: S1, region: 'Urban-II ' }, { id: S2, region: 'Tarnol' }],
    classes: [
      { id: C1, school_id: S1, grade_code: 'grade_3', section: 'A', is_active: true },
      { id: C2, school_id: S2, grade_code: 'grade_4', section: 'A', is_active: true },
    ],
    class_links: [
      { code: 'K7Q2MXTRCA', class_id: C1, teacher_id: T1, term_code: '2026-27b', expires_at: '2027-03-31T18:59:59Z', revoked_at: null },
      { code: 'P3W8TTZZCA', class_id: C2, teacher_id: T2, term_code: '2026-27b', expires_at: '2027-03-31T18:59:59Z', revoked_at: null },
    ],
    class_teachers: [
      { id: 'ct1', class_id: C1, teacher_user_id: T1, is_active: true },
      { id: 'ct2', class_id: C2, teacher_user_id: T2, is_active: true },
    ],
    class_teacher_subjects: [],
    class_enrollments: [
      { class_id: C1, student_id: 'c0000001-0000-4000-8000-0000000000f1', is_active: true },
      { class_id: C2, student_id: 'c0000001-0000-4000-8000-0000000000f2', is_active: true },
    ],
    niete_lp_downloads: [
      dl(T1, 3, 'english', '2026-11-24T05:00:00Z', LESSONS[0]),
      dl(T2, 4, 'english', '2026-11-24T05:00:00Z', LESSONS[1]),
    ],
    niete_lp_opens: [],
    niete_lp_assets: LESSONS.map((l) => ({ id: `a-${l}`, asset_kind: 'lesson' })),
    niete_lp_asset_sources: LESSONS.map((l) => ({ lesson_id: l, version_stamp: 'v8', content_hash: `h-${l}` })),
    quizzes: [], quiz_share_codes: [], quiz_sessions: [], quiz_answers: [], quiz_questions: [],
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
  require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache();
  try { require('../../shared/services/quiz/web-quiz-class-link-canary')._resetCache(); } catch (_) { /* red run: absent */ }
}

const Round = () => require('../../shared/services/quiz/web-quiz-evening-round');
const roundClasses = () => db.quizzes.filter((q) => q.meta && q.meta.source === 'evening_round').map((q) => q.meta.class_id).sort();
const canary = (value) => [...SWITCHES, { key: 'web_quiz_class_link_canary', value }];

beforeEach(() => { jest.clearAllMocks(); redis._store.clear(); });

test('no canary row: no class gets a round (a missing row is off), both counted out, nothing sent', async () => {
  seed();
  const out = await Round().writeRounds({ now: NOW, enqueue: jest.fn().mockResolvedValue(undefined) });
  expect(roundClasses()).toEqual([]);
  expect(out).toMatchObject({ queued: 0, canary_out: 2 });
  expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
});

test('{"all": true}: every linked class with a lesson gets its round', async () => {
  seed(canary({ all: true }));
  const out = await Round().writeRounds({ now: NOW, enqueue: jest.fn().mockResolvedValue(undefined) });
  expect(roundClasses()).toEqual([C1, C2].sort());
  expect(out.canary_out).toBe(0);
});

test('a list wins over all: {"all": true, class_ids: [C2]} -> C2 only (the narrower reading)', async () => {
  seed(canary({ all: true, class_ids: [C2] }));
  await Round().writeRounds({ now: NOW, enqueue: jest.fn().mockResolvedValue(undefined) });
  expect(roundClasses()).toEqual([C2]);
});

test('canary by class: only the listed class gets a round, the other is counted out', async () => {
  seed(canary({ class_ids: [C2] }));
  const out = await Round().writeRounds({ now: NOW, enqueue: jest.fn().mockResolvedValue(undefined) });
  expect(roundClasses()).toEqual([C2]);
  expect(out).toMatchObject({ queued: 1, canary_out: 1 });
  expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
});

test('canary by school (one sector = its schools): the class of a listed school only', async () => {
  seed(canary({ school_ids: [S1] }));
  await Round().writeRounds({ now: NOW, enqueue: jest.fn().mockResolvedValue(undefined) });
  expect(roundClasses()).toEqual([C1]);
});

test('canary by sector name, the same rule as the push canary (schools.region, exact after trim)', async () => {
  seed(canary({ regions: ['Urban-II'] }));
  const out = await Round().writeRounds({ now: NOW, enqueue: jest.fn().mockResolvedValue(undefined) });
  expect(roundClasses()).toEqual([C1]);
  expect(out.canary_out).toBe(1);
  const Canary = require('../../shared/services/quiz/web-quiz-class-link-canary');
  expect(await Canary.inCanary({ classId: C2, schoolId: S2 })).toBe(false);
  expect(await Canary.inCanary({ classId: C1, schoolId: S1 })).toBe(true);
});

test.each([
  ['empty lists', { school_ids: [], class_ids: [] }],
  ['an empty object (the app-card lever)', {}],
  ['all not exactly true', { all: 'true' }],
  ['not an object', ['x']],
])('canary row with %s: no class', async (_name, value) => {
  seed(canary(value));
  const out = await Round().writeRounds({ now: NOW, enqueue: jest.fn().mockResolvedValue(undefined) });
  expect(roundClasses()).toEqual([]);
  expect(out.canary_out).toBe(2);
});

test('the canary read fails: no class gets a round (fail closed), the writer does not throw', async () => {
  seed(canary({ class_ids: [C1] }));
  const from = supabase.from;
  supabase.from = (t) => {
    const b = from(t);
    if (t !== 'app_settings') return b;
    const eq = b.eq.bind(b);
    b.eq = (c, v) => (v === 'web_quiz_class_link_canary' ? { then: (res) => res({ data: null, error: { message: 'boom' } }) } : eq(c, v));
    return b;
  };
  const out = await Round().writeRounds({ now: NOW, enqueue: jest.fn().mockResolvedValue(undefined) });
  expect(roundClasses()).toEqual([]);
  expect(out.canary_out).toBe(2);
});

test('inCanary: by class, by school (with and without the caller giving the school), and no row', async () => {
  seed(canary({ school_ids: [S1], class_ids: [C2] }));
  const Canary = require('../../shared/services/quiz/web-quiz-class-link-canary');
  expect(await Canary.inCanary({ classId: C2 })).toBe(true);
  expect(await Canary.inCanary({ classId: C1, schoolId: S1 })).toBe(true);
  expect(await Canary.inCanary({ classId: C1 })).toBe(true);
  expect(await Canary.inCanary({ classId: 'c1a55000-0000-4000-8000-0000000000ff', schoolId: S2 })).toBe(false);
  seed();
  expect(await Canary.inCanary({ classId: C1 })).toBe(false);
  expect([...(await Canary.allowedClasses([C1, C2]))]).toEqual([]);
  seed(canary({ all: true }));
  expect(await Canary.inCanary({ classId: C1 })).toBe(true);
  expect([...(await Canary.allowedClasses([C1, C2]))].sort()).toEqual([C1, C2].sort());
});

describe('the teacher app card (forApp) reads the same scope before any mint', () => {
  const App = () => require('../../shared/services/quiz/web-quiz-class-link-app');
  const env = {};
  beforeAll(() => {
    ['WEB_QUIZ_TOKEN_SECRET', 'WEB_QUIZ_BASE_URL'].forEach((k) => { env[k] = process.env[k]; });
    process.env.WEB_QUIZ_TOKEN_SECRET = 'canary-app-test-secret';
    process.env.WEB_QUIZ_BASE_URL = 'https://quiz.example.org';
  });
  afterAll(() => { Object.entries(env).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }); });
  const appSeed = (settings) => {
    seed(settings);
    db.class_links = [];
    db.students = [{ id: 'c0000001-0000-4000-8000-0000000000f1', student_name: 'Zara Test', is_active: true }];
  };

  test('no canary row: no card and no link minted', async () => {
    appSeed(SWITCHES);
    const r = await App().forApp(T1, { now: NOW });
    expect((r && r.classes) || []).toEqual([]);
    expect(db.class_links).toEqual([]);
  });

  test('{"all": true}: the teacher\'s class gets its card and its link', async () => {
    appSeed(canary({ all: true }));
    const r = await App().forApp(T1, { now: NOW });
    expect(r.classes.map((c) => c.classId)).toEqual([C1]);
    expect(db.class_links.map((l) => l.class_id)).toEqual([C1]);
  });

  test('one listed class: only that class (teacher 2 gets C2, teacher 1 nothing)', async () => {
    appSeed(canary({ class_ids: [C2] }));
    expect(((await App().forApp(T1, { now: NOW })) || {}).classes || []).toEqual([]);
    const r2 = await App().forApp(T2, { now: NOW });
    expect(r2.classes.map((c) => c.classId)).toEqual([C2]);
  });
});
