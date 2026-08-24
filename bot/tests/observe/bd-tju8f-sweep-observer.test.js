/**
 * bd-tju8f T3.1 (absorbs bd-m1jih) — the photo-gate sweep, made safe six ways.
 *
 * The 18-19 Aug prod spam incident: every worker replica ran the sweep and each
 * messaged the same session (×10), and staleness keyed off created_at yanked
 * mid-flow sessions. The mute (COACHING_PHOTO_GATE_MINUTES=525600) then
 * silently cost 30-70 teachers/day their reports. Contract under test:
 *
 *   1. single-flight claim — only the replica whose CAS update returns a row
 *      queues + notifies
 *   2. staleness off updated_at (fresh activity is never yanked)
 *   3. notify-once — a session already notified is advanced silently
 *   4. observer identity — a bound leader observation messages the COACH
 *   5. per-tick cap — at most SWEEP_MAX_PER_TICK advanced per call, oldest first
 *   6. age ceiling — rows older than SWEEP_MAX_AGE_DAYS are abandoned SILENTLY
 */

const mockState = { rows: [], users: {}, claims: [], updates: [] };

function mockBuilder(table) {
  const ctx = { table, filters: {}, op: null, payload: null };
  const b = {
    select: (cols) => { ctx.cols = cols; return b; },
    update: (payload) => { ctx.op = 'update'; ctx.payload = payload; return b; },
    eq: (k, v) => { ctx.filters[k] = v; return b; },
    in: (k, v) => { ctx.filters[`in:${k}`] = v; return b; },
    lt: (k, v) => { ctx.filters[`lt:${k}`] = v; return b; },
    order: () => b,
    limit: () => b,
    single: async () => {
      if (ctx.table === 'users') return { data: mockState.users[ctx.filters.id] || null, error: null };
      return { data: null, error: null };
    },
    then: (resolve) => {
      let out;
      if (ctx.op === 'update') {
        mockState.updates.push({ table: ctx.table, payload: ctx.payload, filters: ctx.filters });
        const row = mockState.rows.find((r) => r.id === ctx.filters.id);
        const statusOk = row && (!ctx.filters['in:status'] || ctx.filters['in:status'].includes(row.status));
        if (row && statusOk && !row.claimed) {
          row.claimed = true; row.status = ctx.payload.status;
          mockState.claims.push(row.id);
          out = { data: [row], error: null };
        } else {
          out = { data: [], error: null };   // another replica won the claim
        }
      } else {
        const cut = ctx.filters['lt:updated_at'] || ctx.filters['lt:created_at'];
        out = { data: mockState.rows.filter((r) => !cut || (r.updated_at || r.created_at) < cut), error: null };
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
  queueAnalysis: jest.fn(async (sid, meta) => { mockQueued.push({ sid, meta }); return 'mid'; }),
  queueReport: jest.fn(async () => 'mid'),
}));
jest.mock('../../shared/services/soniox-cleanup.service', () => ({ runSonioxCleanup: jest.fn(async () => ({})) }));

const HOURS = 3600 * 1000;
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

function gateRow(over = {}) {
  return {
    id: over.id || `s-${Math.random().toString(36).slice(2, 8)}`,
    user_id: 'teacher-1', observer_user_id: null, observation_type: null,
    status: 'awaiting_lesson_plan', created_at: iso(3 * HOURS), updated_at: iso(3 * HOURS),
    transcript_text: 'x'.repeat(500), conversation_state: {},
    users: { phone_number: '92-TEACHER', first_name: 'Ayesha' },
    ...over,
  };
}

let processStuckPhotoGateSessions;
beforeAll(() => {
  ({ processStuckPhotoGateSessions } = require('../../workers/stale-session.worker'));
});
beforeEach(() => {
  mockState.rows = []; mockState.users = {}; mockState.claims = []; mockState.updates = [];
  mockSent.length = 0; mockQueued.length = 0;
  jest.clearAllMocks();
});

test('a bound leader observation queues + notifies the COACH, never the teacher', async () => {
  mockState.rows = [gateRow({ id: 'obs-1', observation_type: 'leader_observation', observer_user_id: 'coach-1' })];
  mockState.users['coach-1'] = { phone_number: '92-COACH' };
  await processStuckPhotoGateSessions();
  expect(mockQueued).toHaveLength(1);
  expect(mockQueued[0].meta.from).toBe('92-COACH');
  expect(mockSent.every((s) => s.to === '92-COACH')).toBe(true);
});

test('a teacher-flow row still messages the teacher (behaviour unchanged)', async () => {
  mockState.rows = [gateRow({ id: 't-row' })];
  await processStuckPhotoGateSessions();
  expect(mockQueued[0].meta.from).toBe('92-TEACHER');
  expect(mockSent[0].to).toBe('92-TEACHER');
});

test('single-flight: when the claim update returns no row, nothing is mockQueued or mockSent', async () => {
  mockState.rows = [gateRow({ id: 'c-row', claimed: true })];   // another replica already claimed it
  await processStuckPhotoGateSessions();
  expect(mockQueued).toHaveLength(0);
  expect(mockSent).toHaveLength(0);
});

test('rows older than the age ceiling are abandoned SILENTLY — no queue, no message', async () => {
  mockState.rows = [gateRow({ id: 'old-row', created_at: iso(9 * 24 * HOURS), updated_at: iso(9 * 24 * HOURS) })];
  await processStuckPhotoGateSessions();
  expect(mockQueued).toHaveLength(0);
  expect(mockSent).toHaveLength(0);
  const ab = mockState.updates.find((u) => u.payload && u.payload.status === 'abandoned');
  expect(ab).toBeTruthy();
});

test('per-tick cap: 10 eligible rows advance at most 8, oldest first', async () => {
  mockState.rows = Array.from({ length: 10 }, (_, i) =>
    gateRow({ id: `r-${i}`, created_at: iso((3 + i) * HOURS), updated_at: iso((3 + i) * HOURS) }));
  const res = await processStuckPhotoGateSessions();
  expect(res.advanced).toBeLessThanOrEqual(8);
  expect(mockQueued.length).toBeLessThanOrEqual(8);
  // oldest first = the rows with the LARGEST age advance first
  expect(mockQueued.map((q) => q.sid)).toContain('r-9');
});

test('notify-once: an already-notified session advances without a second message', async () => {
  mockState.rows = [gateRow({ id: 'n-row', conversation_state: { photo_gate_notified: true } })];
  await processStuckPhotoGateSessions();
  expect(mockQueued).toHaveLength(1);
  expect(mockSent).toHaveLength(0);
});

test('a session advanced more than 24h after recording gets the DATED message', async () => {
  mockState.rows = [gateRow({ id: 'd-row', created_at: iso(30 * HOURS), updated_at: iso(30 * HOURS) })];
  await processStuckPhotoGateSessions();
  expect(mockSent).toHaveLength(1);
  expect(mockSent[0].msg).toMatch(/\d/);           // carries the lesson date
});
