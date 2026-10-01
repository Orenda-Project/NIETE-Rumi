'use strict';
/**
 * Meta bill cut NC3 (N2-C02 / N1-08) — the lesson-plan outcome rides on Step 2/5.
 *
 * Before (a teacher's own Digital Coach session):
 *   text "✅ Lesson plan linked! I'll compare your teaching against this plan…"
 *   ~3–6 s later, text "🔄 Step 2/5: Analyzing your teaching…"
 * After: ONE text — the outcome line, a blank line, then the Step 2/5 line.
 *
 * The two lines are produced by different processes (the webhook and the SQS
 * analysis job), so the outcome travels in the analysis payload (`lpOutcomeKey`)
 * and ONE Redis claim decides who says it:
 *   - the analysis job claims it and opens Step 2/5 with it, or
 *   - if the job has not started within 30 s, the webhook's fallback timer claims
 *     it and sends the outcome on its own (the teacher is never left silent), and
 *     the job then sends a plain Step 2/5.
 * Coach observations (leader_observation) keep today's immediate ack — that path
 * belongs to another lane.
 *
 * Network edges mocked (supabase, Redis, whatsapp sends, the SQS queue); the
 * handler, the LP processor, the deferral module and the analysis job run for real.
 */
const SID = '3a46f37d-1111-4222-8333-444455556666';
const FROM = '923001234567';

const mockRedis = new Map();
const redisMock = () => ({
  setNX: jest.fn(async (k, v) => { if (mockRedis.has(k)) return false; mockRedis.set(k, v); return true; }),
  delete: jest.fn(async (k) => { mockRedis.delete(k); return true; }),
  get: jest.fn(async (k) => (mockRedis.has(k) ? mockRedis.get(k) : null)),
  set: jest.fn(async (k, v) => { mockRedis.set(k, v); return true; }),
  isAvailable: () => true,
});

function supabaseWith(sessionRow) {
  return {
    from: () => {
      const b = { _cols: '' };
      b.select = (c) => { b._cols = String(c || ''); return b; };
      ['eq', 'order', 'limit', 'not', 'in', 'is', 'neq', 'update', 'or'].forEach((m) => { b[m] = () => b; });
      const settle = () => ({ data: sessionRow, error: null });
      b.single = async () => settle();
      b.maybeSingle = async () => settle();
      b.then = (ok, ko) => Promise.resolve(settle()).then(ok, ko);
      return b;
    },
  };
}

function loadHandler({ observationType = null } = {}) {
  jest.resetModules();
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => redisMock());
  jest.doMock('../../bot/shared/config/supabase', () => supabaseWith({
    id: SID, observation_type: observationType, users: { preferred_language: 'en' }, status: 'awaiting_lesson_plan',
  }));
  const { handleLpListSelection } = require('../../bot/shared/services/coaching/lp-coaching/lp-list-selection.handler');
  const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');
  const sent = [];
  const queued = [];
  const deps = {
    linker: { handleLPSelection: async () => ({ lesson_plan_link_method: 'selected_recent', awaiting_upload: false }) },
    sendMessage: async (to, text) => { sent.push(text); return true; },
    queueAnalysis: async (sessionId, payload) => { queued.push({ sessionId, payload }); },
    resolveLanguage: async () => 'en',
    sessionStatus: async () => 'awaiting_lesson_plan',
    confirmed: true,
  };
  return { handleLpListSelection, getCoachingMessage, sent, queued, deps };
}

describe('NC3 — the webhook defers the LP outcome onto Step 2/5 (teacher DC session)', () => {
  beforeEach(() => { mockRedis.clear(); jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }); });
  afterEach(() => jest.useRealTimers());

  test('lp_select_ (linked) → no text now; the analysis payload carries the outcome', async () => {
    const h = loadHandler();
    await h.handleLpListSelection(`lp_select_abcd-123_${SID}`, FROM, h.deps);
    expect(h.sent).toEqual([]);
    expect(h.queued).toEqual([{ sessionId: SID, payload: { from: FROM, lpOutcomeKey: 'lessonPlan_linked' } }]);
  });

  test('lp_none_ → no text now; the analysis payload carries the "no problem" outcome', async () => {
    const h = loadHandler();
    h.deps.linker.handleLPSelection = async () => ({ lesson_plan_link_method: 'none', awaiting_upload: false });
    await h.handleLpListSelection(`lp_none_${SID}`, FROM, h.deps);
    expect(h.sent).toEqual([]);
    expect(h.queued[0].payload).toEqual({ from: FROM, lpOutcomeKey: 'lessonPlan_skip' });
  });

  test('FALLBACK — the job has not started 30 s later: the outcome goes out on its own, once', async () => {
    const h = loadHandler();
    await h.handleLpListSelection(`lp_select_abcd-123_${SID}`, FROM, h.deps);
    jest.advanceTimersByTime(29000);
    await Promise.resolve();
    expect(h.sent).toEqual([]);
    jest.advanceTimersByTime(1500);
    for (let i = 0; i < 5; i += 1) await Promise.resolve(); // eslint-disable-line no-await-in-loop
    expect(h.sent).toEqual([h.getCoachingMessage('lessonPlan_linked', 'en')]);
  });

  test('CONTROL — a coach observation keeps the immediate ack and no payload key', async () => {
    const h = loadHandler({ observationType: 'leader_observation' });
    await h.handleLpListSelection(`lp_select_abcd-123_${SID}`, FROM, h.deps);
    expect(h.sent).toEqual([h.getCoachingMessage('lessonPlan_linked', 'en')]);
    expect(h.queued[0].payload).toEqual({ from: FROM });
  });
});

