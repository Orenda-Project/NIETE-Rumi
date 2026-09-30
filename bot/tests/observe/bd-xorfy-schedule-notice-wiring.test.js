/**
 * bd-xorfy — the three lifecycle points that tell the teacher. TDD, red-first.
 *
 * Same shape as bd-dk6hy-schedule-calendar-wiring: the store is the one place
 * that knows a visit was booked, moved or cancelled, so it is the one place that
 * notifies. What this pins: exactly one notice per real change, on the right
 * row, and a notice failure never changes what the store returns.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

jest.mock('../../shared/services/observe/observe-calendar.service', () => ({
  onScheduled: jest.fn().mockResolvedValue(undefined),
  onRescheduled: jest.fn().mockResolvedValue(undefined),
  onCancelled: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../shared/services/observe/observe-teacher-notice.service', () => ({
  notifyTeacher: jest.fn().mockResolvedValue(true),
}));

const db = { active: null, affected: [{ id: 'sch-1' }], inserted: { id: 'sch-new' } };

jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn(() => {
    const state = { op: 'select', patch: null };
    const chain = {
      select: () => chain,
      insert: (row) => { state.op = 'insert'; state.row = row; return chain; },
      update: (patch) => { state.op = 'update'; state.patch = patch; return chain; },
      order: () => chain,
      single: async () => ({ data: { ...db.inserted, ...(state.row || {}) }, error: null }),
      eq: () => chain,
      then: (resolve) => resolve(
        state.op === 'update'
          ? { data: db.affected, error: null }
          : { data: db.active ? [db.active] : [], error: null }
      ),
    };
    return chain;
  }),
}));

const Notice = require('../../shared/services/observe/observe-teacher-notice.service');
const Store = require('../../shared/services/observe/observe-schedule.service');

const COACH = 'coach-1';
const activeRow = (over = {}) => ({
  id: 'sch-1',
  leader_user_id: COACH,
  school_ext_id: 's1',
  teacher_ext_id: '923001234567',
  teacher_name: 'A Teacher',
  school_name: 'A School',
  scheduled_for: '2026-09-01',
  scheduled_slot: '09:30',
  status: 'upcoming',
  calendar_event_id: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  db.active = null;
  db.affected = [{ id: 'sch-1' }];
});

describe('bd-xorfy — each lifecycle point tells the teacher once', () => {
  it('a new booking sends "scheduled", once', async () => {
    await Store.saveSchedule(COACH, {
      school_ext_id: 's1', teacher_ext_id: '923001234567', teacher_name: 'A Teacher',
      school_name: 'A School', date: '2026-09-01', slot: '09:30',
    });
    expect(Notice.notifyTeacher).toHaveBeenCalledTimes(1);
    const [kind, row] = Notice.notifyTeacher.mock.calls[0];
    expect(kind).toBe('scheduled');
    expect(row.teacher_ext_id).toBe('923001234567');
    expect(row.scheduled_for).toBe('2026-09-01');
  });

  it('re-saving to a NEW date sends "rescheduled" with the new date', async () => {
    db.active = activeRow();
    await Store.saveSchedule(COACH, {
      school_ext_id: 's1', teacher_ext_id: '923001234567', date: '2026-09-08', slot: '11:00',
    });
    expect(Notice.notifyTeacher).toHaveBeenCalledTimes(1);
    const [kind, row] = Notice.notifyTeacher.mock.calls[0];
    expect(kind).toBe('rescheduled');
    expect(row.scheduled_for).toBe('2026-09-08');
    expect(row.scheduled_slot).toBe('11:00');
  });

  it('re-saving the SAME date and slot sends nothing — no spam for a no-op', async () => {
    db.active = activeRow();
    await Store.saveSchedule(COACH, {
      school_ext_id: 's1', teacher_ext_id: '923001234567', date: '2026-09-01', slot: '09:30',
    });
    expect(Notice.notifyTeacher).not.toHaveBeenCalled();
  });

  it('rescheduleById sends "rescheduled" on the updated row', async () => {
    db.affected = [activeRow({ scheduled_for: '2026-09-08', scheduled_slot: '11:00' })];
    await Store.rescheduleById(COACH, 'sch-1', '2026-09-08', '11:00');
    expect(Notice.notifyTeacher).toHaveBeenCalledTimes(1);
    expect(Notice.notifyTeacher.mock.calls[0][0]).toBe('rescheduled');
    expect(Notice.notifyTeacher.mock.calls[0][1].teacher_ext_id).toBe('923001234567');
  });

  it('cancelById sends "cancelled" on the cancelled row', async () => {
    db.affected = [activeRow()];
    await Store.cancelById(COACH, 'sch-1');
    expect(Notice.notifyTeacher).toHaveBeenCalledTimes(1);
    expect(Notice.notifyTeacher.mock.calls[0][0]).toBe('cancelled');
    expect(Notice.notifyTeacher.mock.calls[0][1].teacher_ext_id).toBe('923001234567');
  });

  it('a cancel that matched nothing tells nobody', async () => {
    db.affected = [];
    await Store.cancelById(COACH, 'sch-x');
    expect(Notice.notifyTeacher).not.toHaveBeenCalled();
  });

  it('a notice that throws never changes what the store returns', async () => {
    Notice.notifyTeacher.mockRejectedValueOnce(new Error('boom'));
    db.affected = [activeRow()];
    await expect(Store.cancelById(COACH, 'sch-1')).resolves.toBe(true);
  });
});
