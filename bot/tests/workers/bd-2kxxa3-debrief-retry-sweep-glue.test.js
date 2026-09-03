/**
 * bd-2kxxa.3 — the worker glue for the debrief self-heal sweep.
 *
 * Contract (database-engineering J1–J7, pre-merge classes O/P/Q):
 *   J1 single-flight  per-row Redis setNX lock before queueing; lock held → skip
 *   J2 per-tick cap   .limit(20) at the query, oldest first
 *   J3 narrow reads   id, debrief_status, created_at, analysis_data->observer_debrief
 *                     ONLY — never the whole analysis_data
 *   J4 kill switch    OBSERVE_DEBRIEF_RETRY_OFF=1 → nothing is even queried
 *   J5 idempotent     re-queues the SAME audioId; processDebriefRecording skips
 *                     re-transcription when a transcript exists (capture test)
 *   J7 one log line   {scanned, eligible, queued, skipped} per tick
 *
 * Mocks sit at the network/DB boundary (supabase client, redis client, SQS
 * queue service). The module under test — runDebriefRetrySweep — is real.
 */

// The worker's require-chain builds an LLM client at load; env first.
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-not-used';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key-not-used';

const mockDb = { rows: [], error: null, calls: [] };
function mockBuilder(table) {
  const ctx = { table, filters: [], select: null, order: null, limit: null };
  const b = {};
  b.select = (cols) => { ctx.select = cols; return b; };
  for (const op of ['eq', 'neq', 'is', 'not', 'gte', 'lte', 'lt', 'gt', 'in']) {
    b[op] = (...args) => { ctx.filters.push([op, ...args]); return b; };
  }
  b.order = (col, opts) => { ctx.order = { col, opts }; return b; };
  b.limit = (n) => { ctx.limit = n; return b; };
  b.then = (resolve, reject) => {
    mockDb.calls.push(ctx);
    return Promise.resolve({ data: mockDb.error ? null : mockDb.rows, error: mockDb.error }).then(resolve, reject);
  };
  return b;
}
const mockFrom = jest.fn((t) => mockBuilder(t));
jest.mock('../../shared/config/supabase', () => ({ from: (...a) => mockFrom(...a) }));

const mockSetNX = jest.fn();
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  setNX: (...a) => mockSetNX(...a),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(true),
  isAvailable: () => true,
}));

const mockQueueObserveDebrief = jest.fn().mockResolvedValue('msg-1');
jest.mock('../../shared/services/coaching/coaching-job-queue.service', () => ({
  queueObserveDebrief: (...a) => mockQueueObserveDebrief(...a),
  queueAnalysis: jest.fn(), queueReport: jest.fn(), queueJob: jest.fn(),
}));

jest.mock('../../shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: jest.fn(), extractReflectiveCorpus: jest.fn(), completeJson: jest.fn(),
}));
const mockLog = jest.fn();
jest.mock('../../shared/utils/logger', () => ({
  logToFile: (...a) => mockLog(...a), generateCorrelationId: () => 'test', runWithCorrelation: (_id, fn) => fn(),
}));

const { runDebriefRetrySweep } = require('../../workers/sqs-worker');

const HOUR = 3600 * 1000;
const NOW = Date.parse('2026-09-03T12:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const stuckRow = (id, over = {}) => ({
  id, debrief_status: 'pending', created_at: iso(5 * HOUR),
  observer_debrief: { audio_id: `wamid.${id}`, recorded_at: iso(4 * HOUR), transcript: null, ...over },
});

const ORIGINAL_OFF = process.env.OBSERVE_DEBRIEF_RETRY_OFF;
beforeEach(() => {
  jest.clearAllMocks();
  mockDb.rows = []; mockDb.error = null; mockDb.calls = [];
  mockSetNX.mockResolvedValue(true);
  delete process.env.OBSERVE_DEBRIEF_RETRY_OFF;
});
afterAll(() => {
  if (ORIGINAL_OFF === undefined) delete process.env.OBSERVE_DEBRIEF_RETRY_OFF;
  else process.env.OBSERVE_DEBRIEF_RETRY_OFF = ORIGINAL_OFF;
});

