/**
 * leader-source.buildBrief carries the open target into the Support Brief
 * from the prior action record — behind the flag. RED FIRST.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const mockLoadPrior = jest.fn();
jest.mock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: jest.fn(async () => []), loadPriorAction: (...a) => mockLoadPrior(...a) }));
jest.mock('../../bot/shared/services/observe/patch-resolver.service', () => ({
  listPatchViaSupabase: jest.fn(async () => [{ teacher_ext_id: 'T1', teacher_name: 'Sana', teacher_phone_e164: '92300', school_ext_id: 'S1' }]),
  toLeaderSourceRow: (r) => r,
}));
jest.mock('../../bot/shared/services/observe/observe-support-moves', () => ({ buildMoves: jest.fn(async () => []), openingTips: jest.fn(() => []), KNOWN_AREAS: ['high_leverage_practices', 'student_engagement', 'lesson_plan_fidelity', 'teacher_subject_knowledge'] }));
jest.mock('../../bot/shared/config/supabase', () => {
  const ok = (id, score) => ({ id, name: id, score, applicable: true });
  const rows = {
    leader_schools: [{ school_ext_id: 'S1', school_name: 'GPS X', emis: '1' }],
    users: [{ id: 'u1', phone_number: '92300', preferred_language: 'ur', grades_taught: ['3'] }],
    coaching_sessions: [{ user_id: 'u1', created_at: '2026-09-02T00:00:00Z', analysis_data: { framework: 'fico', strengths: [{ title: 's' }], domains: { high_leverage_practices: { domain_score: 3, domain_max: 8, indicators: [ok('C1', 2), ok('C3', 1)] }, student_engagement: { domain_score: 4, domain_max: 4, indicators: [ok('D1', 2)] } } } }],
  };
  return { from: jest.fn((table) => {
    const chain = {};
    for (const m of ['select', 'eq', 'in', 'is', 'order', 'neq', 'not', 'limit']) chain[m] = jest.fn(() => chain);
    chain.maybeSingle = jest.fn(async () => ({ data: { preferred_language: 'en' }, error: null }));
    chain.then = (resolve) => resolve({ data: rows[table] || [], error: null });
    return chain;
  }) };
});

const RECORD = { target: { indicator: 'C3', domain: 'high_leverage_practices', name: 'Effective Feedback' }, action: 'the ask', attempt: 2, angle: 'cue', target_status: 'open', uptake: { status: 'partial' }, session_id: 'p1', created_at: '2026-09-02T00:00:00Z', instrument: 'self' };
const LeaderSource = require('../../bot/shared/services/observe/assignment/leader-source');

beforeEach(() => { mockLoadPrior.mockReset(); mockLoadPrior.mockResolvedValue(RECORD); });
afterEach(() => { delete process.env.UPTAKE_LOOP_ENABLED; });

describe('buildBrief and the loop', () => {
  test('flag ON: brief.loop carries the target, the ask, the attempt and last status', async () => {
    process.env.UPTAKE_LOOP_ENABLED = 'true';
    const brief = await LeaderSource.buildBrief('coach-1', 'T1', 'S1');
    expect(mockLoadPrior).toHaveBeenCalledWith('u1', expect.objectContaining({ maxAgeDays: 30 }));
    expect(brief.loop).toMatchObject({ target_name: 'Effective Feedback', asked: 'the ask', attempt: 2, angle: 'cue', last_status: 'partial', hand_over: false, instrument: 'self' });
  });
  test('flag OFF: no lookup, loop null', async () => {
    delete process.env.UPTAKE_LOOP_ENABLED;
    const brief = await LeaderSource.buildBrief('coach-1', 'T1', 'S1');
    expect(mockLoadPrior).not.toHaveBeenCalled();
    expect(brief.loop).toBeNull();
  });
});
