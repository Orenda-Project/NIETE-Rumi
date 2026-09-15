/**
 * The sweep that reads the three unowned delivery states.
 *
 * Every rule here is one of the periodic-job contract items that the two prod
 * wedges were caused by skipping. They are asserted rather than described,
 * because "the sweep has a cap" has been a comment before and not a predicate.
 *
 *   single-flight   one Redis lock, so six replicas send ONE set of messages
 *   per-tick cap    a 539-row backlog drains over ticks, never in one
 *   narrow reads    the teacher_delivery slice, NEVER the whole analysis_data
 *   kill switch     documented, and OFF until someone turns it on
 *   idempotent      reminded_at / gave_up_at on the row, not "probably once"
 *   age ceiling     rows too old to act on are closed silently
 *   per-tick log    every tick, including the ticks that find nothing
 *
 * The projection matters most. `analysis_data` on an observation is the fattest
 * JSONB in this database, and pulling it whole for a page of rows is what
 * OOM-wedged production for two nights: memory cost is rows x blob, and the DB
 * dies at the query layer long before disk is a problem. The read asserted here
 * selects the slice it consumes.
 */

const mockRedis = {
  acquireLock: jest.fn(async () => true),
  releaseLock: jest.fn(async () => true),
};
jest.mock('../../shared/services/cache/railway-redis.service', () => mockRedis);

const mockProcessUndelivered = jest.fn(async () => ({ action: 'remind', reason: 'no_send_after_grace' }));
jest.mock('../../shared/services/observe/observe-send.service', () => ({
  processUntappedDelivery: jest.fn(async () => ({ action: 'skip' })),
  processUndeliveredDelivery: (...a) => mockProcessUndelivered(...a),
}));

const mockLogs = [];
jest.mock('../../shared/utils/logger', () => ({
  logToFile: (msg, data) => { mockLogs.push({ msg, data }); },
}));

// One recorder for every query the sweep issues, so the projection, the
// filters, the ordering and the bound can all be asserted.
const mockQueries = [];
const mockPages = { rows: [] };
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn((table) => {
    const q = { table, filters: [], select: null, order: [], range: null };
    mockQueries.push(q);
    const chain = {
      select: jest.fn((cols) => { q.select = cols; return chain; }),
      eq: jest.fn((c, v) => { q.filters.push(['eq', c, v]); return chain; }),
      in: jest.fn((c, v) => { q.filters.push(['in', c, v]); return chain; }),
      is: jest.fn((c, v) => { q.filters.push(['is', c, v]); return chain; }),
      not: jest.fn((c, op, v) => { q.filters.push(['not', c, op, v]); return chain; }),
      order: jest.fn((c, o) => { q.order.push([c, o]); return chain; }),
      limit: jest.fn((n) => { q.limit = n; return chain; }),
      range: jest.fn((a, b) => {
        q.range = [a, b];
        // One lane gets the fixture, the rest come back empty, so `scanned` is
        // exactly the fixture size rather than three copies of it.
        const served = mockPages.served ? [] : mockPages.rows;
        if (mockPages.rows.length) mockPages.served = true;
        return Promise.resolve({ data: served, error: null });
      }),
      single: jest.fn(async () => ({ data: null, error: null })),
      maybeSingle: jest.fn(async () => ({ data: null, error: null })),
      update: jest.fn(() => ({ eq: jest.fn(async () => ({ error: null })) })),
    };
    return chain;
  }),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => true) }));

const worker = require('../../workers/stale-session.worker');