describe('T3 · runDebriefRetrySweep worker glue', () => {
  test('an eligible row → setNX lock taken → queueObserveDebrief(sessionId, {audioId}) once', async () => {
    mockDb.rows = [stuckRow('s1')];
    const res = await runDebriefRetrySweep({ now: NOW });

    expect(mockSetNX).toHaveBeenCalledTimes(1);
    const [key, , ttl] = mockSetNX.mock.calls[0];
    expect(key).toBe('debrief:retry:s1');
    expect(ttl).toBe(1800);

    expect(mockQueueObserveDebrief).toHaveBeenCalledTimes(1);
    const [sid, meta] = mockQueueObserveDebrief.mock.calls[0];
    expect(sid).toBe('s1');
    expect(meta).toEqual(expect.objectContaining({ audioId: 'wamid.s1' }));
    expect(res).toEqual(expect.objectContaining({ scanned: 1, eligible: 1, queued: 1, skipped: 0 }));
  });

  test('each retry attempt carries its own dedup phase — the queue layer keys on sessionId:jobType[:phase][:nonce] for 1h, and the nonce is sha1(audioId), so a same-audio re-queue inside the hour would otherwise be swallowed as a duplicate', async () => {
    mockDb.rows = [stuckRow('s1', { attempts: 1, failed_at: iso(HOUR) })];
    await runDebriefRetrySweep({ now: NOW });
    const meta = mockQueueObserveDebrief.mock.calls[0][1];
    expect(meta.phase).toBe('retry-2');          // attempts so far + 1
    // and a first retry of a row with no attempts yet is retry-1
    mockQueueObserveDebrief.mockClear();
    mockDb.rows = [stuckRow('s2')];
    await runDebriefRetrySweep({ now: NOW });
    expect(mockQueueObserveDebrief.mock.calls[0][1].phase).toBe('retry-1');
  });

  test('J1 single-flight: lock already held (setNX false) → NOT queued, counted as skipped', async () => {
    mockDb.rows = [stuckRow('s1'), stuckRow('s2')];
    mockSetNX.mockImplementation(async (key) => key !== 'debrief:retry:s1');
    const res = await runDebriefRetrySweep({ now: NOW });
    expect(mockQueueObserveDebrief).toHaveBeenCalledTimes(1);
    expect(mockQueueObserveDebrief.mock.calls[0][0]).toBe('s2');
    expect(res).toEqual(expect.objectContaining({ queued: 1, skipped: 1 }));
  });

  test('J4 kill switch: OBSERVE_DEBRIEF_RETRY_OFF=1 → nothing queried, nothing locked, nothing queued', async () => {
    process.env.OBSERVE_DEBRIEF_RETRY_OFF = '1';
    mockDb.rows = [stuckRow('s1')];
    const res = await runDebriefRetrySweep({ now: NOW });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSetNX).not.toHaveBeenCalled();
    expect(mockQueueObserveDebrief).not.toHaveBeenCalled();
    expect(res).toEqual(expect.objectContaining({ off: true, queued: 0 }));
  });

  test('J3 narrow read + J2 cap: the query projects only the debrief blob, filters pending observations, orders oldest-first, limits 20', async () => {
    mockDb.rows = [];
    await runDebriefRetrySweep({ now: NOW });
    expect(mockDb.calls).toHaveLength(1);
    const q = mockDb.calls[0];
    expect(q.table).toBe('coaching_sessions');
    // narrow projection: the debrief blob via a JSON path, never analysis_data whole
    expect(q.select).toMatch(/analysis_data->observer_debrief/);
    expect(q.select).not.toMatch(/analysis_data\s*(,|$)/);
    expect(q.select).not.toMatch(/\*/);
    expect(q.select).toMatch(/\bid\b/);
    expect(q.select).toMatch(/debrief_status/);
    expect(q.filters).toEqual(expect.arrayContaining([
      ['eq', 'debrief_status', 'pending'],
      ['not', 'observer_user_id', 'is', null],
    ]));
    // rows that can never be retried must not occupy the 20-row window
    expect(q.filters).toEqual(expect.arrayContaining([
      ['not', 'analysis_data->observer_debrief->>audio_id', 'is', null],
      ['is', 'analysis_data->observer_debrief->>transcript', null],
    ]));
    expect(q.filters.some(([op, col]) => op === 'gte' && col === 'created_at')).toBe(true);
    expect(q.order.col).toBe('created_at');
    expect(q.order.opts).toEqual(expect.objectContaining({ ascending: true }));
    expect(q.limit).toBe(20);
  });

  test('the selector still applies in JS: a too-young row from the query is not queued', async () => {
    mockDb.rows = [stuckRow('young', { recorded_at: iso(5 * 60 * 1000) }), stuckRow('old')];
    const res = await runDebriefRetrySweep({ now: NOW });
    expect(mockQueueObserveDebrief).toHaveBeenCalledTimes(1);
    expect(mockQueueObserveDebrief.mock.calls[0][0]).toBe('old');
    expect(res).toEqual(expect.objectContaining({ scanned: 2, eligible: 1, queued: 1 }));
  });

  test('J7: exactly one per-tick summary log line carrying the counts', async () => {
    mockDb.rows = [stuckRow('s1')];
    await runDebriefRetrySweep({ now: NOW });
    const summary = mockLog.mock.calls.filter(([msg]) => /debrief retry sweep/i.test(String(msg)));
    expect(summary).toHaveLength(1);
    expect(summary[0][1]).toEqual(expect.objectContaining({ scanned: 1, eligible: 1, queued: 1, skipped: 0 }));
  });

  test('a query error is logged at error level and the tick returns zeros — it never throws', async () => {
    mockDb.error = { message: 'connection reset' };
    await expect(runDebriefRetrySweep({ now: NOW })).resolves.toEqual(
      expect.objectContaining({ scanned: 0, queued: 0 }));
    expect(mockQueueObserveDebrief).not.toHaveBeenCalled();
    const errLog = mockLog.mock.calls.find(([, , level]) => level === 'error');
    expect(errLog).toBeTruthy();
  });

  test('a queue failure on one row does not stop the others', async () => {
    mockDb.rows = [stuckRow('s1'), stuckRow('s2')];
    mockQueueObserveDebrief.mockRejectedValueOnce(new Error('SQS down'));
    const res = await runDebriefRetrySweep({ now: NOW });
    expect(mockQueueObserveDebrief).toHaveBeenCalledTimes(2);
    expect(res).toEqual(expect.objectContaining({ queued: 1, skipped: 1 }));
  });
});
