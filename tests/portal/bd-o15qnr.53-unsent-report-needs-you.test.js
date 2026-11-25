/**
 * bd-o15qnr.53 (queue #246; #240's report, "Left") — an observation whose debrief is done but whose report she has not
 * sent is hers ("Send the report"), so it sits in Needs you.
 *
 * Before: GET /coach/reports put such a row (step `report`) in no list but History: not Needs you (needsHer took the
 * Form and the Debrief only), not In progress (the system is not working on it). The operator, 24 Nov ~06:30: "4 and 6
 * also go" — move it to Needs you, with the Send action; the Home / Observe "N need you" count changes with it.
 *
 * The rules pinned here (switch ON, portal_coach_flow_v2):
 *   Needs you      step `report` while it is hers: no report started yet (stage `feedback`), the preview made or being
 *                  made, or the send failed (stage `report`). The page's chip is "Send report"; the row opens her step.
 *   In progress    once she has pressed Send (stage `sending`) it is the system's: In progress, never Needs you; the
 *                  teacher not having tapped yet (waiting_teacher) stays In progress as before.
 *   Leaving        like every row in Needs you: 3 school days after the visit (the debrief's due day, #245's stopped
 *                  rule); History keeps it. Production has 715 debriefed-unsent rows by switch accounts back to August,
 *                  mostly closed by the bot's undelivered chaser (gave_up_at); without this they would all flood in.
 *   One order      Needs you is the one waiting longest first, whatever waits (Form, Debrief, Send report, stopped).
 *   Counts         the pending banner and the Home's waiting number agree with Needs you.
 *   Switch OFF     every list exactly as before.
 */
const SVC = require('../../dashboard/services/coach-v2.service');
const { PATCH_TEACHERS_SQL, PRINCIPAL_PATCH_SQL } = require('../../dashboard/services/leader-patch.service');

const ME = 'coach-me';
const TODAY = '2026-11-25'; // a Wednesday

const patchRow = (rumiUserId, ext, name) => ({
  teacher_ext_id: ext, name, phone: ext, school_ext_id: 'niete:110', role: 'teacher',
  rumi_user_id: rumiUserId, coaching_sessions: 1, observations: 1, training_modules: 0, school_name: 'FLN QA School (synthetic)',
});
const PATCH = [
  patchRow('u-g1', '929998100001', 'FLN QA Teacher EN G1'),
  patchRow('u-g3', '929998100003', 'FLN QA Teacher EN G3'),
  patchRow('u-g7', '929998100007', 'FLN QA Teacher EN G7'),
  patchRow('u-g5', '929998100005', 'FLN QA Teacher EN G5'),
];

const session = (id, userId, status, debrief, at, delivery) => ({
  id, user_id: userId, created_at: at, status, debrief_status: debrief, audio_url: null,
  analysis_data: delivery === undefined ? null : { teacher_delivery: delivery },
  teacher_name: 'T', teacher_phone: null, sched_teacher_name: null, sched_school_name: null, sched_school_ext_id: null, sched_teacher_ext_id: null,
});
const RC = 'observer_review_complete';

// Newest first, as COACH_SESSIONS reads them.
const ROWS = [
  // she pressed Send a moment ago: the deliver job is running (stage sending)
  session('sending', 'u-g7', RC, 'done', '2026-11-25T06:00:00Z', { status: 'awaiting_confirm', send_requested_at: '2026-11-25T06:40:00Z' }),
  // a Form waiting on her
  session('form', 'u-g7', 'awaiting_observer_review', 'pending', '2026-11-25T05:00:00Z'),
  // debrief done today, no report started yet (stage feedback): "Send the report" is hers
  session('feedback-today', 'u-g1', RC, 'done', '2026-11-25T04:00:00Z'),
  // the preview is ready, not sent (stage report)
  session('preview-tue', 'u-g3', RC, 'done', '2026-11-24T05:00:00Z', { status: 'awaiting_confirm' }),
  // the send failed: hers again (stage report, problem send_failed)
  session('send-failed', 'u-g7', RC, 'done', '2026-11-24T04:00:00Z', { status: 'send_failed' }),
  // a Debrief to record, Monday
  session('talk-mon', 'u-g7', RC, 'pending', '2026-11-23T05:00:00Z'),
  // the teacher was sent the invite, has not tapped it (waiting_teacher): In progress, as before
  session('waiting-teacher', 'u-g3', RC, 'done', '2026-11-23T04:00:00Z', { status: 'awaiting_teacher_tap' }),
  // the report reached the teacher: History only
  session('sent', 'u-g1', RC, 'done', '2026-11-22T05:00:00Z', { status: 'sent' }),
  // a debriefed, unsent report from Wed 18 Nov (due Sat 21): past due, it leaves Needs you
  session('old-report', 'u-g1', RC, 'done', '2026-11-18T05:00:00Z', { gave_up_at: '2026-11-21T05:00:00Z', gave_up_reason: 'too_old_to_chase' }),
  // an old send still running is the system's, not hers: In progress keeps it, whatever its age
  session('old-sending', 'u-g3', RC, 'done', '2026-11-18T04:00:00Z', { status: 'awaiting_confirm', send_requested_at: '2026-11-18T09:00:00Z' }),
];

