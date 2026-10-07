/**
 * bd-o15qnr.23 — "today" for a visit is the day in Asia/Karachi.
 *
 * The portal took today as the UTC date (new Date().toISOString().slice(0, 10)).
 * Pakistan is UTC+5, so from 00:00 to 05:00 PKT the server still thought it was
 * yesterday: a booking for yesterday was not "past" (so the teacher was told
 * about a visit that had already gone), and a visit left from yesterday was not
 * yet "overdue".
 *
 * The clock is fixed at 02:00 PKT on Thu 8 Oct 2026 (21:00 UTC on the 7th). Each
 * server timezone runs in its OWN node process with TZ set — assigning TZ inside
 * a Jest worker never reaches the real process.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const AT = '2026-10-07T21:00:00Z'; // 02:00 PKT, 8 Oct

const CHILD = `
const FIXED = Date.parse(${JSON.stringify(AT)});
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); }
  static now() { return FIXED; }
};
const { createSchedule } = require('./dashboard/services/leader-schedule-write.service');
const { editSchedule } = require('./dashboard/services/leader-assignment.service');
const CoachV2 = require('./dashboard/services/coach-v2.service');
const { getLeaderObservations } = require('./dashboard/services/leader-observations.service');

const bookQuery = async (sql) => {
  if (/FROM leader_schools/i.test(sql)) return { rows: [{ teacher_ext_id: '923990000001', teacher_name: 'B', school_ext_id: 'niete:8801', school_name: 'S' }] };
  if (/^\\s*SELECT/i.test(sql)) return { rows: [] };
  return { rows: [{ id: 'new-1' }] };
};
const editQuery = async (sql) => {
  if (/^\\s*SELECT/i.test(sql)) return { rows: [{ id: 'v1', status: 'upcoming', leader_user_id: 'coach-1', scheduled_for: '2026-10-09', scheduled_slot: '09:00' }] };
  return { rows: [{ id: 'v1' }] };
};
const visit = (id, day) => ({ id, leader_user_id: 'coach-1', teacher_name: 'T', school_name: 'S', school_ext_id: 'niete:1', teacher_ext_id: '9239900000' + id, scheduled_for: day, scheduled_slot: '09:00', status: 'upcoming', session_id: null });
const ROWS = [visit('01', '2026-10-07'), visit('02', '2026-10-08')];
let todayParam = null;
const scheduleQuery = async (sql, params) => {
  if (sql === CoachV2.SQL.MY_SCHEDULES) { todayParam = params[3]; return { rows: ROWS }; }
  return { rows: [] };
};
const oldPageQuery = async (sql) => (/observation_schedules/i.test(sql) ? { rows: ROWS } : { rows: [] });

(async () => {
  const booked = await createSchedule(bookQuery, 'coach-1', { teacherExtId: '923990000001', date: '2026-10-07', slot: '09:00' });
  const bookedToday = await createSchedule(bookQuery, 'coach-1', { teacherExtId: '923990000001', date: '2026-10-08', slot: '09:00' });
  const moved = await editSchedule(editQuery, 'coach-1', 'v1', { date: '2026-10-07', slot: '09:00' });
  const schedule = await CoachV2.getCoachSchedule(scheduleQuery, 'coach-1');
  const old = await getLeaderObservations(oldPageQuery, 'coach-1');
  process.stdout.write(JSON.stringify({
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    bookYesterdayPast: booked.past,
    bookTodayPast: bookedToday.past,
    moveToYesterdayPast: moved.past,
    scheduleToday: todayParam,
    overdueIds: schedule.overdue.map((v) => v.id),
    oldPageOverdue: (old.upcoming || []).filter((v) => v.overdue).map((v) => v.id),
  }));
})().catch((e) => { process.stderr.write(String(e && e.stack)); process.exit(1); });
`;

function runIn(tz) {
  const r = spawnSync(process.execPath, ['-e', CHILD], { cwd: ROOT, env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`child failed under ${tz}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

describe.each(['Asia/Karachi', 'UTC'])('02:00 PKT on 8 Oct, server in %s', (tz) => {
  let out;
  beforeAll(() => { out = runIn(tz); });

  test('really runs in that zone', () => {
    expect(out.zone).toBe(tz);
  });

  test('a booking for yesterday (7 Oct) is past — the route sends nothing', () => {
    expect(out.bookYesterdayPast).toBe(true);
  });

  test('a booking for today (8 Oct) is not past', () => {
    expect(out.bookTodayPast).toBe(false);
  });

  test('a visit moved to yesterday is past', () => {
    expect(out.moveToYesterdayPast).toBe(true);
  });

  test("v2 My schedule: today is 8 Oct, and yesterday's upcoming visit is overdue", () => {
    expect(out.scheduleToday).toBe('2026-10-08');
    expect(out.overdueIds).toEqual(['01']);
  });

  test("the old Observations page agrees: yesterday's visit is overdue, today's is not", () => {
    expect(out.oldPageOverdue).toEqual(['01']);
  });
});
