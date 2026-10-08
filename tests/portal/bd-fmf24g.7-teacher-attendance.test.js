/**
 * bd-fmf24g.7 — teacher app v2: class attendance routes on the portal.
 *
 *   GET  /api/portal/teacher/attendance/classes[?date=]                 → her classes + that day's status
 *   GET  /api/portal/teacher/attendance/classes/:listId/roster          → children in roll order
 *   POST /api/portal/teacher/attendance/classes/:listId/mark            → { date, absentIds, leaveIds }
 *   GET  /api/portal/teacher/attendance/classes/:listId/day?date=       → each child's status that day
 *   GET  /api/portal/teacher/attendance/classes/:listId/month?month=    → per day + per child %
 *   GET  /api/portal/teacher/attendance/classes/:listId/register?month= → the .xlsx register
 *   POST /api/portal/teacher/attendance/classes/:listId/register/send   → { month } → sent on WhatsApp
 *
 * What the tests hold it to:
 *   - signed out is 401; portal_teacher_v2 off is 404 — and nothing is asked of the bot;
 *   - the teacher is ALWAYS the session's user (no user id is read from the request);
 *   - a malformed class id, date or month is 400 before the bot is asked;
 *   - the bot's answers map to HTTP: NOT_FOUND 404, BAD_DATE/BAD_MONTH 400, EMPTY_ROSTER 409;
 *   - a bot that cannot be reached is 502, never an empty answer;
 *   - the register comes back as an .xlsx attachment with its own file name.
 */

const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const LIST = '0b4e8f9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(method, path, { userId = TEACHER, query = {}, params = {}, body = {} } = {}) {
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

const ROUTES = [
  ['get', '/teacher/attendance/classes'],
  ['get', '/teacher/attendance/classes/:listId/roster'],
  ['post', '/teacher/attendance/classes/:listId/mark'],
  ['get', '/teacher/attendance/classes/:listId/day'],
  ['get', '/teacher/attendance/classes/:listId/month'],
  ['get', '/teacher/attendance/classes/:listId/register'],
  ['post', '/teacher/attendance/classes/:listId/register/send'],
];
const OK_ARGS = {
  params: { listId: LIST },
  query: { date: '2026-10-08', month: '2026-10' },
  body: { date: '2026-10-08', absentIds: [], leaveIds: [], month: '2026-10' },
};

let svc; let flagOn;
beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  flagOn = true;
  svc = {
    classes: jest.fn(async () => ({ date: '2026-10-08', classes: [] })),
    roster: jest.fn(async () => ({ listId: LIST, label: 'Grade 4 - A', students: [] })),
    mark: jest.fn(async () => ({ date: '2026-10-08', present: 30, absent: 2, leave: 0, replaced: false })),
    day: jest.fn(async () => ({ date: '2026-10-08', marked: false, statuses: {} })),
    month: jest.fn(async () => ({ month: '2026-10', days: [], students: [] })),
    registerFile: jest.fn(async () => ({ fileName: 'Grade 4 - A, October 2026.xlsx', base64: Buffer.from('xlsx').toString('base64') })),
    sendRegister: jest.fn(async () => ({ delivered: true })),
  };
  jest.doMock('../../dashboard/services/teacher-attendance.service', () => svc);
  jest.doMock('../../dashboard/config/supabase', () => ({}));
  jest.doMock('../../dashboard/lib/feature-flags', () => ({
    PORTAL_TEACHER_V2_KEY: 'portal_teacher_v2',
    isFlagEnabledForUser: jest.fn(async (_s, key) => key === 'portal_teacher_v2' && flagOn),
  }));
});
afterEach(() => { jest.restoreAllMocks(); });

const asked = () => Object.values(svc).some((fn) => fn.mock.calls.length > 0);

test.each(ROUTES)('%s %s signed out: 401, bot never asked', async (m, p) => {
  const { statusCode } = await invoke(m, p, { ...OK_ARGS, userId: null });
  expect(statusCode).toBe(401);
  expect(asked()).toBe(false);
});

test.each(ROUTES)('%s %s with portal_teacher_v2 off: 404, bot never asked', async (m, p) => {
  flagOn = false;
  const { statusCode } = await invoke(m, p, OK_ARGS);
  expect(statusCode).toBe(404);
  expect(asked()).toBe(false);
});

test.each(ROUTES.slice(1))('%s %s with a malformed class id: 400, bot never asked', async (m, p) => {
  const { statusCode } = await invoke(m, p, { ...OK_ARGS, params: { listId: 'nope' } });
  expect(statusCode).toBe(400);
  expect(asked()).toBe(false);
});

