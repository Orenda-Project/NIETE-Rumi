'use strict';
/**
 * One tick of the A/B tracker's nightly rollup (bot/shared/services/ab-tracker/ab-tracker-rollup.service.js), with fakes
 * at the edges: a fake replica (reads), a fake primary (writes), a fake Redis, a fake sleep.
 *   - off unless a replica is configured AND app_settings ab_tracker_rollup_enabled names a time (read on the replica);
 *   - the replica check is the FIRST call; a refusal touches nothing else, and the primary is never even loaded;
 *   - runs once per Pakistan date (claim + marker), inside a 90-minute window from the set time;
 *   - every read goes to the replica, every write to the primary, and writes are only the three ab_tracker_* calls;
 *   - upserts are batched; a failed read leaves the refresh 'partial' and no marker (the next tick retries);
 *   - logs counts and timings only, never a unit id.
 */
const mockLogs = [];
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLogs.push(a) }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogs.push(a),
  generateCorrelationId: () => 'corr-test',
  runWithCorrelation: (_id, fn) => fn(),
}));

const Job = require('../../bot/shared/services/ab-tracker/ab-tracker-rollup.service');

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AT = (hhmm, date = '2026-11-21') => new Date(Date.parse(`${date}T${hhmm}:00+05:00`));
const TESTS = [
  { test_id: 'ict-ch9-plans', unit_kind: 'school', metric_ids: ['plan_fidelity', 'teachers_coming_back', 'teacher_rating_external'],
    start_on: '2026-11-10', read_on: '2026-12-05', units: 3 },
];

function fakeRedis(seed = {}) {
  const store = { ...seed };
  return {
    store,
    isAvailable: () => true,
    async setNX(k, v) { if (!(k in store)) store[k] = v; return true; },
    async get(k) { return k in store ? store[k] : null; },
    async set(k, v) { store[k] = v; return true; },
  };
}

function rowsFor(metric, count) {
  return Array.from({ length: count }, (_, i) => ({
    arm: i % 2 ? 'b' : 'a', unit_id: U(i + 1), block: null, period_kind: metric === 'teachers_coming_back' ? 'week' : 'day',
    period: '2026-11-17', n: 2, s: 140, ss: 9900,
  }));
}

function fakeReader({ sw = { at: '02:00' }, replica = true, tests = TESTS, failMetric = null, rows = 3 } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = { table };
      const b = {
        select: () => b,
        eq: (_c, v) => { q.key = v; return b; },
        maybeSingle: async () => { calls.push(['settings', q.key]); return { data: sw === null ? null : { value: sw }, error: null }; },
      };
      return b;
    },
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'db_is_replica') return { data: replica, error: null };
      if (name === 'ab_tracker_live_tests') return { data: tests, error: null };
      if (name === 'ab_tracker_metric_rows') {
        if (args.p_metric_id === failMetric) return { data: null, error: { message: 'canceling statement due to statement timeout' } };
        return { data: rowsFor(args.p_metric_id, rows), error: null };
      }
      throw new Error(`unexpected read ${name}`);
    },
  };
}

function fakeWriter() {
  const calls = [];
  return {
    calls,
    from() { throw new Error('the writer only calls the ab_tracker_* functions'); },
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'ab_tracker_refresh_open') return { data: 'refresh-1', error: null };
      if (name === 'ab_tracker_upsert_rollup') return { data: args.p_rows.length, error: null };
      if (name === 'ab_tracker_refresh_close') return { data: null, error: null };
      throw new Error(`unexpected write ${name}`);
    },
  };
}

const sleep = jest.fn(async () => {});
const go = (over = {}) => {
  const reader = over.reader || fakeReader();
  const writer = over.writer || fakeWriter();
  const redis = over.redis || fakeRedis();
  return Job.run({ now: AT('02:10'), reader, writer: () => writer, redis, sleep, ...over.deps })
    .then((r) => ({ r, reader, writer, redis }));
};

beforeEach(() => { mockLogs.length = 0; sleep.mockClear(); });

test('the switch: {"at":"HH:MM"} or true (03:00); anything else is off; a window must end by midnight', () => {
  expect(Job.parseSwitch({ at: '02:00' })).toBe(120);
  expect(Job.parseSwitch('{"at":"01:30"}')).toBe(90);
  expect(Job.parseSwitch(true)).toBe(180);
  for (const v of [null, false, 'yes', { at: '2am' }, { at: '23:00' }, [], {}]) expect(Job.parseSwitch(v)).toBeNull();
});

