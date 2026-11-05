/**
 * bd-fmf24g.9 — a teacher's class pick is the subject source for scoring.
 * (Same seam as subject-reaches-analyser.test.js.)
 *
 * Built on the seam bd-8s2xb-processor-photo-channel.test.js already uses: the model
 * boundary (gpt5-mini.analyzePedagogy) and supabase are mocked; the processor's own
 * metadata build, the resolver and the persist shape all run for real. The assertions
 * below execute analysis-processor.service.js's metadata block — the changed line —
 * rather than grepping its source.
 *
 * Load-bearing case: the CORPUS path. lesson_plan_structured is replaced there by a bare
 * {_fidelity_ref:{lesson_id,…}} stub with no `subject` key, so wiring only
 * `metadata.lessonPlanSubject` would still hand FICO null on 37.6% of sessions.
 */
const persisted = [];
let mockDownloadRows = [];
const tablesQueried = [];

jest.mock('../../bot/shared/config/supabase', () => {
  const makeBuilder = (table) => {
    const builder = {
      select: jest.fn(() => builder),
      update: jest.fn((patch) => { persisted.push(patch); return builder; }),
      eq: jest.fn(() => builder), not: jest.fn(() => builder), // .not: the terminal guard's predicate (bd-n9832)
      
      gte: jest.fn(() => builder),
      in: jest.fn(() => builder),
      order: jest.fn(() => builder),
      limit: jest.fn(() => builder),
      single: jest.fn(() => Promise.resolve({ data: global.__SUBJ_SESSION, error: null })),
      maybeSingle: jest.fn(() => Promise.resolve({ data: { users: { preferred_language: 'en' } }, error: null })),
      then: (resolve) => resolve(
        table === 'niete_lp_downloads'
          ? { data: mockDownloadRows, error: null }
          : { data: null, error: null },
      ),
    };
    return builder;
  };
  return { from: jest.fn((table) => { tablesQueried.push(table); return makeBuilder(table); }) };
});
const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
jest.mock('../../bot/shared/utils/constants', () => ({ PEDAGOGICAL_ANALYSIS_MEDIA_ID: null }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve()), sendSticker: jest.fn(() => Promise.resolve()),
}));
const mockAnalyze = jest.fn(() => Promise.resolve({
  analysis: { framework: 'fico', executive_summary: 'ok', domains: {} },
  usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 0, cost: 0 },
}));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: (...args) => mockAnalyze(...args),
  extractReflectiveCorpus: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: jest.fn(() => Promise.resolve()), markAsFailed: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/report-generator.service', () => ({
  fetchAndCompressPriorFeedback: jest.fn(() => Promise.resolve({ exists: false })),
}));
jest.mock('../../bot/shared/services/coaching/frameworks/framework-selector', () => ({
  selectFrameworkWithReason: jest.fn(() => Promise.resolve({
    framework: { name: 'fico', applyLpFidelity: jest.fn() }, frameworkKey: 'fico', reason: 'default',
  })),
}));
jest.mock('../../bot/shared/config/coaching-messages', () => ({ getCoachingMessage: jest.fn(() => 'msg') }));
jest.mock('../../bot/shared/services/coaching/reflective-conversation.service', () => ({
  conductReflectiveConversation: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueReport: jest.fn(() => Promise.resolve()),
}));

const AnalysisProcessor = require('../../bot/shared/services/coaching/analysis-processor.service');

const SID = 'sess-teacher-class';
function session(extra = {}) {
  return {
    id: SID, user_id: 'u-1', observation_type: 'self_observation', transcript_text: 'transcript',
    transcript_language: 'ur', audio_duration_seconds: 960, classroom_photos: [],
    users: { name: 'Ayesha', phone_number: '92300' },
    conversation_state: { teacher_class: { grade: 4, subject: 'Mathematics', subject_key: 'maths', picked_at: '2026-10-09T08:00:00.000Z' } },
    ...extra,
  };
}
const metaHandedToModel = () => mockAnalyze.mock.calls[0][1];
const lastAnalysisData = () => [...persisted].reverse().find((p) => p && p.analysis_data)?.analysis_data;
// On staging the analyser path reaches the Redis cache, which warns once when REDIS_URL is unset (tests never set it).
const warns = () => mockLog.mock.calls.filter((c) => c[2] === 'warn' && !/REDIS_URL not configured/.test(String(c[0])));

beforeEach(() => {
  jest.clearAllMocks();
  persisted.length = 0;
  tablesQueried.length = 0;
  mockDownloadRows = [];
});

describe('the pick reaches the analyser and is persisted', () => {
  test('no plan at all: subject/grade come from the pick, confidence high, downloads never consulted', async () => {
    global.__SUBJ_SESSION = session();
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(metaHandedToModel()).toMatchObject({ subject: 'maths', grade: '4', subjectConfidence: 'high' });
    expect(lastAnalysisData().subject_resolution).toEqual({
      code: 'maths', grade: '4', confidence: 'high', source: 'teacher', group: 'math', subject_unconfirmed: false,
    });
    expect(tablesQueried).not.toContain('niete_lp_downloads');
    expect(warns()).toHaveLength(0);
  });

  test('her pick wins over a plan that names another subject — and the disagreement is a warn, not an override', async () => {
    global.__SUBJ_SESSION = session({ lesson_plan_structured: { subject: 'Urdu', grade_level: '4', topic: 't' } });
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(metaHandedToModel()).toMatchObject({ subject: 'maths', subjectConfidence: 'high' });
    expect(lastAnalysisData().subject_resolution.source).toBe('teacher');
    const w = warns().find((c) => /teacher class/i.test(c[0]));
    expect(w).toBeDefined();
    expect(w[1]).toMatchObject({
      coachingSessionId: SID,
      teacher: { code: 'maths', grade: '4' },
      against: [{ code: 'urdu', source: 'lesson_plan_structured', confidence: 'high' }],
    });
  });

  test('the analysis inferring another subject is logged the same way; the score is still on her pick', async () => {
    mockAnalyze.mockResolvedValueOnce({
      analysis: { framework: 'hots', subject: 'English', domains: {} },
      usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 0, cost: 0 },
    });
    global.__SUBJ_SESSION = session();
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(lastAnalysisData().subject_resolution).toMatchObject({ code: 'maths', source: 'teacher' });
    const w = warns().find((c) => /teacher class/i.test(c[0]));
    expect(w[1].against).toEqual([{ code: 'english', source: 'analysis_inferred', confidence: 'inferred' }]);
  });

  test('without a pick everything is as before (no warn, plan signal used)', async () => {
    global.__SUBJ_SESSION = session({ conversation_state: { questions: [] }, lesson_plan_structured: { subject: 'Urdu', grade_level: '1' } });
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(metaHandedToModel()).toMatchObject({ subject: 'urdu', subjectConfidence: 'high' });
    expect(lastAnalysisData().subject_resolution.source).toBe('lesson_plan_structured');
    expect(warns()).toHaveLength(0);
  });
});
