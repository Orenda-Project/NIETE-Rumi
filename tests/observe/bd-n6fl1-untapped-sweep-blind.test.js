/**
 * bd-n6fl1 — the untapped-report sweep must SEE the reports it exists to chase.
 *
 * The sweep read `.limit(500)` with no `.order()` from a pool of 1,518 rows that
 * grows ~500 a week. An unordered limit returns whichever rows the planner hands
 * back, so once the pool crossed 500 (around 25-26 Aug) the actionable rows fell
 * outside the slice and stayed there. Measured on NIETE prod 2026-09-08:
 * 31 of 31 overdue reports invisible, 0 visible. Every one of them sat at heap
 * rank >= 505. No teacher was nudged, no coach was told, and the sweep logged
 * "done" either way — it only mockLogs when candidates > 0.
 *
 * This suite drives the REAL query through a fake PostgREST that returns rows in
 * heap order when nothing asks for an order, applies the filters it is given, and
 * caps every response at 1,000 rows the way the live server does. The actionable
 * rows are seeded past rank 500, exactly where prod's are.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-08T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

// ── a fake PostgREST over one table ────────────────────────────────────────
// Understands the operators this query uses, including JSON-path columns, and
// reproduces the two behaviours the bug lived in: heap order when no order is
// asked for, and a hard 1,000-row response cap.
const mockPOOL = [];
const mockQueries = [];

/** `analysis_data->teacher_delivery->>status` → row.analysis_data.teacher_delivery.status */
function mockReadPath(row, col) {
  const parts = String(col).split(/->>|->/).map((p) => p.trim().replace(/^'|'$/g, ''));
  let v = row;
  for (const p of parts) {
    if (v === null || v === undefined) return null;
    v = v[p];
  }
  return v === undefined ? null : v;
}

function mockFakeTable(name) {
  const q = { table: name, filters: [], order: [], limit: null, range: null, select: null };
  mockQueries.push(q);
  const api = {
    select(cols) { q.select = cols; return api; },
    eq(col, val) { q.filters.push((r) => String(mockReadPath(r, col)) === String(val)); q[`eq:${col}`] = val; return api; },
    not(col, op, val) {
      if (op === 'is' && val === null) q.filters.push((r) => mockReadPath(r, col) !== null && mockReadPath(r, col) !== undefined);
      return api;
    },
    is(col, val) {
      if (val === null) q.filters.push((r) => mockReadPath(r, col) === null || mockReadPath(r, col) === undefined);
      return api;
    },
    gte(col, val) { q.filters.push((r) => String(mockReadPath(r, col)) >= String(val)); return api; },
    lt(col, val) { q.filters.push((r) => String(mockReadPath(r, col)) < String(val)); return api; },
    order(col, o = {}) { q.order.push({ col, ascending: o.ascending !== false }); return api; },
    limit(n) { q.limit = n; return api; },
    range(a, b) { q.range = [a, b]; return api; },
    update() { return api; },
    single: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then(res, rej) { return Promise.resolve(resolve()).then(res, rej); },
  };
  function resolve() {
    let rows = mockPOOL.filter((r) => q.filters.every((f) => f(r)));
    for (const o of [...q.order].reverse()) {
      rows = [...rows].sort((a, b) => {
        const x = mockReadPath(a, o.col); const y = mockReadPath(b, o.col);
        if (x === y) return 0;
        const cmp = (x === null ? '' : String(x)) > (y === null ? '' : String(y)) ? 1 : -1;
        return o.ascending ? cmp : -cmp;
      });
    }
    // No order asked for → heap order, which is the seed order here.
    if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
    if (q.limit !== null) rows = rows.slice(0, q.limit);
    if (rows.length > 1000) rows = rows.slice(0, 1000);   // PostgREST's own cap
    const projected = rows.map((r) => ({
      id: r.id,
      teacher_delivery: r.analysis_data.teacher_delivery,
    }));
    return { data: projected, error: null };
  }
  return api;
}

jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockFakeTable(t) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => true) }));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueAnalysis: jest.fn(async () => 'm'), queueReport: jest.fn(async () => 'm'),
}), { virtual: true });
jest.mock('../../bot/shared/services/soniox-cleanup.service', () => ({ runSonioxCleanup: jest.fn(async () => ({})) }), { virtual: true });

const mockProcessed = [];
jest.mock('../../bot/shared/services/observe/observe-send.service', () => ({
  // The real one writes nudged_at, which is what takes the row OUT of the
  // candidate set. The fake does the same, so "the backlog drains" is a thing
  // this suite can actually observe across ticks rather than assume.
  processUntappedDelivery: jest.fn(async (id) => {
    mockProcessed.push(id);
    const row = mockPOOL.find((r) => r.id === id);
    if (row) row.analysis_data.teacher_delivery.nudged_at = new Date().toISOString();
    return { action: 'nudge', reason: 'no_tap_after_grace' };
  }),
}), { virtual: true });

const mockLogs = [];
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLogs.push(a) }));

// Single-flight. Six replicas run this same interval; without a lock they all
// sweep the same rows in the same minute (bd-m1jih shipped x10 duplicate sends
// that way). The lock is the boundary, so the test owns it.
const mockLock = { granted: true, acquired: [], released: [] };
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  acquireLock: jest.fn(async (r) => { mockLock.acquired.push(r); return mockLock.granted; }),
  releaseLock: jest.fn(async (r) => { mockLock.released.push(r); return true; }),
}), { virtual: true });

const { processUntappedReports } = require('../../bot/workers/stale-session.worker');

