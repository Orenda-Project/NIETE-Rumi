/**
 * bd-o15qnr.19 — operator: "When I click on any of these cards, we should go to
 * the page where we see the complete details of a single observation. If in
 * progress … the page where the coach is actually conducting the observation.
 * … completed, it should open the same observation page."
 *
 * So /coach/observation/:id serves ANY HITL of a teacher in this coach's patch
 * (no longer only sent ones), and says where it stands: its step, whether it is
 * her own portal observation (which the portal can take through each step),
 * the Digital Coach score even before her check, and the lesson audio's key
 * (the route signs it so the page can play it). The report image is only ever
 * there once the report is out. Same patch guard as before.
 */

const SVC = require('../../dashboard/services/coach-v2.service');
const { PATCH_TEACHERS_SQL } = require('../../dashboard/services/leader-patch.service');

const ME = 'coach-me';
const TODAY = '2026-10-07';
const PORTAL_AUDIO = 'https://r2.example/classroom_audio/coach-me/2026-10/portal_ab12.webm';
const WA_AUDIO = 'https://r2.example/classroom_audio/coach-2/2026-10/wa_99.ogg';

const PATCH = [{
  teacher_ext_id: '923001110001', name: 'Ayesha Bibi', phone: '923001110001', school_ext_id: 'niete:110', role: 'teacher',
  rumi_user_id: 'u-ayesha', coaching_sessions: 7, observations: 3, training_modules: 4, school_name: 'IMSG I-10/1',
}];

const row = (id, extra) => ({
  id, created_at: '2026-10-06T06:30:00Z', status: 'awaiting_observer_review', debrief_status: 'pending',
  observation_type: 'leader_observation', user_id: 'u-ayesha', observer_user_id: ME, audio_url: PORTAL_AUDIO,
  scores: { percentage: 64 }, summary: 'Clear modelling.', delivery: {}, ...extra,
});
const SESSIONS = {
  'mine-draft': row('mine-draft'),
  'wa-talk': row('wa-talk', { status: 'observer_review_complete', observer_user_id: 'coach-2', audio_url: WA_AUDIO }),
  analysing: row('analysing', { status: 'transcribing', scores: null, summary: null }),
  sent: row('sent', { status: 'completed', debrief_status: 'done', delivery: { status: 'sent', report_key: 'observe_reports/sent.png', sent_at: '2026-10-06T12:00:00Z', caption: 'Your report' } }),
  stranger: row('stranger', { user_id: 'u-not-mine' }),
};

function fakeQuery() {
  return async (sql, params) => {
    const S = SVC.SQL;
    if (sql === PATCH_TEACHERS_SQL) return { rows: PATCH };
    if (sql === S.OBSERVATION_BY_ID) return { rows: SESSIONS[params[0]] ? [SESSIONS[params[0]]] : [] };
    if (sql === S.USER_NAME) return { rows: [{ name: params[0] === ME ? 'Hataf Atif' : 'Imran S' }] };
    return { rows: [] };
  };
}

test('her own portal observation at the Feedback Form step: step, portal, mine, the draft score, the audio key', async () => {
  const out = await SVC.getCoachObservation(fakeQuery(), ME, 'mine-draft', { today: TODAY });
  expect(out).toMatchObject({
    id: 'mine-draft', step: 'draft', portal: true, mine: true, dcScore: 64, score: null, audioKey: PORTAL_AUDIO,
    teacher: { name: 'Ayesha Bibi', teacherExtId: '923001110001', schoolName: 'IMSG I-10/1' },
    observer: { self: true, name: 'Hataf Atif' }, reportKey: null, sentAt: null,
  });
});

test("another coach's WhatsApp observation at the Debrief step is served too, as not hers and not a portal one", async () => {
  const out = await SVC.getCoachObservation(fakeQuery(), ME, 'wa-talk', { today: TODAY });
  expect(out).toMatchObject({ step: 'talk', portal: false, mine: false, observer: { self: false, name: 'Imran S' } });
});

test('still being analysed: the step says so, and there is no score yet', async () => {
  const out = await SVC.getCoachObservation(fakeQuery(), ME, 'analysing', { today: TODAY });
  expect(out).toMatchObject({ step: 'analysing', dcScore: null, score: null });
});

test('sent: every step done, the final score and the report image key', async () => {
  const out = await SVC.getCoachObservation(fakeQuery(), ME, 'sent', { today: TODAY });
  expect(out).toMatchObject({ step: 'sent', score: 64, dcScore: 64, reportKey: 'observe_reports/sent.png', sentAt: '2026-10-06T12:00:00Z', caption: 'Your report' });
});

test('a teacher outside her patch is still refused', async () => {
  expect(await SVC.getCoachObservation(fakeQuery(), ME, 'stranger', { today: TODAY })).toBeNull();
});

test('OBSERVATION_BY_ID reads the audio key; analysis_data only as slices', () => {
  const sql = SVC.SQL.OBSERVATION_BY_ID;
  expect(sql).toMatch(/\baudio_url\b/);
  const bare = sql.replace(/analysis_data->>?'[a-z_]+'/g, '');
  expect(bare).not.toMatch(/analysis_data/);
});