describe('NC3 — the LP processor (buttons "No", uploaded document) defers too', () => {
  function loadProcessor({ observationType = null } = {}) {
    jest.resetModules();
    const sent = [];
    const queued = [];
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => redisMock());
    jest.doMock('../../bot/shared/config/supabase', () => supabaseWith({
      id: SID, user_id: 'u-1', observation_type: observationType, status: 'awaiting_lesson_plan',
      users: { preferred_language: 'en' },
    }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async (to, text) => { sent.push(text); return true; }),
      downloadMedia: jest.fn(async () => Buffer.from('%PDF-1.4')),
    }));
    jest.doMock('../../bot/shared/storage/r2', () => ({
      uploadLessonPlanBuffer: jest.fn(async () => 'lp/key.pdf'),
      buildR2PublicUrl: jest.fn(() => 'https://r2.example/lp/key.pdf'),
    }));
    jest.doMock('../../bot/shared/services/coaching/coaching-session.service', () => ({
      getSession: jest.fn(async () => ({ id: SID, user_id: 'u-1' })),
    }));
    jest.doMock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
      queueAnalysis: jest.fn(async (sessionId, payload) => { queued.push({ job: 'analysis', payload }); }),
      queueLessonPlanExtraction: jest.fn(async () => 'm'),
    }));
    const LP = require('../../bot/shared/services/coaching/lesson-plan-processor.service');
    const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');
    return { LP, getCoachingMessage, sent, queued };
  }

  beforeEach(() => { mockRedis.clear(); jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }); });
  afterEach(() => jest.useRealTimers());

  test('"No" button → no text now; analysis carries lessonPlan_skip', async () => {
    const p = loadProcessor();
    await p.LP.handleLessonPlanResponse(SID, FROM, false);
    expect(p.sent).toEqual([]);
    expect(p.queued).toEqual([{ job: 'analysis', payload: { from: FROM, lpOutcomeKey: 'lessonPlan_skip' } }]);
  });

  test('uploaded document → no "received" text now; analysis carries lessonPlan_received', async () => {
    const p = loadProcessor();
    await p.LP.handleLessonPlanResponse(SID, FROM, true, 'doc-1');
    expect(p.sent).toEqual([]);
    expect(p.queued).toEqual([{ job: 'analysis', payload: { from: FROM, lpUploaded: true, lpOutcomeKey: 'lessonPlan_received' } }]);
  });

  test('CONTROL — a coach observation still hears "received" at once', async () => {
    const p = loadProcessor({ observationType: 'leader_observation' });
    await p.LP.handleLessonPlanResponse(SID, FROM, true, 'doc-1');
    expect(p.sent).toEqual([p.getCoachingMessage('lessonPlan_received', 'en')]);
    expect(p.queued[0].payload).toEqual({ from: FROM, lpUploaded: true });
  });
});

describe('NC3 — the analysis job opens Step 2/5 with the outcome (one text)', () => {
  function loadAnalysis() {
    jest.resetModules();
    const sent = [];
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => redisMock());
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async (to, text) => { sent.push(text); return true; }),
      sendSticker: jest.fn(async () => true),
    }));
    jest.doMock('../../bot/shared/services/coaching/coaching-session.service', () => ({
      updateStatus: jest.fn(async () => ({})), markAsFailed: jest.fn(async () => ({})),
    }));
    // Stops the job right after Step 2/5 — all this needs.
    jest.doMock('../../bot/shared/services/coaching/report-generator.service', () => ({
      fetchAndCompressPriorFeedback: jest.fn(() => Promise.reject(new Error('stop here'))),
    }));
    jest.doMock('../../bot/shared/config/supabase', () => supabaseWith({
      id: SID, user_id: 'u-1', status: 'awaiting_lesson_plan', users: { phone_number: FROM, name: 'T', preferred_language: 'ur' },
    }));
    const AP = require('../../bot/shared/services/coaching/analysis-processor.service');
    const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');
    return { AP, getCoachingMessage, sent };
  }

  beforeEach(() => mockRedis.clear());

  test.each(['lessonPlan_linked', 'lessonPlan_skip', 'lessonPlan_received'])('%s + Step 2/5 → ONE text, outcome first (Urdu teacher)', async (key) => {
    const a = loadAnalysis();
    await a.AP.processAnalysis(SID, { from: FROM, lpOutcomeKey: key }).catch(() => {});
    const step2 = a.getCoachingMessage('step2_analyzing', 'ur');
    const outcome = a.getCoachingMessage(key, 'ur');
    expect(a.sent).toContain(`${outcome}\n\n${step2}`);
    expect(a.sent).not.toContain(step2);
    expect(a.sent).not.toContain(outcome);
  });

  test('the fallback already said it → a plain Step 2/5, never the outcome twice', async () => {
    const a = loadAnalysis();
    mockRedis.set(`coaching:lp_outcome_ack:${SID}`, 'fallback');
    await a.AP.processAnalysis(SID, { from: FROM, lpOutcomeKey: 'lessonPlan_linked' }).catch(() => {});
    expect(a.sent).toContain(a.getCoachingMessage('step2_analyzing', 'ur'));
    expect(a.sent.join('\n')).not.toContain(a.getCoachingMessage('lessonPlan_linked', 'ur'));
  });

  test('an unknown key in the payload is ignored (plain Step 2/5)', async () => {
    const a = loadAnalysis();
    await a.AP.processAnalysis(SID, { from: FROM, lpOutcomeKey: 'reportReady' }).catch(() => {});
    expect(a.sent).toContain(a.getCoachingMessage('step2_analyzing', 'ur'));
  });

  test('CONTROL — no key → plain Step 2/5 exactly as before', async () => {
    const a = loadAnalysis();
    await a.AP.processAnalysis(SID, { from: FROM }).catch(() => {});
    expect(a.sent).toContain(a.getCoachingMessage('step2_analyzing', 'ur'));
  });
});
