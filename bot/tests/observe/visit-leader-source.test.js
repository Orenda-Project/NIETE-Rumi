/**
 * bd-2430 — leader-source on NIETE: the FICO analysis shape MUST resolve to
 * areas (the bd-2300 regression class: main bot read only whitelisted keys and
 * every HOTS teacher looked like no-data — same trap here with FICO's four
 * `domains` section keys).
 *
 * Two clean sources invariant: recency = leader's OWN visits
 * (observation_type='leader_observation'); trend/score = teacher's OWN coaching
 * (observation_type IS NULL, status='completed').
 */

// ── supabase mockChain mock ─────────────────────────────────────────────────────
const mockRows = { leader_schools: [], leader_teachers: [], schools: [], users: [], coaching_sessions: [] };

function mockChain(table) {
  const state = { table, filters: [] };
  const p = new Promise((resolve) => { state.resolve = resolve; });
  const api = {
    select: () => api,
    eq: (col, val) => { state.filters.push(['eq', col, val]); return api; },
    in: (col, vals) => { state.filters.push(['in', col, vals]); return api; },
    is: (col, val) => { state.filters.push(['is', col, val]); return api; },
    order: () => api,
    maybeSingle: () => {
      const data = mockApplyFilters(state)[0] || null;
      return Promise.resolve({ data, error: null });
    },
    then: (onFulfilled, onRejected) =>
      Promise.resolve({ data: mockApplyFilters(state), error: null }).then(onFulfilled, onRejected),
  };
  return api;
}

function mockApplyFilters(state) {
  let out = mockRows[state.table] || [];
  for (const [op, col, val] of state.filters) {
    if (op === 'eq') out = out.filter((r) => r[col] === val);
    if (op === 'in') out = out.filter((r) => val.includes(r[col]));
    if (op === 'is') out = out.filter((r) => r[col] == null);
  }
  return out;
}

