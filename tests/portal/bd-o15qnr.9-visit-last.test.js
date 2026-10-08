/**
 * bd-o15qnr.9 — the v2 Visit page's Last visit row (v21 Visit.dc.html):
 * "Last visit · 14 Sep", "HITL · You" (or the coach's name), the step chip
 * ("Report sent" …) and a link when the observation opens in the portal.
 *
 * TEACHER_FACTS therefore carries the session's id, observer, debrief status
 * and audio key (to tell a portal-started observation from a WhatsApp one),
 * and the observer's name — still only the scores slice of analysis_data.
 */

const SVC = require('../../dashboard/services/coach-v2.service');
const { PATCH_TEACHERS_SQL } = require('../../dashboard/services/leader-patch.service');

const ME = 'coach-me';
const TODAY = '2026-10-06';
const pct = (n) => ({ scores: { percentage: n } });

const PATCH = [{
  teacher_ext_id: '923001110001', name: 'Ayesha Bibi', phone: '923001110001', school_ext_id: 'niete:110',
  role: 'teacher', rumi_user_id: 'u-ayesha', coaching_sessions: 7, observations: 3, training_modules: 4,
  last_analysis_data: pct(61), school_name: 'IMSG I-10/1',
}];

const VISIT = {
  id: 'v-next', leader_user_id: ME, teacher_name: 'Ayesha Bibi', school_name: 'IMSG I-10/1', school_ext_id: 'niete:110',
  teacher_ext_id: '923001110001', scheduled_for: TODAY, scheduled_slot: '11:30', status: 'upcoming', session_id: null,
};

function fake(facts) {
  return async (sql, params) => {
    const S = SVC.SQL;
    if (sql === PATCH_TEACHERS_SQL) return { rows: PATCH };
    if (sql === S.SCHEDULE_BY_ID) return { rows: params[0] === VISIT.id ? [VISIT] : [] };
    if (sql === S.TEACHER_FACTS) return { rows: facts };
    if (sql === S.TEACHER_TRAINING) return { rows: [] };
    return { rows: [] };
  };
}

const PORTAL_AUDIO = 'https://r2.example/classroom_audio/coach-me/2026-09/portal_ab12.webm';

test('my sent portal observation: id, step sent, by me, opens in the portal', async () => {
  const out = await SVC.getCoachVisit(fake([
    { id: 's-sent', user_id: 'u-ayesha', created_at: '2026-09-14T09:00:00Z', status: 'observer_review_complete', debrief_status: 'done',
      audio_url: PORTAL_AUDIO, observer_user_id: ME, observer_name: 'Hataf Atif', analysis_data: { ...pct(61), teacher_delivery: { status: 'sent' } } },
    { id: 's-old', user_id: 'u-ayesha', created_at: '2026-08-20T09:00:00Z', status: 'completed', debrief_status: null,
      audio_url: null, observer_user_id: 'coach-2', observer_name: 'Imran S', analysis_data: pct(64) },
  ]), ME, 'v-next', { today: TODAY });
  expect(out.lastVisit).toEqual({
    id: 's-sent', date: '2026-09-14T09:00:00Z', score: 61, step: 'sent', byMe: true, observerName: 'Hataf Atif', portal: true,
  });
});

test("another coach's WhatsApp observation still in draft: step draft, their name, not a portal one", async () => {
  const out = await SVC.getCoachVisit(fake([
    { id: 's-wa', user_id: 'u-ayesha', created_at: '2026-09-30T09:00:00Z', status: 'awaiting_observer_review', debrief_status: 'pending',
      audio_url: 'https://r2.example/classroom_audio/coach-2/2026-09/wa_99.ogg', observer_user_id: 'coach-2', observer_name: 'Imran S', analysis_data: pct(50) },
  ]), ME, 'v-next', { today: TODAY });
  expect(out.lastVisit).toMatchObject({ id: 's-wa', step: 'draft', byMe: false, observerName: 'Imran S', portal: false, score: null });
});

test('the teachers list does not grow: the extra facts stay inside the service', async () => {
  const out = await SVC.getCoachPeople(fake([
    { id: 's-sent', user_id: 'u-ayesha', created_at: '2026-09-14T09:00:00Z', status: 'completed', debrief_status: 'done',
      audio_url: null, observer_user_id: ME, observer_name: 'Hataf Atif', analysis_data: pct(61) },
  ]), ME, { today: TODAY });
  expect(Object.keys(out.teachers[0])).not.toEqual(expect.arrayContaining(['latest', '_latest']));
  expect(JSON.stringify(out.teachers[0])).not.toMatch(/observer|portal_ab12|s-sent/);
});

test('TEACHER_FACTS reads the id, observer, debrief status, audio key and observer name; scores slice only', () => {
  const sql = SVC.SQL.TEACHER_FACTS;
  for (const col of ['id', 'debrief_status', 'audio_url', 'observer_user_id']) expect(sql).toMatch(new RegExp(`\\bc\\.${col}\\b`));
  expect(sql).toMatch(/AS observer_name/);
  expect(sql).toMatch(/LEFT JOIN users/);
  const bare = sql.replace(/analysis_data->'[a-z_]+'/g, '').replace(/AS analysis_data/g, '');
  expect(bare).not.toMatch(/analysis_data/);
});
