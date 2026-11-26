'use strict';
/**
 * The writer's batch reads (classes, class_teachers, class_enrollments, class_teacher_subjects) page past PostgREST's
 * max-rows (1000), as roundsOn does. Production, 26 Nov first tick: 82 linked classes, 3,093 active enrollments; the
 * unpaged read answered 1000 rows covering 27 classes, so 47 of 73 considered classes read as no_roster and got no round.
 * A class that reads as no_roster is not marked seen for the day: a later tick looks at it again.
 * Faked boundaries: Supabase (in memory, max-rows 1000 on every table), Redis (a Map), the enqueue seam, the loggers.
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
const C = ['c1a55000-0000-4000-8000-0000000000f1', 'c1a55000-0000-4000-8000-0000000000f2', 'c1a55000-0000-4000-8000-0000000000f3'];
const T1 = '7e000000-0000-4000-8000-0000000000f1';
const NOW = new Date('2026-11-24T11:05:00Z'); // Tuesday 16:05 PKT
const LATER = new Date('2026-11-24T11:35:00Z');
const ON = (k) => ({ key: k, value: true });
const SWITCHES = [ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_link'), ON('web_quiz_evening_round'),
  { key: 'web_quiz_class_link_canary', value: { all: true } }];
const LESSON = 'grade_3_english_ch4_seg2';
const MAX = 1000;
const TABLES = ['classes', 'class_teachers', 'class_teacher_subjects', 'class_enrollments', 'class_links', 'quizzes'];
const pad = (n) => String(n).padStart(12, '0');
const kid = (n) => `c0000001-0000-4000-8000-${pad(n)}`;
const enr = (classId, n) => ({ id: `e0000000-0000-4000-8000-${pad(n)}`, class_id: classId, student_id: kid(n), is_active: true });

let db;
let orders;
function seed({ bigClass = 1200, emptyClass = null } = {}) {
  // The big class's rows sort first by id: an unpaged read stops inside it and never reaches the other two classes.
  const enrollments = [];
  let n = 1;
  for (let i = 0; i < bigClass; i += 1) enrollments.push(enr(C[0], n++));
  C.slice(1).forEach((c) => { if (c !== emptyClass) for (let i = 0; i < 25; i += 1) enrollments.push(enr(c, n++)); });
  db = {
    app_settings: SWITCHES,
    schools: [{ id: S1, region: 'Urban-II' }],
    classes: C.map((id) => ({ id, school_id: S1, grade_code: 'grade_3', section: id.slice(-1), is_active: true })),
    class_links: C.map((id, i) => ({ code: `K7Q2MXTRC${i}`, class_id: id, teacher_id: T1, term_code: '2026-27b', expires_at: '2027-03-31T18:59:59Z', revoked_at: null })),
    class_teachers: C.map((id, i) => ({ id: `ct${i}`, class_id: id, teacher_user_id: T1, is_active: true })),
    class_teacher_subjects: C.map((_, i) => ({ class_teacher_id: `ct${i}`, subject_code: 'english' })),
    class_enrollments: enrollments,
    niete_lp_downloads: [{
      id: 'd-1', user_id: T1, lesson_id: LESSON, asset_id: `a-${LESSON}`, version_stamp: 'v8', content_hash: `h-${LESSON}`, phone: null, status: 'sent', grade: 3, subject: 'english', created_at: '2026-11-24T05:00:00Z',
    }],
    niete_lp_opens: [],
    niete_lp_assets: [{ id: `a-${LESSON}`, asset_kind: 'lesson' }],
    niete_lp_asset_sources: [{ lesson_id: LESSON, version_stamp: 'v8', content_hash: `h-${LESSON}` }],
    quizzes: [], quiz_share_codes: [], quiz_sessions: [], quiz_answers: [], quiz_questions: [],
  };
  const fake = makeFake(db, { maxRows: Object.fromEntries(TABLES.map((t) => [t, MAX])) });
  orders = {};
  const from = (t) => {
    const b = fake.from(t);
    const order = b.order.bind(b);
    b.order = (c, o) => { (orders[t] = orders[t] || new Set()).add(c); return order(c, o); };
    return b;
  };
  Object.assign(supabase, { from, rpc: fake.rpc });
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
  require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache();
  require('../../shared/services/quiz/web-quiz-class-link-canary')._resetCache();
}

const Round = () => require('../../shared/services/quiz/web-quiz-evening-round');
const roundClasses = () => db.quizzes.filter((q) => q.meta && q.meta.source === 'evening_round').map((q) => q.meta.class_id).sort();
const write = (now = NOW) => Round().writeRounds({ now, enqueue: jest.fn().mockResolvedValue(undefined) });

beforeEach(() => { jest.clearAllMocks(); redis._store.clear(); });

test('over 1000 enrollments in one batch: every class reads its roster, no_roster 0, all three get a round', async () => {
  seed();
  const out = await write();
  expect(out).toMatchObject({ considered: 3, no_roster: 0, queued: 3, failed: 0 });
  expect(roundClasses()).toEqual([...C].sort());
  expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
});

test('the paged reads order only by columns the table has (class_teacher_subjects has no id)', async () => {
  seed();
  await write();
  expect([...(orders.class_enrollments || [])]).toEqual(['id']);
  expect([...(orders.class_teacher_subjects || [])].every((c) => ['class_teacher_id', 'subject_code'].includes(c))).toBe(true);
  expect((orders.class_teacher_subjects || new Set()).size).toBeGreaterThan(0);
});

test('a class with no roster is not marked seen: a later tick the same day writes its round once children are on it', async () => {
  seed({ bigClass: 10, emptyClass: C[2] });
  const first = await write();
  expect(first).toMatchObject({ queued: 2, no_roster: 1, no_roster_ids: [C[2]] });
  expect(roundClasses()).toEqual([C[0], C[1]].sort());
  for (let i = 0; i < 5; i += 1) db.class_enrollments.push(enr(C[2], 9000 + i));
  const second = await write(LATER);
  expect(second).toMatchObject({ considered: 1, queued: 1, no_roster: 0 });
  expect(roundClasses()).toEqual([...C].sort());
});

test('a class whose round was written stays seen: the later tick does not consider it again', async () => {
  seed({ bigClass: 10 });
  await write();
  const second = await write(LATER);
  expect(second).toMatchObject({ considered: 0, queued: 0, exists: 3 });
});

test('classes that read empty go after every class not yet looked at: 200 empty classes never starve a later one', async () => {
  seed({ bigClass: 10 });
  // 200 more linked classes with no roster, all sorting before C[*] by id.
  for (let i = 0; i < 200; i += 1) {
    const id = `a0000000-0000-4000-8000-${pad(i)}`;
    db.classes.push({ id, school_id: S1, grade_code: 'grade_3', section: 'Z', is_active: true });
    db.class_links.push({ code: `E${pad(i)}`, class_id: id, teacher_id: T1, term_code: '2026-27b', expires_at: '2027-03-31T18:59:59Z', revoked_at: null });
  }
  const first = await write();
  expect(first).toMatchObject({ considered: 200, no_roster: 200, queued: 0, more: true });
  const second = await write(LATER);
  expect(second).toMatchObject({ queued: 3 });
  expect(roundClasses()).toEqual([...C].sort());
});
