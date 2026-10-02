/**
 * bd-5rz1v.6.5 — a teacher's own Analytics counts a coach's observation only
 * once the coach has SENT it to her.
 *
 * /my-analytics read every row of hers at completed OR observer_review_complete
 * — and observer_review_complete is the coach's saved draft, before any report
 * reached her. Measured read-only on NIETE production, 2026-10-02: 782 bound
 * observations at that stage were not sent, across 672 teachers — every one of
 * them feeding a teacher's charts. The rule is the one the Coaching pages use
 * (dashboard/lib/teacher-observation.js): an observation is hers once
 * analysis_data.teacher_delivery.status = 'sent'.
 *
 * The SQL runs in Postgres, so this pins the predicate on the query; the
 * predicate itself was run read-only against the sandbox database (PR body).
 */

let queries;

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) return layer.route.stack.map((s) => s.handle);
  }
  return null;
}

async function invoke(path, userId) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', path);
  const req = { session: { portalUserId: userId, id: 's1' }, params: {}, query: {}, method: 'GET', path, ip: '127.0.0.1', headers: {}, get: () => undefined };
  let statusCode = 200;
  const res = { status(c) { statusCode = c; return this; }, json() { return this; } };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (advanced === false) resolve();
    });
  }
  return statusCode;
}

beforeEach(() => {
  jest.resetModules();
  queries = [];
  jest.doMock('../../dashboard/config/database', () => ({
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/lesson_plans/.test(sql) && /assessment_papers/.test(sql)) return { rows: [{ lesson_plans: 0, exams: 0 }] };
      return { rows: [] };
    }),
  }));
  jest.doMock('../../dashboard/config/supabase', () => {
    const chain = {};
    ['select', 'eq', 'update', 'in'].forEach((m) => { chain[m] = () => chain; });
    chain.single = async () => ({ data: { id: 't1', role: 'teacher' }, error: null });
    chain.maybeSingle = chain.single;
    return { from: () => chain, rpc: jest.fn() };
  });
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});
afterEach(() => jest.resetModules());

test("her coaching rows exclude a coach's observation that has not been sent to her", async () => {
  expect(await invoke('/my-analytics', 't1')).toBe(200);
  const sessions = queries.find((q) => /FROM coaching_sessions/.test(q.sql));
  expect(sessions).toBeDefined();
  const { VISIBLE_TO_TEACHER_SQL } = require('../../dashboard/lib/teacher-observation');
  expect(sessions.sql).toContain(VISIBLE_TO_TEACHER_SQL);
});

test('the predicate is the Coaching pages\' rule: her own rows, or an observation the coach has sent her (delivered, or waiting for her tap)', () => {
  const { VISIBLE_TO_TEACHER_SQL } = require('../../dashboard/lib/teacher-observation');
  expect(VISIBLE_TO_TEACHER_SQL).toBe(
    "(observation_type IS NULL OR observation_type <> 'leader_observation' "
    + "OR analysis_data->'teacher_delivery'->>'status' IN ('sent', 'awaiting_teacher_tap'))",
  );
});