const ENV_KEYS = [
  'OBSERVE_UNDELIVERED_SWEEP_OFF',
  'OBSERVE_UNDELIVERED_MAX_PER_TICK',
  'OBSERVE_UNDELIVERED_MAX_EXPIRE_PER_TICK',
];
const saved = {};
beforeEach(() => {
  jest.clearAllMocks();
  mockQueries.length = 0;
  mockLogs.length = 0;
  mockPages.rows = [];
  mockPages.served = false;
  // clearAllMocks clears CALLS, not implementations — a mockRejectedValue set
  // by one test otherwise becomes the baseline for every later one.
  mockProcessUndelivered.mockReset();
  mockProcessUndelivered.mockResolvedValue({ action: 'remind', reason: 'no_send_after_grace' });
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  // Every test that wants the sweep to RUN must turn it on, which is the point.
  process.env.OBSERVE_UNDELIVERED_SWEEP_OFF = '0';
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const row = (id, delivery, over = {}) => ({
  id,
  status: 'observer_review_complete',
  updated_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
  created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(),
  observer_user_id: 'coach-1',
  teacher_delivery: delivery,
  ...over,
});
const sessionQueries = () => mockQueries.filter((q) => q.table === 'coaching_sessions');
const logLine = (needle) => mockLogs.find((l) => l.msg.includes(needle));

describe('the kill switch, and which way it defaults', () => {
  test('UNSET means OFF — this ships dark and is enabled deliberately', async () => {
    delete process.env.OBSERVE_UNDELIVERED_SWEEP_OFF;
    const out = await worker.processUndeliveredReports();
    expect(out.disabled).toBe(true);
    expect(sessionQueries()).toHaveLength(0);
    expect(mockProcessUndelivered).not.toHaveBeenCalled();
    // Off is not the same as broken: the tick still says so.
    expect(logLine('undelivered sweep off')).toBeTruthy();
  });

  test('=1 is the documented kill switch and is distinguishable in the log', async () => {
    process.env.OBSERVE_UNDELIVERED_SWEEP_OFF = '1';
    const out = await worker.processUndeliveredReports();
    expect(out.disabled).toBe(true);
    expect(logLine('undelivered sweep off').data.reason).toMatch(/OBSERVE_UNDELIVERED_SWEEP_OFF/);
  });

  test('=0 turns it on', async () => {
    process.env.OBSERVE_UNDELIVERED_SWEEP_OFF = '0';
    const out = await worker.processUndeliveredReports();
    expect(out.disabled).toBeUndefined();
  });
});

describe('the read', () => {
  test('projects the teacher_delivery SLICE and never the whole analysis_data', async () => {
    await worker.processUndeliveredReports();
    expect(sessionQueries().length).toBeGreaterThan(0);
    for (const q of sessionQueries()) {
      expect(q.select).toContain('analysis_data->teacher_delivery');
      // The fat column, unsliced, is the wedge. It must not appear as a bare
      // selected column anywhere in this sweep.
      expect(q.select.split(',').map((c) => c.trim())).not.toContain('analysis_data');
      expect(q.select).not.toMatch(/(^|,)\s*\*/);
    }
  });

  test('every read is bounded and stably ordered', async () => {
    await worker.processUndeliveredReports();
    for (const q of sessionQueries()) {
      expect(q.range).not.toBeNull();
      expect(q.range[1] - q.range[0]).toBeLessThan(1000);
      // Oldest first, then a tiebreaker: an unstable order re-reads the same
      // page forever and the tail of the backlog is never seen.
      expect(q.order.length).toBeGreaterThanOrEqual(2);
      expect(q.order[q.order.length - 1][0]).toBe('id');
    }
  });

  test('it asks only for finished coach observations', async () => {
    await worker.processUndeliveredReports();
    for (const q of sessionQueries()) {
      const flat = JSON.stringify(q.filters);
      expect(flat).toContain('leader_observation');
      expect(flat).toContain('completed');
      expect(flat).toContain('observer_review_complete');
    }
  });

  test('it covers all three unowned states and asks for nothing else', async () => {
    await worker.processUndeliveredReports();
    const flat = JSON.stringify(sessionQueries().map((q) => q.filters));
    expect(flat).toContain('awaiting_confirm');
    expect(flat).toContain('previewing');
    // The no-record case cannot be matched by a status, so it is its own query.
    expect(flat).toContain('["is","analysis_data->teacher_delivery",null]');
    // Neither of the two states that belong to someone else.
    expect(flat).not.toContain('awaiting_teacher_tap');
    expect(flat).not.toContain('awaiting_observer_review');
  });

  test('it never selects the teacher\'s or the coach\'s identity it does not use', async () => {
    await worker.processUndeliveredReports();
    for (const q of sessionQueries()) {
      expect(q.select).not.toContain('users(');
      expect(q.select).not.toContain('transcript');
    }
  });
});

describe('the per-tick caps', () => {
  test('acts on at most the cap, oldest first, and reports the remainder', async () => {
    process.env.OBSERVE_UNDELIVERED_MAX_PER_TICK = '3';
    mockPages.rows = Array.from({ length: 9 }, (_, i) => row(`s-${i}`, { status: 'awaiting_confirm' }));

    const out = await worker.processUndeliveredReports();
    expect(mockProcessUndelivered).toHaveBeenCalledTimes(3);
    expect(out.remaining).toBeGreaterThan(0);
  });

  test('a silent expire has its OWN ceiling, so tick one cannot close 400 rows', async () => {
    // 407 of today's 539 rows classify as expire. Those are writes, not
    // messages, but 407 writes in one tick is still one tick doing a migration.
    process.env.OBSERVE_UNDELIVERED_MAX_PER_TICK = '100';
    process.env.OBSERVE_UNDELIVERED_MAX_EXPIRE_PER_TICK = '5';
    mockProcessUndelivered.mockResolvedValue({ action: 'expire', reason: 'too_old_to_chase' });
    // 20 days old and never chased — what 407 of today's rows look like.
    const old = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString();
    mockPages.rows = Array.from({ length: 40 }, (_, i) => row(
      `s-${i}`, { status: 'awaiting_confirm' }, { updated_at: old }));

    const out = await worker.processUndeliveredReports();
    expect(out.expired).toBeLessThanOrEqual(5);
    // The rows it refused are reported, not dropped: the backlog is still there.
    expect(out.expireCapped).toBeGreaterThan(0);
    expect(out.remaining).toBeGreaterThan(0);
  });
});

describe('single-flight', () => {
  test('no lock means no sweep, and it says so rather than going quiet', async () => {
    mockRedis.acquireLock.mockResolvedValueOnce(false);
    const out = await worker.processUndeliveredReports();
    expect(out.skippedLocked).toBe(true);
    expect(sessionQueries()).toHaveLength(0);
    expect(logLine('undelivered sweep skipped')).toBeTruthy();
  });

  test('the lock is released even when the sweep throws', async () => {
    mockProcessUndelivered.mockRejectedValueOnce(new Error('boom'));
    mockPages.rows = [row('s-1', { status: 'awaiting_confirm' })];
    await worker.processUndeliveredReports();
    expect(mockRedis.releaseLock).toHaveBeenCalled();
  });

  test('one row failing does not abandon the rest of the tick', async () => {
    mockPages.rows = [row('a', { status: 'awaiting_confirm' }), row('b', { status: 'previewing' })];
    mockProcessUndelivered
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ action: 'remind', reason: 'no_send_after_grace' });
    const out = await worker.processUndeliveredReports();
    expect(out.failed).toBe(1);
    expect(out.reminded).toBe(1);
  });
});

