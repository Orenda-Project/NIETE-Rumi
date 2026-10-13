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
 * So the worker looks the teacher up once, when a coaching job has no user, and names them before
 * the job runs; what the job queues then carries them on. It never looks up a job that already names
 * a user or that is not keyed by a coaching session, and a failed lookup names nobody and changes
 * nothing else.
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

describe('a coaching job with no user names its session\'s teacher (bd-b0qwk.3)', () => {
  test.each(['transcription', 'analysis', 'lesson_plan_extraction', 'report_generation'])(
    '%s queued by the portal (no user) runs with the session\'s teacher named', async (jobType) => {
      const r = await runJob(job(jobType), { user_id: UID });
      expect(r.ran).toBe(true);
      expect(r.user).toBe(UID);
      expect(r.lookups).toEqual([{ table: 'coaching_sessions', cols: 'user_id', col: 'id', val: 'sess-1' }]);
    });

  test('a job that already names its user is not looked up, and keeps that user', async () => {
    const r = await runJob(job('analysis', { userId: OTHER }), { user_id: UID });
    expect(r.user).toBe(OTHER);
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
