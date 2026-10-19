'use strict';
/**
 * bd-v0toag.10 (b) — the day-3 retest. An hourly sweep on the main worker finds lesson quizzes
 * the class played three days ago and makes a NEW quiz on the same SLOs: same lesson, digest and
 * SLO codes, the old questions passed as "do not reuse", queued through the existing quiz_generate
 * job. Behind app_settings quiz_slo_retest_enabled (default off). In-memory DB; queue/Redis mocked.
 */
const { makeDb } = require('./helpers/memory-db');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({ setNX: jest.fn(async () => true) }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn(async () => ({ ok: true })) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const redis = require('../../bot/shared/services/cache/railway-redis.service');
const queue = require('../../bot/shared/services/queue');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const Flag = require('../../bot/shared/services/quiz/quiz-v21-flag');
const Sweep = require('../../bot/shared/services/quiz/quiz-retest-sweep');

const DAY = 864e5;
const NOW = new Date('2026-10-20T06:00:00Z'); // 11:00 PKT
const ago = (d) => new Date(NOW.getTime() - d * DAY).toISOString();
const META = {
  lessons: [{ lesson_id: 'L1' }], lesson_date: '2026-10-17', digest: { slos: [{ id: 'S1' }] },
  slo_codes: { S1: 'M-02-DV-01' }, slo_code_status: 'one', step: 'sent', question_count: 8, coach_note: 'x',
};
const quiz = (id, over = {}) => ({
  id, teacher_id: 'T1', coaching_session_id: null, quiz_source: 'lp_v8', topic: 'Adding', subject: 'maths',
  grade: '2', language: 'en', status: 'sent', meta: META, created_at: ago(3.5), ...over,
});

function seed({ quizzes = [quiz('Q1')], flag = true, sessions } = {}) {
  mockDb = makeDb({
    app_settings: flag ? [{ key: 'quiz_slo_retest_enabled', value: true }] : [],
    quizzes,
    quiz_sessions: sessions || quizzes.map((q, i) => ({ id: `s${i}`, quiz_id: q.id, status: 'completed' })),
    quiz_questions: [
      { id: 'qq1', quiz_id: 'Q1', sort_order: 1, question_text: 'What is 2 + 3?' },
      { id: 'qq2', quiz_id: 'Q1', sort_order: 2, question_text: 'Which is bigger, 12 or 21?' },
    ],
    users: [{ id: 'T1', phone_number: '923001112223' }],
  });
}
const newQuizzes = () => mockDb.tables.quizzes.filter((q) => q.meta && q.meta.source === 'retest');

beforeEach(() => { jest.clearAllMocks(); Flag._reset(); redis.setNX.mockResolvedValue(true); });

test('switch off (default, no row) → nothing read beyond the switch, nothing made', async () => {
  seed({ flag: false });
  const out = await Sweep.sweep({ now: NOW });
  expect(out).toEqual(expect.objectContaining({ skipped: 'off' }));
  expect(newQuizzes()).toHaveLength(0);
  expect(queue.queueJob).not.toHaveBeenCalled();
});

test('outside 09:00–17:00 PKT → nothing made', async () => {
  seed();
  const out = await Sweep.sweep({ now: new Date('2026-10-20T13:00:00Z') }); // 18:00 PKT
  expect(out).toEqual(expect.objectContaining({ skipped: 'hours' }));
  expect(newQuizzes()).toHaveLength(0);
});

test('a lesson quiz played 3 days ago → a new quiz on the same lesson + SLOs, old questions to avoid, queued', async () => {
  seed();
  const out = await Sweep.sweep({ now: NOW });
  expect(out.made).toBe(1);
  const [r] = newQuizzes();
  expect(r).toEqual(expect.objectContaining({
    teacher_id: 'T1', quiz_source: 'lp_v8', topic: 'Adding', subject: 'maths', grade: '2', language: 'en', status: 'generating',
  }));
  expect(r.meta).toEqual({
    lessons: META.lessons, lesson_date: META.lesson_date, digest: META.digest, slo_codes: META.slo_codes,
    slo_code_status: 'one', step: 'author', remakes: 1, source: 'retest', retest_of: 'Q1',
    retest_avoid: ['What is 2 + 3?', 'Which is bigger, 12 or 21?'],
  });
  expect(mockDb.tables.quizzes.find((q) => q.id === 'Q1').meta.retest_quiz_id).toBe(r.id);
  expect(queue.queueJob).toHaveBeenCalledWith(r.id, 'quiz_generate',
    { quizId: r.id, phone: '923001112223', language: 'en', source: 'retest' }, { delaySeconds: 0 });
  expect(logEvent).toHaveBeenCalledWith('quiz.retest_made', expect.objectContaining({ quizId: r.id, retestOf: 'Q1' }));
});

test('not eligible: too new, too old, no finished child, a retest itself, already retested, not a lesson quiz, unsent', async () => {
  seed({
    quizzes: [
      quiz('young', { created_at: ago(2) }), quiz('old', { created_at: ago(5) }), quiz('unplayed'),
      quiz('isretest', { meta: { ...META, retest_of: 'X' } }), quiz('done', { meta: { ...META, retest_quiz_id: 'Y' } }),
      quiz('video', { quiz_source: 'video' }), quiz('failed', { status: 'failed' }),
    ],
    sessions: [
      ...['young', 'old', 'isretest', 'done', 'video', 'failed'].map((id) => ({ id: `s-${id}`, quiz_id: id, status: 'completed' })),
      { id: 's-u', quiz_id: 'unplayed', status: 'in_progress' },
    ],
  });
  const out = await Sweep.sweep({ now: NOW });
  expect(out.made).toBe(0);
  expect(newQuizzes()).toHaveLength(0);
});

test('another replica holds the lock → skipped, nothing made', async () => {
  seed();
  redis.setNX.mockResolvedValue(false);
  const out = await Sweep.sweep({ now: NOW });
  expect(out.made).toBe(0);
  expect(redis.setNX).toHaveBeenCalledWith('quiz:retest:Q1', expect.anything(), 2 * 86400);
});

test('at most 10 per tick', async () => {
  seed({ quizzes: Array.from({ length: 12 }, (_, i) => quiz(`Q${i + 1}`)) });
  const out = await Sweep.sweep({ now: NOW });
  expect(out.made).toBe(Sweep.MAX_PER_TICK);
  expect(Sweep.MAX_PER_TICK).toBe(10);
});

test('the queue refuses → the new quiz is marked failed, not left generating', async () => {
  seed();
  queue.queueJob.mockRejectedValueOnce(new Error('sqs down'));
  const out = await Sweep.sweep({ now: NOW });
  expect(out.made).toBe(0);
  expect(newQuizzes()[0].status).toBe('failed');
});

test('a tick always logs its summary', async () => {
  seed();
  await Sweep.sweep({ now: NOW });
  expect(logEvent).toHaveBeenCalledWith('quiz.retest_sweep', expect.objectContaining({ made: 1, considered: 1 }));
});