test('off with no replica configured; the primary is never asked for', async () => {
  const getWriter = jest.fn();
  const r = await Job.run({ now: AT('02:10'), reader: null, writer: getWriter, redis: fakeRedis(), sleep });
  expect(r).toEqual({ outcome: 'off', reason: 'no_replica' });
  expect(getWriter).not.toHaveBeenCalled();
});

test('refused when the server is not a replica: nothing else is read, nothing written', async () => {
  const getWriter = jest.fn();
  const reader = fakeReader({ replica: false });
  const r = await Job.run({ now: AT('02:10'), reader, writer: getWriter, redis: fakeRedis(), sleep });
  expect(r.outcome).toBe('refused');
  expect(reader.calls).toEqual([['db_is_replica', undefined]]);
  expect(getWriter).not.toHaveBeenCalled();
});

test('off when the switch is missing; not due outside its window', async () => {
  expect((await go({ reader: fakeReader({ sw: null }) })).r).toEqual({ outcome: 'off', reason: 'switch_off' });
  const early = await Job.run({ now: AT('01:59'), reader: fakeReader(), writer: () => fakeWriter(), redis: fakeRedis(), sleep });
  expect(early.outcome).toBe('not_due');
  const late = await Job.run({ now: AT('03:31'), reader: fakeReader(), writer: () => fakeWriter(), redis: fakeRedis(), sleep });
  expect(late.outcome).toBe('not_due');
});

test('a run: reads on the replica, writes only ab_tracker_* on the primary, in order', async () => {
  const { r, reader, writer, redis } = await go();
  expect(r.outcome).toBe('ran');
  expect(reader.calls[0][0]).toBe('db_is_replica');
  const reads = reader.calls.map((c) => c[0]);
  expect(reads.filter((n) => n === 'ab_tracker_metric_rows')).toHaveLength(2); // teacher_rating_external is not a database measure
  expect(writer.calls.map((c) => c[0])).toEqual(['ab_tracker_refresh_open', 'ab_tracker_upsert_rollup', 'ab_tracker_refresh_close']);
  expect(writer.calls[1][1].p_refresh_id).toBe('refresh-1');
  expect(writer.calls[1][1].p_rows.every((x) => x.test_id === 'ict-ch9-plans')).toBe(true);
  expect(writer.calls[2][1]).toMatchObject({ p_refresh_id: 'refresh-1', p_status: 'ran' });
  expect(r).toMatchObject({ tests: 1, reads: 2, skipped_metrics: 1, rows: 6, failed: 0 });
  expect(redis.store['ab_tracker:v1:run:2026-11-21']).toBeTruthy();
  expect(sleep).toHaveBeenCalled();
});

test('the read window: daily from 4 days back (or the start), weekly from that Monday, to yesterday', async () => {
  const { reader } = await go();
  const args = Object.fromEntries(reader.calls.filter((c) => c[0] === 'ab_tracker_metric_rows').map((c) => [c[1].p_metric_id, c[1]]));
  expect(args.plan_fidelity).toEqual({ p_test_id: 'ict-ch9-plans', p_metric_id: 'plan_fidelity', p_from: '2026-11-17', p_to: '2026-11-20' });
  expect(args.teachers_coming_back).toMatchObject({ p_from: '2026-11-16', p_to: '2026-11-20' });
  expect(Job.windowFor({ start_on: '2026-11-19' }, 'day', '2026-11-21')).toEqual({ from: '2026-11-19', to: '2026-11-20' });
  expect(Job.windowFor({ start_on: '2026-11-21' }, 'day', '2026-11-21')).toBeNull();
});

test('upserts go in batches of at most BATCH_ROWS', async () => {
  const { writer } = await go({ reader: fakeReader({ rows: Job.BATCH_ROWS + 5 }) });
  const sizes = writer.calls.filter((c) => c[0] === 'ab_tracker_upsert_rollup').map((c) => c[1].p_rows.length);
  expect(Math.max(...sizes)).toBeLessThanOrEqual(Job.BATCH_ROWS);
  expect(sizes.reduce((a, b) => a + b, 0)).toBe(2 * (Job.BATCH_ROWS + 5));
});

