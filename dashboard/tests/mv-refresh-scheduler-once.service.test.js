/**
 * Test: the materialized-view refresh scheduler runs ONCE per deployment, locked.
 *
 * cluster.js forks N workers and every worker runs index.js, which used to call
 * mvScheduler.start() unconditionally: N independent loops, each refreshing every
 * view every 5 minutes with no lock and no skip-if-running. These tests drive the
 * real cluster.js primary path and the real scheduler start/refresh path; only the
 * `cluster` module and the `pg` Pool are mocked.
 */

const path = require('path');

const CLUSTER_PATH = path.join(__dirname, '..', 'cluster.js');
const SCHEDULER_PATH = path.join(__dirname, '..', 'services', 'mv-refresh-scheduler.service.js');

const ENV_KEYS = ['MV_SCHEDULER_ENABLED', 'MV_SCHEDULER_OWNER', 'MV_REFRESH_INTERVAL_MS', 'CLUSTER_WORKERS', 'CLUSTER_ENABLED'];

// Every query any mocked pg client receives, across every loaded scheduler instance.
let mockQueries;
let mockLockGranted;
let mockRefreshImpl;
let mockPoolsCreated;

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => {
    mockPoolsCreated += 1;
    return {
      on: jest.fn(),
      end: jest.fn().mockResolvedValue(),
      connect: jest.fn().mockImplementation(async () => ({
        release: jest.fn(),
        query: jest.fn().mockImplementation(async (sql) => {
          mockQueries.push(sql);
          if (/pg_try_advisory_xact_lock/.test(sql)) return { rows: [{ locked: mockLockGranted }] };
          if (/^REFRESH MATERIALIZED VIEW/.test(sql)) return mockRefreshImpl(sql);
          return { rows: [] };
        })
      }))
    };
  })
}));

function loadScheduler(env = {}) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  let scheduler;
  jest.isolateModules(() => { scheduler = require(SCHEDULER_PATH); });
  return {
    scheduler,
    restore() { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
  };
}

const refreshes = () => mockQueries.filter(q => /^REFRESH MATERIALIZED VIEW/.test(q));
const CONN = 'postgres://user:pw@localhost:6543/db';

