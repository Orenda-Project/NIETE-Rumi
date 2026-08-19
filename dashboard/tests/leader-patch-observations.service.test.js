/**
 * bd-2671 / bd-2672 — teacher performance must COUNT observations, and name
 * the school + focus area (TDD, red-first).
 *
 * bd-2671 (found by reading, not reported): PATCH_TEACHERS_SQL counts sessions
 * and reads the latest score with `c.status = 'completed'`, but a leader
 * observation never reaches that status. Live 2026-08-13, all 85 NIETE
 * observations ever created:
 *     observer_review_complete 53 · awaiting_observer_review 17 · failed 12
 *     · completed 1 · analyzing 1
 * So a teacher observed five times shows 0 sessions and no score. The portal's
 * own resolver already treats review-complete as terminal
 * (leader-observations.service.js isCompleted), so the two disagree.
 *
 * bd-2672 (Riffat): the row needs the SCHOOL (teachers share names) and its
 * EMIS code, and when a score is low the panel must say WHICH area needs work
 * rather than the bare words "Focus Area".
 */

const { getPatchTeachers, PATCH_TEACHERS_SQL } = require('../services/leader-patch.service');

const LEADER = 'leader-uuid-1';

const FICO_ANALYSIS = {
  scores: { overall_percentage: 41.5 },
  focus_area: { indicator: 'C3.7', title: 'Checking for understanding' },
  domains: {
    student_engagement: { domain_score: 10, domain_max: 28 },
    lesson_plan_fidelity: { domain_score: 14, domain_max: 40 },
  },
};

const ROWS = [
  {
    teacher_ext_id: 'p1', teacher_name: 'Tahira Manzoor', phone: '923001234567',
    rumi_user_id: 'u1', rumi_first_name: 'Tahira',
    coaching_sessions: 0,          // self-recorded AI coaching: none
    observations: 3,               // but observed three times
    lesson_plans: 2,
    last_analysis_data: FICO_ANALYSIS, last_session_at: '2026-08-12T09:00:00Z',
    school_name: 'IMSG Mohra Nagial', school_ext_id: 'niete:509',
  },
  {
    teacher_ext_id: 'p2', teacher_name: 'Nadia Perveen', phone: '923009876543',
    rumi_user_id: null, rumi_first_name: null,
    coaching_sessions: 0, observations: 0, lesson_plans: 0,
    last_analysis_data: null, last_session_at: null,
    school_name: 'IMSG Beta', school_ext_id: 'niete:512',
  },
];

const makeQuery = (rows = ROWS) => jest.fn(async () => ({ rows }));

describe('getPatchTeachers — observations count and the row is identifiable', () => {
  it('SQL recognises the status an observation actually reaches', () => {
    // The old query counted only status='completed' — which 84 of 85 live
    // observations never reach. observer_review_complete is the real terminal
    // state (it is what leader-observations.service.js already treats as done).
    expect(PATCH_TEACHERS_SQL).toMatch(/observer_review_complete/);
  });

  it('SQL counts leader observations for the teacher', () => {
    expect(PATCH_TEACHERS_SQL).toMatch(/leader_observation/i);
  });

  it('SQL joins the school so the row carries a name and EMIS', () => {
    expect(PATCH_TEACHERS_SQL).toMatch(/leader_schools/i);
  });

  it('reports observations separately from self-recorded coaching sessions', async () => {
    const [t] = await getPatchTeachers(makeQuery(), LEADER);
    expect(t.observations).toBe(3);
    expect(t.coachingSessions).toBe(0);
  });

  it('shows the school name and EMIS so same-named teachers are distinguishable', async () => {
    const [t] = await getPatchTeachers(makeQuery(), LEADER);
    expect(t).toMatchObject({ schoolName: 'IMSG Mohra Nagial', emis: '509' });
  });

  it('names the focus area instead of just flagging one', async () => {
    const [t] = await getPatchTeachers(makeQuery(), LEADER);
    expect(t.lastScore).toBeCloseTo(41.5);
    expect(t.focusArea).toBe('Checking for understanding');
  });

  it('leaves focusArea null when there is no analysis (never invents one)', async () => {
    const [, t2] = await getPatchTeachers(makeQuery(), LEADER);
    expect(t2.focusArea).toBeNull();
    expect(t2.lastScore).toBeNull();
    expect(t2.observations).toBe(0);
  });
});
