/**
 * The carry step: at report time the loop grades the prior action, advances the
 * state and writes the record into prioritized_action — behind the flag.
 * RED FIRST: with the flag on, develop writes the bare card.
 */
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true), sendImage: jest.fn(async () => true), sendImageFromUrl: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true), sendDocument: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ TEMP_DIR: '/tmp/rumi-test-ul' }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadReportImage: jest.fn(async () => 'https://r2.example/report.png'), uploadReportPDF: jest.fn(async () => 'https://r2.example/report.pdf'),
  uploadImageWithRetry: jest.fn(async () => 'https://r2.example/card.png'), uploadVoiceDebrief: jest.fn(async () => 'https://r2.example/voice.mp3'),
}));
const mockCard = jest.fn(async () => ({ _source: 'llm', commitment: 'c', action: 'Next class, when a child answers wrongly, name the next step.', language: 'ur', indicator: 'C3' }));
jest.mock('../../bot/shared/services/coaching/coaching-card/commitment-card.service', () => ({ generateCommitmentCard: (...a) => mockCard(...a) }));
jest.mock('../../bot/shared/config/coaching-card.config', () => ({ getCoachingCardCopy: jest.fn(() => ({ commitPrompt: 'Will you try this?', commitButtons: { yes: 'Yes', later: 'Later', no: 'No' }, cardFooter: 'Human Coach' })) }));
const mockLoadPrior = jest.fn(async () => null);
jest.mock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadPriorAction: (...a) => mockLoadPrior(...a), loadTrendData: jest.fn(async () => []) }));

const updates = [];
const ok = (id, score) => ({ id, name: id, score, applicable: true });
const ANALYSIS = {
  framework: 'fico',
  domains: {
    lesson_plan_fidelity: { indicators: [ok('B1', 2)] },
    high_leverage_practices: { indicators: [ok('C1', 2), ok('C3', 1)] },
    student_engagement: { indicators: [ok('D2', 2)] },
    teacher_subject_knowledge: { indicators: [ok('F1', 2)] },
  },
  focus_area: { domain: 'high_leverage_practices', indicator: 'C3', try_this_tomorrow: 'ہر غلط جواب کے بعد اگلا قدم بتائیں' },
  uptake: { count: { specific_feedback_moves: 2, next_step_feedback: 0 }, evidence: 'Quote: "…"', moment: 'minute 12' },
};
const mockSessionRow = {
  id: 'sess-1', user_id: 'user-1', status: 'analysis_complete', created_at: '2026-09-03T00:00:00Z',
  conversation_state: { questions: [] }, analysis_data: ANALYSIS, transcript_language: 'ur',
  users: { phone_number: '10000000000', first_name: 'Sana', last_name: 'N', region: 'ICT', preferred_language: 'ur' },
};
jest.mock('../../bot/shared/config/supabase', () => {
  const makeChain = () => {
    const chain = {};
    ['select', 'eq', 'not', 'neq', 'order', 'limit', 'in'].forEach((m) => { chain[m] = jest.fn(() => chain); });
    chain.single = jest.fn(async () => ({ data: mockSessionRow, error: null }));
    chain.maybeSingle = jest.fn(async () => ({ data: mockSessionRow, error: null }));
    chain.update = jest.fn((payload) => { updates.push(payload); return chain; });
    chain.then = (resolve) => resolve({ data: null, error: null });
    return chain;
  };
  return { from: jest.fn(() => makeChain()) };
});

const RG = require('../../bot/shared/services/coaching/report-generator.service');
const PRIOR = {
  target: { indicator: 'C3', domain: 'high_leverage_practices', name: 'Effective Feedback' },
  action: 'After every wrong answer, say one sentence that names the next step.',
  action_spec: { count_target: { specific_feedback_moves: 3, next_step_feedback: 1 } },
  baseline: { rung: 1, count: { specific_feedback_moves: 1, next_step_feedback: 0 } },
  attempt: 1, angle: 'tell', achieved_streak: 0, target_status: 'open', lineage: [], session_id: 'sess-0', created_at: '2026-09-02T00:00:00Z', instrument: 'self',
};

