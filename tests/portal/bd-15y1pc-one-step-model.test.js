/**
 * bd-15y1pc — the coach v2 screens and the bot must agree on where an
 * observation stands. The bot's portal-observe-step reads the row in eleven
 * steps; coach v2 reads it in five (analysing · draft · talk · report · sent).
 * Before this, a debrief that was done but whose report had NOT gone to the
 * teacher read as "sent" in v2 — every step ticked green, and no report.
 *
 * coach v2 cannot require the bot at runtime (separate deploy), so this test
 * holds the two in step: every /observe row reads the same in both, coarsely.
 */
const SVC = require('../../dashboard/services/coach-v2.service');
const { stepOfRow } = require('../../bot/shared/services/observe/portal-observe-step');
const { PATCH_TEACHERS_SQL } = require('../../dashboard/services/leader-patch.service');

const ME = 'coach-me';
const TODAY = '2026-10-08';
const PATCH = [{
  teacher_ext_id: '923001110001', name: 'Ayesha Bibi', phone: '923001110001', school_ext_id: 'niete:110', role: 'teacher',
  rumi_user_id: 'u-ayesha', coaching_sessions: 1, observations: 1, training_modules: 0, school_name: 'IMSG I-10/1',
}];

// The bot's eleven steps, as v2's five.
const COARSE = {
  analysing: 'analysing',
  draft: 'draft',
  talk: 'talk',
  listening: 'talk',
  feedback: 'report',
  report: 'report',
  sending: 'report',
  waiting_teacher: 'sent',
  sent: 'sent',
  done: 'sent',
};

// [name, status, debrief_status, teacher_delivery]
const ROWS = [
  ['transcribing', 'transcribing', 'pending', null],
  ['analysing', 'analyzing', 'pending', null],
  ['at the form', 'awaiting_observer_review', 'pending', null],
  ['at the debrief', 'observer_review_complete', 'pending', null],
  ['debrief done, no report started', 'observer_review_complete', 'done', null],
  ['report being made', 'observer_review_complete', 'done', { status: 'previewing' }],
  ['report ready to send', 'observer_review_complete', 'done', { status: 'awaiting_confirm' }],
  ['send pressed', 'observer_review_complete', 'done', { status: 'awaiting_confirm', send_requested_at: '2026-10-08T05:00:00Z' }],
  ['send failed', 'observer_review_complete', 'done', { status: 'send_failed' }],
  ['report cancelled', 'observer_review_complete', 'done', { status: 'cancelled' }],
  ['invite out, teacher not tapped', 'observer_review_complete', 'done', { status: 'awaiting_teacher_tap' }],
  ['operator review', 'observer_review_complete', 'done', { status: 'operator_review' }],
  ['report sent', 'observer_review_complete', 'done', { status: 'sent' }],
  ['completed', 'completed', 'done', { status: 'sent' }],
];

function byIdQuery(row) {
  return async (sql) => {
    if (sql === PATCH_TEACHERS_SQL) return { rows: PATCH };
    if (sql === SVC.SQL.OBSERVATION_BY_ID) return { rows: [row] };
    if (sql === SVC.SQL.USER_NAME) return { rows: [{ name: 'Hataf Atif' }] };
    return { rows: [] };
  };
}

const sessionRow = (status, debrief, delivery) => ({
  id: 'cs-1', created_at: '2026-10-08T04:00:00Z', status, debrief_status: debrief,
  observation_type: 'leader_observation', user_id: 'u-ayesha', observer_user_id: ME,
  audio_url: 'https://r2.example/classroom_audio/u/2026-10/wa_1.ogg',
  scores: null, summary: null, delivery,
});

test.each(ROWS)('%s: coach v2 reads it as the bot does', async (_name, status, debrief, delivery) => {
  const bot = stepOfRow({ status, debrief_status: debrief, analysis_data: { teacher_delivery: delivery || {} } });
  const out = await SVC.getCoachObservation(byIdQuery(sessionRow(status, debrief, delivery)), ME, 'cs-1', { today: TODAY });
  expect(out.step).toBe(COARSE[bot.step]);
});

test('a debrief done with no report out is the report step — no report image, nothing claimed sent', async () => {
  const out = await SVC.getCoachObservation(byIdQuery(sessionRow('observer_review_complete', 'done', null)), ME, 'cs-1', { today: TODAY });
  expect(out).toMatchObject({ step: 'report', reportKey: null, sentAt: null });
});

test('every query a step is read from carries the report\'s status — and still only slices of analysis_data', () => {
  for (const name of ['COACH_SESSIONS', 'TEACHER_FACTS', 'TEACHER_HISTORY', 'OBSERVATION_BY_ID']) {
    const sql = SVC.SQL[name];
    expect([name, /analysis_data->'teacher_delivery'/.test(sql)]).toEqual([name, true]);
    expect([name, /analysis_data(?!\s*->)/.test(sql.replace(/AS analysis_data/g, ''))]).toEqual([name, false]);
  }
});

test('the Reports list: a report not yet sent is not filed as sent, and does not join her waiting list', async () => {
  const rows = [
    { ...sessionRow('observer_review_complete', 'done', null), analysis_data: { teacher_delivery: null } },
  ];
  const q = async (sql) => {
    if (sql === PATCH_TEACHERS_SQL) return { rows: PATCH };
    if (sql === SVC.SQL.COACH_SESSIONS) return { rows };
    return { rows: [] };
  };
  const out = await SVC.getCoachReports(q, ME, {});
  expect(out.all.items.map((r) => r.step)).toEqual(['report']);
  expect(out.waiting).toEqual([]);
});
