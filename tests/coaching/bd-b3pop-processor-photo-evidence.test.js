'use strict';
/**
 * bd-b3pop.15 / .17 (D34) — the analysis processor with the vision pass v2. The chain from a submitted photo to the
 * fidelity grader's prompt runs for real: processor → photo-analysis v2 → fidelity orchestrator → analyzer → prompt
 * builder. Mocked only at the boundaries: the database, R2, the vision model call, the FICO scoring call, the plan store
 * and the grader's LLM client.
 *
 *   P1  COACHING_PHOTO_VISION=v2 + LP_FIDELITY_PHOTO=on → every classroom photo reaches the grader as evidence; a report
 *       screenshot reaches neither scorer; the blob records what was read and what was set aside
 *   P2  vision v2 on, LP_FIDELITY_PHOTO unset → FICO gets the v2 descriptions; the grader's request is today's
 *   P3  vision v2 unset → today's pass exactly (the v1 prompt at low detail) and no new analysis_data keys
 *   P4  one photo's v2 answer unreadable → that photo falls back to today's pass; the job completes
 */
const mockPersisted = [];
jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn((patch) => { mockPersisted.push(patch); return builder; }),
    eq: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__B3POP_SESSION, error: null })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: { users: { preferred_language: 'en' } }, error: null })),
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return { from: jest.fn(() => builder) };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ PEDAGOGICAL_ANALYSIS_MEDIA_ID: null }));
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
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({ queueReport: jest.fn(() => Promise.resolve()) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: (k) => Promise.resolve(Buffer.from(`img-${k}`)),
  extractKeyFromUrl: (u) => u,
}));
jest.mock('../../bot/shared/services/coaching/classroom-photo/scorer-image.js', () => ({
  encodeForScorer: (buf) => Promise.resolve({ mime: 'image/jpeg', base64: buf.toString('base64'), bytes: buf.length }),
}));
const mockVision = jest.fn();
jest.mock('../../bot/shared/services/vision.service', () => ({ analyzeWithRetry: (...a) => mockVision(...a) }));
const mockGraderCalls = [];
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({
    chat: {
      completions: {
        create: async (p) => {
          mockGraderCalls.push(p);
          return {
            choices: [{ message: { content: JSON.stringify({ verdicts: [
              { move_id: 'm1', verdict: 'executed', evidence: '[photo 1] the three new words on the board' },
              { move_id: 'm2', verdict: 'not_done', evidence: '' },
            ] }) } }],
            usage: {},
          };
        },
      },
    },
  }),
  getDefaultModel: () => 'openai/gpt-4o',
}));
jest.mock('../../bot/shared/services/coaching/fidelity/lp-fidelity-store', () => ({
  resolveMoveList: async () => ({
    moves: [
      { move_id: 'm1', phase: 'explain', type: 'modelling', text: 'Write the three new words on the board', bucket: 'must_happen', selection: 'none' },
      { move_id: 'm2', phase: 'independent', type: 'practice', text: 'Pairs read the passage to each other', bucket: 'must_happen', selection: 'none' },
    ],
    lesson_id: 'grade_4_urdu_ch5_seg990', template: 'STANDARD', resolved: 'exact',
  }),
}));

const AnalysisProcessor = require('../../bot/shared/services/coaching/analysis-processor.service');
const { GRADER_BRIEF } = require('../../bot/shared/services/coaching/fidelity/grader-prompt');
const { PHOTO_EVIDENCE_SECTION } = require('../../bot/shared/services/coaching/fidelity/grader-photo-evidence');
const { buildFrameworkVisionPrompt } = require('../../bot/shared/services/coaching/classroom-photo/photo-analysis.service');

const SID = 'sess-b3pop';
const PHOTOS = [{ url: 'r2://board.jpg' }, { url: 'r2://report.jpg' }, { url: 'r2://pairs.jpg' }];
const V2 = {
  'r2://board.jpg': { kind: 'board', description: 'The photo shows a whiteboard with three new Urdu words.', students: '', learning_materials: [], student_work: '', drawings: '', visible_text: 'جھکڑ\nتاب کاری\nآزاد' },
  'r2://report.jpg': { kind: 'not_a_classroom_photo', description: 'A screenshot of an earlier coaching report.', students: '', learning_materials: [], student_work: '', drawings: '', visible_text: 'A celebration of your teaching' },
  'r2://pairs.jpg': { kind: 'group_or_pair_work', description: 'The photo shows pupils in pairs with their textbooks open.', students: 'pupils in pairs reading the textbook to each other', learning_materials: ['textbook'], student_work: '', drawings: '', visible_text: '' },
};

function visionAnswers({ unreadable = [] } = {}) {
  mockVision.mockImplementation(async (buf, mime, opts) => {
    const key = buf.toString().replace(/^img-/, '');
    if (opts && opts.responseFormat) return { success: true, analysis: unreadable.includes(key) ? 'not json at all' : JSON.stringify(V2[key]) };
    return { success: true, analysis: `v1 description of ${key}` };
  });
}
function session() {
  return {
    id: SID, user_id: 'u1', observation_type: 'self_observation',
    transcript_text: '[00:10] Teacher: آج ہم نئے الفاظ پڑھیں گے\n\n[10:00] Teacher: جوڑوں میں پڑھیں',
    transcript_language: 'ur', audio_duration_seconds: 900, classroom_photos: PHOTOS,
    lesson_plan_structured: { _fidelity_ref: { lesson_id: 'grade_4_urdu_ch5_seg990', version_stamp: 'v1', content_hash: 'h' } },
    users: { phone_number: '92300', name: 'A B' },
  };
}
const lastAnalysisData = () => [...mockPersisted].reverse().find((p) => p && p.analysis_data)?.analysis_data;
const fidelityCalls = () => mockGraderCalls.filter((p) => String(p.messages[0].content).startsWith('FIDELITY GRADER'));
const FLAGS = ['COACHING_PHOTO_MODE', 'COACHING_PHOTO_VISION', 'LP_FIDELITY_ENABLED', 'LP_FIDELITY_PHOTO'];