jest.mock('../../shared/config/supabase', () => ({ from: (t) => mockChain(t) }));
jest.mock('../../shared/services/coaching/coaching-trend.service', () => ({
  loadTrendData: jest.fn(async () => []),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const {
  listSchools, listTeachers, buildBrief,
  weakestAreaFromAnalysis, strongestAreaFromAnalysis, overallScoreFromAnalysis, areaLabel,
} = require('../../shared/services/observe/assignment/leader-source');
const { loadTrendData } = require('../../shared/services/coaching/coaching-trend.service');

const LEADER = 'coach-uuid-1';

const FICO_ANALYSIS = {
  framework: 'fico',
  domains: {
    lesson_plan_fidelity: { area_score: 12, area_max: 40, indicators: [] },
    high_leverage_practices: { area_score: 40, area_max: 48, indicators: [] },
    student_engagement: { area_score: 20, area_max: 28, indicators: [] },
    teacher_subject_knowledge: { area_score: 24, area_max: 32, indicators: [] },
  },
  scores: { overall_marks: 96, overall_max_marks: 148, overall_percentage: 65 },
};

beforeEach(() => {
  mockRows.leader_schools = [
    { leader_user_id: LEADER, school_ext_id: 'niete:401', school_name: 'IMCB Bhara Kau', emis: '401' },
  ];
  // The patch is DERIVED now: leader_schools x schools x users.school_id.
  // leader_teachers is no longer read, so the people live on `users`.
  mockRows.schools = [{ id: 's401', name: 'IMCB Bhara Kau', emis: '401' }];
  mockRows.users = [
    { id: 'teacher-1', phone_number: '923331234567', first_name: 'Abid Ullah',
      role: 'teacher', school_id: 's401', training_bands: ['HIGH'],
      preferred_language: 'ur', grades_taught: null },
    // Registered but never coached — the "no activity yet" case. Under the old
    // model this row did not exist at all and the teacher carried user_id null;
    // a derived patch cannot produce someone who is not a user.
    { id: 'teacher-2', phone_number: '923337654321', first_name: 'Not Yet Coached',
      role: 'teacher', school_id: 's401', training_bands: ['PRIMARY'],
      preferred_language: 'ur', grades_taught: null },
    { id: LEADER, phone_number: '923268124132', role: 'coach', preferred_language: 'ur' },
  ];
  mockRows.coaching_sessions = [
    // teacher's OWN AI coaching (trend/score source)
    { user_id: 'teacher-1', observation_type: null, status: 'completed', analysis_data: FICO_ANALYSIS, created_at: '2026-07-20T10:00:00Z' },
    // leader's visit (recency source)
    { user_id: 'teacher-1', observation_type: 'leader_observation', observer_user_id: LEADER, status: 'completed', created_at: '2026-07-01T10:00:00Z', analysis_data: null },
  ];
});

describe('FICO analysis shape (the bd-2300 regression class)', () => {
  test('weakest/strongest resolve from FICO domains keys', () => {
    expect(weakestAreaFromAnalysis(FICO_ANALYSIS)).toBe('lesson_plan_fidelity'); // 12/40 = .30
    expect(strongestAreaFromAnalysis(FICO_ANALYSIS)).toBe('high_leverage_practices'); // 40/48 = .83
  });

  test('overall score = mean of FICO area ratios', () => {
    const s = overallScoreFromAnalysis(FICO_ANALYSIS);
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThan(0.8);
  });

  // bd-2456 — the LIVE FICO analyzer writes domain_score/domain_max (verified
  // against prod rows), NOT area_score/area_max as the fixture above assumed.
  // _slotRatio must resolve this shape too, or every real NIETE teacher's
  // growth/strength degrades to noData and the score survives only via the
  // overall_percentage fallback.
  const LIVE_FICO_ANALYSIS = {
    framework: 'fico',
    domains: {
      student_engagement: { domain_score: 21, domain_max: 28 },
      lesson_plan_fidelity: { domain_score: 24, domain_max: 40 },
      high_leverage_practices: { domain_score: 28, domain_max: 48 },
      teacher_subject_knowledge: { domain_score: 19, domain_max: 32 },
    },
    scores: { overall_percentage: 62.2 },
  };

  test('LIVE FICO shape (domain_score/domain_max) resolves weakest/strongest (bd-2456)', () => {
    expect(weakestAreaFromAnalysis(LIVE_FICO_ANALYSIS)).toBe('high_leverage_practices'); // 28/48 = .58
    expect(strongestAreaFromAnalysis(LIVE_FICO_ANALYSIS)).toBe('student_engagement');    // 21/28 = .75
  });

  test('LIVE FICO shape yields a per-area mean score, not just the percentage fallback (bd-2456)', () => {
    const s = overallScoreFromAnalysis(LIVE_FICO_ANALYSIS);
    // mean of .75, .60, .583, .594 ≈ .632 — distinct from the .622 fallback,
    // proving the ratios (not overall_percentage) produced it.
    expect(s).toBeGreaterThan(0.625);
    expect(s).toBeLessThan(0.64);
  });

  test('falls back to scores.overall_percentage when domains malformed', () => {
    expect(overallScoreFromAnalysis({ scores: { overall_percentage: 65 } })).toBeCloseTo(0.65);
    expect(overallScoreFromAnalysis({})).toBeNull();
    expect(overallScoreFromAnalysis(null)).toBeNull();
  });

  test('area labels resolve in en and ur (never blank)', () => {
    for (const key of ['lesson_plan_fidelity', 'high_leverage_practices', 'student_engagement', 'teacher_subject_knowledge']) {
      expect(areaLabel(key, 'en')).toBeTruthy();
      expect(areaLabel(key, 'ur')).toBeTruthy();
      expect(areaLabel(key, 'ur')).not.toBe(areaLabel(key, 'en'));
    }
  });

  test('HOTS goalN_* shape still resolves (upstream parity kept)', () => {
    const hots = { goal1_formative_assessment: { area_score: 2, area_max: 12 }, goal2_student_engagement: { area_score: 10, area_max: 12 } };
    expect(weakestAreaFromAnalysis(hots)).toBe('assessment_feedback');
  });
});

describe('listSchools / listTeachers', () => {
  test('listSchools carries teacherCount + dueCount (never-visited counts as due)', async () => {
    const out = await listSchools(LEADER, { today: '2026-07-31' });
    expect(out).toHaveLength(1);
    expect(out[0].teacherCount).toBe(2);
    // teacher-1 visited 30d ago → due; Off-Rumi never → new → both count
    expect(out[0].dueCount).toBe(2);
  });

  test('listTeachers: off-Rumi teacher still appears; FICO score drives needsSupport ordering fields', async () => {
    const out = await listTeachers(LEADER, 'niete:401', { today: '2026-07-31' });
    expect(out).toHaveLength(2);
    const onRumi = out.find((t) => t.teacher_ext_id === '923331234567');
    const offRumi = out.find((t) => t.teacher_ext_id === '923337654321');
    expect(onRumi.user_id).toBe('teacher-1');
    expect(onRumi.score).toBeGreaterThan(0);
    expect(onRumi.growthAreaKey).toBe('lesson_plan_fidelity');
    expect(onRumi.level).toBe('HIGH');
    // Was `toBeNull()`: the old stored roster could hold someone with no Rumi
    // account. A derived patch reads FROM users, so everyone has an id. The
    // behaviour that matters — an uncoached teacher still appears and sorts as
    // new — is unchanged.
    expect(offRumi.user_id).toBe('teacher-2');
    expect(offRumi.priority).toBe('new');
  });
});

describe('buildBrief', () => {
  test('FICO teacher gets a RICH brief (not no-data) with leader-language labels', async () => {
    const brief = await buildBrief(LEADER, '923331234567', 'niete:401');
    expect(brief.noData).toBe(false);
    expect(brief.growthLabel).toBeTruthy();
    expect(brief.strengthLabel).toBeTruthy();
    // leader (ur) reads the brief → Urdu labels
    expect(/[؀-ۿ]/.test(brief.growthLabel)).toBe(true);
    expect(brief.moves.length).toBeGreaterThanOrEqual(3);
  });

  test('no coaching data → honest opening-tips variant', async () => {
    mockRows.coaching_sessions = [];
    const brief = await buildBrief(LEADER, '923337654321', 'niete:401');
    expect(brief.noData).toBe(true);
    expect(brief.strengthLabel).toBeNull();
    expect(brief.moves.length).toBeGreaterThanOrEqual(3);
    expect(brief.firstVisit).toBe(true);
  });

  test('never throws — degrades to opening tips on internal failure', async () => {
    loadTrendData.mockRejectedValueOnce(new Error('boom'));
    const brief = await buildBrief(LEADER, '923331234567', 'niete:401');
    expect(brief.noData).toBe(true);
    expect(brief.moves.length).toBeGreaterThanOrEqual(3);
  });
});