test('classes: the session\'s teacher, the date asked for (or today when none)', async () => {
  let r = await invoke('get', '/teacher/attendance/classes', { query: { date: '2026-10-07', userId: 'someone-else' } });
  expect(r.statusCode).toBe(200);
  expect(svc.classes).toHaveBeenCalledWith(TEACHER, '2026-10-07');
  expect(r.payload).toEqual({ success: true, date: '2026-10-08', classes: [] });
  r = await invoke('get', '/teacher/attendance/classes', { query: {} });
  expect(svc.classes).toHaveBeenLastCalledWith(TEACHER, null);
  r = await invoke('get', '/teacher/attendance/classes', { query: { date: '7 Oct' } });
  expect(r.statusCode).toBe(400);
});

test('mark: passes the date and only arrays of ids; bad dates never reach the bot', async () => {
  let r = await invoke('post', '/teacher/attendance/classes/:listId/mark', {
    params: { listId: LIST }, body: { date: '2026-10-08', absentIds: ['a', 'b'], leaveIds: ['c'], userId: 'someone-else' },
  });
  expect(r.statusCode).toBe(200);
  expect(svc.mark).toHaveBeenCalledWith(TEACHER, LIST, { date: '2026-10-08', absentIds: ['a', 'b'], leaveIds: ['c'] });
  expect(r.payload).toEqual({ success: true, date: '2026-10-08', present: 30, absent: 2, leave: 0, replaced: false });

  svc.mark.mockClear();
  r = await invoke('post', '/teacher/attendance/classes/:listId/mark', { params: { listId: LIST }, body: { date: 'today', absentIds: [] } });
  expect(r.statusCode).toBe(400);
  r = await invoke('post', '/teacher/attendance/classes/:listId/mark', { params: { listId: LIST }, body: { date: '2026-10-08', absentIds: 'a' } });
  expect(r.statusCode).toBe(400);
  expect(svc.mark).not.toHaveBeenCalled();
});

test.each([
  ['NOT_FOUND', 404], ['BAD_DATE', 400], ['BAD_MONTH', 400], ['EMPTY_ROSTER', 409],
])('the bot\'s %s is HTTP %i', async (code, status) => {
  svc.mark.mockResolvedValue({ code });
  const r = await invoke('post', '/teacher/attendance/classes/:listId/mark', OK_ARGS);
  expect(r.statusCode).toBe(status);
  expect(r.payload).toMatchObject({ success: false, code });
});

test('a bot that cannot be reached is 502, never an empty answer', async () => {
  svc.classes.mockRejectedValue(new Error('ECONNREFUSED'));
  const r = await invoke('get', '/teacher/attendance/classes', { query: {} });
  expect(r.statusCode).toBe(502);
  expect(r.payload.success).toBe(false);
});

test('day and month: the date / month asked for', async () => {
  await invoke('get', '/teacher/attendance/classes/:listId/day', { params: { listId: LIST }, query: { date: '2026-10-06' } });
  expect(svc.day).toHaveBeenCalledWith(TEACHER, LIST, '2026-10-06');
  await invoke('get', '/teacher/attendance/classes/:listId/month', { params: { listId: LIST }, query: { month: '2026-09' } });
  expect(svc.month).toHaveBeenCalledWith(TEACHER, LIST, '2026-09');
  const r = await invoke('get', '/teacher/attendance/classes/:listId/month', { params: { listId: LIST }, query: { month: 'Sep' } });
  expect(r.statusCode).toBe(400);
});

test('register: an .xlsx attachment named for the class and month', async () => {
  const r = await invoke('get', '/teacher/attendance/classes/:listId/register', { params: { listId: LIST }, query: { month: '2026-10' } });
  expect(svc.registerFile).toHaveBeenCalledWith(TEACHER, LIST, '2026-10');
  expect(r.statusCode).toBe(200);
  expect(r.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  expect(r.headers['content-disposition']).toContain('attachment;');
  expect(r.headers['content-disposition']).toContain(encodeURIComponent('Grade 4 - A, October 2026.xlsx'));
  expect(Buffer.isBuffer(r.sent)).toBe(true);
  expect(r.sent.toString()).toBe('xlsx');
});

test('register send: the existing WhatsApp delivery; a failed delivery is 502 with the reason', async () => {
  let r = await invoke('post', '/teacher/attendance/classes/:listId/register/send', { params: { listId: LIST }, body: { month: '2026-10' } });
  expect(svc.sendRegister).toHaveBeenCalledWith(TEACHER, LIST, '2026-10');
  expect(r.payload).toEqual({ success: true, delivered: true });
  svc.sendRegister.mockResolvedValue({ delivered: false, error: 'no_phone_number' });
  r = await invoke('post', '/teacher/attendance/classes/:listId/register/send', { params: { listId: LIST }, body: { month: '2026-10' } });
  expect(r.statusCode).toBe(502);
  expect(r.payload).toEqual({ success: false, delivered: false, error: 'no_phone_number' });
});
