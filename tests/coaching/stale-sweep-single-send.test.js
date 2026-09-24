'use strict';
/**
 * The stale-session sweep messages a teacher ONCE, however many worker copies run it.
 *
 * The sweep (`runRecovery`) is driven by a setInterval in bot/workers/sqs-worker.js,
 * and that file runs as several copies at once (one per worker replica, plus the
 * video worker). The copies start within seconds of each other after a deploy, so
 * their 15-minute ticks line up. Each copy read "sessions not yet reminded", sent the
 * reminder, and only THEN wrote `reminder_sent_at` — so every copy that read before
 * the first write sent its own copy. Production, one week: 2,886 "incomplete coaching
 * session" reminders for 340 sessions, a median of 10 identical messages per teacher.
 * The 12-hour auto-complete notice and the confirmation-gate notice have the same
 * shape (no guard on the status they move away from).
 *
 * These tests run two sweeps concurrently against one in-memory database — both read
 * before either writes, exactly as two replicas do — and count what reaches WhatsApp.
 * Only the network boundary is mocked: the Supabase client (an in-memory fake that
 * applies the filters), WhatsApp, and the queue.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

const mockDb = { current: null };
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (t) => mockDb.current.from(t),
}));

const mockSends = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendInteractiveButtons: jest.fn(async (to, options) => { mockSends.push({ kind: 'buttons', to, options }); return true; }),
  sendMessage: jest.fn(async (to, text) => { mockSends.push({ kind: 'text', to, text }); return true; }),
}));

const mockQueued = [];
jest.mock('../../bot/shared/services/queue', () => ({
  queueCoachingJob: jest.fn(async (sessionId, jobType) => { mockQueued.push({ sessionId, jobType }); return 'msg-1'; }),
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Stale = require('../../bot/workers/stale-session.worker');

const HOUR = 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

const TEACHER = { name: 'Test Teacher', phone_number: '000000000001' };

function reflectionSession(id, idleMs, extra = {}) {
  return {
    id,
    user_id: `user-${id}`,
    status: 'conducting_conversation',
    conversation_state: { last_interaction: ago(idleMs), questions_answered: 0 },
    transcript_text: null,
    analysis_data: {},
    lesson_plan_text: null,
    reminder_sent_at: null,
    created_at: ago(idleMs + HOUR),
    users: TEACHER,
    ...extra,
  };
}

beforeEach(() => {
  mockSends.length = 0;
  mockQueued.length = 0;
  jest.clearAllMocks();
});

describe('two sweeps at the same moment (two worker copies)', () => {
  it('send the 2-hour "incomplete coaching session" reminder ONCE, not once per copy', async () => {
    mockDb.current = createFakeSupabase({ coaching_sessions: [reflectionSession('s-remind', 3 * HOUR)] });

    await Promise.all([Stale.processStaleCoachingSessions(), Stale.processStaleCoachingSessions()]);

    const reminders = mockSends.filter((s) => s.kind === 'buttons');
    expect(reminders).toHaveLength(1);
    expect(mockDb.current._tables.coaching_sessions[0].reminder_sent_at).toBeTruthy();
  });

  it('auto-complete at 12 hours: ONE notice and ONE report job, not one per copy', async () => {
    mockDb.current = createFakeSupabase({ coaching_sessions: [reflectionSession('s-auto', 13 * HOUR)] });

    await Promise.all([Stale.processStaleCoachingSessions(), Stale.processStaleCoachingSessions()]);

    expect(mockSends.filter((s) => s.kind === 'text')).toHaveLength(1);
    expect(mockQueued.filter((q) => q.jobType === 'report_generation')).toHaveLength(1);
    expect(mockDb.current._tables.coaching_sessions[0].status).toBe('generating_report');
  });

  it('confirmation gate: ONE "started analysing" notice and ONE transcription job', async () => {
    mockDb.current = createFakeSupabase({
      coaching_sessions: [{
        id: 's-gate', user_id: 'user-gate', status: 'initiated', audio_id: 'audio-1',
        created_at: ago(2 * HOUR), users: TEACHER,
      }],
    });

    await Promise.all([Stale.processStuckInitiatedSessions(), Stale.processStuckInitiatedSessions()]);

    expect(mockSends.filter((s) => s.kind === 'text')).toHaveLength(1);
    expect(mockQueued.filter((q) => q.jobType === 'transcription')).toHaveLength(1);
    expect(mockDb.current._tables.coaching_sessions[0].status).toBe('confirmed');
  });
});

describe('one copy on its own still does the job', () => {
  it('reminds an idle teacher, and the next tick does not remind again', async () => {
    mockDb.current = createFakeSupabase({ coaching_sessions: [reflectionSession('s-one', 3 * HOUR)] });

    await Stale.processStaleCoachingSessions();
    await Stale.processStaleCoachingSessions();

    expect(mockSends.filter((s) => s.kind === 'buttons')).toHaveLength(1);
  });

  it('a reminder WhatsApp refused is released, so the next tick tries again', async () => {
    mockDb.current = createFakeSupabase({ coaching_sessions: [reflectionSession('s-refused', 3 * HOUR)] });
    WhatsAppService.sendInteractiveButtons.mockImplementationOnce(async () => false);

    await Stale.processStaleCoachingSessions();
    expect(mockDb.current._tables.coaching_sessions[0].reminder_sent_at).toBeNull();

    await Stale.processStaleCoachingSessions();
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(2);
    expect(mockDb.current._tables.coaching_sessions[0].reminder_sent_at).toBeTruthy();
  });

  it('a session a teacher already moved on from is left alone (status changed under the sweep)', async () => {
    mockDb.current = createFakeSupabase({ coaching_sessions: [reflectionSession('s-moved', 13 * HOUR)] });
    // The teacher's own "Get report now" tap finished the session between the sweep's
    // read and its write.
    const realFrom = mockDb.current.from;
    let reads = 0;
    mockDb.current.from = (t) => {
      const b = realFrom(t);
      if (t === 'coaching_sessions' && reads++ === 0) {
        const then = b.then.bind(b);
        b.then = (ok, bad) => then((res) => {
          mockDb.current._tables.coaching_sessions[0].status = 'completed';
          return ok(res);
        }, bad);
      }
      return b;
    };

    await Stale.processStaleCoachingSessions();

    expect(mockSends).toHaveLength(0);
    expect(mockQueued).toHaveLength(0);
  });
});
