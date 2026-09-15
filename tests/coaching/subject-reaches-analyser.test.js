/**
 * The subject reaches the analyser, and what was decided is persisted.
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
      eq: jest.fn(() => builder),
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
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
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

const SID = 'sess-subject';
function session(extra = {}) {
  return {
    id: SID,
    user_id: 'u-1',
    observation_type: 'self_observation',
    transcript_text: 'transcript',
    transcript_language: 'ur',
    audio_duration_seconds: 960,
    classroom_photos: [],
    users: { name: 'Ayesha', phone_number: '92300' },
    ...extra,
  };
}
const metaHandedToModel = () => mockAnalyze.mock.calls[0][1];
const lastAnalysisData = () => [...persisted].reverse().find((p) => p && p.analysis_data)?.analysis_data;

beforeEach(() => {
  jest.clearAllMocks();
  persisted.length = 0;
  tablesQueried.length = 0;
  mockDownloadRows = [];
});

describe('the uploaded-LP path — HIGH confidence', () => {
  test('lesson_plan_structured.subject reaches the analyser as a canonical code', async () => {
    global.__SUBJ_SESSION = session({
      lesson_plan_structured: { subject: 'Urdu', grade_level: '1', topic: 't' },
    });
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });

    const meta = metaHandedToModel();
    expect(meta.subject).toBe('urdu');
    expect(meta.grade).toBe('1');
    expect(meta.subjectConfidence).toBe('high');
  });
});

describe('the corpus path — the stub has no subject key, the lesson_id does', () => {
  test('a _fidelity_ref stub still yields a subject (would be null if only lessonPlanSubject were wired)', async () => {
    global.__SUBJ_SESSION = session({
      lesson_plan_structured: {
        _fidelity_ref: { lesson_id: 'grade_4_urdu_ch8_seg3', version_stamp: 'v8', content_hash: 'h' },
      },
    });
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });

    const meta = metaHandedToModel();
    expect(meta.lessonPlanSubject).toBeNull();   // the stub carries none — this is the trap
    expect(meta.subject).toBe('urdu');
    expect(meta.grade).toBe('4');
    expect(meta.subjectConfidence).toBe('medium');
  });

  test('a _fidelity_ref written WITH a subject (the stub fix) is used directly', async () => {
    global.__SUBJ_SESSION = session({
      lesson_plan_structured: {
        _fidelity_ref: { lesson_id: 'grade_2_general_science_ch1_seg1', subject: 'general_science', grade: 2 },
      },
    });
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(metaHandedToModel().subject).toBe('science');
    expect(metaHandedToModel().subjectConfidence).toBe('medium');
  });
});

describe('the no-signal path — the safe default, made visible', () => {
  test('no plan and no download → no subject, confidence none, and a flag for the report', async () => {
    global.__SUBJ_SESSION = session({ lesson_plan_structured: null });
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });

    const meta = metaHandedToModel();
    expect(meta.subject).toBeNull();
    expect(meta.subjectConfidence).toBe('none');

    const ad = lastAnalysisData();
    expect(ad.subject_resolution).toEqual(expect.objectContaining({
      confidence: 'none', code: null, source: 'no_signal', subject_unconfirmed: true,
    }));
  });

  test('the downloads table is consulted only when the plan signals miss', async () => {
    global.__SUBJ_SESSION = session({ lesson_plan_structured: { subject: 'Urdu' } });
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(tablesQueried).not.toContain('niete_lp_downloads');
  });

  test('one distinct recent download subject → MEDIUM', async () => {
    mockDownloadRows = [
      { subject: 'Maths', grade: 3, created_at: new Date().toISOString() },
      { subject: 'maths', grade: 3, created_at: new Date().toISOString() },
    ];
    global.__SUBJ_SESSION = session({ lesson_plan_structured: null });
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });

    expect(tablesQueried).toContain('niete_lp_downloads');
    expect(metaHandedToModel().subject).toBe('maths');
    expect(metaHandedToModel().subjectConfidence).toBe('medium');
  });
});

describe('what was decided is persisted, so the population is measurable', () => {
  test('analysis_data.subject_resolution records code, confidence, source and the F row', async () => {
    global.__SUBJ_SESSION = session({
      lesson_plan_structured: { subject: 'Urdu', grade_level: '1' },
    });
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });

    expect(lastAnalysisData().subject_resolution).toEqual({
      code: 'urdu',
      grade: '1',
      confidence: 'high',
      source: 'lesson_plan_structured',
      group: 'literacy',
      subject_unconfirmed: false,
    });
  });

  test('a subject with no rubric row is recorded as such — not as "we could not tell"', async () => {
    global.__SUBJ_SESSION = session({ lesson_plan_structured: { subject: 'Islamiat' } });
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });

    const sr = lastAnalysisData().subject_resolution;
    expect(sr.code).toBe('islamiat');
    expect(sr.group).toBeNull();
    expect(sr.confidence).toBe('high');
  });
});
