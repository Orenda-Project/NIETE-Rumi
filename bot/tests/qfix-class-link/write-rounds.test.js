'use strict';
/**
 * writeRounds — the 16:00 writer. One round per class per PKT school day, only for a class with a live standing link,
 * from the lesson a class teacher took for the day by the offers' 14:00 cohort rule (two teachers -> the earlier
 * delivered; the class's grade, and the teacher's recorded subject for that class), with the class's misses 2-3 PKT
 * days earlier as its recall source. A quiz_generate job with NO phone. Idempotent; off by default; one summary line.
 * Faked boundaries: Supabase (in memory), Redis (a Map), SQS (the enqueue seam), the loggers, WhatsApp.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn().mockResolvedValue(true), sendInteractiveList: jest.fn(), sendInteractiveButtons: jest.fn() }));
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
const SQS = require('../../shared/services/queue/sqs-queue.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const { logEvent } = require('../../shared/utils/structured-logger');

const C1 = 'c1a55000-0000-4000-8000-0000000000e1';
const C2 = 'c1a55000-0000-4000-8000-0000000000e2';
const C3 = 'c1a55000-0000-4000-8000-0000000000e3';
const T1 = '7e000000-0000-4000-8000-0000000000e1';
const T2 = '7e000000-0000-4000-8000-0000000000e2';
const T3 = '7e000000-0000-4000-8000-0000000000e3';
const ZARA = 'c0000001-0000-4000-8000-0000000000e1';
const ALI = 'c0000001-0000-4000-8000-0000000000e2';
const ORIG1 = '99999999-0000-4000-8000-000000000001';
const ORIG2 = '99999999-0000-4000-8000-000000000002';
const ORIG3 = '99999999-0000-4000-8000-000000000003';
const NOW = new Date('2026-11-24T11:05:00Z'); // Tuesday 16:05 PKT
const ON = (k) => ({ key: k, value: true });
const SWITCHES = [ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_link'), ON('web_quiz_evening_round')];
const dl = (user, grade, subject, at, lesson) => ({
  id: `d-${lesson}`, user_id: user, lesson_id: lesson, asset_id: `a-${lesson}`, version_stamp: 'v8', content_hash: `h-${lesson}`, phone: null, status: 'sent', grade, subject, created_at: at,
});

let db;
function seed(settings = SWITCHES, over = {}) {
  db = {
    app_settings: settings,
    classes: [
      { id: C1, grade_code: 'grade_3', section: 'B', is_active: true },
      { id: C2, grade_code: 'grade_4', section: 'A', is_active: true },
      { id: C3, grade_code: 'grade_5', section: 'A', is_active: true },
    ],
    class_links: [
      { code: 'K7Q2MXTRAB', class_id: C1, teacher_id: T1, term_code: '2026-27b', expires_at: '2027-03-31T18:59:59Z', revoked_at: null },
      { code: 'P3W8TTZZAB', class_id: C2, teacher_id: T3, term_code: '2026-27b', expires_at: '2027-03-31T18:59:59Z', revoked_at: null },
    ],
    class_teachers: [
      { id: 'ct1', class_id: C1, teacher_user_id: T1, is_active: true },
      { id: 'ct2', class_id: C1, teacher_user_id: T2, is_active: true },
      { id: 'ct3', class_id: C2, teacher_user_id: T3, is_active: true },
      { id: 'ct4', class_id: C3, teacher_user_id: T1, is_active: true },
    ],
    class_teacher_subjects: [
      { class_teacher_id: 'ct1', subject_code: 'english', class_id: C1 },
      { class_teacher_id: 'ct2', subject_code: 'maths', class_id: C1 },
    ],
    class_enrollments: [
      { class_id: C1, student_id: ZARA, is_active: true },
      { class_id: C1, student_id: ALI, is_active: true },
      { class_id: C2, student_id: 'c0000001-0000-4000-8000-0000000000e9', is_active: true },
    ],
    niete_lp_downloads: [
      dl(T1, 3, 'english', '2026-11-24T05:00:00Z', 'grade_3_english_ch4_seg2'), // 10:00 PKT
      dl(T2, 3, 'math', '2026-11-24T03:00:00Z', 'grade_3_math_ch7_seg1'), // 08:00 PKT: the earliest
      dl(T1, 5, 'english', '2026-11-24T02:00:00Z', 'grade_5_english_ch1_seg1'), // another grade
      dl(T2, 3, 'math', '2026-11-24T10:00:00Z', 'grade_3_math_ch7_seg2'), // 15:00 PKT: tomorrow's
    ],
    niete_lp_opens: [],
    // the offers' export keeps lesson assets with a slide script only (lp-quiz-offer.service lpTakenFor)
    niete_lp_assets: ['grade_3_english_ch4_seg2', 'grade_3_math_ch7_seg1', 'grade_5_english_ch1_seg1', 'grade_3_math_ch7_seg2']
      .map((l) => ({ id: `a-${l}`, asset_kind: 'lesson' })),
    niete_lp_asset_sources: ['grade_3_english_ch4_seg2', 'grade_3_math_ch7_seg1', 'grade_5_english_ch1_seg1', 'grade_3_math_ch7_seg2']
      .map((l) => ({ lesson_id: l, version_stamp: 'v8', content_hash: `h-${l}` })),
    quizzes: [{ id: 'qold', teacher_id: T1, quiz_source: 'lp_v8', subject: 'english', grade: '3', language: 'en', status: 'sent', meta: { source: 'lp_offer' } }],
    quiz_share_codes: [{ id: 'scold', code: 'OLD234', quiz_id: 'qold', class_id: C1, teacher_user_id: T1 }],
    quiz_sessions: [
      { id: 's1', student_id: ZARA, quiz_id: 'qold', share_code_id: 'scold', status: 'completed', completed_at: '2026-11-22T13:00:00Z' }, // D-2
      { id: 's2', student_id: ALI, quiz_id: 'qold', share_code_id: 'scold', status: 'completed', completed_at: '2026-11-22T05:00:00Z' }, // Sunday morning: Tuesday's window too
      { id: 's3', student_id: ZARA, quiz_id: 'qold', share_code_id: 'scold', status: 'completed', completed_at: '2026-11-23T09:00:00Z' }, // D-1: not recalled
      { id: 's4', student_id: ALI, quiz_id: 'qold', share_code_id: 'scold', status: 'completed', completed_at: '2026-11-20T09:00:00Z' }, // D-4: not recalled
    ],
    quiz_answers: [
      { id: 'a1', session_id: 's1', question_id: ORIG1, is_correct: false },
      { id: 'a2', session_id: 's2', question_id: ORIG1, is_correct: false },
      { id: 'a3', session_id: 's2', question_id: ORIG2, is_correct: false },
      { id: 'a4', session_id: 's1', question_id: ORIG2, is_correct: true },
      { id: 'a5', session_id: 's3', question_id: ORIG3, is_correct: false },
      { id: 'a6', session_id: 's4', question_id: ORIG3, is_correct: false },
    ],
    quiz_questions: [
      { id: ORIG1, quiz_id: 'qold', question_text: 'Which word is a colour?', option_a: 'red', option_b: 'run', correct_option: 'A', sort_order: 1 },
      { id: ORIG2, quiz_id: 'qold', question_text: 'Which word rhymes with cat?', option_a: 'hat', option_b: 'dog', correct_option: 'A', sort_order: 2 },
      { id: ORIG3, quiz_id: 'qold', question_text: 'Which word is a number?', option_a: 'two', option_b: 'tree', correct_option: 'A', sort_order: 3 },
    ],
    ...over,
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
  require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache();
}

const Round = () => require('../../shared/services/quiz/web-quiz-evening-round');
const rounds = () => db.quizzes.filter((q) => q.meta && q.meta.source === 'evening_round');

beforeEach(() => { jest.clearAllMocks(); redis._store.clear(); seed(); });

test('one round for the linked class whose teacher took a lesson for today: the EARLIER of two teachers, the class\'s grade', async () => {
  const enqueue = jest.fn().mockResolvedValue(undefined);
  const out = await Round().writeRounds({ now: NOW, enqueue });
  // the offers lane's batched export (lpTakenFor), run for real against the same tables
  expect(out).toMatchObject({ day: '2026-11-24', queued: 1, no_lp: 1, lp_src: 'lp-quiz-offer.service:lpTakenFor' });
  expect(rounds()).toHaveLength(1);
  const q = rounds()[0];
  expect(q).toMatchObject({ teacher_id: T2, quiz_source: 'lp_v8', status: 'generating', grade: '3', subject: 'math' });
  expect(q.meta).toMatchObject({
    source: 'evening_round', class_id: C1, round_day: '2026-11-24', class_link_code: 'K7Q2MXTRAB', lesson_date: '2026-11-24',
    teachers_with_lp: 2, subjects_with_lp: 2, chosen: 'earliest',
  });
  expect(q.meta.lessons.map((l) => l.lesson_id)).toEqual(['grade_3_math_ch7_seg1']);
  expect(enqueue).toHaveBeenCalledWith(q.id);
  expect(logEvent).toHaveBeenCalledWith('web_quiz.round_tick', expect.objectContaining({ queued: 1 }));
  expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
});

test('the recall source: misses finished 2-3 PKT days earlier by the class\'s children, most-missed first', async () => {
  await Round().writeRounds({ now: NOW, enqueue: jest.fn() });
  const src = rounds()[0].meta.recall_src;
  expect(src.map((s) => [s.qid, s.n])).toEqual([[ORIG1, 2], [ORIG2, 1]]);
  expect(src[0].kids.sort()).toEqual([ZARA, ALI].sort());
});

test('the default job: quiz_generate with NO phone and source evening_round', async () => {
  await Round().writeRounds({ now: NOW });
  expect(SQS.queueJob).toHaveBeenCalledTimes(1);
  const [id, type, payload] = SQS.queueJob.mock.calls[0];
  expect(type).toBe('quiz_generate');
  expect(payload).toEqual({ quizId: id, source: 'evening_round' });
  expect(payload).not.toHaveProperty('phone');
});

test('idempotent: a second run (the other replica, the next tick) writes nothing more', async () => {
  await Round().writeRounds({ now: NOW, enqueue: jest.fn() });
  const again = await Round().writeRounds({ now: NOW, enqueue: jest.fn() });
  expect(rounds()).toHaveLength(1);
  expect(again.queued).toBe(0);
  // the direct trigger for one class too: the DB says it exists
  redis._store.clear();
  const direct = await Round().writeRounds({ now: NOW, classIds: [C1], enqueue: jest.fn() });
  expect(direct.queued).toBe(0);
  expect(direct.exists).toBe(1);
});

test('the lock: another replica holding this class\'s lock -> no second row', async () => {
  await redis.setNX(Round().lockKey(C1, '2026-11-24'), { at: 1 });
  const out = await Round().writeRounds({ now: NOW, enqueue: jest.fn() });
  expect(out.locked).toBe(1);
  expect(rounds()).toHaveLength(0);
});

test('off: the switch missing / false / the class link off -> nothing written, nothing queued', async () => {
  for (const settings of [SWITCHES.filter((r) => r.key !== 'web_quiz_evening_round'),
    [...SWITCHES.filter((r) => r.key !== 'web_quiz_evening_round'), { key: 'web_quiz_evening_round', value: false }],
    SWITCHES.filter((r) => r.key !== 'web_quiz_class_link')]) {
    seed(settings);
    // eslint-disable-next-line no-await-in-loop
    const out = await Round().writeRounds({ now: NOW, enqueue: jest.fn() });
    expect(out.skipped).toBe('off');
    expect(rounds()).toHaveLength(0);
  }
  expect(SQS.queueJob).not.toHaveBeenCalled();
});

test('not a school day (Saturday) -> nothing; the tick outside 16:00-19:59 PKT -> nothing', async () => {
  expect((await Round().writeRounds({ now: new Date('2026-11-28T11:05:00Z') })).skipped).toBe('not_school_day');
  expect((await Round().tick({ now: new Date('2026-11-24T09:59:00Z') })).skipped).toBe('hours'); // 14:59 PKT
  expect((await Round().tick({ now: new Date('2026-11-24T15:00:00Z') })).skipped).toBe('hours'); // 20:00 PKT
  expect(rounds()).toHaveLength(0);
  const at16 = await Round().tick({ now: new Date('2026-11-24T11:00:00Z'), enqueue: jest.fn() });
  expect(at16.queued).toBe(1);
});

test('a teacher\'s recorded subject for the class is respected; no subjects recorded -> any subject of the grade', () => {
  const by = new Map([[T1, [{ grade: 3, subject: 'maths', lessons: [{ lesson_id: 'x', asset_id: 'a', delivered_at: '2026-11-24T03:00:00Z' }] }]]]);
  expect(Round().chooseLesson({ grade: 3, teachers: [{ teacherId: T1, subjects: ['english'] }], by })).toBeNull();
  expect(Round().chooseLesson({ grade: 3, teachers: [{ teacherId: T1, subjects: [] }], by })).toMatchObject({ teacherId: T1, subject: 'maths' });
  expect(Round().chooseLesson({ grade: 4, teachers: [{ teacherId: T1, subjects: [] }], by })).toBeNull();
});

test('max per tick with continuation: the rest wait for the next tick', async () => {
  seed(SWITCHES, {
    class_teacher_subjects: [],
    class_links: [...db.class_links, { code: 'Z9Z9Z9Z9AB', class_id: C3, teacher_id: T1, term_code: '2026-27b', expires_at: '2027-03-31T18:59:59Z', revoked_at: null }],
    class_enrollments: [...db.class_enrollments, { class_id: C3, student_id: 'c0000001-0000-4000-8000-0000000000e8', is_active: true }],
  });
  const first = await Round().writeRounds({ now: NOW, max: 1, enqueue: jest.fn() });
  expect(first).toMatchObject({ queued: 1, more: true });
  const second = await Round().writeRounds({ now: NOW, max: 1, enqueue: jest.fn() });
  expect(second.queued).toBe(1);
  expect(rounds().map((q) => q.meta.class_id).sort()).toEqual([C1, C3].sort());
});

describe('the offers\' export when it is there', () => {
  test('lpTakenToday(teacherId, day) per teacher: both return forms ([] and {nudgeDate, classes})', async () => {
    jest.resetModules();
    const lpTakenToday = jest.fn(async (id) => (id === T1
      ? { nudgeDate: '2026-11-24', classes: [{ key: 'g3_english', grade: 3, subject: 'english', lessons: [{ lesson_id: 'grade_3_english_ch4_seg2', asset_id: 'a1', version_stamp: 'v8', content_hash: 'h', delivered_at: '2026-11-24T02:00:00Z', topic: 'Sentences' }] }] }
      : []));
    jest.doMock('../../shared/services/nudges/lp-quiz-offer.service', () => ({ lpTakenToday }));
    const R = require('../../shared/services/quiz/web-quiz-evening-round');
    const sb = require('../../shared/config/supabase');
    Object.assign(sb, { from: makeFake(db).from });
    const got = await R.lpTakenFor([T1, T2], '2026-11-24');
    expect(got.src).toBe('lp-quiz-offer.service:lpTakenToday');
    expect(lpTakenToday).toHaveBeenCalledWith(T1, '2026-11-24');
    expect(got.by.get(T1)[0].subject).toBe('english');
    expect(got.by.get(T2)).toEqual([]);
    jest.dontMock('../../shared/services/nudges/lp-quiz-offer.service');
  });
  test('lpTakenFor(ids, day) -> Map wins over the per-teacher call', async () => {
    jest.resetModules();
    const lpTakenFor = jest.fn(async () => new Map([[T2, { classes: [] }]]));
    jest.doMock('../../shared/services/nudges/lp-quiz-offer.service', () => ({ lpTakenFor, lpTakenToday: jest.fn() }));
    const R = require('../../shared/services/quiz/web-quiz-evening-round');
    const got = await R.lpTakenFor([T2], '2026-11-24');
    expect(got.src).toBe('lp-quiz-offer.service:lpTakenFor');
    expect(lpTakenFor).toHaveBeenCalledWith([T2], '2026-11-24');
    jest.dontMock('../../shared/services/nudges/lp-quiz-offer.service');
  });
});

test('the fallback read (offers\' export absent) chooses the same lesson', async () => {
  jest.resetModules();
  const R = require('../../shared/services/quiz/web-quiz-evening-round');
  Object.assign(require('../../shared/config/supabase'), { from: makeFake(db).from });
  const own = await R.ownLpTaken([T1, T2], '2026-11-24');
  const viaExport = (await R.lpTakenFor([T1, T2], '2026-11-24')).by;
  const pick = (by) => R.chooseLesson({ grade: 3, teachers: [{ teacherId: T1, subjects: ['english'] }, { teacherId: T2, subjects: ['maths'] }], by });
  expect(pick(own)).toMatchObject({ teacherId: T2, subject: 'math' });
  expect(pick(viaExport)).toMatchObject({ teacherId: T2, subject: 'math' });
});
