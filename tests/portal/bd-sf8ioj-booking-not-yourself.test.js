'use strict';
/**
 * bd-sf8ioj (queue #199) — booking a visit: the person booking is never in the teacher list.
 *
 * Production, 19 Nov (read-only): 64 real accounts can see themselves in the teacher list they book from, mostly
 * principals who hold their own school in leader_schools and so land in their own coach-app patch. One real
 * self-booking ever (a principal, 14 Sep, never run). The bot's WhatsApp picker has dropped the leader since 15 Sep
 * (leader-source `_teachers`, bd-o8nt4); the portal's coach app did not.
 *
 * The 15 Sep rule stands: the roster VIEW (People, Edit teacher) keeps her — "may I remove myself from my own roster
 * view" is a different question. So the coach app's rows say which one is her (`isSelf`), the booking screens leave
 * that row out (portal/src/portal/coach/pages/CoachNewVisit.tsx, CoachTeacher.tsx), and the server refuses a booking
 * of herself whatever is posted.
 */

const SVC = require('../../dashboard/services/coach-v2.service');
const { createSchedule } = require('../../dashboard/services/leader-schedule-write.service');

const ME = 'u-principal';
const HOLDINGS = [{ school_ext_id: 'niete:285', school_name: 'IMS (I-V) AIOU Colony', emis: '285', names_a_school: true }];
const row = (over) => ({
  teacher_ext_id: '920000000001', name: 'Teacher One', phone: '920000000001', school_ext_id: 'niete:285', role: 'teacher',
  rumi_user_id: 'u-1', coaching_sessions: 0, observations: 0, training_modules: 0, last_analysis_data: null,
  school_name: 'IMS (I-V) AIOU Colony', ...over,
});
const PATCH = [
  row({ teacher_ext_id: '920000000009', phone: '920000000009', name: 'The Principal Herself', role: 'principal', rumi_user_id: ME }),
  row(),
];
const query = async (sql) => {
  if (/FROM leader_schools lsch/.test(sql)) return { rows: PATCH };
  if (/FROM leader_schools/.test(sql)) return { rows: HOLDINGS };
  return { rows: [] };
};

describe('the coach app says which row is the person booking', () => {
  test('RED: People marks her own row isSelf, and only hers', async () => {
    const out = await SVC.getCoachPeople(query, ME, { today: '2026-11-20' });
    const byPhone = Object.fromEntries(out.teachers.map((t) => [t.teacherExtId, t.isSelf]));
    expect(byPhone).toEqual({ '920000000009': true, '920000000001': false });
  });

  test('the roster view keeps her (15 Sep rule): both rows are still returned', async () => {
    const out = await SVC.getCoachPeople(query, ME, { today: '2026-11-20' });
    expect(out.teachers).toHaveLength(2);
  });

  test('RED: her own Teacher page says isSelf (it hides Schedule a visit)', async () => {
    const out = await SVC.getCoachTeacher(query, ME, '920000000009', { today: '2026-11-20' });
    expect(out.teacher.isSelf).toBe(true);
    const other = await SVC.getCoachTeacher(query, ME, '920000000001', { today: '2026-11-20' });
    expect(other.teacher.isSelf).toBe(false);
  });
});

describe('the server never books a visit with the person booking', () => {
  const booking = (patchRow) => {
    const writes = [];
    const q = jest.fn(async (sql, params) => {
      if (/FROM leader_schools/i.test(sql) && /UNION ALL/i.test(sql)) return { rows: patchRow ? [patchRow] : [] };
      if (/^\s*SELECT/i.test(sql) && /observation_schedules/i.test(sql)) return { rows: [] };
      writes.push({ sql, params });
      return { rows: [{ id: 'sched-1' }] };
    });
    return { q, writes };
  };

  test('RED: her own number (she holds her own school) is refused, nothing written', async () => {
    const { q, writes } = booking({
      teacher_user_id: ME, teacher_ext_id: '920000000009', teacher_name: 'The Principal Herself',
      school_ext_id: 'niete:285', school_name: 'IMS (I-V) AIOU Colony',
    });
    await expect(createSchedule(q, ME, { teacherExtId: '920000000009', date: '2026-11-21', slot: '09:00' }, { today: '2026-11-20' }))
      .rejects.toThrow('You cannot book a visit with yourself');
    expect(writes).toEqual([]);
  });

  test('another teacher at the same school books as before', async () => {
    const { q, writes } = booking({
      teacher_user_id: 'u-1', teacher_ext_id: '920000000001', teacher_name: 'Teacher One',
      school_ext_id: 'niete:285', school_name: 'IMS (I-V) AIOU Colony',
    });
    const out = await createSchedule(q, ME, { teacherExtId: '920000000001', date: '2026-11-21', slot: '09:00' }, { today: '2026-11-20' });
    expect(out).toMatchObject({ id: 'sched-1', updated: false });
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toMatch(/INSERT INTO observation_schedules/);
  });
});
