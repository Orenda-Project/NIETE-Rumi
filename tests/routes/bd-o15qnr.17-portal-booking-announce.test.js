/**
 * bd-o15qnr.17 — a visit booked, moved or cancelled on the PORTAL tells people
 * exactly what the same action in WhatsApp /observe tells them:
 *
 *   · the coach's calendar invite (an email from Google Calendar —
 *     observe-calendar.service onScheduled / onRescheduled / onCancelled), and
 *   · the teacher's WhatsApp notice (observe-teacher-notice.service).
 *
 * Before: the portal reached only the teacher notice (POST
 * /api/internal/observe/notify-teacher called notifyTeacher directly), so a
 * coach who booked on the portal never got the invite a WhatsApp booking sends.
 *
 * Now both writers announce through ONE function, observe-schedule.service
 * `announce`: WhatsApp's saveSchedule / rescheduleById / cancelById, and the
 * internal route the portal calls. These tests run the REAL store and the REAL
 * route over one in-memory table, and record what reaches the two senders.
 */

const KEY = 'shared-secret-key';
const COACH = 'coach-1';

let table;
let calendar;
let notice;
let router;
let Store;

function fakeSupabase() {
  return {
    from: jest.fn(() => {
      const st = { op: 'select', filters: {}, patch: null, row: null };
      const matches = () => table.filter((r) => Object.entries(st.filters).every(([c, v]) => r[c] === v));
      const run = () => {
        if (st.op === 'insert') {
          const row = { id: `sch-${table.length + 1}`, calendar_event_id: null, ...st.row };
          table.push(row);
          return [row];
        }
        if (st.op === 'update') {
          const hit = matches();
          hit.forEach((r) => Object.assign(r, st.patch));
          return hit.map((r) => ({ ...r }));
        }
        return matches().map((r) => ({ ...r }));
      };
      const chain = {
        select: () => chain,
        insert: (row) => { st.op = 'insert'; st.row = row; return chain; },
        update: (patch) => { st.op = 'update'; st.patch = patch; return chain; },
        eq: (c, v) => { st.filters[c] = v; return chain; },
        order: () => chain,
        single: async () => ({ data: run()[0] || null, error: null }),
        maybeSingle: async () => ({ data: run()[0] || null, error: null }),
        then: (resolve, reject) => Promise.resolve({ data: run(), error: null }).then(resolve, reject),
      };
      return chain;
    }),
  };
}

function findRoute(r, method, path) {
  for (const layer of r.stack) {
    if (layer.route && layer.route.methods[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

/** The portal's call: what dashboard/services/observe-notice.service posts. */
async function portal(body) {
  const stack = findRoute(router, 'post', '/observe/notify-teacher');
  if (!stack) throw new Error('route POST /observe/notify-teacher not found');
  const req = { headers: { 'x-api-key': KEY }, body, ip: '127.0.0.1', method: 'POST', path: '/observe/notify-teacher' };
  const out = { status: 200, body: null };
  const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  for (const handler of stack) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res, () => { next = true; });
    if (!next) break;
  }
  return out;
}

// The fields the two senders read off a row (observe-calendar _gate/_buildEvent/
// _timing/_storeEventId; observe-teacher-notice notifyTeacher).
const READ = ['id', 'leader_user_id', 'teacher_ext_id', 'teacher_name', 'school_name', 'scheduled_for', 'scheduled_slot', 'calendar_event_id'];
const pick = (row) => Object.fromEntries(READ.map((k) => [k, row[k] === undefined ? null : row[k]]));

function calls() {
  return {
    calendar: Object.fromEntries(['onScheduled', 'onRescheduled', 'onCancelled']
      .map((h) => [h, calendar[h].mock.calls.map(([row]) => pick(row))])),
    notice: notice.mock.calls.map(([kind, row]) => [kind, pick(row)]),
  };
}
const reset = () => { [calendar.onScheduled, calendar.onRescheduled, calendar.onCancelled, notice].forEach((f) => f.mockClear()); };

const ROW = {
  leader_user_id: COACH, school_ext_id: 'niete:110', teacher_ext_id: '923990000101',
  teacher_name: 'Test Teacher', school_name: 'IMSG I-10/1',
  scheduled_for: '2026-10-08', scheduled_slot: '09:30', status: 'upcoming',
};
const BOOK = { school_ext_id: 'niete:110', teacher_ext_id: '923990000101', teacher_name: 'Test Teacher', school_name: 'IMSG I-10/1', date: '2026-10-08', slot: '09:30' };

beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  table = [];
  calendar = {
    onScheduled: jest.fn().mockResolvedValue(undefined),
    onRescheduled: jest.fn().mockResolvedValue(undefined),
    onCancelled: jest.fn().mockResolvedValue(undefined),
  };
  notice = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => fakeSupabase());
  jest.doMock('../../bot/shared/services/observe/observe-calendar.service', () => calendar);
  jest.doMock('../../bot/shared/services/observe/observe-teacher-notice.service', () => ({ notifyTeacher: notice }));
  router = require('../../bot/shared/routes/internal-api.routes');
  Store = require('../../bot/shared/services/observe/observe-schedule.service');
});

