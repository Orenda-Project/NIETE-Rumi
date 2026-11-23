/**
 * bd-o15qnr.45 (queue #240) — Observe's In progress section, and the class on every observation row.
 *
 * The operator, 23 Nov ~19:40: "On the Observe page, we show booked for Today with an All booked button, Needs you and
 * History. We also need to show the currently in process one as well." ~23:20: each observation card shows the date, the
 * grade and the subject (not 'FICO 6-12 · — · FICO 6-12 v1.2'); ~23:22: no rubric name on the cards.
 *
 * GET /coach/reports, switch on (v7):
 *   inProgress   started, not finished, and NOT waiting on her: being analysed, the report being sent, the report waiting
 *                for the teacher's tap. Her own steps (the Feedback Form, the Debrief, Send report) are never here; the
 *                debrief being analysed stays in Needs you, as the operator approved on 22 Nov (bd-o15qnr.39).
 *   every row    `stage` (the bot's portal-observe-step: analysing · draft · talk · listening · feedback · report · sending
 *                · waiting_teacher · sent · done), `grade` and `subject` (a subject key) when the visit named its class.
 * Switch off: the lists exactly as before (the new fields are extra).
 */
const SVC = require('../../dashboard/services/coach-v2.service');
const { PATCH_TEACHERS_SQL, PRINCIPAL_PATCH_SQL } = require('../../dashboard/services/leader-patch.service');

const ME = 'leader-me';
const TODAY = '2026-11-23';

const patchRow = (rumiUserId, ext) => ({
  teacher_ext_id: ext, name: 'T', phone: ext, school_ext_id: 'niete:110', role: 'teacher',
  rumi_user_id: rumiUserId, coaching_sessions: 1, observations: 1, training_modules: 0, school_name: 'GB Test Middle (Rumi QA)',
});
const PATCH = [patchRow('u-1', '923990108101')];

const row = (id, status, debrief, analysis = null, at = '2026-11-23T10:00:00Z') => ({
  id, user_id: 'u-1', created_at: at, status, debrief_status: debrief, audio_url: null, analysis_data: analysis,
  teacher_name: 'Imran Baig (Test)', teacher_phone: null, sched_teacher_name: null, sched_school_name: null,
  sched_school_ext_id: null, sched_teacher_ext_id: null,
});
const talk = (extra = {}) => ({ observer_debrief: { audio_id: null, audio_r2_key: 'k', too_short_at: null, failed_at: null, feedback_failed_at: null, duplicate_refused_at: null, feedback: false, ...extra } });
const delivered = (status, extra = {}) => ({ observer_debrief: { feedback: true }, teacher_delivery: { status, ...extra } });

const ROWS = [
  row('analysing', 'transcribing', 'pending'),
  row('form', 'awaiting_observer_review', 'pending', { observed_lesson: { grade: 3, subject: 'maths' } }),
  // FICO 6-12 (FICO-S v1.2): the class on the obs612 block
  row('ficos-debrief', 'observer_review_complete', 'pending', { obs612: { rubric_id: 'fico_s_v1_2', result: null, grade: 7, subject: 'english', subject_label: null } }),
  row('listening', 'observer_review_complete', 'pending', talk()),
  row('feedback', 'observer_review_complete', 'done', { observer_debrief: { feedback: true } }),
  row('send-ready', 'observer_review_complete', 'done', delivered('awaiting_confirm')),
  row('sending', 'observer_review_complete', 'done', delivered('awaiting_confirm', { send_requested_at: '2026-11-23T10:30:00Z' })),
  row('waiting-teacher', 'observer_review_complete', 'done', delivered('awaiting_teacher_tap')),
  row('sent', 'observer_review_complete', 'done', delivered('sent')),
  row('done', 'completed', 'done', delivered('sent')),
];

function fake(rows = ROWS) {
  const q = async (sql) => {
    if (sql === SVC.SQL.COACH_SESSIONS) return { rows };
    if (sql === PATCH_TEACHERS_SQL || sql === PRINCIPAL_PATCH_SQL) return { rows: PATCH };
    return { rows: [] };
  };
  return q;
}
const ids = (list) => list.map((r) => r.id);
const byId = (out, id) => out.all.items.find((r) => r.id === id);

describe('switch ON: In progress = started, not finished, not waiting on her', () => {
  test('being analysed, the report being sent, waiting for the teacher; nothing of hers', async () => {
    const out = await SVC.getCoachReports(fake(), ME, { v7: true, today: TODAY });
    expect(ids(out.inProgress).sort()).toEqual(['analysing', 'sending', 'waiting-teacher']);
  });

  test('no observation is in both Needs you and In progress; the debrief being analysed stays in Needs you', async () => {
    const out = await SVC.getCoachReports(fake(), ME, { v7: true, today: TODAY });
    expect(ids(out.waiting).sort()).toEqual(['ficos-debrief', 'form', 'listening']);
    const both = ids(out.waiting).filter((id) => ids(out.inProgress).includes(id));
    expect(both).toEqual([]);
  });

  test('each row carries its stage, as the observation page reads it', async () => {
    const out = await SVC.getCoachReports(fake(), ME, { v7: true, today: TODAY });
    const stages = Object.fromEntries(out.all.items.map((r) => [r.id, r.stage]));
    expect(stages).toEqual({
      analysing: 'analysing', form: 'draft', 'ficos-debrief': 'talk', listening: 'listening', feedback: 'feedback',
      'send-ready': 'report', sending: 'sending', 'waiting-teacher': 'waiting_teacher', sent: 'sent', done: 'done',
    });
  });

  test('a row the observation page would refuse (teacher not in her patch) is not In progress either', async () => {
    const gone = { ...row('sending-gone', 'observer_review_complete', 'done', delivered('awaiting_teacher_tap')), user_id: 'u-gone' };
    const out = await SVC.getCoachReports(fake([...ROWS, gone]), ME, { v7: true, today: TODAY });
    expect(ids(out.inProgress)).not.toContain('sending-gone');
  });
});

describe('every row: the class the visit named (grade + subject key), never the rubric', () => {
  test('grades 1-5: the observed lesson; FICO 6-12: its own block; none named: null', async () => {
    const out = await SVC.getCoachReports(fake(), ME, { v7: true, today: TODAY });
    expect(byId(out, 'form')).toMatchObject({ grade: 3, subject: 'maths' });
    expect(byId(out, 'ficos-debrief')).toMatchObject({ grade: 7, subject: 'english' });
    expect(byId(out, 'analysing')).toMatchObject({ grade: null, subject: null });
  });

  test('the sessions read carries the class (grade, subject) and nothing more of the analysis', () => {
    const sql = SVC.SQL.COACH_SESSIONS;
    expect(sql).toMatch(/'observed_lesson'/);
    expect(sql).toMatch(/'obs612'[\s\S]*'grade'[\s\S]*'subject'/);
    expect(sql).not.toMatch(/c\.analysis_data AS analysis_data/);
  });
});

describe('switch OFF: the lists as before', () => {
  test('In progress is the analysing rows only; Needs you the Form and Debrief rows', async () => {
    const out = await SVC.getCoachReports(fake(), ME, {});
    expect(ids(out.inProgress)).toEqual(['analysing']);
    expect(ids(out.waiting).sort()).toEqual(['ficos-debrief', 'form', 'listening']);
  });
});
