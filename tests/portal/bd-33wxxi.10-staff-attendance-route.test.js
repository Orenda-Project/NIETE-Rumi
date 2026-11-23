/**
 * bd-33wxxi.10 — the principal's TEACHER register on the portal's class-attendance routes (listId "staff").
 *
 * The routes are the gate: only a principal (lib/teacher-app isPrincipalHomeUser — users.role principal; since
 * bd-33wxxi.11 every principal, no switch) may name "staff", and only for her the
 * routes tell the bot the staff register is allowed ({ staff: true }). Anyone else naming "staff" is 404 before
 * the bot is asked; a teacher's calls reach the bot exactly as before (no extra argument).
 */

const PRINCIPAL = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const TEACHER = '1a2b3c4d-0b8d-4c55-9a51-2d7f0e3b9c10';
const LIST = '0b4e8f9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(method, path, { userId = PRINCIPAL, query = {}, params = {}, body = {} } = {}) {
  const router = require('../../dashboard/routes/portal-teacher-attendance.routes');
  const stack = findRoute(router, method, path);
  if (!stack) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  const req = {
    session: userId ? { portalUserId: userId } : null, query, params, body,
    method: method.toUpperCase(), path, headers: {}, get: () => undefined,
  };
  let statusCode = 200; let payload = null; let sent = null; const headers = {};
  const res = {
    status(c) { statusCode = c; return this; },
    json(b) { payload = b; return this; },
    setHeader(k, v) { headers[k.toLowerCase()] = v; return this; },
    send(b) { sent = b; return this; },
  };
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
  return { statusCode, payload, sent, headers };
}

const STAFF_ROUTES = [
  ['get', '/teacher/attendance/classes/:listId/roster', { query: {} }],
  ['post', '/teacher/attendance/classes/:listId/mark', { body: { date: '2026-10-08', absentIds: [], leaveIds: [] } }],
  ['get', '/teacher/attendance/classes/:listId/day', { query: { date: '2026-10-08' } }],
  ['get', '/teacher/attendance/classes/:listId/month', { query: { month: '2026-10' } }],
  ['get', '/teacher/attendance/classes/:listId/register', { query: { month: '2026-10' } }],
  ['post', '/teacher/attendance/classes/:listId/register/send', { body: { month: '2026-10' } }],
];

let svc; let users; let principalSwitch;
beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  // The teacher app is on for both (the principal through the principal app); the principal switch names PRINCIPAL.
  users = { [PRINCIPAL]: { role: 'principal', school_id: 'school-1' }, [TEACHER]: { role: 'teacher', school_id: 'school-1' } };
  principalSwitch = [PRINCIPAL];
  svc = {
    classes: jest.fn(async () => ({ date: '2026-10-08', classes: [] })),
    roster: jest.fn(async () => ({ listId: 'staff', label: 'GGPS Sample', students: [] })),
    mark: jest.fn(async () => ({ date: '2026-10-08', present: 7, absent: 1, leave: 0, replaced: false })),
    day: jest.fn(async () => ({ date: '2026-10-08', marked: false, statuses: {} })),
    month: jest.fn(async () => ({ month: '2026-10', days: [], students: [] })),
    registerFile: jest.fn(async () => ({ fileName: 'Teacher_Attendance_GGPS_Sample_October_2026.xlsx', base64: Buffer.from('xlsx').toString('base64') })),
    sendRegister: jest.fn(async () => ({ delivered: true })),
    withNames: jest.fn((classes) => classes),
  };
  jest.doMock('../../dashboard/services/teacher-attendance.service', () => svc);
  jest.doMock('../../dashboard/config/database', () => ({ query: jest.fn() }));
  jest.doMock('../../dashboard/services/grade-subjects.service', () => ({ defaultDeps: () => ({ language: async () => 'en' }) }));
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: () => {
      let id = null;
      const q = {
        select: () => q,
        eq: (_c, v) => { id = v; return q; },
        maybeSingle: async () => ({ data: users[id] || null, error: null }),
      };
      return q;
    },
  }));
  jest.doMock('../../dashboard/lib/feature-flags', () => ({
    PORTAL_TEACHER_V2_KEY: 'portal_teacher_v2',
    PORTAL_PRINCIPAL_APP_KEY: 'portal_principal_app',
    isFlagEnabledForUser: jest.fn(async (_s, key, userId) => (key === 'portal_teacher_v2' && userId === TEACHER)
      || (key === 'portal_principal_app' && principalSwitch.includes(userId))),
  }));
});
afterEach(() => { jest.restoreAllMocks(); });

const asked = () => Object.entries(svc).some(([k, fn]) => k !== 'withNames' && fn.mock.calls.length > 0);

test('classes: for a principal on the principal app the bot is told the staff register is allowed', async () => {
  const r = await invoke('get', '/teacher/attendance/classes', { query: {} });
  expect(r.statusCode).toBe(200);
  expect(svc.classes).toHaveBeenCalledWith(PRINCIPAL, null, { staff: true });
});

