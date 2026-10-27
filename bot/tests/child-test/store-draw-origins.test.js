'use strict';

/**
 * getSessionDrawOrigins (round 7b item 15): how each session's child came onto the list — its draw's algo_version and
 * seed_digest — by session id, 100 ids per read. The draw ids stay inside the store; the dashboard's session list
 * itself still never reads draw_id or student_id (store-sa-sessions.test.js).
 */

const queries = [];
function mockChain(table) {
  const q = { table, ops: [] };
  queries.push(q);
  const proxy = new Proxy({}, {
    get(_, op) {
      if (op === 'then') {
        const inOp = q.ops.find((o) => o[0] === 'in');
        const ids = inOp ? inOp[2] : [];
        let answer;
        if (ids.includes('boom')) answer = { data: null, error: { message: 'read failed' } };
        else if (table === 'child_test_sessions') answer = { data: ids.map((id) => ({ id, draw_id: id === 's-none' ? null : `d-${id}` })), error: null };
        else answer = { data: ids.map((id) => ({ id, algo_version: /-a/.test(id) ? 'ctd-added-on-spot-v1' : 'ctd-v1', seed_digest: /-a/.test(id) ? 'added' : 'x' })), error: null };
        return (ok, ko) => Promise.resolve(answer).then(ok, ko);
      }
      return (...args) => { q.ops.push([op, ...args]); return proxy; };
    },
  });
  return proxy;
}
jest.mock('../../shared/config/supabase', () => ({ from: (t) => mockChain(t) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: () => {}, logError: () => {} }));
const store = require('../../shared/services/child-test/store');

beforeEach(() => { queries.length = 0; });

test('sessions (id, draw_id) then their draws (id, algo_version, seed_digest), 100 ids per read; no draw id in the answer', async () => {
  const ids = [...Array.from({ length: 149 }, (_, i) => (i % 2 ? `s-a${i}` : `s-r${i}`)), 's-none'];
  const out = await store.getSessionDrawOrigins(ids);
  expect(out.ok).toBe(true);
  expect(out.origins).toHaveLength(149);
  expect(out.origins.find((o) => o.sessionId === 's-a1')).toEqual({ sessionId: 's-a1', algo_version: 'ctd-added-on-spot-v1', seed_digest: 'added' });
  expect(queries.map((q) => q.table)).toEqual(['child_test_sessions', 'child_test_sessions', 'child_test_draws', 'child_test_draws']);
  expect(queries[0].ops.find((o) => o[0] === 'select')[1]).toBe('id, draw_id');
  expect(queries[2].ops.find((o) => o[0] === 'select')[1]).toBe('id, algo_version, seed_digest');
  expect(JSON.stringify(out)).not.toMatch(/d-s-/);
});
test('a failed read is ok: false; no ids, no read', async () => {
  expect((await store.getSessionDrawOrigins(['boom'])).ok).toBe(false);
  queries.length = 0;
  expect(await store.getSessionDrawOrigins([])).toEqual({ ok: true, origins: [] });
  expect(queries).toHaveLength(0);
});
