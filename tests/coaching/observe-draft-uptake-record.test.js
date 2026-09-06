/**
 * /observe writes the loop record too — in the SAME update as
 * observer_review_complete, from the coach-EDITED v2 — so a coach visit can
 * close or advance a target a self-serve lesson opened. RED FIRST.
 */
process.env.OBSERVE_FRAMEWORK = 'fico';
const mockUpdates = [];
const ok = (id, score) => ({ id, name: id, score, applicable: true, evidence: 'e', evidence_summary: 'es' });
const V1 = {
  framework: 'fico',
  domains: {
    lesson_plan_fidelity: { indicators: [ok('B1', 2)] },
    high_leverage_practices: { indicators: [ok('C1', 2), ok('C3', 1)] },
    student_engagement: { indicators: [ok('D1', 1), ok('D2', 2)] },
    teacher_subject_knowledge: { indicators: [ok('F1', 2)] },
  },
  focus_area: { domain: 'high_leverage_practices', indicator: 'C3', try_this_tomorrow: 'name the next step after each wrong answer' },
  uptake: { count: { specific_feedback_moves: 3, next_step_feedback: 1 }, evidence: 'q', moment: 'm' },
};
const mockSession = { id: 'obs-1', user_id: 'teacher-1', observer_user_id: 'coach-1', observation_type: 'leader_observation', analysis_data: JSON.parse(JSON.stringify(V1)), autofill_analysis_data: JSON.parse(JSON.stringify(V1)), users: { phone_number: '1', first_name: 'T', preferred_language: 'en' } };
jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {};
  ['select', 'eq'].forEach((m) => { chain[m] = jest.fn(() => chain); });
  chain.single = jest.fn(async () => ({ data: mockSession, error: null }));
  chain.update = jest.fn((payload) => { mockUpdates.push(payload); return chain; });
  chain.then = (resolve) => resolve({ data: null, error: null });
  return { from: jest.fn(() => chain) };
});
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => {}), sendFlow: jest.fn(async () => {}) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({ getState: jest.fn(async () => null), setState: jest.fn(async () => {}) }));
const mockLoadPrior = jest.fn(async () => null);
jest.mock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadPriorAction: (...a) => mockLoadPrior(...a), loadTrendData: jest.fn(async () => []) }));

const draft = require('../../bot/shared/services/observe/observe-draft.service');
const PRIOR = {
  target: { indicator: 'C3', domain: 'high_leverage_practices', name: 'Effective Feedback' }, action: 'a',
  action_spec: { count_target: { specific_feedback_moves: 3, next_step_feedback: 1 } }, baseline: { rung: 1, count: { specific_feedback_moves: 1, next_step_feedback: 0 } },
  attempt: 2, angle: 'cue', achieved_streak: 1, target_status: 'open', lineage: ['s0'], session_id: 's1', created_at: '2026-09-02T00:00:00Z', instrument: 'self',
};
beforeEach(() => { mockUpdates.length = 0; jest.clearAllMocks(); });
afterEach(() => { delete process.env.UPTAKE_LOOP_ENABLED; });

describe('applyObserverEdits and the loop record', () => {
  test('loop ON: the record rides in the same update as observer_review_complete, built from the EDITED v2', async () => {
    process.env.UPTAKE_LOOP_ENABLED = 'true';
    mockLoadPrior.mockResolvedValue(PRIOR);
    await draft.applyObserverEdits('obs-1', { r_C3: '2' });   // the coach raised C3 to the top rung
    const final = mockUpdates.find((u) => u.status === 'observer_review_complete');
    expect(final).toBeDefined();
    expect(mockLoadPrior).toHaveBeenCalledWith('teacher-1', expect.objectContaining({ excludeSessionId: 'obs-1' }));
    const rec = final.prioritized_action;
    expect(rec).toBeDefined();
    expect(rec.instrument).toBe('observe');
    expect(rec.uptake.status).toBe('achieved');           // rung 2 after the coach's edit
    expect(rec.closed && rec.closed.indicator).toBe('C3'); // second consecutive achieved → closed
    expect(rec.target && rec.target.indicator).not.toBe('C3');
    expect(rec.action).toBeTruthy();                      // never an empty ask for the next PRIOR ACTION block
  });
  test('loop OFF: the update carries analysis_data + status only', async () => {
    delete process.env.UPTAKE_LOOP_ENABLED;
    await draft.applyObserverEdits('obs-1', { r_C3: '1' });
    const final = mockUpdates.find((u) => u.status === 'observer_review_complete');
    expect(final.prioritized_action).toBeUndefined();
    expect(mockLoadPrior).not.toHaveBeenCalled();
  });
});
