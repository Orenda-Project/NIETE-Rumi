'use strict';

/** The review store (V1.7.4 child_test_sa_item_reviews): one session's rows, and a reviewer's mark as an upsert. */

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

const store = require('../../shared/services/child-test/sa/review-store');

beforeEach(() => { queries.length = 0; answer = { data: [], error: null }; });

test("listItemReviews: one session's rows, no other columns", async () => {
  answer = { data: [{ item_key: '1' }], error: null };
  expect(await store.listItemReviews('s1')).toEqual({ ok: true, reviews: [{ item_key: '1' }] });
  expect(queries[0].table).toBe('child_test_sa_item_reviews');
  expect(queries[0].ops).toContainEqual(['eq', 'session_id', 's1']);
});

test("saveItemReview: an upsert on (session, task, item) of the mark, note, who and when only — never the agents' column", async () => {
  await store.saveItemReview({ sessionId: 's1', taskId: 'ur.words4', itemKey: '2', mark: 'wrong', note: null, reviewedBy: 'u1', reviewedAt: '2026-10-23T09:00:00Z' });
  const [op, row, opts] = queries[0].ops[0];
  expect(op).toBe('upsert');
  expect(row).toEqual({ session_id: 's1', task_id: 'ur.words4', item_key: '2', mark: 'wrong', note: null, reviewed_by: 'u1', reviewed_at: '2026-10-23T09:00:00Z', updated_at: '2026-10-23T09:00:00Z' });
  expect(opts).toEqual({ onConflict: 'session_id,task_id,item_key' });
});

test('an error is returned, never read as success', async () => {
  answer = { data: null, error: { message: 'down' } };
  expect(await store.listItemReviews('s1')).toEqual({ ok: false, error: 'down' });
  expect(await store.saveItemReview({ sessionId: 's1', taskId: 't.x', itemKey: '1' })).toEqual({ ok: false, error: 'down' });
});
