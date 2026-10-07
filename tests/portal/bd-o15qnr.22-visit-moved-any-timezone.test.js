/**
 * bd-o15qnr.22 — "did the visit move?" must not depend on the server's timezone.
 *
 * node-postgres turns a DATE column into a Date at LOCAL midnight. The portal
 * then read it back with toISOString(), which is UTC: on a server running in
 * Asia/Karachi, 13 Oct became "2026-10-12", so saving a visit unchanged counted
 * as a move and the teacher was told her visit had moved to the time it already
 * had (seen live on sandbox, 2026-10-07). It was only right while the server ran
 * in UTC.
 *
 * Each timezone runs in its OWN node process with TZ set: assigning
 * process.env.TZ inside a Jest worker does not reach the real process, so a
 * same-process switch would silently test the machine's zone twice.
 *
 * The fake `query` answers the way pg does: a column read raw comes back as
 * node-postgres's DATE parser builds it (pg-types, type 1082: a date-only value
 * becomes `new Date(year, month - 1, day)`, LOCAL midnight); a column cast to
 * text comes back as the string. (`pg` lives in dashboard/node_modules, which
 * the root test job does not install, so the parser's one line is reproduced.)
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

// Runs in the child. Prints one JSON object of results.
const CHILD = `
const { createSchedule } = require('./dashboard/services/leader-schedule-write.service');
const { editSchedule } = require('./dashboard/services/leader-assignment.service');
const STORED = { date: '2026-10-13', slot: '09:00' };
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const asPg = (sql) => (/scheduled_for::text/.test(sql) ? STORED.date : parseDate(STORED.date));
const createQuery = async (sql) => {
  if (/FROM leader_schools/i.test(sql)) return { rows: [{ teacher_ext_id: '923990000001', teacher_name: 'B', school_ext_id: 'niete:8801', school_name: 'S' }] };
  if (/^\\s*SELECT/i.test(sql) && /observation_schedules/i.test(sql)) return { rows: [{ id: 'sch-1', scheduled_for: asPg(sql), scheduled_slot: STORED.slot }] };
  return { rows: [{ id: 'sch-1' }] };
};
const editQuery = async (sql) => {
  if (/^\\s*SELECT/i.test(sql)) return { rows: [{ id: 'sch-1', status: 'upcoming', leader_user_id: 'coach-1', scheduled_for: asPg(sql), scheduled_slot: STORED.slot }] };
  return { rows: [{ id: 'sch-1' }] };
};
const opts = { today: '2026-10-07' };
const book = (date, slot) => createSchedule(createQuery, 'coach-1', { teacherExtId: '923990000001', date, slot }, opts).then((r) => r.changed);
const edit = (date, slot) => editSchedule(editQuery, 'coach-1', 'sch-1', { date, slot }, opts).then((r) => r.changed);
(async () => {
  const out = {
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    bookSame: await book('2026-10-13', '09:00'),
    bookNextDay: await book('2026-10-14', '09:00'),
    editSame: await edit('2026-10-13', '09:00'),
    editOtherTime: await edit('2026-10-13', '10:30'),
    editNextDay: await edit('2026-10-14', '09:00'),
    // A Date that still arrives (a SELECT without the ::text cast) reads as the stored day.
    dayOfPgDate: require('./dashboard/lib/visit-time').storedDay(parseDate('2026-10-13')),
  };
  process.stdout.write(JSON.stringify(out));
})().catch((e) => { process.stderr.write(String(e && e.stack)); process.exit(1); });
`;

function runIn(tz) {
  const r = spawnSync(process.execPath, ['-e', CHILD], { cwd: ROOT, env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`child failed under ${tz}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

describe.each(['Asia/Karachi', 'UTC'])('a portal server running in %s', (tz) => {
  let out;
  beforeAll(() => { out = runIn(tz); });

  test('really runs in that zone', () => {
    expect(out.zone).toBe(tz);
  });

  test('booking the same day and time again is not a move', () => {
    expect(out.bookSame).toBe(false);
  });

  test('booking a different day is a move', () => {
    expect(out.bookNextDay).toBe(true);
  });

  test('Reschedule saved unchanged is not a move', () => {
    expect(out.editSame).toBe(false);
  });

  test("a pg DATE that arrives as a Date still reads as the stored day", () => {
    expect(out.dayOfPgDate).toBe('2026-10-13');
  });

  test('Reschedule to another time the same day, or the next day, is a move', () => {
    expect(out.editOtherTime).toBe(true);
    expect(out.editNextDay).toBe(true);
  });
});
