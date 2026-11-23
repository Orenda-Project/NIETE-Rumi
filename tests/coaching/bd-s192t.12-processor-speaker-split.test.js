/**
 * bd-s192t.12 — the processor tells the FICO scorer when a recording was never split into speakers.
 * Same seam as bd-fmf24g.9-teacher-class-reaches-analyser.test.js: only the model call and supabase are mocked; the
 * processor's metadata block (the changed line) runs for real. Switch UNSPLIT_SPEAKER_NOTE: off → nothing new reaches
 * the model; on → metadata.speakerSplit is the verdict, and the real FICO prompt carries the note.
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

const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');
const SID = 'sess-unsplit';
const ONE_VOICE = { segments: [{ speaker: '1', label: 'Teacher', text: 'x', start_ms: 0, end_ms: 900000 }] };
function session(extra = {}) {
  return {
    id: SID, user_id: 'u-1', observation_type: null, transcript_text: 'Teacher: x', transcript_language: 'ur',
    audio_duration_seconds: 1200, classroom_photos: [], users: { name: 'Ayesha', phone_number: '92300' },
    diarization_data: ONE_VOICE, ...extra,
  };
}
const metaHandedToModel = () => mockAnalyze.mock.calls[0][1];

beforeEach(() => { jest.clearAllMocks(); persisted.length = 0; delete process.env.UNSPLIT_SPEAKER_NOTE; });
afterAll(() => { delete process.env.UNSPLIT_SPEAKER_NOTE; });

describe('bd-s192t.12 — unsplit verdict reaches the scorer', () => {
  test('switch off (default): metadata carries no verdict, so the prompt is unchanged', async () => {
    global.__SUBJ_SESSION = session();
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(metaHandedToModel().speakerSplit == null).toBe(true);
  });

  test('switch on, one voice: the verdict reaches the model and the real FICO prompt warns', async () => {
    process.env.UNSPLIT_SPEAKER_NOTE = 'true';
    global.__SUBJ_SESSION = session();
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    const meta = metaHandedToModel();
    expect(meta.speakerSplit).toMatchObject({ split: false, reason: 'one_voice' });
    expect(fico.buildAnalysisPrompt('Teacher: x', meta, null, null)).toContain('SPEAKER LABELS ARE NOT RELIABLE');
  });

  test('switch on, a split recording: the verdict says split, the prompt has no note', async () => {
    process.env.UNSPLIT_SPEAKER_NOTE = 'true';
    const segs = Array.from({ length: 400 }, (_, i) => ({ speaker: String(i % 2), label: i % 2 ? 'Student' : 'Teacher', text: 'x', start_ms: i * 1000, end_ms: i * 1000 + 900 }));
    global.__SUBJ_SESSION = session({ diarization_data: { segments: segs } });
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    const meta = metaHandedToModel();
    expect(meta.speakerSplit).toMatchObject({ split: true });
    expect(fico.buildAnalysisPrompt('Teacher: x', meta, null, null)).not.toContain('SPEAKER LABELS ARE NOT RELIABLE');
  });
});
