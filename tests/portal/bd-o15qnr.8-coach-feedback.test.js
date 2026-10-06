/**
 * bd-o15qnr.8 — coach app v2, operator feedback round 1 (server side).
 *
 * (2) "allow coaches to schedule one in the past as well": booking and
 *     Reschedule accept a date before today. A past-dated visit is a record of
 *     a visit that already happened, so the teacher gets no WhatsApp notice for
 *     it. WhatsApp /observe has its own writer (observe-schedule.service, with
 *     the Flow's min_date) and does not share this path.
 * (3) "AM and PM warning can be removed": the picker's AM/PM flip can make any
 *     half hour of the day, so the server accepts any HH:00 / HH:30. The three
 *     old slots stay valid; off-the-half-hour times are still refused.
 * (5) "show whichever one the next is, even if it is not today": home.next is
 *     her next upcoming visit on or after today, whatever its date.
 */

const { createSchedule } = require('../../dashboard/services/leader-schedule-write.service');
const { editSchedule } = require('../../dashboard/services/leader-assignment.service');
const { isAllowedSlot } = require('../../dashboard/lib/visit-time');
const SVC = require('../../dashboard/services/coach-v2.service');

const TODAY = '2026-10-06';

function createQuery(calls) {
  return async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM leader_schools/.test(sql)) {
      return { rows: [{ teacher_ext_id: '923001112222', teacher_name: 'Sadia Noor', school_ext_id: 'niete:509', school_name: 'IMCB G-9/4' }] };
    }
    if (/INSERT INTO observation_schedules/.test(sql)) return { rows: [{ id: 'new-1' }] };
    return { rows: [] };
  };
}

function editQuery(calls) {
  return async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT id, status, leader_user_id, scheduled_for, scheduled_slot FROM observation_schedules/.test(sql)) {
      return { rows: [{ id: 'v1', status: 'upcoming', leader_user_id: 'coach-1', scheduled_for: '2026-10-07', scheduled_slot: '09:00' }] };
    }
    if (/UPDATE observation_schedules/.test(sql)) return { rows: [{ id: 'v1' }] };
    return { rows: [] };
  };
}

describe('(2) a visit can be booked in the past', () => {
  test('createSchedule books last Friday and says it is past', async () => {
    const calls = [];
    const out = await createSchedule(createQuery(calls), 'coach-1',
      { teacherExtId: '923001112222', date: '2026-10-02', slot: '09:00' }, { today: TODAY });
    expect(out).toMatchObject({ id: 'new-1', past: true });
    const insert = calls.find((c) => /INSERT INTO observation_schedules/.test(c.sql));
    expect(insert.params[5]).toBe('2026-10-02');
  });

  test('today and later are not past', async () => {
    const a = await createSchedule(createQuery([]), 'coach-1',
      { teacherExtId: '923001112222', date: TODAY, slot: '09:00' }, { today: TODAY });
    const b = await createSchedule(createQuery([]), 'coach-1',
      { teacherExtId: '923001112222', date: '2026-10-08', slot: '09:00' }, { today: TODAY });
    expect(a.past).toBe(false);
    expect(b.past).toBe(false);
  });

  test('editSchedule moves a visit to a past day', async () => {
    const calls = [];
    const out = await editSchedule(editQuery(calls), 'coach-1', 'v1', { date: '2026-10-01', slot: '11:30' }, { today: TODAY });
    expect(out).toMatchObject({ id: 'v1', date: '2026-10-01', past: true, changed: true });
  });

  test('a malformed date is still refused', async () => {
    await expect(createSchedule(createQuery([]), 'coach-1',
      { teacherExtId: '923001112222', date: '02-10-2026', slot: '09:00' }, { today: TODAY })).rejects.toThrow(/date/i);
  });
});

