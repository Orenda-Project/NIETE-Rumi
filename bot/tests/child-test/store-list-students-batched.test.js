'use strict';

/**
 * listStudents at a big school: the day list hands it every enrolled child's id (444, 456, 640 at real schools). One
 * `.in('id', ids)` puts every id in the request URL, and past ~300 ids the request dies as "TypeError: fetch failed",
 * so the coach's child list never loads. The mock below fails exactly like that, so the test drives the real function.
 */

const queries = [];
const URL_LIMIT_IDS = 300;

function mockChain(table) {
  const q = { table, ops: [] };
  queries.push(q);
  const proxy = new Proxy({}, {
    get(_, op) {
      if (op === 'then') {
        const inOp = q.ops.find((o) => o[0] === 'in');
        const ids = inOp ? inOp[2] : [];
        const answer = ids.length > URL_LIMIT_IDS || ids.includes('boom')
          ? { data: null, error: { message: 'TypeError: fetch failed' } }
          : { data: ids.map((id) => ({ id, student_name: `Child ${id}`, is_active: true })), error: null };
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

const ids = (n, prefix = 'st') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('listStudents at a school with hundreds of children', () => {
  test.each([444, 456, 640])('%i children: every child comes back, no request carries more than 100 ids', async (n) => {
    const out = await store.listStudents(ids(n));
    expect(out.ok).toBe(true);
    expect(out.students).toHaveLength(n);
    expect(new Set(out.students.map((s) => s.id)).size).toBe(n);
    expect(queries.every((q) => q.table === 'students')).toBe(true);
    expect(queries.every((q) => q.ops.find((o) => o[0] === 'in')[2].length <= 100)).toBe(true);
    expect(queries).toHaveLength(Math.ceil(n / 100));
  });

  test('a repeated id is read once', async () => {
    const out = await store.listStudents([...ids(150), ...ids(150)]);
    expect(out.students).toHaveLength(150);
    expect(queries).toHaveLength(2);
  });

  test('a failing batch fails the whole read, never a partial list', async () => {
    const out = await store.listStudents([...ids(150), 'boom', ...ids(100, 'late')]);
    expect(out.ok).toBe(false);
    expect(out.students).toBeUndefined();
  });

  test('no ids: no request', async () => {
    expect(await store.listStudents([])).toEqual({ ok: true, students: [] });
    expect(queries).toHaveLength(0);
  });
});
