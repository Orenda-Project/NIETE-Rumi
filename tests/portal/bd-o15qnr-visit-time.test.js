/**
 * bd-o15qnr.2 — the coach app v2 books a visit at any half hour from 7:00 AM to
 * 6:30 PM (three toggles: hour, :00/:30, AM/PM). The server stores 24-hour
 * "HH:MM". The three old portal slots stay valid, and nothing outside the
 * window or off the half hour is accepted. Create and edit share one rule.
 *
 * Readers already cope: the teacher notice and the calendar sync parse any
 * HH:MM, and the sandbox table already holds bot-written 09:30 / 10:00 / 12:00.
 */

const { isAllowedSlot, LEGACY_SLOTS } = require('../../dashboard/lib/visit-time');
const { createSchedule } = require('../../dashboard/services/leader-schedule-write.service');
const { editSchedule } = require('../../dashboard/services/leader-assignment.service');

// The value a column was inserted with, read from the INSERT's own column list,
// so the test holds whatever other columns the branch's INSERT carries
// (staging's has school_name; sandbox's did not).
const insertedValue = (call, column) => {
  const cols = call.sql.match(/\(([^)]*)\)\s*VALUES/)[1].split(',').map((s) => s.trim());
  const i = cols.indexOf(column);
  if (i < 0) throw new Error(`INSERT has no ${column} column`);
  return call.params[i];
};

const TODAY = '2026-10-06';

describe('isAllowedSlot', () => {
  test.each(['07:00', '07:30', '09:00', '09:30', '12:00', '13:30', '18:00', '18:30'])('%s is allowed', (s) => {
    expect(isAllowedSlot(s)).toBe(true);
  });

  // bd-o15qnr.8: any half hour of the day (the AM/PM flip can make 9:00 PM).
  test.each(['09:15', '9:00', '24:00', '07:45', 'morning', '', null, undefined, 930])('%p is refused', (s) => {
    expect(isAllowedSlot(s)).toBe(false);
  });

  test('the three old portal slots stay allowed', () => {
    expect(LEGACY_SLOTS).toEqual(['09:00', '11:30', '14:00']);
    for (const s of LEGACY_SLOTS) expect(isAllowedSlot(s)).toBe(true);
  });
});

/** A fake pg for createSchedule: the teacher is in the patch, no active visit yet. */
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

describe('createSchedule — any half hour in the window', () => {
  test('2:30 PM ("14:30") is booked and stored as given', async () => {
    const calls = [];
    const out = await createSchedule(createQuery(calls), 'coach-1',
      { teacherExtId: '923001112222', date: '2026-10-08', slot: '14:30' }, { today: TODAY });
    expect(out).toMatchObject({ id: 'new-1', updated: false });
    const insert = calls.find((c) => /INSERT INTO observation_schedules/.test(c.sql));
    expect(insertedValue(insert, 'scheduled_slot')).toBe('14:30');
  });

  test('an old slot still books', async () => {
    const out = await createSchedule(createQuery([]), 'coach-1',
      { teacherExtId: '923001112222', date: '2026-10-08', slot: '11:30' }, { today: TODAY });
    expect(out.id).toBe('new-1');
  });

  test.each(['09:15', '24:00', 'morning'])('%s is refused before any write', async (slot) => {
    const calls = [];
    await expect(createSchedule(createQuery(calls), 'coach-1',
      { teacherExtId: '923001112222', date: '2026-10-08', slot }, { today: TODAY })).rejects.toThrow('Unknown time slot');
    expect(calls).toHaveLength(0);
  });
});

/** A fake pg for editSchedule: one upcoming visit owned by coach-1. */
function editQuery(calls) {
  return async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT id, status, leader_user_id, scheduled_for, scheduled_slot FROM observation_schedules/.test(sql)) {
      return { rows: [{ id: 'v1', status: 'upcoming', leader_user_id: 'coach-1', scheduled_for: '2026-10-07', scheduled_slot: '09:00' }] };
    }
    if (/UPDATE observation_schedules/.test(sql)) return { rows: [{ id: 'v1', scheduled_for: params[2], scheduled_slot: params[3] }] };
    return { rows: [] };
  };
}

describe('editSchedule (Reschedule) — same rule', () => {
  test('moving a visit to 4:00 PM ("16:00") saves it', async () => {
    const calls = [];
    const out = await editSchedule(editQuery(calls), 'coach-1', 'v1', { date: '2026-10-09', slot: '16:00' }, { today: TODAY });
    expect(out).toMatchObject({ id: 'v1', slot: '16:00', changed: true });
  });

  test('7:15 PM (off the half hour) is refused before any write', async () => {
    const calls = [];
    await expect(editSchedule(editQuery(calls), 'coach-1', 'v1', { date: '2026-10-09', slot: '19:15' }, { today: TODAY }))
      .rejects.toThrow('Unknown time slot');
    expect(calls).toHaveLength(0);
  });
});
