/**
 * Queue #282 / bd-ra8xu.64.2 — the coach's visit picker and Support Brief when the teacher's newest self-recording was
 * scored on FICO17 v6 (the 11). Her lesson is AI-coaching history: the brief must not say "no coaching data", and her
 * strength / growth area come from that lesson's own sections (v6_teacher / v6_children / v6_subject). The picker's
 * "needs support" score stays a V3 number only (a v6 score is never one), and the V3 journey line never takes a v6 point.
 *
 * The database is the boundary: supabase is the only thing mocked (plus the logger).
 */
const mockRows = { leader_schools: [], schools: [], users: [], coaching_sessions: [] };

function mockChain(table) {
  const filters = [];
  const api = {
    select: () => api,
    eq: (col, val) => { filters.push(['eq', col, val]); return api; },
    in: (col, vals) => { filters.push(['in', col, vals]); return api; },
    is: (col) => { filters.push(['is', col]); return api; },
    not: () => api,
    order: () => api,
    limit: () => api,
    maybeSingle: () => Promise.resolve({ data: apply()[0] || null, error: null }),
    then: (ok, ko) => Promise.resolve({ data: apply(), error: null }).then(ok, ko),
  };
  function apply() {
    let out = mockRows[table] || [];
    for (const [op, col, val] of filters) {
      if (op === 'eq') out = out.filter((r) => r[col] === val);
      if (op === 'in') out = out.filter((r) => val.includes(r[col]));
      if (op === 'is') out = out.filter((r) => r[col] == null);
    }
    return out;
  }
  return api;
}

jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockChain(t) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const { buildBrief, listTeachers } = require('../../bot/shared/services/observe/assignment/leader-source');

const LEADER = 'coach-1';
const PHONE = '92' + '000' + '0000001';

/** A switched-on self-recording: C 8/16 (weakest), D every row couldn't-tell, F 9/12 (strongest); no V3 keys. */
const V6 = {
  framework: 'fico17_v6', rubric: 'fico17_v6', indicator_set: 'dc11',
  scores: { overall_marks: 17, overall_max_marks: 28, overall_percentage: 60.7, counted: 7, rubric: 'fico17_v6' },
  domains: {
    v6_teacher: { key: 'C', name: 'What the teacher does', domain_score: 8, domain_max: 16, indicators: [] },
    v6_children: { key: 'D', name: 'What the children do', domain_score: 0, domain_max: 0, indicators: [] },
    v6_subject: { key: 'F', name: 'Subject knowledge', domain_score: 9, domain_max: 12, indicators: [] },
  },
};
/** An older V3 lesson: the journey line's point. Its weakest section is D, unlike the v6 lesson's. */
const V3 = {
  framework: 'fico',
  domains: {
    high_leverage_practices: { domain_score: 40, domain_max: 48 },
    student_engagement: { domain_score: 10, domain_max: 28 },
    teacher_subject_knowledge: { domain_score: 30, domain_max: 32 },
  },
  scores: { overall_marks: 80, overall_max_marks: 108, overall_percentage: 74 },
};

beforeEach(() => {
  mockRows.leader_schools = [{ leader_user_id: LEADER, school_ext_id: 'niete:401', school_id: 's401', school_name: 'School 401', emis: '401' }];
  mockRows.schools = [{ id: 's401', name: 'School 401', emis: '401' }];
  mockRows.users = [
    { id: 't1', phone_number: PHONE, first_name: 'Teacher One', role: 'teacher', school_id: 's401', teacher_level: ['PRIMARY'], preferred_language: 'en', grades_taught: null },
    { id: LEADER, phone_number: '92' + '000' + '0000091', role: 'coach', preferred_language: 'en' },
  ];
  mockRows.coaching_sessions = [];
});

describe('queue #282 / bd-ra8xu.64.2: a v6 self-recording is AI-coaching history in the Support Brief', () => {
  test('her only self-recording is v6: not "no coaching data"; growth and strength from its own sections', async () => {
    mockRows.coaching_sessions = [
      { user_id: 't1', observation_type: null, status: 'completed', analysis_data: V6, created_at: '2026-11-24T10:00:00Z' },
    ];
    const brief = await buildBrief(LEADER, PHONE, 'niete:401');
    expect(brief.noData).toBe(false);
    expect(brief.growthLabel).toBe('high-leverage teaching practices');
    expect(brief.strengthLabel).toBe('subject knowledge & explanations');
    expect(brief.moves.length).toBeGreaterThan(0);
    // the V3 journey line never takes a v6 point
    expect(brief.trend).toEqual([]);
  });

  test('newest v6, older V3: the brief reads the newest lesson; the journey keeps the V3 point only', async () => {
    mockRows.coaching_sessions = [
      { id: 's2', user_id: 't1', observation_type: null, status: 'completed', analysis_data: V6, created_at: '2026-11-24T10:00:00Z' },
      { id: 's1', user_id: 't1', observation_type: null, status: 'completed', analysis_data: V3, created_at: '2026-11-01T10:00:00Z' },
    ];
    const brief = await buildBrief(LEADER, PHONE, 'niete:401');
    expect(brief.noData).toBe(false);
    expect(brief.growthLabel).toBe('high-leverage teaching practices');
    expect(brief.trend.map((p) => p.pct)).toEqual([74]);
  });

  test('the picker: her growth area from the v6 lesson; her "needs support" score stays null (never a v6 number)', async () => {
    mockRows.coaching_sessions = [
      { user_id: 't1', observation_type: null, status: 'completed', analysis_data: V6, created_at: '2026-11-24T10:00:00Z' },
    ];
    const rows = await listTeachers(LEADER, 'niete:401');
    const me = rows.find((r) => r.user_id === 't1');
    expect(me.growthAreaKey).toBe('high_leverage_practices');
    expect(me.score).toBeNull();
  });
});