describe('mv-refresh-scheduler: one loop, locked, 15 min', () => {
  let logSpy;
  let errSpy;
  const loaded = [];

  beforeEach(() => {
    jest.useFakeTimers();
    mockQueries = [];
    mockLockGranted = true;
    mockRefreshImpl = async () => ({ rows: [] });
    mockPoolsCreated = 0;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    while (loaded.length) { const l = loaded.pop(); l.scheduler.stop(); l.restore(); }
    jest.useRealTimers();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  function start(env) {
    const l = loadScheduler(env);
    loaded.push(l);
    l.scheduler.start({ connectionString: CONN });
    return l.scheduler;
  }

  test('4 workers forked by cluster.js start exactly ONE refresh loop', async () => {
    const forkedEnvs = [];
    const mockCluster = {
      isPrimary: true,
      on: jest.fn(),
      workers: {},
      fork: jest.fn((env) => { forkedEnvs.push(env || {}); return { process: { pid: 1000 + forkedEnvs.length } }; })
    };
    jest.doMock('cluster', () => mockCluster);
    const sigListeners = { SIGTERM: process.listeners('SIGTERM'), SIGINT: process.listeners('SIGINT') };
    process.env.CLUSTER_WORKERS = '4';
    try {
      jest.isolateModules(() => { require(CLUSTER_PATH); });
    } finally {
      delete process.env.CLUSTER_WORKERS;
      jest.dontMock('cluster');
      for (const sig of ['SIGTERM', 'SIGINT']) {
        for (const fn of process.listeners(sig)) if (!sigListeners[sig].includes(fn)) process.removeListener(sig, fn);
      }
    }
    expect(forkedEnvs).toHaveLength(4);

    const schedulers = forkedEnvs.map(env => start(env));
    expect(schedulers.filter(s => s.getStatus().isRunning)).toHaveLength(1);
    expect(mockPoolsCreated).toBe(1);

    await jest.advanceTimersByTimeAsync(30 * 1000);
    // One run of 5 views, not 4 x 5.
    expect(refreshes()).toHaveLength(5);
  });

  test('cluster.js hands the scheduler to the replacement when the owning worker dies', () => {
    const forked = [];
    const handlers = {};
    const mockCluster = {
      isPrimary: true,
      workers: {},
      on: jest.fn((ev, fn) => { handlers[ev] = fn; }),
      fork: jest.fn((env) => { const w = { id: forked.length + 1, process: { pid: 2000 + forked.length }, env: env || {} }; forked.push(w); return w; })
    };
    jest.doMock('cluster', () => mockCluster);
    const sigListeners = { SIGTERM: process.listeners('SIGTERM'), SIGINT: process.listeners('SIGINT') };
    process.env.CLUSTER_WORKERS = '3';
    try {
      jest.isolateModules(() => { require(CLUSTER_PATH); });
    } finally {
      delete process.env.CLUSTER_WORKERS;
      jest.dontMock('cluster');
      for (const sig of ['SIGTERM', 'SIGINT']) {
        for (const fn of process.listeners(sig)) if (!sigListeners[sig].includes(fn)) process.removeListener(sig, fn);
      }
    }
    const owner = forked.find(w => w.env.MV_SCHEDULER_OWNER === '1');
    const other = forked.find(w => w.env.MV_SCHEDULER_OWNER === '0');
    expect(owner).toBeDefined();

    handlers.exit(other, 1, null);
    expect(forked[forked.length - 1].env.MV_SCHEDULER_OWNER).toBe('0');

    handlers.exit(owner, 1, null);
    expect(forked[forked.length - 1].env.MV_SCHEDULER_OWNER).toBe('1');
    expect(forked.filter(w => w.env.MV_SCHEDULER_OWNER === '1')).toHaveLength(2); // the dead one + its replacement
  });

  test('a single unclustered process still runs the scheduler', () => {
    const s = start({});
    expect(s.getStatus().isRunning).toBe(true);
  });

  test('kill switch MV_SCHEDULER_ENABLED=false: no loop, no pool, no queries', async () => {
    const s = start({ MV_SCHEDULER_ENABLED: 'false', MV_SCHEDULER_OWNER: '1' });
    expect(s.getStatus().isRunning).toBe(false);
    expect(mockPoolsCreated).toBe(0);
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mockQueries).toHaveLength(0);
  });

  test('a lock held elsewhere (another replica) -> the run is skipped, no REFRESH issued', async () => {
    mockLockGranted = false;
    start({});
    await jest.advanceTimersByTimeAsync(30 * 1000);
    expect(mockQueries.some(q => /pg_try_advisory_xact_lock\(hashtext\('refresh_dashboard_views'\)/.test(q))).toBe(true);
    expect(refreshes()).toHaveLength(0);
    expect(mockQueries).toContain('ROLLBACK');
    expect(logSpy.mock.calls.some(c => /\[MV Scheduler\] run skipped reason=lock_held/.test(c[0]))).toBe(true);
  });

  test('the lock is transaction-scoped and released by COMMIT (safe through the transaction pooler)', async () => {
    start({});
    await jest.advanceTimersByTimeAsync(30 * 1000);
    expect(mockQueries[0]).toBe('BEGIN');
    expect(mockQueries[mockQueries.length - 1]).toBe('COMMIT');
    expect(mockQueries.some(q => /pg_advisory_lock\(|pg_try_advisory_lock\(/.test(q))).toBe(false);
    expect(logSpy.mock.calls.some(c => /\[MV Scheduler\] run done in \d+ms views=5 errors=0/.test(c[0]))).toBe(true);
  });

  test('one failing view does not abort the others inside the locked transaction', async () => {
    mockRefreshImpl = async (sql) => {
      if (/mv_users_activity/.test(sql)) throw new Error('boom');
      return { rows: [] };
    };
    start({});
    await jest.advanceTimersByTimeAsync(30 * 1000);
    expect(refreshes()).toHaveLength(5);
    expect(mockQueries.some(q => /^ROLLBACK TO SAVEPOINT/.test(q))).toBe(true);
    expect(mockQueries[mockQueries.length - 1]).toBe('COMMIT');
  });

  test('a run still in flight -> the next tick is skipped in this process', async () => {
    let release;
    let hang = false;
    mockRefreshImpl = (sql) => (hang && /mv_dashboard_stats$/.test(sql) ? new Promise(r => { release = r; }) : Promise.resolve({ rows: [] }));
    start({ MV_REFRESH_INTERVAL_MS: '60000' });
    await jest.advanceTimersByTimeAsync(30 * 1000); // first run completes, interval armed
    hang = true;
    await jest.advanceTimersByTimeAsync(60 * 1000 * 3); // run 2 hangs; ticks 3 and 4 fire during it
    expect(mockQueries.filter(q => q === 'BEGIN')).toHaveLength(2);
    expect(logSpy.mock.calls.filter(c => /\[MV Scheduler\] run skipped reason=in_flight/.test(c[0]))).toHaveLength(2);
    hang = false;
    release({ rows: [] });
    await jest.advanceTimersByTimeAsync(60 * 1000);
    expect(mockQueries.filter(q => q === 'BEGIN')).toHaveLength(3);
  });

  test('default interval is 15 minutes, overridable by MV_REFRESH_INTERVAL_MS', async () => {
    const s = start({});
    expect(s.getStatus().intervalMs).toBe(15 * 60 * 1000);
    await jest.advanceTimersByTimeAsync(30 * 1000);
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(mockQueries.filter(q => q === 'BEGIN')).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(mockQueries.filter(q => q === 'BEGIN')).toHaveLength(2);

    s.stop();
    mockQueries = [];
    const t = start({ MV_REFRESH_INTERVAL_MS: '120000' });
    expect(t.getStatus().intervalMs).toBe(120000);
  });
});
