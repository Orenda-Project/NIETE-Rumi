/**
 * The Analytics page takes a date window, on both profiles (operator,
 * 2026-09-30): ?from=&to= narrows every part of the page — observations,
 * attendance, remarks and the lesson-plan / exam counts. Blank means all time,
 * which is what the page showed before.
 */

let queries;

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(path, { userId, query = {} }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', path);
  if (!stack) throw new Error(`Route GET ${path} not found`);
  const req = {
    session: { portalUserId: userId, id: 's1' }, params: {}, query,
    method: 'GET', path, ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  let statusCode = 200; let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
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
  return { statusCode, payload };
}

// Every table the Analytics page reads, the column it is dated by, and whether
// that column is a timestamp (read as a Pakistan-time day) or already a date
// (compared as-is: a plain date put through AT TIME ZONE can shift a day).
const DATED = [
  [/FROM coaching_sessions/, 'created_at', true],
  [/FROM teacher_attendance_records/, 'date', false],
  [/FROM attendance_sessions/, 'session_date', false],
  [/FROM supervisor_remarks/, 'submitted_at', true],
  [/FROM lesson_plans/, 'created_at', true],
  [/FROM assessment_papers/, 'created_at', true],
];

beforeEach(() => {
  jest.resetModules();
  queries = [];
  jest.doMock('../../dashboard/config/database', () => ({
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/lesson_plans/.test(sql) && /assessment_papers/.test(sql)) return { rows: [{ lesson_plans: 4, exams: 2 }] };
      return { rows: [] };
    }),
  }));
  jest.doMock('../../dashboard/config/supabase', () => {
    const chain = {};
    ['select', 'eq', 'update', 'in'].forEach((m) => { chain[m] = () => chain; });
    chain.single = async () => ({ data: { id: 'p1', role: 'principal' }, error: null });
    chain.maybeSingle = chain.single;
    return { from: () => chain, rpc: jest.fn() };
  });
  jest.doMock('../../dashboard/services/leader-patch.service', () => {
    const real = jest.requireActual('../../dashboard/services/leader-patch.service');
    return {
      ...real,
      getPatchTeachers: jest.fn(async () => [
        { rumiUserId: 't1', name: 'Ayesha', schoolName: 'S', onRumi: true, lessonPlans: 40, examsGenerated: 9 },
      ]),
    };
  });
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => jest.resetModules());

describe.each([
  ['teacher', '/my-analytics', 't1'],
  ['principal', '/leader/school-analytics', 'p1'],
])('Analytics date window — %s', (_who, path, userId) => {
  test('a window reaches every dated query, in Pakistan time', async () => {
    const { statusCode } = await invoke(path, { userId, query: { from: '2026-09-01', to: '2026-09-30' } });
    expect(statusCode).toBe(200);
    for (const [table, col, stamp] of DATED) {
      const q = queries.find((x) => table.test(x.sql));
      expect(q).toBeDefined();
      expect(q.params).toEqual(expect.arrayContaining(['2026-09-01', '2026-09-30']));
      if (stamp) expect(q.sql).toMatch(new RegExp(`${col} AT TIME ZONE 'Asia/Karachi'\\)::date >=`));
      else expect(q.sql).toMatch(new RegExp(`\\b${col} >= \\$\\d+::date`));
    }
  });

  test('no window is all time', async () => {
    await invoke(path, { userId });
    for (const [table] of DATED) {
      const q = queries.find((x) => table.test(x.sql));
      expect(q.params).not.toEqual(expect.arrayContaining(['2026-09-01']));
      expect(q.params.filter((p) => p === null).length).toBeGreaterThanOrEqual(2);
    }
  });

  test('a malformed date is ignored, not passed to SQL', async () => {
    await invoke(path, { userId, query: { from: "2026-09-01'; drop", to: 'yesterday' } });
    for (const q of queries) expect(JSON.stringify(q.params || [])).not.toMatch(/drop|yesterday/);
  });

  test('echoes the window it applied', async () => {
    const { payload } = await invoke(path, { userId, query: { from: '2026-09-01' } });
    expect(payload.range).toEqual({ from: '2026-09-01', to: null });
  });
});

test('the principal\'s lesson plans and exams are counted IN the window', async () => {
  const { payload } = await invoke('/leader/school-analytics', { userId: 'p1', query: { from: '2026-09-01', to: '2026-09-30' } });
  expect(payload.school.totalLessonPlans).toBe(4);
  expect(payload.school.totalExams).toBe(2);
});
