/**
 * bd-8s2xb (T5–T7, T9) — the analysis processor's photo channel.
 *
 * Mocks: supabase (persist capture), the model service (analyzePedagogy — we assert on
 * what it is handed), R2 download, the vision description, and the scorer-image encoder
 * (sharp is a bot-only dependency; the encoder is tested on its own in T8). Everything
 * between — the processor's own loop, mode resolution, degrade path, persist shape — runs
 * for real.
 *
 *   T5  3 photos, mode both → 3 downloads, 3 descriptions, 3 encoded images handed to the scorer
 *   T6  persisted analysis_data carries photo_mode / photo_count_analysed / photo_analysis
 *   T7  one download fails → 2 images, still 'both'; all fail → 'text' (desc exists) / 'off'
 *   T9  flag unset → today's behaviour: no images, photo_mode 'note', description still made
 */
const persisted = [];
jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn((patch) => { persisted.push(patch); return builder; }),
    eq: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__S2XB_SESSION, error: null })),
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
  analysis: { executive_summary: 'ok', domains: {} },
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
const mockProcessPhoto = jest.fn(() => Promise.resolve('the board shows the objective'));
jest.mock('../../bot/shared/services/coaching/classroom-photo/photo-analysis.service', () => ({
  processClassroomPhoto: (...a) => mockProcessPhoto(...a),
}));
const mockDownload = jest.fn((key) => key.includes('bad') ? Promise.reject(new Error('404')) : Promise.resolve(Buffer.from('img-' + key)));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: (k) => mockDownload(k),
  extractKeyFromUrl: jest.fn((u) => u),
}));
const mockEncode = jest.fn((buf) => Promise.resolve({ mime: 'image/jpeg', base64: buf.toString('base64'), bytes: buf.length }));
jest.mock('../../bot/shared/services/coaching/classroom-photo/scorer-image.js', () => ({
  encodeForScorer: (...a) => mockEncode(...a),
}));

const AnalysisProcessor = require('../../bot/shared/services/coaching/analysis-processor.service');

const SID = 'sess-8s2xb';
function session(photos) {
  return {
    id: SID, user_id: 'u1', observation_type: 'self_observation',
    transcript_text: 't', transcript_language: 'ur', classroom_photos: photos,
    users: { phone_number: '92300', first_name: 'A', last_name: 'B' },
  };
}
const lastAnalysisData = () => [...persisted].reverse().find((p) => p && p.analysis_data)?.analysis_data;

beforeEach(() => { jest.clearAllMocks(); persisted.length = 0; delete process.env.COACHING_PHOTO_MODE; });

describe('bd-8s2xb — processor photo channel', () => {
  test('T5: both mode, 3 photos → 3 downloads, 3 descriptions, 3 images handed to the scorer', async () => {
    process.env.COACHING_PHOTO_MODE = 'both';
    global.__S2XB_SESSION = session([{ url: 'r2://a.jpg' }, { url: 'r2://b.jpg' }, { url: 'r2://c.jpg' }]);
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });

    expect(mockDownload).toHaveBeenCalledTimes(3);
    expect(mockProcessPhoto).toHaveBeenCalledTimes(3);
    expect(mockEncode).toHaveBeenCalledTimes(3);
    const meta = mockAnalyze.mock.calls[0][1];
    expect(meta.photo.mode).toBe('both');
    expect(meta.photo.count).toBe(3);
    expect(meta.photo.images).toHaveLength(3);
    expect(meta.photo.text).toContain('Classroom photo 3 (submitted by the teacher)');
    expect(meta.photoAnalysis).toBe(meta.photo.text);          // legacy field kept in step
  });

  test('T6: persisted analysis_data carries photo_mode, photo_count_analysed, photo_analysis', async () => {
    process.env.COACHING_PHOTO_MODE = 'both';
    global.__S2XB_SESSION = session([{ url: 'r2://a.jpg' }, { url: 'r2://b.jpg' }, { url: 'r2://c.jpg' }]);
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    const ad = lastAnalysisData();
    expect(ad.photo_mode).toBe('both');
    expect(ad.photo_count_analysed).toBe(3);
    expect(ad.photo_analysis).toContain('the board shows the objective');
    expect(JSON.stringify(ad)).not.toContain('base64');        // never persist image bytes
  });

  test('T7: one download fails → 2 images, mode stays both; all fail → text; all fail + no text → off', async () => {
    process.env.COACHING_PHOTO_MODE = 'both';
    global.__S2XB_SESSION = session([{ url: 'r2://a.jpg' }, { url: 'r2://bad.jpg' }, { url: 'r2://c.jpg' }]);
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    let meta = mockAnalyze.mock.calls[0][1];
    expect(meta.photo.images).toHaveLength(2);
    expect(meta.photo.mode).toBe('both');
    expect(lastAnalysisData().photo_count_analysed).toBe(3);   // count = submitted, images = usable

    jest.clearAllMocks(); persisted.length = 0;
    global.__S2XB_SESSION = session([{ url: 'r2://bad1.jpg' }, { url: 'r2://bad2.jpg' }]);
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    meta = mockAnalyze.mock.calls[0][1];
    expect(meta.photo.images).toHaveLength(0);
    expect(meta.photo.mode).toBe('off');                        // nothing downloaded → no description either
    expect(lastAnalysisData().photo_mode).toBe('off');

    // download ok but encode fails → description exists, no images → text
    jest.clearAllMocks(); persisted.length = 0;
    mockEncode.mockImplementation(() => Promise.reject(new Error('sharp boom')));
    global.__S2XB_SESSION = session([{ url: 'r2://a.jpg' }]);
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    meta = mockAnalyze.mock.calls[0][1];
    expect(meta.photo.images).toHaveLength(0);
    expect(meta.photo.mode).toBe('text');
    expect(meta.photo.text).toContain('the board shows the objective');
    expect(mockAnalyze).toHaveBeenCalledTimes(1);               // the job never failed
  });

  test('T9: flag unset → today\'s behaviour: description made, no images, photo_mode note', async () => {
    global.__S2XB_SESSION = session([{ url: 'r2://a.jpg' }, { url: 'r2://b.jpg' }]);
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    const meta = mockAnalyze.mock.calls[0][1];
    expect(mockEncode).not.toHaveBeenCalled();
    expect(meta.photo.mode).toBe('note');
    expect(meta.photo.images).toHaveLength(0);
    expect(meta.photoAnalysis).toContain('submitted by the teacher');
    expect(lastAnalysisData().photo_mode).toBe('note');
    expect(lastAnalysisData().photo_analysis).toContain('the board shows the objective');
  });
});
