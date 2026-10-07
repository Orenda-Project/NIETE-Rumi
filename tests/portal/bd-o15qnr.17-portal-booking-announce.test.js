/**
 * bd-o15qnr.17 — the portal half: every booking, move and cancel asks the bot to
 * announce it ONCE (the bot then invites the coach and tells the teacher through
 * the same function WhatsApp uses — tests/routes/bd-o15qnr.17-…). A past-dated
 * booking or move announces nothing (operator decision, bd-o15qnr.8).
 *
 * v2 New visit, Reschedule and Cancel and the old LeaderObservations page all
 * write through these three routes.
 */

jest.mock('axios', () => ({ post: jest.fn() }));

let announce;
let createResult;
let editResult;

function loadRoutes() {
  jest.resetModules();
  announce = jest.fn();
  jest.doMock('../../dashboard/config/supabase', () => ({ from: () => ({}), rpc: jest.fn() }));
  jest.doMock('../../dashboard/config/database', () => ({ query: jest.fn() }));
  jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  jest.doMock('../../dashboard/services/observe-notice.service', () => ({ notifyTeacher: announce }));
  jest.doMock('../../dashboard/services/leader-schedule-write.service', () => ({
    createSchedule: jest.fn(async () => createResult),
    cancelSchedule: jest.fn(async (_q, _l, id) => ({ id, cancelled: true })),
    SLOTS: [], validDate: () => true,
  }));
  const real = jest.requireActual('../../dashboard/services/leader-assignment.service');
  jest.doMock('../../dashboard/services/leader-assignment.service', () => ({ ...real, editSchedule: jest.fn(async () => editResult) }));
  return require('../../dashboard/routes/portal.routes');
}

async function post(path, body, params = {}) {
  const router = loadRoutes();
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods.post);
  const stack = layer.route.stack.map((s) => s.handle);
  const res = { status() { return this; }, json(b) { this.body = b; return this; } };
  await stack[stack.length - 1]({ body, params, session: { portalUserId: 'coach-1' } }, res);
  return res.body;
}

const book = (r) => { createResult = r; return post('/leader/schedules', { teacherExtId: '923990000101', date: '2026-10-08', slot: '09:30' }); };
const edit = (r) => { editResult = r; return post('/leader/schedules/:id/edit', { date: r.date, slot: r.slot }, { id: r.id }); };

describe('booking', () => {
  test('a new visit: announced once as "scheduled"', async () => {
    await book({ id: 'new-1', updated: false, changed: true, past: false });
    expect(announce.mock.calls).toEqual([[{ scheduleId: 'new-1', leaderUserId: 'coach-1', kind: 'scheduled', moved: true }]]);
  });

  test('re-booking her visit onto a new day: once as a real move', async () => {
    await book({ id: 'sch-1', updated: true, changed: true, past: false });
    expect(announce.mock.calls).toEqual([[{ scheduleId: 'sch-1', leaderUserId: 'coach-1', kind: 'rescheduled', moved: true }]]);
  });

  test('re-booking the same day and time: still announced (the invite is re-timed, as WhatsApp does) but not as a move', async () => {
    await book({ id: 'sch-1', updated: true, changed: false, past: false });
    expect(announce.mock.calls).toEqual([[{ scheduleId: 'sch-1', leaderUserId: 'coach-1', kind: 'rescheduled', moved: false }]]);
  });

  test('a past day: nothing', async () => {
    await book({ id: 'new-1', updated: false, changed: true, past: true });
    expect(announce).not.toHaveBeenCalled();
  });
});

describe('Reschedule', () => {
  test('a new day or time: once, as a real move', async () => {
    await edit({ id: 'v1', date: '2026-10-09', slot: '11:00', updated: true, changed: true, past: false });
    expect(announce.mock.calls).toEqual([[{ scheduleId: 'v1', leaderUserId: 'coach-1', kind: 'rescheduled', moved: true }]]);
  });

  test('saved unchanged: announced, not as a move', async () => {
    await edit({ id: 'v1', date: '2026-10-08', slot: '09:30', updated: true, changed: false, past: false });
    expect(announce.mock.calls).toEqual([[{ scheduleId: 'v1', leaderUserId: 'coach-1', kind: 'rescheduled', moved: false }]]);
  });

  test('moved into the past: nothing', async () => {
    await edit({ id: 'v1', date: '2026-10-01', slot: '09:30', updated: true, changed: true, past: true });
    expect(announce).not.toHaveBeenCalled();
  });
});

describe('Cancel', () => {
  test('announced once as "cancelled"', async () => {
    await post('/leader/schedules/:id/cancel', {}, { id: 'v1' });
    expect(announce.mock.calls).toEqual([[{ scheduleId: 'v1', leaderUserId: 'coach-1', kind: 'cancelled' }]]);
  });
});

describe('the client carries "moved" to the bot', () => {
  test('posted when given, left out when not', async () => {
    jest.resetModules();
    const axios = require('axios');
    axios.post.mockResolvedValue({ data: { success: true, sent: true } });
    process.env.MAIN_BOT_URL = 'http://bot.internal';
    process.env.INTERNAL_API_KEY = 'k';
    const Client = jest.requireActual('../../dashboard/services/observe-notice.service');
    await Client.notifyTeacher({ scheduleId: 's', leaderUserId: 'c', kind: 'rescheduled', moved: false });
    await Client.notifyTeacher({ scheduleId: 's', leaderUserId: 'c', kind: 'cancelled' });
    expect(axios.post.mock.calls.map((c) => c[1])).toEqual([
      { scheduleId: 's', leaderUserId: 'c', kind: 'rescheduled', moved: false },
      { scheduleId: 's', leaderUserId: 'c', kind: 'cancelled' },
    ]);
  });
});
