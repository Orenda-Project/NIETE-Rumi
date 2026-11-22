'use strict';
/**
 * A round whose generation failed for a passing reason (a model outage, a timeout) is tried again by a later tick of the
 * same evening: the same quizzes row back to 'generating', meta.attempts + 1, re-queued; at most ROUND_ATTEMPTS tries,
 * no sooner than RETRY_AFTER after the failure, never for a permanent reason (no lesson source, the daily cap, ...).
 * Before this, a failed row counted as the class's round for the day: one outage at 16:00 cost every class its round.
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
const failedRound = (over = {}) => ({
  id: 'qr-1', teacher_id: T1, quiz_source: 'lp_v8', status: 'failed', grade: '3', subject: 'english',
  meta: {
    source: 'evening_round', class_id: C1, round_day: '2026-11-24', class_link_code: 'K7Q2MXTRCA', step: 'failed',
    error: 'digest_failed', error_detail: 'digest: 403 Key limit exceeded', failed_at: '2026-11-24T11:05:30Z', ...over,
  },
});
const T = (iso) => new Date(iso);

beforeEach(() => { jest.clearAllMocks(); redis._store.clear(); });

test('a round that failed on a model error is tried again 10+ minutes later, the same row, attempt 2', async () => {
  seed();
  db.quizzes.push(failedRound());
  const enqueue = jest.fn().mockResolvedValue(undefined);
  const out = await Round().writeRounds({ now: T('2026-11-24T11:20:00Z'), enqueue, classIds: [C1] });
  const q = db.quizzes.find((x) => x.id === 'qr-1');
  expect(q.status).toBe('generating');
  expect(q.meta).toMatchObject({ step: 'digest', attempts: 2, retry_of_error: 'digest_failed' });
  expect(q.meta.error).toBeUndefined();
  expect(enqueue).toHaveBeenCalledWith('qr-1');
  expect(out).toMatchObject({ retried: 1 });
  expect(db.quizzes.filter((x) => x.meta && x.meta.source === 'evening_round')).toHaveLength(1);
  expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
});

test('not before the backoff: a round failed 5 minutes ago waits', async () => {
  seed();
  db.quizzes.push(failedRound());
  const enqueue = jest.fn().mockResolvedValue(undefined);
  const out = await Round().writeRounds({ now: T('2026-11-24T11:10:00Z'), enqueue, classIds: [C1] });
  expect(db.quizzes.find((x) => x.id === 'qr-1').status).toBe('failed');
  expect(enqueue).not.toHaveBeenCalled();
  expect(out.retried || 0).toBe(0);
});

test('a permanent reason is never retried (no lesson source)', async () => {
  seed();
  db.quizzes.push(failedRound({ error: 'source_missing' }));
  const enqueue = jest.fn().mockResolvedValue(undefined);
  await Round().writeRounds({ now: T('2026-11-24T11:40:00Z'), enqueue, classIds: [C1] });
  expect(db.quizzes.find((x) => x.id === 'qr-1').status).toBe('failed');
  expect(enqueue).not.toHaveBeenCalled();
});

test('three tries and no more', async () => {
  seed();
  db.quizzes.push(failedRound({ attempts: 3 }));
  const enqueue = jest.fn().mockResolvedValue(undefined);
  await Round().writeRounds({ now: T('2026-11-24T12:40:00Z'), enqueue, classIds: [C1] });
  expect(db.quizzes.find((x) => x.id === 'qr-1').status).toBe('failed');
  expect(enqueue).not.toHaveBeenCalled();
});

test('a retry respects the canary: a class outside it is not retried', async () => {
  seed([...SWITCHES, { key: 'web_quiz_class_link_canary', value: { class_ids: [C2] } }]);
  db.quizzes.push(failedRound());
  const enqueue = jest.fn().mockResolvedValue(undefined);
  await Round().writeRounds({ now: T('2026-11-24T11:20:00Z'), enqueue, classIds: [C1] });
  expect(db.quizzes.find((x) => x.id === 'qr-1').status).toBe('failed');
  expect(enqueue).not.toHaveBeenCalled();
});
