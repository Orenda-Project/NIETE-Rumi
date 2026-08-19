/**
 * bd-gr48y (processor) — when a session has classroom photos, processAnalysis must
 * run the vision pass and hand analyzePedagogy a `metadata.photoAnalysis` that is
 * labelled as photo-sourced. No photos → no photoAnalysis (unchanged).
 */

jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__GR48Y_SESSION, error: null })),
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
const mockAnalyze = jest.fn(() => Promise.resolve({
  analysis: { executive_summary: 'ok' },
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
  selectFrameworkWithReason: jest.fn(() => Promise.resolve({ framework: { name: 'fico' }, frameworkKey: 'fico', reason: 'default' })),
}));
jest.mock('../../bot/shared/config/coaching-messages', () => ({ getCoachingMessage: jest.fn(() => 'msg') }));
jest.mock('../../bot/shared/services/coaching/reflective-conversation.service', () => ({
  conductReflectiveConversation: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueReport: jest.fn(() => Promise.resolve()),
}));
const mockProcessPhoto = jest.fn(() => Promise.resolve('a bright board with the lesson objective and student work displayed'));
jest.mock('../../bot/shared/services/coaching/classroom-photo/photo-analysis.service', () => ({
  processClassroomPhoto: (...a) => mockProcessPhoto(...a),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(() => Promise.resolve(Buffer.from('img'))),
  extractKeyFromUrl: jest.fn((u) => u),
}));

const AnalysisProcessor = require('../../bot/shared/services/coaching/analysis-processor.service');

const SID = 'sess-gr48y';
function baseSession(photos) {
  return {
    id: SID, user_id: 'u1', observation_type: 'self_observation',
    transcript_text: 't', transcript_language: 'en',
    classroom_photos: photos,
    users: { phone_number: '92300', first_name: 'A', last_name: 'B' },
  };
}

beforeEach(() => { jest.clearAllMocks(); });

describe('bd-gr48y — processor runs the vision pass and feeds analyzePedagogy', () => {
  test('with 2 photos: processClassroomPhoto runs and analyzePedagogy gets labelled photoAnalysis', async () => {
    global.__GR48Y_SESSION = baseSession([{ url: 'r2://a.jpg' }, { url: 'r2://b.jpg' }]);
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });

    expect(mockProcessPhoto).toHaveBeenCalledTimes(2);
    expect(mockAnalyze).toHaveBeenCalledTimes(1);
    const metaArg = mockAnalyze.mock.calls[0][1];
    expect(metaArg.photoAnalysis).toContain('submitted by the teacher');
    expect(metaArg.photoAnalysis).toContain('lesson objective');
  });

  test('with no photos: no vision pass, photoAnalysis is null', async () => {
    global.__GR48Y_SESSION = baseSession([]);
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });

    expect(mockProcessPhoto).not.toHaveBeenCalled();
    const metaArg = mockAnalyze.mock.calls[0][1];
    expect(metaArg.photoAnalysis == null).toBe(true);
  });
});
