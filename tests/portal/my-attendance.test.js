/**
 * GET /my-attendance — the Attendance page, opened to a teacher (operator,
 * 2026-09-30: "we should open the attendance page for them").
 *
 * It is the principal's attendance detail scoped to ONE person, the signed-in
 * teacher: her own classes' registers and her own days. The scope comes from
 * the session, never from the request — a teacher cannot ask for anyone else.
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
    session: userId ? { portalUserId: userId, id: 's1' } : null,
    params: {}, query, method: 'GET', path, ip: '127.0.0.1', headers: {}, get: () => undefined,
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

const STUDENT_ROWS = [
  { date: '2026-09-08', group: 'Grade 4', total: 30, present: 27 },
  { date: '2026-09-09', group: 'Grade 4', total: 30, present: 25 },
];
const STAFF_ROWS = [
  { date: '2026-09-08', group: 'Ayesha', total: 1, present: 1, status: 'present' },
  { date: '2026-09-09', group: 'Ayesha', total: 1, present: 0, status: 'absent' },
  { date: '2026-09-10', group: 'Ayesha', total: 1, present: 0, status: 'leave' },
];

beforeEach(() => {
  jest.resetModules();
  queries = [];
  jest.doMock('../../dashboard/config/database', () => ({
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/FROM attendance_sessions/.test(sql)) return { rows: STUDENT_ROWS };
      if (/FROM teacher_attendance_records/.test(sql)) return { rows: STAFF_ROWS };
      return { rows: [] };
    }),
  }));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => jest.resetModules());

describe('GET /my-attendance', () => {
  test('needs a signed-in portal user', async () => {
    const { statusCode } = await invoke('/my-attendance', {});
    expect(statusCode).toBe(401);
  });

  test("reads ONLY the signed-in teacher's registers and days", async () => {
    await invoke('/my-attendance', { userId: 'u-ayesha', query: { from: '2026-09-01', to: '2026-09-30' } });
    const att = queries.filter((q) => /attendance_sessions|teacher_attendance_records/.test(q.sql));
    expect(att).toHaveLength(2);
    for (const q of att) {
      expect(q.params[0]).toEqual(['u-ayesha']);
      expect(q.params.slice(1)).toEqual(['2026-09-01', '2026-09-30']);
    }
  });

  test('ignores a teacherId in the request — the scope is the session', async () => {
    await invoke('/my-attendance', { userId: 'u-ayesha', query: { teacherId: 'someone-else' } });
    for (const q of queries) {
      expect(JSON.stringify(q.params || [])).not.toContain('someone-else');
    }
  });

  test('returns the same shapes as the principal page: her classes and her own row', async () => {
    const { statusCode, payload } = await invoke('/my-attendance', {
      userId: 'u-ayesha', query: { from: '2026-09-01', to: '2026-09-30' },
    });
    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.teachers).toEqual([]);
    expect(payload.schoolDays).toEqual(['2026-09-08', '2026-09-09', '2026-09-10']);
    expect(payload.students.groups.map((g) => g.name)).toEqual(['Grade 4']);
    const me = payload.staff.groups[0];
    expect(me.name).toBe('Ayesha');
    // Leave is neither attendance nor absence.
    expect(me.present).toBe(1);
    expect(me.absent).toBe(1);
    expect(payload.staff.byDay[0].days).toHaveLength(3);
  });
});
