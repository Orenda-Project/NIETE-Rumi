/**
 * bd-o15qnr.10 — a teacher's History opens her HITL reports (operator: "the
 * history should allow viewing the HITL reports as well").
 *
 * What exists, and what each row may open:
 *   · the coach's own PORTAL-started observation → its existing page
 *     (/portal/leader/observe/:id — portal-observe.service `loadOwn` only opens
 *     those), which shows whatever step it is at: draft, talk or sent;
 *   · any other HITL whose report is out → the v2 read-only report
 *     (/portal/coach/observation/:id), served only while the teacher is in the
 *     coach's patch;
 *   · a HITL still at draft/talk on WhatsApp, and every DC session → nothing
 *     to open (a DC report is the teacher's own: /coaching-session/:id checks
 *     user_id = session user).
 */

const SVC = require('../../dashboard/services/coach-v2.service');
const { PATCH_TEACHERS_SQL } = require('../../dashboard/services/leader-patch.service');

const ME = 'coach-me';
const TODAY = '2026-10-06';
const PORTAL_AUDIO = 'https://r2/classroom_audio/coach-me/2026-10/portal_ab12.webm';
const WA_AUDIO = 'https://r2/classroom_audio/coach-me/2026-09/wa_123.ogg';
const pct = (n) => ({ scores: { percentage: n } });

const PATCH = [
  {
    teacher_ext_id: '923001110001', name: 'Ayesha Bibi', phone: '923001110001', school_ext_id: 'niete:110',
    role: 'teacher', rumi_user_id: 'u-ayesha', coaching_sessions: 7, observations: 3, training_modules: 4,
    last_analysis_data: pct(61), school_name: 'IMSG I-10/1',
  },
];

const HISTORY = [
  { id: 'h-portal', created_at: '2026-10-05T09:00:00Z', status: 'observer_review_complete', debrief_status: 'pending', observation_type: 'leader_observation', observer_user_id: ME, audio_url: PORTAL_AUDIO, analysis_data: pct(66) },
  { id: 'h-wa-sent', created_at: '2026-09-14T09:00:00Z', status: 'completed', debrief_status: 'done', observation_type: 'leader_observation', observer_user_id: ME, audio_url: WA_AUDIO, analysis_data: pct(61) },
  { id: 'h-other-coach', created_at: '2026-09-01T09:00:00Z', status: 'observer_review_complete', debrief_status: 'done', observation_type: 'leader_observation', observer_user_id: 'coach-2', audio_url: WA_AUDIO, analysis_data: pct(58) },
  { id: 'h-wa-draft', created_at: '2026-08-20T09:00:00Z', status: 'awaiting_observer_review', debrief_status: 'pending', observation_type: 'leader_observation', observer_user_id: ME, audio_url: WA_AUDIO, analysis_data: null },
  { id: 'h-dc', created_at: '2026-08-10T09:00:00Z', status: 'completed', debrief_status: null, observation_type: null, observer_user_id: null, audio_url: null, analysis_data: pct(55) },
];

/** coaching_sessions rows as OBSERVATION_BY_ID returns them. */
const SESSIONS = {
  'h-wa-sent': {
    id: 'h-wa-sent', created_at: '2026-09-14T09:00:00Z', status: 'completed', debrief_status: 'done',
    observation_type: 'leader_observation', user_id: 'u-ayesha', observer_user_id: ME,
    scores: { percentage: 61 }, summary: 'Clear modelling; more checks for understanding.',
    delivery: { status: 'sent', report_key: 'observe_reports/h-wa-sent.png', sent_at: '2026-09-14T12:00:00Z', caption: 'Your report' },
  },
  'h-stranger': {
    id: 'h-stranger', created_at: '2026-09-14T09:00:00Z', status: 'completed', debrief_status: 'done',
    observation_type: 'leader_observation', user_id: 'u-not-mine', observer_user_id: 'coach-9',
    scores: { percentage: 70 }, summary: 'x', delivery: { status: 'sent', report_key: 'k.png' },
  },
  'h-wa-draft': {
    id: 'h-wa-draft', created_at: '2026-08-20T09:00:00Z', status: 'awaiting_observer_review', debrief_status: 'pending',
    observation_type: 'leader_observation', user_id: 'u-ayesha', observer_user_id: ME,
    scores: null, summary: null, delivery: {},
  },
};

