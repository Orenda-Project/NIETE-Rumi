'use strict';
/**
 * bd-fmf24g.66 — a plan the COACH attached is read by a job that runs AT THE SAME TIME as the analysis (both are claimed by the
 * worker within a millisecond of each other; extraction takes ~100 s). Measured on sandbox, 12 Oct 2026: the analysis loaded the
 * session while the plan was still 'pending', graded Section B as lp_absent, and the plan's own late-LP recompute then found the
 * status 'analyzing' (not recomputable) and did nothing. So a coach's own plan was read, stored, and never scored.
 *
 * The analysis, once it has written its result and handed the draft to the coach, now looks at the plan again: when it was
 * pending at load and has completed since, it recomputes Section B (the same function the extraction uses). When the plan is
 * still pending, the extraction's own recompute will run, because the status is recomputable by then.
 * Drives the real processAnalysis with the network boundaries mocked.
 */


jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn((patch) => { if (patch && patch.analysis_data) global.__PERSISTED = patch.analysis_data; return builder; }),
    eq: jest.fn(() => builder), not: jest.fn(() => builder), // .not: the terminal guard's predicate (bd-n9832)
    
    single: jest.fn(() => Promise.resolve({ data: global.__SESSION, error: null })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: { users: { preferred_language: 'en' }, lesson_plan_extraction_status: global.__EXTRACTION_NOW }, error: null })),
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return { from: jest.fn(() => builder) };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ PEDAGOGICAL_ANALYSIS_MEDIA_ID: null }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve()), sendSticker: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: jest.fn(() => Promise.resolve()), markAsFailed: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/report-generator.service', () => ({
  fetchAndCompressPriorFeedback: jest.fn(() => Promise.resolve({ exists: false })),
}));
jest.mock('../../bot/shared/config/coaching-messages', () => ({ getCoachingMessage: jest.fn(() => 'msg') }));
jest.mock('../../bot/shared/services/coaching/reflective-conversation.service', () => ({
  conductReflectiveConversation: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueReport: jest.fn(() => Promise.resolve()),
}));

const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');

jest.mock('../../bot/shared/services/coaching/frameworks/framework-selector', () => ({
  selectFrameworkWithReason: jest.fn(() => Promise.resolve({
    framework: require('../../bot/shared/services/coaching/frameworks/fico-framework'),
    frameworkKey: 'fico',
    reason: 'default',
  })),
}));


const mockAnalyze = jest.fn(() => Promise.resolve({
  analysis: { framework: 'fico', domains: {}, scores: {} },
  usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 0, cost: 0 },
}));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: (...args) => mockAnalyze(...args),
  extractReflectiveCorpus: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../../bot/shared/services/coaching/fidelity/fidelity-orchestrator', () => ({
  isFidelityEnabled: jest.fn(() => false),
  resolveFidelitySources: jest.fn(() => ({ corpusKey: null, uploadedText: null, meta: {} })),
  computeLpFidelity: jest.fn(() => Promise.resolve(null)),
  fidelityPatch: jest.fn(() => ({})),
}));
const mockOnReady = jest.fn(() => Promise.resolve());
jest.mock('../../bot/shared/services/observe/observe-draft.service', () => ({ onAnalysisReady: (...a) => mockOnReady(...a) }));
const mockRecompute = jest.fn(() => Promise.resolve({ recomputed: true }));
jest.mock('../../bot/shared/services/coaching/fidelity/fidelity-recompute.service', () => ({
  recomputeFidelityForSession: (...a) => mockRecompute(...a),
}));

const AnalysisProcessor = require('../../bot/shared/services/coaching/analysis-processor.service');

const SID = 'sess-late-plan';
const order = [];
beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  mockOnReady.mockImplementation(() => { order.push('draft'); return Promise.resolve(); });
  mockRecompute.mockImplementation(() => { order.push('recompute'); return Promise.resolve({ recomputed: true }); });
  global.__EXTRACTION_NOW = 'completed';
  global.__SESSION = {
    id: SID, user_id: 'teacher-1', observation_type: 'leader_observation', observer_user_id: 'coach-1',
    transcript_text: 't', transcript_language: 'en', classroom_photos: [],
    has_lesson_plan: true, lesson_plan_extraction_status: 'pending',
    users: { phone_number: '92300', name: 'A B' },
  };
});

describe('a coach observation whose plan lands while the analysis runs', () => {
  test('THE BUG: pending at load, completed by the end -> Section B is recomputed, after the draft is handed over', async () => {
    await AnalysisProcessor.processAnalysis(SID, { from: '92300', lpUploaded: true });
    expect(mockOnReady).toHaveBeenCalledTimes(1);
    expect(mockRecompute).toHaveBeenCalledTimes(1);
    expect(mockRecompute).toHaveBeenCalledWith(SID);
    expect(order).toEqual(['draft', 'recompute']);
  });

  test('still pending at the end: no recompute here (the extraction runs its own once it is done)', async () => {
    global.__EXTRACTION_NOW = 'pending';
    await AnalysisProcessor.processAnalysis(SID, { from: '92300', lpUploaded: true });
    expect(mockRecompute).not.toHaveBeenCalled();
  });

  test('the plan was not pending at load (read already, or none): nothing extra, nothing re-read', async () => {
    global.__SESSION.lesson_plan_extraction_status = 'completed';
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(mockRecompute).not.toHaveBeenCalled();
    global.__SESSION.lesson_plan_extraction_status = null;
    global.__SESSION.has_lesson_plan = false;
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(mockRecompute).not.toHaveBeenCalled();
  });

  test("a teacher's own recording (not a coach observation) is not touched by this", async () => {
    global.__SESSION.observation_type = null;
    await AnalysisProcessor.processAnalysis(SID, { from: '92300', lpUploaded: true, skipReflection: true });
    expect(mockRecompute).not.toHaveBeenCalled();
  });

  test('a recompute that throws never fails the analysis job', async () => {
    mockRecompute.mockRejectedValue(new Error('boom'));
    await expect(AnalysisProcessor.processAnalysis(SID, { from: '92300', lpUploaded: true })).resolves.toBeUndefined();
  });
});
