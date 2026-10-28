'use strict';

/**
 * getUserNamesByIds (round 7b, the dashboard's coach filter): the coaches' users.name by id, read 100 ids at a time so
 * an admin's every-coach view never puts hundreds of ids in one request URL; a failed read is { ok: false }.
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
        const answer = ids.includes('boom') ? { data: null, error: { message: 'read failed' } }
          : { data: ids.map((id) => ({ id, name: `Coach ${id}` })), error: null };
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

test('every name, from users (id, name only), 100 ids per read', async () => {
  const ids = Array.from({ length: 230 }, (_, i) => `u${i}`);
  const out = await store.getUserNamesByIds(ids);
  expect(out.ok).toBe(true);
  expect(out.users).toHaveLength(230);
  expect(out.users[0]).toEqual({ id: 'u0', name: 'Coach u0' });
  expect(queries.map((q) => q.table)).toEqual(['users', 'users', 'users']);
  expect(queries[0].ops.find((o) => o[0] === 'select')[1]).toBe('id, name');
  expect(queries.map((q) => q.ops.find((o) => o[0] === 'in')[2].length)).toEqual([100, 100, 30]);
});

test('a failed read is ok: false, never a throw', async () => {
  const out = await store.getUserNamesByIds(['a', 'boom']);
  expect(out.ok).toBe(false);
});

test('no ids: no read', async () => {
  expect(await store.getUserNamesByIds([])).toEqual({ ok: true, users: [] });
  expect(queries).toHaveLength(0);
});
