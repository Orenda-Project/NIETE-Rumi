'use strict';
/**
 * bd-b0qwk.3 — a coaching job that arrives with no user still names its teacher.
 *
 * The first change (tests/llm/cost-user-attribution.test.js) names the user where the request knows it:
 * the WhatsApp webhook, and from there every job it queues. A coaching session uploaded through the
 * portal never passes the webhook, and the transcription job the portal queues carries `{ from,
 * audioId }` only, so the chain had no user at all. Seen on sandbox, 13 Oct 06:24Z: in one portal
 * session the lesson-plan job (whose payload carries a userId) named the teacher, while the analysis
 * job's ten photo readings (payload: the session only) named nobody.
 *
 * Every job in that chain is keyed by the coaching session, and the session row has its teacher.
 * So the worker looks the teacher up once and names them before the job runs; what the job queues
 * then carries them on. It never looks up a job that is not keyed by a coaching session, and a failed
 * lookup changes nothing else.
 *
 * bd-oakmee.11.1 (the operator's call, 16 Oct, same rule as the main bot): the session's owner is
 * charged even when the envelope names someone else. A coach who records a teacher's lesson queues it
 * under her own id while the row's user_id is the observed teacher, so the envelope alone split one
 * session between coach and teacher, and a coach has no class to divide it by. The envelope's user
 * stands in only when the row cannot be read. The observe debrief and teacher report jobs are keyed
 * by the coaching session too.
 *
 * Driven through SQSCoachingWorker.processJob with the database mocked at the client boundary; the
 * structured logger (the context under test) is real.
 */
const UID = '2a76b32c-4389-420b-b03f-7aadfba58b31';
const OTHER = 'b81f3e2a-1c4d-4e5f-9a6b-7c8d9e0f1a2b';

function loadWorker(sessionRow) {
  jest.resetModules();
  const lookups = [];
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: (table) => ({
      select: (cols) => ({
        eq: (col, val) => ({
          maybeSingle: async () => {
            lookups.push({ table, cols, col, val });
            if (sessionRow instanceof Error) throw sessionRow;
            if (sessionRow === 'never') return new Promise(() => {});
            return { data: sessionRow, error: null };
          },
        }),
      }),
    }),
    rpc: () => ({}),
  }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));
  jest.doMock('../../bot/shared/services/queue', () => ({
    completeJob: async () => {}, completeVideoJob: async () => {}, completeQuizJob: async () => {},
  }));
  return {
    W: require('../../bot/workers/sqs-worker').SQSCoachingWorker,
    sl: require('../../bot/shared/utils/structured-logger'),
    lookups,
  };
}

async function runJob(body, sessionRow) {
  const { W, sl, lookups } = loadWorker(sessionRow);
  const worker = new W('w-test');
  const seen = { ran: false, user: 'not run' };
  worker.executeJob = async () => { seen.ran = true; seen.user = sl.getCurrentUserId(); };
  worker.handleJobFailure = async () => {};
  await worker.processJob({ receiptHandle: 'rh', body, sourceQueue: 'main', messageId: 'm1' });
  const entry = worker.activeJobs.get('rh');
  if (entry && entry.promise) await entry.promise;
  await new Promise((r) => setImmediate(r));
  return { ...seen, lookups };
}

const job = (jobType, extra = {}) => ({ sessionId: 'sess-1', jobType, payload: { from: '923001234567', audioId: 'a1' }, correlationId: 'c1', ...extra });

const SESSION_JOBS = ['transcription', 'analysis', 'lesson_plan_extraction', 'report_generation',
  'observe_debrief', 'observe_teacher_report'];

describe('a coaching job with no user names its session\'s teacher (bd-b0qwk.3)', () => {
  test.each(SESSION_JOBS)(
    '%s queued by the portal (no user) runs with the session\'s teacher named', async (jobType) => {
      const r = await runJob(job(jobType), { user_id: UID });
      expect(r.ran).toBe(true);
      expect(r.user).toBe(UID);
      expect(r.lookups).toEqual([{ table: 'coaching_sessions', cols: 'user_id', col: 'id', val: 'sess-1' }]);
    });

  test.each(SESSION_JOBS)(
    '%s queued by a coach is charged to the session\'s owner (bd-oakmee.11.1)', async (jobType) => {
      const r = await runJob(job(jobType, { userId: OTHER }), { user_id: UID });
      expect(r.ran).toBe(true);
      expect(r.user).toBe(UID);
      expect(r.lookups).toEqual([{ table: 'coaching_sessions', cols: 'user_id', col: 'id', val: 'sess-1' }]);
    });

  test('a session job whose row cannot be read keeps the user its envelope names, and still runs', async () => {
    const failed = await runJob(job('analysis', { userId: OTHER }), new Error('db down'));
    expect([failed.ran, failed.user]).toEqual([true, OTHER]);
    expect((await runJob(job('analysis', { userId: OTHER }), null)).user).toBe(OTHER);
    expect((await runJob(job('analysis', { userId: OTHER }), { user_id: '923001234567' })).user).toBe(OTHER);
  });

  test('a session job whose row is slower than 2 s keeps its envelope user, and still runs', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    try {
      const pending = runJob(job('analysis', { userId: OTHER }), 'never');
      await jest.advanceTimersByTimeAsync(2000);
      const r = await pending;
      expect([r.ran, r.user]).toEqual([true, OTHER]);
    } finally {
      jest.useRealTimers();
    }
  });

  test('a job not keyed by a coaching session keeps its envelope user and is never looked up', async () => {
    const r = await runJob({ sessionId: 'vid-1', jobType: 'video_generation', payload: {}, correlationId: 'c1', userId: OTHER }, { user_id: UID });
    expect([r.ran, r.user]).toEqual([true, OTHER]);
    expect(r.lookups).toHaveLength(0);
  });

  test('a job that is not keyed by a coaching session is never looked up', async () => {
    const r = await runJob({ groupId: 'g1', jobType: 'quiz_generate', payload: {}, correlationId: 'c1' }, { user_id: UID });
    expect(r.ran).toBe(true);
    expect(r.user).toBeUndefined();
    expect(r.lookups).toHaveLength(0);
  });

  test('a failed lookup names nobody, and the job still runs', async () => {
    const r = await runJob(job('analysis'), new Error('db down'));
    expect(r.ran).toBe(true);
    expect(r.user).toBeUndefined();
  });

  test('a session with no teacher, or a non-uuid one, names nobody', async () => {
    expect((await runJob(job('analysis'), null)).user).toBeUndefined();
    expect((await runJob(job('analysis'), { user_id: '923001234567' })).user).toBeUndefined();
  });
});
