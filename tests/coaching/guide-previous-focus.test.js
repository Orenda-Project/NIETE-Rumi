/**
 * The coach's debrief guide opens with the record: what the AI coach asked,
 * which attempt this is, what happened last lesson — and on a hand-over, that
 * this visit IS the hand-over. previousFocus had no caller before. RED FIRST.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const { buildGuidePrompt, buildFallbackGuide } = require('../../bot/shared/services/observe/observe-debrief-guide');

const V2 = { framework: 'fico', strengths: [{ title: 's', evidence: 'the strength moment' }], focus_area: { title: 'Next-step feedback', try_this_tomorrow: 'name the next step', lever_question: 'What made you…?' }, domains: {} };
const PF = { title: 'Effective Feedback', try_this_tomorrow: 'After every wrong answer, say one sentence that names the next step.', attempt: 2, status: 'partial', hand_over: false, instrument: 'self' };

describe('buildGuidePrompt', () => {
  test('en/ur: the PREVIOUS VISIT block carries the ask, the attempt and last lesson\'s verdict', () => {
    for (const language of ['en', 'ur']) {
      const p = buildGuidePrompt(V2, { language, previousFocus: PF });
      expect(p).toContain('PREVIOUS VISIT');
      expect(p).toContain(PF.try_this_tomorrow);
      expect(p).toMatch(/attempt 2/i);
      expect(p).toMatch(/partial/i);
      expect(p).not.toMatch(/hand-over/i);
    }
  });
  test('a hand-over opens the debrief with it', () => {
    const p = buildGuidePrompt(V2, { language: 'en', previousFocus: { ...PF, attempt: 5, hand_over: true } });
    expect(p).toMatch(/hand-over/i);
  });
  test('no previousFocus → no block', () => {
    expect(buildGuidePrompt(V2, { language: 'en' })).not.toContain('PREVIOUS VISIT');
  });
});

describe('buildFallbackGuide', () => {
  test('en/ur growth step recalls last time\'s ask when a record exists; unchanged otherwise', () => {
    const en = buildFallbackGuide(V2, { language: 'en', previousFocus: PF });
    expect(en.sections.growth.body).toMatch(/Last time/);
    expect(en.sections.growth.body).toContain(PF.try_this_tomorrow);
    const ur = buildFallbackGuide(V2, { language: 'ur', previousFocus: PF });
    expect(ur.sections.growth.body).toMatch(/پچھلی بار/);
    expect(ur.sections.growth.body).toContain(PF.try_this_tomorrow);
    expect(buildFallbackGuide(V2, { language: 'en' })).toEqual(buildFallbackGuide(V2, { language: 'en', previousFocus: null }));
  });
});

describe('startDebrief wires the record in, behind the flag', () => {
  const mockSession = { id: 'obs-9', user_id: 'teacher-1', observer_user_id: 'coach-1', debrief_status: 'pending', analysis_data: V2, prioritized_action: { target: { indicator: 'C3' }, attempt: 3, angle: 'show', uptake: { status: 'not_seen' }, hand_over: false } };
  jest.mock('../../bot/shared/config/supabase', () => {
    const chain = {};
    for (const m of ['select', 'eq', 'update']) chain[m] = jest.fn(() => chain);
    chain.single = jest.fn(async () => ({ data: mockSession, error: null }));
    chain.then = (resolve) => resolve({ data: null, error: null });
    return { from: jest.fn(() => chain) };
  });
  const mockWA = { sendMessage: jest.fn(async () => {}) };
  jest.mock('../../bot/shared/services/whatsapp.service', () => mockWA);
  jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({ getState: jest.fn(async () => null), setState: jest.fn(async () => {}) }));
  const mockComplete = jest.fn(async () => { throw new Error('llm down → fallback guide'); });
  jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ completeJson: (...a) => mockComplete(...a) }));
  const PRIOR = { target: { indicator: 'C3', domain: 'high_leverage_practices', name: 'Effective Feedback' }, action: 'After every wrong answer, say one sentence that names the next step.', attempt: 2, angle: 'cue', target_status: 'open', session_id: 'p1', created_at: '2026-09-02T00:00:00Z', instrument: 'self' };
  const mockLoadPrior = jest.fn(async () => PRIOR);
  jest.mock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: jest.fn(async () => []), loadPriorAction: (...a) => mockLoadPrior(...a) }));
  afterEach(() => { delete process.env.UPTAKE_LOOP_ENABLED; jest.clearAllMocks(); });

  test('flag ON: the guide prompt carries the prior ask and this visit\'s verdict; the fallback guide recalls it too', async () => {
    process.env.UPTAKE_LOOP_ENABLED = 'true';
    const svc = require('../../bot/shared/services/observe/observe-debrief.service');
    await svc.startDebrief('obs-9', '92300', { id: 'coach-1', preferred_language: 'en' });
    expect(mockLoadPrior).toHaveBeenCalledWith('teacher-1', expect.objectContaining({ excludeSessionId: 'obs-9' }));
    const prompt = mockComplete.mock.calls[0][0];
    expect(prompt).toContain('PREVIOUS VISIT');
    expect(prompt).toContain(PRIOR.action);
    expect(prompt).toMatch(/not_seen|not seen/i);
    const sent = mockWA.sendMessage.mock.calls.map((c) => c[1]).join('\n');
    expect(sent).toContain(PRIOR.action);
  });
  test('flag OFF: no lookup, no block', async () => {
    delete process.env.UPTAKE_LOOP_ENABLED;
    const svc = require('../../bot/shared/services/observe/observe-debrief.service');
    await svc.startDebrief('obs-9', '92300', { id: 'coach-1', preferred_language: 'en' });
    expect(mockLoadPrior).not.toHaveBeenCalled();
    expect(mockComplete.mock.calls[0][0]).not.toContain('PREVIOUS VISIT');
  });
});
