/**
 * loadPriorAction — the teacher's most recent action record from EITHER
 * instrument (self-serve or a coach-confirmed /observe visit). RED FIRST.
 *
 *  - null when there is none, it is older than maxAgeDays, it predates the
 *    loop (no .target), or the row is an AI draft no coach signed off
 *  - the current session is excluded (a report re-run must not read itself)
 *  - newest first, ONE row: `.order(asc).limit(1)` would return the OLDEST
 */
const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const { loadPriorAction } = require('../../bot/shared/services/coaching/coaching-trend.service');

let calls;
function stub(rows, { error = null } = {}) {
  calls = { in: [], not: [], neq: [], order: [], limit: [], eq: [] };
  mockSupabase.from.mockImplementation(() => {
    const chain = {};
    for (const m of ['select', 'eq', 'in', 'not', 'neq', 'order', 'limit']) {
      chain[m] = jest.fn((...a) => { if (calls[m]) calls[m].push(a); return chain; });
    }
    chain.then = (resolve) => resolve({ data: rows, error });
    return chain;
  });
}
const rec = (over = {}) => ({ target: { indicator: 'C3', domain: 'high_leverage_practices', name: 'x' }, action: 'a', attempt: 1, angle: 'tell', target_status: 'open', ...over });
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

beforeEach(() => jest.clearAllMocks());

describe('loadPriorAction', () => {
  test('returns the newest record with its session id, date and instrument', async () => {
    stub([{ id: 's9', created_at: daysAgo(1), observation_type: null, status: 'completed', prioritized_action: rec() }]);
    const r = await loadPriorAction('u1', { excludeSessionId: 's10' });
    expect(r).toMatchObject({ session_id: 's9', instrument: 'self', target: { indicator: 'C3' } });
  });
  test('a coach-confirmed /observe row counts, stamped as the observe instrument', async () => {
    stub([{ id: 's8', created_at: daysAgo(2), observation_type: 'leader_observation', status: 'observer_review_complete', prioritized_action: rec() }]);
    expect((await loadPriorAction('u1')).instrument).toBe('observe');
  });
  test('the query: user, both confirmed statuses, non-null record, current session excluded, newest first, one row', async () => {
    stub([]);
    await loadPriorAction('u1', { excludeSessionId: 's10' });
    expect(calls.eq).toContainEqual(['user_id', 'u1']);
    expect(calls.in[0][0]).toBe('status');
    expect(calls.in[0][1].slice().sort()).toEqual(['completed', 'observer_review_complete']);
    expect(calls.not[0]).toEqual(['prioritized_action', 'is', null]);
    expect(calls.neq).toContainEqual(['id', 's10']);
    expect(calls.order[0]).toEqual(['created_at', { ascending: false }]);
    expect(calls.limit[0]).toEqual([1]);
  });
  test('null on no rows, on a supabase error, on a missing user id', async () => {
    stub([]); expect(await loadPriorAction('u1')).toBeNull();
    stub(null, { error: { message: 'boom' } }); expect(await loadPriorAction('u1')).toBeNull();
    expect(await loadPriorAction(null)).toBeNull();
  });
  test('null when the newest record predates the loop (no .target) — the loop seeds itself', async () => {
    stub([{ id: 's7', created_at: daysAgo(1), status: 'completed', prioritized_action: { commitment: 'c', action: 'a', _source: 'llm' } }]);
    expect(await loadPriorAction('u1')).toBeNull();
  });
  test('null when the record is older than maxAgeDays (default 30) — history, not state', async () => {
    stub([{ id: 's6', created_at: daysAgo(31), status: 'completed', prioritized_action: rec() }]);
    expect(await loadPriorAction('u1')).toBeNull();
    stub([{ id: 's6', created_at: daysAgo(31), status: 'completed', prioritized_action: rec() }]);
    expect(await loadPriorAction('u1', { maxAgeDays: 60 })).not.toBeNull();
  });
  test('null when the record was written for another framework', async () => {
    stub([{ id: 's5', created_at: daysAgo(1), status: 'completed', prioritized_action: rec({ framework: 'mewaka' }) }]);
    expect(await loadPriorAction('u1')).toBeNull();
  });
  test('never throws — a thrown query resolves to null', async () => {
    mockSupabase.from.mockImplementation(() => { throw new Error('down'); });
    expect(await loadPriorAction('u1')).toBeNull();
  });
});