beforeEach(() => {
  updates.length = 0; jest.clearAllMocks();
  jest.spyOn(RG, 'enhanceAnalysisWithReflections').mockResolvedValue(JSON.parse(JSON.stringify(ANALYSIS)));
  jest.spyOn(RG, 'generatePDFReport').mockResolvedValue({ png: Buffer.from('PNG'), caption: 'cap' });
  jest.spyOn(RG, 'sendHeroImageReport').mockResolvedValue(true);
  jest.spyOn(RG, 'generateAndSendVoiceDebrief').mockResolvedValue(true);
});
afterEach(() => { jest.restoreAllMocks(); delete process.env.UPTAKE_LOOP_ENABLED; });

const recordWrite = () => updates.map((u) => u.prioritized_action).filter(Boolean).pop();

describe('the carry step at report time', () => {
  test('loop ON with a prior: verdict computed, state advanced, record written with the card', async () => {
    process.env.UPTAKE_LOOP_ENABLED = 'true';
    mockLoadPrior.mockResolvedValue(PRIOR);
    await RG.generateReport('sess-1', { from: '10000000000' });
    const rec = recordWrite();
    expect(rec).toBeDefined();
    expect(rec).toMatchObject({ commitment: 'c', _source: 'llm', target: { indicator: 'C3' }, attempt: 2, angle: 'cue', target_status: 'open', instrument: 'self' });
    expect(rec.uptake).toMatchObject({ status: 'partial', target: 'C3' });
    expect(rec.lineage).toEqual(['sess-0']);
    expect(rec.baseline.count).toEqual({ specific_feedback_moves: 2, next_step_feedback: 0 });
  });
  test('loop ON with no prior: a fresh target opens at attempt 1 / tell', async () => {
    process.env.UPTAKE_LOOP_ENABLED = 'true';
    mockLoadPrior.mockResolvedValue(null);
    await RG.generateReport('sess-1', { from: '10000000000' });
    expect(recordWrite()).toMatchObject({ target: { indicator: 'C3' }, attempt: 1, angle: 'tell', achieved_streak: 0, target_status: 'open' });
    expect(recordWrite().uptake).toBeNull();
  });
  test('the loop state reaches the card and the hero renderer', async () => {
    process.env.UPTAKE_LOOP_ENABLED = 'true';
    mockLoadPrior.mockResolvedValue(PRIOR);
    await RG.generateReport('sess-1', { from: '10000000000' });
    const cardOpts = mockCard.mock.calls[0][3];
    expect(cardOpts.loop && cardOpts.loop.state && cardOpts.loop.state.target.indicator).toBe('C3');
    expect(cardOpts.loop.status).toBe('partial');
    const heroArg = RG.generatePDFReport.mock.calls[0][4];
    expect(heroArg && heroArg.state && heroArg.state.attempt).toBe(2);
  });
  test('loop OFF: the record is the bare card — no target, no lookup', async () => {
    delete process.env.UPTAKE_LOOP_ENABLED;
    await RG.generateReport('sess-1', { from: '10000000000' });
    expect(mockLoadPrior).not.toHaveBeenCalled();
    const rec = recordWrite();
    expect(rec._source).toBe('llm');
    expect(rec.target).toBeUndefined();
    expect(mockCard.mock.calls[0][3].loop).toBeUndefined();
  });
  test('a lookup failure never sinks the report — the card still ships and the record has no target', async () => {
    process.env.UPTAKE_LOOP_ENABLED = 'true';
    mockLoadPrior.mockRejectedValue(new Error('db down'));
    await RG.generateReport('sess-1', { from: '10000000000' });
    expect(recordWrite()._source).toBe('llm');
  });
});
