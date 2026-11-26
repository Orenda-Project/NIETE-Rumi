/**
 * bd-0h9ira — the mid-flight watchdog must actually find stuck sessions.
 *
 * 25 Nov 2026: coach Hafiza Iqra's observation (96d75e26…) failed analysis on the
 * OpenRouter key-limit outage. Her "run it again" tap at 05:49Z set the row to
 * analysis_started, but the Redis idempotency key from the dead job swallowed the
 * enqueue, so nothing ran. The watchdog (bd-h9gnk) exists for exactly this: no touch
 * for 45 min -> one retry. It never came. Since bd-60092 (14 Sep) its query has
 * selected `coaching_sessions.name`, a column that does not exist; PostgREST answers
 * 42703, the error was never read, and every sweep since has reported midFlight.total 0
 * (last real watchdog action in niete-logs: 11 Sep). The go4tl suite missed it because
 * its fake answered any column.
 *
 * Contract under test:
 *   1. the sweep's select names only real columns (PostgREST-faithful fake: 42703 otherwise)
 *   2. a stuck observation is found and re-queued, to the coach
 *   3. a failed sweep query is reported (queryFailed) and logged at error level, never a silent 0
 *   4. rows older than the age ceiling are not swept at all: turning the watchdog back on
 *      must not re-run (and message teachers about) sessions stuck since September
 */

const { COLUMNS } = require('../quiz/web-quiz/strict-columns');

const HOURS = 3600 * 1000;
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

// PostgREST select grammar, the parts this sweep uses: `a, alias:col->key, rel!inner(x, y)`.
function splitTop(sel) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of String(sel)) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function unknownColumn(table, sel) {
  for (const item of splitTop(sel)) {
    const embed = /^(\w+)(?:!\w+)?\((.*)\)$/.exec(item);
    if (embed) {
      const bad = unknownColumn(embed[1], embed[2]);
      if (bad) return bad;
      continue;
    }
    const col = item.replace(/^\w+:/, '').split('->')[0].trim();
    if (col !== '*' && !COLUMNS[table].has(col)) return `${table}.${col}`;
  }
  return null;
}

const mockState = { rows: [], users: {}, updates: [], selects: [], filters: [] };

function mockBuilder(table) {
  const ctx = { table, filters: {}, op: null, payload: null, sel: null };
  const b = {
    select: (s) => { if (ctx.op !== 'update') ctx.sel = s; mockState.selects.push({ table, sel: s }); return b; },
    update: (payload) => { ctx.op = 'update'; ctx.payload = payload; return b; },
    eq: (k, v) => { ctx.filters[k] = v; return b; },
    in: (k, v) => { ctx.filters[`in:${k}`] = v; return b; },
    lt: (k, v) => { ctx.filters[`lt:${k}`] = v; return b; },
    gt: (k, v) => { ctx.filters[`gt:${k}`] = v; return b; },
    gte: (k, v) => { ctx.filters[`gt:${k}`] = v; return b; },
    order: () => b,
    limit: () => b,
    maybeSingle: async () => (ctx.table === 'users'
      ? { data: mockState.users[ctx.filters.id] || null, error: null }
      : { data: mockState.rows.find((r) => r.id === ctx.filters.id) || null, error: null }),
    then: (resolve) => {
      let out;
      const bad = ctx.sel && ctx.op !== 'update' ? unknownColumn(ctx.table, ctx.sel) : null;
      if (bad) {
        out = { data: null, error: { code: '42703', message: `column ${bad} does not exist` } };
      } else if (ctx.op === 'update') {
        mockState.updates.push({ table: ctx.table, payload: ctx.payload, filters: ctx.filters });
        const row = mockState.rows.find((r) => r.id === ctx.filters.id);
        const casOk = row && (ctx.filters.updated_at === undefined || ctx.filters.updated_at === row.updated_at);
        if (row && casOk) { Object.assign(row, ctx.payload); out = { data: [row], error: null }; } else out = { data: [], error: null };
      } else {
        mockState.filters.push(ctx.filters);
        const lt = ctx.filters['lt:updated_at'];
        const gt = ctx.filters['gt:updated_at'];
        const statuses = ctx.filters['in:status'];
        out = {
          data: mockState.rows.filter((r) => (!statuses || statuses.includes(r.status))
            && (!lt || r.updated_at < lt) && (!gt || r.updated_at > gt)),
          error: null,
        };
      }
      return Promise.resolve(out).then(resolve);
    },
  };
  return b;
}

