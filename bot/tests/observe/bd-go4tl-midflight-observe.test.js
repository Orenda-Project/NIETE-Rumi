/**
 * bd-go4tl.1 — an observation that dies mid-pipeline must be swept like any
 * other session.
 *
 * Coach Javeria's 28-Aug observation sat at status='transcribing' for nearly
 * three hours with no transcript, no error_message and no sweep that would ever
 * touch it: processStuckMidFlightSessions() excluded leader_observation at the
 * query and the planner skipped it with reason 'observe_owned_by_its_own_sweep'.
 * That sweep does not exist — bd-tju8f is the coach-INITIATED resume service.
 *
 * Contract under test:
 *   1. the planner classifies observations exactly like teacher sessions
 *   2. the sweep query does not exclude them
 *   3. every message and job callback reaches the COACH, never the teacher
 *   4. single-flight — replicas race the claim, exactly one queues (bd-m1jih)
 *   5. an unresolvable coach goes silent rather than messaging the teacher
 */

const {
  classifyStuckMidFlightSession,
  MIDFLIGHT_STUCK_AGE_MS,
} = require('../../shared/services/coaching/coaching-stale-recovery');

const HOURS = 3600 * 1000;
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

function obsRow(over = {}) {
  return {
    id: over.id || 'obs-1',
    user_id: 'teacher-1',
    observer_user_id: 'coach-1',
    observation_type: 'leader_observation',
    status: 'transcribing',
    created_at: iso(3 * HOURS),
    updated_at: iso(3 * HOURS),
    audio_id: 'wa-media-123',
    analysis_data: {},          // planner contract (full row)
    watchdog: null,             // the sweep's projected slice: analysis_data->watchdog
    users: { phone_number: '92-TEACHER', first_name: 'Ayesha', preferred_language: 'en' },
    ...over,
  };
}

// ── 1. the planner ─────────────────────────────────────────────────────────
describe('bd-go4tl.1 planner — observations are classified, not skipped', () => {
  test('an observation dead at transcribing is re-queued to TRANSCRIPTION', () => {
    expect(classifyStuckMidFlightSession(obsRow(), now))
      .toEqual({ action: 'retry', queue: 'transcription', reason: 'requeue_transcription' });
  });

  test('an observation dead at analysis_started is re-queued to ANALYSIS', () => {
    expect(classifyStuckMidFlightSession(obsRow({ status: 'analysis_started' }), now))
      .toMatchObject({ action: 'retry', queue: 'analysis' });
  });

  test('an observation whose one retry is already spent fails, it does not loop', () => {
    const spent = obsRow({ watchdog: { retried_at: iso(1 * HOURS) }, analysis_data: { watchdog: { retried_at: iso(1 * HOURS) } } });
    expect(classifyStuckMidFlightSession(spent, now))
      .toEqual({ action: 'fail', reason: 'retry_already_spent' });
  });

  test('an observation with no audio to transcribe fails rather than looping', () => {
    expect(classifyStuckMidFlightSession(obsRow({ audio_id: null }), now))
      .toEqual({ action: 'fail', reason: 'no_audio_to_transcribe' });
  });

  test('a still-fresh observation is left alone', () => {
    const fresh = obsRow({ updated_at: iso(MIDFLIGHT_STUCK_AGE_MS / 2) });
    expect(classifyStuckMidFlightSession(fresh, now))
      .toEqual({ action: 'skip', reason: 'still_fresh' });
  });

  test('teacher sessions are unchanged (regression guard)', () => {
    const teacher = obsRow({ observation_type: null, observer_user_id: null });
    expect(classifyStuckMidFlightSession(teacher, now))
      .toMatchObject({ action: 'retry', queue: 'transcription' });
  });
});

// ── 2-5. the sweep ─────────────────────────────────────────────────────────
const mockState = { rows: [], users: {}, updates: [] };

function mockBuilder(table) {
  const ctx = { table, filters: {}, op: null, payload: null };
  const b = {
    select: () => b,
    update: (payload) => { ctx.op = 'update'; ctx.payload = payload; return b; },
    eq: (k, v) => { ctx.filters[k] = v; return b; },
    in: (k, v) => { ctx.filters[`in:${k}`] = v; return b; },
    or: (expr) => { ctx.filters.or = expr; return b; },
    lt: (k, v) => { ctx.filters[`lt:${k}`] = v; return b; },
    order: () => b,
    limit: () => b,
    single: async () => ({ data: mockState.users[ctx.filters.id] || null, error: null }),
    maybeSingle: async () => (ctx.table === 'users'
      ? { data: mockState.users[ctx.filters.id] || null, error: null }
      : { data: mockState.rows.find((r) => r.id === ctx.filters.id) || null, error: null }),
    then: (resolve) => {
      let out;
      if (ctx.op === 'update') {
        mockState.updates.push({ table: ctx.table, payload: ctx.payload, filters: ctx.filters });
        const row = mockState.rows.find((r) => r.id === ctx.filters.id);
        // CAS: the claim only lands if updated_at is still what the reader saw.
        const casOk = row && (ctx.filters.updated_at === undefined
          || ctx.filters.updated_at === row.updated_at);
        if (row && casOk) {
          Object.assign(row, ctx.payload);
          out = { data: [row], error: null };
        } else {
          out = { data: [], error: null };   // another replica won
        }
      } else if (ctx.table === 'users') {
        out = { data: mockState.users[ctx.filters.id] || null, error: null };
      } else {
        // the sweep MUST NOT filter observations out
        const excluded = String(ctx.filters.or || '').includes('leader_observation');
        const cut = ctx.filters['lt:updated_at'];
        const rows = mockState.rows.filter((r) => {
          if (excluded && r.observation_type === 'leader_observation') return false;
          return !cut || r.updated_at < cut;
        });
        out = { data: rows, error: null };
      }
      return Promise.resolve(out).then(resolve);
    },
  };
  return b;
}