function fakeQuery() {
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params });
    const S = SVC.SQL;
    if (sql === PATCH_TEACHERS_SQL) return { rows: PATCH };
    if (sql === S.LEADER_SCHOOLS) return { rows: [{ school_ext_id: 'niete:110', school_name: 'IMSG I-10/1', emis: '110' }] };
    if (sql === S.TEACHER_FACTS) return { rows: [] };
    if (sql === S.TEACHER_TRAINING) return { rows: [] };
    if (sql === S.MY_SCHEDULES) return { rows: [] };
    if (sql === S.TEACHER_HISTORY) return { rows: HISTORY };
    if (sql === S.TEACHER_LEVELS) return { rows: [] }; // bd-o15qnr.13
    if (sql === S.OBSERVATION_BY_ID) return { rows: SESSIONS[params[0]] ? [SESSIONS[params[0]]] : [] };
    if (sql === S.USER_NAME) return { rows: params[0] === ME ? [{ name: 'Hataf Atif' }] : [{ name: 'Imran S' }] };
    throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
  };
  q.calls = calls;
  return q;
}

describe('getCoachTeacher — what each History row opens', () => {
  test('own portal HITL → its existing page; any HITL with its report out → the report; draft on WhatsApp and DC → nothing', async () => {
    const out = await SVC.getCoachTeacher(fakeQuery(), ME, '923001110001', { today: TODAY });
    const open = Object.fromEntries(out.history.map((h) => [h.id, h.open]));
    expect(open).toEqual({
      'h-portal': 'observe',
      'h-wa-sent': 'report',
      'h-other-coach': 'report',
      'h-wa-draft': null,
      'h-dc': null,
    });
  });

  test('each HITL row carries its step, so the screen can say where it stands', async () => {
    const out = await SVC.getCoachTeacher(fakeQuery(), ME, '923001110001', { today: TODAY });
    const step = Object.fromEntries(out.history.map((h) => [h.id, h.step]));
    expect(step).toMatchObject({ 'h-portal': 'talk', 'h-wa-sent': 'sent', 'h-wa-draft': 'draft', 'h-dc': null });
  });
});

describe('getCoachObservation — one sent HITL report, patch-guarded', () => {
  test('a report on a teacher in her patch: date, score, summary, observer and the stored report image key', async () => {
    const out = await SVC.getCoachObservation(fakeQuery(), ME, 'h-wa-sent', { today: TODAY });
    expect(out).toMatchObject({
      id: 'h-wa-sent',
      date: '2026-09-14T09:00:00Z',
      score: 61,
      summary: 'Clear modelling; more checks for understanding.',
      teacher: { name: 'Ayesha Bibi', teacherExtId: '923001110001', schoolName: 'IMSG I-10/1' },
      observer: { self: true, name: 'Hataf Atif' },
      sentAt: '2026-09-14T12:00:00Z',
      reportKey: 'observe_reports/h-wa-sent.png',
    });
  });

  test('a teacher outside her patch is refused (null → 404)', async () => {
    expect(await SVC.getCoachObservation(fakeQuery(), ME, 'h-stranger', { today: TODAY })).toBeNull();
  });

  test('an observation whose report is not out yet is not served here', async () => {
    expect(await SVC.getCoachObservation(fakeQuery(), ME, 'h-wa-draft', { today: TODAY })).toBeNull();
  });

  test('an unknown id is refused', async () => {
    expect(await SVC.getCoachObservation(fakeQuery(), ME, 'nope', { today: TODAY })).toBeNull();
  });
});
