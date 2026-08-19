/**
 * bd-2455 — Leader "Observations" resolver (TDD, red-first).
 *
 * The coach's /observe world, surfaced on the portal: upcoming scheduled
 * observations (observation_schedules, status='upcoming', overdue-flagged),
 * pending debriefs (the bot's exact listPendingDebriefs semantics:
 * observer_review_complete + debrief_status='pending'), and completed past
 * observations (fully completed, or review-complete with the debrief done).
 * `query` is injected like every leader-* service so this runs without a DB.
 */

const { getLeaderObservations } = require('../services/leader-observations.service');

const LEADER = 'leader-uuid-1';
const TODAY = '2026-08-01';

// FICO-shaped analysis (domain_score/domain_max) with an explicit overall —
// exactly what NIETE sessions store.
const FICO_ANALYSIS = {
  scores: { overall_percentage: 62.2 },
  domains: {
    student_engagement: { domain_score: 21, domain_max: 28 },
    lesson_plan_fidelity: { domain_score: 24, domain_max: 40 },
  },
};

const SCHEDULE_ROWS = [
  { id: 's1', teacher_name: 'Sadia Tabassum', school_name: 'GPS Alpha', school_ext_id: 'niete:1', teacher_ext_id: 'p1', scheduled_for: '2026-07-30', scheduled_slot: '09:30', status: 'upcoming', created_at: '2026-07-28T08:00:00Z' },
  { id: 's2', teacher_name: 'Nadia Perveen', school_name: 'GPS Beta', school_ext_id: 'niete:2', teacher_ext_id: 'p2', scheduled_for: '2026-08-04', scheduled_slot: '11:30', status: 'upcoming', created_at: '2026-07-29T08:00:00Z' },
];

const SESSION_ROWS = [
  // pending debrief (the bot's debrief list shows this one)
  { id: 'c1', created_at: '2026-07-31T09:00:00Z', status: 'observer_review_complete', debrief_status: 'pending', analysis_data: FICO_ANALYSIS, report_pdf_url: null, user_id: 't-1', observer_user_id: LEADER, teacher_first_name: 'Sadia' },
  // completed: debrief done
  { id: 'c2', created_at: '2026-07-27T09:00:00Z', status: 'observer_review_complete', debrief_status: 'done', analysis_data: FICO_ANALYSIS, report_pdf_url: 'https://r2/report.pdf', user_id: 't-2', observer_user_id: LEADER, teacher_first_name: 'Nadia' },
  // completed: terminal status
  { id: 'c3', created_at: '2026-07-20T09:00:00Z', status: 'completed', debrief_status: 'done', analysis_data: FICO_ANALYSIS, report_pdf_url: null, user_id: 't-1', observer_user_id: LEADER, teacher_first_name: 'Sadia' },
  // in-flight — must appear in NEITHER list
  { id: 'c4', created_at: '2026-08-01T07:00:00Z', status: 'confirmed', debrief_status: 'pending', analysis_data: null, report_pdf_url: null, user_id: 't-3', observer_user_id: LEADER, teacher_first_name: 'Imran' },
  // failed — must appear in NEITHER list
  { id: 'c5', created_at: '2026-07-23T07:00:00Z', status: 'failed', debrief_status: 'pending', analysis_data: null, report_pdf_url: null, user_id: 't-3', observer_user_id: LEADER, teacher_first_name: 'Imran' },
  // legacy unbound capture — observer owns the row; name must be null (not the coach's own)
  { id: 'c6', created_at: '2026-07-18T09:00:00Z', status: 'observer_review_complete', debrief_status: 'done', analysis_data: null, report_pdf_url: null, user_id: LEADER, observer_user_id: LEADER, teacher_first_name: 'Riffat' },
];

function makeQuery() {
  return jest.fn(async (sql) => {
    // bd-2670: the sessions query now LATERAL-joins observation_schedules to
    // name the teacher, so it mentions BOTH tables. Discriminate on the
    // sessions table first — matching observation_schedules first would hand
    // the sessions query the schedule rows.
    if (/coaching_sessions/i.test(sql)) return { rows: SESSION_ROWS };
    if (/observation_schedules/i.test(sql)) return { rows: SCHEDULE_ROWS };
    throw new Error(`unexpected sql: ${sql.slice(0, 80)}`);
  });
}

describe('getLeaderObservations', () => {
  it('returns upcoming schedules ordered by date with an overdue flag', async () => {
    const out = await getLeaderObservations(makeQuery(), LEADER, { today: TODAY });
    expect(out.upcoming.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(out.upcoming[0]).toMatchObject({
      teacherName: 'Sadia Tabassum', schoolName: 'GPS Alpha',
      scheduledFor: '2026-07-30', scheduledSlot: '09:30', overdue: true,
    });
    expect(out.upcoming[1].overdue).toBe(false);
  });

  it('pending debriefs = observer_review_complete + debrief_status pending, newest first', async () => {
    const out = await getLeaderObservations(makeQuery(), LEADER, { today: TODAY });
    expect(out.pendingDebriefs.map((d) => d.id)).toEqual(['c1']);
    expect(out.pendingDebriefs[0]).toMatchObject({ teacherName: 'Sadia', score: 62.2 });
  });

  it('completed = terminal or debriefed sessions, newest first; in-flight and failed excluded everywhere', async () => {
    const out = await getLeaderObservations(makeQuery(), LEADER, { today: TODAY });
    expect(out.completed.map((d) => d.id)).toEqual(['c2', 'c3', 'c6']);
    expect(out.completed[0]).toMatchObject({ teacherName: 'Nadia', reportPdfUrl: 'https://r2/report.pdf' });
    const everywhere = [...out.upcoming, ...out.pendingDebriefs, ...out.completed].map((x) => x.id);
    expect(everywhere).not.toContain('c4');
    expect(everywhere).not.toContain('c5');
  });

  it('a legacy unbound capture (observer owns the row) gets teacherName null, never the coach name', async () => {
    const out = await getLeaderObservations(makeQuery(), LEADER, { today: TODAY });
    const c6 = out.completed.find((d) => d.id === 'c6');
    expect(c6.teacherName).toBeNull();
  });

  it('scopes both queries to the leader', async () => {
    const query = makeQuery();
    await getLeaderObservations(query, LEADER, { today: TODAY });
    for (const call of query.mock.calls) expect(call[1]).toEqual([LEADER]);
  });

  it('degrades to empty lists when a query fails', async () => {
    const query = jest.fn(async () => { throw new Error('boom'); });
    const out = await getLeaderObservations(query, LEADER, { today: TODAY });
    expect(out).toEqual({ upcoming: [], pendingDebriefs: [], completed: [] });
  });
});