test('classes: for a teacher, exactly as before (no staff, no extra argument)', async () => {
  await invoke('get', '/teacher/attendance/classes', { userId: TEACHER, query: { date: '2026-10-07' } });
  expect(svc.classes).toHaveBeenCalledWith(TEACHER, '2026-10-07');
  expect(svc.classes.mock.calls[0]).toHaveLength(2);
});

test.each(STAFF_ROUTES)('%s %s for "staff": the principal reaches the bot with staff allowed', async (m, p, args) => {
  const r = await invoke(m, p, { params: { listId: 'staff' }, ...args });
  expect(r.statusCode).toBe(200);
  const name = { roster: 'roster', mark: 'mark', day: 'day', month: 'month', register: 'registerFile', send: 'sendRegister' }[
    p.endsWith('/send') ? 'send' : p.split('/').pop()];
  const call = svc[name].mock.calls[0];
  expect(call[0]).toBe(PRINCIPAL);
  expect(call[1]).toBe('staff');
  expect(call[call.length - 1]).toEqual({ staff: true });
});

test.each(STAFF_ROUTES)('%s %s for "staff" by a teacher: 404, the bot never asked', async (m, p, args) => {
  const r = await invoke(m, p, { userId: TEACHER, params: { listId: 'staff' }, ...args });
  expect(r.statusCode).toBe(404);
  expect(asked()).toBe(false);
});

// bd-33wxxi.11 (queue #236, option B): the staff register is part of every principal's Home (her Attendance tile), so
// the principal app's switch (now observing only) no longer decides it.
test.each(STAFF_ROUTES)('%s %s for "staff" by a principal the principal app is NOT on for: the bot is asked, staff allowed', async (m, p, args) => {
  principalSwitch = [];
  users[PRINCIPAL] = { role: 'principal', school_id: 'school-1' };
  const r = await invoke(m, p, { params: { listId: 'staff' }, ...args });
  expect(r.statusCode).toBe(200);
  expect(asked()).toBe(true);
});

test('a teacher on the principal switch list (role teacher) cannot name "staff"', async () => {
  principalSwitch = [TEACHER];
  const r = await invoke('get', '/teacher/attendance/classes/:listId/roster', { userId: TEACHER, params: { listId: 'staff' } });
  expect(r.statusCode).toBe(404);
  expect(asked()).toBe(false);
});

test('her class is still her class: a uuid list reaches the bot as before, other names stay 400', async () => {
  let r = await invoke('get', '/teacher/attendance/classes/:listId/roster', { params: { listId: LIST } });
  expect(r.statusCode).toBe(200);
  expect(svc.roster).toHaveBeenCalledWith(PRINCIPAL, LIST);
  r = await invoke('get', '/teacher/attendance/classes/:listId/roster', { params: { listId: 'Staff' } });
  expect(r.statusCode).toBe(400);
  r = await invoke('get', '/teacher/attendance/classes/:listId/roster', { params: { listId: 'teachers' } });
  expect(r.statusCode).toBe(400);
});

test('the staff register downloads as the teacher register file', async () => {
  const r = await invoke('get', '/teacher/attendance/classes/:listId/register', { params: { listId: 'staff' }, query: { month: '2026-10' } });
  expect(r.statusCode).toBe(200);
  expect(r.headers['content-disposition']).toContain(encodeURIComponent('Teacher_Attendance_GGPS_Sample_October_2026.xlsx'));
});

describe('the dashboard\'s bot client passes the flag through only when it is set', () => {
  test('staff: true in the body for the staff register; nothing extra otherwise', async () => {
    jest.resetModules();
    jest.dontMock('../../dashboard/services/teacher-attendance.service');
    const posts = [];
    jest.doMock('axios', () => ({ post: jest.fn(async (url, body) => { posts.push({ url, body }); return { status: 200, data: { success: true } }; }) }));
    process.env.MAIN_BOT_URL = 'http://bot.test';
    process.env.INTERNAL_API_KEY = 'k';
    const real = require('../../dashboard/services/teacher-attendance.service');
    await real.classes(PRINCIPAL, null, { staff: true });
    await real.mark(PRINCIPAL, 'staff', { date: '2026-10-08', absentIds: [], leaveIds: [] }, { staff: true });
    await real.classes(TEACHER, null);
    await real.roster(TEACHER, LIST);
    expect(posts.map((p) => p.body)).toEqual([
      { userId: PRINCIPAL, date: null, staff: true },
      { userId: PRINCIPAL, listId: 'staff', date: '2026-10-08', absentIds: [], leaveIds: [], staff: true },
      { userId: TEACHER, date: null },
      { userId: TEACHER, listId: LIST },
    ]);
  });
});
