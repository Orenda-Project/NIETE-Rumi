/**
 * The scoring call receives the teacher's prior action record ONLY when the
 * loop is enabled. RED FIRST — metadata.priorAction does not exist yet.
 */
jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder), update: jest.fn(() => builder), eq: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__UL_SESSION, error: null })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: { users: { preferred_language: 'en' } }, error: null })),
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return { from: jest.fn(() => builder) };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ PEDAGOGICAL_ANALYSIS_MEDIA_ID: null }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => {}), sendSticker: jest.fn(async () => {}) }));
const mockAnalyze = jest.fn(async () => ({ analysis: { executive_summary: 'ok', framework: 'fico' }, usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 0, cost: 0 } }));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ analyzePedagogy: (...a) => mockAnalyze(...a), extractReflectiveCorpus: jest.fn(async () => null) }));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({ updateStatus: jest.fn(async () => {}), markAsFailed: jest.fn(async () => {}) }));
jest.mock('../../bot/shared/services/coaching/report-generator.service', () => ({ fetchAndCompressPriorFeedback: jest.fn(async () => ({ exists: false })) }));
jest.mock('../../bot/shared/services/coaching/frameworks/framework-selector', () => ({ selectFrameworkWithReason: jest.fn(async () => ({ framework: { name: 'fico', applyLpFidelity: jest.fn() }, frameworkKey: 'fico', reason: 'default' })) }));
jest.mock('../../bot/shared/config/coaching-messages', () => ({ getCoachingMessage: jest.fn(() => 'msg') }));
jest.mock('../../bot/shared/services/coaching/reflective-conversation.service', () => ({ conductReflectiveConversation: jest.fn(async () => {}) }));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({ queueReport: jest.fn(async () => {}) }));
const mockLoadPrior = jest.fn(async () => null);
jest.mock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadPriorAction: (...a) => mockLoadPrior(...a), loadTrendData: jest.fn(async () => []) }));

const AnalysisProcessor = require('../../bot/shared/services/coaching/analysis-processor.service');
const SID = 'sess-ul-1';
const PRIOR = { target: { indicator: 'C3', domain: 'high_leverage_practices', name: 'Effective Feedback' }, action: 'x', action_spec: { count_target: { specific_feedback_moves: 3, next_step_feedback: 1 } }, attempt: 1, angle: 'tell', target_status: 'open', session_id: 'sess-ul-0', created_at: '2026-09-01T00:00:00Z' };

beforeEach(() => { jest.clearAllMocks(); global.__UL_SESSION = { id: SID, user_id: 'u1', transcript_text: 't', transcript_language: 'en', classroom_photos: [], users: { phone_number: '92300', first_name: 'A', last_name: 'B' } }; });
afterEach(() => { delete process.env.UPTAKE_LOOP_ENABLED; });

describe('metadata.priorAction into the scoring call', () => {
  test('loop ON: the prior record (excluding this session) is attached to metadata', async () => {
    process.env.UPTAKE_LOOP_ENABLED = 'true';
    mockLoadPrior.mockResolvedValue(PRIOR);
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(mockLoadPrior).toHaveBeenCalledWith('u1', expect.objectContaining({ excludeSessionId: SID }));
    expect(mockAnalyze.mock.calls[0][1].priorAction).toEqual(PRIOR);
  });
  test('loop OFF: no lookup, priorAction null', async () => {
    delete process.env.UPTAKE_LOOP_ENABLED;
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(mockLoadPrior).not.toHaveBeenCalled();
    expect(mockAnalyze.mock.calls[0][1].priorAction).toBeNull();
  });
});