jest.mock('../../shared/config/supabase', () => ({ from: (t) => mockBuilder(t) }));
const mockLogs = [];
jest.mock('../../shared/utils/logger', () => ({
  logToFile: jest.fn((msg, data, level) => { mockLogs.push({ msg, data, level }); }),
  logError: jest.fn((msg, data) => { mockLogs.push({ msg, data, level: 'error' }); }),
}));
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

function hafizaRow(over = {}) {
  return {
    id: '96d75e26-obs',
    user_id: 'teacher-shazia',
    observer_user_id: 'coach-hafiza',
    observation_type: 'leader_observation',
    status: 'analysis_started',
    created_at: iso(2 * HOURS),
    updated_at: iso(1 * HOURS),
    audio_id: 'wa-media-1',
    audio_url: null,
    watchdog: null,
    users: { name: 'Shazia Faisal', phone_number: '92-TEACHER', preferred_language: 'ur' },
    ...over,
  };
}

let processStuckMidFlightSessions;
let MIDFLIGHT_MAX_AGE_MS;
beforeAll(() => {
  ({ processStuckMidFlightSessions } = require('../../workers/stale-session.worker'));
  ({ MIDFLIGHT_MAX_AGE_MS } = require('../../shared/services/coaching/coaching-stale-recovery'));
});
beforeEach(() => {
  Object.assign(mockState, { rows: [], users: {}, updates: [], selects: [], filters: [] });
  mockSent.length = 0; mockQueued.length = 0; mockLogs.length = 0;
  mockState.users['coach-hafiza'] = { phone_number: '92-COACH', preferred_language: 'ur', name: 'Hafiza Iqra' };
});

describe('bd-0h9ira — the mid-flight watchdog query works against the real schema', () => {
  test('the sweep select names only columns coaching_sessions and users really have', async () => {
    await processStuckMidFlightSessions();
    const sweep = mockState.selects.find((s) => s.table === 'coaching_sessions' && /watchdog/.test(s.sel));
    expect(sweep).toBeTruthy();
    expect(unknownColumn('coaching_sessions', sweep.sel)).toBeNull();
  });

  test('an observation stuck at analysis_started is found and re-queued to analysis, to the coach', async () => {
    mockState.rows = [hafizaRow()];
    const res = await processStuckMidFlightSessions();
    expect(res.total).toBe(1);
    expect(res.retried).toBe(1);
    expect(mockQueued).toEqual([expect.objectContaining({ q: 'analysis', sid: '96d75e26-obs' })]);
    expect(mockQueued[0].meta.from).toBe('92-COACH');
  });

  test('a failed sweep query is reported and logged as an error, not a silent zero', async () => {
    const supabase = require('../../shared/config/supabase');
    const real = supabase.from;
    supabase.from = (t) => {
      const b = mockBuilder(t);
      if (t !== 'coaching_sessions') return b;
      b.then = (resolve) => Promise.resolve({ data: null, error: { code: '42703', message: 'column coaching_sessions.x does not exist' } }).then(resolve);
      return b;
    };
    try {
      const res = await processStuckMidFlightSessions();
      expect(res.queryFailed).toBe(true);
      expect(mockLogs.some((l) => l.level === 'error' && /watchdog/i.test(l.msg))).toBe(true);
    } finally {
      supabase.from = real;
    }
  });

  test('rows stuck longer than the age ceiling are left alone: no re-queue, no message', async () => {
    expect(MIDFLIGHT_MAX_AGE_MS).toBeGreaterThanOrEqual(12 * HOURS);
    mockState.rows = [
      hafizaRow({ id: 'sept-teacher', observation_type: null, observer_user_id: null, status: 'generating_report',
        created_at: iso(70 * 24 * HOURS), updated_at: iso(70 * 24 * HOURS) }),
      hafizaRow({ id: 'just-past-ceiling', updated_at: iso(MIDFLIGHT_MAX_AGE_MS + HOURS) }),
    ];
    const res = await processStuckMidFlightSessions();
    expect(res.total).toBe(0);
    expect(mockQueued).toHaveLength(0);
    expect(mockSent).toHaveLength(0);
    expect(mockState.updates).toHaveLength(0);
  });
});