describe('(2) the teacher is not told about a past-dated visit', () => {
  let notify;
  let createResult;
  let editResult;

  function loadRoutes() {
    jest.resetModules();
    notify = jest.fn();
    jest.doMock('../../dashboard/config/supabase', () => ({ from: () => ({}), rpc: jest.fn() }));
    jest.doMock('../../dashboard/config/database', () => ({ query: jest.fn() }));
    jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
    jest.doMock('../../dashboard/services/r2.service', () => ({
      generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
    }));
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
    jest.doMock('../../dashboard/services/observe-notice.service', () => ({ notifyTeacher: notify }));
    jest.doMock('../../dashboard/services/leader-schedule-write.service', () => ({
      createSchedule: jest.fn(async () => createResult), cancelSchedule: jest.fn(), SLOTS: [], validDate: () => true,
    }));
    const real = jest.requireActual('../../dashboard/services/leader-assignment.service');
    jest.doMock('../../dashboard/services/leader-assignment.service', () => ({ ...real, editSchedule: jest.fn(async () => editResult) }));
    return require('../../dashboard/routes/portal.routes');
  }

  function handlerOf(router, path) {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods.post);
    const stack = layer.route.stack.map((s) => s.handle);
    return stack[stack.length - 1];
  }

  async function post(path, body, params = {}) {
    const router = loadRoutes();
    const res = { status() { return this; }, json(b) { this.body = b; return this; } };
    await handlerOf(router, path)({ body, params, session: { portalUserId: 'coach-1' } }, res);
    return res.body;
  }

  test('booking last Friday: saved, no notice', async () => {
    createResult = { id: 'new-1', updated: false, changed: true, past: true };
    const body = await post('/leader/schedules', { teacherExtId: '923001112222', date: '2026-10-02', slot: '09:00' });
    expect(body).toMatchObject({ success: true, id: 'new-1' });
    expect(notify).not.toHaveBeenCalled();
  });

  test('booking Thursday still notifies', async () => {
    createResult = { id: 'new-2', updated: false, changed: true, past: false };
    await post('/leader/schedules', { teacherExtId: '923001112222', date: '2026-10-08', slot: '09:00' });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ scheduleId: 'new-2', kind: 'scheduled' }));
  });

  test('moving a visit into the past: saved, no notice', async () => {
    editResult = { id: 'v1', date: '2026-10-01', slot: '11:30', updated: true, changed: true, past: true };
    const body = await post('/leader/schedules/:id/edit', { date: '2026-10-01', slot: '11:30' }, { id: 'v1' });
    expect(body).toMatchObject({ success: true, id: 'v1' });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('(3) any half hour the picker can make is a valid time', () => {
  test.each(['00:00', '05:30', '06:30', '19:00', '21:30', '23:30'])('%s is allowed', (s) => {
    expect(isAllowedSlot(s)).toBe(true);
  });

  test.each(['09:15', '9:00', '24:00', '25:00', 'evening', '', null])('%p is still refused', (s) => {
    expect(isAllowedSlot(s)).toBe(false);
  });

  test('9:00 PM books', async () => {
    const out = await createSchedule(createQuery([]), 'coach-1',
      { teacherExtId: '923001112222', date: '2026-10-08', slot: '21:00' }, { today: TODAY });
    expect(out.id).toBe('new-1');
  });
});

describe('(5) home.next — her next upcoming visit, whatever the date', () => {
  function homeQuery(nextRows) {
    const calls = [];
    const q = async (sql, params) => {
      calls.push({ sql, params });
      if (SVC.SQL.NEXT_VISIT && sql === SVC.SQL.NEXT_VISIT) return { rows: nextRows };
      return { rows: [] };
    };
    q.calls = calls;
    return q;
  }

  test('nothing today, Thursday 8 Oct next: next is Thursday', async () => {
    const q = homeQuery([{
      id: 'thu', leader_user_id: 'coach-1', teacher_name: 'Ayesha Bibi', school_name: 'IMSG I-10/1',
      school_ext_id: 'niete:110', teacher_ext_id: '923001110001', scheduled_for: '2026-10-08', scheduled_slot: '09:00',
      status: 'upcoming', session_id: null,
    }]);
    const home = await SVC.getCoachHome(q, 'coach-1', { today: TODAY });
    expect(home.today).toEqual([]);
    expect(home.next).toMatchObject({ id: 'thu', teacherName: 'Ayesha Bibi', scheduledFor: '2026-10-08', scheduledSlot: '09:00' });
    const call = q.calls.find((c) => c.sql === SVC.SQL.NEXT_VISIT);
    expect(call.params).toEqual(['coach-1', TODAY]);
  });

  test('the query asks for upcoming visits on or after today, soonest first, one row', () => {
    const sql = SVC.SQL.NEXT_VISIT;
    expect(sql).toMatch(/status = 'upcoming'/);
    expect(sql).toMatch(/scheduled_for >= \$2::date/);
    expect(sql).toMatch(/ORDER BY scheduled_for ASC, scheduled_slot ASC/);
    expect(sql).toMatch(/LIMIT 1/);
    expect(sql).toMatch(/scheduled_for::text/);
  });

  test('no upcoming visit: next is null', async () => {
    const home = await SVC.getCoachHome(homeQuery([]), 'coach-1', { today: TODAY });
    expect(home.next).toBeNull();
  });
});
