/**
 * bd-dk6hy — the three lifecycle points that own an invite. TDD, red-first.
 *
 * A visit is scheduled, moved, or cancelled. Each of those has exactly one
 * calendar consequence, and the store is the only place that knows all three
 * happened — the Flow endpoint, the recovery sweep and the portal all go through
 * it.
 *
 * What this file pins is the WIRING, not the calendar behaviour (that is
 * bd-dk6hy-calendar-invites): each point fires exactly one call, on the right
 * schedule row, and — the property that matters most — a calendar failure never
 * changes what the store returns. The coach's visit is saved either way.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

jest.mock('../../shared/services/observe/observe-calendar.service', () => ({
  onScheduled: jest.fn().mockResolvedValue(undefined),
  onRescheduled: jest.fn().mockResolvedValue(undefined),
  onCancelled: jest.fn().mockResolvedValue(undefined),
}));

// A tiny observation_schedules stand-in: `db.active` is the current upcoming row
// (null = none), `db.affected` is what an update reports back.
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
      // Awaiting the chain resolves it: a select yields the active row, an
      // update yields the affected rows.
      then: (resolve) => resolve(
        state.op === 'update'
          ? { data: db.affected, error: null }
          : { data: db.active ? [db.active] : [], error: null }
      ),
    };
    return chain;
  }),
}));

const Calendar = require('../../shared/services/observe/observe-calendar.service');
const Store = require('../../shared/services/observe/observe-schedule.service');

const COACH = 'coach-1';
const activeRow = (over = {}) => ({
  id: 'sch-1',
  leader_user_id: COACH,
  school_ext_id: 's1',
  teacher_ext_id: 't1',
  teacher_name: 'A Teacher',
  school_name: 'A School',
  scheduled_for: '2026-09-01',
  scheduled_slot: '09:30',
  status: 'upcoming',
  calendar_event_id: 'evt-1',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  db.active = null;
  db.affected = [{ id: 'sch-1' }];
});

describe('bd-dk6hy — each lifecycle point fires exactly one calendar call', () => {
  it('a new schedule creates an invite, once', async () => {
    await Store.saveSchedule(COACH, {
      school_ext_id: 's1', teacher_ext_id: 't1', teacher_name: 'A Teacher',
      school_name: 'A School', date: '2026-09-01', slot: '09:30',
    });
    expect(Calendar.onScheduled).toHaveBeenCalledTimes(1);
    expect(Calendar.onRescheduled).not.toHaveBeenCalled();
    expect(Calendar.onCancelled).not.toHaveBeenCalled();
  });

  it('re-saving over an existing upcoming visit MOVES it — it does not create a second', async () => {
    // saveSchedule is upsert-shaped: the picker re-uses it to change a date.
    // Creating here would leave the coach with two invites for one visit.
    db.active = activeRow();
    await Store.saveSchedule(COACH, {
      school_ext_id: 's1', teacher_ext_id: 't1', date: '2026-09-08', slot: '11:00',
    });
    expect(Calendar.onRescheduled).toHaveBeenCalledTimes(1);
    expect(Calendar.onScheduled).not.toHaveBeenCalled();
    const [row] = Calendar.onRescheduled.mock.calls[0];
    expect(row.calendar_event_id).toBe('evt-1');
    expect(row.scheduled_for).toBe('2026-09-08');
  });

  it('rescheduleById moves the invite, once', async () => {
    db.active = activeRow();
    // The real `.select()` returns the row AS UPDATED — the fake must too.
    db.affected = [activeRow({ scheduled_for: '2026-09-08', scheduled_slot: '11:00' })];
    await Store.rescheduleById(COACH, 'sch-1', '2026-09-08', '11:00');
    expect(Calendar.onRescheduled).toHaveBeenCalledTimes(1);
    const [row] = Calendar.onRescheduled.mock.calls[0];
    expect(row.id).toBe('sch-1');
    expect(row.scheduled_for).toBe('2026-09-08');
    expect(row.scheduled_slot).toBe('11:00');
  });

  it('cancelById deletes the invite, once', async () => {
    db.affected = [activeRow()];
    await Store.cancelById(COACH, 'sch-1');
    expect(Calendar.onCancelled).toHaveBeenCalledTimes(1);
    expect(Calendar.onCancelled.mock.calls[0][0].calendar_event_id).toBe('evt-1');
  });

  it('a cancel that matched nothing touches no calendar', async () => {
    // Wrong coach, or a row already 'done' — the guard that protects the record
    // of who was observed must also stop us deleting someone else's invite.
    db.affected = [];
    expect(await Store.cancelById(COACH, 'sch-1')).toBe(false);
    expect(Calendar.onCancelled).not.toHaveBeenCalled();
  });

  it('a double-cancel does not throw and does not call twice', async () => {
    db.affected = [activeRow()];
    await Store.cancelById(COACH, 'sch-1');
    db.affected = [];
    await expect(Store.cancelById(COACH, 'sch-1')).resolves.toBe(false);
    expect(Calendar.onCancelled).toHaveBeenCalledTimes(1);
  });

  it('a reschedule that matched nothing touches no calendar', async () => {
    db.affected = [];
    expect(await Store.rescheduleById(COACH, 'sch-1', '2026-09-08', '11:00')).toBe(false);
    expect(Calendar.onRescheduled).not.toHaveBeenCalled();
  });
});

describe('bd-dk6hy — the invite can fail; the scheduling cannot', () => {
  it('still saves the schedule when the calendar throws', async () => {
    Calendar.onScheduled.mockRejectedValueOnce(new Error('google down'));
    await expect(Store.saveSchedule(COACH, {
      school_ext_id: 's1', teacher_ext_id: 't1', date: '2026-09-01', slot: '09:30',
    })).resolves.toBeTruthy();
  });

  it('still reports a successful cancel when the calendar throws', async () => {
    db.affected = [activeRow()];
    Calendar.onCancelled.mockRejectedValueOnce(new Error('google down'));
    await expect(Store.cancelById(COACH, 'sch-1')).resolves.toBe(true);
  });

  it('still reports a successful reschedule when the calendar throws', async () => {
    db.affected = [activeRow()];
    Calendar.onRescheduled.mockRejectedValueOnce(new Error('google down'));
    await expect(Store.rescheduleById(COACH, 'sch-1', '2026-09-08', '11:00')).resolves.toBe(true);
  });
});
