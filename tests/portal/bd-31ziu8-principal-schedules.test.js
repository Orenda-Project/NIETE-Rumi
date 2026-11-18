'use strict';
/**
 * bd-31ziu8 — principals book visits on the portal exactly as coaches do (operator 18 Nov ~16:40: "the principal does
 * not do scheduling? If that is the case, drop it. It has to be the same as coach.").
 *   - the booking's authorisation check (leader-schedule-write PATCH_SQL) takes a teacher of the principal's OWN school
 *     (users.school_id), keyed 'niete:' || emis as the principal app keys it, never the principal herself;
 *   - a principal on the principal app reads her own bookings (GET /coach/schedule rides observerReads, as the
 *     observation reads do), so the principal app's My schedule works.
 */
const fs = require('fs');
const path = require('path');
const { createSchedule } = require('../../dashboard/services/leader-schedule-write.service');

const stripComments = (sql) => sql.replace(/--[^\n]*/g, '');

describe('the booking check accepts a principal\'s own school', () => {
  test('one query, two branches: her leader_schools holdings, then her own school when she is a principal', async () => {
    const seen = [];
    const query = jest.fn(async (sql, params) => {
      seen.push({ sql, params });
      if (/FROM leader_schools/i.test(sql) && /users me/i.test(sql)) {
        return { rows: [{ teacher_user_id: 't1', teacher_ext_id: '900001', teacher_name: 'Ayesha', school_ext_id: 'niete:1126', school_name: 'GGPS Sample' }] };
      }
      if (/observation_schedules/i.test(sql) && /select/i.test(sql)) return { rows: [] };
      return { rows: [{ id: 'sched-1' }] };
    });
    const out = await createSchedule(query, 'principal-1', { teacherExtId: '900001', date: '2026-11-19', slot: '09:00' }, { today: '2026-11-18' });
    expect(out).toMatchObject({ id: 'sched-1' });
    const patch = stripComments(seen[0].sql);
    expect(patch).toMatch(/UNION ALL/);
    expect(patch).toMatch(/JOIN schools s\s+ON s\.id = me\.school_id/);
    expect(patch).toMatch(/lower\(btrim\(me\.role\)\) = 'principal'/);
    expect(patch).toMatch(/u\.id <> me\.id/);
    // keyed by EMIS, else by a coach's holding of that school (a no-EMIS school can still be booked)
    expect(patch).toMatch(/COALESCE\('niete:' \|\| s\.emis,\s+\(SELECT h\.school_ext_id FROM leader_schools h WHERE h\.school_id = s\.id/);
    expect(seen[0].params).toEqual(['principal-1', '900001']);
  });
});

describe('GET /coach/schedule admits a principal on the principal app', () => {
  test('the route rides observerReads (coach v2, or a principal the principal app names)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8');
    expect(src).toMatch(/router\.get\('\/coach\/schedule', \.\.\.observerReads,/);
    // the other coach-app reads are unchanged
    expect(src).toMatch(/router\.get\('\/coach\/people', \.\.\.coachV2,/);
  });
});
