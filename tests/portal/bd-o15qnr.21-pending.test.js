/**
 * bd-o15qnr.21 — operator: "There should be a banner at the top at all times
 * showing if there are reports pending on the coach, e.g. in Talk step or Draft
 * step." The count is Home's own waiting rule (Feedback Form = draft, Debrief =
 * talk) over the existing COACH_SESSIONS query — no new SQL — plus the ids, so
 * one waiting observation can open straight away.
 */
const SVC = require('../../dashboard/services/coach-v2.service');

const ME = 'coach-me';
const S = (id, status, debrief, at) => ({ id, user_id: 'u1', created_at: at, status, debrief_status: debrief, audio_url: null, analysis_data: null,
  teacher_name: 'T', teacher_phone: null, sched_teacher_name: null, sched_school_name: null, sched_school_ext_id: null, sched_teacher_ext_id: null });

function fake(rows) {
  const calls = [];
  const q = async (sql, params) => { calls.push({ sql, params }); return { rows: sql === SVC.SQL.COACH_SESSIONS ? rows : [] }; };
  q.calls = calls;
  return q;
}

test('counts what waits on her — Feedback Form and Debrief — newest first, with their ids', async () => {
  const q = fake([
    S('a', 'awaiting_observer_review', 'pending', '2026-10-07T05:00:00Z'),
    S('b', 'observer_review_complete', 'pending', '2026-10-06T05:00:00Z'),
    S('c', 'transcribing', 'pending', '2026-10-06T04:00:00Z'),
    S('d', 'observer_review_complete', 'done', '2026-10-05T05:00:00Z'),
    S('e', 'failed', 'pending', '2026-10-05T04:00:00Z'),
  ]);
  const out = await SVC.getCoachPending(q, ME);
  expect(out).toEqual({ waiting: 2, ids: ['a', 'b'] });
  expect(q.calls.map((c) => c.sql)).toEqual([SVC.SQL.COACH_SESSIONS]);
  expect(q.calls[0].params).toEqual([ME]);
});

test('nothing waiting: zero and no ids', async () => {
  expect(await SVC.getCoachPending(fake([S('c', 'transcribing', 'pending', '2026-10-06T04:00:00Z')]), ME)).toEqual({ waiting: 0, ids: [] });
});

test('the route is behind the v2 gate, like every /coach route', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8');
  expect(src).toMatch(/router\.get\('\/coach\/pending', \.\.\.coachV2,/);
});