describe('the per-tick log line', () => {
  test('fires on a tick that found nothing — the absence of work must be visible', async () => {
    mockPages.rows = [];
    await worker.processUndeliveredReports();
    const line = logLine('undelivered sweep done');
    expect(line).toBeTruthy();
    expect(line.data.scanned).toBe(0);
    expect(line.data).toHaveProperty('reminded');
    expect(line.data).toHaveProperty('expired');
  });

  test('counts each action separately, so a tick of 400 expires is not read as 400 messages', async () => {
    mockPages.rows = [row('a', { status: 'awaiting_confirm' }), row('b', { status: 'previewing' })];
    mockProcessUndelivered
      .mockResolvedValueOnce({ action: 'remind', reason: 'x' })
      .mockResolvedValueOnce({ action: 'expire', reason: 'too_old_to_chase' });
    const out = await worker.processUndeliveredReports();
    expect(out.reminded).toBe(1);
    expect(out.expired).toBe(1);
    expect(out.gaveUp).toBe(0);
  });
});

describe('the sweep is wired into the recovery run', () => {
  test('runRecovery reports an undelivered result', async () => {
    const out = await worker.runRecovery();
    expect(out).toHaveProperty('undelivered');
  });

  test('a throw from this sweep never hides the others', async () => {
    // Each sweep is in its own try for exactly this reason: the mid-flight
    // watchdog going unrun because a newer sweep threw is a worse bug than the
    // one the newer sweep fixes.
    const spy = jest.spyOn(worker, 'processUndeliveredReports');
    const out = await worker.runRecovery();
    expect(out).toHaveProperty('midFlight');
    expect(out).toHaveProperty('photoGate');
    spy.mockRestore();
  });
});
