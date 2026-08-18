/**
 * bd-1sddt — report-only recovery (skipReflection flag on the analysis job).
 *
 * The 18-Aug bug wave left ~156 sessions stranded at the photo/LP gate: audio
 * transcribed fine, but the report never generated because the flow was waiting
 * on a photo/LP that never arrived. To recover them we re-queue `analysis` with
 * `skipReflection: true` — the FICO report is derived from the classroom audio,
 * so it is complete on the scoring side, and we do NOT want to re-open a
 * reflective conversation for a session the teacher has long since left.
 *
 * Invariants this test locks:
 *  1. skipReflection:true  → queueReport({partial, suppressPartialBanner}) is
 *     called and the reflective conversation is NEVER started.
 *  2. skipReflection unset → the normal flow runs: reflective conversation IS
 *     started (so NEW observations tomorrow are unaffected — the flag is opt-in).
 */

// Prevent require-time env throws.
jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__BD1SDDT_SESSION, error: null })),
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
  sendMessage: jest.fn(() => Promise.resolve()),
  sendSticker: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: jest.fn(() => Promise.resolve({
    analysis: { executive_summary: 'ok' },
    usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 0, cost: 0 },
  })),
  extractReflectiveCorpus: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: jest.fn(() => Promise.resolve()),
  markAsFailed: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/report-generator.service', () => ({
  fetchAndCompressPriorFeedback: jest.fn(() => Promise.resolve({ exists: false })),
}));
jest.mock('../../bot/shared/services/coaching/frameworks/framework-selector', () => ({
  selectFrameworkWithReason: jest.fn(() => Promise.resolve({
    framework: { name: 'fico' }, frameworkKey: 'fico', reason: 'default',
  })),
}));
jest.mock('../../bot/shared/config/coaching-messages', () => ({
  getCoachingMessage: jest.fn(() => 'msg'),
}));
jest.mock('../../bot/shared/services/coaching/reflective-conversation.service', () => ({
  conductReflectiveConversation: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueReport: jest.fn(() => Promise.resolve()),
}));

const AnalysisProcessor = require('../../bot/shared/services/coaching/analysis-processor.service');
const ReflectiveConversation = require('../../bot/shared/services/coaching/reflective-conversation.service');
const CoachingJobQueue = require('../../bot/shared/services/coaching/coaching-job-queue.service');

const SID = 'sess-1sddt';
function makeSession() {
  return {
    id: SID,
    user_id: 'user-1',
    observation_type: 'self_observation',
    transcript_text: 'transcript',
    transcript_language: 'en',
    users: { phone_number: '923001234567', first_name: 'A', last_name: 'B' },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.__BD1SDDT_SESSION = makeSession();
});

describe('bd-1sddt — skipReflection report-only recovery', () => {
  test('skipReflection:true → queues a report (partial, banner suppressed) and NEVER starts the reflection', async () => {
    await AnalysisProcessor.processAnalysis(SID, { from: '923001234567', skipReflection: true });

    expect(ReflectiveConversation.conductReflectiveConversation).not.toHaveBeenCalled();
    expect(CoachingJobQueue.queueReport).toHaveBeenCalledTimes(1);
    const [sid, meta] = CoachingJobQueue.queueReport.mock.calls[0];
    expect(sid).toBe(SID);
    expect(meta).toMatchObject({ partial: true, suppressPartialBanner: true });
  });

  test('skipReflection unset → normal flow: reflection IS started, no direct report queue (new obs unaffected)', async () => {
    await AnalysisProcessor.processAnalysis(SID, { from: '923001234567' });

    expect(ReflectiveConversation.conductReflectiveConversation).toHaveBeenCalledTimes(1);
    expect(CoachingJobQueue.queueReport).not.toHaveBeenCalled();
  });
});