beforeEach(() => {
  jest.clearAllMocks();
  mockPersisted.length = 0;
  mockGraderCalls.length = 0;
  for (const k of FLAGS) delete process.env[k];
  process.env.LP_FIDELITY_ENABLED = 'true';
  process.env.COACHING_PHOTO_MODE = 'both';
  global.__B3POP_SESSION = session();
});
afterAll(() => { for (const k of FLAGS) delete process.env[k]; });

describe('bd-b3pop — processor: vision pass v2 → fidelity photo evidence', () => {
  test('P1: v2 + LP_FIDELITY_PHOTO=on — classroom photos reach the grader, the screenshot reaches neither scorer', async () => {
    process.env.COACHING_PHOTO_VISION = 'v2';
    process.env.LP_FIDELITY_PHOTO = 'on';
    visionAnswers();
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });

    expect(mockVision).toHaveBeenCalledTimes(3);
    for (const call of mockVision.mock.calls) expect(call[2]).toMatchObject({ detail: 'high', temperature: 0, responseFormat: { type: 'json_object' } });

    const fico = mockAnalyze.mock.calls[0][1].photo;
    expect(fico.text).toContain('Classroom photo 1 (submitted by the teacher): The photo shows a whiteboard with three new Urdu words.');
    expect(fico.text).toContain('Classroom photo 3 (submitted by the teacher): The photo shows pupils in pairs');
    expect(fico.text).not.toContain('Classroom photo 2');
    expect(fico.images).toHaveLength(2);

    const [grader] = fidelityCalls();
    expect(grader.messages[0].content).toBe(GRADER_BRIEF + PHOTO_EVIDENCE_SECTION);
    expect(grader.messages[1].content).toContain('[photo 1] kind: board\nwriting: جھکڑ / تاب کاری / آزاد');
    expect(grader.messages[1].content).toContain('[photo 3] kind: group_or_pair_work\nstudents: pupils in pairs reading the textbook to each other\nlearning materials: textbook');
    expect(grader.messages[1].content).not.toContain('[photo 2]');

    const ad = lastAnalysisData();
    expect(ad.photo_vision).toBe('v2');
    expect(ad.photo_evidence.map((e) => e.n)).toEqual([1, 3]);
    expect(ad.photo_rejected).toEqual([{ n: 2, kind: 'not_a_classroom_photo', description: 'A screenshot of an earlier coaching report.' }]);
    expect(ad.photo_analysis).not.toContain('celebration');
    expect(ad.lp_fidelity.status).toBe('ok');
    expect(ad.lp_fidelity.photo_evidence).toEqual({ count: 2, moves_cited: 1 });
    expect(ad.lp_fidelity.recording).toMatchObject({ audio_s: 900, stamps: 2 });
  });

  test("P2: v2 on, LP_FIDELITY_PHOTO unset — FICO gets the v2 descriptions, the grader's request is today's", async () => {
    process.env.COACHING_PHOTO_VISION = 'v2';
    visionAnswers();
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    const [grader] = fidelityCalls();
    expect(grader.messages[0].content).toBe(GRADER_BRIEF);
    expect(grader.messages[1].content).not.toContain('CLASSROOM PHOTO EVIDENCE');
    const ad = lastAnalysisData();
    expect(ad.photo_evidence).toHaveLength(2);
    expect(ad.lp_fidelity.photo_evidence).toBe(null);
  });

  test("P3: vision v2 unset — today's pass exactly, and no new analysis_data keys", async () => {
    visionAnswers();
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    for (const call of mockVision.mock.calls) expect(call[2]).toEqual({ prompt: buildFrameworkVisionPrompt('fico'), detail: 'low' });
    const fico = mockAnalyze.mock.calls[0][1].photo;
    expect(fico.text).toContain('Classroom photo 2 (submitted by the teacher): v1 description of r2://report.jpg');
    expect(fico.images).toHaveLength(3);
    const ad = lastAnalysisData();
    for (const k of ['photo_vision', 'photo_evidence', 'photo_rejected']) expect(ad).not.toHaveProperty(k);
  });

  test("P4: one photo's v2 answer is unreadable — that photo falls back to today's pass, the job completes", async () => {
    process.env.COACHING_PHOTO_VISION = 'v2';
    process.env.LP_FIDELITY_PHOTO = 'on';
    visionAnswers({ unreadable: ['r2://pairs.jpg'] });
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(mockVision).toHaveBeenCalledTimes(4); // three v2 readings + one v1 fallback
    const fico = mockAnalyze.mock.calls[0][1].photo;
    expect(fico.text).toContain('Classroom photo 3 (submitted by the teacher): v1 description of r2://pairs.jpg');
    const ad = lastAnalysisData();
    expect(ad.photo_evidence.map((e) => e.n)).toEqual([1]);
    expect(ad.lp_fidelity.status).toBe('ok');
  });
});
