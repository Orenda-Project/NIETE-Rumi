/**
 * bd-0wws3e — Urdu LP PDFs: NUL bytes from pdf-parse make the LP save fail silently,
 * so the plan stays `pending` and Section B (fidelity) is never scored.
 *
 * Prod, ICT, 30 days to 13-Oct: 35 of 383 uploaded PDFs had NUL bytes in their
 * pdf-parse text (none of the 59 readable passing PDFs did). Their rows were never
 * updated — word_count null, text empty, status `pending` — even when the worker
 * logged "extraction complete": Postgres cannot store \u0000 in text/jsonb and the
 * worker never checked the update's error.
 *
 * Contract:
 *  1. Our own NIETE LP (PDF Subject carries lesson_id=…) that exists in niete_lp_assets
 *     is linked directly by its corpus ref — no parse, no vision.
 *  2. pdf-parse text that contains NUL bytes is unreadable → read by the vision model.
 *  3. Nothing saved carries a NUL byte.
 *  4. A failed save is logged at error level, never swallowed.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const NUL_TEXT = '· اردو۱ \n\u0000\n\u0000\nام\n\u0000\nؕ\n ۴۰ ·  ۵۵-۵۶ ہ \n'.repeat(30);
const VISION_TEXT = 'جماعت ۱ اردو\nتصویری جملے - تصاویر کو عنوان دینا\nمقاصد: ...\nسرگرمی: ...';
const URDU_LP = { is_lesson_plan: true, subject: 'اردو', topic: 'تصویری جملے', objectives: ['x'], activities: [{ title: 'y' }] };
const OUR_SUBJECT = 'lesson_id=GRADE_1_URDU_CH6_SEG6; book_stem=grade_1_urdu; pp.55-56';

describe('bd-0wws3e · LP extraction: corpus link, NUL text, safe saves', () => {
  let updates; let visionCalls; let assetQueries; let errors; let updateError;

  function load({ pdfText = NUL_TEXT, subject = null, assets = [] } = {}) {
    jest.resetModules();
    updates = []; visionCalls = []; assetQueries = []; errors = []; updateError = null;
    jest.doMock('pdf-parse', () => async () => ({ text: pdfText, info: subject ? { Subject: subject } : {} }));
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: (table) => {
        const b = {
          _filters: {},
          select: () => b, order: () => b, limit: () => b,
          eq: (col, val) => { b._filters[col] = val; return b; },
          single: async () => ({ data: { user_id: 'teacher-1', lesson_plan_url: 'u', lesson_plan_r2_key: 'k.pdf', lesson_plan_format: 'pdf' }, error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
          update: (payload) => { updates.push({ table, payload }); return b; },
          then: (res, rej) => {
            if (table === 'niete_lp_assets') { assetQueries.push({ ...b._filters }); return Promise.resolve({ data: assets, error: null }).then(res, rej); }
            return Promise.resolve({ data: null, error: updateError }).then(res, rej);
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
    jest.doMock('../../bot/shared/utils/logger', () => ({
      logToFile: () => {}, logWarn: () => {},
      logError: (msg, data) => { errors.push({ msg, data }); },
    }));
    const Worker = require('../../bot/workers/lesson-plan-extraction.worker');
    jest.spyOn(Worker, 'notifyNotLessonPlan').mockResolvedValue();
    const recompute = jest.spyOn(Worker, 'maybeRecomputeFidelity').mockResolvedValue({ recomputed: true });
    const parse = jest.spyOn(Worker, 'parseWithGPT4oMini').mockResolvedValue(URDU_LP);
    return { Worker, recompute, parse };
  }

  afterEach(() => {
    for (const m of ['pdf-parse', '../../bot/shared/config/supabase', '../../bot/shared/storage/r2',
      '../../bot/shared/services/whatsapp.service', '../../bot/shared/services/lp-vision-ocr.service',
      '../../bot/shared/utils/logger']) jest.dontMock(m);
    jest.restoreAllMocks();
    jest.resetModules();
  });

  const run = (Worker) => Worker.process({ coachingSessionId: 'sess-1', r2Key: 'k.pdf', fileType: 'pdf', userId: 'teacher-1' });
  const hasNul = (v) => JSON.stringify(v).includes('\\u0000');

  it('links our own LP by the lesson_id in the PDF — no parse, no vision', async () => {
    const { Worker, recompute, parse } = load({
      subject: OUR_SUBJECT,
      assets: [{ id: 'a1', lesson_id: 'grade_1_urdu_ch6_seg6', version_stamp: 'title_9Oct', content_hash: 'h1' }],
    });
    await run(Worker);

    expect(assetQueries[0]).toMatchObject({ lesson_id: 'grade_1_urdu_ch6_seg6' });
    expect(parse).not.toHaveBeenCalled();
    expect(visionCalls).toEqual([]);
    const done = updates.find((u) => u.payload.lesson_plan_extraction_status === 'completed');
    expect(done).toBeTruthy();
    expect(done.payload).toMatchObject({
      has_lesson_plan: true,
      lesson_plan_structured: { _fidelity_ref: { lesson_id: 'grade_1_urdu_ch6_seg6', version_stamp: 'title_9Oct', content_hash: 'h1' } },
    });
    expect(recompute).toHaveBeenCalledWith('sess-1');
  });

  it('falls back to reading the file when the lesson_id is not in the library', async () => {
    const { Worker } = load({ subject: OUR_SUBJECT, assets: [] });
    await run(Worker);
    const done = updates.find((u) => u.payload.lesson_plan_extraction_status === 'completed');
    expect(done.payload.lesson_plan_structured._fidelity_ref).toBeUndefined();
    expect(done.payload.lesson_plan_text).toBe(VISION_TEXT);
  });

  it('sends pdf-parse text with NUL bytes straight to the vision model', async () => {
    const { Worker, parse } = load();
    await run(Worker);
    expect(visionCalls).toEqual(['pdf']);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledWith(VISION_TEXT);
    const done = updates.find((u) => u.payload.lesson_plan_extraction_status === 'completed');
    expect(done.payload.lesson_plan_text).toBe(VISION_TEXT);
  });

  it('never saves a NUL byte, even when the vision read also fails', async () => {
    const { Worker } = load();
    jest.doMock('../../bot/shared/services/lp-vision-ocr.service', () => ({
      extractTextFromPdf: async () => '', extractTextFromImage: async () => '', visionModel: () => 'v',
    }));
    jest.spyOn(require('../../bot/shared/services/aws-textract.service').AWSTextractService, 'extractText').mockResolvedValue('');
    await run(Worker);
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) expect(hasNul(u.payload)).toBe(false);
  });

  it('logs a failed save at error level instead of swallowing it', async () => {
    const { Worker } = load({ pdfText: 'Lesson Plan. Objectives: read aloud. Activities: warm-up, pair reading, quiz.' });
    updateError = { code: '22P05', message: 'unsupported Unicode escape sequence' };
    await run(Worker);
    expect(errors.find((e) => /save failed/i.test(e.msg) && e.data && e.data.coachingSessionId === 'sess-1')).toBeTruthy();
  });
});
