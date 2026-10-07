/**
 * bd-o15qnr.20 — operator: "Check if the lesson plan engagement feature is live.
 * If so, the Teacher Profile card should also show Exams Generated and Lesson
 * Plans opened."
 *
 * It is live on sandbox (lp-activity.service, bd-5rz1v.15: niete_lp_opens for
 * portal opens, niete_lp_downloads / niete_lp612_deliveries for WhatsApp; rows
 * written this week). So the Teacher page and the Visit page carry, for that one
 * teacher:
 *   lpOpened        distinct plans she used — lp-activity's OWN ACTIVITY_CTE,
 *                   all time, the definition the teacher Home's count uses
 *   examsGenerated  the patch's exams_generated (ready assessment papers)
 * Nothing new is stored; the list pages do not run the plan query.
 */

const SVC = require('../../dashboard/services/coach-v2.service');
const LpActivity = require('../../dashboard/services/lp-activity.service');
const { PATCH_TEACHERS_SQL } = require('../../dashboard/services/leader-patch.service');

const ME = 'coach-me';
const TODAY = '2026-10-07';

const PATCH = [
  { teacher_ext_id: '923001110001', name: 'Ayesha Bibi', phone: '923001110001', school_ext_id: 'niete:110', role: 'teacher',
    rumi_user_id: 'u-ayesha', coaching_sessions: 7, observations: 3, training_modules: 4, exams_generated: 5, lesson_plans: 9, school_name: 'IMSG I-10/1' },
  { teacher_ext_id: 'sadaf-khan', name: 'Sadaf Khan', phone: null, school_ext_id: 'niete:110', role: 'teacher',
    rumi_user_id: null, coaching_sessions: 0, observations: 0, training_modules: 0, exams_generated: 0, lesson_plans: 0, school_name: 'IMSG I-10/1' },
];

function fake() {
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params });
    const S = SVC.SQL;
    if (sql === PATCH_TEACHERS_SQL) return { rows: PATCH };
    if (S.LP_OPENED && sql === S.LP_OPENED) return { rows: [{ n: params[0] === 'u-ayesha' ? 12 : 0 }] };
    if (sql === S.SCHEDULE_BY_ID) {
      return { rows: [{ id: 'v1', leader_user_id: ME, teacher_name: 'Ayesha Bibi', school_name: 'IMSG I-10/1', school_ext_id: 'niete:110',
        teacher_ext_id: params[0] === 'v-off' ? 'sadaf-khan' : '923001110001', scheduled_for: TODAY, scheduled_slot: '11:30', status: 'upcoming', session_id: null }] };
    }
    return { rows: [] };
  };
  q.calls = calls;
  return q;
}

test('LP_OPENED is lp-activity\'s own ACTIVITY_CTE, counted by distinct plan', () => {
  expect(SVC.SQL.LP_OPENED).toContain(LpActivity.ACTIVITY_CTE);
  expect(SVC.SQL.LP_OPENED).toMatch(/count\(DISTINCT kind \|\| ':' \|\| ref\)/);
});

test('Teacher page: exams generated and lesson plans opened (all time) for her', async () => {
  const q = fake();
  const out = await SVC.getCoachTeacher(q, ME, '923001110001', { today: TODAY });
  expect(out.teacher).toMatchObject({ examsGenerated: 5, lpOpened: 12 });
  const call = q.calls.find((c) => c.sql === SVC.SQL.LP_OPENED);
  expect(call.params).toEqual(['u-ayesha', null, null]);
});

test('Visit page: the same two numbers on the teacher card', async () => {
  const out = await SVC.getCoachVisit(fake(), ME, 'v1', { today: TODAY });
  expect(out.teacher).toMatchObject({ examsGenerated: 5, lpOpened: 12 });
});

test('a teacher not on Rumi: no plan query, lpOpened null', async () => {
  const q = fake();
  const out = await SVC.getCoachTeacher(q, ME, 'sadaf-khan', { today: TODAY });
  expect(out.teacher.lpOpened).toBeNull();
  expect(q.calls.some((c) => c.sql === SVC.SQL.LP_OPENED)).toBe(false);
});

test('the lists do not run it (one query per opened teacher, never per row)', async () => {
  const q = fake();
  await SVC.getCoachPeople(q, ME, { today: TODAY });
  expect(q.calls.some((c) => c.sql === SVC.SQL.LP_OPENED)).toBe(false);
});