test('a failed read: the refresh is partial, no marker, the other measures still land', async () => {
  const { r, writer, redis } = await go({ reader: fakeReader({ failMetric: 'plan_fidelity' }) });
  expect(r).toMatchObject({ outcome: 'partial', failed: 1 });
  expect(writer.calls.at(-1)[1].p_status).toBe('partial');
  expect(writer.calls.some((c) => c[0] === 'ab_tracker_upsert_rollup')).toBe(true);
  expect(redis.store['ab_tracker:v1:run:2026-11-21']).toBeUndefined();
});

test('once a night: the marker stops a second run, and another worker holding the tick skips', async () => {
  const marked = await go({ redis: fakeRedis({ 'ab_tracker:v1:run:2026-11-21': 'x' }) });
  expect(marked.r.outcome).toBe('done_already');
  expect(marked.writer.calls).toEqual([]);
  const held = await go({ redis: fakeRedis({ 'ab_tracker:v1:tick': 'other' }) });
  expect(held.r.outcome).toBe('skipped');
});

test('no live tests: logged as ran with zero, nothing upserted', async () => {
  const { r, writer } = await go({ reader: fakeReader({ tests: [] }) });
  expect(r).toMatchObject({ outcome: 'ran', tests: 0, rows: 0 });
  expect(writer.calls.map((c) => c[0])).toEqual(['ab_tracker_refresh_open', 'ab_tracker_refresh_close']);
});

test('logs carry counts and timings, never a unit id; the run never throws', async () => {
  await go();
  expect(JSON.stringify(mockLogs)).not.toContain(U(1));
  const boom = { rpc: async () => { throw new Error('network'); }, from: () => { throw new Error('network'); } };
  const r = await Job.run({ now: AT('02:10'), reader: boom, writer: () => fakeWriter(), redis: fakeRedis(), sleep });
  expect(r.outcome).toBe('refused');
});

// --- full-window recompute (late rows past the 4-day lookback) ----------------------------------------------------

test('on a Monday (Pakistan) the window runs from the start: daily from start_on, weekly from its Monday', () => {
  const t = { start_on: '2026-11-10', read_on: '2026-12-05' };
  expect(Job.windowFor(t, 'day', '2026-11-23')).toEqual({ from: '2026-11-10', to: '2026-11-22', full: true });
  expect(Job.windowFor(t, 'week', '2026-11-23')).toEqual({ from: '2026-11-09', to: '2026-11-22', full: true });
});

test('on the read day the window runs from the start too', () => {
  const t = { start_on: '2026-11-10', read_on: '2026-12-05' };
  expect(Job.windowFor(t, 'day', '2026-12-05')).toEqual({ from: '2026-11-10', to: '2026-12-04', full: true });
});

test('any other day keeps the 4-day window', () => {
  const t = { start_on: '2026-11-10', read_on: '2026-12-05' };
  expect(Job.windowFor(t, 'day', '2026-11-24')).toEqual({ from: '2026-11-20', to: '2026-11-23' });
  expect(Job.isFullDay(t, '2026-11-24')).toBe(false);
});

test('a window is read in slices of at most 7 days', () => {
  expect(Job.slices({ from: '2026-11-10', to: '2026-11-22' })).toEqual([
    { from: '2026-11-10', to: '2026-11-16' }, { from: '2026-11-17', to: '2026-11-22' }]);
  expect(Job.slices({ from: '2026-11-17', to: '2026-11-20' })).toEqual([{ from: '2026-11-17', to: '2026-11-20' }]);
});

test('a Monday run reads each measure slice by slice, with a pause between calls, and counts the full windows', async () => {
  const reader = fakeReader();
  const { r } = await go({ reader, deps: { now: AT('02:10', '2026-11-23') } });
  const reads = reader.calls.filter((c) => c[0] === 'ab_tracker_metric_rows').map((c) => [c[1].p_metric_id, c[1].p_from, c[1].p_to]);
  expect(reads).toEqual([
    ['plan_fidelity', '2026-11-10', '2026-11-16'], ['plan_fidelity', '2026-11-17', '2026-11-22'],
    ['teachers_coming_back', '2026-11-09', '2026-11-15'], ['teachers_coming_back', '2026-11-16', '2026-11-22'],
  ]);
  expect(r).toMatchObject({ outcome: 'ran', reads: 4, full_windows: 2, failed: 0 });
});