function fake(rows = ROWS, patch = PATCH) {
  const q = async (sql) => {
    if (sql === SVC.SQL.COACH_SESSIONS) return { rows };
    if (sql === PATCH_TEACHERS_SQL || sql === PRINCIPAL_PATCH_SQL) return { rows: patch };
    return { rows: [] };
  };
  return q;
}
const ids = (list) => list.map((r) => r.id);

describe('switch OFF: every list exactly as before (a debriefed, unsent report is History only)', () => {
  test('getCoachReports', async () => {
    const out = await SVC.getCoachReports(fake(), ME, {});
    expect(ids(out.waiting)).toEqual(['form', 'talk-mon']);
    expect(ids(out.inProgress)).toEqual([]);
    expect(ids(out.all.items)).toEqual(expect.arrayContaining(['feedback-today', 'preview-tue', 'send-failed', 'old-report']));
  });
  test('getCoachPending and getCoachHome', async () => {
    expect((await SVC.getCoachPending(fake(), ME)).ids).toEqual(['form', 'talk-mon']);
    expect((await SVC.getCoachHome(fake(), ME, { today: TODAY })).counts.waiting).toBe(2);
  });
});

describe('switch ON: a debriefed report she has not sent is in Needs you', () => {
  const on = (rows, extra = {}) => SVC.getCoachReports(fake(rows), ME, { v7: true, today: TODAY, ...extra });

  test('Needs you lists it while it is hers: no report started, the preview ready, the send failed', async () => {
    const out = await on();
    expect(ids(out.waiting)).toEqual(expect.arrayContaining(['feedback-today', 'preview-tue', 'send-failed']));
    expect(out.waiting.find((r) => r.id === 'feedback-today')).toMatchObject({ step: 'report', stage: 'feedback' });
    expect(out.waiting.find((r) => r.id === 'preview-tue')).toMatchObject({ step: 'report', stage: 'report' });
    expect(out.waiting.find((r) => r.id === 'send-failed')).toMatchObject({ step: 'report', stage: 'report' });
  });

  test('once she pressed Send it is In progress, never Needs you; waiting for the teacher stays In progress', async () => {
    const out = await on();
    expect(ids(out.waiting)).not.toContain('sending');
    expect(ids(out.waiting)).not.toContain('waiting-teacher');
    expect(ids(out.inProgress)).toEqual(expect.arrayContaining(['sending', 'waiting-teacher', 'old-sending']));
  });

  test('never in both lists', async () => {
    const out = await on();
    const both = ids(out.waiting).filter((id) => ids(out.inProgress).includes(id));
    expect(both).toEqual([]);
  });

  test('3 school days after the visit it leaves Needs you, as the debrief does; History keeps it', async () => {
    const out = await on();
    expect(ids(out.waiting)).not.toContain('old-report');
    expect(out.withheld).toEqual(expect.arrayContaining([{ id: 'old-report', reason: 'report_past_due' }]));
    expect(ids(out.all.items)).toContain('old-report');
    const rows = [session('r', 'u-g1', RC, 'done', '2026-11-18T05:00:00Z')]; // Wed 18 → due Sat 21
    expect(ids((await SVC.getCoachReports(fake(rows), ME, { v7: true, today: '2026-11-21' })).waiting)).toEqual(['r']);
    expect(ids((await SVC.getCoachReports(fake(rows), ME, { v7: true, today: '2026-11-23' })).waiting)).toEqual([]);
  });

  test('an old send still running is not held back: In progress keeps it', async () => {
    const out = await on();
    expect(out.withheld || []).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'old-sending' })]));
  });

  test('one order for everything in Needs you: the one waiting longest first', async () => {
    // a G5 visit whose analysis stopped on Monday (her only visit of that teacher, so #245 keeps it in Needs you)
    const stopped = session('stopped-mon', 'u-g5', 'failed', 'pending', '2026-11-23T04:30:00Z');
    const out = await on([...ROWS, stopped]);
    expect(ids(out.waiting)).toEqual(['stopped-mon', 'talk-mon', 'send-failed', 'preview-tue', 'feedback-today', 'form']);
  });

  test('the principal reads the same rule for her own observations', async () => {
    const out = await on(undefined, { role: 'principal' });
    expect(ids(out.waiting)).toEqual(expect.arrayContaining(['feedback-today', 'preview-tue', 'send-failed']));
    expect(ids(out.waiting)).not.toContain('sending');
  });

  test('a report of a teacher no longer in her patch is held back like any other row', async () => {
    const out = await on([session('gone', 'u-left', RC, 'done', '2026-11-25T04:00:00Z')]);
    expect(ids(out.waiting)).toEqual([]);
    expect(out.withheld).toEqual([{ id: 'gone', reason: 'teacher_not_in_patch' }]);
  });

  test('the pending banner and the Home\'s waiting count agree with Needs you', async () => {
    const reports = await on();
    const pending = await SVC.getCoachPending(fake(), ME, { v7: true, today: TODAY });
    expect(pending.ids.slice().sort()).toEqual(ids(reports.waiting).slice().sort());
    expect(pending.waiting).toBe(5);
    const home = await SVC.getCoachHome(fake(), ME, { v7: true, today: TODAY });
    expect(home.counts.waiting).toBe(5);
  });
});
