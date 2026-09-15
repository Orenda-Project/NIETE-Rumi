'use strict';
/**
 * The processor must mark Section B not-assessed on the sessions that have no
 * measurement — which is the whole point of the change, and the one place a
 * unit test on the framework cannot prove.
 *
 * The call site only invoked applyLpFidelity when the fidelity blob came back
 * `status: 'ok'`. That is the branch where the section IS measured. On the
 * dominant case — `lp_absent`, 3,866 of 4,640 unmeasured sessions — the function
 * was never called at all, so the section would keep its legacy proxy score and
 * stay inside the total no matter what the framework says. Defined is not live:
 * the exclusion has to be reachable from processAnalysis.
 *
 * This drives the real processAnalysis with the network boundaries mocked, and
 * asserts on what gets persisted to analysis_data.
 */

jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn((patch) => { if (patch && patch.analysis_data) global.__PERSISTED = patch.analysis_data; return builder; }),
    eq: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__SESSION, error: null })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: { users: { preferred_language: 'en' } }, error: null })),
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

const rows = (prefix, n, score) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, score }));

// The analyser's own output: Section B scored by the ten legacy proxy indicators
// (20/40), C 36/48, D 21/28, F 16/32 — 93 of 148.
const mockAnalyze = jest.fn(() => Promise.resolve({
  analysis: fico.computeScores({
    framework: 'fico',
    domains: {
      lesson_plan_fidelity: { indicators: rows('B', 10, 2) },
      high_leverage_practices: { indicators: rows('C', 12, 3) },
      student_engagement: { indicators: rows('D', 7, 3) },
      teacher_subject_knowledge: { indicators: rows('F', 8, 2) },
    },
  }),
  usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 0, cost: 0 },
}));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: (...args) => mockAnalyze(...args),
  extractReflectiveCorpus: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('../../bot/shared/services/coaching/fidelity/fidelity-orchestrator', () => ({
  isFidelityEnabled: jest.fn(() => true),
  resolveFidelitySources: jest.fn(() => Promise.resolve({ ok: true, plan: { id: 'lp1' }, source: 'linked' })),
  computeLpFidelity: jest.fn(() => Promise.resolve(global.__FIDELITY)),
  fidelityPatch: jest.fn(() => ({})),
}));

const AnalysisProcessor = require('../../bot/shared/services/coaching/analysis-processor.service');

const SID = 'sess-notassessed';
beforeEach(() => {
  jest.clearAllMocks();
  global.__PERSISTED = undefined;
  global.__SESSION = {
    id: SID, user_id: 'u1', observation_type: 'self_observation',
    transcript_text: 't', transcript_language: 'en', classroom_photos: [],
    users: { phone_number: '92300', name: 'A B' },
  };
});

const sectionB = () => global.__PERSISTED.domains.lesson_plan_fidelity;

describe('processAnalysis marks Section B not-assessed when nothing was measured', () => {
  test('THE BUG: lp_absent reaches the framework, so the section leaves the total', async () => {
    global.__FIDELITY = { status: 'lp_absent' };
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(sectionB().assessed).toBe(false);
    expect(sectionB().not_assessed_reason).toBe('lp_absent');
    expect(global.__PERSISTED.scores.overall_max_marks).toBe(108);
    expect(global.__PERSISTED.scores.overall_marks).toBe(73);
  });

  test('a fidelity engine failure reaches it too', async () => {
    global.__FIDELITY = { status: 'fidelity_unavailable', error: 'lp_unparseable' };
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(sectionB().assessed).toBe(false);
    expect(sectionB().not_assessed_reason).toBe('fidelity_unavailable');
    expect(global.__PERSISTED.scores.overall_max_marks).toBe(108);
  });

  test('no fidelity result at all reaches it too', async () => {
    global.__FIDELITY = null;
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(sectionB().assessed).toBe(false);
    expect(global.__PERSISTED.scores.overall_max_marks).toBe(108);
  });

  test('a MEASURED session is derived from the measurement, as before', async () => {
    global.__FIDELITY = { status: 'ok', fidelity_pct: 60, band: 'partial' };
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(sectionB().assessed).toBe(true);
    expect(sectionB().fidelity_derived).toBe(true);
    expect(sectionB().domain_score).toBe(24);
    expect(global.__PERSISTED.scores.overall_max_marks).toBe(148);
  });
});
