/**
 * bd-2670 / bd-2668 — the observed teacher must be NAMED on the portal (TDD, red-first).
 *
 * Riffat, 2026-08-13: the portal's Debrief List shows "Unassigned" and the
 * Completed Observations list shows no teacher, so a coach cannot tell which
 * observation belongs to whom. Live data (2026-08-13): 66 of 85 observations
 * are self-owned (user_id === observer_user_id), so `users.first_name` — the
 * only source the resolver used — yields nothing for 78% of rows.
 *
 * Identity exists elsewhere and must be used, in this priority:
 *   1. observation_schedules.teacher_name / school_name / school_ext_id
 *      (linked by observation_schedules.session_id — set by markDone at capture)
 *   2. analysis_data.teacher_delivery.teacher_name (set when the coach names
 *      the teacher at send time)
 *   3. users.first_name via user_id, when the row is NOT self-owned
 * Only when all three are empty is the row genuinely unidentified.
 *
 * EMIS is the suffix of school_ext_id ('niete:509' → '509') — that is the code
 * coaches read, and Riffat asked for it because teachers share names.
 */

const { getLeaderObservations } = require('../services/leader-observations.service');

const LEADER = 'leader-uuid-1';
const TODAY = '2026-08-13';

const SCHEDULE_ROWS = [];   // no upcoming rows — this spec is about past/pending identity

// Every row below is SELF-OWNED (user_id === observer_user_id), the live majority case.
const SESSION_ROWS = [
  {
    // 1. named by the linked schedule
    id: 'c1', created_at: '2026-08-12T09:00:00Z',
    status: 'observer_review_complete', debrief_status: 'pending',
    analysis_data: null, report_pdf_url: null,
    user_id: LEADER, observer_user_id: LEADER, teacher_first_name: 'Riffat',
    sched_teacher_name: 'Tahira Manzoor', sched_school_name: 'IMSG Mohra Nagial', sched_school_ext_id: 'niete:509',
  },
  {
    // 2. no schedule, but the coach named her at send time
    id: 'c2', created_at: '2026-08-11T09:00:00Z',
    status: 'observer_review_complete', debrief_status: 'done',
    analysis_data: { teacher_delivery: { teacher_name: 'mr. kamran afzal', teacher_phone: '923051815964', status: 'sent' } },
    report_pdf_url: null,
    user_id: LEADER, observer_user_id: LEADER, teacher_first_name: 'Riffat',
    sched_teacher_name: null, sched_school_name: null, sched_school_ext_id: null,
  },
  {
    // 3. genuinely unidentified — no schedule, no delivery, self-owned
    id: 'c3', created_at: '2026-08-10T09:00:00Z',
    status: 'observer_review_complete', debrief_status: 'pending',
    analysis_data: null, report_pdf_url: null,
    user_id: LEADER, observer_user_id: LEADER, teacher_first_name: 'Riffat',
    sched_teacher_name: null, sched_school_name: null, sched_school_ext_id: null,
  },
  {
    // 4. properly bound teacher (visit picker) — users.first_name still works
    id: 'c4', created_at: '2026-08-09T09:00:00Z',
    status: 'observer_review_complete', debrief_status: 'done',
    analysis_data: null, report_pdf_url: null,
    user_id: 'teacher-uuid-9', observer_user_id: LEADER, teacher_first_name: 'Nighat',
    sched_teacher_name: null, sched_school_name: null, sched_school_ext_id: null,
  },
];

function makeQuery(sessions = SESSION_ROWS) {
  return jest.fn(async (sql) => {
    if (/observation_schedules[\s\S]*status\s*=\s*'upcoming'/i.test(sql)) return { rows: SCHEDULE_ROWS };
    if (/coaching_sessions/i.test(sql)) return { rows: sessions };
    throw new Error(`unexpected sql: ${sql.slice(0, 80)}`);
  });
}

describe('getLeaderObservations — the observed teacher is named (bd-2670)', () => {
  it('joins the linked schedule so the SQL can supply teacher/school/EMIS', async () => {
    const query = makeQuery();
    await getLeaderObservations(query, LEADER, { today: TODAY });
    const sessionSql = query.mock.calls.map((c) => c[0]).find((s) => /coaching_sessions/i.test(s));
    expect(sessionSql).toMatch(/observation_schedules/i);
    expect(sessionSql).toMatch(/session_id/i);
  });

  it('names the teacher from the linked schedule, with school and EMIS', async () => {
    const out = await getLeaderObservations(makeQuery(), LEADER, { today: TODAY });
    const row = out.pendingDebriefs.find((r) => r.id === 'c1');
    expect(row).toMatchObject({
      teacherName: 'Tahira Manzoor',
      schoolName: 'IMSG Mohra Nagial',
      emis: '509',
    });
  });

  it('falls back to the name the coach gave at send time', async () => {
    const out = await getLeaderObservations(makeQuery(), LEADER, { today: TODAY });
    expect(out.completed.find((r) => r.id === 'c2')).toMatchObject({ teacherName: 'mr. kamran afzal' });
  });

  it('still uses users.first_name for a properly bound teacher', async () => {
    const out = await getLeaderObservations(makeQuery(), LEADER, { today: TODAY });
    expect(out.completed.find((r) => r.id === 'c4')).toMatchObject({ teacherName: 'Nighat' });
  });

  it('never labels the coach as the observed teacher when nothing identifies her', async () => {
    const out = await getLeaderObservations(makeQuery(), LEADER, { today: TODAY });
    const row = out.pendingDebriefs.find((r) => r.id === 'c3');
    expect(row.teacherName).toBeNull();
    expect(row.teacherName).not.toBe('Riffat');
  });

  it('exposes the observation date on every row so the list can be read at a glance', async () => {
    const out = await getLeaderObservations(makeQuery(), LEADER, { today: TODAY });
    for (const row of [...out.pendingDebriefs, ...out.completed]) {
      expect(row.createdAt).toBeTruthy();
    }
  });

  it('leaves emis null when the school is unknown (never renders "null")', async () => {
    const out = await getLeaderObservations(makeQuery(), LEADER, { today: TODAY });
    const row = out.completed.find((r) => r.id === 'c4');
    expect(row.emis).toBeNull();
    expect(row.schoolName).toBeNull();
  });
});
