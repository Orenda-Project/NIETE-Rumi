/**
 * bd-ra8xu.53 — a v9 lesson-plan PDF from our own library is never linked, so a FICO17 v6 visit gets no
 * lesson-plan fidelity.
 *
 * Prod, ICT, 13 Nov 21:59 PKT (Rifat's FICO17 v6 visit e4000296): the coach uploaded our Grade 4 Urdu lesson
 * gb_g4_urdu_ch2_seg3. Its PDF Subject is `lesson_id=GB_G4_URDU.C02.S003; book_stem=gb_g4_urdu; pp.9` (the v9
 * renderer, bot/vendor/lp-v9/render_lp.js, writes the lesson's dotted id; the library's own PDF for that lesson
 * carries the same Subject). The lookup read `[A-Za-z0-9_]+`, stopped at the dot, looked up `gb_g4_urdu`, found
 * nothing (Axiom: inLibrary false), and the file went to OCR, which degenerated into a run of zeros: "not a lesson
 * plan", has_lesson_plan false, lp_fidelity lp_absent. 30 production visits since 1 Nov carried such an id.
 *
 * Contract: `BASE.Cnn.Snnn` is the library lesson `base_chN_segN` and is linked directly: no parse, no vision.
 * First on FICO17 v6 visits only; since bd-ra8xu.56 (operator 14 Nov 14:55, decision 363: "make this live for
 * everyone") on every visit. Ids already in the library's form are unchanged everywhere.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const HER_SUBJECT = 'lesson_id=GB_G4_URDU.C02.S003; book_stem=gb_g4_urdu; pp.9';
const LIBRARY = {
  gb_g4_urdu_ch2_seg3: { id: 'a1', lesson_id: 'gb_g4_urdu_ch2_seg3', version_stamp: 'gb_v9_gbfix_5Nov', content_hash: '7d391225b42e' },
  gb_g5_science_ch10_seg8: { id: 'a2', lesson_id: 'gb_g5_science_ch10_seg8', version_stamp: 'gb_v9_gbfix_5Nov', content_hash: 'h2' },
  grade_1_urdu_ch6_seg6: { id: 'a3', lesson_id: 'grade_1_urdu_ch6_seg6', version_stamp: 'title_9Oct', content_hash: 'h3' },
};
const VISION_TEXT = 'صفحہ ' + '٠'.repeat(400);

describe('bd-ra8xu.53 · a v9 lesson id links our own lesson on a FICO17 v6 visit', () => {
  let updates; let visionCalls; let assetQueries;

  function load({ subject, framework }) {
    jest.resetModules();
    updates = []; visionCalls = []; assetQueries = [];
    jest.doMock('pdf-parse', () => async () => ({ text: '\u0000\n\u0000', info: { Subject: subject } }));
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: (table) => {
        const b = {
          _filters: {},
          select: () => b, order: () => b, limit: () => b,
          eq: (col, val) => { b._filters[col] = val; return b; },
          neq: (col, val) => { b._filters[`${col}!=`] = val; return b; },
          single: async () => ({
            data: { user_id: 'coach-1', lesson_plan_url: 'u', lesson_plan_r2_key: 'k.pdf', lesson_plan_format: 'pdf', framework },
            error: null,
          }),
          maybeSingle: async () => ({ data: null, error: null }),
          update: (payload) => { updates.push({ table, payload }); return b; },
          then: (res, rej) => {
            if (table === 'niete_lp_assets') {
              assetQueries.push({ ...b._filters });
              const row = LIBRARY[b._filters.lesson_id];
              return Promise.resolve({ data: row ? [row] : [], error: null }).then(res, rej);
            }
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          },
        };
        return b;
      },
    }));
    jest.doMock('../../bot/shared/storage/r2', () => ({
      downloadFromR2: async () => Buffer.from('%PDF-1.4 fake'),
      uploadLessonPlanBuffer: async () => 'k', buildR2PublicUrl: () => 'u',
    }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => true) }));
    jest.doMock('../../bot/shared/services/lp-vision-ocr.service', () => ({
      extractTextFromPdf: async () => { visionCalls.push('pdf'); return VISION_TEXT; },
      extractTextFromImage: async () => { visionCalls.push('image'); return VISION_TEXT; },
      visionModel: () => 'test-vision',
    }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: () => {}, logWarn: () => {}, logError: () => {} }));
    const Worker = require('../../bot/workers/lesson-plan-extraction.worker');
    jest.spyOn(Worker, 'notifyNotLessonPlan').mockResolvedValue();
    const recompute = jest.spyOn(Worker, 'maybeRecomputeFidelity').mockResolvedValue({ recomputed: true });
    const parse = jest.spyOn(Worker, 'parseWithGPT4oMini').mockResolvedValue({ is_lesson_plan: false });
    return { Worker, recompute, parse };
  }

  afterEach(() => {
    for (const m of ['pdf-parse', '../../bot/shared/config/supabase', '../../bot/shared/storage/r2',
      '../../bot/shared/services/whatsapp.service', '../../bot/shared/services/lp-vision-ocr.service',
      '../../bot/shared/utils/logger']) jest.dontMock(m);
    jest.restoreAllMocks();
    jest.resetModules();
  });

  const run = (Worker) => Worker.process({ coachingSessionId: 'e4000296', r2Key: 'k.pdf', fileType: 'pdf', userId: 'coach-1' });
  const linked = () => updates.find((u) => u.payload.lesson_plan_extraction_status === 'completed');

  it('her PDF on her FICO17 v6 visit: links gb_g4_urdu_ch2_seg3 directly, no parse, no vision', async () => {
    const { Worker, recompute, parse } = load({ subject: HER_SUBJECT, framework: 'fico17_v6' });
    await run(Worker);
    expect(assetQueries[0]).toMatchObject({ lesson_id: 'gb_g4_urdu_ch2_seg3' });
    expect(parse).not.toHaveBeenCalled();
    expect(visionCalls).toEqual([]);
    expect(linked().payload).toMatchObject({
      has_lesson_plan: true,
      lesson_plan_structured: { _fidelity_ref: { lesson_id: 'gb_g4_urdu_ch2_seg3', version_stamp: 'gb_v9_gbfix_5Nov', content_hash: '7d391225b42e' } },
    });
    expect(recompute).toHaveBeenCalledWith('e4000296');
  });

  it('two-digit chapter and segment numbers: GB_G5_SCIENCE.C10.S008 is gb_g5_science_ch10_seg8', async () => {
    const { Worker } = load({ subject: 'lesson_id=GB_G5_SCIENCE.C10.S008; book_stem=gb_g5_science; pp.147', framework: 'fico17_v6' });
    await run(Worker);
    expect(assetQueries[0]).toMatchObject({ lesson_id: 'gb_g5_science_ch10_seg8' });
    expect(linked().payload.lesson_plan_structured._fidelity_ref.lesson_id).toBe('gb_g5_science_ch10_seg8');
  });

  it('bd-ra8xu.56: a V3 visit and an unstamped one link it the same way (decision 363, every coach)', async () => {
    for (const framework of ['fico', null]) {
      const { Worker, parse } = load({ subject: HER_SUBJECT, framework });
      await run(Worker);
      expect(assetQueries[0]).toMatchObject({ lesson_id: 'gb_g4_urdu_ch2_seg3' });
      expect(parse).not.toHaveBeenCalled();
      expect(visionCalls).toEqual([]);
      expect(linked().payload.lesson_plan_structured._fidelity_ref.lesson_id).toBe('gb_g4_urdu_ch2_seg3');
    }
  });

  it('bd-ra8xu.56: a v9 id the library does not hold (an ICT grade 6-12 book) still reads the file, as before', async () => {
    const { Worker } = load({ subject: 'lesson_id=GRADE_6_GENERAL_SCIENCE.C03.S002; book_stem=grade_6_general_science; pp.31', framework: 'fico' });
    await run(Worker);
    expect(assetQueries[0]).toMatchObject({ lesson_id: 'grade_6_general_science_ch3_seg2' });
    expect(visionCalls).toEqual(['pdf']);
  });

  it('an id already in the library form links as before, switch or not', async () => {
    for (const framework of ['fico17_v6', 'fico']) {
      const { Worker } = load({ subject: 'lesson_id=GRADE_1_URDU_CH6_SEG6; book_stem=grade_1_urdu; pp.55-56', framework });
      await run(Worker);
      expect(assetQueries[0]).toMatchObject({ lesson_id: 'grade_1_urdu_ch6_seg6' });
      expect(linked().payload.lesson_plan_structured._fidelity_ref.lesson_id).toBe('grade_1_urdu_ch6_seg6');
    }
  });
});
