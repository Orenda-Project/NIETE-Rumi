'use strict';
/**
 * bd-b3pop.15 / .17 (D34) — the analysis processor with the vision pass v2. The chain from a submitted photo to the
 * fidelity grader's prompt runs for real: processor → photo-analysis v2 → photo evidence schema → fidelity orchestrator
 * → photo-credit guard → analyzer → prompt builder → scorer. Mocked only at the boundaries: the database, R2, the image
 * encoder, the vision model call, the FICO scoring call, the plan store and the grader's LLM client.
 *
 *   P1  COACHING_PHOTO_VISION=v2 + LP_FIDELITY_PHOTO=on → every classroom photo reaches the grader as evidence; a report
 *       screenshot reaches neither scorer; the blob records each photo's reading
 *   P2  vision v2 on, LP_FIDELITY_PHOTO unset → FICO gets the v2 descriptions; the grader's request is today's and the
 *       photo evidence is not stored
 *   P3  vision v2 unset → today's pass exactly (the v1 prompt at low detail) and no new analysis_data keys
 *   P4  one photo's v2 answer is not JSON → that photo falls back to today's pass; the job completes
 *   P5  one photo's v2 call fails → no second call for it, and the photo is still attached to the scoring call
 *   P6  a framework other than FICO → today's pass, even with COACHING_PHOTO_VISION=v2
 *   P7  the photo readings get 90 seconds; a photo not started by then is skipped, not read
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
const mockSelect = jest.fn(() => Promise.resolve({ framework: { name: 'fico' }, frameworkKey: 'fico', reason: 'default' }));
jest.mock('../../bot/shared/services/coaching/frameworks/framework-selector', () => ({
  selectFrameworkWithReason: (...a) => mockSelect(...a),
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
            ] }) }, finish_reason: 'stop' }],
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
      { move_id: 'm1', phase: 'explain', type: 'modelling', text: 'Write the three new words جھکڑ، تاب کاری، آزاد on the board', bucket: 'must_happen', selection: 'none' },
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

function visionAnswers({ unreadable = [], failing = [], onCall } = {}) {
  mockVision.mockImplementation(async (buf, mime, opts) => {
    if (onCall) onCall();
    const key = buf.toString().replace(/^img-/, '');
    if (opts && opts.responseFormat) {
      if (failing.includes(key)) return { success: false, error: 'Request timed out.' };
      return { success: true, analysis: unreadable.includes(key) ? 'not json at all' : JSON.stringify(V2[key]), finishReason: 'stop' };
    }
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
const run = () => AnalysisProcessor.processAnalysis(SID, { from: '92300' });
const lastAnalysisData = () => [...mockPersisted].reverse().find((p) => p && p.analysis_data)?.analysis_data;
const fidelityCalls = () => mockGraderCalls.filter((p) => String(p.messages[0].content).startsWith('FIDELITY GRADER'));
const FLAGS = ['COACHING_PHOTO_MODE', 'COACHING_PHOTO_VISION', 'LP_FIDELITY_ENABLED', 'LP_FIDELITY_PHOTO', 'LP_FIDELITY_RUNS'];

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
    await run();

    expect(mockVision).toHaveBeenCalledTimes(3);
    for (const call of mockVision.mock.calls) {
      expect(call[2]).toMatchObject({ detail: 'high', temperature: 0, responseFormat: { type: 'json_object' }, timeoutMs: 30000 });
      expect(call[3]).toBe(1);
    }

    const fico = mockAnalyze.mock.calls[0][1].photo;
    expect(fico.text).toContain('Classroom photo 1 (submitted by the teacher): The photo shows a whiteboard with three new Urdu words.');
    expect(fico.text).toContain('Classroom photo 3 (submitted by the teacher): The photo shows pupils in pairs');
    expect(fico.text).not.toContain('Classroom photo 2');
    expect(fico.images).toHaveLength(2);
    expect(fico.count).toBe(2);

    const [grader] = fidelityCalls();
    expect(grader.messages[0].content).toBe(GRADER_BRIEF + PHOTO_EVIDENCE_SECTION);
    expect(grader.messages[1].content).toContain('<classroom_photo_evidence>');
    expect(grader.messages[1].content).toContain('[photo 1] kind: board\nwriting: جھکڑ / تاب کاری / آزاد');
    expect(grader.messages[1].content).toContain('[photo 3] kind: group_or_pair_work\nstudents: pupils in pairs reading the textbook to each other\nlearning materials: textbook');
    expect(grader.messages[1].content).not.toContain('[photo 2]');

    const ad = lastAnalysisData();
    expect(ad.photo_vision).toBe('v2');
    expect(ad.photo_reads).toEqual([
      { n: 1, status: 'read', kind: 'board' },
      { n: 2, status: 'excluded', kind: 'not_a_classroom_photo', reason: 'not_a_classroom_photo' },
      { n: 3, status: 'read', kind: 'group_or_pair_work' },
    ]);
    expect(ad.photo_evidence.map((e) => e.n)).toEqual([1, 3]);
    expect(ad).not.toHaveProperty('photo_rejected');
    expect(ad.photo_analysis).not.toContain('celebration');
    expect(ad.photo_count_analysed).toBe(3);
    expect(ad.lp_fidelity.status).toBe('ok');
    expect(ad.lp_fidelity.photo_citations).toEqual({ photos: 2, moves_cited: 1 });
    expect(ad.lp_fidelity.moves.find((m) => m.move_id === 'm1')).toMatchObject({ verdict: 'executed', credit: 1 });
    expect(ad.lp_fidelity.recording).toMatchObject({ audio_s: 900, stamps: 2 });
  });

  test("P2: v2 on, LP_FIDELITY_PHOTO unset — FICO gets the v2 descriptions, the grader's request is today's, no evidence stored", async () => {
    process.env.COACHING_PHOTO_VISION = 'v2';
    visionAnswers();
    await run();
    const [grader] = fidelityCalls();
    expect(grader.messages[0].content).toBe(GRADER_BRIEF);
    expect(grader.messages[1].content).not.toContain('classroom_photo_evidence');
    const ad = lastAnalysisData();
    expect(ad.photo_reads).toHaveLength(3);
    expect(ad).not.toHaveProperty('photo_evidence');
    expect(ad.lp_fidelity.photo_citations).toBe(null);
  });

  test("P3: vision v2 unset — today's pass exactly, and no new analysis_data keys", async () => {
    visionAnswers();
    await run();
    for (const call of mockVision.mock.calls) expect(call[2]).toEqual({ prompt: buildFrameworkVisionPrompt('fico'), detail: 'low' });
    const fico = mockAnalyze.mock.calls[0][1].photo;
    expect(fico.text).toContain('Classroom photo 2 (submitted by the teacher): v1 description of r2://report.jpg');
    expect(fico.images).toHaveLength(3);
    expect(fico.count).toBe(3);
    const ad = lastAnalysisData();
    for (const k of ['photo_vision', 'photo_evidence', 'photo_reads']) expect(ad).not.toHaveProperty(k);
    expect(ad.photo_count_analysed).toBe(3);
  });

  test("P4: one photo's v2 answer is not JSON — that photo falls back to today's pass, the job completes", async () => {
    process.env.COACHING_PHOTO_VISION = 'v2';
    process.env.LP_FIDELITY_PHOTO = 'on';
    visionAnswers({ unreadable: ['r2://pairs.jpg'] });
    await run();
    expect(mockVision).toHaveBeenCalledTimes(4); // three v2 readings + one v1 fallback
    const fico = mockAnalyze.mock.calls[0][1].photo;
    expect(fico.text).toContain('Classroom photo 3 (submitted by the teacher): v1 description of r2://pairs.jpg');
    const ad = lastAnalysisData();
    expect(ad.photo_reads[2]).toEqual({ n: 3, status: 'fallback_v1', reason: 'not_json' });
    expect(ad.photo_evidence.map((e) => e.n)).toEqual([1]);
    expect(ad.lp_fidelity.status).toBe('ok');
  });

  test("P5: one photo's v2 call fails — no second call for it, and it is still attached to the scoring call", async () => {
    process.env.COACHING_PHOTO_VISION = 'v2';
    visionAnswers({ failing: ['r2://pairs.jpg'] });
    await run();
    expect(mockVision).toHaveBeenCalledTimes(3);
    const fico = mockAnalyze.mock.calls[0][1].photo;
    expect(fico.text).not.toContain('Classroom photo 3');
    expect(fico.images).toHaveLength(2);
    expect(lastAnalysisData().photo_reads[2]).toEqual({ n: 3, status: 'failed', reason: 'call_failed' });
  });

  test("P6: a framework other than FICO — today's pass even with COACHING_PHOTO_VISION=v2", async () => {
    process.env.COACHING_PHOTO_VISION = 'v2';
    mockSelect.mockResolvedValueOnce({ framework: { name: 'hots' }, frameworkKey: 'hots', reason: 'test' });
    visionAnswers();
    await run();
    expect(mockVision).toHaveBeenCalledTimes(3);
    for (const call of mockVision.mock.calls) expect(call[2]).toEqual({ prompt: buildFrameworkVisionPrompt('hots'), detail: 'low' });
    expect(lastAnalysisData()).not.toHaveProperty('photo_vision');
  });

  test('P7: the photo readings get 90 seconds — a photo not started by then is skipped, not read', async () => {
    process.env.COACHING_PHOTO_VISION = 'v2';
    let clock = 1000000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    visionAnswers({ onCall: () => { clock += 95000; } });
    try {
      await run();
    } finally {
      nowSpy.mockRestore();
    }
    expect(mockVision).toHaveBeenCalledTimes(1);
    const ad = lastAnalysisData();
    expect(ad.photo_reads).toEqual([
      { n: 1, status: 'read', kind: 'board' },
      { n: 2, status: 'skipped_budget' },
      { n: 3, status: 'skipped_budget' },
    ]);
    expect(mockAnalyze.mock.calls[0][1].photo.count).toBe(1);
  });
});
