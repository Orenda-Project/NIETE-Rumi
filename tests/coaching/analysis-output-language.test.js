/**
 * The analysis prompt and the reflective-corpus extraction are addressed to the
 * TEACHER, so they must run in HER stored language — not in whatever label the
 * transcriber attached to the audio.
 *
 * What the transcriber heard is still real information, so it is preserved as a
 * separate `transcriptLanguage` field the prompt may quote as context. One value
 * per question: "what language do I write in" and "what language did I hear".
 *
 * Drives processAnalysis() end to end with the network boundary mocked, so the
 * changed lines actually execute.
 */

jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__ANALYSIS_LANG_SESSION, error: null })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: global.__ANALYSIS_LANG_SESSION, error: null })),
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

// The ONE reader of the teacher's stored preference. Stubbed to 'ur' so the test
// can tell a preference-driven answer apart from a transcript-driven one.
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(() => Promise.resolve('ur')),
  setUserLanguage: jest.fn(),
  DEFAULT_LANGUAGE: 'en',
}));

const mockAnalyze = jest.fn(() => Promise.resolve({
  analysis: { executive_summary: 'ok' },
  usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 0, cost: 0 },
}));
const mockCorpus = jest.fn(() => Promise.resolve(null));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: (...a) => mockAnalyze(...a),
  extractReflectiveCorpus: (...a) => mockCorpus(...a),
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
jest.mock('../../bot/shared/services/coaching/reflective-conversation.service', () => ({
  conductReflectiveConversation: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueReport: jest.fn(() => Promise.resolve()),
}));

const AnalysisProcessor = require('../../bot/shared/services/coaching/analysis-processor.service');
const { offerDefaultLanguage } = require('../../bot/shared/config/languages');

const SID = 'sess-analysis-language';

beforeEach(() => {
  jest.clearAllMocks();
  global.__ANALYSIS_LANG_SESSION = {
    id: SID,
    user_id: 'u1',
    observation_type: 'self_observation',
    transcript_text: 'aaj hum nayaa sabaq shuru karte hain',
    transcript_language: 'en',
    classroom_photos: [],
    users: { phone_number: '92300', name: 'A B', preferred_language: 'ur' },
  };
});

describe('analysis output language follows the teacher, not the transcriber', () => {
  test('metadata.language is her stored preference', async () => {
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });

    expect(mockAnalyze).toHaveBeenCalledTimes(1);
    const metadata = mockAnalyze.mock.calls[0][1];
    expect(metadata.language).toBe('ur');
  });

  test('what the transcriber heard is kept as separate context', async () => {
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });

    const metadata = mockAnalyze.mock.calls[0][1];
    expect(metadata.transcriptLanguage).toBe('en');
  });

  test('the reflective corpus is extracted in her language too', async () => {
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });

    expect(mockCorpus).toHaveBeenCalledTimes(1);
    expect(mockCorpus.mock.calls[0][1]).toBe('ur');
  });

  test('an off-offer transcript label can never reach the prompt as the output language', async () => {
    global.__ANALYSIS_LANG_SESSION.transcript_language = 'hindi';
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });

    const metadata = mockAnalyze.mock.calls[0][1];
    expect(metadata.language).toBe('ur');
    expect(metadata.transcriptLanguage).toBe('hindi');
  });
});

describe('progress-message language resolver', () => {
  test('a teacher with no stored preference gets the offer default, not the transcript label', async () => {
    global.__ANALYSIS_LANG_SESSION = {
      users: { name: 'A B', preferred_language: null },
      transcript_language: 'en',
    };
    const resolved = await AnalysisProcessor._resolveSessionLanguage(SID);
    expect(resolved).toBe(offerDefaultLanguage());
    expect(offerDefaultLanguage()).toBe('ur');
  });
});