jest.mock('../../shared/config/supabase', () => ({ from: (t) => mockBuilder(t) }));
const mockSent = [];
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async (to, msg) => { mockSent.push({ to, msg }); return true; }),
}));
const mockQueued = [];
jest.mock('../../shared/services/coaching/coaching-job-queue.service', () => ({
  queueTranscription: jest.fn(async (sid, meta) => { mockQueued.push({ q: 'transcription', sid, meta }); return 'm'; }),
  queueAnalysis: jest.fn(async (sid, meta) => { mockQueued.push({ q: 'analysis', sid, meta }); return 'm'; }),
  queueReport: jest.fn(async (sid, meta) => { mockQueued.push({ q: 'report', sid, meta }); return 'm'; }),
}));
jest.mock('../../shared/services/soniox-cleanup.service', () => ({ runSonioxCleanup: jest.fn(async () => ({})) }));

let processStuckMidFlightSessions;
beforeAll(() => { ({ processStuckMidFlightSessions } = require('../../workers/stale-session.worker')); });
beforeEach(() => {
  mockState.rows = []; mockState.users = {}; mockState.updates = [];
  mockSent.length = 0; mockQueued.length = 0;
});

describe('bd-go4tl.1 sweep — observations are swept, and the COACH is the one told', () => {
  test('a dead observation is found and re-queued to transcription', async () => {
    mockState.rows = [obsRow()];
    mockState.users['coach-1'] = { phone_number: '92-COACH', first_name: 'Javeria', preferred_language: 'ur' };
    const res = await processStuckMidFlightSessions();
    expect(res.retried).toBe(1);
    expect(mockQueued).toHaveLength(1);
    expect(mockQueued[0].q).toBe('transcription');
    expect(mockQueued[0].meta.audioId).toBe('wa-media-123');
  });

  test('the job callback goes to the COACH, never the observed teacher', async () => {
    mockState.rows = [obsRow()];
    mockState.users['coach-1'] = { phone_number: '92-COACH', first_name: 'Javeria', preferred_language: 'ur' };
    await processStuckMidFlightSessions();
    expect(mockQueued[0].meta.from).toBe('92-COACH');
    expect(mockQueued[0].meta.from).not.toBe('92-TEACHER');
  });

  test('a spent retry fails LOUDLY to the coach, in the coach language, and stamps error_message', async () => {
    mockState.rows = [obsRow({ watchdog: { retried_at: iso(1 * HOURS) }, analysis_data: { watchdog: { retried_at: iso(1 * HOURS) } } })];
    mockState.users['coach-1'] = { phone_number: '92-COACH', first_name: 'Javeria', preferred_language: 'ur' };
    const res = await processStuckMidFlightSessions();
    expect(res.failed).toBe(1);
    expect(mockSent).toHaveLength(1);
    expect(mockSent[0].to).toBe('92-COACH');
    const failUpdate = mockState.updates.find((u) => u.payload && u.payload.status === 'failed');
    expect(failUpdate).toBeTruthy();
    expect(String(failUpdate.payload.error_message)).toMatch(/bd-go4tl|watchdog/);
    // the coach reads Urdu — she must not be sent the English string
    expect(mockSent[0].msg).toMatch(/[؀-ۿ]/);
  });

  test('the message never claims an escalation that does not happen', async () => {
    mockState.rows = [obsRow({ watchdog: { retried_at: iso(1 * HOURS) }, analysis_data: { watchdog: { retried_at: iso(1 * HOURS) } } })];
    mockState.users['coach-1'] = { phone_number: '92-COACH', first_name: 'Javeria', preferred_language: 'en' };
    await processStuckMidFlightSessions();
    expect(mockSent[0].msg).not.toMatch(/team has been (told|notified)/i);
  });

  test('single-flight — a replica that loses the CAS neither queues nor messages', async () => {
    const row = obsRow();
    mockState.rows = [row];
    mockState.users['coach-1'] = { phone_number: '92-COACH', first_name: 'Javeria', preferred_language: 'en' };
    await processStuckMidFlightSessions();          // replica A claims
    const afterA = mockQueued.length;
    // replica B read the row BEFORE A's claim, so its CAS must miss
    mockState.rows = [{ ...row, updated_at: row.updated_at }];
    mockState.rows[0].updated_at = 'MOVED-ON';       // the row A already touched
    await processStuckMidFlightSessions();
    expect(mockQueued.length).toBe(afterA);
  });

  test('an unresolvable coach is never re-queued — the job callback would fall back to the teacher', async () => {
    mockState.rows = [obsRow()];            // no users['coach-1']
    const res = await processStuckMidFlightSessions();
    expect(mockQueued).toHaveLength(0);
    expect(res.retried).toBe(0);
    expect(mockSent).toHaveLength(0);
  });

  test('an unresolvable coach goes silent rather than messaging the teacher', async () => {
    mockState.rows = [obsRow({ watchdog: { retried_at: iso(1 * HOURS) }, analysis_data: { watchdog: { retried_at: iso(1 * HOURS) } } })];
    // no users['coach-1'] — the lookup returns null
    await processStuckMidFlightSessions();
    expect(mockSent.map((m) => m.to)).not.toContain('92-TEACHER');
  });
});