afterEach(() => {
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

describe('a portal booking: the coach is invited and the teacher told, once each', () => {
  test('scheduled → onScheduled + the "scheduled" notice, on the stored row', async () => {
    table.push({ id: 'sch-1', calendar_event_id: null, ...ROW });
    const out = await portal({ scheduleId: 'sch-1', leaderUserId: COACH, kind: 'scheduled' });
    expect(out).toEqual({ status: 200, body: { success: true, sent: true } });
    const c = calls();
    expect(c.calendar.onScheduled).toEqual([pick(table[0])]);
    expect(c.calendar.onRescheduled).toEqual([]);
    expect(c.notice).toEqual([['scheduled', pick(table[0])]]);
  });

  test('the same payload a WhatsApp booking hands the two senders', async () => {
    await Store.saveSchedule(COACH, BOOK);
    const whatsapp = calls();
    reset();
    await portal({ scheduleId: table[0].id, leaderUserId: COACH, kind: 'scheduled' });
    expect(calls()).toEqual(whatsapp);
  });
});

describe('a portal move: the same as WhatsApp', () => {
  test('a real move: the invite is re-timed (keeping its event) and the teacher told — as rescheduleById', async () => {
    table.push({ id: 'sch-1', ...ROW, calendar_event_id: 'evt-1' });
    await Store.rescheduleById(COACH, 'sch-1', '2026-10-09', '11:00');
    const whatsapp = calls();
    reset();
    await portal({ scheduleId: 'sch-1', leaderUserId: COACH, kind: 'rescheduled', moved: true });
    expect(calls()).toEqual(whatsapp);
    expect(whatsapp.calendar.onRescheduled[0]).toMatchObject({ calendar_event_id: 'evt-1', scheduled_for: '2026-10-09' });
    expect(whatsapp.notice).toHaveLength(1);
  });

  test('the same day and time again: the invite is re-timed, the teacher is NOT told — as saveSchedule', async () => {
    table.push({ id: 'sch-1', ...ROW, calendar_event_id: 'evt-1' });
    await Store.saveSchedule(COACH, BOOK);
    const whatsapp = calls();
    reset();
    await portal({ scheduleId: 'sch-1', leaderUserId: COACH, kind: 'rescheduled', moved: false });
    expect(calls()).toEqual(whatsapp);
    expect(whatsapp.calendar.onRescheduled).toHaveLength(1);
    expect(whatsapp.notice).toEqual([]);
  });
});

describe('a portal cancel: the same as WhatsApp', () => {
  test('the invite it owns is removed and the teacher told — as cancelById', async () => {
    table.push({ id: 'sch-1', ...ROW, calendar_event_id: 'evt-1' });
    await Store.cancelById(COACH, 'sch-1');
    const whatsapp = calls();
    reset();
    // The portal's own writer cancels the row first (leader-schedule-write cancelSchedule).
    table[0].status = 'cancelled';
    await portal({ scheduleId: 'sch-1', leaderUserId: COACH, kind: 'cancelled' });
    expect(calls()).toEqual(whatsapp);
    expect(whatsapp.calendar.onCancelled).toEqual([expect.objectContaining({ calendar_event_id: 'evt-1' })]);
    expect(whatsapp.notice.map(([k]) => k)).toEqual(['cancelled']);
  });
});

describe('the guards stay', () => {
  test("another coach's schedule: 404, nobody is invited or told", async () => {
    table.push({ id: 'sch-1', calendar_event_id: null, ...ROW });
    const out = await portal({ scheduleId: 'sch-1', leaderUserId: 'coach-2', kind: 'scheduled' });
    expect(out.status).toBe(404);
    const c = calls();
    expect([...c.calendar.onScheduled, ...c.notice]).toEqual([]);
  });
});