/** A row that is NOT actionable — the report already went straight through. */
const settled = (n) => ({
  id: `settled-${n}`,
  observation_type: 'leader_observation',
  created_at: iso(NOW - (60 - (n % 60)) * DAY),
  analysis_data: { teacher_delivery: { status: 'sent', sent_at: iso(NOW - 30 * DAY) } },
});

/** A report the teacher never tapped, overdue for its one nudge. */
const overdue = (n, daysAgo) => ({
  id: `overdue-${n}`,
  observation_type: 'leader_observation',
  created_at: iso(NOW - daysAgo * DAY),
  analysis_data: {
    teacher_delivery: {
      status: 'awaiting_teacher_tap',
      teacher_name: `Teacher ${n}`,
      template_sent_at: iso(NOW - daysAgo * DAY),
    },
  },
});

beforeEach(() => {
  mockPOOL.length = 0; mockQueries.length = 0; mockProcessed.length = 0; mockLogs.length = 0;
  mockLock.granted = true; mockLock.acquired.length = 0; mockLock.released.length = 0;
  delete process.env.OBSERVE_UNTAPPED_SWEEP_OFF;
  delete process.env.OBSERVE_UNTAPPED_MAX_PER_TICK;
  // 1,457 settled rows, then the 31 overdue ones — the live heap shape, where
  // every overdue report sits past rank 500.
  for (let i = 0; i < 1457; i += 1) mockPOOL.push(settled(i));
  for (let i = 0; i < 31; i += 1) mockPOOL.push(overdue(i, 2 + (i % 3)));
});

describe('the untapped sweep sees the whole pool, oldest first', () => {
  it('the fixture is the live shape — every overdue report sits past rank 500', () => {
    expect(mockPOOL).toHaveLength(1488);
    const firstOverdue = mockPOOL.findIndex((r) => r.id.startsWith('overdue-'));
    expect(firstOverdue).toBeGreaterThan(500);
  });

  it('finds the overdue reports even though they sit past the first 500 heap rows', async () => {
    const out = await processUntappedReports();
    expect(out.found).toBe(31);            // prod measured 31 overdue, 0 of them visible
    expect(mockProcessed.length).toBeGreaterThan(0);
  });

  it('the backlog drains across ticks and every report is eventually chased', async () => {
    const first = await processUntappedReports();
    expect(first.nudged).toBe(25);         // the per-tick cap, oldest first
    expect(first.remaining).toBe(6);
    const second = await processUntappedReports();
    expect(second.nudged).toBe(6);         // …and the rest on the next tick
    expect(second.remaining).toBe(0);
    expect(new Set(mockProcessed).size).toBe(31);
    const third = await processUntappedReports();
    expect(third.found).toBe(0);           // notify-once: nobody is chased twice
  });

  it('asks the database for an ORDER — an unordered limit is whatever the planner hands back', async () => {
    await processUntappedReports();
    const read = mockQueries.find((q) => q.table === 'coaching_sessions' && q.select);
    expect(read.order.length).toBeGreaterThan(0);
  });

  it('still selects ONLY the teacher_delivery slice — the fat pull that wedged prod stays gone', async () => {
    await processUntappedReports();
    const read = mockQueries.find((q) => q.table === 'coaching_sessions' && q.select);
    expect(read.select).toMatch(/analysis_data->teacher_delivery/);
    expect(read.select).not.toMatch(/analysis_data\s*(,|$)/);
  });

  it('logs a per-tick line even when it found nothing — silence is how six blind days went unnoticed', async () => {
    mockPOOL.length = 0;
    for (let i = 0; i < 10; i += 1) mockPOOL.push(settled(i));
    await processUntappedReports();
    const line = mockLogs.find((l) => /untapped sweep/.test(String(l[0])));
    expect(line).toBeTruthy();
    expect(line[1]).toHaveProperty('found', 0);
  });
});


describe('the sweep obeys the periodic-job rules (database-engineering §2)', () => {
  it('J1 single-flight — a replica that loses the lock does nothing at all', async () => {
    mockLock.granted = false;
    const out = await processUntappedReports();
    expect(mockProcessed).toHaveLength(0);
    expect(out.skippedLocked).toBe(true);
    expect(mockLock.acquired.length).toBe(1);
  });

  it('J1 the lock is released even when the run is a no-op', async () => {
    await processUntappedReports();
    expect(mockLock.released.length).toBe(1);
  });

  it('J2 per-tick cap — a backlog drains over ticks, it does not land in one', async () => {
    process.env.OBSERVE_UNTAPPED_MAX_PER_TICK = '10';
    const out = await processUntappedReports();
    expect(mockProcessed).toHaveLength(10);
    expect(out.remaining).toBe(21);
  });

  it('J2 oldest first — the cap takes the longest-waiting reports, not an arbitrary ten', async () => {
    process.env.OBSERVE_UNTAPPED_MAX_PER_TICK = '5';
    mockPOOL.length = 0;
    for (let i = 0; i < 20; i += 1) mockPOOL.push(settled(i));
    // Newest first in heap order, so only a real ORDER BY can pick the oldest.
    for (let d = 2; d <= 6; d += 1) mockPOOL.push(overdue(`d${d}`, d));
    await processUntappedReports();
    expect(mockProcessed).toEqual([
      'overdue-d6', 'overdue-d5', 'overdue-d4', 'overdue-d3', 'overdue-d2',
    ]);
  });

  it('J4 kill switch — OBSERVE_UNTAPPED_SWEEP_OFF=1 no-ops the job', async () => {
    process.env.OBSERVE_UNTAPPED_SWEEP_OFF = '1';
    const out = await processUntappedReports();
    expect(mockProcessed).toHaveLength(0);
    expect(out.disabled).toBe(true);
    expect(mockLock.acquired).toHaveLength(0);
  });
});
