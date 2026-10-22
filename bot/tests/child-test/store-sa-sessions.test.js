'use strict';

/**
 * The store's reads for the results dashboard: the self-administered sessions (one coach's, or all), their task rows
 * in batches, and their schools. Each is one query shape on a recorded Supabase chain.
 */

const queries = [];
let answer = { data: [], error: null };

function mockChain(table) {
  const q = { table, ops: [] };
  queries.push(q);
  const proxy = new Proxy({}, {
    get(_, op) {
      if (op === 'then') return (ok, ko) => Promise.resolve(answer).then(ok, ko);
      return (...args) => { q.ops.push([op, ...args]); return proxy; };
    },
  });
  return proxy;
}

jest.mock('../../shared/config/supabase', () => ({ from: (t) => mockChain(t) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: () => {}, logError: () => {} }));

const store = require('../../shared/services/child-test/store');

beforeEach(() => { queries.length = 0; answer = { data: [], error: null }; });

describe('listSaSessions', () => {
  test("one coach's sessions of the mark, newest first, capped", async () => {
    answer = { data: [{ id: 's1' }], error: null };
    const out = await store.listSaSessions({ mark: 'sa-battery', coachUserId: 'u1' });
    expect(out).toEqual({ ok: true, sessions: [{ id: 's1' }] });
    const ops = queries[0].ops.map((o) => o[0]);
    expect(queries[0].table).toBe('child_test_sessions');
    expect(queries[0].ops).toContainEqual(['eq', 'item_bank_version', 'sa-battery']);
    expect(queries[0].ops).toContainEqual(['eq', 'coach_user_id', 'u1']);
    expect(ops).toContain('limit');
    expect(queries[0].ops.find((o) => o[0] === 'select')[1]).not.toMatch(/student_id|draw_id|\*/);
  });

  test('every coach only when the caller says allCoaches: then no coach filter', async () => {
    await store.listSaSessions({ mark: 'sa-battery', coachUserId: null, allCoaches: true });
    expect(queries[0].ops.some((o) => o[0] === 'eq' && o[1] === 'coach_user_id')).toBe(false);
  });

  test('no coach and no allCoaches: refused before any query (an empty user never reads every coach)', async () => {
    for (const coachUserId of [null, undefined, '']) {
      // eslint-disable-next-line no-await-in-loop
      expect(await store.listSaSessions({ mark: 'sa-battery', coachUserId })).toEqual({ ok: false, error: 'no_coach' });
    }
    expect(queries).toHaveLength(0);
  });

  test('an error is returned, never read as "no sessions"', async () => {
    answer = { data: null, error: { message: 'down' } };
    expect(await store.listSaSessions({ mark: 'sa-battery', coachUserId: 'u1' })).toEqual({ ok: false, error: 'down' });
  });
});

describe('listBlocksForSessions', () => {
  test('reads in batches of 100 session ids and joins the rows', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `s${i}`);
    answer = { data: [{ block: 'ur.words4' }], error: null };
    const out = await store.listBlocksForSessions(ids);
    expect(queries).toHaveLength(2);
    expect(queries.every((q) => q.table === 'child_test_blocks')).toBe(true);
    expect(queries[0].ops.find((o) => o[0] === 'in')[2]).toHaveLength(100);
    expect(queries[1].ops.find((o) => o[0] === 'in')[2]).toHaveLength(50);
    expect(out).toEqual({ ok: true, blocks: [{ block: 'ur.words4' }, { block: 'ur.words4' }] });
  });

  test('no ids: no query', async () => {
    expect(await store.listBlocksForSessions([])).toEqual({ ok: true, blocks: [] });
    expect(queries).toHaveLength(0);
  });
});

describe('getSchoolsByIds', () => {
  test('id, name and sub-region only', async () => {
    answer = { data: [{ id: 'sch-1', name: 'X', region: 'Nilore' }], error: null };
    const out = await store.getSchoolsByIds(['sch-1']);
    expect(out.schools).toHaveLength(1);
    expect(queries[0].table).toBe('schools');
    expect(queries[0].ops).toContainEqual(['select', 'id, name, region']);
  });
});
